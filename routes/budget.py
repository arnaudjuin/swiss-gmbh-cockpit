"""Budget config + monthly view + sinking-fund balances + ledger.

Mounted at /api/budget/* and /api/finance/* by app.py.
"""

import calendar
from datetime import date

from fastapi import APIRouter, HTTPException, Request

from db import get_db
from helpers import add_months
from routes.obligations import OBLIGATION_TYPES

router = APIRouter(tags=["budget"])

# Injected from app.py
_ctx = {}

def configure(salary: float, row_to_settings, compute_payslip):
    _ctx["SALARY"] = salary
    _ctx["row_to_settings"] = row_to_settings
    _ctx["compute_payslip"] = compute_payslip

def _salary():
    return _ctx["SALARY"]

def _row_to_settings(r):
    return _ctx["row_to_settings"](r)

def _compute_payslip(s):
    return _ctx["compute_payslip"](s)



BUDGET_GROUPS = {
    "personal_fixed": "Personal Fixed",
    "business_fixed": "Business Fixed",
    "debt": "Debt",
    "needs": "Needs",
    "wants": "Wants",
    "business_variable": "Business Variable",
    "savings": "Savings",
}

# Default subcategories per group
DEFAULT_SUBS = {
    "personal_fixed": ["Rent", "Health Insurance", "Phone", "Internet", "Utilities", "Transport Pass"],
    "business_fixed": ["Registered Agent", "Accounting", "Software", "Insurance", "Domain/Hosting"],
    "debt": [],
    "needs": ["Groceries", "Household", "Health", "Utilities", "Transportation", "Other Needs"],
    "wants": ["Restaurant", "Coffee", "Entertainment", "Shopping", "Travel", "Leisure", "Clothing", "Other Wants"],
    "business_variable": ["Office Expenses", "Legal", "Advertising", "Supplies", "Business Travel", "Meals & Ent.", "Other Business"],
    "savings": ["Emergency Fund", "Investments", "Other Savings"],
}


@router.get("/budget/config")
async def get_budget_config():
    with get_db() as db:
        rows = db.execute("SELECT * FROM budget_items ORDER BY grp, sort_order").fetchall()
    if not rows:
        return {"salary": _salary(), "items": [], "groups": BUDGET_GROUPS}
    return {
        "salary": _salary(),
        "groups": BUDGET_GROUPS,
        "items": [{
            "id": r["id"], "grp": r["grp"], "subcategory": r["subcategory"],
            "budgeted": r["budgeted"], "sort_order": r["sort_order"],
        } for r in rows],
    }


@router.post("/budget/config")
async def save_budget_config(request: Request):
    """Replace the budget config — UPSERT so existing IDs and their ledger
    history survive (we used to wipe + re-insert which orphaned all ledger
    rows)."""
    body = await request.json()
    items = body.get("items", [])

    incoming_pairs = {(item["grp"], item["subcategory"]) for item in items}

    with get_db() as db:
        # Remove items that are no longer in the incoming list (+ their ledger)
        existing = db.execute("SELECT id, grp, subcategory FROM budget_items").fetchall()
        for row in existing:
            if (row["grp"], row["subcategory"]) not in incoming_pairs:
                db.execute("DELETE FROM budget_ledger WHERE budget_item_id=?", (row["id"],))
                db.execute("DELETE FROM budget_items WHERE id=?", (row["id"],))

        # UPSERT each incoming row (relies on the UNIQUE (grp, subcategory) index)
        for i, item in enumerate(items):
            db.execute(
                "INSERT INTO budget_items (grp, subcategory, budgeted, sort_order) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(grp, subcategory) DO UPDATE SET "
                "  budgeted=excluded.budgeted, sort_order=excluded.sort_order",
                (item["grp"], item["subcategory"], item.get("budgeted", 0), i),
            )
    return {"message": "Budget saved"}


