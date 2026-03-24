"""
Alpaca-based screener (primary) with Polygon.io fallback.

Primary:  alpaca-py StockHistoricalDataClient — no rate-limit sleep needed.
Fallback: Polygon.io REST (used when ALPACA_API_KEY is empty).
All I/O is async; sync Alpaca SDK calls run in a thread via asyncio.to_thread().
"""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

import httpx
import pandas as pd
import ta as ta_lib

from backend.config import settings
from backend.database import FilterProfile, get_active_filter

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"

# ---------------------------------------------------------------------------
# Alpaca client singletons (lazy-initialised)
# ---------------------------------------------------------------------------

_alpaca_data_client = None
_alpaca_trading_client = None


def _get_data_client():
    global _alpaca_data_client
    if _alpaca_data_client is None:
        from alpaca.data.historical import StockHistoricalDataClient
        _alpaca_data_client = StockHistoricalDataClient(
            settings.alpaca_api_key, settings.alpaca_secret_key
        )
    return _alpaca_data_client


def _get_trading_client():
    global _alpaca_trading_client
    if _alpaca_trading_client is None:
        from alpaca.trading.client import TradingClient
        _alpaca_trading_client = TradingClient(
            settings.alpaca_api_key,
            settings.alpaca_secret_key,
            paper=settings.alpaca_paper,
        )
    return _alpaca_trading_client


def _use_alpaca() -> bool:
    return bool(settings.alpaca_api_key and settings.alpaca_secret_key)


# ---------------------------------------------------------------------------
# Alpaca — Grouped Daily Snapshot (replaces Polygon grouped-daily)
# ---------------------------------------------------------------------------

def _alpaca_grouped_daily_sync() -> list[dict]:
    """
    Fetch latest bar + volume for all tradable US equities via Alpaca.
    Runs synchronously — call via asyncio.to_thread().
    """
    from alpaca.trading.requests import GetAssetsRequest
    from alpaca.trading.enums import AssetClass, AssetStatus
    from alpaca.data.requests import StockSnapshotRequest

    trading = _get_trading_client()
    assets = trading.get_all_assets(
        GetAssetsRequest(asset_class=AssetClass.US_EQUITY, status=AssetStatus.ACTIVE)
    )
    # Keep only simple tickers (no '/', no warrants/rights, max 5 chars)
    symbols = [
        a.symbol for a in assets
        if a.tradable and "/" not in a.symbol and len(a.symbol) <= 5
    ]
    logger.info("Alpaca asset universe: %d tradable US equity symbols", len(symbols))

    data = _get_data_client()
    result: list[dict] = []
    batch_size = 1000

    for i in range(0, len(symbols), batch_size):
        batch = symbols[i : i + batch_size]
        try:
            snapshots = data.get_stock_snapshot(
                StockSnapshotRequest(symbol_or_symbols=batch, feed="iex")
            )
            for sym, snap in snapshots.items():
                bar = getattr(snap, "daily_bar", None) or getattr(snap, "latest_bar", None)
                if bar:
                    result.append({
                        "ticker": sym,
                        "close": float(bar.close),
                        "volume": int(bar.volume),
                    })
        except Exception as exc:
            logger.warning(
                "Alpaca snapshot batch %d–%d failed: %s", i, i + batch_size, exc
            )

    logger.info("Alpaca snapshot: %d tickers returned", len(result))
    return result


# ---------------------------------------------------------------------------
# Alpaca — Per-ticker OHLCV
# ---------------------------------------------------------------------------

def _alpaca_fetch_ohlcv_sync(ticker: str, days: int) -> Optional[pd.DataFrame]:
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days + 15)

    try:
        bars = _get_data_client().get_stock_bars(
            StockBarsRequest(
                symbol_or_symbols=ticker,
                timeframe=TimeFrame.Day,
                start=start,
                end=end,
                adjustment="all",
                feed="iex",  # Free plan: IEX feed (SIP requires paid subscription)
            )
        )
    except Exception as exc:
        logger.warning("Alpaca OHLCV fetch failed for %s: %s", ticker, exc)
        return None

    df = bars.df
    if df is None or df.empty:
        return None

    # alpaca-py returns MultiIndex (symbol, timestamp) when one symbol is requested
    if isinstance(df.index, pd.MultiIndex):
        if ticker not in df.index.get_level_values(0):
            return None
        df = df.loc[ticker].copy()

    df.index = pd.to_datetime(df.index).date
    df.index.name = "Date"
    df = df.rename(columns={
        "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume",
    })
    df = df[["Open", "High", "Low", "Close", "Volume"]]

    if len(df) < 30:
        return None
    return df.tail(days)


