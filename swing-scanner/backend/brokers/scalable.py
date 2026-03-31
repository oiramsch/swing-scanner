"""
Scalable Capital broker connector — manual checklist execution.
No official API available. Execution via Scalable Capital Web/App.
Fee model: Prime+ Flat (2.99 €/Trade) or Free Broker (0 € für ETFs, 0.99 € für Aktien).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.brokers.base import BrokerConnector

logger = logging.getLogger(__name__)


def _get_eurusd_rate() -> float:
    try:
        import yfinance as yf
        info = yf.Ticker("EURUSD=X").fast_info
        rate = getattr(info, "last_price", None)
        if rate and 0.5 < rate < 2.0:
            return float(rate)
    except Exception as exc:
        logger.debug("EUR/USD fetch failed: %s", exc)
    return 1.09


class ScalableConnector(BrokerConnector):
    broker_type = "scalable"
    currency = "EUR"
    supports_short_selling = False

    def supports_auto_trade(self) -> bool:
        return False

    def get_balance(self) -> dict:
        balance = self.connection.get("manual_balance") or 0.0
        return {
            "buying_power": float(balance),
            "currency": "EUR",
            "is_paper": False,
            "manual": True,
        }

    def place_order(self, plan: dict) -> dict:
        raise NotImplementedError(
            "Scalable Capital: Bitte den Trade manuell über die Scalable-App ausführen. "
            "Kein automatisches Order-Placement verfügbar."
        )

    def get_portfolio(self) -> list[dict]:
        return []

    def get_execution_checklist(
        self,
        plan: dict,
        eurusd_rate: Optional[float] = None,
    ) -> list[str]:
        if eurusd_rate is None or eurusd_rate <= 0:
            eurusd_rate = _get_eurusd_rate()

        ticker    = plan.get("ticker", "")
        isin      = plan.get("isin", "")
        entry     = float(plan.get("entry_high", 0))
        stop      = float(plan.get("stop_loss", 0))
        target    = plan.get("target")
        qty       = int(plan.get("qty", 0))
        entry_low = float(plan.get("entry_low", entry))

        entry_eur     = self.to_local_currency(entry, eurusd_rate)
        entry_low_eur = self.to_local_currency(entry_low, eurusd_rate)
        stop_eur      = self.to_local_currency(stop, eurusd_rate)
        stop_diff_eur = round(entry_eur - stop_eur, 2)
        position_eur  = round(qty * entry_eur, 2)
        risk_eur      = round(qty * stop_diff_eur, 2)
        target_eur    = self.to_local_currency(float(target), eurusd_rate) if target else None
        crv = round((float(target) - entry) / (entry - stop), 2) if (target and entry > stop) else None

        steps = [
            "Scalable Capital App oder Web öffnen (app.scalable.capital)",
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
            "eurusd_rate":   round(eurusd_rate, 4),
            "entry_eur":     entry_eur,
            "stop_eur":      stop_eur,
            "target_eur":    target_eur,
            "risk_eur":      risk_eur,
            "position_eur":  pos_eur,
            "crv":           crv,
            "qty":           qty,
            "steps":         self.get_execution_checklist(plan, eurusd_rate),
        }