@router.get("/budget/month/{year}/{month}")
async def get_monthly_budget(year: int, month: int):
    month_str = f"{year}-{month:02d}"

    with get_db() as db:
        # Budget items
        budget_rows = db.execute("SELECT * FROM budget_items ORDER BY grp, sort_order").fetchall()

        # Business income from invoices this month (exclude reimbursement reports)
        invoice_income = db.execute(
            "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE year=? AND month=? AND hours>0",
            (year, month),
        ).fetchone()["total"]

        # Additional income entries this month
        extra_income_rows = db.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM income_entries WHERE substr(income_date,1,7)=?",
            (month_str,),
        ).fetchone()
        extra_income = extra_income_rows["total"]

        # Actual spending from company_docs this month
        docs = db.execute(
            "SELECT * FROM company_docs WHERE substr(doc_date,1,7)=?",
            (month_str,),
        ).fetchall()

        # Travel expenses this month (REIMBURSABLE — kept separate from GmbH operating budget)
        expenses = db.execute(
            "SELECT * FROM expenses WHERE substr(expense_date,1,7)=?",
            (month_str,),
        ).fetchall()
        # Reimbursement = invoice with hours=0 in the month (or expense_reports row)
        reimbursed_this_month = db.execute(
            "SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND month=? AND hours=0",
            (year, month),
        ).fetchone()["t"]

    # Map company_docs categories to budget groups
    cat_to_group = {
        "Office Supplies": "business_variable",
        "Software/Subscriptions": "business_fixed",
        "Professional Services": "business_variable",
        "Insurance": "personal_fixed",
        "Rent": "personal_fixed",
        "Telecom": "personal_fixed",
        "Legal": "business_variable",
        "Bank Fees": "business_fixed",
        "Other": "business_variable",
    }

    # Build actuals per group
    group_actuals = {g: 0.0 for g in BUDGET_GROUPS}
    doc_transactions = []
    for d in docs:
        grp = cat_to_group.get(d["category"], "business_variable")
        group_actuals[grp] += d["amount"]
        doc_transactions.append({
            "date": d["doc_date"], "vendor": d["vendor"],
            "description": d["description"], "amount": d["amount"],
            "currency": d["currency"], "category": d["category"], "group": grp,
        })

    # Travel expenses are REIMBURSABLE — billed back to clients via yearly expense report.
    # They do NOT affect the GmbH operating budget; tracked separately for visibility only.
    travel_total = sum(e["amount"] for e in expenses)

    # Build budget summary per group
    budget_items = {}
    for r in budget_rows:
        grp = r["grp"]
        if grp not in budget_items:
            budget_items[grp] = []
        budget_items[grp].append({
            "subcategory": r["subcategory"],
            "budgeted": r["budgeted"],
        })

    total_income = _salary() + invoice_income + extra_income
    total_budgeted = sum(r["budgeted"] for r in budget_rows)
    total_actual = sum(group_actuals.values())
    left_to_budget = total_income - total_budgeted
    left_to_spend = total_income - total_actual

    groups_summary = []
    for key, label in BUDGET_GROUPS.items():
        budgeted = sum(it["budgeted"] for it in budget_items.get(key, []))
        actual = group_actuals[key]
        groups_summary.append({
            "key": key, "label": label,
            "budgeted": budgeted, "actual": actual,
            "diff": budgeted - actual,
            "items": budget_items.get(key, []),
        })

    return {
        "year": year, "month": month,
        "month_name": calendar.month_name[month],
        "salary": _salary(),
        "invoice_income": invoice_income,
        "extra_income": extra_income,
        "total_income": total_income,
        "total_budgeted": total_budgeted,
        "total_actual": total_actual,
        "left_to_budget": left_to_budget,
        "left_to_spend": left_to_spend,
        "groups": groups_summary,
        "transactions": doc_transactions,
        "travel_total": travel_total,
        "travel_count": len(expenses),
        "travel_reimbursed_this_month": reimbursed_this_month,
        "travel_isolation_note": "Travel expenses are reimbursable client costs and excluded from the GmbH budget actuals.",
    }


@router.get("/budget/balances")
async def list_budget_balances(month: str | None = None):
    """Return balances computed from ledger as of end of the selected month.

    If no month given, returns current balance (latest).
    month format: YYYY-MM
    """
    today = date.today()
    selected_month = month or today.strftime("%Y-%m")

    # End of selected month
    try:
        y, m = int(selected_month[:4]), int(selected_month[5:7])
    except Exception:
        raise HTTPException(400, "month must be YYYY-MM")
    last_day = calendar.monthrange(y, m)[1]
    end_of_month = f"{selected_month}-{last_day:02d}"

    with get_db() as db:
        items = db.execute("SELECT * FROM budget_items ORDER BY grp, sort_order").fetchall()
        # Current live balance (sum all ledger entries)
        current_sums = {}
        for r in db.execute(
            "SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger GROUP BY budget_item_id",
        ).fetchall():
            current_sums[r["budget_item_id"]] = r["total"]

        # Balance at end of selected month
        ledger_sums = {}
        for r in db.execute(
            "SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE entry_date<=? GROUP BY budget_item_id",
            (end_of_month,),
        ).fetchall():
            ledger_sums[r["budget_item_id"]] = r["total"]

        # Total contributed in the selected month
        month_contrib_amount = {}
        for r in db.execute(
            "SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE kind='contribute' AND substr(entry_date,1,7)=? GROUP BY budget_item_id",
            (selected_month,),
        ).fetchall():
            month_contrib_amount[r["budget_item_id"]] = r["total"]

        # Total withdrawn in the selected month (as positive value)
        month_withdraw_amount = {}
        for r in db.execute(
            "SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE kind='withdraw' AND substr(entry_date,1,7)=? GROUP BY budget_item_id",
            (selected_month,),
        ).fetchall():
            month_withdraw_amount[r["budget_item_id"]] = -r["total"]  # flip sign to positive

    return {
        "current_month": today.strftime("%Y-%m"),
        "selected_month": selected_month,
        "items": [{
            "id": r["id"], "grp": r["grp"], "subcategory": r["subcategory"],
            "budgeted": r["budgeted"],
            "balance_current": current_sums.get(r["id"], 0),
            "balance_at_month_end": ledger_sums.get(r["id"], 0),
            "contributed_in_month": month_contrib_amount.get(r["id"], 0) > 0,
            "contributed_amount_in_month": month_contrib_amount.get(r["id"], 0),
            "withdrawn_amount_in_month": month_withdraw_amount.get(r["id"], 0),
        } for r in items],
    }


