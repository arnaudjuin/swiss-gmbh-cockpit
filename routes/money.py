"""Account transfers (Personal ↔ GmbH) + Income entries.

Mounted at /api/* by app.py.
"""

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from db import get_db
from helpers import delete_stored_file, serve_stored_file

router = APIRouter(tags=["money"])

_paths = {}


INCOME_CATEGORIES = ["Salary", "Invoice Payment", "Bank Deposit", "Other"]


def configure(acct_dir: Path):
    _paths["ACCT_DIR"] = acct_dir


# ─── Account Transfers (Personal ↔ GmbH) ────────────────────────────────────

@router.get("/transfers")
async def list_transfers():
    with get_db() as db:
        rows = db.execute("SELECT * FROM account_transfers ORDER BY transfer_date DESC").fetchall()
    return [{
        "id": r["id"], "transfer_date": r["transfer_date"],
        "direction": r["direction"], "amount": r["amount"],
        "currency": r["currency"], "description": r["description"] or "",
        "doc_file": r["doc_file"], "has_file": r["doc_file"] is not None,
        "file_type": (r["doc_file"].rsplit(".",1)[-1] if r["doc_file"] else None),
    } for r in rows]


def kontokorrent_balance(db) -> dict:
    """Net Kontokorrent from the GmbH's perspective. Positive = GmbH owes you.

    Salary transfers are wages (not debt) and personal-card reimbursements
    settle debt that is symmetrically excluded (bills counted unreimbursed-only),
    so both are stripped — see CONTRIBUTING.md bookkeeping invariants.
    """
    rows = db.execute("SELECT direction, SUM(amount) as total FROM account_transfers GROUP BY direction").fetchall()
    salary = db.execute(
        "SELECT COALESCE(SUM(amount),0) as t FROM account_transfers "
        "WHERE direction='gmbh_to_personal' AND description LIKE 'Net salary%'"
    ).fetchone()
    reimb = db.execute(
        "SELECT COALESCE(SUM(amount),0) as t FROM account_transfers "
        "WHERE direction='gmbh_to_personal' AND description LIKE 'Personal-card reimbursement%'"
    ).fetchone()
    pc = db.execute(
        "SELECT COALESCE(SUM(amount),0) as t, COUNT(*) as n FROM company_docs "
        "WHERE paid_via='personal' AND reimbursed_at IS NULL"
    ).fetchone()
    er = db.execute(
        "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as n FROM expense_reports WHERE reimbursed_at IS NULL"
    ).fetchone()
    to_gmbh = 0.0
    to_personal = 0.0
    for r in rows:
        if r["direction"] == "personal_to_gmbh":
            to_gmbh = r["total"]
        elif r["direction"] == "gmbh_to_personal":
            to_personal = r["total"]
    salary_excluded = float(salary["t"] or 0)
    reimb_excluded = float(reimb["t"] or 0)
    personal_card = float(pc["t"] or 0)
    expense_reports = float(er["t"] or 0)
    return {
        "expense_reports_outstanding": expense_reports,
        "expense_reports_open_count": int(er["n"] or 0),
        "personal_card_open_count": int(pc["n"] or 0),
        "personal_to_gmbh": to_gmbh,
        "gmbh_to_personal": to_personal,
        "salary_transfers_excluded": salary_excluded,
        "reimbursement_transfers_excluded": reimb_excluded,
        "personal_card_expenses": personal_card,   # unreimbursed only
        "net_owed_to_personal": round(
            to_gmbh + personal_card + expense_reports - (to_personal - salary_excluded - reimb_excluded), 2),
    }


@router.get("/transfers/balance")
async def transfer_balance():
    """Net balance from GmbH's perspective. Positive = GmbH owes personal."""
    with get_db() as db:
        return kontokorrent_balance(db)


