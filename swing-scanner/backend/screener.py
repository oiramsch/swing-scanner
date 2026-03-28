"""
Stock screener — provider-agnostic.

Data access goes exclusively through the DataProvider interface.
Switch the data source by setting DATA_PROVIDER in .env (yfinance | alpaca).

Pipeline:
  1. get_symbols()   → S&P 500 (or configured universe)
  2. get_snapshot()  → latest close + volume for all symbols (one batch call)
  3. pre_filter      → keep only symbols that pass price/volume threshold
  4. get_daily_bars() → per-ticker OHLCV for pre-filtered candidates
  5. compute_indicators → SMA20/50, EMA9, RSI14, ATR14, VolMA20
  6. passes_filter   → full technical filter (RSI range, SMA position, volume surge)
  7. return list[{ticker, df, indicators}]

Live portfolio quotes (bid/ask for P&L) still use Alpaca directly via
alpaca_provider.fetch_latest_quote() — that is intentionally NOT routed
through the DataProvider interface.
"""
import asyncio
import logging
from datetime import date, datetime
from typing import Callable, Optional

import pandas as pd
import ta as ta_lib

from backend.config import settings
from backend.database import (
    FilterProfile,
    StrategyModule,
    get_active_filter,
    get_active_universes,
    get_modules_for_regime,
)
from backend.providers import get_data_provider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level funnel state (populated after every run_screener() call)
# ---------------------------------------------------------------------------
_last_funnel: dict = {}


def get_last_funnel() -> dict:
    """Return a copy of the last scan funnel (populated by run_screener)."""
    return _last_funnel.copy()

# ── Re-exports for backwards compatibility ───────────────────────────────────
# Other modules (watchlist, signal_checker, main) still import these by name.
from backend.providers.alpaca_provider import fetch_latest_quote  # noqa: F401


async def fetch_ohlcv(ticker: str, days: int = 60):
    """Compatibility shim — routes through the configured DataProvider."""
    return await get_data_provider().get_daily_bars(ticker, days=days)


# ---------------------------------------------------------------------------
# Indicator computation
# ---------------------------------------------------------------------------

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["SMA_5"]   = ta_lib.trend.sma_indicator(df["Close"], window=5)   # Connors RSI-2 exit target
    df["SMA_20"]  = ta_lib.trend.sma_indicator(df["Close"], window=20)
    df["SMA_50"]  = ta_lib.trend.sma_indicator(df["Close"], window=50)
    df["SMA_200"] = ta_lib.trend.sma_indicator(df["Close"], window=200)
    df["EMA_9"]   = ta_lib.trend.ema_indicator(df["Close"], window=9)
    df["RSI_14"]  = ta_lib.momentum.rsi(df["Close"], window=14)
    df["RSI_2"]   = ta_lib.momentum.rsi(df["Close"], window=2)           # Connors RSI-2 signal
    df["ATRr_14"] = ta_lib.volatility.average_true_range(
        df["High"], df["Low"], df["Close"], window=14
    )
    df["Vol_MA20"] = df["Volume"].rolling(window=20).mean()
    return df


def get_indicator_snapshot(df: pd.DataFrame) -> dict:
    latest = df.iloc[-1]
    return {
        "close":    round(float(latest["Close"]), 2),
        "volume":   int(latest["Volume"]),
        "sma5":     round(float(latest.get("SMA_5")   or 0), 2),
        "sma20":    round(float(latest.get("SMA_20")  or 0), 2),
        "sma50":    round(float(latest.get("SMA_50")  or 0), 2),
        "sma200":   round(float(latest.get("SMA_200") or 0), 2),
        "ema9":     round(float(latest.get("EMA_9")   or 0), 2),
        "rsi14":    round(float(latest.get("RSI_14")  or 0), 2),
        "rsi2":     round(float(latest.get("RSI_2")   or 0), 2),
        "atr14":    round(float(latest.get("ATRr_14") or 0), 2),
        "vol_ma20": round(float(latest.get("Vol_MA20") or 0), 2),
    }


# ---------------------------------------------------------------------------
# Filter logic
# ---------------------------------------------------------------------------

