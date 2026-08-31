"""Calendar events feed: obligations, bills and payroll in one date range.

Distinguishes *real* entries (a document/payslip is uploaded) from *expected*
ones (DB rows without a document, plus read-only projections of recurring
templates and future salary paydays — nothing is written to the DB here).

Mounted at /api/* by app.py.
"""

from datetime import date

from fastapi import APIRouter, HTTPException

from db import get_db
from helpers import add_months
from routes.obligations import OBLIGATION_TYPES, PAYABLE_SQL, payable_date

router = APIRouter(tags=["calendar"])


def _parse(d: str, name: str) -> date:
    try:
        return date.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, f"Invalid {name} date: {d!r} (expected YYYY-MM-DD)")


@router.get("/calendar")
async def calendar_events(start: str, end: str):
    """All money events with a date inside [start, end], sorted by date."""
    start_d = _parse(start, "start")
    end_d = _parse(end, "end")
    if end_d < start_d:
        raise HTTPException(400, "end must be >= start")
    today = date.today()
    events = []

    with get_db() as db:
        # ── Obligations (real = document uploaded) ──────────────────────────
        for r in db.execute(
            f"SELECT * FROM obligations WHERE {PAYABLE_SQL} >= ? AND {PAYABLE_SQL} <= ?",
            (start, end),
        ).fetchall():
            type_label = OBLIGATION_TYPES.get(r["obligation_type"], r["obligation_type"])
            events.append({
                "date": payable_date(r),   # when the money leaves, not the accrual period
                "kind": "obligation",
                "title": f"{type_label} — {r['period_label']}",
                "amount": r["amount"],
                "currency": r["currency"],
                "status": r["status"],
                "real": r["doc_file"] is not None,
                "projected": False,
                "source_id": r["id"],
                "doc_url": f"/api/obligations/{r['id']}/file" if r["doc_file"] else None,
                "page": "obligations",
            })

        # ── Bills & documents (placed on due date, else document date) ──────
        for r in db.execute(
            """SELECT * FROM company_docs
               WHERE COALESCE(due_date, doc_date) >= ? AND COALESCE(due_date, doc_date) <= ?""",
            (start, end),
        ).fetchall():
            events.append({
                "date": r["due_date"] or r["doc_date"],
                "kind": "bill",
                "title": f"{r['vendor']} — {r['description']}",
                "amount": r["amount"],
                "currency": r["currency"],
                "status": r["status"],
                "real": r["doc_file"] is not None,
                "projected": False,
                "source_id": r["id"],
                "doc_url": f"/api/accounting/{r['id']}/file" if r["doc_file"] else None,
                "page": "accounting",
            })

        # ── Issued payslips (always real — PDF exists) ──────────────────────
        month_names = ["", "January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"]
        payslip_months = set()
        for r in db.execute(
            "SELECT * FROM payslips WHERE payment_date >= ? AND payment_date <= ?",
            (start, end),
        ).fetchall():
            payslip_months.add((r["year"], r["month"]))
            events.append({
                "date": r["payment_date"],
                "kind": "payroll",
                "title": f"Salary (net) — {month_names[r['month']]} {r['year']}",
                "amount": r["net_salary"],
                "currency": "CHF",
                "status": r["status"],
                "real": True,
                "projected": False,
                "source_id": r["id"],
                "doc_url": f"/api/payroll/payslip/{r['id']}/pdf" if r["pdf_file"] else None,
                "page": "payroll",
            })
        # All issued payslips (any date) still block projections below.
        for r in db.execute("SELECT year, month FROM payslips").fetchall():
            payslip_months.add((r["year"], r["month"]))

        # ── Expected salary paydays (no payslip issued yet) ─────────────────
        ps = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
        if ps:
            emp_start = date.fromisoformat(ps["employment_start"])
            last_net = db.execute(
                "SELECT net_salary FROM payslips ORDER BY year DESC, month DESC LIMIT 1"
            ).fetchone()
            expected_net = last_net["net_salary"] if last_net else ps["gross_monthly"]
            payday = min(int(ps["payment_day"] or 25), 28)
            cur = date(start_d.year, start_d.month, 1)
            while cur <= end_d:
                pay_date = date(cur.year, cur.month, payday)
                if (start_d <= pay_date <= end_d
                        and pay_date >= emp_start
                        and (cur.year, cur.month) not in payslip_months):
                    events.append({
                        "date": str(pay_date),
                        "kind": "payroll",
                        "title": f"Salary expected (~net) — {month_names[cur.month]} {cur.year}",
                        "amount": expected_net,
                        "currency": ps["currency"] or "CHF",
                        "status": "expected",
                        "real": False,
                        "projected": True,
                        "source_id": None,
                        "doc_url": None,
                        "page": "payroll",
                    })
                cur = add_months(cur, 1)

        # ── Projected recurring obligations (read-only, not in DB yet) ──────
        for t in db.execute(
            """SELECT * FROM obligations WHERE recurrence IN ('monthly','quarterly','yearly')
               AND (parent_obligation_id IS NULL OR parent_obligation_id = 0)
               AND due_date IS NOT NULL"""
        ).fetchall():
            latest = db.execute(
                "SELECT due_date FROM obligations WHERE id=? OR parent_obligation_id=? "
                "ORDER BY due_date DESC LIMIT 1",
                (t["id"], t["id"]),
            ).fetchone()
            step = {"monthly": 1, "quarterly": 3, "yearly": 12}[t["recurrence"]]
            type_label = OBLIGATION_TYPES.get(t["obligation_type"], t["obligation_type"])
            cur = date.fromisoformat(latest["due_date"])
            for _ in range(36):
                cur = add_months(cur, step)
                if cur > end_d:
                    break
                if cur < start_d:
                    continue
                events.append({
                    "date": str(cur),
                    "kind": "obligation",
                    "title": f"{type_label} (projected)",
                    "amount": t["amount"],
                    "currency": t["currency"],
                    "status": "expected",
                    "real": False,
                    "projected": True,
                    "source_id": t["id"],
                    "doc_url": None,
                    "page": "obligations",
                })

        # ── Projected recurring bills ───────────────────────────────────────
        for t in db.execute(
            """SELECT * FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly')
               AND (parent_doc_id IS NULL OR parent_doc_id = 0)"""
        ).fetchall():
            latest = db.execute(
                """SELECT COALESCE(due_date, doc_date) AS d FROM company_docs
                   WHERE id=? OR parent_doc_id=? ORDER BY d DESC LIMIT 1""",
                (t["id"], t["id"]),
            ).fetchone()
            step = {"monthly": 1, "quarterly": 3, "yearly": 12}[t["recurrence"]]
            cur = date.fromisoformat(latest["d"])
            for _ in range(36):
                cur = add_months(cur, step)
                if cur > end_d:
                    break
                if cur < start_d:
                    continue
                events.append({
                    "date": str(cur),
                    "kind": "bill",
                    "title": f"{t['vendor']} — {t['description']} (projected)",
                    "amount": t["amount"],
                    "currency": t["currency"],
                    "status": "expected",
                    "real": False,
                    "projected": True,
                    "source_id": t["id"],
                    "doc_url": None,
                    "page": "accounting",
                })

    events.sort(key=lambda e: (e["date"], e["kind"], e["title"]))
    overdue = [e for e in events
               if e["status"] == "unpaid" and e["date"] < str(today)]
    return {
        "start": start, "end": end,
        "events": events,
        "totals": {
            "count": len(events),
            "real": sum(1 for e in events if e["real"]),
            "expected": sum(1 for e in events if not e["real"]),
            "amount_due": round(sum(e["amount"] for e in events
                                    if e["status"] in ("unpaid", "expected")), 2),
            "overdue_count": len(overdue),
        },
    }
