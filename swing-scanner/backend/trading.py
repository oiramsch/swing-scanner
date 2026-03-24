"""
Phase 3 — Alpaca order execution (bracket orders, order management).
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _get_trading_client(creds: dict):
    from alpaca.trading.client import TradingClient
    return TradingClient(
        api_key=creds["api_key"],
        secret_key=creds["api_secret"],
        paper=creds.get("is_paper", True),
    )


def get_account_info(creds: dict) -> dict:
    client = _get_trading_client(creds)
    acc = client.get_account()
    return {
        "buying_power":    float(acc.buying_power),
        "cash":            float(acc.cash),
        "portfolio_value": float(acc.portfolio_value),
        "currency":        str(acc.currency),
        "is_paper":        creds.get("is_paper", True),
        "status":          str(acc.status),
    }


def place_bracket_order(
    creds: dict,
    *,
    ticker: str,
    qty: float,
    limit_price: float,
    take_profit_price: float,
    stop_loss_price: float,
) -> dict:
    """
    Place a DAY bracket limit order: entry limit + take-profit limit + stop-loss stop.
    """
    from alpaca.trading.requests import LimitOrderRequest, TakeProfitRequest, StopLossRequest
    from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

    client = _get_trading_client(creds)
    req = LimitOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.BUY,
        limit_price=round(limit_price, 2),
        time_in_force=TimeInForce.DAY,
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(limit_price=round(take_profit_price, 2)),
        stop_loss=StopLossRequest(stop_price=round(stop_loss_price, 2)),
    )
    order = client.submit_order(req)
    logger.info("Bracket order placed: %s × %s @ %s SL=%s TP=%s",
                ticker, qty, limit_price, stop_loss_price, take_profit_price)
    return _order_to_dict(order)


def get_open_orders(creds: dict) -> list[dict]:
    from alpaca.trading.requests import GetOrdersRequest
    from alpaca.trading.enums import QueryOrderStatus
    client = _get_trading_client(creds)
    orders = client.get_orders(GetOrdersRequest(status=QueryOrderStatus.OPEN))
    return [_order_to_dict(o) for o in orders]


def cancel_order(creds: dict, order_id: str) -> None:
    client = _get_trading_client(creds)
    client.cancel_order_by_id(order_id)
    logger.info("Order cancelled: %s", order_id)


def _order_to_dict(order) -> dict:
    return {
        "id":               str(order.id),
        "ticker":           str(order.symbol),
        "qty":              float(order.qty or 0),
        "filled_qty":       float(order.filled_qty or 0),
        "status":           str(order.status),
        "side":             str(order.side),
        "type":             str(order.order_type),
        "limit_price":      float(order.limit_price) if order.limit_price else None,
        "created_at":       str(order.created_at),
        "filled_at":        str(order.filled_at) if order.filled_at else None,
        "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None,
    }