def _get_filter_params(source) -> dict:
    """
    Build a filter params dict from a FilterProfile, StrategyModule, or None.
    StrategyModule can have nullable booleans (None = skip that filter).
    """
    if source is None:
        return {
            "price_min":          settings.min_price,
            "price_max":          9_999.0,
            "avg_volume_min":     settings.min_volume,
            "rsi_min":            settings.min_rsi,
            "rsi_max":            settings.max_rsi,
            "price_above_sma50":  True,
            "price_above_sma20":  False,
            "close_above_sma200": None,
            "rsi_bear_cap":       60.0,
            "volume_multiplier":  settings.volume_multiplier,
            "relative_strength_vs_spy": False,
        }
    if isinstance(source, StrategyModule):
        return {
            "price_min":          source.price_min,
            "price_max":          source.price_max,
            "avg_volume_min":     source.avg_volume_min,
            "rsi_min":            source.rsi_min,
            "rsi_max":            source.rsi_max,
            "price_above_sma50":  source.price_above_sma50,   # may be None
            "price_above_sma20":  source.price_above_sma20,   # may be None
            "close_above_sma200": source.close_above_sma200,  # may be None
            "rsi_bear_cap":       source.rsi_bear_cap,         # may be None → use module's rsi_max
            "volume_multiplier":  source.volume_multiplier,
            "relative_strength_vs_spy": source.relative_strength_vs_spy,
            "rsi2_max":           getattr(source, "rsi2_max", None),          # Connors RSI-2
            "close_below_sma5":   getattr(source, "close_below_sma5", None),  # Connors RSI-2
        }
    # FilterProfile (legacy)
    return {
        "price_min":          source.price_min,
        "price_max":          source.price_max,
        "avg_volume_min":     source.avg_volume_min,
        "rsi_min":            source.rsi_min,
        "rsi_max":            source.rsi_max,
        "price_above_sma50":  source.price_above_sma50,
        "price_above_sma20":  source.price_above_sma20,
        "close_above_sma200": None,
        "rsi_bear_cap":       60.0,
        "volume_multiplier":  getattr(source, "volume_multiplier", settings.volume_multiplier),
        "relative_strength_vs_spy": False,
    }


def _filter_reason(
    df: pd.DataFrame,
    params: dict,
    regime: str = "neutral",
    spy_20d_return: Optional[float] = None,
) -> Optional[str]:
    """
    Returns the rejection reason string if the ticker fails any filter,
    or None if it passes all filters.

    Reasons:
      insufficient_bars    — less than 51 OHLCV rows
      nan_indicators       — SMA50 or RSI14 not yet computed
      price_range          — price outside [price_min, price_max]
      volume_min           — snapshot volume below avg_volume_min
      sma50                — close <= SMA50 (when price_above_sma50=True)
      sma20                — close <= SMA20 (when price_above_sma20=True)
      sma200               — close <= SMA200 (when close_above_sma200=True)
      rsi_range            — RSI outside [rsi_min, rsi_max]
      rsi_bear             — RSI above bear cap (default 60 in bear regime)
      volume_surge         — volume < volume_multiplier × 20d avg
      relative_strength    — ticker 20d return < SPY 20d return
    """
    if df is None or len(df) < 51:
        return "insufficient_bars"

    latest = df.iloc[-1]
    close  = float(latest["Close"])
    volume = float(latest["Volume"])

    sma50_val = latest.get("SMA_50")
    rsi_val   = latest.get("RSI_14")
    if pd.isna(sma50_val) or pd.isna(rsi_val):
        return "nan_indicators"

    if close < params["price_min"] or close > params["price_max"]:
        return "price_range"
    if volume < params["avg_volume_min"]:
        return "volume_min"

    # SMA filters — None means "skip"
    if params.get("price_above_sma50") is True and close <= float(sma50_val):
        return "sma50"
    if params.get("price_above_sma20") is True and close <= float(latest.get("SMA_20") or 0):
        return "sma20"
    if params.get("close_above_sma200") is True:
        sma200 = latest.get("SMA_200")
        if sma200 is not None and not pd.isna(sma200) and close <= float(sma200):
            return "sma200"

    rsi = float(rsi_val)
    if not (params["rsi_min"] <= rsi <= params["rsi_max"]):
        return "rsi_range"

    # Bear-regime RSI cap: use module's rsi_bear_cap if set, else 60 default
    if regime == "bear":
        bear_cap = params.get("rsi_bear_cap") or 60.0
        if rsi > bear_cap:
            return "rsi_bear"

    avg_vol = float(df["Volume"].iloc[-20:-1].mean())
    if volume < avg_vol * params["volume_multiplier"]:
        return "volume_surge"

    # Relative strength vs SPY (only if module requires it)
    if params.get("relative_strength_vs_spy") and spy_20d_return is not None:
        if len(df) >= 21:
            ticker_20d_return = (close - float(df["Close"].iloc[-21])) / float(df["Close"].iloc[-21])
            if ticker_20d_return <= spy_20d_return:
                return "relative_strength"

    # Connors RSI-2: price must be below SMA5 (short-term pullback)
    if params.get("close_below_sma5") is True:
        sma5 = latest.get("SMA_5")
        if sma5 is not None and not pd.isna(sma5) and float(sma5) > 0:
            if close >= float(sma5):
                return "close_above_sma5"

    # Connors RSI-2: RSI(2) must be below threshold (extreme oversold)
    if params.get("rsi2_max") is not None:
        rsi2_val = latest.get("RSI_2")
        if rsi2_val is not None and not pd.isna(rsi2_val):
            if float(rsi2_val) > params["rsi2_max"]:
                return "rsi2_range"

    return None  # passes all filters


