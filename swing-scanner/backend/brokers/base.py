"""
Abstract base class for all broker connectors.
New brokers only need to implement this interface.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class BrokerConnector(ABC):
    broker_type: str = "unknown"
    currency: str = "USD"
    supports_short_selling: bool = False

    def __init__(self, connection: dict):
        self.connection = connection
        self.label = connection.get("label", self.broker_type)
        self.broker_id = connection.get("id")
        self.is_paper = connection.get("is_paper", True)

    # ------------------------------------------------------------------
    # Required
    # ------------------------------------------------------------------

    @abstractmethod
    def get_balance(self) -> dict:
        """
        Returns:
            buying_power: float
            currency: str
            is_paper: bool
            manual: bool   (True = user-entered, not live from API)
        """

    @abstractmethod
    def place_order(self, plan: dict) -> dict:
        """
        Execute a bracket order from a TradePlan dict.
        plan keys: ticker, isin, entry_high, stop_loss, target, qty
        Returns order result dict.
        Raises NotImplementedError for manual brokers.
        """

    @abstractmethod
    def get_portfolio(self) -> list[dict]:
        """Returns list of open positions."""

    # ------------------------------------------------------------------
    # Optional — override in subclasses as needed
    # ------------------------------------------------------------------

    def supports_auto_trade(self) -> bool:
        """True if place_order() can actually execute automatically."""
        return False

    def get_execution_checklist(
        self,
        plan: dict,
        eurusd_rate: float = 1.09,
    ) -> list[str]:
        """
        Step-by-step manual execution instructions for this broker.
        Returns empty list for fully automated brokers.
        """
        return []

    def to_local_currency(self, usd_amount: float, eurusd_rate: float) -> float:
        """Convert USD amount to broker's local currency."""
        if self.currency == "EUR":
            return round(usd_amount / eurusd_rate, 2)
        return round(usd_amount, 2)

    def format_balance(self) -> str:
        try:
            b = self.get_balance()
            sym = "€" if b.get("currency") == "EUR" else "$"
            val = b.get("buying_power", 0)
            tag = " (manuell)" if b.get("manual") else ""
            return f"{sym}{val:,.0f}{tag}"
        except Exception:
            return "n/v"
