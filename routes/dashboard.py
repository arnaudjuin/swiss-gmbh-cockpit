"""Dashboards: legacy + overview + finance + upcoming-payments + extras.

Mounted at /api/* by app.py.
"""

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Query

from db import get_db
from routes.obligations import OBLIGATION_TYPES, PAYABLE_SQL, payable_date
from routes.money import kontokorrent_balance

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
async def dashboard():
    with get_db() as db:
        stats = db.execute("""
            SELECT COUNT(*) as count,
                   COALESCE(SUM(total), 0) as revenue,
                   COALESCE(SUM(hours), 0) as hours
            FROM invoices WHERE hours > 0
        """).fetchone()

        monthly = db.execute("""
            SELECT year, month, SUM(total) as revenue, SUM(hours) as hours
            FROM invoices WHERE hours > 0
            GROUP BY year, month ORDER BY year, month
        """).fetchall()

        distinct_months = len(monthly)
        avg_monthly_revenue = stats["revenue"] / distinct_months if distinct_months else 0
        avg_monthly_hours = stats["hours"] / distinct_months if distinct_months else 0

    return {
        "total_revenue": stats["revenue"],
        "invoice_count": stats["count"],
        "average_monthly_revenue": avg_monthly_revenue,
        "average_monthly_hours": avg_monthly_hours,
        "total_hours": stats["hours"],
        "monthly_data": [
            {
                "label": f"{calendar.month_abbr[r['month']]} {r['year']}",
                "revenue": r["revenue"],
                "hours": r["hours"],
            }
            for r in monthly
        ],
    }


def _resolve_range(range_key: str) -> tuple[date, date, str]:
    """Map a range key to (start_date, end_date, human_label).

    Defaults to YTD on unknown keys. End date is always today (or Dec 31 of
    last year for prev_year) so widgets reflect "as of now".
    """
    today = date.today()
    if range_key == "month":
        return today.replace(day=1), today, "This month"
    if range_key == "30d":
        return today - timedelta(days=30), today, "Last 30 days"
    if range_key == "12m":
        return today - timedelta(days=365), today, "Last 12 months"
    if range_key == "year":
        return date(today.year, 1, 1), date(today.year, 12, 31), f"Year {today.year}"
    if range_key == "prev_year":
        y = today.year - 1
        return date(y, 1, 1), date(y, 12, 31), f"Year {y}"
    if range_key == "all":
        return date(1970, 1, 1), today, "All time"
    # default
    return date(today.year, 1, 1), today, "Year to date"


def _months_in_range(start: date, end: date) -> tuple[int, int]:
    """Inclusive month-key bounds (year*12+month) for invoice WHERE clauses."""
    return (start.year * 12 + start.month, end.year * 12 + end.month)


