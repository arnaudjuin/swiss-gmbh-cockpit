"""LLM provider abstraction.

Supports:
- ollama (default, local, free)
- anthropic (Claude API, pay-per-use)
- openai (any OpenAI-compatible endpoint)

Configure via environment variables:
- LLM_PROVIDER          : ollama | anthropic | openai (default: ollama)
- OLLAMA_URL            : default http://localhost:11434
- OLLAMA_TEXT_MODEL     : default qwen2.5-coder:7b
- OLLAMA_VISION_MODEL   : default llama3.2-vision:11b
- ANTHROPIC_API_KEY     : required when LLM_PROVIDER=anthropic
- OPENAI_API_KEY        : required when LLM_PROVIDER=openai
- OPENAI_BASE_URL       : optional, e.g. http://localhost:11434/v1
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import httpx

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama").lower()
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_TEXT_MODEL = os.environ.get("OLLAMA_TEXT_MODEL", "qwen2.5-coder:7b")
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llama3.2-vision:11b")
ANTHROPIC_TEXT_MODEL = os.environ.get("ANTHROPIC_TEXT_MODEL", "claude-haiku-4-5-20251001")
ANTHROPIC_VISION_MODEL = os.environ.get("ANTHROPIC_VISION_MODEL", "claude-sonnet-4-20250514")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_TEXT_MODEL = os.environ.get("OPENAI_TEXT_MODEL", "gpt-4o-mini")


class LLMError(Exception):
    pass


def status() -> dict:
    """Return current LLM config + reachability check."""
    info = {
        "provider": LLM_PROVIDER,
        "text_model": _resolve_text_model(),
        "vision_model": _resolve_vision_model(),
        "endpoint": _resolve_endpoint(),
    }
    info["reachable"] = _ping()
    return info


def _resolve_text_model() -> str:
    if LLM_PROVIDER == "ollama":
        return OLLAMA_TEXT_MODEL
    if LLM_PROVIDER == "anthropic":
        return ANTHROPIC_TEXT_MODEL
    return OPENAI_TEXT_MODEL


def _resolve_vision_model() -> str:
    if LLM_PROVIDER == "ollama":
        return OLLAMA_VISION_MODEL
    if LLM_PROVIDER == "anthropic":
        return ANTHROPIC_VISION_MODEL
    return OPENAI_TEXT_MODEL


def _resolve_endpoint() -> str:
    if LLM_PROVIDER == "ollama":
        return OLLAMA_URL
    if LLM_PROVIDER == "anthropic":
        return "https://api.anthropic.com"
    return OPENAI_BASE_URL


def _ping() -> bool:
    try:
        if LLM_PROVIDER == "ollama":
            r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=2.0)
            return r.status_code == 200
        # For paid APIs, just check key presence
        if LLM_PROVIDER == "anthropic":
            return bool(os.environ.get("ANTHROPIC_API_KEY"))
        if LLM_PROVIDER == "openai":
            return bool(os.environ.get("OPENAI_API_KEY"))
    except Exception:
        return False
    return False


# ─── Text chat ───────────────────────────────────────────────────────────────

def chat(messages: list[dict], system: str | None = None,
         max_tokens: int = 800, temperature: float = 0.2) -> str:
    """Send a chat-style request and return the assistant's text reply.

    messages: [{"role": "user|assistant", "content": "..."}]
    """
    if LLM_PROVIDER == "ollama":
        return _ollama_chat(messages, system, max_tokens, temperature)
    if LLM_PROVIDER == "anthropic":
        return _anthropic_chat(messages, system, max_tokens, temperature)
    return _openai_chat(messages, system, max_tokens, temperature)


def _ollama_chat(messages, system, max_tokens, temperature):
    body = {
        "model": OLLAMA_TEXT_MODEL,
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    r = httpx.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=120.0)
    if r.status_code != 200:
        raise LLMError(f"Ollama error {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data.get("message", {}).get("content", "").strip()


# ─── Streaming chat ────────────────────────────────────────────────────────

def chat_stream(messages, system=None, max_tokens=800, temperature=0.3):
    """Yield content chunks as they arrive. Generator over text strings."""
    if LLM_PROVIDER == "ollama":
        yield from _ollama_stream(messages, system, max_tokens, temperature)
    elif LLM_PROVIDER == "anthropic":
        yield from _anthropic_stream(messages, system, max_tokens, temperature)
    else:
        yield from _openai_stream(messages, system, max_tokens, temperature)


def _ollama_stream(messages, system, max_tokens, temperature):
    body = {
        "model": OLLAMA_TEXT_MODEL,
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "stream": True,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    with httpx.stream("POST", f"{OLLAMA_URL}/api/chat", json=body, timeout=120.0) as r:
        if r.status_code != 200:
            raise LLMError(f"Ollama stream error {r.status_code}")
        for line in r.iter_lines():
            if not line:
                continue
            try:
                obj = json.loads(line)
                delta = obj.get("message", {}).get("content", "")
                if delta:
                    yield delta
                if obj.get("done"):
                    break
            except Exception:
                continue


def _anthropic_stream(messages, system, max_tokens, temperature):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise LLMError("ANTHROPIC_API_KEY not set")
    body = {
        "model": ANTHROPIC_TEXT_MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
        "stream": True,
    }
    if system:
        body["system"] = system
    with httpx.stream(
        "POST", "https://api.anthropic.com/v1/messages",
        json=body,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        timeout=120.0,
    ) as r:
        if r.status_code != 200:
            raise LLMError(f"Anthropic stream error {r.status_code}")
        for line in r.iter_lines():
            if not line.startswith("data: "):
                continue
            try:
                obj = json.loads(line[6:])
                if obj.get("type") == "content_block_delta":
                    text = obj.get("delta", {}).get("text", "")
                    if text:
                        yield text
            except Exception:
                continue


def _openai_stream(messages, system, max_tokens, temperature):
    api_key = os.environ.get("OPENAI_API_KEY", "")
    body = {
        "model": OPENAI_TEXT_MODEL,
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    with httpx.stream("POST", f"{OPENAI_BASE_URL}/chat/completions",
                      json=body, headers=headers, timeout=120.0) as r:
        if r.status_code != 200:
            raise LLMError(f"OpenAI stream error {r.status_code}")
        for line in r.iter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            try:
                obj = json.loads(payload)
                delta = obj["choices"][0]["delta"].get("content", "")
                if delta:
                    yield delta
            except Exception:
                continue


def _anthropic_chat(messages, system, max_tokens, temperature):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise LLMError("ANTHROPIC_API_KEY not set")
    body = {
        "model": ANTHROPIC_TEXT_MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
    }
    if system:
        body["system"] = system
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        json=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        timeout=120.0,
    )
    if r.status_code != 200:
        raise LLMError(f"Anthropic error {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data["content"][0]["text"].strip()


def _openai_chat(messages, system, max_tokens, temperature):
    api_key = os.environ.get("OPENAI_API_KEY", "")
    body = {
        "model": OPENAI_TEXT_MODEL,
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    r = httpx.post(f"{OPENAI_BASE_URL}/chat/completions", json=body, headers=headers, timeout=120.0)
    if r.status_code != 200:
        raise LLMError(f"OpenAI error {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data["choices"][0]["message"]["content"].strip()


# ─── Vision (receipt analysis) ───────────────────────────────────────────────

def vision(image_path: Path, prompt: str, max_tokens: int = 400) -> str:
    """Send an image + prompt and return the model's text response."""
    if LLM_PROVIDER == "ollama":
        return _ollama_vision(image_path, prompt, max_tokens)
    if LLM_PROVIDER == "anthropic":
        return _anthropic_vision(image_path, prompt, max_tokens)
    raise LLMError("Vision not configured for this provider")


