"""
Integration tests for FastAPI endpoints.
Uses the session-scoped TestClient from conftest.py (in-memory SQLite).
The auth middleware only checks for a Bearer header — no real JWT validation
on routes that don't use Depends(get_current_user), like /api/scan/status.
"""
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import patch, MagicMock

import pandas as pd
import pytest
from sqlmodel import Session, delete

from backend.database import ScanResult
from backend.main import SCAN_MISSING_THRESHOLD_HOURS

# Dummy token — passes the "starts with Bearer" middleware check
_AUTH = {"Authorization": "Bearer test-token"}


def _clear_scan_results(engine):
    with Session(engine) as s:
        s.exec(delete(ScanResult))
        s.commit()


def test_health_endpoint(test_client):
    """GET /health → 200 OK with {"status": "ok"}."""
    resp = test_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_scan_status_no_data(test_client, engine):
    """
    GET /api/scan/status with empty DB → scan_missing should be True
    (no scan has ever run).
    """
    _clear_scan_results(engine)
    resp = test_client.get("/api/scan/status", headers=_AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert body["scan_missing"] is True, (
        f"Expected scan_missing=True when DB is empty, got {body}"
    )


def test_scan_status_fresh_scan(test_client, engine):
    """
    GET /api/scan/status after inserting a recent ScanResult → scan_missing = False.
    """
    _clear_scan_results(engine)
    recent_dt = datetime.utcnow() - timedelta(hours=1)
    with Session(engine) as s:
        s.add(ScanResult(ticker="SPY", scan_date=date.today(), created_at=recent_dt))
        s.commit()

    resp = test_client.get("/api/scan/status", headers=_AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert body["scan_missing"] is False, (
        f"Expected scan_missing=False after fresh scan, got {body}"
    )
    assert body["hours_since_last_scan"] is not None
    assert body["hours_since_last_scan"] < SCAN_MISSING_THRESHOLD_HOURS


# ---------------------------------------------------------------------------
# Chart endpoint tests
# ---------------------------------------------------------------------------

def _make_fake_history(n=5):
    """Build a minimal yfinance-style DataFrame with OHLCV columns."""
    idx = pd.date_range("2025-01-02", periods=n, freq="B", tz="America/New_York")
    data = {
        "Open":   [150.0 + i for i in range(n)],
        "High":   [152.0 + i for i in range(n)],
        "Low":    [148.0 + i for i in range(n)],
        "Close":  [151.0 + i for i in range(n)],
        "Volume": [1_000_000 + i * 10_000 for i in range(n)],
    }
    return pd.DataFrame(data, index=idx)


def test_chart_endpoint_requires_auth(test_client):
    """GET /api/chart/AAPL without Bearer token → 401 from middleware."""
    resp = test_client.get("/api/chart/AAPL")
    assert resp.status_code == 401


def test_chart_endpoint_invalid_period(test_client):
    """GET /api/chart/AAPL?period=bad → 400 (route-level validation)."""
    from backend.main import app
    from backend.auth import get_current_user, AuthenticatedUser

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(email="test@example.com")
    try:
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker = MagicMock()
            mock_ticker.history.return_value = _make_fake_history()
            mock_ticker_cls.return_value = mock_ticker
            resp = test_client.get("/api/chart/AAPL?period=bad", headers=_AUTH)
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_chart_endpoint_success(test_client):
    """
    GET /api/chart/AAPL?period=3mo with mocked yfinance → 200 with correct shape.
    Verifies: symbol uppercased, bars non-empty, Decimal rounding applied,
    indicators dict present with sma50/sma200 keys.
    """
    from backend.main import app
    from backend.auth import get_current_user, AuthenticatedUser

    fake_df = _make_fake_history(n=5)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(email="test@example.com")
    try:
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker = MagicMock()
            mock_ticker.history.return_value = fake_df
            mock_ticker_cls.return_value = mock_ticker

            resp = test_client.get("/api/chart/aapl?period=3mo", headers=_AUTH)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["symbol"] == "AAPL"
    assert len(body["bars"]) == 5

    bar = body["bars"][0]
    assert set(bar.keys()) == {"time", "open", "high", "low", "close", "volume"}
    # Prices must be rounded to 2 decimal places
    assert bar["open"] == round(bar["open"], 2)
    assert isinstance(bar["volume"], int)

    assert "indicators" in body
    assert "sma50" in body["indicators"]
    assert "sma200" in body["indicators"]
    # With only 5 bars, both SMAs should be empty (not enough data)
    assert body["indicators"]["sma50"] == []
    assert body["indicators"]["sma200"] == []


def test_chart_endpoint_no_data(test_client):
    """GET /api/chart/UNKNOWN with empty yfinance response → 404."""
    from backend.main import app
    from backend.auth import get_current_user, AuthenticatedUser

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(email="test@example.com")
    try:
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker = MagicMock()
            mock_ticker.history.return_value = pd.DataFrame()
            mock_ticker_cls.return_value = mock_ticker

            resp = test_client.get("/api/chart/UNKNOWN?period=3mo", headers=_AUTH)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404
