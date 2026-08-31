"""Company accounting (bills) endpoints.

Mounted at /api/* by app.py.
"""

from datetime import date
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from db import get_db
from helpers import save_upload, delete_stored_file, serve_stored_file

router = APIRouter(tags=["accounting"])

_paths = {}

ACCT_CATEGORIES = [
    "Office Supplies", "Software/Subscriptions", "Professional Services",
    "Insurance", "Payroll Settlement", "Rent", "Telecom", "Legal",
    "Bank Fees", "Taxes / VAT", "Other",
]


def configure(acct_dir: Path):
    _paths["ACCT_DIR"] = acct_dir


def _book_amount(amount: float, currency: str, fx_rate: float | None):
    """Resolve the CHF book value of a bill.

    `amount` is entered in `currency`. For CHF it is the book value as-is.
    For anything else an fx_rate (CHF per 1 unit) is required; the CHF
    value is booked and the original figure + rate are kept alongside.
    Returns (chf_amount, original_amount, original_currency, fx_rate)."""
    cur = (currency or "CHF").upper()
    if cur == "CHF":
        return round(float(amount), 2), None, None, None
    if not fx_rate or fx_rate <= 0:
        raise HTTPException(400, f"fx_rate (CHF per 1 {cur}) is required for a {cur} bill")
    return round(float(amount) * float(fx_rate), 2), round(float(amount), 2), cur, float(fx_rate)


async def _bank_matches(amount: float, doc_date: str, days_before: int = 5,
                        days_after: int = 35, tol: float = 0.05) -> list[dict]:
    """Bank outflows (any uploaded statement) whose absolute amount equals
    `amount` ±tol in the window [doc_date − days_before, doc_date + days_after].
    Asymmetric on purpose: invoices are paid up to ~30 days after their date,
    card receipts the same day. Used to warn when a bill marked 'paid
    personally' was in fact debited from the GmbH account."""
    from datetime import datetime as _dt, timedelta
    from routes.bank import list_transactions
    try:
        d0 = _dt.strptime(doc_date[:10], "%Y-%m-%d")
    except Exception:
        return []
    lo = (d0 - timedelta(days=days_before)).date().isoformat()
    hi = (d0 + timedelta(days=days_after)).date().isoformat()
    with get_db() as db:
        stmts = db.execute(
            "SELECT id FROM bank_statements WHERE period_end >= ? AND period_start <= ?", (lo, hi)
        ).fetchall()
    hits = []
    for s in stmts:
        data = await list_transactions(s["id"])
        if not isinstance(data, dict) or "transactions" not in data:
            continue
        for tx in data["transactions"]:
            rows = tx.get("sub_entries") or [tx]
            for t in rows:
                amt = float(t.get("amount") or 0)
                tdate = (t.get("date") or tx.get("date") or "")[:10]
                if amt < 0 and abs(abs(amt) - amount) <= tol and lo <= tdate <= hi:
                    hits.append({"date": tdate, "amount": amt,
                                 "counterparty": t.get("counterparty") or tx.get("counterparty") or "",
                                 "statement_id": s["id"]})
    return hits


def _clean_doc_url(url: str) -> str | None:
    """Normalize an external document link (Google Drive share link, Dropbox,
    …) — any URL pointing at the bill's PDF/PNG, wherever it lives."""
    url = (url or "").strip()
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Document link must start with http:// or https://")
    if len(url) > 2000:
        raise HTTPException(400, "Document link is too long")
    return url


