"""
Phase 2a — Symmetric encryption for sensitive DB fields (broker API keys).
Uses Fernet (AES-128-CBC + HMAC-SHA256) derived from SECRET_KEY.
"""
import base64
import hashlib

from cryptography.fernet import Fernet

from backend.config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        # Derive a stable 32-byte key from SECRET_KEY, base64url-encode for Fernet
        raw = hashlib.sha256(settings.secret_key.encode()).digest()
        key = base64.urlsafe_b64encode(raw)
        _fernet = Fernet(key)
    return _fernet


def encrypt(value: str) -> str:
    """Encrypt a string. Returns base64url-encoded ciphertext."""
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt(encrypted: str) -> str:
    """Decrypt a previously encrypted string."""
    return _get_fernet().decrypt(encrypted.encode()).decode()


def decrypt_or_none(encrypted: str | None) -> str | None:
    if not encrypted:
        return None
    try:
        return decrypt(encrypted)
    except Exception:
        return None