@router.post("/budget/contribute/{item_id}")
async def contribute_to_budget(item_id: int, request: Request):
    body = await request.json() if request.headers.get("content-length") else {}
    amount_override = body.get("amount")
    month_override = body.get("month")
    today = date.today()
    month_str = month_override or today.strftime("%Y-%m")

    # Use the last day of the selected month as entry date
    y, m = int(month_str[:4]), int(month_str[5:7])
    last_day = calendar.monthrange(y, m)[1]
    entry_date = f"{month_str}-{last_day:02d}"

    with get_db() as db:
        row = db.execute("SELECT * FROM budget_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Budget item not found")

        # Check if already contributed for this month via ledger
        exists = db.execute(
            "SELECT id FROM budget_ledger WHERE budget_item_id=? AND kind='contribute' AND substr(entry_date,1,7)=?",
            (item_id, month_str),
        ).fetchone()
        if exists and amount_override is None:
            raise HTTPException(400, f"Already contributed for {month_str}")

        amount = float(amount_override) if amount_override is not None else row["budgeted"]

        db.execute(
            """INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind)
               VALUES (?,?,?,?,?)""",
            (item_id, entry_date, amount, f"Monthly contribution for {month_str}", "contribute"),
        )
        # Update running balance (latest balance)
        new_balance = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?",
            (item_id,),
        ).fetchone()["t"]
        db.execute(
            "UPDATE budget_items SET balance=?, last_contributed_month=? WHERE id=?",
            (new_balance, month_str, item_id),
        )
    return {"balance": new_balance, "amount": amount, "month": month_str}


@router.post("/budget/contribute-all")
async def contribute_all(request: Request):
    """Contribute to all budget items that haven't been contributed for the given month."""
    body = await request.json() if request.headers.get("content-length") else {}
    month_str = body.get("month") or date.today().strftime("%Y-%m")
    y, m = int(month_str[:4]), int(month_str[5:7])
    last_day = calendar.monthrange(y, m)[1]
    entry_date = f"{month_str}-{last_day:02d}"

    updated = 0
    total = 0.0

    with get_db() as db:
        rows = db.execute("SELECT * FROM budget_items").fetchall()
        for r in rows:
            if r["budgeted"] <= 0:
                continue
            exists = db.execute(
                "SELECT id FROM budget_ledger WHERE budget_item_id=? AND kind='contribute' AND substr(entry_date,1,7)=?",
                (r["id"], month_str),
            ).fetchone()
            if exists:
                continue
            amount = r["budgeted"]
            db.execute(
                """INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind)
                   VALUES (?,?,?,?,?)""",
                (r["id"], entry_date, amount, f"Monthly contribution for {month_str}", "contribute"),
            )
            new_balance = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?",
                (r["id"],),
            ).fetchone()["t"]
            db.execute(
                "UPDATE budget_items SET balance=?, last_contributed_month=? WHERE id=?",
                (new_balance, month_str, r["id"]),
            )
            updated += 1
            total += amount

    return {"contributed_items": updated, "total_contributed": total, "month": month_str}


