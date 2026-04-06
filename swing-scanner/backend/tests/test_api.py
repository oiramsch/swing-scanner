"""
Integration tests for FastAPI endpoints.
Uses the session-scoped TestClient from conftest.py (in-memory SQLite).
The auth middleware only checks for a Bearer header — no real JWT validation
on routes that don't use Depends(get_current_user), like /api/scan/status.
"""
from datetime import date, datetime, timezone, timedelta

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