# ---------------------------------------------------------------------------
# Alpaca — Real-time quote snapshot (single ticker)
# ---------------------------------------------------------------------------

def _alpaca_latest_quote_sync(ticker: str) -> Optional[dict]:
    """Returns {bid, ask, last} or None."""
    from alpaca.data.requests import StockLatestQuoteRequest
    try:
        quotes = _get_data_client().get_stock_latest_quote(
            StockLatestQuoteRequest(symbol_or_symbols=ticker)
        )
        q = quotes.get(ticker)
        if q is None:
            return None
        return {"bid": float(q.bid_price), "ask": float(q.ask_price)}
    except Exception as exc:
        logger.warning("Alpaca latest quote failed for %s: %s", ticker, exc)
        return None


async def fetch_latest_quote(ticker: str) -> Optional[dict]:
    """Public async wrapper for real-time quote."""
    if _use_alpaca():
        return await asyncio.to_thread(_alpaca_latest_quote_sync, ticker)
    return None  # Polygon fallback not implemented for quotes


# ---------------------------------------------------------------------------
# Polygon fallback — Grouped Daily
# ---------------------------------------------------------------------------

def _polygon_headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


async def _polygon_fetch_grouped_daily() -> list[dict]:
    async with httpx.AsyncClient(timeout=60) as client:
        for days_back in range(1, 6):
            target_date = date.today() - timedelta(days=days_back)
            url = (
                f"{POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks"
                f"/{target_date.isoformat()}"
            )
            try:
                resp = await client.get(
                    url, headers=_polygon_headers(), params={"adjusted": "true", "include_otc": "false"}
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])
            except Exception as exc:
                logger.warning("Polygon grouped daily failed for %s: %s", target_date, exc)
                continue

            if not results:
                continue

            logger.info("Polygon grouped daily (%s): %d tickers", target_date, len(results))
            return [
                {"ticker": r["T"], "close": r.get("c", 0), "volume": int(r.get("v", 0))}
                for r in results
            ]

    logger.error("Polygon: no valid trading day found in the last 5 days")
    return []


# ---------------------------------------------------------------------------
# Polygon fallback — Per-ticker OHLCV
# ---------------------------------------------------------------------------

