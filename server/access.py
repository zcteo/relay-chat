import hmac

from fastapi import HTTPException, Request

from .auth import current_user
from .config import ACCESS_CODE
from .rate_limit import clear_failures, record_failure, request_limit_key


def access_required() -> bool:
    return bool(ACCESS_CODE.strip())


def verify_access_header(request: Request) -> None:
    if not access_required():
        return
    key = request_limit_key(request)
    code = request.headers.get("x-access-code", "").strip()
    if hmac.compare_digest(code, ACCESS_CODE.strip()):
        clear_failures(key)
        return
    record_failure(key)
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