@router.get("/transfers/export.csv")
async def export_transfers_csv(year: int | None = Query(None)):
    """Streamed CSV of all transfers (optionally filtered by year)."""
    import csv
    import io

    sql = "SELECT transfer_date, direction, amount, currency, description FROM account_transfers"
    args: list = []
    if year is not None:
        sql += " WHERE substr(transfer_date,1,4)=?"
        args.append(str(year))
    sql += " ORDER BY transfer_date"

    with get_db() as db:
        rows = db.execute(sql, args).fetchall()

    def _type(r) -> str:
        d = r["description"] or ""
        if d.startswith("Net salary"):
            return "salary (wages — not Kontokorrent)"
        if d.startswith("Personal-card reimbursement"):
            return "personal-card reimbursement (settles fronted bills)"
        return "owner transfer (Kontokorrent)"

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Direction", "Type", "Amount", "Currency", "Description", "Net effect"])
    for r in rows:
        sign = "+" if r["direction"] == "personal_to_gmbh" else "−"
        writer.writerow([
            r["transfer_date"],
            r["direction"],
            _type(r),
            f'{r["amount"]:.2f}',
            r["currency"],
            r["description"] or "",
            f'{sign}{r["amount"]:.2f}',
        ])

    # Trailing summary for the bookkeeper — Kontokorrent semantics: salary is
    # compensation and personal-card reimbursements settle bills tracked on
    # the bills side, so both stay out of the "owed" figure.
    owner_rows  = [r for r in rows if _type(r).startswith("owner")]
    to_gmbh     = sum(r["amount"] for r in owner_rows if r["direction"] == "personal_to_gmbh")
    to_personal = sum(r["amount"] for r in owner_rows if r["direction"] == "gmbh_to_personal")
    salary_total = sum(r["amount"] for r in rows if _type(r).startswith("salary"))
    reimb_total  = sum(r["amount"] for r in rows if _type(r).startswith("personal-card"))
    writer.writerow([])
    writer.writerow(["TOTAL owner Personal → GmbH", "", "", f"{to_gmbh:.2f}", "CHF", "", ""])
    writer.writerow(["TOTAL owner GmbH → Personal", "", "", f"{to_personal:.2f}", "CHF", "", ""])
    writer.writerow(["NET owed to Personal (Kontokorrent, excl. salary/reimbursements)",
                     "", "", f"{(to_gmbh - to_personal):.2f}", "CHF", "", ""])
    writer.writerow(["Info: salary payments (wages)", "", "", f"{salary_total:.2f}", "CHF", "", ""])
    writer.writerow(["Info: personal-card reimbursements", "", "", f"{reimb_total:.2f}", "CHF", "", ""])

    filename = f"transfers_{year or 'all'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/transfers")
async def create_transfer(
    transfer_date: str = Form(...),
    direction: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    description: str = Form(""),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    if direction not in ("personal_to_gmbh", "gmbh_to_personal"):
        raise HTTPException(400, "Invalid direction")
    doc_filename = None
    if doc and doc.filename:
        ext = Path(doc.filename).suffix.lower()
        doc_filename = f"xfer_{uuid4().hex[:10]}{ext}"
        (ACCT_DIR / doc_filename).write_bytes(await doc.read())
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO account_transfers
               (transfer_date, direction, amount, currency, description, doc_file)
               VALUES (?,?,?,?,?,?)""",
            (transfer_date, direction, amount, currency, description, doc_filename),
        )
    return {"id": cur.lastrowid}


@router.delete("/transfers/{id}")
async def delete_transfer(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM account_transfers WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Transfer not found")
        delete_stored_file(ACCT_DIR, row["doc_file"])
        db.execute("DELETE FROM account_transfers WHERE id=?", (id,))
    return {"message": "Transfer deleted"}


@router.get("/transfers/{id}/file")
async def get_transfer_file(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM account_transfers WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return serve_stored_file(ACCT_DIR, row["doc_file"])


# ─── Income Entries ──────────────────────────────────────────────────────────

@router.get("/income")
async def list_income(year: int | None = None):
    with get_db() as db:
        if year:
            rows = db.execute(
                "SELECT * FROM income_entries WHERE substr(income_date,1,4)=? ORDER BY income_date DESC",
                (str(year),),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM income_entries ORDER BY income_date DESC").fetchall()
    return [{
        "id": r["id"], "income_date": r["income_date"], "source": r["source"],
        "description": r["description"] or "", "amount": r["amount"],
        "currency": r["currency"], "category": r["category"],
        "doc_file": r["doc_file"], "has_file": r["doc_file"] is not None,
        "invoice_id": r["invoice_id"] if "invoice_id" in r.keys() else None,
    } for r in rows]


@router.post("/income")
async def create_income(
    income_date: str = Form(...),
    source: str = Form(...),
    description: str = Form(""),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    category: str = Form("Other"),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    doc_filename = None
    if doc and doc.filename:
        ext = Path(doc.filename).suffix.lower()
        doc_filename = f"inc_{uuid4().hex[:10]}{ext}"
        (ACCT_DIR / doc_filename).write_bytes(await doc.read())
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO income_entries
               (income_date, source, description, amount, currency, category, doc_file)
               VALUES (?,?,?,?,?,?,?)""",
            (income_date, source, description, amount, currency, category, doc_filename),
        )
    return {"id": cur.lastrowid}


@router.delete("/income/{id}")
async def delete_income(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM income_entries WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Income not found")
        delete_stored_file(ACCT_DIR, row["doc_file"])
        db.execute("DELETE FROM income_entries WHERE id=?", (id,))
    return {"message": "Income deleted"}


@router.get("/income/{id}/file")
async def get_income_file(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM income_entries WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return serve_stored_file(ACCT_DIR, row["doc_file"])
