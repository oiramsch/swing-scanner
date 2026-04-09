"""
Integration tests for FastAPI endpoints.
Uses the session-scoped TestClient from conftest.py (in-memory SQLite).
The auth middleware only checks for a Bearer header — no real JWT validation
on routes that don't use Depends(get_current_user), like /api/scan/status.
"""
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlmodel import Session, delete

from backend.database import ScanResult
from backend.main import SCAN_MISSING_THRESHOLD_HOURS

# Dummy token — passes the "starts with Bearer" middleware check
_AUTH = {"Authorization": "Bearer test-token"}


# ── Helpers ────────────────────────────────────────────────────────────────
def _make_ohlcv_df(n=5, tz="America/New_York"):
    """Build a minimal OHLCV DataFrame that mimics yfinance output."""
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz=tz)
    return pd.DataFrame(
        {
            "Open":   [100.0 + i for i in range(n)],
            "High":   [105.0 + i for i in range(n)],
            "Low":    [ 95.0 + i for i in range(n)],
            "Close":  [102.0 + i for i in range(n)],
            "Volume": [1_000_000] * n,
        },
        index=idx,
    )


def _make_intraday_df(n=20, tz="America/New_York"):
    """Build a minimal 15-min OHLCV DataFrame that mimics yfinance intraday output."""
    idx = pd.date_range("2026-01-02 09:30", periods=n, freq="15min", tz=tz)
    return pd.DataFrame(
        {
            "Open":   [150.0] * n,
            "High":   [152.0] * n,
            "Low":    [148.0] * n,
            "Close":  [151.0] * n,
            "Volume": [50_000] * n,
        },
        index=idx,
    )


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


# ── Chart endpoint tests (Phase A) ─────────────────────────────────────────

class TestChartEndpoint:
    """Tests for GET /api/chart/{symbol}."""

    def test_chart_returns_bars_and_indicators(self, test_client):
        """Endpoint returns OHLCV bars + sma50 + sma200 when yfinance succeeds."""
        df = _make_ohlcv_df(n=60)  # enough for sma50 to appear
        mock_ticker = MagicMock()
        mock_ticker.history.return_value = df

        with patch("yfinance.Ticker", return_value=mock_ticker):
            resp = test_client.get("/api/chart/AAPL?period=3mo", headers=_AUTH)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["symbol"] == "AAPL"
        assert len(body["bars"]) == 60
        bar = body["bars"][0]
        assert {"time", "open", "high", "low", "close", "volume"} <= bar.keys()
        assert "sma50" in body["indicators"]
        assert "sma200" in body["indicators"]

    def test_chart_invalid_period(self, test_client):
        """Unsupported period → 400."""
        resp = test_client.get("/api/chart/AAPL?period=10y", headers=_AUTH)
        assert resp.status_code == 400

    def test_chart_empty_data(self, test_client):
        """Empty DataFrame from yfinance → 404."""
        mock_ticker = MagicMock()
        mock_ticker.history.return_value = pd.DataFrame()

        with patch("yfinance.Ticker", return_value=mock_ticker):
            resp = test_client.get("/api/chart/FAKE?period=3mo", headers=_AUTH)

        assert resp.status_code == 404

    def test_chart_requires_auth(self, test_client):
        """Missing Bearer token → 401."""
        resp = test_client.get("/api/chart/AAPL")
        assert resp.status_code == 401


# ── Intraday endpoint tests (Phase B) ──────────────────────────────────────

class TestIntradayEndpoint:
    """Tests for GET /api/chart/{symbol}/intraday."""

    def test_intraday_returns_bars_with_unix_timestamps(self, test_client):
        """Endpoint returns 15-min bars with integer UNIX timestamps."""
        df = _make_intraday_df(n=20)
        mock_ticker = MagicMock()
        mock_ticker.history.return_value = df

        with patch("yfinance.Ticker", return_value=mock_ticker):
            resp = test_client.get("/api/chart/AAPL/intraday", headers=_AUTH)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["symbol"] == "AAPL"
        assert len(body["bars"]) == 20
        bar = body["bars"][0]
        assert isinstance(bar["time"], int), "time must be a UNIX timestamp (int)"
        assert {"time", "open", "high", "low", "close", "volume"} <= bar.keys()

    def test_intraday_plan_is_none_when_no_active_plan(self, test_client):
        """plan field is None when no active TradePlan exists for the symbol."""
        df = _make_intraday_df()
        mock_ticker = MagicMock()
        mock_ticker.history.return_value = df

        with patch("yfinance.Ticker", return_value=mock_ticker):
            resp = test_client.get("/api/chart/ZZZZ/intraday", headers=_AUTH)

        assert resp.status_code == 200
        assert resp.json()["plan"] is None

    def test_intraday_empty_data(self, test_client):
        """Empty DataFrame → 404."""
        mock_ticker = MagicMock()
        mock_ticker.history.return_value = pd.DataFrame()

        with patch("yfinance.Ticker", return_value=mock_ticker):
            resp = test_client.get("/api/chart/FAKE/intraday", headers=_AUTH)

        assert resp.status_code == 404

    def test_intraday_requires_auth(self, test_client):
        """Missing Bearer token → 401."""
        resp = test_client.get("/api/chart/AAPL/intraday")
        assert resp.status_code == 401
