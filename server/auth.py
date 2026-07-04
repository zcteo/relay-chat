import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

from .config import LOGIN_TOKEN_DAYS
from .db import db


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def add_days_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat()


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def make_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt, expected = stored.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000).hex()
        return hmac.compare_digest(digest, expected)
    except Exception:
        return False


def public_user(row: Any) -> dict[str, Any]:
    return {"id": row["id"], "username": row["username"]}


def cleanup_login_tokens() -> None:
    with db() as conn:
        conn.execute(
            "DELETE FROM login_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL",
            (now_iso(),),
        )


def create_login_token(user_id: int) -> str:
    token = make_token()
    now = now_iso()
    expires_at = add_days_iso(LOGIN_TOKEN_DAYS)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO login_tokens (user_id, token_hash, created_at, expires_at, revoked_at, last_used_at)
            VALUES (?, ?, ?, ?, NULL, ?)
            """,
            (user_id, hash_token(token), now, expires_at, now),
        )
    return token


def bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="token_required")
    return token.strip()


def current_user(request: Request) -> dict[str, Any]:
    token = bearer_token(request)
    token_hash = hash_token(token)
    now = datetime.now(timezone.utc)
    next_expires = add_days_iso(LOGIN_TOKEN_DAYS)
    with db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.username, login_tokens.id AS login_token_id, login_tokens.expires_at
            FROM login_tokens
            JOIN users ON users.id = login_tokens.user_id
            WHERE login_tokens.token_hash = ? AND login_tokens.revoked_at IS NULL
            """,
            (token_hash,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="token_expired")
        if parse_iso(row["expires_at"]) <= now:
            conn.execute("DELETE FROM login_tokens WHERE id = ?", (row["login_token_id"],))
            conn.commit()
            raise HTTPException(status_code=401, detail="token_expired")
        conn.execute(
            "UPDATE login_tokens SET expires_at = ?, last_used_at = ? WHERE id = ?",
            (next_expires, now_iso(), row["login_token_id"]),
        )
        conn.commit()
        return {"id": row["id"], "username": row["username"], "login_token_hash": token_hash}


CurrentUser = Annotated[dict[str, Any], Depends(current_user)]