async def _polygon_fetch_ohlcv(ticker: str, days: int) -> Optional[pd.DataFrame]:
    end = date.today()
    start = end - timedelta(days=days + 15)
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/range/1/day"
        f"/{start.isoformat()}/{end.isoformat()}"
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url, headers=_polygon_headers(),
                params={"adjusted": "true", "sort": "asc", "limit": 120},
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
    except Exception as exc:
        logger.warning("Polygon OHLCV fetch failed for %s: %s", ticker, exc)
        return None

    if len(results) < 30:
        return None

    df = pd.DataFrame(results).rename(columns={
        "o": "Open", "h": "High", "l": "Low",
        "c": "Close", "v": "Volume", "t": "timestamp",
    })
    df["Date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.date
    df = df.set_index("Date")[["Open", "High", "Low", "Close", "Volume"]]
    return df.tail(days)


# ---------------------------------------------------------------------------
# Public data-source routers
# ---------------------------------------------------------------------------

async def fetch_grouped_daily() -> list[dict]:
    """
    Fetch all US stock close+volume for the latest trading day.
    Uses Alpaca if configured, otherwise falls back to Polygon.
    """
    if _use_alpaca():
        return await asyncio.to_thread(_alpaca_grouped_daily_sync)
    logger.info("Alpaca keys not set — falling back to Polygon grouped daily")
    return await _polygon_fetch_grouped_daily()


async def fetch_ohlcv(ticker: str, days: int = 60) -> Optional[pd.DataFrame]:
    """
    Fetch daily OHLCV for a single ticker.
    Uses Alpaca if configured, otherwise falls back to Polygon.
    """
    if _use_alpaca():
        return await asyncio.to_thread(_alpaca_fetch_ohlcv_sync, ticker, days)
    await asyncio.sleep(settings.polygon_rate_limit_sleep)  # Polygon free tier
    return await _polygon_fetch_ohlcv(ticker, days)


# ---------------------------------------------------------------------------
# Indicator computation
# ---------------------------------------------------------------------------

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["SMA_20"] = ta_lib.trend.sma_indicator(df["Close"], window=20)
    df["SMA_50"] = ta_lib.trend.sma_indicator(df["Close"], window=50)
    df["EMA_9"] = ta_lib.trend.ema_indicator(df["Close"], window=9)
    df["RSI_14"] = ta_lib.momentum.rsi(df["Close"], window=14)
    df["ATRr_14"] = ta_lib.volatility.average_true_range(
        df["High"], df["Low"], df["Close"], window=14
    )
    df["Vol_MA20"] = df["Volume"].rolling(window=20).mean()
    return df


def get_indicator_snapshot(df: pd.DataFrame) -> dict:
    latest = df.iloc[-1]
    return {
        "close": round(float(latest["Close"]), 2),
        "volume": int(latest["Volume"]),
        "sma20": round(float(latest.get("SMA_20") or 0), 2),
        "sma50": round(float(latest.get("SMA_50") or 0), 2),
        "ema9": round(float(latest.get("EMA_9") or 0), 2),
        "rsi14": round(float(latest.get("RSI_14") or 0), 2),
        "atr14": round(float(latest.get("ATRr_14") or 0), 2),
        "vol_ma20": round(float(latest.get("Vol_MA20") or 0), 2),
    }


# ---------------------------------------------------------------------------
# Filter logic
# ---------------------------------------------------------------------------

def _get_filter_params(fp: Optional[FilterProfile]) -> dict:
    if fp is None:
        return {
            "price_min": settings.min_price,
            "price_max": 9999.0,
            "avg_volume_min": settings.min_volume,
            "rsi_min": settings.min_rsi,
            "rsi_max": settings.max_rsi,
            "price_above_sma50": True,
            "price_above_sma20": False,
            "volume_multiplier": settings.volume_multiplier,
        }
    return {
        "price_min": fp.price_min,
        "price_max": fp.price_max,
        "avg_volume_min": fp.avg_volume_min,
        "rsi_min": fp.rsi_min,
        "rsi_max": fp.rsi_max,
        "price_above_sma50": fp.price_above_sma50,
        "price_above_sma20": fp.price_above_sma20,
        "volume_multiplier": settings.volume_multiplier,
    }


def passes_filter(df: pd.DataFrame, params: dict, regime: str = "neutral") -> bool:
    if df is None or len(df) < 51:
        return False

    latest = df.iloc[-1]
    close = latest["Close"]
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
    fp = get_active_filter()
    params = _get_filter_params(fp)
    source = "Alpaca" if _use_alpaca() else "Polygon"

    logger.info(
        "Screener starting (source=%s, regime=%s, filter=%s)…",
        source, regime, fp.name if fp else "default",
    )

    if progress_cb:
        progress_cb("snapshot", "Fetching market snapshot…", 0, 0, 0, 2)

    all_tickers = await fetch_grouped_daily()

    if not all_tickers:
        logger.error("No market data — check API keys / market hours")
        return []

    pre_candidates = [t for t in all_tickers if pre_filter_snapshot(t, params)]
    total = len(pre_candidates)
    logger.info("Pre-filter: %d → %d tickers pass price/volume", len(all_tickers), total)

    if progress_cb:
        progress_cb("snapshot", f"Snapshot done: {total} candidates to screen", 0, total, 0, 5)

    candidates: list[dict] = []
    processed = 0
    ohlcv_ok = 0
    ohlcv_none = 0
    filtered_out = 0
    max_cap = settings.max_candidates

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
            df = await fetch_ohlcv(ticker, days=settings.lookback_days)
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
                len(candidates), ticker, indicators["rsi14"], indicators["close"],
            )

        except Exception as exc:
            logger.warning("Error processing %s: %s", ticker, exc)
            ohlcv_none += 1
            continue

    logger.info(
        "Screener done: %d candidates from %d screened "
        "(OHLCV ok=%d, no-data=%d, filtered-out=%d)",
        len(candidates), processed, ohlcv_ok, ohlcv_none, filtered_out,
    )
    return candidates
