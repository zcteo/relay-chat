import json
import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .access import access_required, verify_access_header
from .auth import (
    CurrentUser,
    cleanup_login_tokens,
    create_login_token,
    hash_password,
    now_iso,
    public_user,
    verify_password,
)
from .config import REGISTRATION_CODE
from .db import db
from .rate_limit import clear_failures, login_limit_key, record_failure, request_limit_key


router = APIRouter(prefix="/api")

Protocol = Literal["openai_chat", "openai_responses", "anthropic"]


class Credentials(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=256)
    registration_code: str = Field("", alias="registrationCode")


class ChangePasswordPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    username: str = ""
    current_password: str = Field("", max_length=256, alias="currentPassword")
    new_password: str = Field(..., min_length=1, max_length=256, alias="newPassword")


class SettingsPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    base_url: str = Field("", alias="baseUrl")
    token: str = ""
    model: str = ""
    protocol: Protocol = "openai_responses"
    models: list[dict[str, Any]] = Field(default_factory=list)
    api_credentials: dict[str, str] = Field(
        default_factory=dict,
        alias="apiCredentials",
    )


class PartialSettingsPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    base_url: str | None = Field(None, alias="baseUrl")
    token: str | None = None
    model: str | None = None
    protocol: Protocol | None = None
    models: list[dict[str, Any]] | None = None
    api_credentials: dict[str, str] | None = Field(None, alias="apiCredentials")


class ImportMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    thinking: str = ""
    created_at: str | int | float | None = Field(None, alias="createdAt")


class ImportSession(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    title: str = "新会话"
    title_source: str = Field("default", alias="titleSource")
    created_at: str | int | float | None = Field(None, alias="createdAt")
    updated_at: str | int | float | None = Field(None, alias="updatedAt")
    messages: list[ImportMessage] = Field(default_factory=list)


class ImportLocalPayload(BaseModel):
    settings: SettingsPayload
    sessions: list[ImportSession] = Field(default_factory=list)


class SessionPayload(BaseModel):
    title: str = "新会话"
    title_source: str = Field("default", alias="titleSource")


class MessagePayload(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    thinking: str = ""
    sort_order: int | None = Field(None, alias="sortOrder")


def ts(value: str | int | float | None = None) -> str:
    if isinstance(value, (int, float)):
        import datetime

        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).replace(microsecond=0).isoformat()
    if isinstance(value, str) and value.strip():
        return value
    return now_iso()


def settings_from_user(row: Any) -> dict[str, Any]:
    try:
        models = json.loads(row["models_json"] or "[]")
        if not isinstance(models, list):
            models = []
    except Exception:
        models = []
    try:
        api_credentials = json.loads(row["api_credentials_json"] or "{}")
        if not isinstance(api_credentials, dict):
            api_credentials = {}
    except Exception:
        api_credentials = {}
    base_url = row["api_base_url"] or ""
    return {
        "baseUrl": base_url,
        "token": api_credentials.get(base_url, "") if base_url else "",
        "model": row["selected_model"] or "",
        "protocol": row["protocol"] or "openai_responses",
        "models": models,
        "apiCredentials": api_credentials,
    }


def normalized_api_credentials(
    credentials: dict[str, str] | None,
    base_url: str = "",
    token: str | None = None,
) -> dict[str, str]:
    normalized = {
        str(url).strip(): str(value).strip()
        for url, value in (credentials or {}).items()
        if str(url).strip()
    }
    clean_base_url = base_url.strip()
    if clean_base_url and token is not None:
        normalized[clean_base_url] = token.strip()
    return normalized


def session_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "titleSource": row["title_source"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "messageCount": row["message_count"],
    }


def message_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "thinking": row["thinking"],
        "createdAt": row["created_at"],
        "sortOrder": row["sort_order"],
    }


def should_offer(row: Any) -> bool:
    return int(row["first_login_completed"] or 0) == 0


def can_reset_passwd(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute("SELECT MIN(id) AS reset_user_id FROM users").fetchone()
    return bool(row and row["reset_user_id"] == user_id)


def public_user_with_role(conn: sqlite3.Connection, row: Any) -> dict[str, Any]:
    user = public_user(row)
    user["resetPasswd"] = can_reset_passwd(conn, row["id"])
    return user


def require_registration_code(req: Credentials, request: Request) -> None:
    if not REGISTRATION_CODE.strip():
        return
    key = request_limit_key(request)
    if req.registration_code.strip() == REGISTRATION_CODE.strip():
        return
    record_failure(key)
    raise HTTPException(status_code=403, detail="invalid_registration_code")


@router.get("/access")
async def access(request: Request) -> dict[str, bool]:
    if not access_required():
        return {"ok": True, "accessRequired": False}
    verify_access_header(request)
    return {"ok": True, "accessRequired": True}


@router.post("/register")
async def register(req: Credentials, request: Request) -> dict[str, Any]:
    require_registration_code(req, request)
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="username_required")
    now = now_iso()
    try:
        with db() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (username, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (username, hash_password(req.password), now, now),
            )
            user_id = int(cur.lastrowid)
    except sqlite3.IntegrityError as e:
        record_failure(request_limit_key(request))
        raise HTTPException(status_code=409, detail="username_exists") from e
    clear_failures(request_limit_key(request))
    return {"user": {"id": user_id, "username": username}, "ok": True}