def passes_filter(
    df: pd.DataFrame,
    params: dict,
    regime: str = "neutral",
    spy_20d_return: Optional[float] = None,
) -> bool:
    """Thin wrapper kept for backward compatibility."""
    return _filter_reason(df, params, regime, spy_20d_return) is None


def _near_miss_check(df: pd.DataFrame, params: dict, reason: str, ticker: str) -> Optional[dict]:
    """
    Returns a near-miss dict if the ticker just barely failed a quantitative filter.
    Thresholds: RSI ±5 pts, volume within 20%, SMA within 2%.
    """
    NEAR_MISS_REASONS = {"rsi_range", "volume_surge", "sma50", "sma200", "rsi2_range"}
    if reason not in NEAR_MISS_REASONS:
        return None
    latest = df.iloc[-1]
    close = float(latest["Close"])
    try:
        if reason == "rsi_range":
            rsi = float(latest.get("RSI_14") or 0)
            if rsi < params["rsi_min"]:
                gap = params["rsi_min"] - rsi
                if gap <= 5:
                    return {"ticker": ticker, "reason": "rsi_below_min",
                            "actual": round(rsi, 1), "threshold": params["rsi_min"], "gap": round(gap, 1)}
            else:
                gap = rsi - params["rsi_max"]
                if gap <= 5:
                    return {"ticker": ticker, "reason": "rsi_above_max",
                            "actual": round(rsi, 1), "threshold": params["rsi_max"], "gap": round(gap, 1)}

        elif reason == "volume_surge":
            avg_vol = float(df["Volume"].iloc[-20:-1].mean())
            actual_vol = float(latest["Volume"])
            required = avg_vol * params["volume_multiplier"]
            if required > 0:
                gap_pct = (required - actual_vol) / required * 100
                if gap_pct <= 20:
                    return {"ticker": ticker, "reason": "volume_low",
                            "actual": int(actual_vol), "threshold": int(required),
                            "gap_pct": round(gap_pct, 1)}

        elif reason == "sma50":
            sma50 = float(latest.get("SMA_50") or 0)
            if sma50 > 0:
                gap_pct = (sma50 - close) / sma50 * 100
                if gap_pct <= 2:
                    return {"ticker": ticker, "reason": "below_sma50",
                            "actual": round(close, 2), "threshold": round(sma50, 2),
                            "gap_pct": round(gap_pct, 2)}

        elif reason == "sma200":
            sma200 = float(latest.get("SMA_200") or 0)
            if sma200 > 0:
                gap_pct = (sma200 - close) / sma200 * 100
                if gap_pct <= 2:
                    return {"ticker": ticker, "reason": "below_sma200",
                            "actual": round(close, 2), "threshold": round(sma200, 2),
                            "gap_pct": round(gap_pct, 2)}

        elif reason == "rsi2_range":
            rsi2 = float(latest.get("RSI_2") or 0)
            threshold = params.get("rsi2_max", 10.0)
            gap = rsi2 - threshold
            if gap <= 5:
                return {"ticker": ticker, "reason": "rsi2_above_max",
                        "actual": round(rsi2, 1), "threshold": threshold, "gap": round(gap, 1)}
    except Exception:
        pass
    return None


