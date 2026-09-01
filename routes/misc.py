"""Miscellaneous: recurring bill/obligation generation, status patches, QR-bill,
vendor suggest, duplicate check, bulk upload, backup.

Mounted at /api/* by app.py.
"""

from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from db import get_db
from helpers import add_months

router = APIRouter(tags=["misc"])

_paths = {}


def configure(acct_dir: Path, db_path: Path, docs_dir: Path, base_dir: Path):
    _paths["ACCT_DIR"] = acct_dir
    _paths["DB_PATH"] = db_path
    _paths["DOCS_DIR"] = docs_dir
    _paths["BASE_DIR"] = base_dir


# ─── Recurring Bills ────────────────────────────────────────────────────────

@router.post("/accounting/generate-recurring")
async def generate_recurring():
    """Generate next occurrences of recurring bills if they don't exist yet."""
    today = date.today()
    created = 0

    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM company_docs WHERE recurrence IN ('monthly','yearly','quarterly') AND (parent_doc_id IS NULL OR parent_doc_id = 0) ORDER BY id",
        ).fetchall()

        for template in rows:
            descendants = db.execute(
                "SELECT * FROM company_docs WHERE id=? OR parent_doc_id=? ORDER BY doc_date DESC LIMIT 1",
                (template["id"], template["id"]),
            ).fetchone()

            last_date = date.fromisoformat(descendants["doc_date"])
            due_last = date.fromisoformat(descendants["due_date"]) if descendants["due_date"] else None

            if template["recurrence"] == "monthly":
                delta_months = 1
            elif template["recurrence"] == "quarterly":
                delta_months = 3
            else:
                delta_months = 12

            cur_date = last_date
            cur_due = due_last
            for _ in range(36):
                next_date = add_months(cur_date, delta_months)
                next_due = add_months(cur_due, delta_months) if cur_due else None
                if next_date > add_months(today, 2):
                    break
                exists = db.execute(
                    "SELECT id FROM company_docs WHERE parent_doc_id=? AND doc_date=?",
                    (template["id"], str(next_date)),
                ).fetchone()
                if not exists:
                    db.execute(
                        """INSERT INTO company_docs
                           (doc_date, vendor, description, amount, currency, category,
                            due_date, status, recurrence, parent_doc_id)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (str(next_date), template["vendor"], template["description"],
                         template["amount"], template["currency"], template["category"],
                         str(next_due) if next_due else None, "unpaid", "none", template["id"]),
                    )
                    created += 1
                cur_date = next_date
                cur_due = next_due

    return {"created": created}


# ─── Status patches ─────────────────────────────────────────────────────────

@router.patch("/accounting/{id}/status")
async def update_doc_status(id: int, request: Request):
    body = await request.json()
    status = body.get("status")
    if status not in ("paid", "unpaid"):
        raise HTTPException(400, "Status must be 'paid' or 'unpaid'")
    with get_db() as db:
        row = db.execute("SELECT id FROM company_docs WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        db.execute("UPDATE company_docs SET status=? WHERE id=?", (status, id))
    return {"message": f"Status set to {status}"}


@router.patch("/invoices/{id}/status")
async def update_invoice_status(id: int, request: Request):
    body = await request.json()
    status = body.get("status")
    if status not in ("paid", "unpaid"):
        raise HTTPException(400, "Invalid status")
    paid_date = str(date.today()) if status == "paid" else None
    with get_db() as db:
        inv = db.execute(
            "SELECT id, invoice_number, year, month, hours, total FROM invoices WHERE id=?",
            (id,),
        ).fetchone()
        if not inv:
            raise HTTPException(404, "Invoice not found")

        db.execute(
            "UPDATE invoices SET paid_status=?, paid_date=? WHERE id=?",
            (status, paid_date, id),
        )

        # Auto-link: keep one income_entries row per paid billable invoice.
        # Skip reimbursement reports (hours=0) — those are pass-throughs, not income.
        if inv["hours"] > 0:
            if status == "paid":
                # Create the income row only if one doesn't exist already
                existing = db.execute(
                    "SELECT id FROM income_entries WHERE invoice_id=?", (id,),
                ).fetchone()
                if not existing:
                    db.execute(
                        "INSERT INTO income_entries (income_date, source, description, amount, currency, category, invoice_id) "
                        "VALUES (?, ?, ?, ?, 'CHF', 'Invoice Payment', ?)",
                        (paid_date,
                         f"Invoice #{inv['invoice_number']:04d}",
                         f"Auto-linked to invoice #{inv['invoice_number']:04d}",
                         inv["total"],
                         inv["id"]),
                    )
            else:  # unpaid
                db.execute("DELETE FROM income_entries WHERE invoice_id=?", (id,))

    return {"message": f"Status set to {status}"}


# ─── Swiss QR-bill scanner ────────────────────────────────────────────────────

@router.post("/qr-bill/scan")
async def scan_qr_bill(file: UploadFile = File(...)):
    """Decode a Swiss QR-bill from an image and return parsed fields."""
    try:
        from pyzbar.pyzbar import decode as qr_decode
        from PIL import Image
        import io as _io
    except ImportError:
        raise HTTPException(503,
            "QR scanning requires pyzbar. Install: brew install zbar && "
            ".venv/bin/pip install pyzbar")

    raw = await file.read()
    try:
        img = Image.open(_io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"Cannot read image: {e}")

    decoded = qr_decode(img)
    if not decoded:
        raise HTTPException(404, "No QR code found in image")

    qr_text = None
    for d in decoded:
        text = d.data.decode("utf-8", errors="ignore")
        if text.startswith("SPC"):
            qr_text = text
            break
    if qr_text is None:
        return {"raw": decoded[0].data.decode("utf-8", errors="ignore"), "is_swiss_qr_bill": False}

    lines = qr_text.split("\n")
    def line(i):
        return lines[i].strip() if i < len(lines) else ""

    return {
        "is_swiss_qr_bill": True,
        "version": line(1),
        "iban": line(3),
        "creditor": {
            "name": line(5),
            "address_line_1": line(6),
            "address_line_2": line(7),
            "postal_code": line(8),
            "city": line(9),
            "country": line(10),
        },
        "amount": float(line(18)) if line(18) else None,
        "currency": line(19),
        "debtor": {
            "name": line(21),
            "address_line_1": line(22),
            "address_line_2": line(23),
            "postal_code": line(24),
            "city": line(25),
            "country": line(26),
        },
        "reference_type": line(27),
        "reference": line(28),
        "additional_info": line(29),
    }


# ─── Vendor Auto-suggest & Duplicate Detection ───────────────────────────────
# NOTE: /accounting/vendors and /accounting/check-duplicate moved to
# routes/accounting.py. This router registers AFTER it, so a literal
# GET /accounting/<word> defined here was shadowed by /accounting/{id}
# there ("vendors" failed int-parsing → 422).


# ─── Bulk File Upload ───────────────────────────────────────────────────────

@router.post("/accounting/bulk-upload")
async def bulk_upload(files: list[UploadFile] = File(...)):
    """Upload multiple files at once. Each becomes a draft bill with minimal metadata."""
    ACCT_DIR = _paths["ACCT_DIR"]
    today = str(date.today())
    created = []
    for file in files:
        if not file.filename:
            continue
        ext = Path(file.filename).suffix.lower()
        doc_filename = f"acct_{uuid4().hex[:10]}{ext}"
        (ACCT_DIR / doc_filename).write_bytes(await file.read())
        stem = Path(file.filename).stem[:40]
        with get_db() as db:
            cur = db.execute(
                """INSERT INTO company_docs
                   (doc_date, vendor, description, amount, currency, category,
                    due_date, status, recurrence, doc_file)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (today, stem, f"Uploaded: {file.filename}", 0.0, "CHF", "Other",
                 None, "unpaid", "none", doc_filename),
            )
        created.append({"id": cur.lastrowid, "filename": file.filename})
    return {"count": len(created), "items": created}


