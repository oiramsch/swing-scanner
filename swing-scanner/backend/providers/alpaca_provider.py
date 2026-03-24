"""
AlpacaProvider — wraps the existing Alpaca SDK calls.

Role in Phase 1-2:
  - NOT used as the scanner's data source (YFinanceProvider handles that)
  - Used ONLY for live portfolio quotes (fetch_latest_quote) and
    broker integration (orders, account info in Phase 3)
  - Keep this as an alternative scanner data source for users who
    want to use their Alpaca subscription

Note: All sync Alpaca SDK calls are wrapped in asyncio.to_thread().
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd

from backend.providers.base import DataProvider

logger = logging.getLogger(__name__)


# ── Alpaca client singletons (lazy-init) ──────────────────────────────────────

_data_client = None
_trading_client = None


def _get_data_client():
    global _data_client
    if _data_client is None:
        from alpaca.data.historical import StockHistoricalDataClient
        from backend.config import settings
        _data_client = StockHistoricalDataClient(
            settings.alpaca_api_key, settings.alpaca_secret_key
        )
    return _data_client


def _get_trading_client():
    global _trading_client
    if _trading_client is None:
        from alpaca.trading.client import TradingClient
        from backend.config import settings
        _trading_client = TradingClient(
            settings.alpaca_api_key,
            settings.alpaca_secret_key,
            paper=settings.alpaca_paper,
        )
    return _trading_client


# ── Sync helpers ─────────────────────────────────────────────────────────────

def _snapshot_sync(symbols: list[str]) -> list[dict]:
    """Fetch latest bar for a batch of symbols via Alpaca IEX snapshot."""
    from alpaca.data.requests import StockSnapshotRequest

    data = _get_data_client()
    result: list[dict] = []
    batch_size = 1_000

    for i in range(0, len(symbols), batch_size):
        batch = symbols[i: i + batch_size]
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
            logger.warning("Alpaca snapshot batch %d–%d failed: %s", i, i + batch_size, exc)

    return result


def _get_all_tradable_symbols_sync() -> list[str]:
    """Return all tradable US equity symbols from Alpaca."""
    from alpaca.trading.requests import GetAssetsRequest
    from alpaca.trading.enums import AssetClass, AssetStatus

    trading = _get_trading_client()
    assets = trading.get_all_assets(
        GetAssetsRequest(asset_class=AssetClass.US_EQUITY, status=AssetStatus.ACTIVE)
    )
    return [
        a.symbol for a in assets
        if a.tradable and "/" not in a.symbol and len(a.symbol) <= 5
    ]


def _daily_bars_sync(ticker: str, days: int) -> Optional[pd.DataFrame]:
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
                feed="iex",
            )
        )
    except Exception as exc:
        logger.warning("Alpaca OHLCV fetch failed for %s: %s", ticker, exc)
        return None

    df = bars.df
    if df is None or df.empty:
        return None

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


# ── Provider class ────────────────────────────────────────────────────────────

class AlpacaProvider(DataProvider):
    """
    Scanner data provider backed by Alpaca (IEX feed, free plan).

    Use this only if you have Alpaca keys and prefer the Alpaca universe
    over the default S&P 500 + yfinance combination.

    The full Alpaca universe (~8 000+ tradable US equities) is available
    via get_symbols("alpaca_full"). The "sp500" fallback still uses a
    static list because Alpaca has no universe concept.
    """

    def get_symbols(self, universe: str = "sp500") -> list[str]:
        if universe == "alpaca_full":
            try:
                syms = _get_all_tradable_symbols_sync()
                logger.info("Alpaca universe: %d symbols", len(syms))
                return syms
            except Exception as exc:
                logger.warning("Alpaca get_symbols failed: %s", exc)
        # Fall back to SP500 static list
        from backend.providers.yfinance_provider import _get_sp500_symbols
        return _get_sp500_symbols()

    async def get_snapshot(self, symbols: list[str]) -> list[dict]:
        return await asyncio.to_thread(_snapshot_sync, symbols)

    async def get_daily_bars(self, symbol: str, days: int = 60) -> Optional[pd.DataFrame]:
        return await asyncio.to_thread(_daily_bars_sync, symbol, days)


# ── Standalone quote function (used by portfolio for live P&L) ────────────────

def _latest_quote_sync(ticker: str) -> Optional[dict]:
    """Returns {bid, ask} or None. Used for live portfolio P&L, not for scanning."""
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
    """
    Public async wrapper for live Alpaca quotes.
    Used by portfolio module to show live bid/ask for open positions.
    This is intentionally NOT part of the DataProvider interface because
    quotes are broker-specific, not data-source-specific.
    """
    from backend.config import settings
    if not (settings.alpaca_api_key and settings.alpaca_secret_key):
        return None
    return await asyncio.to_thread(_latest_quote_sync, ticker)
