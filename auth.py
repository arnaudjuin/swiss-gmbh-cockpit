"""Auth: session middleware + login/logout/check routes + security hardening.

Wire up by calling `register(app, password, ttl)` from app.py.
The shared `active_sessions` dict is exposed for use by routes_public (token check).
"""

import logging
import secrets
import time
from collections import deque

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

log = logging.getLogger(__name__)


# In-memory session store: {token: expiry_timestamp}
active_sessions: dict[str, float] = {}

_admin_password: str = "demo"
_session_ttl: int = 86400

# Rate-limit state: {client_ip: deque[attempt_timestamps]} — keeps the last
# WINDOW seconds of failed-login timestamps; if >= MAX, the IP is blocked.
_login_attempts: dict[str, "deque[float]"] = {}
_LOGIN_WINDOW_S = 900   # 15-minute rolling window
_LOGIN_MAX_FAIL = 10    # max failed attempts in window before block


def _client_ip(request: Request) -> str:
    # Prefer the X-Forwarded-For first hop when behind Caddy/Cloudflare.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _record_attempt(ip: str) -> int:
    """Append now to this IP's deque; return how many fails in the window."""
    now = time.time()
    q = _login_attempts.setdefault(ip, deque())
    # Drop attempts outside the window
    while q and q[0] < now - _LOGIN_WINDOW_S:
        q.popleft()
    q.append(now)
    return len(q)


def _is_blocked(ip: str) -> bool:
    """Has this IP exhausted its allowance?"""
    now = time.time()
    q = _login_attempts.get(ip)
    if not q:
        return False
    while q and q[0] < now - _LOGIN_WINDOW_S:
        q.popleft()
    return len(q) >= _LOGIN_MAX_FAIL


def _clear_attempts(ip: str) -> None:
    _login_attempts.pop(ip, None)


class LoginRequest(BaseModel):
    password: str


router = APIRouter(tags=["auth"])


@router.post("/api/login")
async def login(data: LoginRequest, request: Request):
    ip = _client_ip(request)
    if _is_blocked(ip):
        log.warning("Login throttled for IP %s (>= %d fails in %ds)", ip, _LOGIN_MAX_FAIL, _LOGIN_WINDOW_S)
        raise HTTPException(
            429,
            f"Too many failed login attempts — wait {_LOGIN_WINDOW_S // 60} minutes.",
        )
    if not secrets.compare_digest(data.password, _admin_password):
        n = _record_attempt(ip)
        log.warning("Failed login from %s (%d/%d)", ip, n, _LOGIN_MAX_FAIL)
        raise HTTPException(401, "Invalid password")
    # Success — clear the throttle for this IP and issue a token
    _clear_attempts(ip)
    token = secrets.token_urlsafe(32)
    active_sessions[token] = time.time() + _session_ttl
    return {"ok": True, "token": token}


@router.post("/api/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if token and token in active_sessions:
        del active_sessions[token]
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
    return response


@router.get("/api/auth/check")
async def auth_check(request: Request):
    token = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("session")
    if token and token in active_sessions and active_sessions[token] >= time.time():
        return {"authenticated": True}
    raise HTTPException(401, "Not authenticated")


def register(app: FastAPI, password: str, ttl: int, host: str = "127.0.0.1") -> None:
    """Install auth middleware + routes on the app.

    Raises a clear error if the default password 'demo' is in use AND the
    server is bound to anything other than localhost — that combo would put a
    weak credential on the open network.
    """
    global _admin_password, _session_ttl
    _admin_password = password
    _session_ttl = ttl

    if password == "demo" and host not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError(
            f"Refusing to start: server is bound to HOST={host} with the "
            "default password 'demo'. Set ADMIN_PASSWORD to a real value "
            "in your .env (or via the start.sh launcher) before exposing the "
            "app on any network interface other than localhost."
        )
    if password == "demo":
        log.warning("⚠ Default password 'demo' is in use — only safe on HOST=127.0.0.1.")

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        path = request.url.path
        if path == "/" or path == "/api/login" or path == "/api/auth/check":
            return await call_next(request)
        if path.startswith("/share/") or path.startswith("/static/"):
            return await call_next(request)
        if path == "/quick":
            return await call_next(request)
        if path.startswith("/api/"):
            token = None
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
            if not token:
                token = request.query_params.get("token")
            if not token:
                token = request.cookies.get("session")
            if not token or token not in active_sessions:
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
            if active_sessions[token] < time.time():
                del active_sessions[token]
                return JSONResponse({"detail": "Session expired"}, status_code=401)
        return await call_next(request)

    app.include_router(router)
