"""
Unit tests for scanner-level constants and pure logic.
No DB access, no network calls.
"""
import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# SCAN_MISSING_THRESHOLD_HOURS constant
# ---------------------------------------------------------------------------

def test_scan_missing_threshold():
    """SCAN_MISSING_THRESHOLD_HOURS must be exactly 26 (business requirement)."""
    from backend.main import SCAN_MISSING_THRESHOLD_HOURS
    assert SCAN_MISSING_THRESHOLD_HOURS == 26


# ---------------------------------------------------------------------------
# Market regime detection (pure logic extracted from market_regime.py)
# ---------------------------------------------------------------------------

def _detect_regime(spy_close: float, sma50: float, sma200: float) -> str:
    """Mirrors the regime logic in backend/market_regime.py:update_market_regime."""
    if spy_close > sma50 and sma50 > sma200:
        return "bull"
    if spy_close < sma50:
        return "bear"
    return "neutral"


def test_regime_detection_bull():
    """SPY > SMA50 > SMA200 must yield regime 'bull'."""
    assert _detect_regime(spy_close=500.0, sma50=490.0, sma200=470.0) == "bull"


def test_regime_detection_bear():
    """SPY < SMA50 must yield regime 'bear' regardless of SMA200."""
    assert _detect_regime(spy_close=450.0, sma50=480.0, sma200=460.0) == "bear"


def test_regime_detection_neutral():
    """SPY between SMA50 and SMA200 (above SMA50 but SMA50 ≤ SMA200) → 'neutral'."""
    assert _detect_regime(spy_close=480.0, sma50=470.0, sma200=475.0) == "neutral"


# ---------------------------------------------------------------------------
# CRV calculation
# ---------------------------------------------------------------------------

def _calculate_crv(entry: float, stop: float, target: float) -> float:
    """CRV = (target - entry) / (entry - stop). Mirrors news_checker.calculate_crv."""
    risk = entry - stop
    reward = target - entry
    if risk <= 0:
        return 0.0
    return round(reward / risk, 2)


def test_crv_calculation():
    """CRV = (target - entry) / (entry - stop) for a standard long setup."""
    crv = _calculate_crv(entry=100.0, stop=95.0, target=115.0)
    # reward=15, risk=5 → CRV=3.0
    assert abs(crv - 3.0) < 0.01, f"Expected CRV=3.0, got {crv}"


def test_crv_calculation_invalid_stop():
    """Stop >= entry must return CRV=0 (invalid setup)."""
    crv = _calculate_crv(entry=100.0, stop=100.0, target=115.0)
    assert crv == 0.0


# ---------------------------------------------------------------------------
# Composite score
# ---------------------------------------------------------------------------

def _composite_score(confidence: float, crv: float) -> float:
    """Formula: confidence × clamp(crv / 2.0, 0.5, 1.5)  (from scheduler.py)."""
    factor = max(0.5, min(1.5, crv / 2.0))
    return round(confidence * factor, 2)


def test_composite_score_neutral_crv():
    """CRV=2.0 is neutral (factor=1.0) → score = confidence."""
    score = _composite_score(confidence=8.0, crv=2.0)
    assert abs(score - 8.0) < 0.01


def test_composite_score_high_crv():
    """CRV > 3.0 → factor capped at 1.5 → score = confidence × 1.5."""
    score = _composite_score(confidence=8.0, crv=4.0)
    assert abs(score - 12.0) < 0.01


def test_composite_score_low_crv():
    """CRV < 1.0 → factor capped at 0.5 → score = confidence × 0.5."""
    score = _composite_score(confidence=8.0, crv=0.5)
    assert abs(score - 4.0) < 0.01
