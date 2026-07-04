from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException, Request


_failures: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def check_limit(key: str, max_attempts: int, window_seconds: int) -> None:
    now = monotonic()
    attempts = _failures[key]
    while attempts and now - attempts[0] > window_seconds:
        attempts.popleft()
    if len(attempts) >= max_attempts:
        raise HTTPException(status_code=429, detail="too_many_attempts")


def record_failure(key: str, max_attempts: int, window_seconds: int) -> None:
    check_limit(key, max_attempts, window_seconds)
    _failures[key].append(monotonic())


def clear_failures(key: str) -> None:
    _failures.pop(key, None)
