"""Obligations (AHV, BVG, taxes, etc.) endpoints.

Mounted at /api/* by app.py. Exports OBLIGATION_TYPES dict (re-imported by app.py).
"""

from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from db import get_db
from helpers import delete_stored_file, serve_stored_file

router = APIRouter(tags=["obligations"])

_paths = {}


OBLIGATION_TYPES = {
    "ahv": "AHV/AVS (1st pillar)",
    "bvg_employee": "BVG Employee (2nd pillar)",
    "bvg_employer": "BVG Employer (2nd pillar)",
    "corporate_tax_federal": "Corporate Tax (Federal)",
    "corporate_tax_cantonal": "Corporate Tax (Cantonal)",
    "vat": "VAT",
    "uvg": "UVG (Accident — AXA)",
    "ktg": "KTG (Sick pay — AXA)",
    "source_tax": "Source Tax (Quellensteuer)",
    "accounting": "Treuhand",
    "other": "Other",
}


def configure(acct_dir: Path):
    _paths["ACCT_DIR"] = acct_dir


# The PAYABLE date is when money actually leaves: the bill's expected date
# when that is later than the period's due date (AHV akonto, Quellensteuer
# quarterly bills, …). Every overdue / upcoming / calendar / forecast view
# uses this — `due_date` alone only marks the accrual period.
PAYABLE_SQL = "MAX(due_date, COALESCE(expected_bill_date, due_date))"


def payable_date(r) -> str | None:
    due = r["due_date"]
    exp = r["expected_bill_date"] if "expected_bill_date" in r.keys() else None
    if not due:
        return exp
    return max(due, exp) if exp else due


