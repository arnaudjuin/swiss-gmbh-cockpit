"""Business trips — group expenses by a single travel event.

A trip has a name, purpose, date range, countries, and notes. Expenses can be
attached/detached via `expenses.trip_id`. The list endpoint also returns each
trip's rollup totals and expense count so the UI doesn't need a second roundtrip.
"""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException

from db import get_db

router = APIRouter()


def _trip_row(r, totals: dict | None = None) -> dict:
    t = totals.get(r["id"], {"count": 0, "total": 0.0}) if totals else {"count": 0, "total": 0.0}
    return {
        "id": r["id"],
        "name": r["name"],
        "purpose": r["purpose"],
        "start_date": r["start_date"],
        "end_date": r["end_date"],
        "countries": r["countries"],
        "notes": r["notes"],
        "is_active": bool(r["is_active"]),
        "expense_count": t["count"],
        "total_chf": round(t["total"], 2),
    }


def _fetch_totals(db) -> dict:
    rows = db.execute(
        "SELECT trip_id, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total "
        "FROM expenses WHERE trip_id IS NOT NULL GROUP BY trip_id"
    ).fetchall()
    return {r["trip_id"]: {"count": r["n"], "total": float(r["total"] or 0)} for r in rows}


@router.get("/trips")
async def list_trips():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM trips WHERE is_active=1 ORDER BY start_date DESC"
        ).fetchall()
        totals = _fetch_totals(db)
    return [_trip_row(r, totals) for r in rows]


@router.get("/trips/{id}")
async def get_trip(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM trips WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Trip not found")
        totals = _fetch_totals(db)
    return _trip_row(row, totals)


@router.get("/trips/{id}/expenses")
async def list_trip_expenses(id: int):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM trips WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Trip not found")
        rows = db.execute(
            "SELECT id, expense_date, description, amount, category, "
            "original_amount, original_currency, scan_file "
            "FROM expenses WHERE trip_id=? ORDER BY expense_date, id",
            (id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "expense_date": r["expense_date"],
            "description": r["description"],
            "amount": r["amount"],
            "category": r["category"],
            "original_amount": r["original_amount"],
            "original_currency": r["original_currency"],
            "scan_file": r["scan_file"],
            "has_scan": r["scan_file"] is not None,
        }
        for r in rows
    ]


@router.post("/trips")
async def create_trip(
    name: str = Form(...),
    purpose: str = Form(""),
    start_date: str = Form(...),
    end_date: str = Form(...),
    countries: str = Form(""),
    notes: str = Form(""),
):
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO trips (name, purpose, start_date, end_date, countries, notes)
               VALUES (?,?,?,?,?,?)""",
            (name, purpose, start_date, end_date, countries, notes),
        )
    return {"id": cur.lastrowid}


@router.put("/trips/{id}")
async def update_trip(
    id: int,
    name: str = Form(...),
    purpose: str = Form(""),
    start_date: str = Form(...),
    end_date: str = Form(...),
    countries: str = Form(""),
    notes: str = Form(""),
    is_active: int = Form(1),
):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM trips WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Trip not found")
        db.execute(
            """UPDATE trips SET name=?, purpose=?, start_date=?, end_date=?,
               countries=?, notes=?, is_active=?, updated_at=datetime('now')
               WHERE id=?""",
            (name, purpose, start_date, end_date, countries, notes, is_active, id),
        )
    return {"message": "Trip updated"}


@router.delete("/trips/{id}")
async def delete_trip(id: int):
    """Detaches all expenses (sets trip_id=NULL) then removes the trip."""
    with get_db() as db:
        if not db.execute("SELECT 1 FROM trips WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Trip not found")
        db.execute("UPDATE expenses SET trip_id=NULL WHERE trip_id=?", (id,))
        db.execute("DELETE FROM trips WHERE id=?", (id,))
    return {"message": "Trip deleted"}


@router.post("/trips/{id}/auto-assign")
async def auto_assign_expenses(id: int):
    """Assign all expenses whose date falls inside the trip's window."""
    with get_db() as db:
        trip = db.execute("SELECT * FROM trips WHERE id=?", (id,)).fetchone()
        if not trip:
            raise HTTPException(404, "Trip not found")
        result = db.execute(
            "UPDATE expenses SET trip_id=? "
            "WHERE trip_id IS NULL "
            "AND expense_date BETWEEN ? AND ?",
            (id, trip["start_date"], trip["end_date"]),
        )
    return {"assigned": result.rowcount}


@router.post("/expenses/{expense_id}/assign-trip")
async def assign_expense_to_trip(expense_id: int, trip_id: int | None = Form(None)):
    """Move a single expense to a trip (or unassign with trip_id=blank)."""
    with get_db() as db:
        if not db.execute("SELECT 1 FROM expenses WHERE id=?", (expense_id,)).fetchone():
            raise HTTPException(404, "Expense not found")
        if trip_id is not None and not db.execute("SELECT 1 FROM trips WHERE id=?", (trip_id,)).fetchone():
            raise HTTPException(404, "Trip not found")
        db.execute("UPDATE expenses SET trip_id=? WHERE id=?", (trip_id, expense_id))
    return {"message": "Updated"}