def _ollama_vision(image_path, prompt, max_tokens):
    image_b64 = base64.standard_b64encode(image_path.read_bytes()).decode()
    body = {
        "model": OLLAMA_VISION_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
        "stream": False,
        "options": {"temperature": 0.0, "num_predict": max_tokens},
    }
    r = httpx.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=180.0)
    if r.status_code != 200:
        raise LLMError(f"Ollama vision error {r.status_code}: {r.text[:200]}")
    return r.json().get("message", {}).get("content", "").strip()


def _anthropic_vision(image_path, prompt, max_tokens):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise LLMError("ANTHROPIC_API_KEY not set")
    image_b64 = base64.standard_b64encode(image_path.read_bytes()).decode()
    media_type = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
    }.get(image_path.suffix.lower(), "image/jpeg")
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        json={
            "model": ANTHROPIC_VISION_MODEL,
            "max_tokens": max_tokens,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64",
                                                  "media_type": media_type,
                                                  "data": image_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        },
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        timeout=120.0,
    )
    if r.status_code != 200:
        raise LLMError(f"Anthropic vision error {r.status_code}: {r.text[:200]}")
    return r.json()["content"][0]["text"].strip()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def extract_json(text: str) -> dict:
    """Strip markdown fences and parse JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if text.startswith("json\n"):
        text = text[5:]
    return json.loads(text)