@router.get("/dashboard/overview")
async def dashboard_overview(range_key: str = Query("ytd", alias="range")):
    """Full GmbH financial overview for customizable dashboard widgets.

    `range` controls every "_ytd" metric in the response:
      ytd (default), month, 30d, 12m, year, prev_year, all.
    """
    today = date.today()
    year = today.year
    range_start, range_end, range_label = _resolve_range(range_key)
    start_str, end_str = str(range_start), str(range_end)
    inv_min, inv_max = _months_in_range(range_start, range_end)
    years_in_range = list(range(range_start.year, range_end.year + 1))
    year_placeholders = ",".join("?" * len(years_in_range))

    with get_db() as db:
        inv_stats = db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, COALESCE(SUM(hours),0) as hrs FROM invoices WHERE hours > 0",
        ).fetchone()
        inv_stats_ytd = db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, COALESCE(SUM(hours),0) as hrs "
            "FROM invoices WHERE hours > 0 AND (year * 12 + month) BETWEEN ? AND ?",
            (inv_min, inv_max),
        ).fetchone()
        inv_paid_ytd = db.execute(
            "SELECT COALESCE(SUM(total),0) as t FROM invoices "
            "WHERE hours > 0 AND paid_status='paid' AND (year * 12 + month) BETWEEN ? AND ?",
            (inv_min, inv_max),
        ).fetchone()["t"]
        monthly_inv = db.execute(
            "SELECT year, month, SUM(total) as revenue, SUM(hours) as hours FROM invoices WHERE hours>0 GROUP BY year, month ORDER BY year, month",
        ).fetchall()

        extra_income = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM income_entries WHERE income_date BETWEEN ? AND ?",
            (start_str, end_str),
        ).fetchone()["t"]
        # Accrual revenue = invoice SUBTOTALS (net of VAT — the 8.1% belongs
        # to the ESTV) + income entries that are NOT invoice mirrors.
        inv_net_ytd = db.execute(
            "SELECT COALESCE(SUM(subtotal),0) as t FROM invoices "
            "WHERE hours > 0 AND (year * 12 + month) BETWEEN ? AND ?",
            (inv_min, inv_max),
        ).fetchone()["t"]
        other_income_ytd = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM income_entries "
            "WHERE invoice_id IS NULL AND income_date BETWEEN ? AND ?",
            (start_str, end_str),
        ).fetchone()["t"]

        # 'Payroll Settlement' bills are the CASH side of charges already in
        # the issued payslips (e.g. the annual AXA premium) — counting them
        # again would double the cost (same rule as Reports → P&L).
        bills_ytd = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM company_docs "
            "WHERE doc_date BETWEEN ? AND ? AND category NOT IN ('Payroll Settlement', 'Taxes / VAT')",
            (start_str, end_str),
        ).fetchone()["t"]
        bills_paid_ytd = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE doc_date BETWEEN ? AND ? AND status='paid'",
            (start_str, end_str),
        ).fetchone()["t"]
        obligations_ytd = db.execute(
            f"SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE period_year IN ({year_placeholders})",
            years_in_range,
        ).fetchone()["t"]
        # True cost side of payroll = issued payslips (employer cost). The
        # obligations above are the PAYMENT side of these same charges (plus
        # pass-through VAT and below-the-line taxes) — never added to costs
        # (see CONTRIBUTING.md bookkeeping invariants).
        payroll_ytd = db.execute(
            "SELECT COALESCE(SUM(total_employer_cost),0) as t FROM payslips "
            "WHERE payment_date BETWEEN ? AND ?",
            (start_str, end_str),
        ).fetchone()["t"]

        cost_by_cat = db.execute(
            "SELECT category, SUM(amount) as total FROM company_docs "
            "WHERE doc_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC",
            (start_str, end_str),
        ).fetchall()

        overdue_bills = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE status='unpaid' AND due_date<?",
            (str(today),),
        ).fetchone()["t"]
        overdue_obs = db.execute(
            f"SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE status='unpaid' AND {PAYABLE_SQL}<?",
            (str(today),),
        ).fetchone()["t"]

        in_30 = (today + timedelta(days=30)).isoformat()
        up_bills = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE status='unpaid' AND due_date>=? AND due_date<=?",
            (str(today), in_30),
        ).fetchone()["t"]
        up_obs = db.execute(
            f"SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE status='unpaid' AND {PAYABLE_SQL}>=? AND {PAYABLE_SQL}<=?",
            (str(today), in_30),
        ).fetchone()["t"]

        kk = kontokorrent_balance(db)

        # ── Monthly income vs costs (accrual, same lens as the headline cards)
        # for the calendar year the range ends in — feeds the P&L chart.
        pl_year = range_end.year
        pl_last_month = range_end.month if pl_year == today.year else 12
        inv_by_m = {r["month"]: r["t"] for r in db.execute(
            "SELECT month, SUM(subtotal) as t FROM invoices WHERE hours>0 AND year=? GROUP BY month", (pl_year,)).fetchall()}
        oth_by_m = {int(r["m"]): r["t"] for r in db.execute(
            "SELECT CAST(substr(income_date,6,2) AS INTEGER) as m, SUM(amount) as t FROM income_entries "
            "WHERE invoice_id IS NULL AND substr(income_date,1,4)=? GROUP BY m", (str(pl_year),)).fetchall()}
        bills_by_m = {int(r["m"]): r["t"] for r in db.execute(
            "SELECT CAST(substr(doc_date,6,2) AS INTEGER) as m, SUM(amount) as t FROM company_docs "
            "WHERE substr(doc_date,1,4)=? AND category NOT IN ('Payroll Settlement', 'Taxes / VAT') GROUP BY m",
            (str(pl_year),)).fetchall()}
        pay_by_m = {int(r["m"]): r["t"] for r in db.execute(
            "SELECT CAST(substr(payment_date,6,2) AS INTEGER) as m, SUM(total_employer_cost) as t FROM payslips "
            "WHERE substr(payment_date,1,4)=? GROUP BY m", (str(pl_year),)).fetchall()}

        # ── Per-page recap (the "panels" strip) ──────────────────────────
        recv = db.execute(
            "SELECT COUNT(*) as n, COALESCE(SUM(total),0) as t, "
            "SUM(CASE WHEN due_date IS NOT NULL AND due_date<? THEN 1 ELSE 0 END) as overdue_n "
            "FROM invoices WHERE hours>0 AND paid_status!='paid'", (str(today),)).fetchone()
        bills_open = db.execute(
            "SELECT COUNT(*) as n, COALESCE(SUM(amount),0) as t FROM company_docs WHERE status='unpaid'").fetchone()
        ob_year = db.execute(
            "SELECT COALESCE(SUM(amount),0) as total, "
            "COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) as paid, "
            "COUNT(*) as n, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid_n "
            "FROM obligations WHERE period_year=?", (year,)).fetchone()
        ob_next = db.execute(
            f"SELECT obligation_type, period_label, amount, expected_bill_amount, {PAYABLE_SQL} as due_date FROM obligations "
            f"WHERE status='unpaid' AND {PAYABLE_SQL}>=? ORDER BY {PAYABLE_SQL} LIMIT 1", (str(today),)).fetchone()
        ps_year = db.execute(
            "SELECT COUNT(*) as n, COALESCE(SUM(net_salary),0) as net, COALESCE(SUM(total_employer_cost),0) as cost, "
            "MAX(year*12+month) as last_key FROM payslips WHERE year=?", (year,)).fetchone()
        ps_last = db.execute(
            "SELECT year, month, net_salary FROM payslips ORDER BY year DESC, month DESC LIMIT 1").fetchone()
        vat_collected = db.execute(
            "SELECT COALESCE(SUM(tax),0) as t FROM invoices WHERE hours>0 AND year=?", (year,)).fetchone()["t"]
        vat_open = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE obligation_type='vat' AND status='unpaid'").fetchone()["t"]
        reserves_sum = db.execute(
            "SELECT COUNT(*) as n, COALESCE(SUM(target_amount),0) as target FROM reserves WHERE is_active=1").fetchone()
        stmt_latest = db.execute(
            "SELECT bank, period_end, closing_balance, currency FROM bank_statements ORDER BY period_end DESC LIMIT 1").fetchone()

        # Fetch a generous slice — frontend slices to user's preferred row count.
        recent_inv = db.execute(
            "SELECT * FROM invoices WHERE hours>0 ORDER BY year DESC, month DESC LIMIT 12",
        ).fetchall()
        recent_bills = db.execute(
            "SELECT * FROM company_docs ORDER BY doc_date DESC LIMIT 12",
        ).fetchall()

    months_count = len(monthly_inv)
    avg_monthly_rev = inv_stats["rev"] / months_count if months_count else 0
    avg_monthly_hours = inv_stats["hrs"] / months_count if months_count else 0

    # ONE lens per number (no cash-income-minus-accrual-costs chimeras):
    #   revenue/profit = ACCRUAL, matching Reports → P&L (invoice subtotals
    #   net of VAT + non-invoice income − bills − issued payroll);
    #   cash_received stays available as the separate cash lens.
    total_income_ytd = round(inv_net_ytd + other_income_ytd, 2)
    total_costs_ytd = bills_ytd + payroll_ytd
    profit_ytd = round(total_income_ytd - total_costs_ytd, 2)
    profit_margin = (profit_ytd / total_income_ytd * 100) if total_income_ytd else 0

    return {
        "year": year,
        "range": {"key": range_key, "label": range_label,
                  "start": start_str, "end": end_str},
        "income": {
            "invoices_ytd": inv_stats_ytd["rev"],         # billed incl. VAT (context)
            "invoiced_net_ytd": inv_net_ytd,              # billed net of VAT (accrual revenue)
            "other_ytd": other_income_ytd,                # non-invoice income (refunds, interest)
            "cash_received_ytd": extra_income,            # cash lens
            "invoices_paid_ytd": inv_paid_ytd,            # billed AND paid
            "extra_ytd": extra_income,                    # back-compat alias of cash_received
            "total_ytd": total_income_ytd,                # = extra_ytd, kept for back-compat
        },
        "costs": {
            "bills_ytd": bills_ytd,
            "bills_paid_ytd": bills_paid_ytd,
            "payroll_ytd": payroll_ytd,
            "obligations_ytd": obligations_ytd,   # cash-planning context only
            "total_ytd": total_costs_ytd,
            "by_category": [{"category": r["category"], "total": r["total"]} for r in cost_by_cat],
        },
        "profit": {
            "ytd": profit_ytd,
            "margin_pct": round(profit_margin, 1),
        },
        "invoices": {
            "count_total": inv_stats["cnt"],
            "count_ytd": inv_stats_ytd["cnt"],
            "total_hours": inv_stats["hrs"],
            "hours_ytd": inv_stats_ytd["hrs"],
            "avg_monthly_revenue": round(avg_monthly_rev, 2),
            "avg_monthly_hours": round(avg_monthly_hours, 1),
        },
        "upcoming": {
            "overdue_total": round(overdue_bills + overdue_obs, 2),
            "due_30d": round(up_bills + up_obs, 2),
        },
        "transfers": {
            "net_owed_to_personal": kk["net_owed_to_personal"],   # Kontokorrent lens (excl. wages/reimbursements)
        },
        "monthly_pl": [
            {
                "label": calendar.month_abbr[m], "year": pl_year, "month": m,
                "income": round(inv_by_m.get(m, 0) + oth_by_m.get(m, 0), 2),
                "costs": round(bills_by_m.get(m, 0) + pay_by_m.get(m, 0), 2),
                "bills": round(bills_by_m.get(m, 0), 2),
                "payroll": round(pay_by_m.get(m, 0), 2),
                "profit": round(inv_by_m.get(m, 0) + oth_by_m.get(m, 0) - bills_by_m.get(m, 0) - pay_by_m.get(m, 0), 2),
            }
            for m in range(1, pl_last_month + 1)
        ],
        "panels": {
            "receivables": {"count": recv["n"], "total": recv["t"], "overdue_count": recv["overdue_n"] or 0},
            "bills": {"count": bills_open["n"], "total": bills_open["t"], "overdue_total": overdue_bills},
            "obligations": {
                "year": year, "count": ob_year["n"], "paid_count": ob_year["paid_n"] or 0,
                "total": ob_year["total"], "paid": ob_year["paid"],
                "unpaid": round(ob_year["total"] - ob_year["paid"], 2),
                "overdue_total": overdue_obs,
                "next": ({
                    "label": OBLIGATION_TYPES.get(ob_next["obligation_type"], ob_next["obligation_type"]),
                    "period": ob_next["period_label"], "amount": ob_next["expected_bill_amount"] or ob_next["amount"], "due_date": ob_next["due_date"],
                } if ob_next else None),
            },
            "payroll": {
                "payslips_year": ps_year["n"], "net_year": ps_year["net"], "cost_year": ps_year["cost"],
                "last_period": (f"{calendar.month_abbr[ps_last['month']]} {ps_last['year']}" if ps_last else None),
                "last_net": (ps_last["net_salary"] if ps_last else None),
                "months_missing": max(0, today.month - (ps_year["n"] or 0)),
            },
            "vat": {"collected_year": vat_collected, "open_obligations": vat_open},
            "kontokorrent": {
                "net": kk["net_owed_to_personal"],
                "personal_card_open": kk["personal_card_expenses"], "personal_card_open_count": kk["personal_card_open_count"],
                "reports_open": kk["expense_reports_outstanding"], "reports_open_count": kk["expense_reports_open_count"],
            },
            "reserves": {"count": reserves_sum["n"], "target": reserves_sum["target"]},
            "bank": ({"bank": stmt_latest["bank"], "as_of": stmt_latest["period_end"],
                      "closing": stmt_latest["closing_balance"], "currency": stmt_latest["currency"]} if stmt_latest else None),
        },
        "monthly_series": [
            {
                "label": f"{calendar.month_abbr[r['month']]} {r['year']}",
                "year": r["year"], "month": r["month"],
                "revenue": r["revenue"], "hours": r["hours"],
            }
            for r in monthly_inv
        ],
        "recent_invoices": [
            {
                "id": r["id"], "invoice_number": r["invoice_number"],
                "month": r["month"], "year": r["year"],
                "month_name": calendar.month_name[r["month"]],
                "hours": r["hours"], "total": r["total"],
                "paid_status": r["paid_status"] if "paid_status" in r.keys() else "unpaid",
                "due_date": r["due_date"],
            }
            for r in recent_inv
        ],
        "recent_bills": [
            {
                "id": r["id"], "vendor": r["vendor"], "amount": r["amount"],
                "currency": r["currency"], "category": r["category"],
                "doc_date": r["doc_date"], "status": r["status"],
                "due_date": r["due_date"],
            }
            for r in recent_bills
        ],
    }