# ─── Backup ──────────────────────────────────────────────────────────────────

@router.get("/backup")
async def backup_data():
    """Download a ZIP with the database and all documents. The backup file
    itself lands in documents/backups/ so the project root stays clean;
    backups/ is skipped when building the archive to avoid nesting."""
    import io
    import zipfile

    DB_PATH = _paths["DB_PATH"]
    DOCS_DIR = _paths["DOCS_DIR"]
    BASE_DIR = _paths["BASE_DIR"]

    backups_dir = DOCS_DIR / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if DB_PATH.exists():
            zf.write(DB_PATH, "invoices.db")
        for fp in DOCS_DIR.rglob("*"):
            if not fp.is_file():
                continue
            # Don't recurse the backups directory into new backups
            try:
                fp.relative_to(backups_dir)
                continue
            except ValueError:
                pass
            rel = fp.relative_to(BASE_DIR)
            zf.write(fp, str(rel))

    buf.seek(0)
    # Retention: keep the newest 3 backups — a 300 MB daily zip fills a disk
    # fast (it did). Sorted by name == sorted by date thanks to the ISO stamp.
    existing = sorted(backups_dir.glob("*_backup_*.zip"))
    for old_zip in existing[:-2]:   # newest 2 kept; today's makes 3
        try:
            old_zip.unlink()
        except OSError:
            pass
    backup_name = f"cockpit_backup_{date.today().isoformat()}.zip"
    bp = backups_dir / backup_name
    bp.write_bytes(buf.getvalue())
    return FileResponse(bp, filename=backup_name, media_type="application/zip")


# ─── Recurring Obligations ──────────────────────────────────────────────────

@router.post("/obligations/generate-recurring")
async def generate_recurring_obligations():
    """Auto-create next periods for recurring obligations."""
    today = date.today()
    created = 0

    with get_db() as db:
        templates = db.execute(
            """SELECT * FROM obligations WHERE recurrence IN ('monthly','quarterly','yearly')
               AND (parent_obligation_id IS NULL OR parent_obligation_id = 0)""",
        ).fetchall()

        for t in templates:
            if not t["due_date"]:
                continue
            latest = db.execute(
                "SELECT * FROM obligations WHERE id=? OR parent_obligation_id=? ORDER BY due_date DESC LIMIT 1",
                (t["id"], t["id"]),
            ).fetchone()

            last_due = date.fromisoformat(latest["due_date"])
            step = {"monthly": 1, "quarterly": 3, "yearly": 12}[t["recurrence"]]

            cur = last_due
            for _ in range(36):
                nxt = add_months(cur, step)
                if nxt > add_months(today, 6):
                    break
                exists = db.execute(
                    "SELECT id FROM obligations WHERE parent_obligation_id=? AND due_date=?",
                    (t["id"], str(nxt)),
                ).fetchone()
                if not exists:
                    if t["recurrence"] == "monthly":
                        period = nxt.strftime("%b %Y")
                    elif t["recurrence"] == "quarterly":
                        q = (nxt.month - 1) // 3 + 1
                        period = f"Q{q} {nxt.year}"
                    else:
                        period = f"FY {nxt.year}"
                    db.execute(
                        """INSERT INTO obligations
                           (obligation_type, period_label, period_year, amount, currency,
                            due_date, status, notes, recurrence, parent_obligation_id)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (t["obligation_type"], period, nxt.year, t["amount"], t["currency"],
                         str(nxt), "unpaid", t["notes"], "none", t["id"]),
                    )
                    created += 1
                cur = nxt

    return {"created": created}
