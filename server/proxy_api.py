import json
import logging
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field


Protocol = Literal["openai_chat", "openai_responses", "anthropic"]

logger = logging.getLogger("relay-chat")
router = APIRouter(prefix="/api")


class ApiConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    protocol: Protocol
    base_url: str = Field(..., alias="baseUrl", min_length=1)
    token: str = Field(..., min_length=1)


class ChatRequest(ApiConfig):
    model: str
    messages: list[dict[str, Any]]
    temperature: float | None = None
    max_tokens: int | None = None
    thinking: bool = False


def clean_base_url(url: str) -> str:
    return url.strip().rstrip("/")


def headers(config: ApiConfig) -> dict[str, str]:
    h = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.token}",
        "X-Origin-Agent": "stepcode",
    }
    if config.protocol == "anthropic":
        h["anthropic-version"] = "2023-06-01"
    return h


@router.post("/models")
async def models(req: ApiConfig) -> dict[str, Any]:
    url = clean_base_url(req.base_url) + "/v1/models"
    safe_headers = {k: ("***" if k.lower() == "authorization" else v) for k, v in headers(req).items()}
    logger.info("获取模型 request protocol=%s url=%s headers=%s", req.protocol, url, safe_headers)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers(req))
            logger.info("获取模型 response status=%s body=%s", r.status_code, r.text[:2000])
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        logger.exception("获取模型上游 HTTP 错误 status=%s body=%s", e.response.status_code, e.response.text[:2000])
        raise HTTPException(e.response.status_code, e.response.text[:1000]) from e
    except Exception as e:
        logger.exception("获取模型失败 protocol=%s url=%s", req.protocol, url)
        raise HTTPException(502, f"获取模型失败: {e}") from e

    items = data.get("data", data if isinstance(data, list) else [])
    models = []
    for m in items:
        mid = m.get("id") or m.get("name")
        if mid:
            models.append({"id": mid, "name": m.get("display_name") or mid})
    return {"models": models}


def anthropic_messages(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, str]]]:
    system_parts: list[str] = []
    out: list[dict[str, str]] = []
    for msg in messages:
        role = msg.get("role")
        content = str(msg.get("content", ""))
        if role == "system":
            system_parts.append(content)
        elif role in ("user", "assistant"):
            out.append({"role": role, "content": content})
    return ("\n\n".join(system_parts) if system_parts else None), out


def sse(obj: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


async def stream_openai_responses(req: ChatRequest) -> AsyncIterator[bytes]:
    body: dict[str, Any] = {"model": req.model, "input": req.messages, "stream": True}
    if req.temperature is not None:
        body["temperature"] = req.temperature
    if req.max_tokens:
        body["max_output_tokens"] = req.max_tokens
    if req.thinking:
        body["reasoning"] = {"effort": "medium", "summary": "auto"}

    async with httpx.AsyncClient(timeout=None) as client:
        url = clean_base_url(req.base_url) + "/v1/responses"
        async with client.stream("POST", url, headers=headers(req), json=body) as r:
            if r.status_code >= 400:
                err_body = (await r.aread()).decode("utf-8", "ignore")[:2000]
                logger.error("OpenAI responses 上游错误 status=%s body=%s", r.status_code, err_body)
                yield sse({"type": "error", "error": err_body})
                return
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    yield sse({"type": "done"})
                    return
                try:
                    data = json.loads(raw)
                except Exception:
                    continue

                event_type = data.get("type", "")
                if event_type in ("response.output_text.delta", "response.refusal.delta"):
                    delta = data.get("delta") or ""
                    if delta:
                        yield sse({"type": "content", "delta": delta})
                elif event_type in (
                    "response.reasoning_summary_text.delta",
                    "response.reasoning_text.delta",
                    "response.output_item.delta",
                ):
                    delta = data.get("delta") or data.get("text") or ""
                    if isinstance(delta, str) and delta:
                        yield sse({"type": "thinking", "delta": delta})
                elif event_type == "response.completed":
                    yield sse({"type": "done"})
                    return
                elif event_type in ("response.failed", "response.incomplete"):
                    resp = data.get("response", {})
                    err = resp.get("error") or resp.get("incomplete_details") or data
                    yield sse({"type": "error", "error": err if isinstance(err, str) else json.dumps(err, ensure_ascii=False)})
                    return
                elif event_type == "error":
                    yield sse({"type": "error", "error": data.get("message") or data.get("error") or str(data)})
                    return
    yield sse({"type": "done"})


async def stream_openai_chat(req: ChatRequest) -> AsyncIterator[bytes]:
    body: dict[str, Any] = {"model": req.model, "messages": req.messages, "stream": True}
    if req.temperature is not None:
        body["temperature"] = req.temperature
    if req.max_tokens:
        body["max_tokens"] = req.max_tokens
    if req.thinking:
        body["reasoning_effort"] = "medium"

    async with httpx.AsyncClient(timeout=None) as client:
        url = clean_base_url(req.base_url) + "/v1/chat/completions"
        async with client.stream("POST", url, headers=headers(req), json=body) as r:
            if r.status_code >= 400:
                err_body = (await r.aread()).decode("utf-8", "ignore")[:2000]
                logger.error("OpenAI chat 上游错误 status=%s body=%s", r.status_code, err_body)
                yield sse({"type": "error", "error": err_body})
                return
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    yield sse({"type": "done"})
                    return
                try:
                    data = json.loads(raw)
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content") or ""
                    thinking = delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thinking") or ""
                    if thinking:
                        yield sse({"type": "thinking", "delta": thinking})
                    if content:
                        yield sse({"type": "content", "delta": content})
                except Exception:
                    continue
    yield sse({"type": "done"})


async def stream_anthropic(req: ChatRequest) -> AsyncIterator[bytes]:
    system, msgs = anthropic_messages(req.messages)
    body: dict[str, Any] = {"model": req.model, "messages": msgs, "stream": True, "max_tokens": req.max_tokens or 4096}
    if system:
        body["system"] = system
    if req.temperature is not None:
        body["temperature"] = req.temperature
    if req.thinking:
        body["thinking"] = {"type": "enabled", "budget_tokens": 1024}
        body.pop("temperature", None)

    async with httpx.AsyncClient(timeout=None) as client:
        url = clean_base_url(req.base_url) + "/v1/messages"
        async with client.stream("POST", url, headers=headers(req), json=body) as r:
            if r.status_code >= 400:
                err_body = (await r.aread()).decode("utf-8", "ignore")[:2000]
                logger.error("Anthropic messages 上游错误 status=%s body=%s", r.status_code, err_body)
                yield sse({"type": "error", "error": err_body})
                return
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                t = data.get("type")
                if t == "content_block_delta":
                    d = data.get("delta", {})
                    if d.get("type") == "text_delta" and d.get("text"):
                        yield sse({"type": "content", "delta": d["text"]})
                    elif d.get("type") in ("thinking_delta", "signature_delta") and d.get("thinking"):
                        yield sse({"type": "thinking", "delta": d["thinking"]})
                elif t == "message_delta":
                    usage = data.get("usage")
                    if usage:
                        yield sse({"type": "usage", "usage": usage})
                elif t == "message_stop":
                    yield sse({"type": "done"})
                    return
                elif t == "error":
                    yield sse({"type": "error", "error": data.get("error", {}).get("message", str(data))})
                    return
    yield sse({"type": "done"})


@router.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    if req.protocol == "anthropic":
        gen = stream_anthropic(req)
    elif req.protocol == "openai_chat":
        gen = stream_openai_chat(req)
    else:
        gen = stream_openai_responses(req)
    return StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
