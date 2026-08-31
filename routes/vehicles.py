"""Vehicles owned by the GmbH — for depreciation + Privatanteil tracking."""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException

from db import get_db

router = APIRouter()


def _row(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "vendor": r["vendor"],
        "purchase_date": r["purchase_date"],
        "purchase_price": r["purchase_price"],
        "vat_paid": r["vat_paid"],
        "purchase_invoice_file": r["purchase_invoice_file"],
        "registration_number": r["registration_number"],
        "fahrzeugausweis_file": r["fahrzeugausweis_file"],
        "depreciation_method": r["depreciation_method"],
        "privatanteil_method": r["privatanteil_method"],
        "privatanteil_monthly": r["privatanteil_monthly"],
        "is_active": bool(r["is_active"]),
        "notes": r["notes"],
        "created_at": r["created_at"],
    }


@router.get("/vehicles")
async def list_vehicles():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM vehicles WHERE is_active=1 ORDER BY purchase_date DESC"
        ).fetchall()
    return [_row(r) for r in rows]


@router.get("/vehicles/{id}")
async def get_vehicle(id: int):
    with get_db() as db:
        r = db.execute("SELECT * FROM vehicles WHERE id=?", (id,)).fetchone()
    if not r:
        raise HTTPException(404, "Vehicle not found")
    return _row(r)


@router.post("/vehicles")
async def create_vehicle(
    name: str = Form(...),
    vendor: str = Form(""),
    purchase_date: str = Form(...),
    purchase_price: float = Form(...),
    vat_paid: float | None = Form(None),
    registration_number: str = Form(""),
    depreciation_method: str = Form("degressive_40"),
    privatanteil_method: str = Form("pauschal"),
    privatanteil_monthly: float | None = Form(None),
    notes: str = Form(""),
):
    # Auto-compute Privatanteil for pauschal method (0.9 % × purchase_price)
    if privatanteil_monthly is None and privatanteil_method == "pauschal":
        privatanteil_monthly = round(purchase_price * 0.009, 2)
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO vehicles
               (name, vendor, purchase_date, purchase_price, vat_paid,
                registration_number, depreciation_method, privatanteil_method,
                privatanteil_monthly, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (name, vendor or None, purchase_date, purchase_price, vat_paid,
             registration_number or None, depreciation_method, privatanteil_method,
             privatanteil_monthly, notes or None),
        )
    return {"id": cur.lastrowid, "privatanteil_monthly": privatanteil_monthly}


@router.put("/vehicles/{id}")
async def update_vehicle(
    id: int,
    name: str = Form(...),
    vendor: str = Form(""),
    purchase_date: str = Form(...),
    purchase_price: float = Form(...),
    vat_paid: float | None = Form(None),
    registration_number: str = Form(""),
    depreciation_method: str = Form("degressive_40"),
    privatanteil_method: str = Form("pauschal"),
    privatanteil_monthly: float | None = Form(None),
    notes: str = Form(""),
    is_active: int = Form(1),
):
    if privatanteil_monthly is None and privatanteil_method == "pauschal":
        privatanteil_monthly = round(purchase_price * 0.009, 2)
    with get_db() as db:
        if not db.execute("SELECT 1 FROM vehicles WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Vehicle not found")
        db.execute(
            """UPDATE vehicles SET
               name=?, vendor=?, purchase_date=?, purchase_price=?, vat_paid=?,
               registration_number=?, depreciation_method=?, privatanteil_method=?,
               privatanteil_monthly=?, notes=?, is_active=?,
               updated_at=datetime('now')
               WHERE id=?""",
            (name, vendor or None, purchase_date, purchase_price, vat_paid,
             registration_number or None, depreciation_method, privatanteil_method,
             privatanteil_monthly, notes or None, is_active, id),
        )
    return {"message": "Vehicle updated"}


@router.delete("/vehicles/{id}")
async def delete_vehicle(id: int):
    with get_db() as db:
        if not db.execute("SELECT 1 FROM vehicles WHERE id=?", (id,)).fetchone():
            raise HTTPException(404, "Vehicle not found")
        db.execute("DELETE FROM vehicles WHERE id=?", (id,))
    return {"message": "Vehicle deleted"}


@router.get("/vehicles/{id}/book-value")
async def book_value(id: int, as_of: str | None = None):
    """Compute current book value using the chosen depreciation method.
    Returns purchase price minus accumulated depreciation."""
    from datetime import date
    with get_db() as db:
        r = db.execute("SELECT * FROM vehicles WHERE id=?", (id,)).fetchone()
    if not r:
        raise HTTPException(404, "Vehicle not found")
    purchase_d = date.fromisoformat(r["purchase_date"])
    as_of_d = date.fromisoformat(as_of) if as_of else date.today()
    years_held = max(0, (as_of_d - purchase_d).days / 365.25)
    price = float(r["purchase_price"] or 0)
    method = r["depreciation_method"] or "degressive_40"
    if method == "degressive_40":
        # 40 % degressive (declining balance)
        book = price * (0.6 ** years_held)
    elif method == "linear_20":
        # 20 % per year, capped at full depreciation
        book = max(0, price * (1 - 0.20 * years_held))
    else:
        book = price
    return {
        "id": id,
        "purchase_price": price,
        "purchase_date": r["purchase_date"],
        "as_of": as_of_d.isoformat(),
        "years_held": round(years_held, 2),
        "depreciation_method": method,
        "book_value": round(book, 2),
        "accumulated_depreciation": round(price - book, 2),
    }
