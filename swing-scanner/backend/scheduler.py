"""
ARQ worker + cron job definitions.
Daily pipeline: regime → screener → charting → analysis → deep analysis →
portfolio signals → watchlist → performance → daily summary
"""
import asyncio
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Callable, Optional

from arq import cron
from arq.connections import RedisSettings

from backend.analyzer import analyze_chart
from backend.chart_fetcher import render_chart
from backend.config import settings
from backend.database import (
    PredictionArchive,
    ScanFunnel,
    ScanResult,
    archive_prediction,
    clear_results_for_date,
    get_archived_tickers_for_date,
    get_last_scan_datetime,
    get_pending_predictions,
    get_watchlist_pending,
    init_db,
    resolve_prediction,
    save_scan_funnel,
    save_scan_result,
    update_candidate_status,
    update_deep_analysis,
)
from backend.deep_analyzer import deep_analyze
from backend.market_regime import ensure_regime_current, get_current_regime, update_market_regime
from backend.news_checker import run_full_news_check
from backend.notifier import (
    notify_daily_summary,
    notify_scan_complete,
    notify_sell_signal,
    notify_trigger_reached,
    notify_watchlist_alert,
    send_daily_summary_email,
    send_push,
)
from backend.performance import update_performance_tracking
from backend.screener import run_screener
from backend.signal_checker import run_portfolio_signal_check, check_candidate_triggers
from backend.watchlist import check_watchlist_alerts

logger = logging.getLogger(__name__)


def _parse_entry_upper(entry_zone: Optional[str]) -> Optional[float]:
    """
    Extract the upper bound from an entry_zone string.
    "145.50-148.00" → 148.00
    "150.00"        → 150.00 (single value = the trigger)
    Returns None if unparseable.
    """
    import re as _re
    if not entry_zone:
        return None
    nums = [float(x) for x in _re.findall(r"[\d.]+", str(entry_zone))]
    return max(nums) if nums else None


def next_trading_day(from_date: date) -> date:
    """Return the next weekday (Mon–Fri) after from_date."""
    d = from_date + timedelta(days=1)
    while d.weekday() >= 5:  # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d


def resolve_scan_date() -> date:
    """
    If the scan runs after 20:00 UTC (post-market), assign results to the
    next trading day — so the user sees them as 'today's candidates' tomorrow.
    Manual/daytime scans keep date.today().
    """
    now_utc = datetime.now(timezone.utc)
    if now_utc.hour >= 20:
        return next_trading_day(now_utc.date())
    return now_utc.date()


# ---------------------------------------------------------------------------
# Output-quality validation helpers (1.0b Fix A / B / C)
# ---------------------------------------------------------------------------

def _has_full_setup(analysis: dict) -> bool:
    """
    Fix B: A tradeable candidate needs entry_zone + stop_loss + target.
    If any is missing → watchlist_pending (observe, don't trade).
    """
    return all([
        analysis.get("entry_zone"),
        analysis.get("stop_loss"),
        analysis.get("target"),
    ])


def _is_direction_mismatch(analysis: dict) -> bool:
    """
    Fix C: Detect hidden short setups in long-only modules.
    stop_loss > entry_mid means the stop is ABOVE the entry → short logic.
    Exception: explicit short direction from the classifier is NOT a mismatch.
    """
    # Explicit short direction from classifier = intentional, not a mismatch
    if analysis.get("_classifier_direction") == "short":
        return False
    from backend.news_checker import _parse_entry_mid, _parse_price
    entry_mid = _parse_entry_mid(analysis.get("entry_zone"))
    stop      = _parse_price(analysis.get("stop_loss"))
    if entry_mid and stop and stop > entry_mid:
        return True
    return False


def _classify_candidate(analysis: dict, ticker: str, module: Optional[str]) -> str:
    """
    Returns the candidate_status string for a newly analyzed candidate.
    Fix A (avoid) is checked here AND post deep-analysis for thorough coverage.
    """
    if not _has_full_setup(analysis):
        logger.info(
            "[Fix-B] %s → watchlist_pending (missing entry/stop/target) [module=%s]",
            ticker, module,
        )
        return "watchlist_pending"

    if _is_direction_mismatch(analysis):
        logger.info(
            "[Fix-C] %s → direction_mismatch (stop > entry in long module) [module=%s]",
            ticker, module,
        )
        return "direction_mismatch"

    # Fix A (early): initial analysis already says avoid → filter immediately
    if analysis.get("recommendation") == "avoid":
        logger.info(
            "[Fix-A-early] %s → filtered_avoid (initial recommendation=avoid) [module=%s]",
            ticker, module,
        )
        return "filtered_avoid"

    # Fix D: technicals invalidated by news/corporate-action → never show as active
    if not analysis.get("technical_setup_valid", True):
        logger.info(
            "[Fix-D] %s → filtered_avoid (technicals_invalid) [module=%s]",
            ticker, module,
        )
        return "filtered_avoid"

    return "active"


