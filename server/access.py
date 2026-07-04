import hmac

from fastapi import HTTPException, Request

from .auth import current_user
from .config import ACCESS_CODE, ACCESS_LIMIT_MAX, ACCESS_LIMIT_WINDOW_SECONDS
from .rate_limit import check_limit, clear_failures, client_ip, record_failure


def access_required() -> bool:
    return bool(ACCESS_CODE.strip())


def access_key(request: Request) -> str:
    return f"access:{client_ip(request)}"


def verify_access_header(request: Request) -> None:
    if not access_required():
        return
    key = access_key(request)
    check_limit(key, ACCESS_LIMIT_MAX, ACCESS_LIMIT_WINDOW_SECONDS)
    code = request.headers.get("x-access-code", "").strip()
    if hmac.compare_digest(code, ACCESS_CODE.strip()):
        clear_failures(key)
        return
    record_failure(key, ACCESS_LIMIT_MAX, ACCESS_LIMIT_WINDOW_SECONDS)
    raise HTTPException(status_code=401, detail="invalid_access_code")


def require_proxy_access(request: Request) -> None:
    auth = request.headers.get("authorization", "").strip()
    if auth:
        try:
            current_user(request)
            return
        except HTTPException as auth_error:
            if not request.headers.get("x-access-code", "").strip():
                raise auth_error
    verify_access_header(request)
