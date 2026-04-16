"""
Phase 3 — Alpaca order execution (bracket orders, order management).
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional, Union

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
        "daytrade_count":  int(getattr(acc, "daytrade_count", 0) or 0),
    }


def place_bracket_order(
    creds: dict,
    *,
    ticker: str,
    qty: float,
    limit_price: Union[Decimal, float],
    take_profit_price: Union[Decimal, float],
    stop_loss_price: Union[Decimal, float],
) -> dict:
    """
    Place a GTC bracket limit order: entry limit + take-profit limit + stop-loss stop.
    GTC ensures child orders (TP/SL) persist across trading days and do not expire at close.
    """
    from alpaca.trading.requests import LimitOrderRequest, TakeProfitRequest, StopLossRequest
    from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

    client = _get_trading_client(creds)
    req = LimitOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.BUY,
        limit_price=round(limit_price, 2),
        time_in_force=TimeInForce.GTC,
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(limit_price=round(take_profit_price, 2)),
        stop_loss=StopLossRequest(stop_price=round(stop_loss_price, 2)),
    )
    order = client.submit_order(req)
    logger.info("Bracket order placed: %s × %s @ %s SL=%s TP=%s",
                ticker, qty, limit_price, stop_loss_price, take_profit_price)
    return _order_to_dict(order)


def place_short_bracket_order(
    creds: dict,
    *,
    ticker: str,
    qty: float,
    limit_price: Union[Decimal, float],
    take_profit_price: Union[Decimal, float],
    stop_loss_price: Union[Decimal, float],
) -> dict:
    """
    Place a short sell bracket order (GTC): sell-short entry + buy-to-cover stop + buy-to-cover limit.
    Only executes on paper accounts (guard enforced here and in AlpacaConnector).
    GTC ensures child orders persist across trading days.
    """
    if not creds.get("is_paper", True):
        raise ValueError("Short selling nur auf Paper-Konto erlaubt.")

    from alpaca.trading.requests import LimitOrderRequest, TakeProfitRequest, StopLossRequest
    from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

    client = _get_trading_client(creds)
    req = LimitOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.SELL,                                     # sell short
        limit_price=round(limit_price, 2),
        time_in_force=TimeInForce.GTC,
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(limit_price=round(take_profit_price, 2)),  # buy to cover
        stop_loss=StopLossRequest(stop_price=round(stop_loss_price, 2)),         # buy to cover
    )
    order = client.submit_order(req)
    logger.info(
        "Short bracket order placed: %s × %s @ %s SL=%s TP=%s",
        ticker, qty, limit_price, stop_loss_price, take_profit_price,
    )
    return _order_to_dict(order)


def get_open_orders(creds: dict) -> list[dict]:
    """
    Return all non-terminal orders from Alpaca.
    We query ALL orders and filter client-side to also catch bracket child orders
    that may be in 'held' or 'accepted' status (not always returned by OPEN filter).
    """
    from alpaca.trading.requests import GetOrdersRequest
    from alpaca.trading.enums import QueryOrderStatus
    _TERMINAL = {"filled", "expired", "canceled", "cancelled", "rejected", "replaced"}
    client = _get_trading_client(creds)
    orders = client.get_orders(GetOrdersRequest(status=QueryOrderStatus.ALL, limit=100))
    return [_order_to_dict(o) for o in orders
            if (o.status.value if hasattr(o.status, "value") else str(o.status)) not in _TERMINAL]


def cancel_order(creds: dict, order_id: str) -> None:
    client = _get_trading_client(creds)
    client.cancel_order_by_id(order_id)
    logger.info("Order cancelled: %s", order_id)


def replace_order(
    creds: dict,
    order_id: str,
    *,
    limit_price: Optional[float] = None,
    stop_price: Optional[float] = None,
) -> dict:
    """
    Replace (modify) an existing order — change its limit or stop price.
    SELL LIMIT (TP): pass limit_price.
    SELL STOP  (SL): pass stop_price.
    """
    from alpaca.trading.requests import ReplaceOrderRequest
    client = _get_trading_client(creds)
    req = ReplaceOrderRequest(
        limit_price=round(limit_price, 2) if limit_price is not None else None,
        stop_price=round(stop_price, 2) if stop_price is not None else None,
    )
    order = client.replace_order_by_id(order_id, req)
    logger.info("Order replaced: %s → limit=%s stop=%s", order_id, limit_price, stop_price)
    return _order_to_dict(order)


def get_alpaca_positions(creds: dict) -> list[dict]:
    """Return all open positions from Alpaca."""
    client = _get_trading_client(creds)
    positions = client.get_all_positions()
    return [_position_to_dict(p) for p in positions]


def place_market_sell(creds: dict, *, ticker: str, qty: float) -> dict:
    """Place a market sell order for an existing position."""
    from alpaca.trading.requests import MarketOrderRequest
    from alpaca.trading.enums import OrderSide, TimeInForce

    client = _get_trading_client(creds)
    req = MarketOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.DAY,
    )
    order = client.submit_order(req)
    logger.info("Market sell order placed: %s × %s", ticker, qty)
    return _order_to_dict(order)


def place_limit_sell(
    creds: dict,
    *,
    ticker: str,
    qty: float,
    limit_price: Union[Decimal, float],
) -> dict:
    """Place a standalone SELL LIMIT order (Take-Profit without bracket)."""
    from alpaca.trading.requests import LimitOrderRequest
    from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

    client = _get_trading_client(creds)
    req = LimitOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.SELL,
        limit_price=round(float(limit_price), 2),
        time_in_force=TimeInForce.GTC,
        order_class=OrderClass.SIMPLE,
    )
    order = client.submit_order(req)
    logger.info("Limit sell placed: %s × %s @ %s", ticker, qty, limit_price)
    return _order_to_dict(order)


def place_stop_sell(
    creds: dict,
    *,
    ticker: str,
    qty: float,
    stop_price: Union[Decimal, float],
) -> dict:
    """Place a standalone SELL STOP order (Stop-Loss without bracket)."""
    from alpaca.trading.requests import StopOrderRequest
    from alpaca.trading.enums import OrderSide, TimeInForce

    client = _get_trading_client(creds)
    req = StopOrderRequest(
        symbol=ticker.upper(),
        qty=qty,
        side=OrderSide.SELL,
        stop_price=round(float(stop_price), 2),
        time_in_force=TimeInForce.GTC,
    )
    order = client.submit_order(req)
    logger.info("Stop sell placed: %s × %s @ %s", ticker, qty, stop_price)
    return _order_to_dict(order)


def _position_to_dict(pos) -> dict:
    return {
        "ticker":           str(pos.symbol),
        "qty":              float(pos.qty),
        "avg_entry_price":  float(pos.avg_entry_price),
        "current_price":    float(pos.current_price) if pos.current_price else None,
        "market_value":     float(pos.market_value) if pos.market_value else None,
        "unrealized_pl":    float(pos.unrealized_pl) if pos.unrealized_pl else None,
        "unrealized_plpc":  float(pos.unrealized_plpc) if pos.unrealized_plpc else None,
        "side":             str(pos.side),
        "cost_basis":       float(pos.cost_basis) if pos.cost_basis else None,
    }


def _order_to_dict(order) -> dict:
    return {
        "id":               str(order.id),
        "ticker":           str(order.symbol),
        "qty":              float(order.qty or 0),
        "filled_qty":       float(order.filled_qty or 0),
        "status":           order.status.value if hasattr(order.status, "value") else str(order.status),
        "side":             order.side.value if hasattr(order.side, "value") else str(order.side),
        "type":             order.order_type.value if hasattr(order.order_type, "value") else str(order.order_type),
        "limit_price":      float(order.limit_price) if order.limit_price else None,
        "stop_price":       float(order.stop_price) if order.stop_price else None,
        "created_at":       str(order.created_at),
        "filled_at":        str(order.filled_at) if order.filled_at else None,
        "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None,
    }