def pre_filter_snapshot(item: dict, params: dict) -> bool:
    """Fast pre-filter on snapshot data (no OHLCV fetch needed)."""
    return (
        item["close"] >= params["price_min"]
        and item["close"] <= params["price_max"]
        and item["volume"] >= params["avg_volume_min"]
    )


# ---------------------------------------------------------------------------
# Core per-module screening loop
# ---------------------------------------------------------------------------

async def _run_single_module(
    module_name: str,
    params: dict,
    pre_candidates: list[dict],
    provider,
    regime: str,
    spy_20d_return: Optional[float],
    max_cap: int,
    progress_cb: Optional[Callable] = None,
    progress_offset: int = 0,
) -> tuple[list[dict], dict]:
    """
    Run the OHLCV + indicator + filter loop for one set of params.
    Returns (candidates, rejection_counts).
    """
    candidates: list[dict] = []
    rejection: dict[str, int] = {
        "insufficient_bars": 0, "nan_indicators": 0,
        "price_range": 0, "volume_min": 0,
        "sma50": 0, "sma20": 0, "sma200": 0,
        "rsi_range": 0, "rsi_bear": 0, "volume_surge": 0,
        "relative_strength": 0, "close_above_sma5": 0, "rsi2_range": 0, "error": 0,
    }
    near_misses: list[dict] = []
    ohlcv_ok = 0
    ohlcv_none = 0
    total = len(pre_candidates)

    for i, item in enumerate(pre_candidates):
        if len(candidates) >= max_cap:
            break
        ticker = item["ticker"]
        if progress_cb:
            pct = progress_offset + int((i / max(total, 1)) * 50)
            progress_cb("screening", f"[{module_name}] {ticker} ({i+1}/{total})",
                        i + 1, total, len(candidates), pct)
        try:
            df = await provider.get_daily_bars(ticker, days=settings.lookback_days)
            if df is None:
                ohlcv_none += 1
                rejection["insufficient_bars"] += 1
                continue
            ohlcv_ok += 1
            df = compute_indicators(df)
            reason = _filter_reason(df, params, regime=regime, spy_20d_return=spy_20d_return)
            if reason is not None:
                rejection[reason] = rejection.get(reason, 0) + 1
                nm = _near_miss_check(df, params, reason, ticker)
                if nm:
                    near_misses.append(nm)
                continue
            indicators = get_indicator_snapshot(df)
            candidates.append({
                "ticker":          ticker,
                "df":              df,
                "indicators":      indicators,
                "strategy_module": module_name,
            })
            logger.info(
                "[%s] Candidate #%d: %s (RSI=%.1f, Close=%.2f, SMA20=%.2f, SMA200=%.2f)",
                module_name, len(candidates), ticker,
                indicators["rsi14"], indicators["close"],
                indicators["sma20"], indicators["sma200"],
            )
        except Exception as exc:
            logger.warning("[%s] Error on %s: %s", module_name, ticker, exc)
            ohlcv_none += 1
            rejection["error"] += 1

    return candidates, {
        "ohlcv_ok": ohlcv_ok, "ohlcv_none": ohlcv_none,
        "rejections": rejection,
        "near_misses": near_misses,
    }


async def _get_spy_20d_return() -> Optional[float]:
    """Fetch SPY's 20-day price return for relative-strength filter."""
    try:
        provider = get_data_provider()
        df = await provider.get_daily_bars("SPY", days=30)
        if df is not None and len(df) >= 21:
            return (float(df["Close"].iloc[-1]) - float(df["Close"].iloc[-21])) / float(df["Close"].iloc[-21])
    except Exception as exc:
        logger.warning("Could not compute SPY 20d return: %s", exc)
    return None


