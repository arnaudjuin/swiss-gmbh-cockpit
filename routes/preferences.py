"""User preferences (single-user — id=1).

Stored as a JSON blob so the frontend can shape it freely without backend
schema changes. Mounted at /api/preferences.
"""

import json

from fastapi import APIRouter, HTTPException, Request

from db import get_db

router = APIRouter(tags=["preferences"])


@router.get("/preferences")
async def get_preferences():
    with get_db() as db:
        row = db.execute("SELECT prefs FROM user_preferences WHERE id=1").fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["prefs"])
    except (json.JSONDecodeError, TypeError):
        return {}


@router.put("/preferences")
async def replace_preferences(request: Request):
    """Replace the entire preferences object. Caller sends a JSON dict."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Preferences must be a JSON object")
    payload = json.dumps(body, separators=(",", ":"))
    # Obligation labels may have changed — drop the routes-level cache.
    from routes.obligations import invalidate_label_cache
    invalidate_label_cache()
    with get_db() as db:
        db.execute(
            "UPDATE user_preferences SET prefs=?, updated_at=datetime('now') WHERE id=1",
            (payload,),
        )
    return {"ok": True}