@router.get("/upcoming-payments")
async def upcoming_payments(days: int = 60):
    today = date.today()
    cutoff = (today + timedelta(days=days)).isoformat()

    items = []
    with get_db() as db:
        bills = db.execute(
            """SELECT * FROM company_docs WHERE status='unpaid' AND due_date IS NOT NULL
               AND due_date <= ? ORDER BY due_date""",
            (cutoff,),
        ).fetchall()
        for b in bills:
            items.append({
                "id": b["id"], "kind": "bill",
                "title": b["vendor"], "description": b["description"],
                "category": b["category"], "amount": b["amount"],
                "currency": b["currency"], "due_date": b["due_date"],
                "overdue": b["due_date"] < str(today),
            })

        obs = db.execute(
            f"""SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL
               AND {PAYABLE_SQL} <= ? ORDER BY {PAYABLE_SQL}""",
            (cutoff,),
        ).fetchall()
        for o in obs:
            pay = payable_date(o)
            items.append({
                "id": o["id"], "kind": "obligation",
                "title": OBLIGATION_TYPES.get(o["obligation_type"], o["obligation_type"]),
                "description": o["period_label"],
                "category": o["obligation_type"],
                "amount": o["amount"], "currency": o["currency"],
                "due_date": pay, "period_due": o["due_date"],
                "overdue": pay < str(today),
            })

    items.sort(key=lambda x: x["due_date"])
    total = sum(i["amount"] for i in items)
    overdue_total = sum(i["amount"] for i in items if i["overdue"])

    return {
        "today": str(today),
        "days": days,
        "total": total,
        "overdue_total": overdue_total,
        "count": len(items),
        "items": items,
    }


