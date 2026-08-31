"""Smoke test: boot the app and exercise every GET route to catch import/extraction bugs.

Run:  .venv/bin/python -m pytest test_smoke.py -v

The point is to catch 500 errors caused by the modular refactor (NameError,
ImportError, missing dependency injection, wrong path strip, etc.).

Strategy:
  - Boot app via TestClient.
  - Log in to get a session.
  - For every GET route with no path params (or a fillable int param), send a request.
  - Fail the test only on 500 — 4xx is acceptable (404 from a missing record is fine).
"""

import os

# Use default password before importing app
os.environ["ADMIN_PASSWORD"] = "test_smoke_password"

import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture(scope="module")
def client():
    c = TestClient(app)
    r = c.post("/api/login", json={"password": "test_smoke_password"})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    c.cookies.set("session", token)
    return c


def _expandable_get_routes():
    """Yield (path, route) for GET routes we can call without crafting a body."""
    for r in app.routes:
        if not hasattr(r, "methods") or "GET" not in r.methods:
            continue
        path = r.path
        # Skip routes that need real path params we can't synthesize
        if "{token}" in path:
            continue
        # Substitute {id} / {bill_id} / {year} / {month} with safe placeholders
        url = path
        url = url.replace("{id}", "999999")
        url = url.replace("{bill_id}", "999999")
        url = url.replace("{year}", "2099")
        url = url.replace("{month}", "1")
        # Anything still wrapped in braces means we can't call it
        if "{" in url:
            continue
        yield url, path


@pytest.mark.parametrize("url,template", list(_expandable_get_routes()))
def test_get_route_no_500(client: TestClient, url: str, template: str):
    """Every GET route should not raise an unhandled exception."""
    # Some search routes need a query param; supply a default
    if url == "/api/search":
        url = "/api/search?q=test"

    r = client.get(url, follow_redirects=False)
    assert r.status_code != 500, (
        f"{template} → {url} returned 500\nbody: {r.text[:500]}"
    )


def test_login_logout_flow():
    c = TestClient(app)
    # Wrong password
    r = c.post("/api/login", json={"password": "wrong"})
    assert r.status_code == 401
    # Correct password
    r = c.post("/api/login", json={"password": "test_smoke_password"})
    assert r.status_code == 200
    token = r.json()["token"]
    c.cookies.set("session", token)
    # Auth check passes
    r = c.get("/api/auth/check")
    assert r.status_code == 200
    # Logout
    r = c.post("/api/logout")
    assert r.status_code == 200


def test_unauthenticated_blocked():
    c = TestClient(app)
    r = c.get("/api/dashboard")
    assert r.status_code == 401


def test_root_serves_html(client: TestClient):
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    # After the static-asset extraction the page must reference both files
    body = r.text
    assert '/static/app.css' in body
    assert '/static/js/01-core.js' in body
    assert '/static/js/09-misc.js' in body


def test_static_assets_served(client: TestClient):
    # Static assets must be reachable without auth
    from fastapi.testclient import TestClient as TC
    from app import app as raw_app
    anon = TC(raw_app)
    css = anon.get("/static/app.css")
    assert css.status_code == 200
    assert "text/css" in css.headers.get("content-type", "")
    js = anon.get("/static/js/01-core.js")
    assert js.status_code == 200
    assert "javascript" in js.headers.get("content-type", "")


def test_route_count():
    """Sanity check: the app should expose roughly the expected number of routes."""
    api_routes = [r for r in app.routes if hasattr(r, "path") and r.path.startswith("/api/")]
    # We had ~110 /api/* routes after extraction; alert if it drops drastically
    assert len(api_routes) > 90, f"Only {len(api_routes)} /api/* routes — extraction may have dropped some"


# ─── Write-method smoke tests ───────────────────────────────────────────────
# Strategy: send empty bodies so Pydantic returns 422 before the handler runs;
# use {id}=999999 so handlers that do reach the DB find nothing and 404. Both
# paths are mutation-safe. The few routes that would mutate without any input
# go in the skip set below.

