"""
Watchlist management and daily alert checking.
"""
import logging
from datetime import date
from typing import Optional

from backend.database import (
    WatchlistItem,
    get_watchlist,
    save_watchlist_item,
    delete_watchlist_item,
    update_watchlist_item,
)
from backend.screener import fetch_ohlcv, compute_indicators

logger = logging.getLogger(__name__)


def add_to_watchlist(data: dict) -> WatchlistItem:
    item = WatchlistItem(
        ticker=data["ticker"].upper(),
        added_date=date.today(),
        reason=data.get("reason", ""),
        alert_condition=data.get("alert_condition", ""),
        sector=data.get("sector"),
        scan_result_id=data.get("scan_result_id"),
    )
    return save_watchlist_item(item)


def _evaluate_condition(condition: str, close: float, rsi: float) -> bool:
    """
    Simple condition evaluator.
    Supports: "Price > 150", "Price < 100", "RSI < 50", "RSI > 70"
    """
    if not condition:
        return False
    try:
        cond = condition.strip()
        if cond.lower().startswith("price"):
            parts = cond.split()
            op = parts[1]
            val = float(parts[2])
            if op == ">":
                return close > val
            elif op == "<":
                return close < val
            elif op == ">=":
                return close >= val
            elif op == "<=":
                return close <= val
        elif cond.lower().startswith("rsi"):
            parts = cond.split()
            op = parts[1]
            val = float(parts[2])
            if op == ">":
                return rsi > val
            elif op == "<":
                return rsi < val
            elif op == ">=":
                return rsi >= val
            elif op == "<=":
                return rsi <= val
    except Exception:
        pass
    return False


async def check_watchlist_alerts() -> list[WatchlistItem]:
    """Check all active watchlist items for triggered conditions."""
    items = get_watchlist()
    triggered = []

    for item in items:
        if item.triggered:
            continue
        try:
            df = await fetch_ohlcv(item.ticker, days=30)
            if df is None:
                continue
            df = compute_indicators(df)
            latest = df.iloc[-1]
            close = float(latest["Close"])
            rsi = float(latest.get("RSI_14") or 50)

            if _evaluate_condition(item.alert_condition, close, rsi):
                update_watchlist_item(item.id, {
                    "triggered": True,
                    "triggered_date": date.today(),
                })
                item.triggered = True
                item.triggered_date = date.today()
                triggered.append(item)
                logger.info("Watchlist alert triggered: %s — %s", item.ticker, item.alert_condition)
        except Exception as exc:
            logger.warning("Watchlist check failed for %s: %s", item.ticker, exc)

    return triggered


async def get_watchlist_with_prices() -> list[dict]:
    """Return watchlist items enriched with current price and distance to alert."""
    items = get_watchlist()
    enriched = []

    for item in items:
        data = item.model_dump()
        try:
            df = await fetch_ohlcv(item.ticker, days=20)
            if df is not None:
                df = compute_indicators(df)
                latest = df.iloc[-1]
                close = float(latest["Close"])
                rsi = float(latest.get("RSI_14") or 50)
                data["current_price"] = round(close, 2)
                data["current_rsi"] = round(rsi, 1)
                data["condition_met"] = _evaluate_condition(item.alert_condition, close, rsi)
        except Exception:
            data["current_price"] = None
            data["current_rsi"] = None
            data["condition_met"] = False
        enriched.append(data)

    return enriched
