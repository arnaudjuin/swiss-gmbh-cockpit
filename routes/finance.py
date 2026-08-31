"""Finance: cash-balance, runway, reserve health, bank CSV match, anomalies.

Mounted at /api/* by app.py.
"""

import calendar
import statistics
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db import get_db
from routes.payroll import _row_to_settings, _compute_payslip
from routes.obligations import OBLIGATION_TYPES
from helpers import add_months

router = APIRouter(tags=["finance"])


class BankCsvRow(BaseModel):
    date: str
    description: str
    amount: float
    reference: str | None = None


class BankCsvMatch(BaseModel):
    rows: list[BankCsvRow]


# ─── Cash Balance & Runway ──────────────────────────────────────────────────

def _effective_cash(db):
    """Freshest known bank balance: the manual entry or the latest
    statement's closing balance, whichever is more recent."""
    row = db.execute("SELECT * FROM cash_balance WHERE id=1").fetchone()
    balance, as_of, source, notes = row["balance"], row["as_of"], "manual entry", row["notes"] or ""
    st = db.execute(
        "SELECT closing_balance, period_end FROM bank_statements "
        "WHERE closing_balance IS NOT NULL ORDER BY period_end DESC LIMIT 1"
    ).fetchone()
    if st and (not as_of or (st["period_end"] and st["period_end"] > as_of)):
        balance, as_of, source = st["closing_balance"], st["period_end"], "bank statement"
    return balance, as_of, source, notes, row["updated_at"]


@router.get("/cash-balance")
async def get_cash_balance():
    with get_db() as db:
        balance, as_of, source, notes, updated = _effective_cash(db)
    return {
        "balance": balance,
        "as_of": as_of,
        "source": source,
        "notes": notes,
        "updated_at": updated,
    }


@router.put("/cash-balance")
async def update_cash_balance(request: Request):
    body = await request.json()
    with get_db() as db:
        db.execute(
            """UPDATE cash_balance SET balance=?, as_of=?, notes=?, updated_at=datetime('now')
               WHERE id=1""",
            (
                float(body.get("balance", 0)),
                body.get("as_of", str(date.today())),
                body.get("notes", ""),
            ),
        )
    return {"message": "Cash balance updated"}


@router.get("/runway")
async def compute_runway():
    """Compute runway: how many months before cash runs out at current burn rate."""
    with get_db() as db:
        balance, as_of_str, _src, _n, _u = _effective_cash(db)
        as_of = date.fromisoformat(as_of_str)

        recurring = db.execute(
            """SELECT amount, recurrence FROM company_docs
               WHERE recurrence IN ('monthly','quarterly','yearly')
               AND (parent_doc_id IS NULL OR parent_doc_id = 0)"""
        ).fetchall()

        obligations_future = db.execute(
            """SELECT amount, due_date FROM obligations
               WHERE status='unpaid' AND due_date IS NOT NULL"""
        ).fetchall()

        six_months_ago = date.today() - timedelta(days=180)
        avg_invoice = db.execute(
            """SELECT COALESCE(AVG(total), 0) as avg FROM invoices
               WHERE hours > 0 AND year * 12 + month >= ?""",
            ((six_months_ago.year * 12 + six_months_ago.month),),
        ).fetchone()["avg"]

    monthly_recurring_cost = 0.0
    for r in recurring:
        if r["recurrence"] == "monthly":
            monthly_recurring_cost += r["amount"]
        elif r["recurrence"] == "quarterly":
            monthly_recurring_cost += r["amount"] / 3
        elif r["recurrence"] == "yearly":
            monthly_recurring_cost += r["amount"] / 12

    horizon = date.today() + timedelta(days=365)
    ob_total_12m = sum(
        o["amount"] for o in obligations_future
        if o["due_date"] <= str(horizon)
    )
    monthly_ob_cost = ob_total_12m / 12

    payroll_monthly_cost = 0.0
    with get_db() as db:
        psr = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
        if psr and psr["gross_monthly"] > 0:
            s = _row_to_settings(psr)
            calc = _compute_payslip(s)
            payroll_monthly_cost = calc["total_employer_cost"]

    monthly_income = avg_invoice
    monthly_burn = monthly_recurring_cost + monthly_ob_cost + payroll_monthly_cost - monthly_income
    monthly_burn = round(monthly_burn, 2)

    if monthly_burn <= 0:
        runway_months = None
        runway_desc = "Cash positive - no burn"
    else:
        runway_months = round(balance / monthly_burn, 1)
        runway_desc = f"{runway_months} months at current burn"

    return {
        "balance": balance,
        "as_of": str(as_of),
        "monthly_burn": monthly_burn,
        "monthly_recurring_cost": round(monthly_recurring_cost, 2),
        "monthly_obligations_cost": round(monthly_ob_cost, 2),
        "monthly_payroll_cost": round(payroll_monthly_cost, 2),
        "monthly_expected_income": round(monthly_income, 2),
        "runway_months": runway_months,
        "description": runway_desc,
    }


