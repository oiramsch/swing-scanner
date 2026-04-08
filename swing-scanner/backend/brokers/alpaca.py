"""
Alpaca broker connector — wraps existing trading.py functions.
"""
from __future__ import annotations

from decimal import Decimal

from backend.brokers.base import BrokerConnector


class AlpacaConnector(BrokerConnector):
    broker_type = "alpaca"
    currency = "USD"
    supports_short_selling = True

    def supports_auto_trade(self) -> bool:
        return True

    def get_balance(self) -> dict:
        from backend.trading import get_account_info
        info = get_account_info(self.connection)
        info["manual"] = False
        return info

    def place_order(self, plan: dict) -> dict:
        direction = plan.get("direction", "long")
        if direction == "short":
            if not self.connection.get("is_paper", True):
                raise ValueError("Short selling nur auf Paper-Konto erlaubt.")
            from backend.trading import place_short_bracket_order
            return place_short_bracket_order(
                self.connection,
                ticker=plan["ticker"],
                qty=float(plan["qty"]),
                limit_price=Decimal(str(plan["entry_high"])),
                take_profit_price=Decimal(str(plan["target"])),
                stop_loss_price=Decimal(str(plan["stop_loss"])),
            )
        from backend.trading import place_bracket_order
        return place_bracket_order(
            self.connection,
            ticker=plan["ticker"],
            qty=float(plan["qty"]),
            limit_price=Decimal(str(plan["entry_high"])),
            take_profit_price=Decimal(str(plan["target"])),
            stop_loss_price=Decimal(str(plan["stop_loss"])),
        )

    def get_portfolio(self) -> list[dict]:
        from backend.trading import get_alpaca_positions
        return get_alpaca_positions(self.connection)
