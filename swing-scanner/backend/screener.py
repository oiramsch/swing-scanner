"""
Polygon.io screener: fetches US tickers, loads OHLCV, computes indicators,
returns up to 50 swing-trade candidates with their DataFrames.
"""
import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Optional

import httpx
import pandas as pd
import pandas_ta as ta

from backend.config import settings

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


def _rate_sleep():
    time.sleep(settings.polygon_rate_limit_sleep)


def fetch_tickers(limit: int = 1000) -> list[str]:
    """Return all active NYSE/NASDAQ stock tickers above a few basic filters."""
    tickers: list[str] = []
    url = f"{POLYGON_BASE}/v3/reference/tickers"
    params = {
        "market": "stocks",
        "active": "true",
        "limit": 1000,
    }

    with httpx.Client(timeout=30) as client:
        while url:
            try:
                resp = client.get(url, headers=_headers(), params=params)
                resp.raise_for_status()
                data = resp.json()
            except Exception as exc:
                logger.error("Error fetching tickers page: %s", exc)
                break

            for item in data.get("results", []):
                exchange = item.get("primary_exchange", "")
                market = item.get("market", "")
                if market == "stocks" and exchange in ("XNYS", "XNAS"):
                    tickers.append(item["ticker"])

            url = data.get("next_url")
            params = {}  # next_url already contains params
            if url:
                _rate_sleep()

    logger.info("Fetched %d tickers from Polygon", len(tickers))
    return tickers


def fetch_ohlcv(ticker: str, days: int = 60) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV for a ticker for the last `days` calendar days."""
    end = date.today()
    start = end - timedelta(days=days + 10)  # buffer for weekends/holidays

    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/range/1/day"
        f"/{start.isoformat()}/{end.isoformat()}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 120,
    }

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(url, headers=_headers(), params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("OHLCV fetch failed for %s: %s", ticker, exc)
        return None

    results = data.get("results", [])
    if len(results) < 30:
        return None

    df = pd.DataFrame(results)
    df = df.rename(columns={
        "o": "Open", "h": "High", "l": "Low",
        "c": "Close", "v": "Volume", "t": "timestamp",
    })
    df["Date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.date
    df = df.set_index("Date")[["Open", "High", "Low", "Close", "Volume"]]
    df = df.tail(days)
    return df


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add SMA20, SMA50, RSI14, ATR14 columns to the DataFrame."""
    df = df.copy()
    df.ta.sma(length=20, append=True)   # SMA_20
    df.ta.sma(length=50, append=True)   # SMA_50
    df.ta.rsi(length=14, append=True)   # RSI_14
    df.ta.atr(length=14, append=True)   # ATRr_14
    return df


def passes_filter(df: pd.DataFrame) -> bool:
    """Return True if the latest bar passes all screening criteria."""
    if df is None or len(df) < 51:
        return False

    latest = df.iloc[-1]
    close = latest["Close"]
    volume = latest["Volume"]

    sma20_col = "SMA_20"
    sma50_col = "SMA_50"
    rsi_col = "RSI_14"

    if sma20_col not in df.columns or sma50_col not in df.columns:
        return False
    if pd.isna(latest.get(sma50_col)) or pd.isna(latest.get(rsi_col)):
        return False

    sma50 = latest[sma50_col]
    rsi = latest[rsi_col]

    if close < settings.min_price:
        return False
    if volume < settings.min_volume:
        return False
    if close <= sma50:
        return False
    if not (settings.min_rsi <= rsi <= settings.max_rsi):
        return False

    avg_volume = df["Volume"].iloc[-20:-1].mean()
    if volume < avg_volume * settings.volume_multiplier:
        return False

    return True


def get_indicator_snapshot(df: pd.DataFrame) -> dict:
    """Return a dict of the latest indicator values for the analyzer."""
    latest = df.iloc[-1]
    return {
        "close": round(float(latest["Close"]), 2),
        "volume": int(latest["Volume"]),
        "sma20": round(float(latest.get("SMA_20", 0) or 0), 2),
        "sma50": round(float(latest.get("SMA_50", 0) or 0), 2),
        "rsi14": round(float(latest.get("RSI_14", 0) or 0), 2),
        "atr14": round(float(latest.get("ATRr_14", 0) or 0), 2),
    }


def run_screener() -> list[dict]:
    """
    Full screening pipeline.
    Returns list of dicts: {ticker, df, indicators}
    """
    logger.info("Starting screener run")
    all_tickers = fetch_tickers()

    candidates = []
    processed = 0

    for ticker in all_tickers:
        if len(candidates) >= settings.max_candidates:
            break

        _rate_sleep()
        processed += 1

        try:
            df = fetch_ohlcv(ticker, days=settings.lookback_days)
            if df is None:
                continue

            df = compute_indicators(df)

            if not passes_filter(df):
                continue

            indicators = get_indicator_snapshot(df)
            candidates.append({
                "ticker": ticker,
                "df": df,
                "indicators": indicators,
            })
            logger.info(
                "Candidate #%d: %s (RSI=%.1f, Close=%.2f)",
                len(candidates), ticker,
                indicators["rsi14"], indicators["close"],
            )

        except Exception as exc:
            logger.warning("Error processing %s: %s", ticker, exc)
            continue

        if processed % 10 == 0:
            logger.info(
                "Progress: %d tickers processed, %d candidates found",
                processed, len(candidates),
            )

    logger.info(
        "Screener done: %d candidates from %d tickers",
        len(candidates), processed,
    )
    return candidates
