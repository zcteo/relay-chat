import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .data_api import router as data_router
from .db import init_db
from .proxy_api import router as proxy_router


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("relay-chat")

PROJECT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_DIR / "static"

app = FastAPI(title="RelayChat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(proxy_router)
app.include_router(data_router)


@app.on_event("startup")
async def startup() -> None:
    init_db()


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("***" if k.lower() in {"token", "authorization", "api_key", "apikey", "x-api-key"} else redact_sensitive(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_sensitive(v) for v in value]
    return value


def safe_json_body(raw: bytes) -> str:
    text = raw.decode("utf-8", "ignore")[:4000]
    try:
        return json.dumps(redact_sensitive(json.loads(text)), ensure_ascii=False)[:2000]
    except Exception:
        return text[:2000]


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    body = await request.body()
    logger.error("请求参数校验失败 path=%s errors=%s body=%s", request.url.path, exc.errors(), safe_json_body(body))
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
