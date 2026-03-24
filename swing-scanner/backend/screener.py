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
from backend.database import FilterProfile, get_active_filter
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
    df["SMA_20"] = ta_lib.trend.sma_indicator(df["Close"], window=20)
    df["SMA_50"] = ta_lib.trend.sma_indicator(df["Close"], window=50)
    df["EMA_9"]  = ta_lib.trend.ema_indicator(df["Close"], window=9)
    df["RSI_14"] = ta_lib.momentum.rsi(df["Close"], window=14)
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
        "sma20":    round(float(latest.get("SMA_20") or 0), 2),
        "sma50":    round(float(latest.get("SMA_50") or 0), 2),
        "ema9":     round(float(latest.get("EMA_9")  or 0), 2),
        "rsi14":    round(float(latest.get("RSI_14") or 0), 2),
        "atr14":    round(float(latest.get("ATRr_14") or 0), 2),
        "vol_ma20": round(float(latest.get("Vol_MA20") or 0), 2),
    }


# ---------------------------------------------------------------------------
# Filter logic
# ---------------------------------------------------------------------------

def _get_filter_params(fp: Optional[FilterProfile]) -> dict:
    if fp is None:
        return {
            "price_min":         settings.min_price,
            "price_max":         9_999.0,
            "avg_volume_min":    settings.min_volume,
            "rsi_min":           settings.min_rsi,
            "rsi_max":           settings.max_rsi,
            "price_above_sma50": True,
            "price_above_sma20": False,
            "volume_multiplier": settings.volume_multiplier,
        }
    return {
        "price_min":         fp.price_min,
        "price_max":         fp.price_max,
        "avg_volume_min":    fp.avg_volume_min,
        "rsi_min":           fp.rsi_min,
        "rsi_max":           fp.rsi_max,
        "price_above_sma50": fp.price_above_sma50,
        "price_above_sma20": fp.price_above_sma20,
        "volume_multiplier": getattr(fp, "volume_multiplier", settings.volume_multiplier),
    }


