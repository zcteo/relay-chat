from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException, Request

from .config import REQUEST_LIMIT_MAX, REQUEST_LIMIT_WINDOW_SECONDS


_failures: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first_ip = forwarded_for.split(",", 1)[0].strip()
        if first_ip:
            return first_ip
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def request_limit_key(request: Request) -> str:
    return f"request:{client_ip(request)}"


def login_limit_key(request: Request, username: str) -> str:
    return f"login:{client_ip(request)}:{username.lower()}"


def check_limit(key: str) -> None:
    now = monotonic()
    attempts = _failures[key]
    while attempts and now - attempts[0] > REQUEST_LIMIT_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= REQUEST_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="too_many_attempts")


def record_failure(key: str) -> None:
    check_limit(key)
    _failures[key].append(monotonic())


def clear_failures(key: str) -> None:
    _failures.pop(key, None)
