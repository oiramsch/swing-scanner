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
from datetime import date
from typing import Callable, Optional

import pandas as pd
import ta as ta_lib

from backend.config import settings
from backend.database import FilterProfile, get_active_filter
from backend.providers import get_data_provider

logger = logging.getLogger(__name__)

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
        "volume_multiplier": settings.volume_multiplier,
    }


def passes_filter(df: pd.DataFrame, params: dict, regime: str = "neutral") -> bool:
    if df is None or len(df) < 51:
        return False

    latest = df.iloc[-1]
    close  = latest["Close"]
    volume = latest["Volume"]

    if pd.isna(latest.get("SMA_50")) or pd.isna(latest.get("RSI_14")):
        return False
    if close < params["price_min"] or close > params["price_max"]:
        return False
    if volume < params["avg_volume_min"]:
        return False
    if params["price_above_sma50"] and close <= latest["SMA_50"]:
        return False
    if params["price_above_sma20"] and close <= latest["SMA_20"]:
        return False

    rsi = latest["RSI_14"]
    if not (params["rsi_min"] <= rsi <= params["rsi_max"]):
        return False
    if regime == "bear" and rsi > 60:
        return False

    avg_vol = df["Volume"].iloc[-20:-1].mean()
    if volume < avg_vol * params["volume_multiplier"]:
        return False

    return True


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
    candidates:   list[dict] = []
    processed     = 0
    ohlcv_ok      = 0
    ohlcv_none    = 0
    filtered_out  = 0
    max_cap       = settings.max_candidates

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
                continue

            ohlcv_ok += 1
            df = compute_indicators(df)

            if not passes_filter(df, params, regime=regime):
                filtered_out += 1
                continue

            indicators = get_indicator_snapshot(df)
            candidates.append({"ticker": ticker, "df": df, "indicators": indicators})
            logger.info(
                "Candidate #%d: %s (RSI=%.1f, Close=%.2f)",
                len(candidates), ticker,
                indicators["rsi14"], indicators["close"],
            )

        except Exception as exc:
            logger.warning("Error processing %s: %s", ticker, exc)
            ohlcv_none += 1

    logger.info(
        "Screener done: %d candidates from %d screened "
        "(OHLCV ok=%d, no-data=%d, filtered-out=%d)",
        len(candidates), processed, ohlcv_ok, ohlcv_none, filtered_out,
    )
    return candidates