@router.get("/accounting")
async def list_accounting(year: int | None = None):
    with get_db() as db:
        if year:
            rows = db.execute(
                "SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date DESC",
                (str(year),),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM company_docs ORDER BY doc_date DESC").fetchall()
    return [
        {
            "id": r["id"],
            "doc_date": r["doc_date"],
            "vendor": r["vendor"],
            "description": r["description"],
            "amount": r["amount"],
            "currency": r["currency"],
            "category": r["category"],
            "due_date": r["due_date"],
            "status": r["status"],
            "recurrence": r["recurrence"] if "recurrence" in r.keys() else "none",
            "parent_doc_id": r["parent_doc_id"] if "parent_doc_id" in r.keys() else None,
            "paid_via": r["paid_via"] if "paid_via" in r.keys() else "company",
            "reimbursed_at": r["reimbursed_at"] if "reimbursed_at" in r.keys() else None,
            "doc_url": r["doc_url"] if "doc_url" in r.keys() else None,
            "original_amount": r["original_amount"] if "original_amount" in r.keys() else None,
            "original_currency": r["original_currency"] if "original_currency" in r.keys() else None,
            "fx_rate": r["fx_rate"] if "fx_rate" in r.keys() else None,
            "doc_file": r["doc_file"],
            "has_file": r["doc_file"] is not None,
            "file_type": (r["doc_file"].rsplit(".", 1)[-1] if r["doc_file"] else None),
        }
        for r in rows
    ]


@router.get("/accounting/years")
async def accounting_years():
    with get_db() as db:
        rows = db.execute(
            "SELECT DISTINCT substr(doc_date,1,4) as y FROM company_docs ORDER BY y"
        ).fetchall()
    return [r["y"] for r in rows]


@router.get("/accounting/categories")
async def accounting_categories():
    return ACCT_CATEGORIES


@router.get("/accounting/summary")
async def accounting_summary():
    with get_db() as db:
        rows = db.execute("""
            SELECT substr(doc_date,1,4) as year,
                   COUNT(*) as count,
                   SUM(amount) as total
            FROM company_docs GROUP BY year ORDER BY year
        """).fetchall()
    return [{"year": r["year"], "count": r["count"], "total": r["total"]} for r in rows]


@router.get("/accounting/export/{year}")
async def export_accounting_zip(year: int):
    import csv
    import io
    import zipfile

    ACCT_DIR = _paths["ACCT_DIR"]

    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date",
            (str(year),),
        ).fetchall()
    if not rows:
        raise HTTPException(404, f"No documents for {year}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow(["Date", "Vendor", "Description", "Amount CHF", "Original amount", "Original currency", "FX rate", "Category",
                         "Paid via", "Reimbursed", "Filename", "Document link"])
        for r in rows:
            orig_name = ""
            if r["doc_file"]:
                ext = Path(r["doc_file"]).suffix
                safe_vendor = r["vendor"].replace("/", "-").replace("\\", "-")[:30]
                orig_name = f"{r['doc_date']}_{safe_vendor}_{r['amount']}{ext}"
            paid_via = r["paid_via"] if "paid_via" in r.keys() else "company"
            reimbursed = (r["reimbursed_at"] if "reimbursed_at" in r.keys() else None) or ""
            writer.writerow([
                r["doc_date"], r["vendor"], r["description"],
                r["amount"],
                (r["original_amount"] if "original_amount" in r.keys() else None) or "",
                (r["original_currency"] if "original_currency" in r.keys() else None) or "",
                (r["fx_rate"] if "fx_rate" in r.keys() else None) or "",
                r["category"],
                "private account/card" if paid_via == "personal" else "company account",
                (reimbursed or "OUTSTANDING") if paid_via == "personal" else "",
                orig_name,
                (r["doc_url"] if "doc_url" in r.keys() else None) or "",
            ])
        zf.writestr(f"summary_{year}.csv", csv_buf.getvalue())

        for r in rows:
            if r["doc_file"]:
                file_path = ACCT_DIR / r["doc_file"]
                if file_path.exists():
                    ext = Path(r["doc_file"]).suffix
                    safe_vendor = r["vendor"].replace("/", "-").replace("\\", "-")[:30]
                    arc_name = f"{r['doc_date']}_{safe_vendor}_{r['amount']}{ext}"
                    zf.write(file_path, arc_name)

    buf.seek(0)
    zip_path = ACCT_DIR / f"accounting_{year}.zip"
    zip_path.write_bytes(buf.getvalue())

    return FileResponse(
        zip_path,
        filename=f"Muster Consulting Accounting {year}.zip",
        media_type="application/zip",
    )


