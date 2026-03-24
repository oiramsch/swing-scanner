"""
DataProvider factory.

Reads DATA_PROVIDER from .env and returns the appropriate implementation.
Import get_data_provider() wherever market data is needed.

Usage:
    from backend.providers import get_data_provider
    provider = get_data_provider()
    symbols  = provider.get_symbols("sp500")
    snapshot = await provider.get_snapshot(symbols)
    bars     = await provider.get_daily_bars("AAPL", days=60)
"""
from __future__ import annotations

from functools import lru_cache

from backend.providers.base import DataProvider


@lru_cache(maxsize=1)
def get_data_provider() -> DataProvider:
    """Return the configured DataProvider singleton (cached after first call)."""
    from backend.config import settings

    name = settings.data_provider.lower()

    if name == "yfinance":
        from backend.providers.yfinance_provider import YFinanceProvider
        provider = YFinanceProvider(
            custom_symbols_file=settings.custom_symbols_file,
        )
    elif name == "alpaca":
        from backend.providers.alpaca_provider import AlpacaProvider
        provider = AlpacaProvider()
    else:
        raise ValueError(
            f"Unknown DATA_PROVIDER='{settings.data_provider}'. "
            "Valid values: yfinance, alpaca"
        )

    import logging
    logging.getLogger(__name__).info(
        "DataProvider: %s | universe: %s", name, settings.stock_universe
    )
    return provider


__all__ = ["get_data_provider", "DataProvider"]