# ─── Reserve Health Forecast ────────────────────────────────────────────────

@router.get("/budget/health-forecast")
async def reserve_health():
    today = date.today()

    with get_db() as db:
        items = db.execute("SELECT * FROM budget_items ORDER BY grp, sort_order").fetchall()
        future_bills = db.execute(
            """SELECT * FROM company_docs
               WHERE status='unpaid' AND due_date IS NOT NULL AND due_date >= ?
               ORDER BY due_date""",
            (str(today),),
        ).fetchall()

    results = []
    for it in items:
        current_balance = it["balance"] or 0
        monthly_contribution = it["budgeted"] or 0
        sub_lower = it["subcategory"].lower()

        upcoming_expense = None
        for b in future_bills:
            vendor_lower = (b["vendor"] or "").lower()
            desc_lower = (b["description"] or "").lower()
            cat_lower = (b["category"] or "").lower()
            if (sub_lower in vendor_lower or vendor_lower in sub_lower
                or sub_lower in desc_lower or sub_lower in cat_lower):
                upcoming_expense = b
                break

        projected_12m = current_balance + monthly_contribution * 12

        status = "healthy"
        message = f"Reserve grows by {monthly_contribution:.0f}/mo"

        if upcoming_expense:
            due = date.fromisoformat(upcoming_expense["due_date"])
            months_until = max(0, (due.year - today.year) * 12 + (due.month - today.month))
            balance_at_due = current_balance + monthly_contribution * months_until
            needed = upcoming_expense["amount"]
            gap = balance_at_due - needed

            if gap >= 0:
                status = "healthy"
                message = f"Will cover {upcoming_expense['vendor']} ({needed:.0f}) due {upcoming_expense['due_date']}"
            else:
                status = "shortfall"
                message = f"SHORTFALL of {abs(gap):.0f} by {upcoming_expense['due_date']} vs {upcoming_expense['vendor']}"

        results.append({
            "id": it["id"],
            "subcategory": it["subcategory"],
            "grp": it["grp"],
            "current_balance": current_balance,
            "monthly_contribution": monthly_contribution,
            "projected_12m": round(projected_12m, 2),
            "status": status,
            "message": message,
            "next_expense": {
                "vendor": upcoming_expense["vendor"],
                "amount": upcoming_expense["amount"],
                "due_date": upcoming_expense["due_date"],
            } if upcoming_expense else None,
        })

    return {"items": results}


# ─── Bank CSV Import ────────────────────────────────────────────────────────

