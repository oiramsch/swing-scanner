"""
Phase 2a — Authentication helpers.

Single-user JWT auth for personal use.
Infrastructure is SaaS-ready: swap get_current_user for a multi-tenant
version when needed without touching any route handlers.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from backend.config import settings

logger = logging.getLogger(__name__)

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Password utilities
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def is_bcrypt_hash(value: str) -> bool:
    return value.startswith("$2b$") or value.startswith("$2a$")


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(days=settings.jwt_expire_days)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# FastAPI dependency — get_current_user
# ---------------------------------------------------------------------------

class AuthenticatedUser:
    """Minimal user context passed to route handlers."""
    def __init__(self, email: str, tenant_id: int = 1):
        self.email = email
        self.tenant_id = tenant_id


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthenticatedUser:
    """
    FastAPI dependency. Validates JWT Bearer token.

    SaaS upgrade path: replace return value with a DB lookup
    to get tenant_id and role without changing any route handlers.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    return AuthenticatedUser(email=email, tenant_id=payload.get("tenant_id", 1))


# ---------------------------------------------------------------------------
# Login helper — validates against DB User or .env bootstrap credentials
# ---------------------------------------------------------------------------

def authenticate_user(email: str, password: str) -> Optional[AuthenticatedUser]:
    """
    Validate credentials. Checks DB User table first, then falls back
    to .env admin bootstrap (ADMIN_EMAIL / ADMIN_PASSWORD).
    Returns AuthenticatedUser on success, None on failure.
    """
    from backend.database import get_user_by_email

    db_user = get_user_by_email(email)
    if db_user and db_user.is_active:
        if verify_password(password, db_user.password_hash):
            return AuthenticatedUser(email=db_user.email, tenant_id=db_user.tenant_id)
        return None

    # Bootstrap: .env admin credentials (only if no DB user exists yet)
    if (
        email.lower() == settings.admin_email.lower()
        and settings.admin_password
    ):
        stored = settings.admin_password
        if is_bcrypt_hash(stored):
            if verify_password(password, stored):
                return AuthenticatedUser(email=email, tenant_id=1)
        else:
            # Plain-text password in .env (development only — warn loudly)
            if password == stored:
                logger.warning(
                    "AUTH: plain-text ADMIN_PASSWORD in use — set a bcrypt hash in .env"
                )
                return AuthenticatedUser(email=email, tenant_id=1)

    return None
