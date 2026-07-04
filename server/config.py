from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "data"
DB_PATH = DATA_DIR / "relay-chat.sqlite3"
LOGIN_TOKEN_DAYS = 7