@router.post("/bank/csv-match")
async def match_bank_csv(data: BankCsvMatch):
    results = []
    with get_db() as db:
        for row in data.rows:
            amt = abs(row.amount)
            matches = []
            if row.amount < 0:
                for b in db.execute(
                    """SELECT id, vendor, description, amount, due_date, status FROM company_docs
                       WHERE status='unpaid' AND ABS(amount - ?) < 0.5""",
                    (amt,),
                ).fetchall():
                    matches.append({"type": "bill", "id": b["id"], "label": b["vendor"],
                                    "amount": b["amount"], "due": b["due_date"]})
                for o in db.execute(
                    """SELECT id, period_label, obligation_type, amount, due_date FROM obligations
                       WHERE status='unpaid' AND ABS(amount - ?) < 0.5""",
                    (amt,),
                ).fetchall():
                    matches.append({"type": "obligation", "id": o["id"],
                                    "label": f"{o['obligation_type']} {o['period_label']}",
                                    "amount": o["amount"], "due": o["due_date"]})
            else:
                for i in db.execute(
                    """SELECT id, invoice_number, total, year, month FROM invoices
                       WHERE paid_status='unpaid' AND hours > 0 AND ABS(total - ?) < 0.5""",
                    (amt,),
                ).fetchall():
                    matches.append({"type": "invoice", "id": i["id"],
                                    "label": f"Invoice #{i['invoice_number']:04d}",
                                    "amount": i["total"], "due": f"{i['year']}-{i['month']:02d}"})

            results.append({
                "csv_row": row.dict(),
                "matches": matches,
                "suggested": matches[0] if matches else None,
            })
    return {"rows": results, "count": len(results)}


@router.post("/bank/apply-match")
async def apply_bank_match(request: Request):
    body = await request.json()
    match_type = body.get("type")
    target_id = body.get("id")
    if match_type == "bill":
        with get_db() as db:
            db.execute("UPDATE company_docs SET status='paid' WHERE id=?", (target_id,))
        return {"message": "Bill marked paid"}
    elif match_type == "obligation":
        with get_db() as db:
            db.execute("UPDATE obligations SET status='paid' WHERE id=?", (target_id,))
        return {"message": "Obligation marked paid"}
    elif match_type == "invoice":
        with get_db() as db:
            db.execute(
                "UPDATE invoices SET paid_status='paid', paid_date=? WHERE id=?",
                (str(date.today()), target_id),
            )
        return {"message": "Invoice marked paid"}
    elif match_type == "income":
        row = body.get("csv_row", {})
        with get_db() as db:
            db.execute(
                """INSERT INTO income_entries
                   (income_date, source, description, amount, currency, category)
                   VALUES (?,?,?,?,?,?)""",
                (row.get("date"), row.get("description", "Bank"),
                 row.get("description", ""), abs(float(row.get("amount", 0))),
                 "CHF", "Bank Deposit"),
            )
        return {"message": "Income logged"}
    else:
        raise HTTPException(400, "Unknown match type")


# ─── Anomaly Detection ───────────────────────────────────────────────────────

@router.get("/anomalies")
async def detect_anomalies():
    """Detect bills that significantly deviate from their vendor's historical average."""
    with get_db() as db:
        vendors = db.execute("""
            SELECT vendor, COUNT(*) as cnt FROM company_docs
            GROUP BY vendor HAVING cnt >= 3
        """).fetchall()

    anomalies = []
    with get_db() as db:
        for v in vendors:
            history = db.execute(
                "SELECT id, doc_date, amount, status, description FROM company_docs WHERE vendor=? ORDER BY doc_date DESC",
                (v["vendor"],),
            ).fetchall()
            if history and "[anomaly-reviewed]" in (history[0]["description"] or ""):
                continue
            if len(history) < 3:
                continue
            amounts = [h["amount"] for h in history]
            most_recent = history[0]
            previous = amounts[1:]
            if not previous:
                continue

            mean = statistics.mean(previous)
            stdev = statistics.stdev(previous) if len(previous) > 1 else 0
            current = most_recent["amount"]
            diff = current - mean
            pct = (diff / mean * 100) if mean else 0

            if abs(pct) >= 20 and abs(diff) >= 10:
                severity = "high" if abs(pct) >= 50 else "medium"
                anomalies.append({
                    "bill_id": most_recent["id"],
                    "vendor": v["vendor"],
                    "current_amount": current,
                    "expected_mean": round(mean, 2),
                    "stdev": round(stdev, 2) if stdev else 0,
                    "deviation_chf": round(diff, 2),
                    "deviation_pct": round(pct, 1),
                    "doc_date": most_recent["doc_date"],
                    "history_count": len(previous),
                    "severity": severity,
                    "direction": "over" if diff > 0 else "under",
                    "message": (
                        f"{v['vendor']} usually CHF {mean:,.2f} "
                        f"(based on {len(previous)} bills) but this one is "
                        f"CHF {current:,.2f} ({pct:+.0f}%) on {most_recent['doc_date']}."
                    ),
                })

    anomalies.sort(key=lambda a: (-abs(a["deviation_chf"])))
    return {"count": len(anomalies), "items": anomalies}