@router.post("/accounting")
async def create_accounting_doc(
    doc_date: str = Form(...),
    vendor: str = Form(...),
    description: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    category: str = Form(...),
    due_date: str = Form(""),
    status: str = Form("unpaid"),
    recurrence: str = Form("none"),
    paid_via: str = Form("company"),
    doc_url: str = Form(""),
    fx_rate: float | None = Form(None),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    if paid_via not in ("company", "personal"):
        raise HTTPException(400, "paid_via must be 'company' or 'personal'")
    doc_link = _clean_doc_url(doc_url)
    chf, orig_amt, orig_cur, rate = _book_amount(amount, currency, fx_rate)
    doc_filename = await save_upload(doc, ACCT_DIR, "acct")

    with get_db() as db:
        cur = db.execute(
            """INSERT INTO company_docs
               (doc_date, vendor, description, amount, currency, category, due_date, status, recurrence,
                paid_via, doc_url, doc_file, original_amount, original_currency, fx_rate)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_date, vendor, description, chf, "CHF", category,
             due_date or None, status, recurrence or "none", paid_via, doc_link, doc_filename,
             orig_amt, orig_cur, rate),
        )
    return {"id": cur.lastrowid, "amount_chf": chf}


@router.get("/accounting/bank-check")
async def accounting_bank_check(amount: float, doc_date: str, paid_via: str = "personal"):
    """Pre-save sanity check for the bill form. Looks for a GmbH bank debit of
    the same amount around the bill date.
      paid_via=personal + match found  → probably NOT paid privately (warn)
      paid_via=company  + no match     → no debit seen yet (info only)"""
    hits = await _bank_matches(amount, doc_date)
    warning = None
    if paid_via == "personal" and hits:
        h = hits[0]
        warning = (f"A GmbH bank debit of CHF {abs(h['amount']):.2f} to "
                   f"'{h['counterparty'][:40]}' on {h['date']} matches this bill — "
                   "it looks paid from the company account, not privately.")
    elif paid_via == "company" and not hits:
        warning = None   # statement may simply not cover the period yet
    return {"matches": hits, "warning": warning}


# These literal paths MUST be declared before /accounting/{id}, otherwise
# {id} swallows them and int-parsing fails with a 422.
@router.get("/accounting/personal-card/outstanding")
async def personal_card_outstanding():
    """Personal-card bills the GmbH hasn't reimbursed to the owner yet."""
    with get_db() as db:
        rows = db.execute(
            """SELECT id, doc_date, vendor, description, amount, currency, category
               FROM company_docs WHERE paid_via='personal' AND reimbursed_at IS NULL
               ORDER BY doc_date""",
        ).fetchall()
        reports = db.execute(
            """SELECT id, report_number, year, month, total, expense_count, created_at
               FROM expense_reports WHERE reimbursed_at IS NULL ORDER BY report_number""",
        ).fetchall()
    bills = [dict(r) for r in rows]
    MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    reps = [{
        "id": r["id"], "report_number": r["report_number"],
        "period": f"{MONTHS[r['month']-1]} {r['year']}" if r["month"] else str(r["year"]),
        "amount": round(float(r["total"] or 0), 2), "expense_count": r["expense_count"],
        "created_at": (r["created_at"] or "")[:10],
    } for r in reports]
    return {"bills": bills, "reports": reps,
            "total": round(sum(b["amount"] for b in bills) + sum(r["amount"] for r in reps), 2)}


@router.post("/accounting/personal-card/reimburse")
async def reimburse_personal_card(request: Request):
    """Settle personal-card bills: create one GmbH → Personal transfer for the
    selected bills and stamp them reimbursed. The transfer description is
    tagged so the Kontokorrent doesn't double-count it as new debt."""
    body = await request.json()
    bill_ids = body.get("bill_ids") or []
    report_ids = body.get("report_ids") or []
    transfer_date = body.get("transfer_date") or date.today().isoformat()
    if not (bill_ids or report_ids):
        raise HTTPException(400, "Select at least one bill or expense report")
    if not all(isinstance(b, int) for b in bill_ids) or not all(isinstance(r, int) for r in report_ids):
        raise HTTPException(400, "bill_ids / report_ids must be lists of ids")
    with get_db() as db:
        placeholders = ",".join("?" * len(bill_ids)) or "NULL"
        rows = db.execute(
            f"""SELECT id, vendor, amount, currency, reimbursed_at, paid_via
                FROM company_docs WHERE id IN ({placeholders})""",
            bill_ids,
        ).fetchall() if bill_ids else []
        if len(rows) != len(set(bill_ids)):
            raise HTTPException(404, "One or more bills not found")
        rep_ph = ",".join("?" * len(report_ids)) or "NULL"
        reps = db.execute(
            f"SELECT id, report_number, total, reimbursed_at FROM expense_reports WHERE id IN ({rep_ph})",
            report_ids,
        ).fetchall() if report_ids else []
        if len(reps) != len(set(report_ids)):
            raise HTTPException(404, "One or more expense reports not found")
        done = [r["report_number"] for r in reps if r["reimbursed_at"]]
        if done:
            raise HTTPException(400, f"Expense report(s) #{done} already reimbursed")
        bad = [r["id"] for r in rows if r["paid_via"] != "personal" or r["reimbursed_at"]]
        if bad:
            raise HTTPException(400,
                f"Bills {bad} are not outstanding personal-card bills "
                "(wrong payment method or already reimbursed)")
        non_chf = [r["id"] for r in rows if (r["currency"] or "CHF") != "CHF"]
        if non_chf:
            raise HTTPException(400, f"Bills {non_chf} are not in CHF — reimburse those individually")
        total = round(sum(r["amount"] for r in rows) + sum(float(r["total"] or 0) for r in reps), 2)
        parts = []
        if rows:
            vendors = ", ".join(sorted({r["vendor"] for r in rows})[:4])
            parts.append(f"{len(rows)} bill(s): {vendors}")
        if reps:
            parts.append("expense report(s) " + ", ".join(f"#{r['report_number']}" for r in reps))
        # Keep the 'Personal-card reimbursement' prefix: money.py and the bank
        # classifier key off it to avoid double-counting the settlement.
        cur = db.execute(
            """INSERT INTO account_transfers (transfer_date, direction, amount, currency, description)
               VALUES (?,?,?,?,?)""",
            (transfer_date, "gmbh_to_personal", total, "CHF",
             "Personal-card reimbursement — " + " + ".join(parts)),
        )
        transfer_id = cur.lastrowid
        if bill_ids:
            db.execute(
                f"UPDATE company_docs SET reimbursed_at=? WHERE id IN ({placeholders})",
                (transfer_date, *bill_ids),
            )
        if report_ids:
            db.execute(
                f"UPDATE expense_reports SET reimbursed_at=? WHERE id IN ({rep_ph})",
                (transfer_date, *report_ids),
            )
    return {"transfer_id": transfer_id, "total": total,
            "bills_settled": len(rows), "reports_settled": len(reps)}


@router.get("/accounting/vendors")
async def list_vendors():
    with get_db() as db:
        rows = db.execute("""
            SELECT vendor, category, amount, COUNT(*) as cnt, MAX(doc_date) as last_date
            FROM company_docs
            GROUP BY vendor
            ORDER BY cnt DESC, last_date DESC
        """).fetchall()
    return [{
        "vendor": r["vendor"], "category": r["category"],
        "last_amount": r["amount"], "count": r["cnt"], "last_date": r["last_date"],
    } for r in rows]


@router.get("/accounting/check-duplicate")
async def check_duplicate(vendor: str, amount: float, month: str):
    with get_db() as db:
        rows = db.execute(
            """SELECT id, doc_date, vendor, amount, description FROM company_docs
               WHERE LOWER(vendor)=? AND substr(doc_date,1,7)=?
               AND ABS(amount - ?) < 0.01""",
            (vendor.lower(), month, amount),
        ).fetchall()
    return {
        "duplicates": [
            {"id": r["id"], "doc_date": r["doc_date"], "vendor": r["vendor"],
             "amount": r["amount"], "description": r["description"]}
            for r in rows
        ],
    }


@router.get("/accounting/{id}")
async def get_accounting_doc(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM company_docs WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Document not found")
    return {
        "id": row["id"],
        "doc_date": row["doc_date"],
        "vendor": row["vendor"],
        "description": row["description"],
        "amount": row["amount"],
        "currency": row["currency"],
        "category": row["category"],
        "due_date": row["due_date"],
        "status": row["status"],
        "recurrence": row["recurrence"] if "recurrence" in row.keys() else "none",
        "paid_via": row["paid_via"] if "paid_via" in row.keys() else "company",
        "doc_url": row["doc_url"] if "doc_url" in row.keys() else None,
        "original_amount": row["original_amount"] if "original_amount" in row.keys() else None,
        "original_currency": row["original_currency"] if "original_currency" in row.keys() else None,
        "fx_rate": row["fx_rate"] if "fx_rate" in row.keys() else None,
        "doc_file": row["doc_file"],
        "has_file": row["doc_file"] is not None,
    }


@router.put("/accounting/{id}")
async def update_accounting_doc(
    id: int,
    doc_date: str = Form(...),
    vendor: str = Form(...),
    description: str = Form(...),
    amount: float = Form(...),
    currency: str = Form("CHF"),
    category: str = Form(...),
    due_date: str = Form(""),
    status: str = Form("unpaid"),
    recurrence: str = Form("none"),
    paid_via: str = Form("company"),
    doc_url: str = Form(""),
    fx_rate: float | None = Form(None),
    doc: UploadFile = File(None),
):
    ACCT_DIR = _paths["ACCT_DIR"]
    if paid_via not in ("company", "personal"):
        raise HTTPException(400, "paid_via must be 'company' or 'personal'")
    doc_link = _clean_doc_url(doc_url)
    chf, orig_amt, orig_cur, rate = _book_amount(amount, currency, fx_rate)
    with get_db() as db:
        row = db.execute("SELECT * FROM company_docs WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")

        doc_filename = row["doc_file"]
        if doc and doc.filename:
            delete_stored_file(ACCT_DIR, doc_filename)
            doc_filename = await save_upload(doc, ACCT_DIR, "acct")

        db.execute(
            """UPDATE company_docs SET doc_date=?, vendor=?, description=?,
               amount=?, currency=?, category=?, due_date=?, status=?, recurrence=?, paid_via=?, doc_url=?, doc_file=?,
               original_amount=?, original_currency=?, fx_rate=? WHERE id=?""",
            (doc_date, vendor, description, chf, "CHF", category,
             due_date or None, status, recurrence or "none", paid_via, doc_link, doc_filename,
             orig_amt, orig_cur, rate, id),
        )
    return {"message": "Document updated"}


@router.delete("/accounting/{id}")
async def delete_accounting_doc(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM company_docs WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        delete_stored_file(ACCT_DIR, row["doc_file"])
        # If this is a recurring parent, promote the oldest child to be the new
        # parent so the recurring chain isn't broken.
        oldest_child = db.execute(
            "SELECT id FROM company_docs WHERE parent_doc_id=? "
            "ORDER BY doc_date LIMIT 1",
            (id,),
        ).fetchone()
        if oldest_child:
            new_parent = oldest_child["id"]
            db.execute(
                "UPDATE company_docs SET parent_doc_id=? WHERE parent_doc_id=? AND id != ?",
                (new_parent, id, new_parent),
            )
            db.execute("UPDATE company_docs SET parent_doc_id=NULL WHERE id=?", (new_parent,))
        db.execute("DELETE FROM company_docs WHERE id=?", (id,))
    return {"message": "Document deleted"}


@router.get("/accounting/{id}/file")
async def get_accounting_file(id: int):
    ACCT_DIR = _paths["ACCT_DIR"]
    with get_db() as db:
        row = db.execute("SELECT doc_file FROM company_docs WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return serve_stored_file(ACCT_DIR, row["doc_file"])