@router.get("/finance/dashboard")
async def finance_dashboard():
    today = date.today()
    month_start = today.replace(day=1)
    if today.month == 12:
        next_month = today.replace(year=today.year + 1, month=1, day=1)
    else:
        next_month = today.replace(month=today.month + 1, day=1)

    with get_db() as db:
        overdue = db.execute(
            "SELECT * FROM company_docs WHERE status='unpaid' AND due_date < ? ORDER BY due_date",
            (str(today),),
        ).fetchall()

        due_month = db.execute(
            "SELECT * FROM company_docs WHERE status='unpaid' AND due_date >= ? AND due_date < ? ORDER BY due_date",
            (str(month_start), str(next_month)),
        ).fetchall()

        upcoming = db.execute(
            "SELECT * FROM company_docs WHERE status='unpaid' AND due_date >= ? ORDER BY due_date LIMIT 20",
            (str(next_month),),
        ).fetchall()

        no_date = db.execute(
            "SELECT * FROM company_docs WHERE status='unpaid' AND due_date IS NULL ORDER BY doc_date DESC",
        ).fetchall()

        paid_recent = db.execute(
            "SELECT * FROM company_docs WHERE status='paid' ORDER BY due_date DESC LIMIT 10",
        ).fetchall()

    def to_list(rows):
        return [{
            "id": r["id"], "doc_date": r["doc_date"], "vendor": r["vendor"],
            "description": r["description"], "amount": r["amount"],
            "currency": r["currency"], "category": r["category"],
            "due_date": r["due_date"], "status": r["status"],
        } for r in rows]

    overdue_total = sum(r["amount"] for r in overdue)
    month_total = sum(r["amount"] for r in due_month)

    return {
        "today": str(today),
        "month": today.strftime("%B %Y"),
        "overdue": to_list(overdue),
        "overdue_total": overdue_total,
        "due_this_month": to_list(due_month),
        "month_total": month_total,
        "total_due": overdue_total + month_total,
        "upcoming": to_list(upcoming),
        "no_due_date": to_list(no_date),
        "recently_paid": to_list(paid_recent),
    }


