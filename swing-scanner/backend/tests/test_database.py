"""
Unit tests for database helper functions.
All tests use the in-memory SQLite fixture from conftest.py.
"""
from datetime import date, datetime, timezone, timedelta

import pytest
from sqlmodel import Session, delete

from backend.database import ScanResult, get_last_scan_datetime
from backend.main import SCAN_MISSING_THRESHOLD_HOURS


def _clear_scan_results(engine):
    with Session(engine) as s:
        s.exec(delete(ScanResult))
        s.commit()


def test_get_last_scan_datetime_empty(engine):
    """Empty DB must return None from get_last_scan_datetime()."""
    _clear_scan_results(engine)
    assert get_last_scan_datetime() is None


def test_get_last_scan_datetime_with_data(engine):
    """After inserting two ScanResults, get_last_scan_datetime returns the newest."""
    _clear_scan_results(engine)

    older_dt = datetime(2024, 1, 1, 10, 0, 0)
    newer_dt = datetime(2024, 1, 2, 12, 0, 0)

    with Session(engine) as s:
        s.add(ScanResult(ticker="AAPL", scan_date=date(2024, 1, 1), created_at=older_dt))
        s.add(ScanResult(ticker="MSFT", scan_date=date(2024, 1, 2), created_at=newer_dt))
        s.commit()

    row = get_last_scan_datetime()
    assert row is not None
    # row is (scan_date, created_at)
    assert row[1] == newer_dt, f"Expected newest datetime {newer_dt}, got {row[1]}"


def test_scan_missing_flag(engine):
    """
    When the last scan is more than SCAN_MISSING_THRESHOLD_HOURS ago,
    the scan_missing flag must be True.
    """
    _clear_scan_results(engine)

    stale_dt = datetime.utcnow() - timedelta(hours=SCAN_MISSING_THRESHOLD_HOURS + 2)
    with Session(engine) as s:
        s.add(ScanResult(ticker="SPY", scan_date=date.today(), created_at=stale_dt))
        s.commit()

    row = get_last_scan_datetime()
    assert row is not None

    created_at = row[1]
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - created_at
    hours_since = delta.total_seconds() / 3600
    scan_missing = hours_since > SCAN_MISSING_THRESHOLD_HOURS

    assert scan_missing is True, (
        f"scan_missing should be True when last scan is {hours_since:.1f}h ago "
        f"(threshold={SCAN_MISSING_THRESHOLD_HOURS}h)"
    )
