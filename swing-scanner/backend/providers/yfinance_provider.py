"""
YFinanceProvider — free, no API key needed.

Used as the primary data source for the scanner (Phase 1-2).
All yfinance calls are synchronous and wrapped in asyncio.to_thread()
so they don't block the FastAPI event loop.

Universe strategy:
  S&P 500 list is fetched from Wikipedia on first run and cached locally
  in backend/data/sp500_cache.json (refreshed every 7 days).
  A static fallback list (50 major symbols) is used if Wikipedia is unreachable.

Batch efficiency:
  get_snapshot() downloads ALL symbols in a single yf.download() call
  instead of one request per ticker.  For ~500 S&P 500 symbols this
  takes ~3-8 seconds and avoids thousands of individual HTTP requests.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

from backend.providers.base import DataProvider

logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
_SP500_CACHE = _DATA_DIR / "sp500_cache.json"
_CACHE_TTL_DAYS = 7

# ── Static fallback (used when Wikipedia is unreachable) ──────────────────────
_SP500_FALLBACK = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "AMD", "INTC", "QCOM",
    "TXN", "MU", "AMAT", "KLAC", "LRCX", "ADI", "CDNS", "SNPS", "FTNT",
    "PANW", "CRWD", "MCHP", "MPWR", "ANSS", "KEYS", "EPAM",
    # Communication
    "META", "GOOGL", "GOOG", "NFLX", "CMCSA", "DIS", "TMUS", "VZ", "T",
    "EA", "TTWO", "WBD",
    # Consumer Discretionary
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "BKNG", "TJX", "SBUX",
    "CMG", "MAR", "HLT", "ROST", "DHI", "LEN", "EBAY",
    # Consumer Staples
    "WMT", "PG", "KO", "PEP", "COST", "PM", "MO", "CL", "KMB",
    "GIS", "K", "HRL", "CAG", "MKC", "CHD", "CLX",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "SPGI", "MCO",
    "CME", "ICE", "CB", "MET", "PRU", "AFL", "TRV", "SCHW", "BK",
    # Healthcare
    "UNH", "LLY", "JNJ", "ABBV", "MRK", "ABT", "TMO", "DHR", "BMY",
    "AMGN", "GILD", "ISRG", "VRTX", "MDT", "SYK", "REGN", "BIIB",
    # Energy
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY",
    "HES", "BKR", "HAL", "DVN",
    # Industrials
    "UPS", "HON", "UNP", "RTX", "CAT", "DE", "LMT", "GE", "NOC",
    "GD", "LHX", "ETN", "EMR", "PH", "ITW", "CTAS", "GWW", "FAST",
    # Materials
    "LIN", "APD", "ECL", "SHW", "NEM", "FCX", "NUE", "VMC", "MLM",
    # Utilities
    "NEE", "DUK", "SRE", "SO", "AEP", "EXC", "XEL", "ED", "WEC",
    # Real Estate
    "AMT", "PLD", "CCI", "EQIX", "PSA", "O", "SPG", "WELL", "DLR",
]


def _load_sp500_from_wikipedia() -> list[str]:
    """Fetch current S&P 500 constituents from Wikipedia. Returns [] on failure."""
    try:
        tables = pd.read_html(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            storage_options={"User-Agent": "Mozilla/5.0"},
        )
        df = tables[0]
        symbols = df["Symbol"].str.replace(".", "-", regex=False).tolist()
        logger.info("S&P 500 list fetched from Wikipedia: %d symbols", len(symbols))
        return symbols
    except Exception as exc:
        logger.warning("Wikipedia S&P 500 fetch failed: %s", exc)
        return []


def _get_sp500_symbols() -> list[str]:
    """Return S&P 500 symbol list, using local cache with 7-day TTL."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Try cache first
    if _SP500_CACHE.exists():
        try:
            cache = json.loads(_SP500_CACHE.read_text())
            cached_at = datetime.fromisoformat(cache["cached_at"])
            if datetime.now() - cached_at < timedelta(days=_CACHE_TTL_DAYS):
                return cache["symbols"]
        except Exception:
            pass  # corrupt cache — refresh below

    # Fetch fresh list
    symbols = _load_sp500_from_wikipedia()
    if symbols:
        _SP500_CACHE.write_text(json.dumps({
            "cached_at": datetime.now().isoformat(),
            "symbols": symbols,
        }))
        return symbols

    # If Wikipedia is unreachable, use stale cache if available
    if _SP500_CACHE.exists():
        try:
            return json.loads(_SP500_CACHE.read_text())["symbols"]
        except Exception:
            pass

    logger.warning("Using static fallback symbol list (%d symbols)", len(_SP500_FALLBACK))
    return _SP500_FALLBACK


def _get_custom_symbols(filepath: str) -> list[str]:
    """Load symbols from a user-supplied JSON or plain-text file."""
    path = Path(filepath)
    if not path.exists():
        logger.error("Custom symbols file not found: %s", filepath)
        return _SP500_FALLBACK
    text = path.read_text().strip()
    if path.suffix == ".json":
        data = json.loads(text)
        if isinstance(data, list):
            return [str(s).upper() for s in data]
        if isinstance(data, dict) and "symbols" in data:
            return [str(s).upper() for s in data["symbols"]]
    # Plain text: one symbol per line
    return [line.strip().upper() for line in text.splitlines() if line.strip()]


# ── Sync helpers (run in thread) ──────────────────────────────────────────────

