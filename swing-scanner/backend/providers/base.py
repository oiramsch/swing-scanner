"""
Abstract DataProvider interface.

The scanner must NEVER call yfinance, alpaca, or any market-data library directly.
All data access goes through a DataProvider implementation so the source can be
swapped without touching any business logic.

Phase 1-2: YFinanceProvider (free, S&P 500 universe)
Phase 3+:  TiingoProvider / EODHDProvider / AlpacaSIPProvider (paid, when profitable)
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

import pandas as pd


class DataProvider(ABC):
    """
    Interface every market-data backend must implement.

    DataFrame contract for get_daily_bars():
      - Index: datetime.date (ascending)
      - Columns: Open, High, Low, Close, Volume  (all float/int, no NaN gaps)
      - At least `days` rows, sorted oldest-first
    """

    @abstractmethod
    def get_symbols(self, universe: str = "sp500") -> list[str]:
        """
        Return the list of ticker symbols for the requested universe.

        universe values:
          "sp500"      — S&P 500 (~503 symbols, most liquid US equities)
          "russell1000"— Russell 1000 (~1 000 symbols)
          "custom"     — loaded from CUSTOM_SYMBOLS_FILE in .env
        """

    @abstractmethod
    async def get_snapshot(self, symbols: list[str]) -> list[dict]:
        """
        Return the latest daily close and volume for every symbol in one call.

        Returns a list of dicts: {"ticker": str, "close": float, "volume": int}
        Symbols with no data are silently omitted.
        """

    @abstractmethod
    async def get_daily_bars(self, symbol: str, days: int = 60) -> Optional[pd.DataFrame]:
        """
        Return the last `days` trading-day bars for a single symbol.

        Returns None if the symbol has insufficient history.
        """
