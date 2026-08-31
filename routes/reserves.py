"""Reserves / sinking funds — monthly accruals toward known future cash-outs.

Each reserve has a target (e.g. CHF 5,000 for Treuhand), a target date, and a
monthly_accrual. The "accumulated" balance is computed = monthly_accrual ×
months_elapsed + accumulated_manual (for one-shot adjustments and prior payments).
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Form, HTTPException

from db import get_db

router = APIRouter()


def _months_elapsed(start_iso: str | None) -> int:
    """Whole calendar months from accrual_start to today (today inclusive). 0 if not started."""
    if not start_iso:
        return 0
    try:
        y, m, _ = start_iso.split("-")
        start = date(int(y), int(m), 1)
    except (ValueError, AttributeError):
        return 0
    today = date.today()
    if today < start:
        return 0
    return (today.year - start.year) * 12 + (today.month - start.month) + 1


def _row_to_dict(r) -> dict:
    accrued = round(_months_elapsed(r["accrual_start"]) * (r["monthly_accrual"] or 0)
                    + (r["accumulated_manual"] or 0), 2)
    target = r["target_amount"] or 0
    progress_pct = round(100 * accrued / target, 1) if target else 0
    return {
        "id": r["id"],
        "name": r["name"],
        "purpose": r["purpose"],
        "target_amount": target,
        "target_date": r["target_date"],
        "monthly_accrual": r["monthly_accrual"],
        "accrual_start": r["accrual_start"],
        "accumulated_manual": r["accumulated_manual"],
        "accumulated": accrued,
        "remaining": round(max(0, target - accrued), 2),
        "progress_pct": min(progress_pct, 100),
        "is_active": bool(r["is_active"]),
    }


@router.get("/reserves")
async def list_reserves():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM reserves WHERE is_active=1 ORDER BY target_date"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/reserves/summary")
async def reserves_summary():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM reserves WHERE is_active=1"
        ).fetchall()
    items = [_row_to_dict(r) for r in rows]
    return {
        "count": len(items),
        "target_total": round(sum(i["target_amount"] for i in items), 2),
        "accumulated_total": round(sum(i["accumulated"] for i in items), 2),
        "monthly_accrual_total": round(sum(i["monthly_accrual"] for i in items), 2),
    }


@router.post("/reserves")
async def create_reserve(
    name: str = Form(...),
    purpose: str = Form(""),
    target_amount: float = Form(...),
    target_date: str = Form(""),
    monthly_accrual: float = Form(0),
    accrual_start: str = Form(""),
    accumulated_manual: float = Form(0),
):
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO reserves
               (name, purpose, target_amount, target_date, monthly_accrual,
                accrual_start, accumulated_manual)
               VALUES (?,?,?,?,?,?,?)""",
            (name, purpose, target_amount, target_date or None, monthly_accrual,
             accrual_start or None, accumulated_manual),
        )
    return {"id": cur.lastrowid}


@router.put("/reserves/{id}")
async def update_reserve(
    id: int,
    name: str = Form(...),
    purpose: str = Form(""),
    target_amount: float = Form(...),
    target_date: str = Form(""),
    monthly_accrual: float = Form(0),
    accrual_start: str = Form(""),
    accumulated_manual: float = Form(0),
    is_active: int = Form(1),
):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM reserves WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Reserve not found")
        db.execute(
            """UPDATE reserves SET name=?, purpose=?, target_amount=?, target_date=?,
               monthly_accrual=?, accrual_start=?, accumulated_manual=?, is_active=?,
               updated_at=datetime('now')
               WHERE id=?""",
            (name, purpose, target_amount, target_date or None, monthly_accrual,
             accrual_start or None, accumulated_manual, is_active, id),
        )
    return {"message": "Reserve updated"}


@router.post("/reserves/{id}/contribute")
async def contribute_to_reserve(id: int, amount: float = Form(...), description: str = Form("")):
    return _reserve_move(id, "contribute", amount, description)


@router.post("/reserves/{id}/withdraw")
async def withdraw_from_reserve(id: int, amount: float = Form(...), description: str = Form("")):
    return _reserve_move(id, "withdraw", amount, description)


def _reserve_move(id: int, kind: str, amount: float, description: str):
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    delta = amount if kind == "contribute" else -amount
    with get_db() as db:
        row = db.execute("SELECT * FROM reserves WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Reserve not found")
        db.execute(
            "UPDATE reserves SET accumulated_manual = COALESCE(accumulated_manual,0) + ?, "
            "updated_at = datetime('now') WHERE id=?", (delta, id))
        db.execute(
            "INSERT INTO reserve_ledger (reserve_id, entry_date, kind, amount, description) VALUES (?,?,?,?,?)",
            (id, date.today().isoformat(), kind, amount, description or None))
        new_row = db.execute("SELECT * FROM reserves WHERE id=?", (id,)).fetchone()
    return _row_to_dict(new_row)


@router.get("/reserves/{id}/ledger")
async def reserve_ledger(id: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT entry_date, kind, amount, description FROM reserve_ledger "
            "WHERE reserve_id=? ORDER BY id DESC LIMIT 50", (id,)).fetchall()
    return [dict(r) for r in rows]


@router.delete("/reserves/{id}")
async def delete_reserve(id: int):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM reserves WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Reserve not found")
        db.execute("DELETE FROM reserves WHERE id=?", (id,))
    return {"message": "Reserve deleted"}
