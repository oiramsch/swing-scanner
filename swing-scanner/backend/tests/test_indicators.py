"""
Unit tests for technical indicator calculations (backend/screener.py).
Uses synthetic OHLCV DataFrames — no network calls.
"""
import numpy as np
import pandas as pd
import pytest

from backend.screener import compute_indicators


def _make_ohlcv(closes: list[float], volume: int = 1_000_000) -> pd.DataFrame:
    """Build a minimal OHLCV DataFrame from a list of close prices."""
    n = len(closes)
    closes_arr = np.array(closes, dtype=float)
    highs = closes_arr * 1.01
    lows = closes_arr * 0.99
    return pd.DataFrame(
        {
            "Open": closes_arr,
            "High": highs,
            "Low": lows,
            "Close": closes_arr,
            "Volume": [volume] * n,
        }
    )


def test_rsi_basic():
    """RSI on an alternating price series (equal gains and losses) should be ~50."""
    # Alternating +1/-1: avg_gain == avg_loss → RSI ≈ 50
    closes = [100.0 + (1.0 if i % 2 == 0 else -1.0) for i in range(60)]
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    rsi = result["RSI_14"].dropna()
    assert len(rsi) > 0, "RSI_14 should have non-NaN values after 14 bars"
    rsi_val = float(rsi.iloc[-1])
    assert 40.0 <= rsi_val <= 60.0, f"RSI expected ~50 for equal gains/losses, got {rsi_val:.1f}"


def test_rsi_overbought():
    """Strictly rising prices for 60 bars → RSI_14 should exceed 70."""
    closes = [100.0 + i for i in range(60)]
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    rsi = float(result["RSI_14"].iloc[-1])
    assert rsi > 70.0, f"Expected RSI > 70 for rising prices, got {rsi:.1f}"


def test_rsi_oversold():
    """Strictly falling prices for 60 bars → RSI_14 should be below 30."""
    closes = [200.0 - i for i in range(60)]
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    rsi = float(result["RSI_14"].iloc[-1])
    assert rsi < 30.0, f"Expected RSI < 30 for falling prices, got {rsi:.1f}"


def test_sma_calculation():
    """SMA_20 over a known price series must match the arithmetic mean."""
    # Prices 1..60 — last 20 values are 41..60, mean = (41+60)/2 = 50.5
    closes = list(range(1, 61))
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    sma20 = float(result["SMA_20"].iloc[-1])
    expected = float(np.mean(range(41, 61)))  # 50.5
    assert abs(sma20 - expected) < 0.01, f"SMA_20 expected {expected}, got {sma20}"


def test_atr_positive():
    """ATR must always be strictly positive when prices move."""
    closes = [100.0 + (i % 10) for i in range(60)]
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    atr = result["ATRr_14"].dropna()
    atr = atr[atr > 0]  # skip warm-up zeros (first ~window_size bars)
    assert len(atr) > 0, "ATRr_14 should produce non-NaN values after warm-up"
    assert all(atr > 0), "Every ATR value must be positive"


def test_connors_rsi2():
    """
    RSI-2 should react more sensitively than RSI-14 to a recent sharp move.
    After a long flat period followed by a sharp rise, RSI-2 > RSI-14.
    """
    flat = [100.0] * 50
    spike = [100.0 + i * 3 for i in range(1, 11)]  # sharp 10-bar rally
    closes = flat + spike
    df = _make_ohlcv(closes)
    result = compute_indicators(df)
    rsi2 = float(result["RSI_2"].iloc[-1])
    rsi14 = float(result["RSI_14"].iloc[-1])
    assert rsi2 >= rsi14, (
        f"RSI-2 ({rsi2:.1f}) should be at least as overbought as RSI-14 ({rsi14:.1f}) "
        "after a sharp spike on top of a flat base"
    )
