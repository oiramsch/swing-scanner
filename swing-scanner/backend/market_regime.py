"""
Daily market regime detection using SPY (S&P 500 ETF).

bull    — SPY > SMA50 > SMA200 → aggressive scanning allowed
bear    — SPY < SMA50           → pullback setups only
neutral — otherwise             → conservative

Data source: yfinance (via DataProvider) — no API key needed.
"""
import logging
from datetime import date
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
    # We only need Close for regime detection
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


def get_current_regime() -> str:
    """Return current regime string (bull/bear/neutral), defaulting to neutral."""
    latest = get_latest_regime()
    if latest is None:
        return "neutral"
    delta = (date.today() - latest.date).days
    if delta > 3:
        return "neutral"
    return latest.regime
