"""Invoice + Customer CRUD endpoints.

Mounted at /api/* by app.py.
Depends on db.row_to_dict, db.next_invoice_number, helpers.compute_dates,
generate_invoice.generate, plus injected constants (RATE, VAT_RATE, COMPANY, DEFAULT_CUSTOMER).
"""

import calendar
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from db import get_db, next_invoice_number, row_to_dict
from helpers import compute_dates
from generate_invoice import generate

router = APIRouter(tags=["invoicing"])

_paths = {}
_ctx = {}

def configure(pdf_dir: Path, default_customer: dict, company: str, rate: float, vat_rate: float):
    _paths["PDF_DIR"] = pdf_dir
    _ctx["DEFAULT_CUSTOMER"] = default_customer
    _ctx["COMPANY"] = company
    _ctx["RATE"] = rate
    _ctx["VAT_RATE"] = vat_rate


class InvoiceCreate(BaseModel):
    year: int
    month: int
    hours: float
    invoice_number: int | None = None
    customer_id: int | None = None
    notes: str | None = None


class InvoiceUpdate(BaseModel):
    year: int
    month: int
    hours: float
    customer_id: int | None = None
    notes: str | None = None


class CustomerCreate(BaseModel):
    name: str
    address: str | None = None
    city: str | None = None
    country: str | None = None
    email: str | None = None
    reference: str | None = None


def get_customer(db, customer_id=None):
    if customer_id:
        row = db.execute("SELECT * FROM customers WHERE id=?", (customer_id,)).fetchone()
        if row:
            return {k: row[k] for k in ("name", "address", "city", "country", "email", "reference")}
    return _ctx["DEFAULT_CUSTOMER"]


@router.get("/invoices")
async def list_invoices():
    # Exclude reimbursement reports (hours=0) — those have their own list at
    # /api/expenses/reports and shouldn't appear in the invoice table.
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM invoices WHERE hours > 0 ORDER BY year DESC, month DESC"
        ).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/invoices")
async def create_invoice(data: InvoiceCreate):
    inv_num = data.invoice_number or next_invoice_number()
    issued, due = compute_dates(data.year, data.month)

    subtotal = data.hours * _ctx["RATE"]
    tax = round(subtotal * _ctx["VAT_RATE"], 2)
    total = round(subtotal + tax, 2)

    with get_db() as db:
        customer = get_customer(db, data.customer_id)

    pdf_bytes = generate(data.year, data.month, data.hours, inv_num, customer=customer)
    (_paths["PDF_DIR"] / f"invoice_{inv_num:04d}.pdf").write_bytes(pdf_bytes)

    with get_db() as db:
        try:
            cur = db.execute(
                """INSERT INTO invoices
                   (invoice_number, year, month, hours, rate, vat_rate,
                    subtotal, tax, total, issued_date, due_date, notes)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (inv_num, data.year, data.month, data.hours, _ctx["RATE"], _ctx["VAT_RATE"],
                 subtotal, tax, total, str(issued), str(due), data.notes or ""),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(400, f"Invoice #{inv_num:04d} already exists")

    return {"id": cur.lastrowid, "invoice_number": inv_num}


@router.get("/invoices/{id}")
async def get_invoice(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM invoices WHERE id = ?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Invoice not found")
    return row_to_dict(row)


@router.put("/invoices/{id}")
async def update_invoice(id: int, data: InvoiceUpdate):
    with get_db() as db:
        row = db.execute("SELECT * FROM invoices WHERE id = ?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Invoice not found")

        inv_num = row["invoice_number"]
        issued, due = compute_dates(data.year, data.month)

        subtotal = data.hours * _ctx["RATE"]
        tax = round(subtotal * _ctx["VAT_RATE"], 2)
        total = round(subtotal + tax, 2)

        customer = get_customer(db, data.customer_id)
        pdf_bytes = generate(data.year, data.month, data.hours, inv_num, customer=customer)
        (_paths["PDF_DIR"] / f"invoice_{inv_num:04d}.pdf").write_bytes(pdf_bytes)

        db.execute(
            """UPDATE invoices
               SET year=?, month=?, hours=?, subtotal=?, tax=?, total=?,
                   issued_date=?, due_date=?, notes=?
               WHERE id=?""",
            (data.year, data.month, data.hours, subtotal, tax, total,
             str(issued), str(due), data.notes or "", id),
        )

    return {"message": f"Invoice #{inv_num:04d} updated"}


@router.delete("/invoices/{id}")
async def delete_invoice(id: int):
    with get_db() as db:
        row = db.execute(
            "SELECT invoice_number FROM invoices WHERE id = ?", (id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Invoice not found")

        inv_num = row["invoice_number"]
        pdf_path = _paths["PDF_DIR"] / f"invoice_{inv_num:04d}.pdf"
        if pdf_path.exists():
            pdf_path.unlink()

        # Cascade-delete the auto-linked income row, if any
        db.execute("DELETE FROM income_entries WHERE invoice_id = ?", (id,))
        db.execute("DELETE FROM invoices WHERE id = ?", (id,))

    return {"message": f"Invoice #{inv_num:04d} deleted"}


@router.get("/invoices/{id}/pdf")
async def download_pdf(id: int, download: bool = False):
    with get_db() as db:
        row = db.execute(
            "SELECT invoice_number, year, month FROM invoices WHERE id = ?", (id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Invoice not found")

    inv_num = row["invoice_number"]
    pdf_path = _paths["PDF_DIR"] / f"invoice_{inv_num:04d}.pdf"
    if not pdf_path.exists():
        raise HTTPException(404, "PDF not found")

    month_name = calendar.month_name[row["month"]]
    filename = f"Invoice {month_name} {row['year']} {_ctx["COMPANY"]} 101119.LOD-SW_GCS-24032.pdf"

    if download:
        return FileResponse(pdf_path, filename=filename, media_type="application/pdf")
    return FileResponse(pdf_path, media_type="application/pdf")


@router.get("/next-invoice-number")
async def get_next_number():
    return {"next": next_invoice_number()}


# ─── Customer Routes ─────────────────────────────────────────────────────────

@router.get("/customers")
async def list_customers():
    with get_db() as db:
        rows = db.execute("SELECT * FROM customers ORDER BY name").fetchall()
    return [
        {k: r[k] for k in ("id", "name", "address", "city", "country", "email", "reference", "created_at")}
        for r in rows
    ]


@router.post("/customers")
async def create_customer(data: CustomerCreate):
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO customers (name, address, city, country, email, reference) VALUES (?,?,?,?,?,?)",
            (data.name, data.address, data.city, data.country, data.email, data.reference),
        )
    return {"id": cur.lastrowid}


@router.get("/customers/{id}")
async def get_customer_route(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM customers WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Customer not found")
    return {k: row[k] for k in ("id", "name", "address", "city", "country", "email", "reference", "created_at")}


@router.put("/customers/{id}")
async def update_customer(id: int, data: CustomerCreate):
    with get_db() as db:
        row = db.execute("SELECT id FROM customers WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Customer not found")
        db.execute(
            "UPDATE customers SET name=?, address=?, city=?, country=?, email=?, reference=? WHERE id=?",
            (data.name, data.address, data.city, data.country, data.email, data.reference, id),
        )
    return {"message": "Customer updated"}


@router.delete("/customers/{id}")
async def delete_customer(id: int):
    with get_db() as db:
        db.execute("DELETE FROM customers WHERE id=?", (id,))
    return {"message": "Customer deleted"}


