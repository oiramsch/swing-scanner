"""
ARQ worker + cron job definitions.
Daily pipeline: regime → screener → charting → analysis → deep analysis →
portfolio signals → watchlist → performance → daily summary
"""
import logging
from datetime import date
from typing import Callable, Optional

from arq import cron
from arq.connections import RedisSettings

from backend.analyzer import analyze_chart
from backend.chart_fetcher import render_chart
from backend.config import settings
from backend.database import (
    ScanFunnel,
    ScanResult,
    clear_results_for_date,
    init_db,
    save_scan_funnel,
    save_scan_result,
    update_deep_analysis,
)
from backend.deep_analyzer import deep_analyze
from backend.market_regime import ensure_regime_current, get_current_regime, update_market_regime
from backend.news_checker import run_full_news_check
from backend.notifier import (
    notify_scan_complete,
    notify_sell_signal,
    notify_watchlist_alert,
    send_daily_summary_email,
)
from backend.performance import update_performance_tracking
from backend.screener import run_screener
from backend.signal_checker import run_portfolio_signal_check
from backend.watchlist import check_watchlist_alerts

logger = logging.getLogger(__name__)


async def startup(ctx: dict):
    init_db()
    logger.info("ARQ worker started.")


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
    scan_date = date.today()
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
            analysis = analyze_chart(chart_path, ticker, indicators, news_check=news_check)
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
                strategy_module=candidate.get("strategy_module"),
            )
            saved_result = save_scan_result(result)
            saved_results.append((saved_result, indicators, candidate.get("df")))
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

    # Notify
    top_tickers = [r[0].ticker for r in saved_results[:3]]
    notify_scan_complete(saved, top_tickers)

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
                logger.info("Deep analysis saved for %s", sr.ticker)
        except Exception as exc:
            logger.warning("Deep analysis failed for %s: %s", sr.ticker, exc)


async def portfolio_signal_check(ctx: dict):
    """22:30 UTC — Check open positions for sell signals."""
    logger.info("=== portfolio_signal_check ===")
    try:
        new_signals = await run_portfolio_signal_check()
        for sig in new_signals:
            notify_sell_signal(sig.ticker, sig.signal_type, sig.description, sig.severity)
        logger.info("Portfolio signal check: %d new signals", len(new_signals))
    except Exception as exc:
        logger.error("Portfolio signal check failed: %s", exc)


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
        await update_performance_tracking()
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

        context = await get_market_context()
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


async def daily_summary_notification(ctx: dict):
    """22:55 UTC — Send daily summary email + push (includes market update)."""
    logger.info("=== daily_summary_notification ===")
    try:
        from backend.database import (
            get_results_for_date,
            get_unnotified_signals,
            get_latest_market_update,
        )
        from backend.market_regime import get_current_regime

        regime = get_current_regime()
        today_results = get_results_for_date(date.today())
        top_candidates = [r.model_dump() for r in today_results[:3]]

        signals = get_unnotified_signals()
        active_signals = [s.model_dump() for s in signals]

        market_update = get_latest_market_update()

        send_daily_summary_email(
            regime=regime,
            top_candidates=top_candidates,
            active_signals=active_signals,
            watchlist_alerts=[],
            market_update=market_update.model_dump() if market_update else None,
        )
    except Exception as exc:
        logger.error("Daily summary failed: %s", exc)


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
        portfolio_signal_check,
        watchlist_check,
        performance_update,
        market_update_auto,
        daily_summary_notification,
    ]
    cron_jobs = [
        cron(market_regime_update, hour={22}, minute={0}, run_at_startup=False),
        cron(daily_scan, hour={_hour}, minute={_minute}, run_at_startup=False),
        cron(portfolio_signal_check, hour={22}, minute={30}, run_at_startup=False),
        cron(watchlist_check, hour={22}, minute={35}, run_at_startup=False),
        cron(performance_update, hour={22}, minute={45}, run_at_startup=False),
        cron(market_update_auto, hour={22}, minute={50}, run_at_startup=False),
        cron(daily_summary_notification, hour={22}, minute={55}, run_at_startup=False),
    ]
    on_startup = startup
    max_jobs = 1
    job_timeout = 3600