@router.post("/login")
async def login(req: Credentials, request: Request) -> dict[str, Any]:
    username = req.username.strip()
    key = login_limit_key(request, username)
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        record_failure(login_limit_key(request, "unknown"))
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_password(req.password, row["password_hash"]):
        record_failure(key)
        raise HTTPException(status_code=401, detail="invalid_credentials")
    clear_failures(key)
    token = create_login_token(row["id"])
    with db() as conn:
        user = public_user_with_role(conn, row)
    return {"user": user, "token": token, "shouldOfferLocalUpload": should_offer(row)}


@router.post("/logout")
async def logout(user: CurrentUser) -> dict[str, bool]:
    with db() as conn:
        conn.execute(
            "UPDATE login_tokens SET revoked_at = ? WHERE token_hash = ?",
            (now_iso(), user["login_token_hash"]),
        )
    return {"ok": True}


@router.get("/profile")
async def profile(user: CurrentUser) -> dict[str, Any]:
    cleanup_login_tokens()
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        public = public_user_with_role(conn, row)
    return {"user": public, "settings": settings_from_user(row)}


@router.put("/password")
async def change_password(req: ChangePasswordPayload, user: CurrentUser) -> dict[str, bool]:
    now = now_iso()
    target_username = req.username.strip()
    with db() as conn:
        if target_username:
            if not can_reset_passwd(conn, user["id"]):
                raise HTTPException(status_code=403, detail="permission_denied")
            target = conn.execute("SELECT * FROM users WHERE username = ?", (target_username,)).fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="user_not_found")
            conn.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (hash_password(req.new_password), now, target["id"]),
            )
            conn.execute(
                "UPDATE login_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                (now, target["id"]),
            )
            return {"ok": True}

        if not req.current_password:
            raise HTTPException(status_code=422, detail="current_password_required")
        if req.current_password == req.new_password:
            raise HTTPException(status_code=422, detail="password_unchanged")
        current = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not current or not verify_password(req.current_password, current["password_hash"]):
            raise HTTPException(status_code=403, detail="invalid_current_password")
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(req.new_password), now, user["id"]),
        )
        conn.execute(
            """
            UPDATE login_tokens
            SET revoked_at = ?
            WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL
            """,
            (now, user["id"], user["login_token_hash"]),
        )
    return {"ok": True}


@router.put("/settings")
async def put_settings(req: SettingsPayload, user: CurrentUser) -> dict[str, bool]:
    base_url = req.base_url.strip()
    api_credentials = normalized_api_credentials(req.api_credentials, base_url, req.token)
    with db() as conn:
        conn.execute(
            """
            UPDATE users
            SET api_base_url = ?, api_credentials_json = ?,
                selected_model = ?, protocol = ?, models_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                base_url,
                json.dumps(api_credentials, ensure_ascii=False),
                req.model.strip(),
                req.protocol,
                json.dumps(req.models, ensure_ascii=False),
                now_iso(),
                user["id"],
            ),
        )
    return {"ok": True}


@router.patch("/settings")
async def patch_settings(req: PartialSettingsPayload, user: CurrentUser) -> dict[str, bool]:
    with db() as conn:
        current = conn.execute("SELECT api_base_url, api_credentials_json FROM users WHERE id = ?", (user["id"],)).fetchone()
    try:
        current_credentials = json.loads(current["api_credentials_json"] or "{}")
        if not isinstance(current_credentials, dict):
            current_credentials = {}
    except Exception:
        current_credentials = {}
    base_url = current["api_base_url"] or ""
    if req.base_url is not None:
        base_url = req.base_url.strip()

    fields: list[str] = []
    values: list[Any] = []
    if req.base_url is not None:
        fields.append("api_base_url = ?")
        values.append(base_url)
    if req.model is not None:
        fields.append("selected_model = ?")
        values.append(req.model.strip())
    if req.protocol is not None:
        fields.append("protocol = ?")
        values.append(req.protocol)
    if req.models is not None:
        fields.append("models_json = ?")
        values.append(json.dumps(req.models, ensure_ascii=False))
    if req.api_credentials is not None or req.token is not None or req.base_url is not None:
        token = req.token if req.token is not None else current_credentials.get(base_url, "")
        api_credentials = normalized_api_credentials(
            req.api_credentials if req.api_credentials is not None else current_credentials,
            base_url,
            token,
        )
        fields.append("api_credentials_json = ?")
        values.append(json.dumps(api_credentials, ensure_ascii=False))
    if not fields:
        return {"ok": True}
    fields.append("updated_at = ?")
    values.append(now_iso())
    values.append(user["id"])
    with db() as conn:
        conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    return {"ok": True}


@router.post("/import-local")
async def import_local(req: ImportLocalPayload, user: CurrentUser) -> dict[str, bool]:
    now = now_iso()
    base_url = req.settings.base_url.strip()
    api_credentials = normalized_api_credentials(req.settings.api_credentials, base_url, req.settings.token)
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        conn.execute(
            """
            UPDATE users
            SET api_base_url = ?, api_credentials_json = ?,
                selected_model = ?, protocol = ?, models_json = ?,
                first_login_completed = 1, local_upload_offered_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                base_url,
                json.dumps(api_credentials, ensure_ascii=False),
                req.settings.model.strip(),
                req.settings.protocol,
                json.dumps(req.settings.models, ensure_ascii=False),
                now,
                now,
                user["id"],
            ),
        )
        for imported_session in req.sessions:
            created_at = ts(imported_session.created_at)
            updated_at = ts(imported_session.updated_at) if imported_session.updated_at else created_at
            cur = conn.execute(
                """
                INSERT INTO sessions (user_id, title, title_source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    imported_session.title or "新会话",
                    imported_session.title_source or "default",
                    created_at,
                    updated_at,
                ),
            )
            session_id = int(cur.lastrowid)
            for index, message in enumerate(imported_session.messages, start=1):
                conn.execute(
                    """
                    INSERT INTO messages (session_id, user_id, role, content, thinking, created_at, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        user["id"],
                        message.role,
                        message.content,
                        message.thinking,
                        ts(message.created_at),
                        index,
                    ),
                )
    return {"ok": True}


