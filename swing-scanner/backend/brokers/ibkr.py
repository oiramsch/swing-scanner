"""
IBKR (Interactive Brokers) broker connector — Phase 8.8.

Uses IBKR Client Portal Gateway REST API (https://localhost:5000 by default).
The user must run the CP Gateway locally (Docker or native binary):
  docker run -p 5000:5000 interactivebrokers/cpwebapi

Auth: The CP Gateway handles broker authentication via a web UI on first launch.
      Once authenticated, subsequent calls use a session cookie (auto-refreshed).

Capabilities vs. other brokers:
  supports_short_selling  = True   (full margin accounts)
  supports_us_stocks      = True   (US + 150+ global markets)
  supports_inverse_etfs   = True
  supports_options        = True   (unlike Alpaca Free)
  supports_derivatives    = True   (futures, warrants, structured products)
  execution_mode          = "api"

Fee model (IBKR Fixed Tiered — typical retail):
  $0.005 per share, min $0.35, max 1% of trade value.

Note for SaaS: IBKR requires Third-Party Vendor approval for multi-user apps.
  For personal use with own account: no approval needed.
  SaaS registration: webapionboarding@interactivebrokers.com

LYNX shares the same TWS/CP Gateway infrastructure — IBKR integration covers
LYNX accounts automatically.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import requests
import urllib3

from backend.brokers.base import BrokerConnector

# CP Gateway uses a self-signed cert — suppress InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)


class IBKRConnector(BrokerConnector):
    broker_type = "ibkr"
    currency = "USD"

    # ── Capability flags (see base.py + spec) ─────────────────────────────
    supports_short_selling = True
    supports_fractional_shares = False   # IBKR Standard does not support fractional
    supports_us_stocks = True
    supports_inverse_etfs = True
    supports_options = True
    supports_derivatives = True          # Futures, warrants, structured products
    execution_mode = "api"

    # Fee model (IBKR Fixed Tiered)
    FEE_MODEL = {
        "type":      "tiered",
        "per_share": 0.005,    # $0.005/share
        "min":       0.35,     # min $0.35 per order
        "max_pct":   1.0,      # max 1% of trade value
    }

    def __init__(self, connection: dict):
        super().__init__(connection)
        from backend.config import settings
        self._gateway_url = (
            connection.get("base_url")
            or settings.ibkr_gateway_url
            or "https://localhost:5000"
        ).rstrip("/")

    def supports_auto_trade(self) -> bool:
        return True

    def _session(self) -> requests.Session:
        s = requests.Session()
        s.verify = False  # CP Gateway uses self-signed certificate
        s.headers.update({
            "Content-Type": "application/json",
            "User-Agent":   "SwingScanner/3.2",
        })
        return s

    def _get(self, path: str, timeout: int = 10) -> dict:
        url = f"{self._gateway_url}/v1/api{path}"
        resp = self._session().get(url, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, data: dict, timeout: int = 10) -> dict:
        url = f"{self._gateway_url}/v1/api{path}"
        resp = self._session().post(url, json=data, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    # ── Required interface ─────────────────────────────────────────────────

    def get_balance(self) -> dict:
        """
        Fetch account info from IBKR CP Gateway.
        Falls back to manual_balance if gateway is unreachable.
        """
        try:
            accounts = self._get("/portfolio/accounts")
            if not accounts:
                raise ValueError("No accounts returned")

            account_id = accounts[0].get("id") or accounts[0].get("accountId")
            if not account_id:
                raise ValueError("No account ID in response")

            summary = self._get(f"/portfolio/{account_id}/summary")
            # IBKR summary is a dict of {key: {amount, currency, ...}}
            buying_power = (
                summary.get("availablefunds", {}).get("amount")
                or summary.get("buyingpower", {}).get("amount")
                or 0.0
            )
            net_liq = (
                summary.get("netliquidation", {}).get("amount")
                or 0.0
            )
            return {
                "buying_power":    float(buying_power),
                "net_liquidation": float(net_liq),
                "currency":        "USD",
                "account_id":      account_id,
                "is_paper":        self.is_paper,
                "manual":          False,
            }
        except Exception as exc:
            logger.warning("IBKR CP Gateway unreachable (%s), using manual_balance", exc)
            balance = self.connection.get("manual_balance") or 0.0
            return {
                "buying_power": float(balance),
                "currency":     "USD",
                "is_paper":     self.is_paper,
                "manual":       True,
                "error":        str(exc),
            }

    def place_order(self, plan: dict) -> dict:
        """
        Place a bracket order via IBKR CP Gateway.
        plan keys: ticker, qty, entry_high, stop_loss, target
        """
        try:
            accounts = self._get("/portfolio/accounts")
            account_id = accounts[0].get("id") or accounts[0].get("accountId")

            ticker  = plan["ticker"].upper()
            qty     = int(plan["qty"])
            limit_p = round(float(plan["entry_high"]), 2)
            stop_p  = round(float(plan["stop_loss"]), 2)
            target_p = round(float(plan["target"]), 2) if plan.get("target") else None

            # IBKR OMS order structure
            orders = [
                {
                    "acctId":     account_id,
                    "conid":      self._resolve_conid(ticker),
                    "orderType":  "LMT",
                    "price":      limit_p,
                    "side":       "BUY",
                    "quantity":   qty,
                    "tif":        "DAY",
                }
            ]
            # Attach bracket legs if target is provided
            if target_p:
                orders[0]["isSingleGroup"] = True
                orders.append({
                    "acctId":    account_id,
                    "conid":     self._resolve_conid(ticker),
                    "orderType": "STP",
                    "price":     stop_p,
                    "side":      "SELL",
                    "quantity":  qty,
                    "tif":       "GTC",
                })
                orders.append({
                    "acctId":    account_id,
                    "conid":     self._resolve_conid(ticker),
                    "orderType": "LMT",
                    "price":     target_p,
                    "side":      "SELL",
                    "quantity":  qty,
                    "tif":       "GTC",
                })

            result = self._post(f"/iserver/account/{account_id}/orders", {"orders": orders})
            logger.info("IBKR order placed: %s × %d @ %.2f SL=%.2f", ticker, qty, limit_p, stop_p)
            return {"status": "submitted", "result": result, "ticker": ticker, "qty": qty}

        except Exception as exc:
            raise RuntimeError(
                f"IBKR order failed: {exc}\n"
                "Stellen Sie sicher, dass der IBKR Client Portal Gateway läuft "
                f"(Standard: {self._gateway_url}) und Sie eingeloggt sind."
            )

    def get_portfolio(self) -> list[dict]:
        """Fetch open positions from IBKR CP Gateway."""
        try:
            accounts = self._get("/portfolio/accounts")
            account_id = accounts[0].get("id") or accounts[0].get("accountId")
            positions = self._get(f"/portfolio/{account_id}/positions/0")
            return [
                {
                    "ticker":        p.get("ticker") or p.get("contractDesc", ""),
                    "qty":           p.get("position", 0),
                    "avg_cost":      p.get("avgCost", 0),
                    "market_price":  p.get("mktPrice", 0),
                    "market_value":  p.get("mktValue", 0),
                    "unrealized_pnl": p.get("unrealizedPnl", 0),
                }
                for p in (positions or [])
            ]
        except Exception as exc:
            logger.warning("IBKR portfolio fetch failed: %s", exc)
            return []

    def get_short_availability(self, ticker: str) -> Optional[bool]:
        """
        Check if a stock is available for short selling (shortable flag).
        Returns True/False/None (None = unknown / gateway unavailable).
        """
        try:
            result = self._get(f"/iserver/secdef/search?symbol={ticker}&secType=STK")
            if result and isinstance(result, list):
                return result[0].get("shortable", None)
        except Exception:
            pass
        return None

    def test_connection(self) -> dict:
        """Test CP Gateway connectivity and auth status."""
        try:
            status = self._get("/iserver/auth/status")
            authenticated = status.get("authenticated", False)
            connected = status.get("connected", False)
            return {
                "ok":            authenticated and connected,
                "authenticated": authenticated,
                "connected":     connected,
                "gateway_url":   self._gateway_url,
                "message":       "OK" if (authenticated and connected) else
                                 "Gateway erreichbar, aber nicht eingeloggt." if connected else
                                 "Gateway nicht erreichbar.",
            }
        except requests.exceptions.ConnectionError:
            return {
                "ok":          False,
                "gateway_url": self._gateway_url,
                "message":     (
                    f"IBKR Client Portal Gateway nicht erreichbar ({self._gateway_url}). "
                    "Bitte Gateway starten: docker run -p 5000:5000 interactivebrokers/cpwebapi"
                ),
            }
        except Exception as exc:
            return {"ok": False, "gateway_url": self._gateway_url, "message": str(exc)}

    def calculate_fee(self, shares: int, price: float) -> float:
        """Calculate IBKR tiered commission for an order."""
        trade_value = shares * price
        fee = shares * self.FEE_MODEL["per_share"]
        fee = max(fee, self.FEE_MODEL["min"])
        fee = min(fee, trade_value * self.FEE_MODEL["max_pct"] / 100)
        return round(fee, 4)

    # ── Private helpers ────────────────────────────────────────────────────

    def _resolve_conid(self, ticker: str) -> int:
        """
        Resolve ticker symbol to IBKR contract ID (conid).
        Required for all order placements.
        """
        result = self._get(f"/iserver/secdef/search?symbol={ticker}&secType=STK")
        if not result or not isinstance(result, list):
            raise ValueError(f"Could not resolve conid for {ticker}")
        conid = result[0].get("conid")
        if not conid:
            raise ValueError(f"No conid in IBKR response for {ticker}: {result}")
        return int(conid)
