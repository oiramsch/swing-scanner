"""
Daily market regime detection using SPY (S&P 500 ETF).
bull  — SPY > SMA50 > SMA200 → aggressive scanning allowed
bear  — SPY < SMA50             → pullback setups only
neutral — otherwise             → conservative
"""
import logging
from datetime import date, timedelta
from typing import Optional

import httpx
import pandas as pd
import ta as ta_lib

from backend.config import settings
from backend.database import MarketRegime, get_latest_regime, save_market_regime

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


async def fetch_spy_ohlcv(days: int = 250) -> Optional[pd.DataFrame]:
    end = date.today()
    start = end - timedelta(days=days + 30)
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/SPY/range/1/day"
        f"/{start.isoformat()}/{end.isoformat()}"
    )
    params = {"adjusted": "true", "sort": "asc", "limit": 300}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=_headers(), params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("SPY OHLCV fetch failed: %s", exc)
        return None

    results = data.get("results", [])
    if len(results) < 50:
        return None

    df = pd.DataFrame(results)
    df = df.rename(columns={"c": "Close", "t": "timestamp"})
    df["Date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.date
    df = df.set_index("Date")[["Close"]]
    return df


async def update_market_regime() -> Optional[MarketRegime]:
    """Fetch SPY data, compute regime, persist and return."""
    df = await fetch_spy_ohlcv(days=250)
    if df is None or len(df) < 200:
        logger.warning("Not enough SPY data for regime detection")
        return get_latest_regime()

    df["SMA50"] = ta_lib.trend.sma_indicator(df["Close"], window=50)
    df["SMA200"] = ta_lib.trend.sma_indicator(df["Close"], window=200)

    latest = df.iloc[-1]
    spy_close = float(latest["Close"])
    sma50 = float(latest["SMA50"])
    sma200 = float(latest["SMA200"])

    if spy_close > sma50 and sma50 > sma200:
        regime = "bull"
        note = "SPY above SMA50 and SMA200"
    elif spy_close < sma50:
        regime = "bear"
        note = "SPY below SMA50"
    else:
        regime = "neutral"
        note = "SPY between SMA50 and SMA200"

    mr = MarketRegime(
        date=date.today(),
        spy_close=spy_close,
        spy_sma50=round(sma50, 2),
        spy_sma200=round(sma200, 2),
        regime=regime,
        note=note,
    )
    saved = save_market_regime(mr)
    logger.info("Market regime updated: %s (SPY=%.2f SMA50=%.2f SMA200=%.2f)",
                regime, spy_close, sma50, sma200)
    return saved


def get_current_regime() -> str:
    """Return current regime string (bull/bear/neutral), defaulting to neutral."""
    latest = get_latest_regime()
    if latest is None:
        return "neutral"
    # Stale if older than 3 days
    delta = (date.today() - latest.date).days
    if delta > 3:
        return "neutral"
    return latest.regime
