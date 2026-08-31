"""Sharing endpoints: shared link CRUD, public read-only HTML pages,
iCal feed, file serving for shared docs.

Mounted at root by app.py (some routes are /api/shares, others /share/...).
"""

import calendar
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel

from db import get_db
from helpers import add_months

router = APIRouter(tags=["share"])

_paths = {}
_ctx = {}

def configure(acct_dir: Path, scan_dir: Path, report_dir: Path,
              obligation_types: dict, accountant_zip_fn):
    _paths["ACCT_DIR"] = acct_dir
    _paths["SCAN_DIR"] = scan_dir
    _paths["REPORT_DIR"] = report_dir
    _ctx["OBLIGATION_TYPES"] = obligation_types
    _ctx["accountant_zip_fn"] = accountant_zip_fn


class ShareCreate(BaseModel):
    section: str
    year: int
    label: str | None = None


# ─── iCal Feed (dynamic flux) ────────────────────────────────────────────────

def _ics_escape(text: str) -> str:
    """Escape text for iCal format."""
    if not text:
        return ""
    return (text.replace("\\", "\\\\")
                .replace("\n", "\\n")
                .replace(",", "\\,")
                .replace(";", "\\;"))


def _ics_event(uid: str, dt: str, summary: str, description: str = "",
               categories: str = "", alarm_days: int | None = 3) -> str:
    """Build a single VEVENT block for an all-day event."""
    parts = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{date.today().strftime('%Y%m%dT000000Z')}",
        f"DTSTART;VALUE=DATE:{dt}",
        f"SUMMARY:{_ics_escape(summary)}",
    ]
    if description:
        parts.append(f"DESCRIPTION:{_ics_escape(description)}")
    if categories:
        parts.append(f"CATEGORIES:{_ics_escape(categories)}")
    parts.append("STATUS:CONFIRMED")
    parts.append("TRANSP:TRANSPARENT")
    if alarm_days is not None and alarm_days > 0:
        parts.extend([
            "BEGIN:VALARM",
            f"TRIGGER:-P{alarm_days}D",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_escape(summary)}",
            "END:VALARM",
        ])
    parts.append("END:VEVENT")
    return "\r\n".join(parts)


