"""
Daily signal checker for open portfolio positions.
Generates sell signals based on 6 criteria.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
import ta as ta_lib

from backend.database import (
    PortfolioPosition,
    SignalAlert,
    get_open_positions,
    get_signals_for_position,
    save_signal,
)
from backend.screener import fetch_ohlcv, compute_indicators

logger = logging.getLogger(__name__)


def _already_signaled(position_id: int, signal_type: str) -> bool:
    """Check if this signal type was already raised for this position today."""
    signals = get_signals_for_position(position_id)
    today = date.today()
    return any(
        s.signal_type == signal_type and s.signal_date == today
        for s in signals
    )


async def check_position_signals(pos: PortfolioPosition) -> list[SignalAlert]:
    """
    Check all 6 sell signals for a single open position.
    Returns list of new SignalAlert objects (not yet persisted).
    """
    df = await fetch_ohlcv(pos.ticker, days=60)
    if df is None or len(df) < 20:
        logger.warning("No OHLCV data for %s, skipping signal check", pos.ticker)
        return []

    df = compute_indicators(df)
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest

    close = float(latest["Close"])
    sma20 = float(latest.get("SMA_20") or 0)
    sma50 = float(latest.get("SMA_50") or 0)
    rsi = float(latest.get("RSI_14") or 50)
    atr_now = float(latest.get("ATRr_14") or 0)
    today = date.today()

    new_signals = []

    def _new(signal_type: str, description: str, severity: str):
        if _already_signaled(pos.id, signal_type):
            return
        new_signals.append(SignalAlert(
            position_id=pos.id,
            ticker=pos.ticker,
            signal_type=signal_type,
            signal_date=today,
            price_at_signal=close,
            description=description,
            severity=severity,
        ))

    # 1. Stop-Loss hit (HIGH)
    if close <= pos.stop_loss:
        _new(
            "stop_loss",
            f"Price ${close:.2f} at or below stop loss ${pos.stop_loss:.2f}",
            "high",
        )

    # 2. Price below SMA50 (HIGH)
    if sma50 > 0:
        prev_close = float(prev["Close"])
        prev_sma50 = float(prev.get("SMA_50") or 0)
        if close < sma50 and prev_close >= prev_sma50:
            _new(
                "sma50",
                f"Price crossed below SMA50 (${sma50:.2f})",
                "high",
            )

    # 3. Price below SMA20 (MEDIUM)
    if sma20 > 0 and close < sma20:
        _new(
            "sma20",
            f"Price ${close:.2f} below SMA20 ${sma20:.2f}",
            "medium",
        )

    # 4. RSI overbought (MEDIUM)
    if rsi > 70:
        _new(
            "rsi_overbought",
            f"RSI at {rsi:.1f} — overbought territory",
            "medium",
        )

    # 5. Stagnation (LOW)
    # ATR dropped below 60% of entry-day ATR AND price barely moved
    entry_date_dt = pd.Timestamp(pos.entry_date)
    entry_window = df[df.index <= entry_date_dt].tail(5)
    if not entry_window.empty and atr_now > 0:
        entry_atr = float(entry_window["ATRr_14"].iloc[-1] or 0)
        price_move_pct = abs(close - pos.entry_price) / pos.entry_price * 100
        if entry_atr > 0 and atr_now < entry_atr * 0.6 and price_move_pct < 2:
            # Check at least 5 days in trade
            days_in_trade = (today - pos.entry_date).days
            if days_in_trade >= 5:
                _new(
                    "stagnation",
                    f"ATR contracted to {atr_now:.2f} (entry: {entry_atr:.2f}), "
                    f"price only moved {price_move_pct:.1f}% in {days_in_trade} days",
                    "low",
                )

    return new_signals


async def run_portfolio_signal_check() -> list[SignalAlert]:
    """Check all open positions and persist new signals. Returns all new signals."""
    positions = get_open_positions()
    all_new_signals = []

    for pos in positions:
        try:
            new_signals = await check_position_signals(pos)
            for sig in new_signals:
                saved = save_signal(sig)
                all_new_signals.append(saved)
                logger.info(
                    "Signal: %s %s (%s) — %s",
                    pos.ticker, sig.signal_type, sig.severity, sig.description,
                )
        except Exception as exc:
            logger.error("Signal check failed for %s: %s", pos.ticker, exc)

    logger.info("Signal check complete: %d new signals for %d positions",
                len(all_new_signals), len(positions))
    return all_new_signals