@router.post("/anomalies/dismiss/{bill_id}")
async def dismiss_anomaly(bill_id: int):
    with get_db() as db:
        row = db.execute("SELECT description FROM company_docs WHERE id=?", (bill_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        new_desc = (row["description"] or "") + " [anomaly-reviewed]"
        db.execute("UPDATE company_docs SET description=? WHERE id=?", (new_desc, bill_id))
    return {"message": "Anomaly dismissed"}

# ─── Forecast — next N months of cash, kept deliberately simple ─────────────

@router.get("/finance/forecast")
async def finance_forecast(year: int | None = None, income: float | None = None, incomes: str | None = None):
    """Month-by-month cash forecast from the freshest bank balance.

    in  : expected income per month (override, else avg invoice total of the
          last 6 invoiced months — invoice TOTAL because VAT is remitted via
          the VAT obligations below, so this is the cash lens throughout)
          `incomes` overrides single months: "2026-09:12000,2026-10:23000".
    out : net salary + obligations payable THIS calendar year on their payable
          date (max(due, expected bill), expected amount when known) + unpaid
          and recurring bills + the Cash Allocation pots' monthly accruals.
          Obligations landing after 31 Dec are funded by those pots (that is
          what the pots are for), so they are not charged a second time.
    """
    # Per calendar year: rows run from this month (or January of a later
    # year) to December of `year`; cash is carried through the months in
    # between so a later year starts where the previous one ends.
    today = date.today()
    month_start = today.replace(day=1)
    year = max(today.year, min(today.year + 5, year or today.year))
    horizon_end = date(year + 1, 1, 1)
    months = (year - month_start.year) * 12 + (12 - month_start.month + 1)

    with get_db() as db:
        opening, as_of, source, _n, _u = _effective_cash(db)

        # expected income
        six_ago = add_months(month_start, -6)
        avg_row = db.execute(
            "SELECT COALESCE(AVG(t),0) as a, COUNT(*) as n FROM ("
            "SELECT SUM(total) as t FROM invoices WHERE hours>0 AND (year*12+month) >= ? GROUP BY year, month)",
            (six_ago.year * 12 + six_ago.month,)).fetchone()
        avg_income = round(avg_row["a"] or 0, 2)
        income_m = float(income) if income is not None else avg_income
        income_source = "override" if income is not None else f"avg of last {avg_row['n']} invoiced months"

        # payroll
        net_salary = 0.0; emp_start = None
        psr = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
        if psr and psr["gross_monthly"] > 0:
            calc = _compute_payslip(_row_to_settings(psr))
            net_salary = calc["net_salary"]
            emp_start = date.fromisoformat(psr["employment_start"]) if psr["employment_start"] else None
        # Cash Allocation pots: monthly accrual from accrual_start (to target_date)
        pots = [dict(r) for r in db.execute(
            "SELECT name, monthly_accrual, accrual_start, target_date FROM reserves "
            "WHERE is_active=1 AND monthly_accrual > 0").fetchall()]
        pots_fund_future = bool(pots)
        year_end = date(today.year, 12, 31)
        per_month_income = {}
        for tok in (incomes or "").split(","):
            if ":" in tok:
                k, v = tok.split(":", 1)
                try: per_month_income[k.strip()] = float(v)
                except ValueError: pass

        buckets = {}   # key -> {obligations, bills, items}
        def bucket(d):
            d = max(d, month_start)
            return f"{d.year}-{d.month:02d}"
        def add(d, kind, amount, label):
            key = bucket(d)
            if d >= horizon_end: return
            b = buckets.setdefault(key, {"obligations": 0.0, "bills": 0.0, "items": []})
            b[kind] += amount
            b["items"].append({"label": label, "amount": round(amount, 2), "date": str(d), "kind": kind})

        for o in db.execute("SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL").fetchall():
            due = date.fromisoformat(o["due_date"])
            exp = date.fromisoformat(o["expected_bill_date"]) if o["expected_bill_date"] else None
            payable = max(due, exp) if exp else due
            if pots_fund_future and payable > year_end:
                continue   # funded by the pots' accruals below
            amt = o["expected_bill_amount"] if o["expected_bill_amount"] else o["amount"]
            add(payable, "obligations", amt,
                f"{OBLIGATION_TYPES.get(o['obligation_type'], o['obligation_type'])} — {o['period_label']}")
        for b in db.execute("SELECT * FROM company_docs WHERE status='unpaid'").fetchall():
            add(date.fromisoformat(b["due_date"] or b["doc_date"]), "bills", b["amount"], b["vendor"])
        for t in db.execute(
            "SELECT * FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly') "
            "AND (parent_doc_id IS NULL OR parent_doc_id = 0)").fetchall():
            latest = db.execute(
                "SELECT COALESCE(due_date, doc_date) AS d FROM company_docs WHERE id=? OR parent_doc_id=? "
                "ORDER BY d DESC LIMIT 1", (t["id"], t["id"])).fetchone()["d"]
            step = {"monthly": 1, "quarterly": 3, "yearly": 12}[t["recurrence"]]
            cur = date.fromisoformat(latest)
            for _ in range(36):
                cur = add_months(cur, step)
                if cur >= horizon_end: break
                if cur < month_start: continue
                add(cur, "bills", t["amount"], f"{t['vendor']} (recurring)")

    rows = []; cash = opening; lowest = None; year_open = opening
    for i in range(months):
        m = add_months(month_start, i)
        key = f"{m.year}-{m.month:02d}"
        b = buckets.get(key, {"obligations": 0.0, "bills": 0.0, "items": []})
        pay = net_salary if (emp_start is None or m >= emp_start.replace(day=1)) else 0.0
        res = 0.0; res_items = []
        for pot in pots:
            start = date.fromisoformat(pot["accrual_start"]) if pot["accrual_start"] else month_start
            end = date.fromisoformat(pot["target_date"]) if pot["target_date"] else None
            if m >= start.replace(day=1) and (end is None or m <= end.replace(day=1)):
                res += pot["monthly_accrual"]
                res_items.append({"label": f"{pot['name']} (pot)", "amount": round(pot["monthly_accrual"], 2), "date": key, "kind": "reserves"})
        inc = per_month_income.get(key, income_m)
        out = round(pay + b["obligations"] + b["bills"] + res, 2)
        net = round(inc - out, 2)
        cash = round(cash + net, 2)
        row = {"key": key, "label": f"{calendar.month_abbr[m.month]} {m.year}", "income": round(inc, 2),
               "income_override": key in per_month_income,
               "payroll_net": round(pay, 2), "obligations": round(b["obligations"], 2),
               "bills": round(b["bills"], 2), "reserves": round(res, 2),
               "out": out, "net": net, "cash_end": cash, "items": b["items"] + res_items}
        if m.year != year:
            year_open = cash   # carried through, not shown
            continue
        rows.append(row)
        if lowest is None or cash < lowest["cash_end"]: lowest = row

    return {
        "opening": year_open, "bank_balance": opening, "as_of": as_of, "source": source,
        "income_monthly": round(income_m, 2), "income_source": income_source, "avg_income": avg_income,
        "payroll_net": round(net_salary, 2),
        "pots": [{"name": p_["name"], "monthly_accrual": p_["monthly_accrual"]} for p_ in pots],
        "pots_fund_after": str(year_end) if pots_fund_future else None,
        "months": rows,
        "lowest": {"label": lowest["label"], "cash_end": lowest["cash_end"]} if lowest else None,
        "end_cash": cash, "year": year, "horizon_months": len(rows),
        "carried_from": None if year == today.year else f"{calendar.month_abbr[today.month]} {today.year}",
    }
