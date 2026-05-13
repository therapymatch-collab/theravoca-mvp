"""TOTP (2FA) helpers for therapist accounts.

Wraps pyotp with our app-specific defaults:
- 6-digit codes, 30s period (the standard most authenticator apps use)
- ISSUER label "TheraVoca" so the entry in Google Authenticator etc.
  reads as "TheraVoca: therapist@email.com"
- Recovery codes: 10 codes, format XXXX-XXXX-XXXX (12 chars + dashes,
  ~60 bits entropy per code -- more than enough). Hashed with bcrypt
  before persisting. Single-use: when a code matches, we remove its
  hash from the array.

Single source of truth so portal.py routes stay thin.

Hardening fix #4 (2026-05-13).
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
import pyotp

from deps import JWT_SECRET, JWT_ALGO

ISSUER = "TheraVoca"
RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = string.ascii_uppercase + string.digits
# Challenge token lifetime -- after the user passes password/magic code
# but before they submit their TOTP digit, this JWT represents the
# half-authenticated state. 5 minutes is enough for the user to fetch
# their phone, plenty short if a token leaks.
CHALLENGE_TTL_MINUTES = 5


def generate_secret() -> str:
    """Generate a fresh base32 TOTP secret."""
    return pyotp.random_base32()


def otpauth_uri(secret: str, account_email: str) -> str:
    """Build the otpauth:// URI the user's authenticator app scans.

    The label format `Issuer:email` is the convention -- Google
    Authenticator + 1Password parse it correctly to group entries.
    """
    return pyotp.TOTP(secret).provisioning_uri(
        name=account_email, issuer_name=ISSUER,
    )


def verify_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code. Allows +/- 1 step of clock drift
    (pyotp's default), which is ~30 seconds either way."""
    if not secret or not code:
        return False
    code_clean = (code or "").strip().replace(" ", "")
    if not code_clean.isdigit() or len(code_clean) != 6:
        return False
    try:
        return pyotp.TOTP(secret).verify(code_clean, valid_window=1)
    except Exception:
        return False


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Generate N human-friendly recovery codes (XXXX-XXXX-XXXX).
    Returned in plaintext; caller is responsible for hashing before
    storing and showing them to the user exactly once.
    """
    codes: list[str] = []
    for _ in range(count):
        parts = [
            "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
            for _ in range(3)
        ]
        codes.append("-".join(parts))
    return codes


def hash_recovery_code(code: str) -> str:
    """bcrypt-hash a recovery code for storage. Same cost as passwords."""
    return bcrypt.hashpw(_normalize_recovery(code).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_and_consume_recovery_code(
    submitted: str, stored_hashes: list[str],
) -> tuple[bool, list[str]]:
    """Check submitted recovery code against the array of stored bcrypt
    hashes. If it matches, return (True, hashes_with_match_removed).
    If no match, return (False, stored_hashes_unchanged).

    Single-use semantics: a matched code is removed from the array so
    it can't be replayed.
    """
    if not submitted or not stored_hashes:
        return False, list(stored_hashes or [])
    normalized = _normalize_recovery(submitted).encode("utf-8")
    remaining: list[str] = []
    matched = False
    for h in stored_hashes:
        if not matched and _bcrypt_check(normalized, h):
            matched = True
            continue  # drop this hash from the remaining list
        remaining.append(h)
    return matched, remaining


def _normalize_recovery(code: str) -> str:
    """Recovery codes are stored case-insensitively; users get the
    flexibility to type with or without dashes."""
    return (code or "").strip().upper().replace(" ", "").replace("-", "")


def _bcrypt_check(plain_bytes: bytes, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain_bytes, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ─── 2FA challenge tokens ───────────────────────────────────────────────────
# Issued when password / magic-code auth succeeds but the user has 2FA
# enabled. The frontend exchanges this token + a 6-digit code (or a
# recovery code) for a real session token at /auth/verify-2fa.
#
# Encoded as a JWT with typ="2fa_challenge" so it can't be mis-used as
# a session token (session decoder rejects this typ).

def create_challenge_token(email: str, role: str) -> str:
    payload = {
        "email": (email or "").lower(),
        "role": role,
        "typ": "2fa_challenge",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=CHALLENGE_TTL_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def verify_challenge_token(token: str) -> Optional[dict]:
    """Returns {email, role} if the token is a valid, non-expired 2FA
    challenge. Returns None otherwise. Never raises."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    if payload.get("typ") != "2fa_challenge":
        return None
    email = payload.get("email")
    role = payload.get("role")
    if not email or not role:
        return None
    return {"email": email, "role": role}