@router.get("/share/{token}/calendar.ics")
async def ical_feed(token: str):
    """Public dynamic iCal feed. Subscribe from any calendar app — updates automatically.

    Includes:
      - Unpaid bills with due dates
      - Unpaid obligations (AHV, BVG, taxes) with due dates
      - Unpaid invoices with due dates
      - Monthly budget contribution reminders (1st of each month, next 12 months)
      - Quarterly VAT filing deadlines
    """
    with get_db() as db:
        link = db.execute("SELECT * FROM shared_links WHERE token=?", (token,)).fetchone()
    if not link:
        raise HTTPException(404, "Not found")

    events = []
    today = date.today()

    with get_db() as db:
        # Unpaid bills
        for r in db.execute(
            "SELECT * FROM company_docs WHERE due_date IS NOT NULL AND status='unpaid' ORDER BY due_date",
        ).fetchall():
            due = r["due_date"].replace("-", "")
            summary = f"💳 {r['vendor']} — {r['currency']} {r['amount']:,.2f}"
            desc = (r["description"] or "") + f"\nCategory: {r['category']}"
            events.append(_ics_event(
                uid=f"cockpit-bill-{r['id']}@cockpit",
                dt=due, summary=summary, description=desc,
                categories="Bills", alarm_days=3,
            ))

        # Unpaid obligations
        for r in db.execute(
            "SELECT * FROM obligations WHERE due_date IS NOT NULL AND status='unpaid' ORDER BY due_date",
        ).fetchall():
            due = r["due_date"].replace("-", "")
            type_label = _ctx['OBLIGATION_TYPES'].get(r["obligation_type"], r["obligation_type"])
            summary = f"🏛 {type_label} ({r['period_label']}) — CHF {r['amount']:,.2f}"
            desc = r["notes"] or ""
            events.append(_ics_event(
                uid=f"cockpit-ob-{r['id']}@cockpit",
                dt=due, summary=summary, description=desc,
                categories="Obligations", alarm_days=7,
            ))

        # Unpaid invoices
        for r in db.execute(
            "SELECT * FROM invoices WHERE due_date IS NOT NULL AND hours>0 AND paid_status='unpaid'",
        ).fetchall():
            due = r["due_date"].replace("-", "")
            summary = f"💰 Invoice #{r['invoice_number']:04d} — CHF {r['total']:,.2f}"
            desc = f"Period: {calendar.month_name[r['month']]} {r['year']}\nHours: {r['hours']}"
            events.append(_ics_event(
                uid=f"cockpit-inv-{r['id']}@cockpit",
                dt=due, summary=summary, description=desc,
                categories="Invoices", alarm_days=3,
            ))

        # Monthly budget contribution reminder (1st of each month, next 12 months)
        total_target = db.execute(
            "SELECT COALESCE(SUM(budgeted),0) as t FROM budget_items",
        ).fetchone()["t"]
        if total_target > 0:
            cur = today.replace(day=1)
            for _ in range(12):
                dt = cur.strftime("%Y%m%d")
                events.append(_ics_event(
                    uid=f"cockpit-contrib-{cur.strftime('%Y%m')}@cockpit",
                    dt=dt,
                    summary=f"📊 Contribute CHF {total_target:,.2f} to budget reserves",
                    description="Monthly budget contribution day. Open Muster Consulting → Budget Balances → Contribute All.",
                    categories="Budget", alarm_days=0,
                ))
                cur = add_months(cur, 1)

    # Quarterly VAT filing deadlines: Feb 28, May 31, Aug 31, Nov 30
    year = today.year
    vat_deadlines = [
        (date(year, 2, 28), f"Q4 {year-1}"),
        (date(year, 5, 31), f"Q1 {year}"),
        (date(year, 8, 31), f"Q2 {year}"),
        (date(year, 11, 30), f"Q3 {year}"),
        (date(year + 1, 2, 28), f"Q4 {year}"),
    ]
    for d, period in vat_deadlines:
        events.append(_ics_event(
            uid=f"cockpit-vat-{d.isoformat()}@cockpit",
            dt=d.strftime("%Y%m%d"),
            summary=f"📋 VAT filing deadline — {period}",
            description="Quarterly VAT filing due. Open Muster Consulting → Reports → VAT Tracker.",
            categories="VAT", alarm_days=14,
        ))

    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Muster Consulting GmbH//Finance//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Muster Consulting Finance",
        "X-WR-CALDESC:Dynamic feed: bills, obligations, invoices, budget & VAT reminders",
        "X-PUBLISHED-TTL:PT1H",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        *events,
        "END:VCALENDAR",
    ]) + "\r\n"

    from fastapi.responses import Response
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": "inline; filename=muster-consulting.ics",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )



@router.post("/api/shares")
async def create_share(data: ShareCreate):
    if data.section not in ("accounting", "expenses"):
        raise HTTPException(400, "Section must be 'accounting' or 'expenses'")
    token = secrets.token_urlsafe(16)
    with get_db() as db:
        db.execute(
            "INSERT INTO shared_links (token, section, year, label) VALUES (?,?,?,?)",
            (token, data.section, data.year, data.label or f"{data.section.title()} {data.year}"),
        )
    return {"token": token, "url": f"/share/{token}"}