@router.post("/budget/withdraw/{item_id}")
async def withdraw_from_budget(item_id: int, request: Request):
    body = await request.json()
    amount = float(body.get("amount", 0))
    description = body.get("description", "")
    entry_date = body.get("date") or str(date.today())
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    with get_db() as db:
        row = db.execute("SELECT * FROM budget_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Budget item not found")
        db.execute(
            """INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind)
               VALUES (?,?,?,?,?)""",
            (item_id, entry_date, -amount, description or "Manual withdrawal", "withdraw"),
        )
        new_balance = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?",
            (item_id,),
        ).fetchone()["t"]
        db.execute("UPDATE budget_items SET balance=? WHERE id=?", (new_balance, item_id))
    return {"balance": new_balance}


@router.post("/budget/adjust/{item_id}")
async def adjust_balance(item_id: int, request: Request):
    """Set the balance at end of a given month (inserts a correction ledger entry dated end of month)."""
    body = await request.json()
    target_balance = float(body.get("balance", 0))
    month_str = body.get("month") or date.today().strftime("%Y-%m")
    y, m = int(month_str[:4]), int(month_str[5:7])
    last_day = calendar.monthrange(y, m)[1]
    entry_date = f"{month_str}-{last_day:02d}"

    with get_db() as db:
        row = db.execute("SELECT id FROM budget_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        # Compute current balance at end of that month (excluding adjustments already in this same date)
        current = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=? AND entry_date<=?",
            (item_id, entry_date),
        ).fetchone()["t"]
        delta = target_balance - current
        if abs(delta) > 0.001:
            db.execute(
                """INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind)
                   VALUES (?,?,?,?,?)""",
                (item_id, entry_date, delta, f"Balance set to {target_balance:.2f} for {month_str}", "adjust"),
            )
        new_balance = db.execute(
            "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?",
            (item_id,),
        ).fetchone()["t"]
        db.execute("UPDATE budget_items SET balance=? WHERE id=?", (new_balance, item_id))
    return {"balance": new_balance, "adjusted_for_month": month_str}


@router.get("/budget/ledger/{item_id}")
async def budget_ledger(item_id: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM budget_ledger WHERE budget_item_id=? ORDER BY entry_date DESC, id DESC LIMIT 100",
            (item_id,),
        ).fetchall()
    return [{
        "id": r["id"], "entry_date": r["entry_date"], "amount": r["amount"],
        "description": r["description"], "kind": r["kind"],
    } for r in rows]


def _recompute_balance(db, item_id):
    new_balance = db.execute(
        "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?",
        (item_id,),
    ).fetchone()["t"]
    db.execute("UPDATE budget_items SET balance=? WHERE id=?", (new_balance, item_id))
    return new_balance


@router.delete("/budget/ledger/{entry_id}")
async def delete_ledger_entry(entry_id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM budget_ledger WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Entry not found")
        item_id = row["budget_item_id"]
        # Snapshot for undo
        snapshot = {
            "budget_item_id": item_id,
            "entry_date": row["entry_date"],
            "amount": row["amount"],
            "description": row["description"],
            "kind": row["kind"],
        }
        db.execute("DELETE FROM budget_ledger WHERE id=?", (entry_id,))
        new_balance = _recompute_balance(db, item_id)
    return {"message": "Entry revoked", "balance": new_balance, "snapshot": snapshot}


@router.post("/budget/ledger")
async def create_ledger_entry(request: Request):
    """Re-create a ledger entry from a snapshot (used for undo)."""
    body = await request.json()
    for field in ("budget_item_id", "entry_date", "amount"):
        if field not in body:
            raise HTTPException(400, f"Missing required field: {field}")
    item_id = body["budget_item_id"]
    with get_db() as db:
        exists = db.execute("SELECT id FROM budget_items WHERE id=?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Budget item not found")
        cur = db.execute(
            """INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind)
               VALUES (?,?,?,?,?)""",
            (item_id, body["entry_date"], body["amount"],
             body.get("description", ""), body.get("kind", "adjust")),
        )
        new_balance = _recompute_balance(db, item_id)
    return {"id": cur.lastrowid, "balance": new_balance}


@router.put("/budget/ledger/{entry_id}")
async def update_ledger_entry(entry_id: int, request: Request):
    body = await request.json()
    amount = body.get("amount")
    description = body.get("description")
    entry_date = body.get("entry_date")
    with get_db() as db:
        row = db.execute("SELECT * FROM budget_ledger WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Entry not found")
        new_amount = float(amount) if amount is not None else row["amount"]
        new_desc = description if description is not None else row["description"]
        new_date = entry_date or row["entry_date"]
        db.execute(
            "UPDATE budget_ledger SET amount=?, description=?, entry_date=? WHERE id=?",
            (new_amount, new_desc, new_date, entry_id),
        )
        new_balance = _recompute_balance(db, row["budget_item_id"])
    return {"message": "Entry updated", "balance": new_balance}


