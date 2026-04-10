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
    """FastAPI TestClient backed by the in-memory DB.
    get_current_user is overridden so routes using Depends(get_current_user)
    accept any Bearer token without real JWT validation."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.auth import get_current_user, AuthenticatedUser

    async def _mock_user():
        return AuthenticatedUser(email="test@test.com", tenant_id=1)

    app.dependency_overrides[get_current_user] = _mock_user

    with TestClient(app, raise_server_exceptions=True) as client:
        yield client

    app.dependency_overrides.clear()
