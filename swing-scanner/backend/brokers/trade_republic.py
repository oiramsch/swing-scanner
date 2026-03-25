"""
Trade Republic broker connector.
Phase 1: manual execution (checklist + EUR conversion).
Phase 2: pytr integration (price alarms, portfolio sync, orders).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.brokers.base import BrokerConnector

logger = logging.getLogger(__name__)


def _get_eurusd_rate() -> float:
    """Fetch current EUR/USD rate via yfinance. Falls back to 1.09."""
    try:
        import yfinance as yf
        ticker = yf.Ticker("EURUSD=X")
        info = ticker.fast_info
        rate = getattr(info, "last_price", None)
        if rate and 0.5 < rate < 2.0:
            return float(rate)
    except Exception as exc:
        logger.debug("EUR/USD fetch failed: %s", exc)
    return 1.09  # safe fallback


class TRConnector(BrokerConnector):
    broker_type = "trade_republic"
    currency = "EUR"

    def supports_auto_trade(self) -> bool:
        # Phase 2: return True when pytr order placement is implemented
        return False

    def get_balance(self) -> dict:
        """
        Phase 1: returns user-entered balance from BrokerConnection.
        Phase 2: will use pytr to fetch live balance.
        """
        balance = self.connection.get("manual_balance") or 0.0
        return {
            "buying_power": float(balance),
            "currency": "EUR",
            "is_paper": False,
            "manual": True,
        }

    def place_order(self, plan: dict) -> dict:
        raise NotImplementedError(
            "Trade Republic: Bitte den Trade manuell über die TR-App ausführen. "
            "Automatisches Order-Placement ist für Phase 2 geplant."
        )

    def get_portfolio(self) -> list[dict]:
        # Phase 2: pytr portfolio sync
        return []

    def get_execution_checklist(
        self,
        plan: dict,
        eurusd_rate: Optional[float] = None,
    ) -> list[str]:
        """
        Generate step-by-step execution instructions with EUR-converted values.
        """
        if eurusd_rate is None or eurusd_rate <= 0:
            eurusd_rate = _get_eurusd_rate()

        ticker   = plan.get("ticker", "")
        isin     = plan.get("isin", "")
        entry    = float(plan.get("entry_high", 0))
        stop     = float(plan.get("stop_loss", 0))
        target   = plan.get("target")
        qty      = int(plan.get("qty", 0))
        entry_low = float(plan.get("entry_low", entry))

        # USD → EUR
        entry_eur     = self.to_local_currency(entry, eurusd_rate)
        entry_low_eur = self.to_local_currency(entry_low, eurusd_rate)
        stop_eur      = self.to_local_currency(stop, eurusd_rate)
        stop_diff_eur = round(entry_eur - stop_eur, 2)
        position_eur  = round(qty * entry_eur, 2)
        risk_eur      = round(qty * stop_diff_eur, 2)

        target_eur = self.to_local_currency(float(target), eurusd_rate) if target else None
        crv = round((float(target) - entry) / (entry - stop), 2) if (target and entry > stop) else None

        steps = [
            f"Trade Republic App öffnen",
            f"Suche: {ticker}" + (f"  (ISIN: {isin})" if isin else ""),
            f"Kauforder → Limit → {entry_eur} €"
            + (f"  (Kaufzone: {entry_low_eur} – {entry_eur} €)" if entry_low_eur != entry_eur else ""),
            f"Menge: {qty} Aktien  (Positionsgröße: ~{position_eur:,.0f} €)",
            f"Sofort nach Kauf Stop-Loss setzen: {stop_eur} €"
            + f"  (= {stop_diff_eur} € / {round(stop_diff_eur/entry_eur*100,1)}% unter Einstieg)",
            f"Max. Risiko: ~{risk_eur} €",
        ]

        if target_eur:
            crv_str = f"  → CRV {crv}" if crv else ""
            steps.append(f"Optionales Kursziel: {target_eur} €{crv_str}")

        steps.append("App schließen — nicht reinschauen! ✓")

        return steps

    def get_checklist_data(self, plan: dict, eurusd_rate: Optional[float] = None) -> dict:
        """
        Returns raw numbers + checklist for the UI to render.
        """
        if eurusd_rate is None:
            eurusd_rate = _get_eurusd_rate()

        entry  = float(plan.get("entry_high", 0))
        stop   = float(plan.get("stop_loss", 0))
        target = plan.get("target")
        qty    = int(plan.get("qty", 0))

        entry_eur  = self.to_local_currency(entry, eurusd_rate)
        stop_eur   = self.to_local_currency(stop, eurusd_rate)
        target_eur = self.to_local_currency(float(target), eurusd_rate) if target else None
        risk_eur   = round(qty * (entry_eur - stop_eur), 2)
        pos_eur    = round(qty * entry_eur, 2)
        crv        = round((float(target) - entry) / (entry - stop), 2) if (target and entry > stop) else None

        return {
            "eurusd_rate": round(eurusd_rate, 4),
            "entry_eur":   entry_eur,
            "stop_eur":    stop_eur,
            "target_eur":  target_eur,
            "risk_eur":    risk_eur,
            "position_eur": pos_eur,
            "crv":         crv,
            "qty":         qty,
            "steps":       self.get_execution_checklist(plan, eurusd_rate),
        }