@router.get("/api/shares")
async def list_shares():
    with get_db() as db:
        rows = db.execute("SELECT * FROM shared_links ORDER BY created_at DESC").fetchall()
    return [
        {
            "id": r["id"],
            "token": r["token"],
            "section": r["section"],
            "year": r["year"],
            "label": r["label"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.delete("/api/shares/{id}")
async def delete_share(id: int):
    with get_db() as db:
        db.execute("DELETE FROM shared_links WHERE id=?", (id,))
    return {"message": "Share link deleted"}


# ─── Public Shared Pages (no auth) ──────────────────────────────────────────

@router.get("/share/{token}", response_class=HTMLResponse)
async def shared_page(token: str):
    with get_db() as db:
        link = db.execute("SELECT * FROM shared_links WHERE token=?", (token,)).fetchone()
    if not link:
        return HTMLResponse("<h1>Link not found or expired</h1>", status_code=404)

    section = link["section"]
    year = link["year"]
    label = link["label"]

    if section == "accounting":
        with get_db() as db:
            rows = db.execute(
                "SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date",
                (str(year),),
            ).fetchall()
        total = sum(r["amount"] for r in rows)
        table_rows = ""
        for r in rows:
            has_file = r["doc_file"] is not None
            file_link = f'<a href="/share/{token}/file/accounting/{r["id"]}">View</a>' if has_file else '-'
            table_rows += f"""<tr>
                <td>{r["doc_date"]}</td>
                <td><strong>{r["vendor"]}</strong></td>
                <td>{r["description"]}</td>
                <td>{r["category"]}</td>
                <td style="text-align:right;font-family:monospace">{r["currency"]} {r["amount"]:,.2f}</td>
                <td>{file_link}</td>
            </tr>"""
    else:
        with get_db() as db:
            rows = db.execute(
                "SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date",
                (str(year),),
            ).fetchall()
        total = sum(r["amount"] for r in rows)
        table_rows = ""
        for r in rows:
            has_file = r["scan_file"] is not None
            file_link = f'<a href="/share/{token}/file/expenses/{r["id"]}">View</a>' if has_file else '-'
            table_rows += f"""<tr>
                <td>{r["expense_date"]}</td>
                <td>{r["description"]}</td>
                <td>{r["category"]}</td>
                <td style="text-align:right;font-family:monospace">CHF {r["amount"]:,.2f}</td>
                <td>{file_link}</td>
            </tr>"""

    date_col = "Date"
    if section == "accounting":
        headers = f"<th>{date_col}</th><th>Vendor</th><th>Description</th><th>Category</th><th style='text-align:right'>Amount</th><th>File</th>"
    else:
        headers = f"<th>{date_col}</th><th>Description</th><th>Category</th><th style='text-align:right'>Amount (CHF)</th><th>File</th>"

    zip_link = ""
    if section == "accounting":
        zip_link = f'<a href="/share/{token}/zip" style="display:inline-block;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">Download ZIP</a>'

    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{label} - Muster Consulting GmbH</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f1f5f9; color: #0f172a; }}
.container {{ max-width: 960px; margin: 0 auto; }}
h1 {{ font-size: 22px; margin-bottom: 4px; }}
.subtitle {{ color: #64748b; font-size: 14px; margin-bottom: 20px; }}
.card {{ background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }}
td {{ padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }}
tr:last-child td {{ border-bottom: none; }}
tr:hover {{ background: #f8fafc; }}
a {{ color: #3b82f6; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.summary {{ display: flex; justify-content: space-between; align-items: center; padding: 16px; margin-bottom: 16px; }}
.total {{ font-size: 18px; font-weight: 700; }}
.readonly-banner {{ background: #fef3c7; color: #92400e; padding: 10px 16px; border-radius: 6px; font-size: 13px; text-align: center; margin-bottom: 16px; }}
@media (max-width: 768px) {{ .card {{ overflow-x: auto; }} table {{ min-width: 500px; }} }}
</style>
</head><body>
<div class="container">
<div class="readonly-banner">&#128274; Read-only view &middot; You can view and download files but not modify any data.</div>
<h1>{label}</h1>
<p class="subtitle">Muster Consulting GmbH &middot; {len(rows)} document{"s" if len(rows) != 1 else ""}</p>
<div class="summary">
<span class="total">Total: CHF {total:,.2f}</span>
{zip_link}
</div>
<div class="card">
<table><thead><tr>{headers}</tr></thead><tbody>{table_rows}</tbody></table>
</div>
<p style="margin-top:20px;color:#94a3b8;font-size:12px">Shared by Muster Consulting GmbH</p>
</div></body></html>"""
    return HTMLResponse(html)


@router.get("/share/{token}/file/{section}/{id}")
async def shared_file(token: str, section: str, id: int):
    with get_db() as db:
        link = db.execute("SELECT * FROM shared_links WHERE token=?", (token,)).fetchone()
    if not link or link["section"] != section:
        raise HTTPException(404, "Not found")

    if section == "accounting":
        with get_db() as db:
            row = db.execute("SELECT doc_file FROM company_docs WHERE id=?", (id,)).fetchone()
        if not row or not row["doc_file"]:
            raise HTTPException(404, "File not found")
        file_path = _paths["ACCT_DIR"] / row["doc_file"]
    else:
        with get_db() as db:
            row = db.execute("SELECT scan_file FROM expenses WHERE id=?", (id,)).fetchone()
        if not row or not row["scan_file"]:
            raise HTTPException(404, "File not found")
        file_path = _paths["SCAN_DIR"] / row["scan_file"]

    if not file_path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(file_path)


@router.get("/share/{token}/zip")
async def shared_zip(token: str):
    with get_db() as db:
        link = db.execute("SELECT * FROM shared_links WHERE token=?", (token,)).fetchone()
    if not link or link["section"] != "accounting":
        raise HTTPException(404, "Not found")
    return await _ctx['accountant_zip_fn'](link["year"])


