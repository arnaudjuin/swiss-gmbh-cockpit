"""LLM tool definitions for the AI chat.

Each tool is a Python function that queries the DB and returns a dict.
The LLM picks one tool per user question (safer than raw SQL generation).

Usage:
    from llm_tools import build_tools, build_tools_prompt
    TOOLS = build_tools(get_db, _row_to_settings, _compute_payslip, OBLIGATION_TYPES, SALARY)
    prompt = build_tools_prompt(TOOLS)
"""

from datetime import date, datetime, timedelta


def build_tools(get_db, row_to_settings, compute_payslip, _obligation_types, _salary):
    """Construct the TOOLS registry.

    Takes the dependencies as args so this module is self-contained.
    """

    def _tool_search_bills(year=None, vendor=None, category=None, status=None,
                           paid_via=None, limit=50):
        """Search company bills by year, vendor, category, paid/unpaid status,
        or how they were paid (company account vs owner's personal card)."""
        sql = ("SELECT doc_date, vendor, description, amount, currency, category, "
               "due_date, status, paid_via FROM company_docs WHERE 1=1")
        args = []
        if year:
            sql += " AND substr(doc_date,1,4)=?"; args.append(str(year))
        if vendor:
            sql += " AND LOWER(vendor) LIKE ?"; args.append(f"%{vendor.lower()}%")
        if category:
            sql += " AND category=?"; args.append(category)
        if status in ("paid", "unpaid"):
            sql += " AND status=?"; args.append(status)
        if paid_via in ("company", "personal"):
            sql += " AND paid_via=?"; args.append(paid_via)
        sql += " ORDER BY doc_date DESC LIMIT ?"; args.append(min(limit, 200))
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {
            "count": len(rows),
            "total_chf": round(sum(r["amount"] for r in rows), 2),
            "personal_card_chf": round(sum(r["amount"] for r in rows
                                           if r.get("paid_via") == "personal"), 2),
            "rows": rows,
        }

    def _tool_search_expenses(year=None, category=None, limit=50):
        """Search travel expenses by year or category."""
        sql = ("SELECT expense_date, description, amount, category, "
               "original_amount, original_currency FROM expenses WHERE 1=1")
        args = []
        if year:
            sql += " AND substr(expense_date,1,4)=?"; args.append(str(year))
        if category:
            sql += " AND category=?"; args.append(category)
        sql += " ORDER BY expense_date DESC LIMIT ?"; args.append(min(limit, 200))
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {
            "count": len(rows),
            "total_chf": round(sum(r["amount"] for r in rows), 2),
            "rows": rows,
        }

    def _tool_list_obligations(status=None, year=None):
        """List GmbH obligations (AHV, BVG, taxes, KTG, UVG)."""
        sql = ("SELECT obligation_type, period_label, amount, due_date, status, notes "
               "FROM obligations WHERE 1=1")
        args = []
        if status in ("paid", "unpaid"):
            sql += " AND status=?"; args.append(status)
        if year:
            sql += " AND period_year=?"; args.append(year)
        sql += " ORDER BY due_date DESC LIMIT 100"
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {
            "count": len(rows),
            "total_chf": round(sum(r["amount"] for r in rows), 2),
            "rows": rows,
        }

    def _tool_get_runway():
        """Compute current cash balance, monthly burn, and runway in months."""
        today = date.today()
        with get_db() as db:
            cash_row = db.execute("SELECT * FROM cash_balance WHERE id=1").fetchone()
            balance = cash_row["balance"] if cash_row else 0
            as_of = cash_row["as_of"] if cash_row else str(today)

            recurring = db.execute(
                "SELECT amount, recurrence FROM company_docs "
                "WHERE recurrence IN ('monthly','quarterly','yearly') "
                "AND (parent_doc_id IS NULL OR parent_doc_id = 0)"
            ).fetchall()
            obligations_future = db.execute(
                "SELECT amount, due_date FROM obligations "
                "WHERE status='unpaid' AND due_date IS NOT NULL"
            ).fetchall()
            six_months_ago = today - timedelta(days=180)
            avg_invoice = db.execute(
                "SELECT COALESCE(AVG(total), 0) as avg FROM invoices "
                "WHERE hours > 0 AND year * 12 + month >= ?",
                ((six_months_ago.year * 12 + six_months_ago.month),),
            ).fetchone()["avg"]
            psr = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()

        monthly_recurring_cost = sum(
            r["amount"] / {"monthly": 1, "quarterly": 3, "yearly": 12}[r["recurrence"]]
            for r in recurring
        )
        horizon = today + timedelta(days=365)
        monthly_ob_cost = sum(
            o["amount"] for o in obligations_future
            if o["due_date"] <= str(horizon)
        ) / 12

        payroll_monthly_cost = 0.0
        if psr and psr["gross_monthly"] > 0:
            calc = compute_payslip(row_to_settings(psr))
            payroll_monthly_cost = calc["total_employer_cost"]

        monthly_burn = round(
            monthly_recurring_cost + monthly_ob_cost + payroll_monthly_cost - avg_invoice,
            2,
        )
        runway_months = None if monthly_burn <= 0 else round(balance / monthly_burn, 1)

        return {
            "balance": balance,
            "as_of": str(as_of),
            "monthly_burn": monthly_burn,
            "monthly_recurring_cost": round(monthly_recurring_cost, 2),
            "monthly_obligations_cost": round(monthly_ob_cost, 2),
            "monthly_payroll_cost": round(payroll_monthly_cost, 2),
            "monthly_expected_income": round(avg_invoice, 2),
            "runway_months": runway_months,
            "description": "Cash positive - no burn" if runway_months is None
                           else f"{runway_months} months at current burn",
        }

    def _tool_top_vendors(year=None, limit=10):
        """Top vendors by total amount paid."""
        sql = ("SELECT vendor, COUNT(*) as count, SUM(amount) as total "
               "FROM company_docs WHERE 1=1")
        args = []
        if year:
            sql += " AND substr(doc_date,1,4)=?"; args.append(str(year))
        sql += " GROUP BY vendor ORDER BY total DESC LIMIT ?"; args.append(min(limit, 50))
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {"count": len(rows), "rows": rows}

    def _tool_dashboard_summary():
        """High-level GmbH financial overview YTD on BOTH cash and accrual basis.

        - Cash basis: only income that has actually landed in the bank (paid invoices
          + income_entries). Used for actual liquidity / "what's in the account".
        - Accrual basis: all issued invoices and incurred bills, regardless of payment
          status. Used for P&L, equity tests, dividend capacity, OR 725a/b compliance.

        These two views typically diverge by tens of thousands during a fiscal year
        because invoices are paid 30-45 days after issue.
        """
        today = date.today()
        year = today.year
        with get_db() as db:
            # All issued invoices (accrual revenue)
            inv = db.execute(
                "SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, "
                "COALESCE(SUM(hours),0) as hrs "
                "FROM invoices WHERE hours>0 AND year=?", (year,),
            ).fetchone()
            inv_paid = db.execute(
                "SELECT COALESCE(SUM(total),0) as t FROM invoices "
                "WHERE year=? AND hours>0 AND paid_status='paid'", (year,),
            ).fetchone()["t"]
            inv_unpaid = db.execute(
                "SELECT COALESCE(SUM(total),0) as t FROM invoices "
                "WHERE year=? AND hours>0 AND paid_status!='paid'", (year,),
            ).fetchone()["t"]
            extra = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM income_entries "
                "WHERE substr(income_date,1,4)=?", (str(year),),
            ).fetchone()["t"]
            bills = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM company_docs "
                "WHERE substr(doc_date,1,4)=?", (str(year),),
            ).fetchone()["t"]
            obs = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE period_year=?",
                (year,),
            ).fetchone()["t"]
            overdue_bills = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM company_docs "
                "WHERE status='unpaid' AND due_date<?", (str(today),),
            ).fetchone()["t"]
            overdue_obs = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM obligations "
                "WHERE status='unpaid' AND due_date<?", (str(today),),
            ).fetchone()["t"]

        # CASH basis = income_entries (which already includes paid invoices via the link)
        income_cash = round(extra, 2)
        costs_cash = round(bills + obs, 2)
        profit_cash = round(income_cash - costs_cash, 2)

        # ACCRUAL basis = all issued invoices + extra non-invoice income
        # (Note: income_entries may already include paid invoices, so we subtract
        # those to avoid double counting on the accrual side.)
        non_invoice_income = max(0, round(extra - inv_paid, 2))
        income_accrual = round(inv["rev"] + non_invoice_income, 2)
        costs_accrual = costs_cash  # bills/obligations accrue at doc_date already
        profit_accrual = round(income_accrual - costs_accrual, 2)

        return {
            "year": year,
            # Headline figures (both bases)
            "income_ytd_cash": income_cash,
            "income_ytd_accrual": income_accrual,
            "profit_ytd_cash": profit_cash,
            "profit_ytd_accrual": profit_accrual,
            # Receivables (the gap between cash and accrual)
            "receivables_outstanding": round(inv_unpaid, 2),
            # Drill-downs
            "invoices_revenue_total": inv["rev"],
            "invoices_count": inv["cnt"],
            "invoices_paid_ytd": inv_paid,
            "invoices_unpaid_ytd": round(inv_unpaid, 2),
            "extra_income_ytd": extra,
            "costs_ytd": costs_cash,
            "bills_ytd": bills,
            "obligations_ytd": obs,
            "overdue_total": round(overdue_bills + overdue_obs, 2),
            "total_hours": inv["hrs"],
            # Back-compat aliases (existing UI may still read these)
            "income_ytd": income_cash,
            "profit_ytd": profit_cash,
            "_basis_note": (
                "income_ytd / profit_ytd are CASH basis (paid invoices only). "
                "Use *_accrual fields for legal P&L (OR 725a, dividend capacity, equity tests). "
                f"Receivables outstanding: CHF {round(inv_unpaid, 2):,.2f}."
            ),
        }

    def _tool_receivables_summary():
        """List every outstanding (unpaid) invoice with ageing.

        Returns one row per unpaid invoice and a total. Use this whenever a user
        asks about money owed to the GmbH, late payers, cash-flow risk, or how
        much is "in flight". Prevents the model from confabulating numbers.
        """
        MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"]
        today = date.today()
        rows_out = []
        with get_db() as db:
            rows = db.execute(
                "SELECT invoice_number, year, month, total, issued_date, "
                "due_date, paid_status, notes "
                "FROM invoices WHERE hours>0 AND paid_status!='paid' "
                "ORDER BY issued_date"
            ).fetchall()
            for r in rows:
                due = r["due_date"]
                days_overdue = 0
                if due:
                    try:
                        y, m, d = due.split("-")
                        due_d = date(int(y), int(m), int(d))
                        days_overdue = max(0, (today - due_d).days)
                    except (ValueError, AttributeError):
                        pass
                month_idx = int(r["month"] or 0)
                month_name = MONTH_NAMES[month_idx - 1] if 1 <= month_idx <= 12 else "?"
                rows_out.append({
                    "invoice_number": r["invoice_number"],
                    "period": f"{month_name} {r['year']}",
                    "total": float(r["total"] or 0),
                    "issued_date": r["issued_date"],
                    "due_date": due,
                    "days_overdue": days_overdue,
                    "expected_payment_window": (
                        f"~{30 - days_overdue if days_overdue < 30 else 0} days remaining "
                        f"in 30-day terms" if days_overdue < 30
                        else f"OVERDUE by {days_overdue} days"
                    ),
                })
        total = round(sum(r["total"] for r in rows_out), 2)
        overdue_count = sum(1 for r in rows_out if r["days_overdue"] > 0)
        overdue_amount = round(sum(r["total"] for r in rows_out if r["days_overdue"] > 0), 2)
        return {
            "count": len(rows_out),
            "total_outstanding": total,
            "overdue_count": overdue_count,
            "overdue_amount": overdue_amount,
            "invoices": rows_out,
            "_note": (
                "These invoices have been issued but not yet paid. They are receivable "
                "by the GmbH and counted in accrual revenue but NOT in cash income."
            ),
        }

    def _tool_dividend_capacity():
        """Compute distributable profit for an interim dividend (OR 675a) today,
        plus the projected year-end capacity. Includes Swiss-specific tax math.

        Uses ACCRUAL P&L (not cash) because that's the legal basis for distributions.
        """
        today = date.today()
        year = today.year
        with get_db() as db:
            # Accrual P&L year-to-date
            inv_rev = db.execute(
                "SELECT COALESCE(SUM(total),0) as t FROM invoices "
                "WHERE hours>0 AND year=?", (year,),
            ).fetchone()["t"]
            inv_vat = db.execute(
                "SELECT COALESCE(SUM(tax),0) as t FROM invoices "
                "WHERE hours>0 AND year=?", (year,),
            ).fetchone()["t"]
            bills = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM company_docs "
                "WHERE substr(doc_date,1,4)=?", (str(year),),
            ).fetchone()["t"]
            obs = db.execute(
                "SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE period_year=?",
                (year,),
            ).fetchone()["t"]
            # Payroll cost (employer total outlay) computed from settings
            try:
                ps_row = db.execute(
                    "SELECT * FROM payroll_settings WHERE id=1"
                ).fetchone()
                ps_dict = dict(ps_row) if ps_row else {}
            except Exception:
                ps_dict = {}
            empl_start = ps_dict.get("employment_start")
            employer_total = 0
            months_employed = 0
            if ps_dict and empl_start:
                try:
                    y, m, _ = empl_start.split("-")
                    start = date(int(y), int(m), 1)
                    if start.year <= year and start <= today:
                        # Count months from start to today (inclusive of current month)
                        s = max(start, date(year, 1, 1))
                        months_employed = max(0, (today.year - s.year) * 12 + (today.month - s.month) + 1)
                        calc = compute_payslip(ps_dict)
                        employer_total = months_employed * calc["total_employer_cost"]
                except (ValueError, AttributeError, KeyError):
                    pass
            # Share capital (used for gesetzliche Reserve cap)
            share_capital = float(ps_dict.get("share_capital") or 20000)
            legal_reserves_capped_at = round(share_capital * 0.5, 2)

        net_revenue = round(inv_rev - inv_vat, 2)  # ex-VAT (VAT is pass-through)
        accrual_pnl = round(net_revenue - bills - obs - employer_total, 2)

        # Statutory reserve: 5% of annual profit until reserve hits 50% of share capital
        # Conservative — assume no prior reserve has been allocated.
        if accrual_pnl > 0:
            mandatory_reserve = round(min(accrual_pnl * 0.05, legal_reserves_capped_at), 2)
        else:
            mandatory_reserve = 0
        distributable_now = round(max(0, accrual_pnl - mandatory_reserve), 2)

        # Tax math for the distributable amount
        if distributable_now > 0:
            gross_dividend = distributable_now
            verrechnungssteuer = round(gross_dividend * 0.35, 2)
            net_received_immediately = round(gross_dividend - verrechnungssteuer, 2)
            # Verrechnungssteuer is reclaimed via personal tax return; net cash from
            # dividend after personal income tax (Teilbesteuerung ~7-12% effective):
            personal_tax_estimate = round(gross_dividend * 0.10, 2)  # ~10% effective
            net_to_shareholder = round(gross_dividend - personal_tax_estimate, 2)
        else:
            gross_dividend = 0
            verrechnungssteuer = 0
            net_received_immediately = 0
            personal_tax_estimate = 0
            net_to_shareholder = 0

        return {
            "year": year,
            "as_of": today.isoformat(),
            "net_revenue_accrual": net_revenue,
            "costs_accrual": round(bills + obs + employer_total, 2),
            "payroll_employer_cost_ytd": round(employer_total, 2),
            "months_employed_ytd": months_employed,
            "accrual_pnl_ytd": accrual_pnl,
            "mandatory_reserve_allocation": mandatory_reserve,
            "distributable_now": distributable_now,
            "interim_dividend_possible": distributable_now > 0,
            "share_capital": share_capital,
            "legal_reserve_cap_50pct": legal_reserves_capped_at,
            "tax_math_if_distributed_now": {
                "gross_dividend": gross_dividend,
                "verrechnungssteuer_35pct": verrechnungssteuer,
                "net_received_immediately": net_received_immediately,
                "personal_tax_estimate_10pct_teilbesteuerung": personal_tax_estimate,
                "net_to_shareholder_after_all_taxes": net_to_shareholder,
            },
            "_note": (
                "Interim dividend per OR 675a requires an interim balance sheet "
                "and Generalversammlung resolution. If accrual_pnl_ytd is negative, "
                "no distribution is legally possible. Tax math assumes the user "
                "qualifies for Teilbesteuerung (>=10% participation), which is the "
                "case for a sole shareholder."
            ),
        }

    def _tool_invoice_summary(year=None):
        """Summary of invoices: counts, totals, paid status by year."""
        sql = ("SELECT year, COUNT(*) as count, SUM(total) as total, "
               "SUM(CASE WHEN paid_status='paid' THEN total ELSE 0 END) as paid "
               "FROM invoices WHERE hours>0")
        args = []
        if year:
            sql += " AND year=?"; args.append(year)
        sql += " GROUP BY year ORDER BY year DESC"
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {"rows": rows}

    def _tool_budget_balances():
        """Current balances of all sinking-fund reserves."""
        with get_db() as db:
            rows = db.execute(
                "SELECT subcategory, grp, budgeted, balance FROM budget_items "
                "ORDER BY grp, sort_order"
            ).fetchall()
        return {"items": [dict(r) for r in rows]}

    def _tool_payslip_summary(year=None):
        """Payslip totals by year."""
        sql = ("SELECT year, COUNT(*) as count, SUM(gross) as gross, "
               "SUM(net_salary) as net, SUM(total_employer_cost) as employer_cost "
               "FROM payslips")
        args = []
        if year:
            sql += " WHERE year=?"; args.append(year)
        sql += " GROUP BY year"
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
        return {"rows": rows}

    def _tool_search_transfers(direction=None, year=None, limit=50):
        """Search Personal ↔ GmbH transfers (balance-sheet moves, not income)."""
        sql = ("SELECT transfer_date, direction, amount, currency, description "
               "FROM account_transfers WHERE 1=1")
        args = []
        if direction in ("personal_to_gmbh", "gmbh_to_personal"):
            sql += " AND direction=?"; args.append(direction)
        if year:
            sql += " AND substr(transfer_date,1,4)=?"; args.append(str(year))
        sql += " ORDER BY transfer_date DESC LIMIT ?"; args.append(min(int(limit), 200))
        with get_db() as db:
            rows = [dict(r) for r in db.execute(sql, args).fetchall()]
            # Also compute the net balance for context
            bal_rows = db.execute(
                "SELECT direction, COALESCE(SUM(amount),0) as total "
                "FROM account_transfers GROUP BY direction"
            ).fetchall()
        to_gmbh    = next((r["total"] for r in bal_rows if r["direction"] == "personal_to_gmbh"), 0)
        to_personal = next((r["total"] for r in bal_rows if r["direction"] == "gmbh_to_personal"), 0)
        return {
            "count":                  len(rows),
            "total_chf_in_query":     round(sum(r["amount"] for r in rows), 2),
            "net_owed_to_personal":   round(to_gmbh - to_personal, 2),
            "lifetime_personal_to_gmbh": to_gmbh,
            "lifetime_gmbh_to_personal": to_personal,
            "rows":                   rows,
        }

    # ─── Write tools (propose-only — actual mutation needs UI confirmation) ──
    #
    # The model NEVER mutates the DB directly. Instead it returns a "_proposal"
    # dict — the frontend renders an Apply / Discard card and only applies on
    # explicit user click via existing PATCH endpoints.

    _ACTIONS = {
        # action_key:                (table,          PATCH endpoint template,         payload,            human label)
        "mark_invoice_paid":       ("invoices",      "/api/invoices/{id}/status",      {"status": "paid"},   "Mark invoice as PAID"),
        "mark_invoice_unpaid":     ("invoices",      "/api/invoices/{id}/status",      {"status": "unpaid"}, "Mark invoice as UNPAID"),
        "mark_bill_paid":          ("company_docs",  "/api/accounting/{id}/status",    {"status": "paid"},   "Mark bill as PAID"),
        "mark_bill_unpaid":        ("company_docs",  "/api/accounting/{id}/status",    {"status": "unpaid"}, "Mark bill as UNPAID"),
        "mark_obligation_paid":    ("obligations",   "/api/obligations/{id}/status",   {"status": "paid"},   "Mark obligation as PAID"),
        "mark_obligation_unpaid":  ("obligations",   "/api/obligations/{id}/status",   {"status": "unpaid"}, "Mark obligation as UNPAID"),
    }

    # ─── Create proposals ───────────────────────────────────────────────────
    # These tools build a `_proposal` for a NEW record (expense, bill, etc.).
    # They never mutate the DB; the chat UI displays an Apply/Discard card and
    # the user clicks Apply to actually POST. Safe pattern for any model size.

    _EXPENSE_CATEGORIES = {"Meals", "Transport", "Accommodation", "Fuel",
                            "Connectivity", "Other"}
    _BILL_CATEGORIES = {"Office Supplies", "Software/Subscriptions",
                         "Professional Services", "Insurance",
                         "Payroll Settlement", "Rent", "Telecom", "Legal",
                         "Bank Fees", "Other"}

    def _validate_iso_date(s, field="date"):
        if not s:
            return None, f"{field} is required (YYYY-MM-DD)"
        try:
            datetime.strptime(s, "%Y-%m-%d")
            return s, None
        except (ValueError, TypeError):
            return None, f"{field} must be YYYY-MM-DD, got {s!r}"

    def _validate_amount(amount, field="amount"):
        if amount is None:
            return None, f"{field} is required"
        try:
            v = float(amount)
            if v <= 0:
                return None, f"{field} must be positive, got {v}"
            return v, None
        except (ValueError, TypeError):
            return None, f"{field} must be a number, got {amount!r}"

    def _tool_propose_add_expense(expense_date=None, description=None,
                                    amount=None, category=None):
        """Propose adding a new travel expense (employee reimbursement claim).

        Returns a `_proposal` that the chat UI renders as an Apply/Discard card.
        Use whenever the user says things like 'add an expense', 'I spent CHF X on Y'.
        """
        # Validate
        date_v, err = _validate_iso_date(expense_date, "expense_date")
        if err: return {"error": err}
        amount_v, err = _validate_amount(amount, "amount")
        if err: return {"error": err}
        if not description:
            return {"error": "description is required"}
        cat = (category or "").strip() or "Other"
        if cat not in _EXPENSE_CATEGORIES:
            return {"error": f"category must be one of {sorted(_EXPENSE_CATEGORIES)}, got {cat!r}"}

        return {
            "_proposal": {
                "action":      "add_expense",
                "label":       f"Add expense — {description[:50]}",
                "endpoint":    "/api/expenses",
                "method":      "POST",
                "format":      "form",  # uses FormData rather than JSON
                "payload":     {
                    "expense_date": date_v,
                    "description":  description,
                    "amount":       str(amount_v),
                    "category":     cat,
                },
                "description": f"{date_v} · CHF {amount_v:.2f} · [{cat}] · {description}",
            }
        }

    def _tool_propose_add_bill(doc_date=None, vendor=None, description=None,
                                 amount=None, category=None, due_date=None,
                                 recurrence="none", currency="CHF"):
        """Propose adding a new company bill (recurring or one-off).

        Returns a `_proposal` the chat UI renders as Apply/Discard. Use when the
        user mentions a vendor charge, subscription, invoice received, etc.
        """
        date_v, err = _validate_iso_date(doc_date, "doc_date")
        if err: return {"error": err}
        amount_v, err = _validate_amount(amount, "amount")
        if err: return {"error": err}
        if not vendor:
            return {"error": "vendor is required"}
        if not description:
            return {"error": "description is required"}
        cat = (category or "").strip() or "Other"
        if cat not in _BILL_CATEGORIES:
            return {"error": f"category must be one of {sorted(_BILL_CATEGORIES)}, got {cat!r}"}
        rec = (recurrence or "none").lower()
        if rec not in ("none", "monthly", "yearly"):
            return {"error": f"recurrence must be one of none/monthly/yearly, got {rec!r}"}
        due_v = None
        if due_date:
            due_v, err = _validate_iso_date(due_date, "due_date")
            if err: return {"error": err}

        payload = {
            "doc_date":    date_v,
            "vendor":      vendor,
            "description": description,
            "amount":      str(amount_v),
            "currency":    currency,
            "category":    cat,
            "recurrence":  rec,
            "status":      "unpaid",
        }
        if due_v:
            payload["due_date"] = due_v

        return {
            "_proposal": {
                "action":      "add_bill",
                "label":       f"Add bill — {vendor} CHF {amount_v:.2f}",
                "endpoint":    "/api/accounting",
                "method":      "POST",
                "format":      "form",
                "payload":     payload,
                "description": (f"{date_v} · {vendor} · CHF {amount_v:.2f} · [{cat}]"
                                f"{' · ' + rec if rec != 'none' else ''}"
                                f"{' · due ' + due_v if due_v else ''}"
                                f" · {description}"),
            }
        }

    def _tool_propose_mark_invoice_paid(invoice_id=None, paid_date=None):
        """Propose marking a specific invoice as PAID (with the cash receipt date).

        Different from `propose_action`: this one accepts a paid_date so the cash
        flow timeline can plot the receipt correctly. Use when the user says
        'invoice X just got paid' or similar.
        """
        if invoice_id is None:
            return {"error": "invoice_id is required"}
        try:
            inv_id = int(invoice_id)
        except (ValueError, TypeError):
            return {"error": f"invoice_id must be an integer, got {invoice_id!r}"}
        paid_v = None
        if paid_date:
            paid_v, err = _validate_iso_date(paid_date, "paid_date")
            if err: return {"error": err}

        # Look up the invoice for the description
        with get_db() as db:
            row = db.execute(
                "SELECT invoice_number, year, month, total, paid_status "
                "FROM invoices WHERE id=?", (inv_id,)
            ).fetchone()
            if not row:
                return {"error": f"Invoice id={inv_id} not found"}
            if row["paid_status"] == "paid":
                return {"error": f"Invoice #{row['invoice_number']:04d} is already paid"}

        payload = {"status": "paid"}
        if paid_v:
            payload["paid_date"] = paid_v

        return {
            "_proposal": {
                "action":      "mark_invoice_paid",
                "label":       f"Mark Invoice #{row['invoice_number']:04d} as PAID",
                "endpoint":    f"/api/invoices/{inv_id}/status",
                "method":      "PATCH",
                "format":      "json",
                "payload":     payload,
                "description": (f"Invoice #{row['invoice_number']:04d} · "
                                f"{row['year']}-{row['month']:02d} · "
                                f"CHF {row['total']:.2f}"
                                f"{' · paid on ' + paid_v if paid_v else ''}"),
            }
        }

    def _tool_propose_action(action=None, target_id=None):
        """Propose a state change for the user to confirm. Does NOT mutate.
        Returns a `_proposal` dict that the chat UI turns into Apply/Discard."""
        if action not in _ACTIONS:
            return {"error": f"Unknown action: {action!r}. Allowed: {sorted(_ACTIONS)}"}
        if target_id is None:
            return {"error": "target_id is required"}
        try:
            target_id = int(target_id)
        except (ValueError, TypeError):
            return {"error": f"target_id must be an integer, got {target_id!r}"}

        table, endpoint_tmpl, payload, label = _ACTIONS[action]
        with get_db() as db:
            row = db.execute(f"SELECT * FROM {table} WHERE id=?", (target_id,)).fetchone()
            if not row:
                return {"error": f"#{target_id} not found in {table}"}
            current = dict(row)

        # Build a short human description with the most identifying fields
        if table == "invoices":
            desc = f"Invoice #{current.get('invoice_number'):04d} — {current.get('year')}-{current.get('month'):02d} — CHF {current.get('total'):.2f} — currently {current.get('paid_status') or 'unpaid'}"
        elif table == "company_docs":
            desc = f"{current.get('vendor')} — {current.get('description')} — CHF {current.get('amount'):.2f} on {current.get('doc_date')} — currently {current.get('status')}"
        else:  # obligations
            desc = f"{current.get('obligation_type')} {current.get('period_label')} — CHF {current.get('amount'):.2f} due {current.get('due_date')} — currently {current.get('status')}"

        return {
            "_proposal": {
                "action":       action,
                "label":        label,
                "target_id":    target_id,
                "endpoint":     endpoint_tmpl.replace("{id}", str(target_id)),
                "method":       "PATCH",
                "payload":      payload,
                "description":  desc,
            }
        }

    return {
        "search_bills": {
            "fn": _tool_search_bills,
            "desc": "Search company bills (incoming bills of the GmbH). paid_via says who "
                    "fronted the money: 'personal' = owner's personal card (GmbH owes it back).",
            "params": {
                "year": "int (optional) — filter to a specific year",
                "vendor": "string (optional) — partial vendor name match",
                "category": "string (optional) — exact category",
                "status": "string (optional) — 'paid' or 'unpaid'",
                "paid_via": "string (optional) — 'company' or 'personal' (paid with owner's personal card)",
                "limit": "int (optional, default 50) — max rows",
            },
        },
        "search_expenses": {
            "fn": _tool_search_expenses,
            "desc": "Search travel expenses (REIMBURSABLE — billed to clients separately).",
            "params": {
                "year": "int (optional)",
                "category": "string (optional) — Meals, Transport, Accommodation, Other",
                "limit": "int (optional, default 50)",
            },
        },
        "list_obligations": {
            "fn": _tool_list_obligations,
            "desc": "List GmbH obligations to authorities/insurers (AHV, BVG, taxes, KTG, UVG).",
            "params": {
                "status": "string (optional) — 'paid' or 'unpaid'",
                "year": "int (optional)",
            },
        },
        "get_runway": {
            "fn": _tool_get_runway,
            "desc": "Current cash balance, monthly burn rate, and runway in months.",
            "params": {},
        },
        "top_vendors": {
            "fn": _tool_top_vendors,
            "desc": "Top vendors by total bill amount.",
            "params": {
                "year": "int (optional)",
                "limit": "int (optional, default 10)",
            },
        },
        "dashboard_summary": {
            "fn": _tool_dashboard_summary,
            "desc": ("Full GmbH dashboard overview YTD on BOTH cash AND accrual basis. "
                     "Cash = paid invoices only (liquidity). "
                     "Accrual = all issued invoices vs all incurred costs (legal P&L). "
                     "Use accrual for OR 725a, equity tests, dividend capacity. "
                     "Receivables outstanding is the gap between the two."),
            "params": {},
        },
        "invoice_summary": {
            "fn": _tool_invoice_summary,
            "desc": "Invoice totals by year (count, total, paid amount).",
            "params": {"year": "int (optional)"},
        },
        "receivables_summary": {
            "fn": _tool_receivables_summary,
            "desc": ("List every unpaid invoice with ageing. Use whenever asked about "
                     "money owed to the GmbH, outstanding receivables, or late payers. "
                     "Returns total CHF outstanding + per-invoice details."),
            "params": {},
        },
        "dividend_capacity": {
            "fn": _tool_dividend_capacity,
            "desc": ("Compute distributable profit for an interim dividend today, plus "
                     "Swiss tax math (Verrechnungssteuer 35% + Teilbesteuerung). Uses "
                     "ACCRUAL P&L. Returns 0 if currently in loss. Use whenever the "
                     "user asks about dividends, distributions, or paying themselves."),
            "params": {},
        },
        "budget_balances": {
            "fn": _tool_budget_balances,
            "desc": "Current balance of every sinking-fund reserve (Car, Wine, Mariage, etc.).",
            "params": {},
        },
        "payslip_summary": {
            "fn": _tool_payslip_summary,
            "desc": "Payslip totals by year (gross, net, employer cost).",
            "params": {"year": "int (optional)"},
        },
        "search_transfers": {
            "fn": _tool_search_transfers,
            "desc": ("List Personal ↔ GmbH account transfers (balance-sheet moves, NOT salary, "
                     "income, or dividends). Always returns the lifetime net owed to personal."),
            "params": {
                "direction": "string (optional) — 'personal_to_gmbh' or 'gmbh_to_personal'",
                "year":      "int (optional) — filter to a specific year",
                "limit":     "int (optional, default 50) — max rows",
            },
        },
        "propose_action": {
            "fn": _tool_propose_action,
            "desc": (
                "Propose a state change. Use ONLY when the user explicitly asks to mark something paid/unpaid. "
                "The change is NOT applied — the user must click Apply in the UI. "
                "If the user asks to find an item without changing it, use search_bills / list_obligations / invoice_summary instead."
            ),
            "params": {
                "action":    "string — one of: mark_invoice_paid, mark_invoice_unpaid, mark_bill_paid, mark_bill_unpaid, mark_obligation_paid, mark_obligation_unpaid",
                "target_id": "int — the row id (invoice id, bill id, or obligation id)",
            },
        },
        "propose_add_expense": {
            "fn": _tool_propose_add_expense,
            "desc": ("Propose adding a new travel expense (employee reimbursement). "
                     "The expense is NOT created — user clicks Apply to confirm. "
                     "Use when user says things like 'I spent CHF X on Y' or 'add an expense for...'"),
            "params": {
                "expense_date": "string YYYY-MM-DD",
                "description":  "string — what was bought (vendor + item)",
                "amount":       "number — CHF amount",
                "category":     "string — Meals, Transport, Accommodation, Fuel, Connectivity, or Other",
            },
        },
        "propose_add_bill": {
            "fn": _tool_propose_add_bill,
            "desc": ("Propose adding a new company bill / recurring charge. "
                     "Use when user mentions receiving an invoice from a vendor, a new subscription, etc. "
                     "NOT applied until user clicks Apply."),
            "params": {
                "doc_date":    "string YYYY-MM-DD",
                "vendor":      "string — vendor name",
                "description": "string — what the bill is for",
                "amount":      "number — CHF amount",
                "category":    "string — one of the bill categories (Software/Subscriptions, Insurance, etc.)",
                "due_date":    "string YYYY-MM-DD (optional)",
                "recurrence":  "string — none/monthly/yearly (default none)",
                "currency":    "string — 3-letter ISO (default CHF)",
            },
        },
        "propose_mark_invoice_paid": {
            "fn": _tool_propose_mark_invoice_paid,
            "desc": ("Propose marking a specific invoice as PAID with the cash receipt date. "
                     "Use when user says 'invoice X was paid on Y'. Includes paid_date so the "
                     "cash-flow timeline plots the receipt correctly."),
            "params": {
                "invoice_id": "int — the invoice id (NOT the invoice_number)",
                "paid_date":  "string YYYY-MM-DD (optional)",
            },
        },
    }


def build_tools_prompt(tools_dict):
    """Build the tools description for the LLM system prompt."""
    lines = ["Available tools (you MUST pick exactly one to answer the question):"]
    for name, t in tools_dict.items():
        params_str = ", ".join(f"{k}: {v}" for k, v in t["params"].items()) if t["params"] else "no params"
        lines.append(f"- {name}({params_str}) — {t['desc']}")
    return "\n".join(lines)