@router.get("/obligations")
async def list_obligations(year: int | None = None):
    with get_db() as db:
        if year:
            rows = db.execute(
                "SELECT * FROM obligations WHERE period_year=? ORDER BY due_date, obligation_type",
                (year,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM obligations ORDER BY period_year DESC, due_date, obligation_type"
            ).fetchall()
    return [{
        "id": r["id"],
        "obligation_type": r["obligation_type"],
        "type_label": OBLIGATION_TYPES.get(r["obligation_type"], r["obligation_type"]),
        "period_label": r["period_label"],
        "period_year": r["period_year"],
        "amount": r["amount"],
        "currency": r["currency"],
        "due_date": r["due_date"],
        "status": r["status"],
        "notes": r["notes"] or "",
        "expected_bill_date": r["expected_bill_date"] if "expected_bill_date" in r.keys() else None,
        "expected_bill_amount": r["expected_bill_amount"] if "expected_bill_amount" in r.keys() else None,
        "payable_date": payable_date(r),
        "doc_file": r["doc_file"],
        "has_file": r["doc_file"] is not None,
    } for r in rows]


@router.get("/obligations/types")
async def obligation_types():
    return OBLIGATION_TYPES


@router.get("/obligations/summary")
async def obligations_summary():
    today = date.today()
    year = today.year
    with get_db() as db:
        rows = db.execute(
            """SELECT obligation_type,
                      SUM(amount) as total,
                      SUM(CASE WHEN status='unpaid' THEN amount ELSE 0 END) as unpaid
               FROM obligations WHERE period_year=? GROUP BY obligation_type""",
            (year,),
        ).fetchall()

        upcoming_cutoff = (today + timedelta(days=90)).isoformat()
        upcoming = db.execute(
            f"""SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL
               AND {PAYABLE_SQL} >= ? AND {PAYABLE_SQL} <= ? ORDER BY {PAYABLE_SQL}""",
            (str(today), upcoming_cutoff),
        ).fetchall()

        overdue = db.execute(
            f"SELECT * FROM obligations WHERE status='unpaid' AND {PAYABLE_SQL} < ? ORDER BY {PAYABLE_SQL}",
            (str(today),),
        ).fetchall()

    by_type = [{
        "obligation_type": r["obligation_type"],
        "type_label": OBLIGATION_TYPES.get(r["obligation_type"], r["obligation_type"]),
        "total_ytd": r["total"],
        "unpaid": r["unpaid"],
    } for r in rows]

    def ob_to_dict(r):
        return {
            "id": r["id"], "obligation_type": r["obligation_type"],
            "type_label": OBLIGATION_TYPES.get(r["obligation_type"], r["obligation_type"]),
            "period_label": r["period_label"], "amount": r["amount"],
            "currency": r["currency"], "due_date": r["due_date"],
            "status": r["status"], "notes": r["notes"] or "",
        }

    return {
        "year": year,
        "by_type": by_type,
        "total_ytd": sum(r["total_ytd"] for r in by_type),
        "total_unpaid": sum(r["unpaid"] for r in by_type),
        "upcoming_90d": [ob_to_dict(r) for r in upcoming],
        "overdue": [ob_to_dict(r) for r in overdue],
    }


@router.post("/obligations")
async def create_obligation(
    obligation_type: str = Form(...),
    period_label: str = Form(...),
    period_year: int = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    due_date: str = Form(""),
    status: str = Form("unpaid"),
    notes: str = Form(""),
    recurrence: str = Form("none"),
    expected_bill_date: str = Form(""),
    expected_bill_amount: float | None = Form(None),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    if obligation_type not in OBLIGATION_TYPES:
        raise HTTPException(400, f"Invalid type: {obligation_type}")
    doc_filename = None
    if doc and doc.filename:
        ext = Path(doc.filename).suffix.lower()
        doc_filename = f"obl_{uuid4().hex[:10]}{ext}"
        (ACCT_DIR / doc_filename).write_bytes(await doc.read())
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO obligations
               (obligation_type, period_label, period_year, amount, currency,
                due_date, status, notes, recurrence, doc_file,
                expected_bill_date, expected_bill_amount)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (obligation_type, period_label, period_year, amount, currency,
             due_date or None, status, notes, recurrence or "none", doc_filename,
             expected_bill_date or None, expected_bill_amount),
        )
    return {"id": cur.lastrowid}


@router.get("/obligations/{id}")
async def get_obligation(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM obligations WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return {
        "id": row["id"],
        "obligation_type": row["obligation_type"],
        "period_label": row["period_label"],
        "period_year": row["period_year"],
        "amount": row["amount"],
        "currency": row["currency"],
        "due_date": row["due_date"],
        "status": row["status"],
        "notes": row["notes"] or "",
        "expected_bill_date": row["expected_bill_date"] if "expected_bill_date" in row.keys() else None,
        "expected_bill_amount": row["expected_bill_amount"] if "expected_bill_amount" in row.keys() else None,
        "payable_date": payable_date(row),
        "recurrence": row["recurrence"] if "recurrence" in row.keys() else "none",
    }


@router.put("/obligations/{id}")
async def update_obligation(
    id: int,
    obligation_type: str = Form(...),
    period_label: str = Form(...),
    period_year: int = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    due_date: str = Form(""),
    status: str = Form("unpaid"),
    notes: str = Form(""),
    recurrence: str = Form("none"),
    expected_bill_date: str = Form(""),
    expected_bill_amount: float | None = Form(None),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM obligations WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        doc_filename = row["doc_file"]
        if doc and doc.filename:
            if doc_filename:
                old = ACCT_DIR / doc_filename
                if old.exists():
                    old.unlink()
            ext = Path(doc.filename).suffix.lower()
            doc_filename = f"obl_{uuid4().hex[:10]}{ext}"
            (ACCT_DIR / doc_filename).write_bytes(await doc.read())
        db.execute(
            """UPDATE obligations SET obligation_type=?, period_label=?, period_year=?,
               amount=?, currency=?, due_date=?, status=?, notes=?, recurrence=?, doc_file=?,
               expected_bill_date=?, expected_bill_amount=?
               WHERE id=?""",
            (obligation_type, period_label, period_year, amount, currency,
             due_date or None, status, notes, recurrence or "none", doc_filename,
             expected_bill_date or None, expected_bill_amount, id),
        )
    return {"message": "Updated"}


@router.patch("/obligations/{id}/status")
async def update_obligation_status(id: int, request: Request):
    body = await request.json()
    status = body.get("status")
    if status not in ("paid", "unpaid"):
        raise HTTPException(400, "Invalid status")
    with get_db() as db:
        db.execute("UPDATE obligations SET status=? WHERE id=?", (status, id))
    return {"message": "Updated"}


@router.delete("/obligations/{id}")
async def delete_obligation(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM obligations WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        delete_stored_file(ACCT_DIR, row["doc_file"])
        # If this is a recurring parent, promote oldest child to be the new
        # parent so the recurring chain isn't broken.
        oldest_child = db.execute(
            "SELECT id FROM obligations WHERE parent_obligation_id=? "
            "ORDER BY due_date LIMIT 1",
            (id,),
        ).fetchone()
        if oldest_child:
            new_parent = oldest_child["id"]
            db.execute(
                "UPDATE obligations SET parent_obligation_id=? "
                "WHERE parent_obligation_id=? AND id != ?",
                (new_parent, id, new_parent),
            )
            db.execute(
                "UPDATE obligations SET parent_obligation_id=NULL WHERE id=?",
                (new_parent,),
            )
        db.execute("DELETE FROM obligations WHERE id=?", (id,))
    return {"message": "Deleted"}


@router.get("/obligations/{id}/file")
async def get_obligation_file(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM obligations WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return serve_stored_file(ACCT_DIR, row["doc_file"])