# Routes that execute a mutation with no body / on a guessable path —
# excluded from the auto-test so we don't dirty the live DB.
WRITE_SKIP = {
    ("POST",   "/api/accounting/generate-recurring"),
    ("POST",   "/api/obligations/generate-recurring"),
    ("POST",   "/api/budget/contribute-all"),
    ("POST",   "/api/payroll/generate/{year}/{month}"),
    ("POST",   "/api/login"),                 # covered by test_login_logout_flow
    ("POST",   "/api/logout"),                # covered by test_login_logout_flow
    ("PUT",    "/api/cash-balance"),          # empty body silently sets balance=0
    ("PUT",    "/api/preferences"),           # empty body clobbers all user prefs
}


def _expandable_write_routes():
    for r in app.routes:
        if not hasattr(r, "methods"):
            continue
        for m in r.methods:
            if m not in {"POST", "PUT", "PATCH", "DELETE"}:
                continue
            path = r.path
            if (m, path) in WRITE_SKIP:
                continue
            if "{token}" in path:
                continue
            url = (path
                   .replace("{id}", "999999")
                   .replace("{bill_id}", "999999")
                   .replace("{item_id}", "999999")
                   .replace("{entry_id}", "999999")
                   .replace("{year}", "2099")
                   .replace("{month}", "1"))
            if "{" in url:
                continue
            yield m, url, path


@pytest.mark.parametrize("method,url,template", list(_expandable_write_routes()))
def test_write_route_no_500(client: TestClient, method: str, url: str, template: str):
    """Write routes should reject empty/non-existent inputs with 4xx, never 500."""
    r = client.request(method, url, json={})
    assert r.status_code != 500, (
        f"{method} {template} → {url} returned 500\nbody: {r.text[:500]}"
    )
    # Anything from 200 (no-op success) through 499 is fine; 5xx means a wiring bug.
    assert r.status_code < 500


def test_customer_crud_round_trip(client: TestClient):
    """End-to-end create → read → update → delete on the simplest entity.

    Customers have no PDFs/files attached, so the full write path is exercised
    without leaving artefacts on disk.
    """
    marker = "smoke-test-temp-customer"

    # Create
    r = client.post("/api/customers", json={
        "name": marker, "address": "Test 1", "city": "Zurich",
        "country": "Switzerland", "email": "smoke@test.local",
    })
    assert r.status_code == 200, r.text
    cust_id = r.json()["id"]
    assert cust_id > 0

    try:
        # Appears in the list
        r = client.get("/api/customers")
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert marker in names

        # Update
        r = client.put(f"/api/customers/{cust_id}", json={
            "name": marker + "-updated", "address": "Test 2", "city": "Bern",
            "country": "Switzerland", "email": "smoke@test.local",
        })
        assert r.status_code == 200, r.text
    finally:
        # Always clean up
        r = client.delete(f"/api/customers/{cust_id}")
        assert r.status_code == 200, r.text

    # Verify deletion
    r = client.get("/api/customers")
    names_after = [c["name"] for c in r.json()]
    assert marker not in names_after
    assert (marker + "-updated") not in names_after


def test_preferences_round_trip(client: TestClient):
    """PUT/GET /api/preferences should round-trip and reject non-dict bodies.

    Snapshots and restores the user's real prefs so the test doesn't clobber them.
    """
    snapshot = client.get("/api/preferences").json()
    try:
        sample = {"_smoke_test": {"a": 1, "b": [2, 3]}}
        r = client.put("/api/preferences", json=sample)
        assert r.status_code == 200
        assert client.get("/api/preferences").json() == sample

        # Non-dict bodies must be rejected
        r = client.put("/api/preferences", json=["not", "a", "dict"])
        assert r.status_code == 400
    finally:
        client.put("/api/preferences", json=snapshot)
        assert client.get("/api/preferences").json() == snapshot
