"""
Test fixtures: In-Memory SQLite DB + FastAPI TestClient.
No real network calls — yfinance / Alpaca / Claude are never contacted.
"""
import sys
from pathlib import Path

# Make `backend` package importable when pytest runs from swing-scanner/backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

# --- Patch the database engine BEFORE importing anything from backend ---
import backend.database as _db

_TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db._engine = _TEST_ENGINE
SQLModel.metadata.create_all(_TEST_ENGINE)


@pytest.fixture(scope="session")
def engine():
    return _TEST_ENGINE


@pytest.fixture()
def db_session(engine):
    """Yields a SQLModel Session bound to the in-memory test DB."""
    with Session(engine) as session:
        yield session


@pytest.fixture(scope="session")
def test_client(engine):
    """FastAPI TestClient backed by the in-memory DB. Auth middleware is
    bypassed by passing a dummy Bearer token (scan/status has no Depends auth)."""
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app, raise_server_exceptions=True) as client:
        yield client