def _filter_reason(df: pd.DataFrame, params: dict, regime: str = "neutral") -> Optional[str]:
    """
    Returns the rejection reason string if the ticker fails any filter,
    or None if it passes all filters.

    Reasons:
      insufficient_bars — less than 51 OHLCV rows
      nan_indicators    — SMA50 or RSI14 not yet computed (not enough history)
      price_range       — price outside [price_min, price_max]
      volume_min        — snapshot volume below avg_volume_min
      sma50             — close <= SMA50 (when price_above_sma50=True)
      sma20             — close <= SMA20 (when price_above_sma20=True)
      rsi_range         — RSI outside [rsi_min, rsi_max]
      rsi_bear          — RSI > 60 in bear regime (extra bear-market filter)
      volume_surge      — current volume < volume_multiplier × 20d avg volume
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
    if params["price_above_sma50"] and close <= float(sma50_val):
        return "sma50"
    if params["price_above_sma20"] and close <= float(latest.get("SMA_20") or 0):
        return "sma20"

    rsi = float(rsi_val)
    if not (params["rsi_min"] <= rsi <= params["rsi_max"]):
        return "rsi_range"
    if regime == "bear" and rsi > 60:
        return "rsi_bear"

    avg_vol = float(df["Volume"].iloc[-20:-1].mean())
    if volume < avg_vol * params["volume_multiplier"]:
        return "volume_surge"

    return None  # passes all filters


def passes_filter(df: pd.DataFrame, params: dict, regime: str = "neutral") -> bool:
    """Thin wrapper kept for backward compatibility."""
    return _filter_reason(df, params, regime) is None


def pre_filter_snapshot(item: dict, params: dict) -> bool:
    """Fast pre-filter on snapshot data (no OHLCV fetch needed)."""
    return (
        item["close"] >= params["price_min"]
        and item["close"] <= params["price_max"]
        and item["volume"] >= params["avg_volume_min"]
    )


# ---------------------------------------------------------------------------
# Main screener
# ---------------------------------------------------------------------------

async def run_screener(
    progress_cb: Optional[Callable] = None,
    regime: str = "neutral",
) -> list[dict]:
    """
    Full async screening pipeline.
    Returns up to max_candidates dicts: {ticker, df, indicators}.
    """
    provider = get_data_provider()
    fp       = get_active_filter()
    params   = _get_filter_params(fp)
    universe = settings.stock_universe

    logger.info(
        "Screener starting (provider=%s, universe=%s, regime=%s, filter=%s)…",
        settings.data_provider, universe, regime,
        fp.name if fp else "default",
    )

    # ── Step 1: Get symbol universe ───────────────────────────────────────────
    if progress_cb:
        progress_cb("snapshot", "Loading symbol universe…", 0, 0, 0, 1)

    symbols = provider.get_symbols(universe)
    logger.info("Universe: %d symbols", len(symbols))

    # ── Step 2: Batch snapshot (latest close + volume) ────────────────────────
    if progress_cb:
        progress_cb("snapshot", f"Fetching market snapshot for {len(symbols)} symbols…", 0, len(symbols), 0, 2)

    all_tickers = await provider.get_snapshot(symbols)

    if not all_tickers:
        logger.error("No market data returned — check data provider / market hours")
        return []

    # ── Step 3: Price / volume pre-filter ─────────────────────────────────────
    pre_candidates = [t for t in all_tickers if pre_filter_snapshot(t, params)]
    total = len(pre_candidates)
    logger.info(
        "Filter funnel — universe: %d → snapshot data: %d → price/vol pre-filter: %d",
        len(symbols), len(all_tickers), total,
    )

    if progress_cb:
        progress_cb("snapshot", f"Snapshot done: {total} candidates to screen", 0, total, 0, 5)

    # ── Step 4-6: Per-ticker OHLCV + indicators + full filter ─────────────────
    candidates: list[dict] = []
    processed   = 0
    ohlcv_ok    = 0
    ohlcv_none  = 0
    max_cap     = settings.max_candidates

    # Granular per-reason rejection counters
    rejection: dict[str, int] = {
        "insufficient_bars": 0,
        "nan_indicators":    0,
        "price_range":       0,
        "volume_min":        0,
        "sma50":             0,
        "sma20":             0,
        "rsi_range":         0,
        "rsi_bear":          0,
        "volume_surge":      0,
        "error":             0,
    }

    for item in pre_candidates:
        if len(candidates) >= max_cap:
            break

        ticker = item["ticker"]
        processed += 1

        if progress_cb:
            pct = 5 + int((processed / max(total, 1)) * 55)
            progress_cb(
                "screening",
                f"Screening {ticker} ({processed}/{total})",
                processed, total, len(candidates), pct,
            )

        try:
            df = await provider.get_daily_bars(ticker, days=settings.lookback_days)
            if df is None:
                ohlcv_none += 1
                rejection["insufficient_bars"] += 1
                continue

            ohlcv_ok += 1
            df = compute_indicators(df)

            reason = _filter_reason(df, params, regime=regime)
            if reason is not None:
                rejection[reason] = rejection.get(reason, 0) + 1
                continue

            indicators = get_indicator_snapshot(df)
            candidates.append({"ticker": ticker, "df": df, "indicators": indicators})
            logger.info(
                "Candidate #%d: %s (RSI=%.1f, Close=%.2f vs SMA20=%.2f SMA50=%.2f, Vol×%.1f)",
                len(candidates), ticker,
                indicators["rsi14"], indicators["close"],
                indicators["sma20"], indicators["sma50"],
                params["volume_multiplier"],
            )

        except Exception as exc:
            logger.warning("Error processing %s: %s", ticker, exc)
            ohlcv_none += 1
            rejection["error"] += 1

    # ── Funnel summary ────────────────────────────────────────────────────────
    funnel = {
        "ran_at":           datetime.utcnow().isoformat(),
        "regime":           regime,
        "filter_profile":   fp.name if fp else "default",
        "filter_params":    params,
        "universe":         len(symbols),
        "snapshot":         len(all_tickers),
        "pre_filter":       total,
        "ohlcv_fetched":    ohlcv_ok,
        "ohlcv_failed":     ohlcv_none,
        "rejections":       rejection,
        "candidates":       len(candidates),
    }

    # Pretty funnel log — one line per step
    logger.info("=" * 60)
    logger.info("[FUNNEL] Universe loaded:          %d", funnel["universe"])
    logger.info("[FUNNEL] Snapshot data returned:   %d", funnel["snapshot"])
    logger.info("[FUNNEL] After price/vol pre-filter:%d", funnel["pre_filter"])
    logger.info("[FUNNEL] OHLCV fetched ok:          %d  (failed: %d)",
                funnel["ohlcv_fetched"], funnel["ohlcv_failed"])
    logger.info("[FUNNEL] --- Rejections after indicators ---")
    logger.info("[FUNNEL]   insufficient_bars: %d", rejection["insufficient_bars"])
    logger.info("[FUNNEL]   nan_indicators:    %d", rejection["nan_indicators"])
    logger.info("[FUNNEL]   price_range:       %d", rejection["price_range"])
    logger.info("[FUNNEL]   volume_min:        %d", rejection["volume_min"])
    logger.info("[FUNNEL]   sma50:             %d  (price_above_sma50=%s)",
                rejection["sma50"], params["price_above_sma50"])
    logger.info("[FUNNEL]   sma20:             %d  (price_above_sma20=%s)",
                rejection["sma20"], params["price_above_sma20"])
    logger.info("[FUNNEL]   rsi_range:         %d  (rsi=[%.0f-%.0f])",
                rejection["rsi_range"], params["rsi_min"], params["rsi_max"])
    logger.info("[FUNNEL]   rsi_bear:          %d  (bear-market RSI>60 filter)",
                rejection["rsi_bear"])
    logger.info("[FUNNEL]   volume_surge:      %d  (vol < %.1f×20d-avg)",
                rejection["volume_surge"], params["volume_multiplier"])
    logger.info("[FUNNEL]   errors:            %d", rejection["error"])
    logger.info("[FUNNEL] ====> FINAL CANDIDATES: %d", funnel["candidates"])
    logger.info("=" * 60)

    # Persist for API access
    global _last_funnel
    _last_funnel = funnel

    return candidates
