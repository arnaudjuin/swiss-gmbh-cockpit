"""Projected cash-flow timeline.

Reads invoices (revenue, with realistic payment lag), recurring bills, AXA
annual premium, payroll outflows, and VAT due dates, and projects the GmbH
bank balance day-by-day across a configurable horizon.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Query

from db import get_db

router = APIRouter()

DEFAULT_PAYMENT_LAG_DAYS = 30  # typical days from invoice issue to cash receipt
PAYROLL_DAY = 25               # day of month salary cash hits


def _parse_iso(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _vat_due_dates(events: list, year: int):
    """Append VAT payment events for each quarter of `year`."""
    # Q1 due 31.05, Q2 31.08, Q3 30.11, Q4 28.02 of following year
    deadlines = [
        (date(year, 5, 31),  1),
        (date(year, 8, 31),  2),
        (date(year, 11, 30), 3),
        (date(year + 1, 2, 28), 4),
    ]
    with get_db() as db:
        for due, q in deadlines:
            m_start = (q - 1) * 3 + 1
            m_end = m_start + 2
            row = db.execute(
                "SELECT COALESCE(SUM(tax),0) AS vat "
                "FROM invoices WHERE year=? AND month BETWEEN ? AND ?",
                (year, m_start, m_end),
            ).fetchone()
            vat = float(row["vat"] or 0)
            if vat > 0:
                events.append({
                    "date": due.isoformat(),
                    "amount": -round(vat, 2),
                    "kind": "vat",
                    "label": f"VAT Q{q} {year} → ESTV",
                })


@router.get("/cashflow")
async def cashflow(
    horizon_days: int = Query(180, ge=30, le=730),
    opening_balance: float = Query(0.0),
    payment_lag_days: int = Query(DEFAULT_PAYMENT_LAG_DAYS, ge=0, le=120),
):
    """Build a timeline of cash events from today−30 days → today+horizon_days."""
    today = date.today()
    start = today - timedelta(days=30)
    end = today + timedelta(days=horizon_days)

    events = []  # each: {date, amount, kind, label}

    # ── Revenue: each invoice flips to cash on max(issued_date, due_date) + lag
    with get_db() as db:
        invs = db.execute(
            "SELECT invoice_number, issued_date, due_date, paid_date, paid_status, "
            "total, notes FROM invoices ORDER BY issued_date"
        ).fetchall()

    for inv in invs:
        is_reimbursement = inv["notes"] and "Travel expense" in (inv["notes"] or "")
        if is_reimbursement:
            continue  # expense reports are reimbursements, not new cash inflow
        paid_dt = _parse_iso(inv["paid_date"])
        if paid_dt:
            cash_dt = paid_dt
        else:
            issued = _parse_iso(inv["issued_date"]) or today
            due = _parse_iso(inv["due_date"]) or (issued + timedelta(days=30))
            # Cash arrives roughly `payment_lag_days` after issuance (override default
            # for a single invoice using `paid_date` if known)
            cash_dt = issued + timedelta(days=payment_lag_days)
            # Don't model cash arriving before invoice issuance
            cash_dt = max(cash_dt, issued)
        if start <= cash_dt <= end:
            events.append({
                "date": cash_dt.isoformat(),
                "amount": +round(float(inv["total"] or 0), 2),
                "kind": "invoice",
                "label": f"Invoice #{inv['invoice_number']:04d} paid (CHF {float(inv['total']):,.2f})",
            })

    # ── Payroll: net salary out on PAYROLL_DAY of every month between start and end,
    # from employment_start onward
    with get_db() as db:
        ps = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
    if ps and ps["gross_monthly"]:
        # Compute live net via the formula in routes_payroll._compute_payslip
        from routes.payroll import _compute_payslip
        calc = _compute_payslip(dict(ps))
        net = calc["net_salary"]
        empl_total = calc["total_employer_cost"]
        emp_start = _parse_iso(ps["employment_start"]) or start
        # Iterate months
        cur = date(start.year, start.month, 1)
        while cur <= end:
            pay_dt = date(cur.year, cur.month, min(PAYROLL_DAY, 28))
            if emp_start <= pay_dt <= end and pay_dt >= start:
                events.append({
                    "date": pay_dt.isoformat(),
                    "amount": -round(net, 2),
                    "kind": "salary_net",
                    "label": f"Net salary → you (CHF {net:,.2f})",
                })
                # Employer-side cash (AHV/ALV/BVG/FAK/etc.) approximated as paid the same day
                other = round(empl_total - net, 2)
                if other > 0:
                    events.append({
                        "date": pay_dt.isoformat(),
                        "amount": -other,
                        "kind": "salary_emp",
                        "label": f"Employer charges & deductions (CHF {other:,.2f})",
                    })
            # advance one month
            cur = date(cur.year + (1 if cur.month == 12 else 0),
                       (cur.month % 12) + 1, 1)

    # ── Recurring + annual bills from company_docs
    with get_db() as db:
        bills = db.execute(
            "SELECT vendor, amount, currency, doc_date, due_date, status, recurrence, category "
            "FROM company_docs WHERE is_active IS NULL OR is_active=1"
        ).fetchall() if _has_is_active() else db.execute(
            "SELECT vendor, amount, currency, doc_date, due_date, status, recurrence, category "
            "FROM company_docs"
        ).fetchall()
    for b in bills:
        if (b["currency"] or "CHF") != "CHF":
            continue  # FX bills skipped from this simple projection
        amt = float(b["amount"] or 0)
        if amt <= 0:
            continue
        rec = (b["recurrence"] or "none").lower()
        # Skip Payroll Settlement here — it's the AXA accrual that's already
        # captured in employer charges above. Counting it again would double.
        if (b["category"] or "").lower().startswith("payroll"):
            continue
        first = _parse_iso(b["due_date"]) or _parse_iso(b["doc_date"]) or today
        if rec == "monthly":
            d = first
            while d <= end:
                if start <= d <= end:
                    events.append({
                        "date": d.isoformat(),
                        "amount": -round(amt, 2),
                        "kind": "bill",
                        "label": f"{b['vendor']} (monthly)",
                    })
                d = date(d.year + (1 if d.month == 12 else 0),
                         (d.month % 12) + 1, min(d.day, 28))
        elif rec == "yearly":
            d = first
            while d <= end:
                if start <= d <= end:
                    events.append({
                        "date": d.isoformat(),
                        "amount": -round(amt, 2),
                        "kind": "bill",
                        "label": f"{b['vendor']} (annual)",
                    })
                d = date(d.year + 1, d.month, min(d.day, 28))
        else:
            if start <= first <= end:
                events.append({
                    "date": first.isoformat(),
                    "amount": -round(amt, 2),
                    "kind": "bill",
                    "label": b["vendor"],
                })

    # ── VAT obligations (current + next year, in case horizon crosses)
    _vat_due_dates(events, today.year)
    if end.year > today.year:
        _vat_due_dates(events, today.year + 1)

    # Filter again to window, sort, then build running balance
    events = [e for e in events if start.isoformat() <= e["date"] <= end.isoformat()]
    events.sort(key=lambda e: (e["date"], -e["amount"]))

    running = opening_balance
    timeline = []
    for e in events:
        running += e["amount"]
        timeline.append({**e, "balance": round(running, 2)})

    # Daily series for chart (forward-fill balance between events)
    series = []
    cursor = start
    bal = opening_balance
    idx = 0
    while cursor <= end:
        # Apply any events on this day
        while idx < len(timeline) and timeline[idx]["date"] == cursor.isoformat():
            bal = timeline[idx]["balance"]
            idx += 1
        series.append({"date": cursor.isoformat(), "balance": round(bal, 2)})
        cursor += timedelta(days=1)

    # Headline metrics
    balances = [p["balance"] for p in series]
    lowest = min(balances)
    lowest_day = series[balances.index(lowest)]["date"]
    highest = max(balances)
    highest_day = series[balances.index(highest)]["date"]
    end_balance = balances[-1] if balances else opening_balance

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "today": today.isoformat(),
        "opening_balance": opening_balance,
        "payment_lag_days": payment_lag_days,
        "events": timeline,
        "series": series,
        "lowest": {"date": lowest_day, "balance": lowest},
        "highest": {"date": highest_day, "balance": highest},
        "end_balance": end_balance,
    }


def _has_is_active() -> bool:
    """Probe whether company_docs has an `is_active` column."""
    with get_db() as db:
        try:
            db.execute("SELECT is_active FROM company_docs LIMIT 1")
            return True
        except Exception:
            return False