def _snapshot_sync(symbols: list[str]) -> list[dict]:
    """
    Download last 5 days for all symbols in one batch call.
    Returns [{ticker, close, volume}] for symbols with valid data.
    """
    import yfinance as yf

    if not symbols:
        return []

    logger.info("yfinance snapshot: downloading %d symbols…", len(symbols))

    # yf.download with multiple symbols returns MultiIndex columns (field, ticker)
    # auto_adjust=True gives split/div-adjusted prices
    raw = yf.download(
        symbols,
        period="5d",
        progress=False,
        auto_adjust=True,
        threads=True,
    )

    if raw.empty:
        logger.warning("yfinance snapshot returned empty DataFrame")
        return []

    result: list[dict] = []

    # Column structure depends on number of symbols
    if len(symbols) == 1:
        # Single ticker → flat columns
        row = raw.dropna(subset=["Close"]).iloc[-1] if not raw.empty else None
        if row is not None:
            result.append({
                "ticker": symbols[0],
                "close": float(row["Close"]),
                "volume": int(row["Volume"]),
            })
    else:
        # Multiple tickers → MultiIndex (field, ticker) or (ticker, field)
        # yfinance ≥ 0.2 uses (field, ticker)
        cols = raw.columns
        if isinstance(cols, pd.MultiIndex):
            # Determine orientation
            top = cols.get_level_values(0).unique().tolist()
            if "Close" in top:
                # (field, ticker) orientation — standard in yfinance ≥ 0.2
                close_df = raw["Close"].dropna(how="all")
                volume_df = raw["Volume"].dropna(how="all")
            else:
                # (ticker, field) orientation
                close_df = raw.xs("Close", axis=1, level=1, drop_level=True).dropna(how="all")
                volume_df = raw.xs("Volume", axis=1, level=1, drop_level=True).dropna(how="all")

            for ticker in close_df.columns:
                close_series = close_df[ticker].dropna()
                vol_series = volume_df[ticker].dropna() if ticker in volume_df.columns else pd.Series()
                if close_series.empty:
                    continue
                result.append({
                    "ticker": str(ticker),
                    "close": float(close_series.iloc[-1]),
                    "volume": int(vol_series.iloc[-1]) if not vol_series.empty else 0,
                })

    logger.info("yfinance snapshot: %d/%d symbols have data", len(result), len(symbols))
    return result


def _daily_bars_sync(symbol: str, days: int) -> Optional[pd.DataFrame]:
    """Download OHLCV for a single symbol. Returns None if insufficient data."""
    import yfinance as yf

    # Download extra days to account for weekends/holidays
    period_days = days + 20
    raw = yf.download(
        symbol,
        period=f"{period_days}d",
        progress=False,
        auto_adjust=True,
    )

    if raw is None or raw.empty:
        return None

    # Flatten MultiIndex if present (single ticker sometimes still MultiIndex)
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.droplevel(1)

    df = raw[["Open", "High", "Low", "Close", "Volume"]].dropna()

    if len(df) < 30:
        return None

    # Convert DatetimeIndex to date
    df.index = pd.to_datetime(df.index).date
    df.index.name = "Date"

    return df.tail(days)


# ── Provider class ────────────────────────────────────────────────────────────

class YFinanceProvider(DataProvider):
    """
    Free data provider backed by yfinance.
    Covers S&P 500 (≈503 symbols), Russell 1000, or a custom symbol list.
    No API key required. Daily/EOD data only (sufficient for swing trading).
    """

    def __init__(self, custom_symbols_file: str = "") -> None:
        self._custom_file = custom_symbols_file

    # ── Interface implementation ───────────────────────────────────────────────

    def get_symbols(self, universe: str = "sp500") -> list[str]:
        if universe == "sp500":
            return _get_sp500_symbols()
        if universe == "russell1000":
            return self._get_russell1000()
        if universe == "custom":
            return _get_custom_symbols(self._custom_file)
        logger.warning("Unknown universe '%s' — defaulting to sp500", universe)
        return _get_sp500_symbols()

    async def get_snapshot(self, symbols: list[str]) -> list[dict]:
        return await asyncio.to_thread(_snapshot_sync, symbols)

    async def get_daily_bars(self, symbol: str, days: int = 60) -> Optional[pd.DataFrame]:
        return await asyncio.to_thread(_daily_bars_sync, symbol, days)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_russell1000(self) -> list[str]:
        """Fetch Russell 1000 from Wikipedia (cached same as S&P 500)."""
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = _DATA_DIR / "russell1000_cache.json"

        if cache_path.exists():
            try:
                cache = json.loads(cache_path.read_text())
                cached_at = datetime.fromisoformat(cache["cached_at"])
                if datetime.now() - cached_at < timedelta(days=_CACHE_TTL_DAYS):
                    return cache["symbols"]
            except Exception:
                pass

        try:
            tables = pd.read_html(
                "https://en.wikipedia.org/wiki/Russell_1000_Index",
                storage_options={"User-Agent": "Mozilla/5.0"},
            )
            # Table 2 or 3 typically has the holdings
            for tbl in tables:
                if "Ticker" in tbl.columns or "Symbol" in tbl.columns:
                    col = "Ticker" if "Ticker" in tbl.columns else "Symbol"
                    symbols = tbl[col].str.replace(".", "-", regex=False).tolist()
                    if len(symbols) > 500:
                        cache_path.write_text(json.dumps({
                            "cached_at": datetime.now().isoformat(),
                            "symbols": symbols,
                        }))
                        logger.info("Russell 1000 fetched: %d symbols", len(symbols))
                        return symbols
        except Exception as exc:
            logger.warning("Russell 1000 fetch failed: %s — falling back to S&P 500", exc)

        return _get_sp500_symbols()