@router.get("/dashboard/compare-months")
async def compare_months():
    today = date.today()
    this_month = today.strftime("%Y-%m")
    if today.month == 1:
        last_dt = date(today.year - 1, 12, 1)
    else:
        last_dt = date(today.year, today.month - 1, 1)
    last_month = last_dt.strftime("%Y-%m")

    def stats_for(month_str):
        with get_db() as db:
            year, m = month_str.split("-")
            rev = db.execute(
                "SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND month=? AND hours>0",
                (int(year), int(m)),
            ).fetchone()["t"]
            inc = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM income_entries WHERE substr(income_date,1,7)=?",
                (month_str,),
            ).fetchone()["t"]
            bills = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE substr(doc_date,1,7)=?",
                (month_str,),
            ).fetchone()["t"]
            obs = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE substr(due_date,1,7)=?",
                (month_str,),
            ).fetchone()["t"]
        return {"income": rev + inc, "costs": bills + obs, "net": (rev + inc) - (bills + obs)}

    this_stats = stats_for(this_month)
    last_stats = stats_for(last_month)

    def diff(a, b):
        return {
            "absolute": round(a - b, 2),
            "pct": round(((a - b) / b * 100), 1) if b else None,
        }

    return {
        "this_month": {"label": this_month, **this_stats},
        "last_month": {"label": last_month, **last_stats},
        "diff": {
            "income": diff(this_stats["income"], last_stats["income"]),
            "costs": diff(this_stats["costs"], last_stats["costs"]),
            "net": diff(this_stats["net"], last_stats["net"]),
        },
    }


@router.get("/dashboard/category-trends")
async def category_trends(months: int = 6):
    today = date.today()
    periods = []
    y, m = today.year, today.month
    for _ in range(months):
        periods.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    periods.reverse()

    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM company_docs WHERE doc_date >= ?",
            (periods[0] + "-01",),
        ).fetchall()

    by_cat = {}
    for r in rows:
        cat = r["category"]
        month = r["doc_date"][:7]
        by_cat.setdefault(cat, {p: 0.0 for p in periods})
        if month in by_cat[cat]:
            by_cat[cat][month] += r["amount"]

    return {
        "periods": periods,
        "categories": [
            {"category": cat, "series": [round(by_cat[cat][p], 2) for p in periods],
             "total": sum(by_cat[cat].values())}
            for cat in sorted(by_cat.keys(), key=lambda c: -sum(by_cat[c].values()))
        ],
    }