async def startup(ctx: dict):
    init_db()
    logger.info("ARQ worker started.")


# ---------------------------------------------------------------------------
# Ghost Portfolio helpers (1.7)
# ---------------------------------------------------------------------------

def _archive_scan_results(scan_date, regime: str) -> int:
    """
    Archive today's active + watchlist_pending scan results into
    prediction_archive for ML data collection.
    Deduplicates by ticker + scan_date — safe to call multiple times.
    Returns count of newly archived predictions.
    """
    from backend.database import get_results_for_date
    from backend.news_checker import _parse_entry_mid, _parse_price

    active_results   = get_results_for_date(scan_date)   # status=active only
    watchlist_results = get_watchlist_pending(scan_date)  # status=watchlist_pending
    all_results = active_results + watchlist_results

    already_archived = get_archived_tickers_for_date(scan_date)
    new_count = 0

    for r in all_results:
        if r.ticker in already_archived:
            continue

        entry_price  = _parse_entry_mid(r.entry_zone)
        stop_loss    = _parse_price(r.stop_loss)
        target_price = _parse_price(r.target)

        pred = PredictionArchive(
            scan_date       = scan_date,
            ticker          = r.ticker,
            regime          = regime,
            strategy_module = r.strategy_module or "unknown",
            candidate_status= r.candidate_status or "active",
            setup_type      = r.setup_type,
            entry_price     = entry_price,
            stop_loss       = stop_loss,
            target_price    = target_price,
            crv             = r.crv_calculated,
            confidence      = r.confidence,
        )
        archive_prediction(pred)
        already_archived.add(r.ticker)
        new_count += 1

    logger.info(
        "Ghost Portfolio: archived %d new predictions for %s (regime=%s)",
        new_count, scan_date, regime,
    )
    return new_count


# ---------------------------------------------------------------------------
# Individual cron jobs
# ---------------------------------------------------------------------------

async def market_regime_update(ctx: dict):
    """22:00 UTC — Update SPY market regime."""
    logger.info("=== market_regime_update ===")
    try:
        await update_market_regime()
    except Exception as exc:
        logger.error("Market regime update failed: %s", exc)


