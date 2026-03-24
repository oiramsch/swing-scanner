"""
Daily market regime detection using SPY (S&P 500 ETF).

bull    — SPY > SMA50 > SMA200 → aggressive scanning allowed
bear    — SPY < SMA50           → pullback setups only
neutral — otherwise             → conservative

Data source: yfinance (via DataProvider) — no API key needed.

Key function:
  ensure_regime_current() — call before every scan to guarantee a fresh regime.
  It auto-refreshes if the DB is empty OR if data is older than max_age_hours.
  Never returns "neutral" due to missing data — only when SPY is actually neutral.
"""
import asyncio
import logging
from datetime import date, datetime, time
from typing import Optional

import pandas as pd
import ta as ta_lib

from backend.database import MarketRegime, get_latest_regime, save_market_regime

logger = logging.getLogger(__name__)


async def _fetch_spy_ohlcv(days: int = 260) -> Optional[pd.DataFrame]:
    """Fetch SPY daily bars via the configured DataProvider."""
    from backend.providers import get_data_provider
    provider = get_data_provider()
    df = await provider.get_daily_bars("SPY", days=days)
    if df is None or df.empty:
        logger.warning("SPY OHLCV returned no data")
        return None
    return df[["Close"]].copy()


async def update_market_regime() -> Optional[MarketRegime]:
    """Fetch SPY data, compute regime, persist and return."""
    df = await _fetch_spy_ohlcv(days=260)
    if df is None or len(df) < 200:
        logger.warning("Not enough SPY data for regime detection (%s rows)",
                       len(df) if df is not None else 0)
        return get_latest_regime()

    df["SMA50"]  = ta_lib.trend.sma_indicator(df["Close"], window=50)
    df["SMA200"] = ta_lib.trend.sma_indicator(df["Close"], window=200)

    latest    = df.iloc[-1]
    spy_close = float(latest["Close"])
    sma50     = float(latest["SMA50"])
    sma200    = float(latest["SMA200"])

    if spy_close > sma50 and sma50 > sma200:
        regime = "bull"
        note   = "SPY above SMA50 and SMA200"
    elif spy_close < sma50:
        regime = "bear"
        note   = "SPY below SMA50"
    else:
        regime = "neutral"
        note   = "SPY between SMA50 and SMA200"

    mr = MarketRegime(
        date=date.today(),
        spy_close=spy_close,
        spy_sma50=round(sma50, 2),
        spy_sma200=round(sma200, 2),
        regime=regime,
        note=note,
    )
    saved = save_market_regime(mr)
    logger.info(
        "Market regime updated: %s (SPY=%.2f SMA50=%.2f SMA200=%.2f)",
        regime, spy_close, sma50, sma200,
    )
    return saved


async def ensure_regime_current(max_age_hours: int = 12) -> str:
    """
    Guarantee a fresh market regime before scanning.

    - If no regime in DB → fetches live (blocks until done)
    - If regime older than max_age_hours → refreshes in place
    - Returns the regime string (bull | neutral | bear)

    This NEVER returns "neutral" as a fallback for missing data.
    Use this instead of get_current_regime() in the scan pipeline.
    """
    latest = get_latest_regime()

    if latest is None:
        logger.info("No regime in DB — fetching live now (blocking scan until done)…")
        mr = await update_market_regime()
        return mr.regime if mr else "neutral"

    # Age = time since the regime was actually saved (not midnight of the date)
    regime_datetime = latest.created_at if latest.created_at else datetime.combine(latest.date, time.min)
    age_hours = (datetime.utcnow() - regime_datetime).total_seconds() / 3600

    if age_hours > max_age_hours:
        logger.info(
            "Regime from %s is %.1fh old (threshold: %dh) — refreshing…",
            latest.date, age_hours, max_age_hours,
        )
        mr = await update_market_regime()
        return mr.regime if mr else latest.regime

    logger.info("Regime current: %s (%.1fh old)", latest.regime, age_hours)
    return latest.regime


def get_current_regime() -> str:
    """
    Sync read of the stored regime (no network call).
    Returns "unknown" — NOT "neutral" — when no data exists.
    Use ensure_regime_current() in async contexts for a guaranteed fresh value.
    """
    latest = get_latest_regime()
    if latest is None:
        return "unknown"
    delta = (date.today() - latest.date).days
    if delta > 3:
        # Stale but don't pretend it's neutral — return last known value
        logger.warning("Regime data is %d days old — using stale value: %s", delta, latest.regime)
        return latest.regime
    return latest.regime


def get_regime_status() -> dict:
    """Return regime + metadata for the API response."""
    latest = get_latest_regime()
    if latest is None:
        return {
            "regime": "unknown",
            "date": None,
            "spy_close": None,
            "spy_sma50": None,
            "spy_sma200": None,
            "age_hours": None,
            "stale": True,
        }

    # Use created_at (actual save time) for accurate age, not midnight of the date
    regime_datetime = latest.created_at if latest.created_at else datetime.combine(latest.date, time.min)
    age_hours = round((datetime.utcnow() - regime_datetime).total_seconds() / 3600, 1)

    return {
        **latest.model_dump(),
        "age_hours": age_hours,
        "stale": age_hours > 28,  # stale if not updated in ~1 trading day
    }
