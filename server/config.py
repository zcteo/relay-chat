import os
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_DIR / ".env"


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


load_env_file(ENV_FILE)


def env_path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return Path(value).expanduser() if value else default


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DATA_DIR = env_path("DATA_DIR", PROJECT_DIR / "data")
DB_PATH = env_path("DB_PATH", DATA_DIR / "relay-chat.sqlite3")
LOG_PATH = env_path("LOG_PATH", DATA_DIR / "relay-chat.log")

LOGIN_TOKEN_DAYS = env_int("LOGIN_TOKEN_DAYS", 7)

ACCESS_CODE = os.getenv("ACCESS_CODE", "")
REGISTRATION_CODE = os.getenv("REGISTRATION_CODE", "")