async def daily_scan(ctx: dict, progress_cb: Optional[Callable] = None):
    """22:15 UTC — Full scan pipeline."""
    logger.info("=== daily_scan started ===")
    scan_date = resolve_scan_date()
    logger.info("scan_date resolved to %s", scan_date)
    clear_results_for_date(scan_date)
    # Always ensure regime is fresh — never scan with stale/missing data
    regime = await ensure_regime_current(max_age_hours=12)

    try:
        candidates = await run_screener(progress_cb=progress_cb, regime=regime)
    except Exception as exc:
        logger.error("Screener failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    # Persist funnel to DB (for history + API)
    try:
        from backend.screener import get_last_funnel
        import json as _json
        f = get_last_funnel()
        r = f.get("rejections", {})
        funnel_row = ScanFunnel(
            scan_date=scan_date,
            regime=f.get("regime", regime),
            filter_profile=f.get("filter_profile"),
            universe_count=f.get("universe", 0),
            snapshot_count=f.get("snapshot", 0),
            pre_filter_count=f.get("pre_filter", 0),
            ohlcv_fetched=f.get("ohlcv_fetched", 0),
            ohlcv_failed=f.get("ohlcv_failed", 0),
            fail_insufficient_bars=r.get("insufficient_bars", 0),
            fail_nan_indicators=r.get("nan_indicators", 0),
            fail_price_range=r.get("price_range", 0),
            fail_volume_min=r.get("volume_min", 0),
            fail_sma50=r.get("sma50", 0),
            fail_sma20=r.get("sma20", 0),
            fail_rsi_range=r.get("rsi_range", 0),
            fail_rsi_bear=r.get("rsi_bear", 0),
            fail_volume_surge=r.get("volume_surge", 0),
            fail_error=r.get("error", 0),
            candidates_count=f.get("candidates", 0),
            filter_params_json=_json.dumps(f.get("filter_params", {})),
        )
        save_scan_funnel(funnel_row)
    except Exception as exc:
        logger.warning("Could not persist scan funnel: %s", exc)

    total_candidates = len(candidates)
    saved = 0
    failed = 0
    saved_results = []

    for i, candidate in enumerate(candidates):
        ticker = candidate["ticker"]
        df = candidate["df"]
        indicators = candidate["indicators"]

        if progress_cb:
            pct = 60 + int((i / max(total_candidates, 1)) * 20)
            progress_cb("charting", f"Rendering chart {ticker} ({i+1}/{total_candidates})",
                       i+1, total_candidates, saved, pct)

        try:
            chart_path = render_chart(ticker, df)
        except Exception as exc:
            logger.warning("Chart render failed for %s: %s", ticker, exc)
            failed += 1
            continue

        # News / corporate action / gap check
        news_check = {}
        try:
            news_check = await run_full_news_check(ticker, df)
        except Exception as exc:
            logger.warning("News check failed for %s: %s", ticker, exc)

        if progress_cb:
            pct = 80 + int((i / max(total_candidates, 1)) * 18)
            progress_cb("analyzing", f"Analyzing {ticker} with Claude ({i+1}/{total_candidates})",
                       i+1, total_candidates, saved, pct)

        try:
            analysis = analyze_chart(
                chart_path, ticker, indicators,
                news_check=news_check,
                module=candidate.get("strategy_module"),
                regime=regime,
            )
        except Exception as exc:
            logger.warning("Analysis failed for %s: %s", ticker, exc)
            failed += 1
            continue

        if analysis is None:
            continue

        # Build flags list
        flags = []
        if news_check.get("is_gap_up"):
            flags.append("gap_up")
        if news_check.get("is_gap_down"):
            flags.append("gap_down")
        if news_check.get("has_earnings_recent"):
            flags.append("post_earnings")
        if news_check.get("has_earnings_upcoming"):
            flags.append("pre_earnings")
        if news_check.get("has_corporate_action"):
            flags.append("corporate_action")
        if not analysis.get("crv_valid", True):
            flags.append("low_crv")
        if not analysis.get("technical_setup_valid", True):
            flags.append("technicals_invalid")

        import json as _json
        # Fix B + C: classify before saving
        module_name      = candidate.get("strategy_module")
        candidate_status = _classify_candidate(analysis, ticker, module_name)

        # 1.2 — CRV-adjusted composite score
        # Formula: confidence * clamp(crv / 2.0, 0.5, 1.5)
        # CRV=2.0 → neutral (1.0×), below → penalty, above → bonus
        _conf = analysis.get("confidence", 0)
        _crv  = analysis.get("crv_calculated")
        if _crv and _crv > 0:
            _factor = max(0.5, min(1.5, _crv / 2.0))
            _composite = round(_conf * _factor, 2)
        else:
            _composite = float(_conf)

        try:
            result = ScanResult(
                ticker=ticker,
                scan_date=scan_date,
                setup_type=analysis.get("setup_type", "none"),
                pattern_name=analysis.get("pattern_name"),
                confidence=analysis.get("confidence", 0),
                entry_zone=analysis.get("entry_zone"),
                stop_loss=analysis.get("stop_loss"),
                target=analysis.get("target"),
                risk_reward=analysis.get("risk_reward"),
                reasoning=analysis.get("reasoning"),
                chart_path=chart_path,
                # News fields
                flags=_json.dumps(flags) if flags else None,
                gap_pct=news_check.get("gap_pct"),
                has_earnings_recent=news_check.get("has_earnings_recent", False),
                has_earnings_upcoming=news_check.get("has_earnings_upcoming", False),
                has_corporate_action=news_check.get("has_corporate_action", False),
                news_headlines=news_check.get("news_headlines"),
                news_sentiment=news_check.get("news_sentiment"),
                news_warning=news_check.get("news_warning"),
                crv_calculated=analysis.get("crv_calculated"),
                crv_valid=analysis.get("crv_valid", True),
                technical_setup_valid=analysis.get("technical_setup_valid", True),
                invalidation_reason=analysis.get("invalidation_reason"),
                strategy_module=module_name,
                candidate_status=candidate_status,
                composite_score=_composite,
                extracted_facts_json=analysis.get("extracted_facts_json"),
                # v3.2 — Trigger-Preis: upper bound of entry zone
                trigger_price=_parse_entry_upper(analysis.get("entry_zone")),
                trigger_reached=False,
                # v4.0 — direction from classifier ("long" or "short")
                direction=analysis.get("_classifier_direction") or "long",
            )
            saved_result = save_scan_result(result)
            # Only queue for deep analysis if the candidate is active
            if candidate_status == "active":
                saved_results.append((saved_result, indicators, candidate.get("df")))
                # v4.0 — Push notification for new short signal
                if (analysis.get("_classifier_direction") == "short"
                        and analysis.get("crv_calculated")):
                    from backend.notifier import notify_short_signal
                    notify_short_signal(
                        ticker=ticker,
                        rsi=float(indicators.get("rsi14") or 0),
                        crv=float(analysis["crv_calculated"]),
                    )
            saved += 1
        except Exception as exc:
            logger.warning("DB save failed for %s: %s", ticker, exc)
            failed += 1

    # Deep analysis for top candidates
    if progress_cb:
        progress_cb("deep_analysis", "Running deep analysis for top candidates…",
                   total_candidates, total_candidates, saved, 98)

    try:
        await _run_deep_analysis(saved_results, regime)
    except Exception as exc:
        logger.error("Deep analysis batch failed: %s", exc)

    # Ghost Portfolio — archive for ML data collection
    try:
        archived = _archive_scan_results(scan_date, regime)
        logger.info("Ghost Portfolio: %d predictions archived", archived)
    except Exception as exc:
        logger.warning("Ghost Portfolio archiving failed: %s", exc)

    # Notify — pass full ScanResult objects sorted by composite_score for CRV info
    top_by_score = sorted(saved_results, key=lambda x: x[0].composite_score or 0, reverse=True)
    notify_scan_complete(saved, [r[0] for r in top_by_score[:3]], regime=regime)

    summary = {
        "status": "done",
        "scan_date": str(scan_date),
        "candidates_screened": total_candidates,
        "saved": saved,
        "failed": failed,
        "regime": regime,
    }
    logger.info("=== daily_scan complete: %s ===", summary)
    return summary


async def _run_deep_analysis(
    saved_results: list,
    regime: str,
):
    """Run deep analysis for top N candidates by confidence."""
    sorted_results = sorted(
        saved_results,
        key=lambda x: x[0].confidence,
        reverse=True,
    )
    top = [r for r in sorted_results if r[0].confidence >= settings.deep_analysis_threshold]
    top = top[:settings.deep_analysis_top_n]

    for saved_result, indicators, df in top:
        sr = saved_result
        try:
            analysis = deep_analyze(
                chart_path=sr.chart_path,
                ticker=sr.ticker,
                indicators=indicators,
                market_regime=regime,
                sector=sr.sector,
            )
            if analysis:
                update_deep_analysis(sr.id, analysis)
                # Fix A: deep analysis says "avoid" → demote to filtered_avoid
                if analysis.get("recommendation") == "avoid":
                    update_candidate_status(sr.id, "filtered_avoid")
                    logger.info(
                        "[Fix-A] %s → filtered_avoid (deep analysis score=%s)",
                        sr.ticker, analysis.get("overall_score"),
                    )
                else:
                    logger.info(
                        "Deep analysis saved for %s (score=%s rec=%s)",
                        sr.ticker, analysis.get("overall_score"),
                        analysis.get("recommendation"),
                    )
        except Exception as exc:
            logger.warning("Deep analysis failed for %s: %s", sr.ticker, exc)


async def portfolio_signal_check(ctx: dict):
    """22:30 UTC — Check open positions for sell signals + candidate trigger prices."""
    logger.info("=== portfolio_signal_check ===")
    try:
        new_signals = await run_portfolio_signal_check()
        for sig in new_signals:
            notify_sell_signal(sig.ticker, sig.signal_type, sig.description, sig.severity)
        logger.info("Portfolio signal check: %d new signals", len(new_signals))
    except Exception as exc:
        logger.error("Portfolio signal check failed: %s", exc)

    # v3.2 — Trigger-Preis check (runs alongside portfolio signals)
    try:
        triggered = await check_candidate_triggers()
        logger.info("Trigger check: %d triggers fired", len(triggered))
    except Exception as exc:
        logger.error("Trigger check failed: %s", exc)


async def watchlist_check(ctx: dict):
    """22:35 UTC — Check watchlist alert conditions."""
    logger.info("=== watchlist_check ===")
    try:
        triggered = await check_watchlist_alerts()
        for item in triggered:
            notify_watchlist_alert(item.ticker, item.alert_condition, 0)
        logger.info("Watchlist check: %d alerts triggered", len(triggered))
    except Exception as exc:
        logger.error("Watchlist check failed: %s", exc)


async def performance_update(ctx: dict):
    """22:45 UTC — Update performance tracking."""
    logger.info("=== performance_update ===")
    try:
        update_performance_tracking()
    except Exception as exc:
        logger.error("Performance update failed: %s", exc)


async def market_update_auto(ctx: dict):
    """22:50 UTC — Generate automated daily market update for open positions."""
    logger.info("=== market_update_auto ===")
    try:
        from backend.market_update import get_market_context, generate_market_update
        from backend.database import get_open_positions
        from backend.portfolio import enrich_position
        from backend.notifier import (
            notify_market_update_critical,
            notify_market_update_warning,
        )
        import json as _json

        context = get_market_context()
        open_positions = get_open_positions()

        if not open_positions:
            logger.info("No open positions — skipping market update")
            return

        positions_data = []
        for pos in open_positions:
            enriched = enrich_position(pos)
            positions_data.append({
                "ticker": pos.ticker,
                "trade_type": pos.trade_type or "swing",
                "entry": pos.entry_price,
                "current": enriched.get("current_price", pos.entry_price),
                "stop_loss": pos.stop_loss,
                "target_1": pos.target_1,
                "target_2": pos.target_2,
                "pnl_pct": enriched.get("unrealized_pct", 0),
                "days_held": enriched.get("days_in_trade", 0),
                "sector": pos.sector,
                "hold_days_max": pos.hold_days_max,
            })

        update = await generate_market_update(positions_data, context, update_type="auto")

        # Send notifications based on level
        if update.notification_level == "critical" and update.critical_alerts_json:
            alerts = _json.loads(update.critical_alerts_json)
            for alert in alerts:
                spy_change = context.get("spy_change_pct") or 0
                notify_market_update_critical(
                    ticker=alert.get("ticker", ""),
                    alert_msg=alert.get("alert", ""),
                    market_change=spy_change,
                )
        elif update.notification_level == "warning":
            spy_change = context.get("spy_change_pct") or 0
            positions_count = len(open_positions)
            notify_market_update_warning(positions_count, spy_change)

        from backend.database import update_market_update_notified
        update_market_update_notified(update.id)

        logger.info("Market update complete: level=%s action=%s",
                    update.notification_level, update.overall_action)
    except Exception as exc:
        logger.error("Market update auto failed: %s", exc)


async def ghost_portfolio_resolve(ctx: dict):
    """
    22:20 UTC — Resolve pending Ghost Portfolio predictions against EOD data.

    Resolution rules (in order):
      1. TIMEOUT  — scan_date is >= 14 days ago (regardless of stop/target)
      2. Direction-aware LOSS/WIN:
         LONG  (stop_loss < entry_price): LOSS if daily_low  <= stop_loss
                                          WIN  if daily_high >= target_price
         SHORT (stop_loss > entry_price): LOSS if daily_high >= stop_loss
                                          WIN  if daily_low  <= target_price
      3. Skip     — no stop AND no target (watchlist_pending without setup)

    Only resolves predictions that are at least 1 day old (entry happens
    the day AFTER the scan, so day-0 data is irrelevant).
    """
    logger.info("=== ghost_portfolio_resolve ===")
    from backend.providers import get_data_provider

    pending  = get_pending_predictions()
    today    = date.today()
    provider = get_data_provider()
    resolved = 0
    skipped  = 0

    for pred in pending:
        days_open = (today - pred.scan_date).days

        # Must be at least 1 day old — entry happens next day after scan
        if days_open < 1:
            skipped += 1
            continue

        # Rule 1: TIMEOUT
        if days_open >= 14:
            resolve_prediction(
                pred.id, "TIMEOUT",
                notes=f"expired after {days_open} days without hitting stop or target",
            )
            resolved += 1
            logger.info("Ghost [TIMEOUT] %s (day %d)", pred.ticker, days_open)
            continue

        # Rules 2+3: need EOD data — only if stop or target is set
        if not pred.stop_loss and not pred.target_price:
            skipped += 1
            continue

        try:
            df = await provider.get_daily_bars(pred.ticker, days=3)
            if df is None or df.empty:
                skipped += 1
                continue

            latest     = df.iloc[-1]
            daily_high = float(latest["High"])
            daily_low  = float(latest["Low"])

            # Determine direction: SHORT if stop > entry.
            # Fallback to target < entry for watchlist items without stop-loss.
            is_short = False
            if pred.entry_price is not None:
                if pred.stop_loss is not None:
                    is_short = pred.stop_loss > pred.entry_price
                elif pred.target_price is not None:
                    is_short = pred.target_price < pred.entry_price

            if is_short:
                loss_hit = pred.stop_loss is not None and daily_high >= pred.stop_loss
                win_hit  = pred.target_price is not None and daily_low  <= pred.target_price
            else:
                loss_hit = pred.stop_loss is not None and daily_low  <= pred.stop_loss
                win_hit  = pred.target_price is not None and daily_high >= pred.target_price

            if loss_hit:
                resolved_price = daily_low if not is_short else daily_high
                resolve_prediction(
                    pred.id, "LOSS",
                    resolved_price=resolved_price,
                    notes=f"stop {pred.stop_loss:.2f} hit ({'high' if is_short else 'low'}={resolved_price:.2f})",
                )
                resolved += 1
                logger.info("Ghost [LOSS] %s (%s) — stop %.2f hit",
                            pred.ticker, "short" if is_short else "long", pred.stop_loss)

            elif win_hit:
                resolved_price = daily_high if not is_short else daily_low
                resolve_prediction(
                    pred.id, "WIN",
                    resolved_price=resolved_price,
                    notes=f"target {pred.target_price:.2f} hit ({'low' if is_short else 'high'}={resolved_price:.2f})",
                )
                resolved += 1
                logger.info("Ghost [WIN] %s (%s) — target %.2f hit",
                            pred.ticker, "short" if is_short else "long", pred.target_price)

        except Exception as exc:
            logger.warning("Ghost resolve failed for %s: %s", pred.ticker, exc)
            skipped += 1

    logger.info(
        "Ghost Portfolio resolve: %d resolved, %d skipped (of %d pending)",
        resolved, skipped, len(pending),
    )


async def daily_summary_notification(ctx: dict):
    """22:55 UTC — Send daily summary push + email (includes market update)."""
    logger.info("=== daily_summary_notification ===")
    try:
        from backend.database import (
            get_results_for_date,
            get_latest_scan_date,
            get_unnotified_signals,
            get_latest_market_update,
            was_summary_notified,
            set_summary_notified,
        )
        from backend.market_regime import get_current_regime

        regime = get_current_regime()

        # Use latest scan_date — post-market scans save scan_date = next trading day,
        # so date.today() would return 0 results for the just-completed scan.
        scan_date = get_latest_scan_date() or date.today()

        # Dedup: skip push + email if already sent for this scan_date
        # (e.g. on weekends get_latest_scan_date() keeps returning the same Friday scan_date).
        if was_summary_notified(scan_date):
            logger.info("Daily summary already sent for %s — skipping", scan_date)
            return

        all_results = get_results_for_date(scan_date)
        active_results = [r for r in all_results if r.candidate_status == "active"]

        notify_daily_summary(scan_date=scan_date, active_results=active_results, regime=regime)
        set_summary_notified(scan_date)

        signals = get_unnotified_signals()
        active_signals = [s.model_dump() for s in signals]
        market_update = get_latest_market_update()

        send_daily_summary_email(
            regime=regime,
            top_candidates=[r.model_dump() for r in active_results[:3]],
            active_signals=active_signals,
            watchlist_alerts=[],
            market_update=market_update.model_dump() if market_update else None,
        )
    except Exception as exc:
        logger.error("Daily summary failed: %s", exc)


# ---------------------------------------------------------------------------
# Entry-Zone Check — hourly during US market hours (14–20 UTC)
# ---------------------------------------------------------------------------

async def auto_paper_trade(ctx: dict):
    """
    15:35 UTC — Automatically place bracket orders for today's active candidates
    on the Paper Alpaca account. All 4 safety limits MUST pass before any order
    is placed:
      1. Only Paper account  (is_paper guard)
      2. Feature flag PAPER_AUTO_TRADING must be enabled
      3. Max 3 concurrent open auto-trades
      4. Max 5 % of account buying-power per trade
    """
    logger.info("=== auto_paper_trade started ===")
    from decimal import Decimal, ROUND_DOWN

    from backend.database import (
        get_paper_auto_trading,
        count_active_auto_trades,
        get_results_for_date,
        get_all_broker_connections,
        save_trade_plan,
        TradePlan,
    )
    from backend.brokers import get_connector
    from backend.notifier import (
        notify_auto_trade_success,
        notify_auto_trade_error,
        notify_auto_trade_summary,
        send_push,
    )
    from backend.news_checker import _parse_entry_mid, _parse_price

    # ── Safety Limit 2: Feature flag ────────────────────────────────────────
    if not get_paper_auto_trading():
        logger.info("auto_paper_trade: PAPER_AUTO_TRADING disabled — skipping")
        return

    today = date.today()
    candidates = [r for r in get_results_for_date(today) if r.candidate_status == "active"]
    if not candidates:
        logger.info("auto_paper_trade: no active candidates for %s", today)
        return

    # Find the active Alpaca Paper broker connection (tenant 1)
    connections = get_all_broker_connections(tenant_id=1)
    alpaca_conn = next(
        (c for c in connections if c.broker_type == "alpaca" and c.is_paper), None
    )
    if alpaca_conn is None:
        logger.warning("auto_paper_trade: no active Alpaca Paper connection found — aborting")
        send_push(
            title="⚠️ Auto-Trading abgebrochen",
            message="Kein Alpaca Paper-Konto konfiguriert.",
            priority="high",
            tags="warning",
        )
        return

    # ── Safety Limit 1: Hard Paper guard ────────────────────────────────────
    if not alpaca_conn.is_paper:
        logger.error("auto_paper_trade: HARD GUARD — is_paper=False, aborting immediately")
        send_push(
            title="🚨 Auto-Trading BLOCKED",
            message="Hard Guard: Kein Live-Konto für Auto-Trading erlaubt!",
            priority="urgent",
            tags="rotating_light",
        )
        return

    connector = get_connector(alpaca_conn.model_dump())

    # Fetch account balance
    try:
        balance_info = connector.get_balance()
        buying_power = Decimal(str(balance_info.get("buying_power") or 0))
    except Exception as exc:
        logger.error("auto_paper_trade: failed to fetch balance: %s", exc)
        return

    if buying_power <= 0:
        logger.info("auto_paper_trade: no buying power available")
        return

    # ── Safety Limit 3: Max 3 concurrent open auto-trades ───────────────────
    existing_count = count_active_auto_trades(tenant_id=1)
    slots_available = max(0, 3 - existing_count)
    if slots_available <= 0:
        logger.info("auto_paper_trade: max 3 auto-trades already open — skipping")
        send_push(
            title="📊 Auto-Trading: Limit erreicht",
            message="Bereits 3 offene Auto-Trades — keine neuen Trades heute.",
            priority="default",
            tags="robot",
        )
        return

    n_placed = 0
    total_risk = Decimal("0")

    for candidate in candidates[:slots_available]:
        ticker = candidate.ticker
        direction = candidate.direction or "long"

        # Parse entry, stop, target (Decimal — no float for financial values)
        entry_mid = _parse_entry_mid(candidate.entry_zone)
        stop_raw  = _parse_price(candidate.stop_loss)
        target_raw = _parse_price(candidate.target)

        if not entry_mid or not stop_raw or not target_raw:
            logger.info("auto_paper_trade: %s skipped — missing entry/stop/target", ticker)
            continue

        entry_dec  = Decimal(str(entry_mid))
        stop_dec   = Decimal(str(stop_raw))
        target_dec = Decimal(str(target_raw))

        # Derive entry zone bounds from the raw string or use mid ±1 tick
        import re as _re
        zone_nums = [Decimal(x) for x in _re.findall(r"[\d.]+", str(candidate.entry_zone or ""))]
        entry_low  = min(zone_nums) if len(zone_nums) >= 2 else entry_dec * Decimal("0.995")
        entry_high = max(zone_nums) if len(zone_nums) >= 2 else entry_dec * Decimal("1.005")

        risk_per_share = abs(entry_dec - stop_dec)
        if risk_per_share <= 0:
            logger.info("auto_paper_trade: %s skipped — zero risk_per_share", ticker)
            continue

        # ── Safety Limit 4: Max 5 % of account buying-power per trade ───────
        max_risk_amount = buying_power * Decimal("0.05")
        qty = int((max_risk_amount / risk_per_share).to_integral_value(rounding=ROUND_DOWN))
        if qty < 1:
            logger.info(
                "auto_paper_trade: %s skipped — qty=0 (risk/share=%.2f, max_risk=%.2f)",
                ticker, float(risk_per_share), float(max_risk_amount),
            )
            continue

        # ── PDT Protection: skip if same-day would close immediately ─────────
        # We place bracket orders that only close on stop or target — not same-day.
        # Bracket orders are multi-day by default; PDT applies to same-day round-trips.
        # Guard: if existing open position in same ticker, skip to avoid inadvertent PDT.
        try:
            positions = connector.get_portfolio()
            if any(p.get("ticker") == ticker for p in positions):
                logger.info("auto_paper_trade: %s skipped — existing open position (PDT guard)", ticker)
                continue
        except Exception as exc:
            logger.warning("auto_paper_trade: portfolio fetch failed for PDT check: %s", exc)

        plan_dict = {
            "ticker":     ticker,
            "entry_high": float(entry_high),
            "stop_loss":  float(stop_dec),
            "target":     float(target_dec),
            "qty":        qty,
            "direction":  direction,
        }

        try:
            order_result = connector.place_order(plan_dict)

            # Persist as TradePlan with auto_trade=True
            trade_plan = TradePlan(
                ticker=ticker,
                scan_result_id=candidate.id,
                entry_low=float(entry_low),
                entry_high=float(entry_high),
                stop_loss=float(stop_dec),
                target=float(target_dec),
                direction=direction,
                risk_pct=Decimal("5.0"),
                broker_ids_json=f"[{alpaca_conn.id}]",
                execution_state_json=f'{{"{alpaca_conn.id}": "executed"}}',
                status="active",
                strategy_module=candidate.strategy_module,
                setup_type=candidate.setup_type,
                auto_trade=True,
            )
            save_trade_plan(trade_plan)

            fill_price = float(order_result.get("limit_price") or entry_high)
            trade_risk = risk_per_share * qty
            total_risk += trade_risk
            n_placed   += 1

            notify_auto_trade_success(
                ticker=ticker,
                direction=direction,
                qty=qty,
                price=fill_price,
            )
            logger.info(
                "auto_paper_trade: placed %s %s qty=%d @ %.2f",
                direction, ticker, qty, fill_price,
            )

        except Exception as exc:
            notify_auto_trade_error(ticker, str(exc))
            logger.error("auto_paper_trade: order failed for %s: %s", ticker, exc)

    # Summary notification
    if n_placed > 0:
        notify_auto_trade_summary(n_placed, float(total_risk))

    logger.info(
        "=== auto_paper_trade done: %d placed, total_risk=%.2f ===",
        n_placed, float(total_risk),
    )


async def entry_zone_check(ctx: dict):
    """
    Check all pending TradePlans against live prices.
    Sends a push-alert (once per day per ticker) when price enters the entry zone.
    Runs hourly 14:00–20:00 UTC (09:00–15:00 ET).
    """
    logger.info("=== entry_zone_check ===")
    try:
        from backend.database import get_active_trade_plans, get_ntfy_alerts
        from backend.notifier import notify_entry_zone
        from backend.providers import get_data_provider

        if not get_ntfy_alerts().get("alerts_entry_zone", True):
            logger.debug("entry_zone alerts disabled — skipping")
            return

        plans = get_active_trade_plans()
        if not plans:
            logger.debug("No active trade plans — skipping entry zone check")
            return

        tickers = list({p.ticker for p in plans})
        provider = get_data_provider()

        # Fetch last bar for each ticker
        prices: dict[str, float] = {}
        for ticker in tickers:
            try:
                df = await provider.get_daily_bars(ticker, days=3)
                if df is not None and not df.empty:
                    prices[ticker] = float(df.iloc[-1]["Close"])
            except Exception as exc:
                logger.warning("Price fetch failed for %s: %s", ticker, exc)

        for plan in plans:
            price = prices.get(plan.ticker)
            if price is None:
                continue
            if plan.entry_low <= price <= plan.entry_high:
                # Fetch CRV from scan result if available
                crv = None
                if plan.scan_result_id:
                    from backend.database import get_result_by_ticker
                    sr = get_result_by_ticker(plan.ticker)
                    if sr:
                        crv = sr.crv_calculated

                notify_entry_zone(
                    ticker=plan.ticker,
                    price=price,
                    entry_low=plan.entry_low,
                    entry_high=plan.entry_high,
                    setup_type=plan.setup_type or "",
                    crv=crv,
                )
                logger.info("Entry-zone alert sent for %s @ $%.2f", plan.ticker, price)

    except Exception as exc:
        logger.error("entry_zone_check failed: %s", exc)


# ---------------------------------------------------------------------------
# Scan Health Check — 23:30 UTC (optional ntfy alert if scan missed)
# ---------------------------------------------------------------------------

async def check_scan_health(ctx: dict):
    """23:30 UTC — Alert via ntfy if daily scan did not run today."""
    logger.info("=== check_scan_health ===")
    try:
        now_utc = datetime.now(timezone.utc)
        row = get_last_scan_datetime()
        if row is None:
            last_scan_label = "unbekannt"
            scan_ran_today = False
        else:
            _last_scan_date, last_scan_created_at = row
            if last_scan_created_at is None:
                scan_ran_today = False
                last_scan_label = str(_last_scan_date)
            else:
                if last_scan_created_at.tzinfo is None:
                    last_scan_created_at = last_scan_created_at.replace(tzinfo=timezone.utc)
                else:
                    last_scan_created_at = last_scan_created_at.astimezone(timezone.utc)
                scan_ran_today = last_scan_created_at.date() == now_utc.date()
                last_scan_label = last_scan_created_at.isoformat()

        if not scan_ran_today:
            await asyncio.to_thread(
                send_push,
                title="🚨 Scan ausgefallen!",
                message=f"Letzter Scan: {last_scan_label}",
                priority="urgent",
                tags="rotating_light",
            )
            logger.warning("check_scan_health: scan missing, ntfy sent (last=%s)", last_scan_label)
        else:
            logger.info("check_scan_health: scan ran today, all good")
    except Exception as exc:
        logger.error("check_scan_health failed: %s", exc)


# ---------------------------------------------------------------------------
# Standalone runner (for manual trigger from FastAPI)
# ---------------------------------------------------------------------------

async def run_scan(progress_cb: Optional[Callable] = None):
    """Standalone callable for manual trigger from FastAPI."""
    return await daily_scan({}, progress_cb=progress_cb)


# ---------------------------------------------------------------------------
# Worker settings
# ---------------------------------------------------------------------------

def _parse_scan_time() -> tuple[int, int]:
    try:
        h, m = settings.scan_time_utc.split(":")
        return int(h), int(m)
    except Exception:
        return 22, 15


_hour, _minute = _parse_scan_time()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [
        daily_scan,
        market_regime_update,
        ghost_portfolio_resolve,
        portfolio_signal_check,
        watchlist_check,
        performance_update,
        market_update_auto,
        daily_summary_notification,
        entry_zone_check,
        check_scan_health,
        auto_paper_trade,
    ]
    cron_jobs = [
        cron(market_regime_update, hour={22}, minute={0}, run_at_startup=False),
        cron(daily_scan, hour={_hour}, minute={_minute}, run_at_startup=False),
        cron(ghost_portfolio_resolve, hour={22}, minute={20}, run_at_startup=False),
        cron(portfolio_signal_check, hour={22}, minute={30}, run_at_startup=False),
        cron(watchlist_check, hour={22}, minute={35}, run_at_startup=False),
        cron(performance_update, hour={22}, minute={45}, run_at_startup=False),
        cron(market_update_auto, hour={22}, minute={50}, run_at_startup=False),
        cron(daily_summary_notification, hour={22}, minute={55}, run_at_startup=False),
        cron(check_scan_health, hour={23}, minute={30}, run_at_startup=False),
        # Entry-zone check: hourly 14–20 UTC (09:00–15:00 ET, while market is open)
        cron(entry_zone_check, hour={14, 15, 16, 17, 18, 19, 20}, minute={0}, run_at_startup=False),
        # Phase 3 — Auto Paper Trade: 15:35 UTC (25 min before market close)
        cron(auto_paper_trade, hour={15}, minute={35}, run_at_startup=False),
    ]
    on_startup = startup
    max_jobs = 1
    job_timeout = 3600