@router.post("/import-local/skip")
async def skip_import_local(user: CurrentUser) -> dict[str, bool]:
    with db() as conn:
        conn.execute(
            """
            UPDATE users
            SET first_login_completed = 1, local_upload_offered_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (now_iso(), now_iso(), user["id"]),
        )
    return {"ok": True}


@router.get("/sessions")
async def sessions(user: CurrentUser) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT sessions.*, COUNT(messages.id) AS message_count
            FROM sessions
            LEFT JOIN messages ON messages.session_id = sessions.id
            WHERE sessions.user_id = ?
            GROUP BY sessions.id
            ORDER BY sessions.updated_at DESC
            """,
            (user["id"],),
        ).fetchall()
    return {"sessions": [session_row(row) for row in rows]}


@router.post("/sessions")
async def create_session(req: SessionPayload, user: CurrentUser) -> dict[str, Any]:
    now = now_iso()
    title = req.title.strip() or "新会话"
    with db() as conn:
        cur = conn.execute(
            """
            INSERT INTO sessions (user_id, title, title_source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user["id"], title, req.title_source or "default", now, now),
        )
        session_id = int(cur.lastrowid)
        row = conn.execute(
            """
            SELECT sessions.*, 0 AS message_count
            FROM sessions
            WHERE id = ? AND user_id = ?
            """,
            (session_id, user["id"]),
        ).fetchone()
    return {"session": session_row(row)}


@router.put("/sessions/{session_id}")
async def update_session(session_id: int, req: SessionPayload, user: CurrentUser) -> dict[str, bool]:
    with db() as conn:
        cur = conn.execute(
            """
            UPDATE sessions
            SET title = ?, title_source = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (req.title.strip() or "新会话", req.title_source or "default", now_iso(), session_id, user["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="session_not_found")
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int, user: CurrentUser) -> dict[str, bool]:
    with db() as conn:
        cur = conn.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user["id"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="session_not_found")
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
async def messages(session_id: int, user: CurrentUser) -> dict[str, Any]:
    with db() as conn:
        session = conn.execute("SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, user["id"])).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="session_not_found")
        rows = conn.execute(
            """
            SELECT *
            FROM messages
            WHERE session_id = ? AND user_id = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (session_id, user["id"]),
        ).fetchall()
    return {"messages": [message_row(row) for row in rows]}


@router.post("/sessions/{session_id}/messages")
async def create_message(session_id: int, req: MessagePayload, user: CurrentUser) -> dict[str, Any]:
    now = now_iso()
    with db() as conn:
        session = conn.execute("SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, user["id"])).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="session_not_found")
        sort_order = req.sort_order
        if sort_order is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM messages WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            sort_order = int(row["next_order"])
        cur = conn.execute(
            """
            INSERT INTO messages (session_id, user_id, role, content, thinking, created_at, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (session_id, user["id"], req.role, req.content, req.thinking, now, sort_order),
        )
        message_id = int(cur.lastrowid)
        conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ? AND user_id = ?", (now, session_id, user["id"]))
        row = conn.execute("SELECT * FROM messages WHERE id = ? AND user_id = ?", (message_id, user["id"])).fetchone()
    return {"message": message_row(row)}
