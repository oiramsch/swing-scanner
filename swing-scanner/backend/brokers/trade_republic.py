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
        Phase 2 (pytr, if TR_PYTR_ENABLED=true): live balance from TR API.

        pytr ToS Warning: pytr is an unofficial client. Use only for personal
        accounts. Default is disabled (TR_PYTR_ENABLED=false in .env).
        """
        from backend.config import settings
        if settings.tr_pytr_enabled:
            try:
                return self._pytr_get_balance()
            except Exception as exc:
                logger.warning("pytr balance fetch failed, falling back to manual: %s", exc)

        balance = self.connection.get("manual_balance") or 0.0
        return {
            "buying_power": float(balance),
            "currency": "EUR",
            "is_paper": False,
            "manual": True,
        }

    def _pytr_get_balance(self) -> dict:
        """
        Fetch live balance from Trade Republic via pytr (unofficial client).

        Requires TR_PYTR_ENABLED=true + TR_PHONE + TR_PIN in .env.
        On first run, pytr triggers a 2FA via the TR app.
        Session is stored as .pytr_session in the app root for reuse.

        ToS risk: pytr is NOT an official TR API. Use at your own risk.
        For personal use only — do NOT use in SaaS contexts.
        """
        import asyncio
        from pathlib import Path

        try:
            from pytr.api import TradeRepublicApi
        except ImportError:
            raise RuntimeError(
                "pytr nicht installiert. Führe 'pip install pytr' aus. "
                "Beachte das ToS-Risiko bei inoffiziellen Clients."
            )

        from backend.config import settings

        phone = self.connection.get("manual_balance_note") or settings.tr_phone
        pin   = settings.tr_pin
        if not phone or not pin:
            raise RuntimeError(
                "TR_PHONE und TR_PIN müssen in .env gesetzt sein um pytr zu nutzen."
            )

        session_file = Path(__file__).parent.parent.parent / ".pytr_session"

        async def _fetch():
            api = TradeRepublicApi(
                phone_no=phone,
                pin=pin,
                locale="de",
                credentials_file=str(session_file),
            )
            await api.login()
            portfolio = await api.portfolio()
            return portfolio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, _fetch())
                    portfolio = future.result(timeout=30)
            else:
                portfolio = loop.run_until_complete(_fetch())
        except Exception as exc:
            raise RuntimeError(f"pytr Verbindungsfehler: {exc}")

        # Portfolio cash is in portfolio.cash
        cash = getattr(portfolio, "cash", None)
        if cash is None and isinstance(portfolio, dict):
            cash = portfolio.get("cash", 0.0)
        buying_power = float(cash or 0.0) / 100  # TR returns amounts in cents

        return {
            "buying_power": buying_power,
            "currency": "EUR",
            "is_paper": False,
            "manual": False,
            "source": "pytr",
        }

    def place_order(self, plan: dict) -> dict:
        raise NotImplementedError(
            "Trade Republic: Bitte den Trade manuell über die TR-App ausführen. "
            "Automatisches Order-Placement ist für Phase 2 geplant."
        )

    def get_portfolio(self) -> list[dict]:
        """
        Phase 1: empty (manual tracking).
        Phase 2 (pytr, if TR_PYTR_ENABLED=true): live positions from TR.
        """
        from backend.config import settings
        if settings.tr_pytr_enabled:
            try:
                return self._pytr_get_portfolio()
            except Exception as exc:
                logger.warning("pytr portfolio sync failed: %s", exc)
        return []

    def _pytr_get_portfolio(self) -> list[dict]:
        """Fetch positions from Trade Republic via pytr."""
        import asyncio
        from pathlib import Path

        try:
            from pytr.api import TradeRepublicApi
        except ImportError:
            raise RuntimeError("pytr nicht installiert. pip install pytr")

        from backend.config import settings
        phone = settings.tr_phone
        pin   = settings.tr_pin
        session_file = Path(__file__).parent.parent.parent / ".pytr_session"

        async def _fetch():
            api = TradeRepublicApi(
                phone_no=phone, pin=pin, locale="de",
                credentials_file=str(session_file),
            )
            await api.login()
            return await api.portfolio()

        try:
            portfolio = asyncio.run(_fetch())
        except Exception as exc:
            raise RuntimeError(f"pytr portfolio Fehler: {exc}")

        positions_raw = getattr(portfolio, "positions", None) or []
        result = []
        for p in positions_raw:
            if isinstance(p, dict):
                result.append({
                    "ticker":      p.get("instrument", {}).get("shortName", ""),
                    "isin":        p.get("instrumentId", ""),
                    "qty":         p.get("quantity", 0),
                    "avg_cost":    (p.get("averageBuyIn", 0) or 0) / 100,
                    "market_price": (p.get("currentPrice", 0) or 0) / 100,
                })
        return result

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