def _log_funnel(label: str, funnel: dict):
    rej = funnel.get("rejections", {})
    logger.info("=" * 60)
    logger.info("[FUNNEL:%s] Universe:          %d", label, funnel.get("universe", 0))
    logger.info("[FUNNEL:%s] Snapshot:          %d", label, funnel.get("snapshot", 0))
    logger.info("[FUNNEL:%s] Pre-filter:        %d", label, funnel.get("pre_filter", 0))
    logger.info("[FUNNEL:%s] OHLCV ok/fail:     %d / %d", label,
                funnel.get("ohlcv_fetched", 0), funnel.get("ohlcv_failed", 0))
    for reason, count in rej.items():
        if count > 0:
            logger.info("[FUNNEL:%s]   %-20s %d", label, reason + ":", count)
    logger.info("[FUNNEL:%s] ====> CANDIDATES:  %d", label, funnel.get("candidates", 0))
    logger.info("=" * 60)


# ---------------------------------------------------------------------------
# Main screener (regime-aware, module-driven)
# ---------------------------------------------------------------------------

async def run_screener(
    progress_cb: Optional[Callable] = None,
    regime: str = "neutral",
) -> list[dict]:
    """
    Regime-switching screening pipeline (v2.5).

    Strategy modules matching the current regime are selected automatically.
    Each module is applied independently; results are merged and deduplicated.
    If no strategy modules are configured, falls back to the active FilterProfile.

    Returns a list of candidate dicts:
      {ticker, df, indicators, strategy_module}
    """
    global _last_funnel
    provider = get_data_provider()

    # ── Step 1: Symbol universe (DB-driven if universes exist, fallback to config) ──
    if progress_cb:
        progress_cb("snapshot", "Loading symbol universe…", 0, 0, 0, 1)

    active_universes = get_active_universes(regime)
    if active_universes:
        symbols_set: set[str] = set()
        for u in active_universes:
            if u.tickers_source == "custom_json" and u.tickers_json:
                import json as _json
                try:
                    symbols_set.update(_json.loads(u.tickers_json))
                except Exception:
                    pass
            else:
                # static_sp500 / static_russell1000 → use provider
                symbols_set.update(provider.get_symbols(u.tickers_source.replace("static_", "")))
        symbols = sorted(symbols_set)
        logger.info("Universe (DB): %d symbols from %d active universe(s)", len(symbols), len(active_universes))
    else:
        symbols = provider.get_symbols(settings.stock_universe)
        logger.info("Universe (config fallback): %d symbols", len(symbols))

    # ── Step 2: Market snapshot ───────────────────────────────────────────────
    if progress_cb:
        progress_cb("snapshot", f"Fetching snapshot for {len(symbols)} symbols…", 0, len(symbols), 0, 2)
    all_tickers = await provider.get_snapshot(symbols)
    if not all_tickers:
        logger.error("No market data — check data provider / market hours")
        return []

    # ── Step 3: Select strategy modules ──────────────────────────────────────
    modules = get_modules_for_regime(regime)
    using_modules = bool(modules)

    if not using_modules:
        logger.info("No strategy modules for regime '%s' — falling back to FilterProfile", regime)
        fp = get_active_filter()
        modules_cfg = [(fp.name if fp else "default", _get_filter_params(fp))]
    else:
        logger.info(
            "Regime '%s' → %d module(s): %s",
            regime, len(modules), [m.name for m in modules]
        )
        modules_cfg = [(m.name, _get_filter_params(m)) for m in modules]

    # ── Step 4: SPY 20d return (needed for relative-strength filter) ──────────
    needs_rs = any(cfg[1].get("relative_strength_vs_spy") for cfg in modules_cfg)
    spy_20d_return: Optional[float] = None
    if needs_rs:
        spy_20d_return = await _get_spy_20d_return()
        if spy_20d_return is not None:
            logger.info("SPY 20d return: %.2f%%", spy_20d_return * 100)

    # ── Step 5: Run each module ───────────────────────────────────────────────
    all_candidates: list[dict] = []
    all_near_misses: list[dict] = []
    seen_tickers: set[str] = set()
    combined_funnel: dict = {
        "ran_at":      datetime.utcnow().isoformat(),
        "regime":      regime,
        "universe":    len(symbols),
        "snapshot":    len(all_tickers),
        "modules":     {},
    }
    max_cap = settings.max_candidates

    for module_idx, (module_name, params) in enumerate(modules_cfg):
        # Per-module pre-filter (each module has its own price_min/vol thresholds)
        pre = [t for t in all_tickers if pre_filter_snapshot(t, params)]
        logger.info("[%s] Pre-filter: %d / %d symbols", module_name, len(pre), len(all_tickers))

        if progress_cb:
            progress_cb("snapshot", f"[{module_name}] Screening {len(pre)} candidates…",
                        0, len(pre), 0, 5 + module_idx * 5)

        offset = 10 + module_idx * 40
        module_candidates, stats = await _run_single_module(
            module_name=module_name,
            params=params,
            pre_candidates=pre,
            provider=provider,
            regime=regime,
            spy_20d_return=spy_20d_return,
            max_cap=max_cap - len(all_candidates),
            progress_cb=progress_cb,
            progress_offset=offset,
        )

        # Deduplicate (same ticker may appear in multiple modules → keep first/best)
        new = [c for c in module_candidates if c["ticker"] not in seen_tickers]
        seen_tickers.update(c["ticker"] for c in new)
        all_candidates.extend(new)

        module_near_misses = [{"module": module_name, **nm} for nm in stats.get("near_misses", [])]
        all_near_misses.extend(module_near_misses)

        combined_funnel["modules"][module_name] = {
            "pre_filter":    len(pre),
            "ohlcv_fetched": stats["ohlcv_ok"],
            "ohlcv_failed":  stats["ohlcv_none"],
            "rejections":    stats["rejections"],
            "candidates":    len(new),
            "near_misses":   len(module_near_misses),
        }
        _log_funnel(module_name, {
            "universe":    len(symbols),
            "snapshot":    len(all_tickers),
            "pre_filter":  len(pre),
            "ohlcv_fetched": stats["ohlcv_ok"],
            "ohlcv_failed":  stats["ohlcv_none"],
            "rejections":    stats["rejections"],
            "candidates":    len(new),
        })

        if len(all_candidates) >= max_cap:
            break

    combined_funnel["candidates"] = len(all_candidates)
    combined_funnel["near_misses"] = all_near_misses[:50]  # cap at 50 to limit payload

    # ── Step 6: Adaptive suggestion ───────────────────────────────────────────
    if len(all_candidates) == 0 and using_modules:
        # Compute how many the Bear RS module would produce without RS filter
        combined_funnel["adaptive_hint"] = _build_adaptive_hint(regime, all_tickers)

    # Store for API
    _last_funnel = combined_funnel
    logger.info("Screener done: %d candidates across %d module(s)", len(all_candidates), len(modules_cfg))
    return all_candidates


def _build_adaptive_hint(regime: str, snapshot: list[dict]) -> dict:
    """
    When 0 candidates are found, suggest which relaxed module would produce results.
    This is a lightweight count without OHLCV (snapshot only).
    """
    # Check how many pass the loosest possible pre-filter
    loose_params = {
        "price_min": 5.0, "price_max": 999.0, "avg_volume_min": 200_000,
        "rsi_min": 20.0, "rsi_max": 80.0, "price_above_sma20": None,
        "price_above_sma50": None, "close_above_sma200": None,
        "rsi_bear_cap": None, "volume_multiplier": 0.5,
        "relative_strength_vs_spy": False,
    }
    loose_count = sum(1 for t in snapshot if pre_filter_snapshot(t, loose_params))
    return {
        "regime": regime,
        "loose_pre_filter_count": loose_count,
        "suggestion": (
            f"Mit dem 'Breit'-Preset wären ~{loose_count} Symbole in der Vorauswahl. "
            f"Wechsle zu einem weniger restriktiven Modul für diesen {regime.upper()}-Markt."
        ),
    }
