"""Global search across invoices, bills, expenses, obligations, transfers.

Extracted from routes/finance.py — same /search URL and query language
(amount / date shortcuts / quoted phrases / type filters, AND-combined).
Mounted at /api/* by app.py.
"""

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Query

from db import get_db

router = APIRouter(tags=["search"])

# ─── Global Search ──────────────────────────────────────────────────────────
#
# Supports a small query language so the user can search by amount, date,
# and free text in one input. All tokens combine with AND:
#
#   acme 1500         → text "acme" AND amount ≈ 1500 (±5 %)
#   >1000 april        → amount > 1000 AND date in April (current year)
#   1000-2000          → amount between 1000 and 2000
#   treuhand 2026-04   → text "treuhand" AND date in April 2026
#   bvg q2 2026        → text "bvg" AND date in Q2 2026
#   <500 paid          → amount < 500 AND text "paid"
#
# Tokens recognised:
#   number              → exact amount (±5 % tolerance)
#   >N / <N             → amount comparator
#   N-M                 → amount range
#   YYYY-MM-DD          → exact date
#   YYYY-MM             → that month
#   YYYY (1900–2100)    → that year
#   <month name>        → that month, current year (combined with a year token if present)
#   q1 / q2 / q3 / q4   → that quarter, current year
#   anything else       → text (AND-joined substring match)

import html as _html
import re as _re
import shlex as _shlex

_MONTH_NAMES_LOWER = {n.lower(): i for i, n in enumerate(calendar.month_name) if n}
_MONTH_ABBR_LOWER  = {n.lower(): i for i, n in enumerate(calendar.month_abbr) if n}
# French + German for the Swiss context
_MONTH_FR = {"janvier":1,"février":2,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,
             "juillet":7,"août":8,"aout":8,"septembre":9,"octobre":10,"novembre":11,"décembre":12,"decembre":12}
_MONTH_DE = {"januar":1,"februar":2,"märz":3,"maerz":3,"april":4,"mai":5,"juni":6,
             "juli":7,"august":8,"september":9,"oktober":10,"november":11,"dezember":12}

_STATUS_KEYWORDS = {"paid", "unpaid", "overdue"}

# Aliases for type:/in: narrowing — also accepts the entity name as-is
_TYPE_ALIASES = {
    "invoice":"invoice","invoices":"invoice","inv":"invoice",
    "bill":"bill","bills":"bill","doc":"bill","docs":"bill",
    "expense":"expense","expenses":"expense","exp":"expense","travel":"expense",
    "customer":"customer","customers":"customer","client":"customer","clients":"customer",
    "obligation":"obligation","obligations":"obligation","ahv":"obligation","bvg":"obligation","tax":"obligation","vat":"obligation",
    "income":"income","incomes":"income",
    "transfer":"transfer","transfers":"transfer",
    "payslip":"payslip","payslips":"payslip","salary":"payslip","payroll":"payslip",
    "budget":"budget","reserve":"budget",
}


def _resolve_date_shortcut(q: str) -> tuple[str, dict | None]:
    """Strip a natural-language date phrase from q and return (cleaned_q, date_dict)."""
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)
    last_week_end   = week_start - timedelta(days=1)
    month_start = today.replace(day=1)
    if today.month == 1:
        last_month_end = today.replace(year=today.year-1, month=12, day=31)
    else:
        last_month_end = today.replace(day=1) - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    year_start = date(today.year, 1, 1)
    last_year_start = date(today.year-1, 1, 1)
    last_year_end   = date(today.year-1, 12, 31)
    # Longest phrases first so "last 30 days" wins over "last"
    shortcuts = [
        ("last 7 days",   today - timedelta(days=7),   today),
        ("last 30 days",  today - timedelta(days=30),  today),
        ("last 90 days",  today - timedelta(days=90),  today),
        ("last 12 months",today - timedelta(days=365), today),
        ("last week",     last_week_start,             last_week_end),
        ("last month",    last_month_start,            last_month_end),
        ("last year",     last_year_start,             last_year_end),
        ("this week",     week_start,                  today),
        ("this month",    month_start,                 today),
        ("this year",     year_start,                  today),
        ("yesterday",     today - timedelta(days=1),   today - timedelta(days=1)),
        ("today",         today,                       today),
        ("ytd",           year_start,                  today),
    ]
    q_lower = q.lower()
    for phrase, start, end in shortcuts:
        # Match as a whole-token sequence
        idx = q_lower.find(phrase)
        if idx == -1:
            continue
        # Boundary check: surrounding chars must be whitespace or string edge
        before_ok = idx == 0 or not q_lower[idx-1].isalnum()
        after_idx = idx + len(phrase)
        after_ok = after_idx == len(q_lower) or not q_lower[after_idx].isalnum()
        if not (before_ok and after_ok):
            continue
        cleaned = (q[:idx] + q[after_idx:]).strip()
        # Collapse any double spaces left behind
        cleaned = _re.sub(r"\s+", " ", cleaned)
        return cleaned, {
            "start": str(start),
            "end":   str(end),
            "label": phrase,
        }
    return q, None


def _highlight(text: str | None, tokens: list[str]) -> str:
    """HTML-safe highlighting: escape text first, then wrap matched tokens
    in <mark>. Skips tokens that contain HTML-special chars so the escaping
    stays unambiguous."""
    if not text:
        return ""
    safe = _html.escape(str(text))
    for tok in tokens:
        if not tok or any(c in tok for c in "<>&\"'"):
            continue
        pattern = _re.compile(f"({_re.escape(tok)})", _re.IGNORECASE)
        safe = pattern.sub(r"<mark>\1</mark>", safe)
    return safe


def _parse_search_query(q: str) -> dict:
    """Parse 'acme 1500 "net salary" type:bill paid' into a structured filter set."""
    f = {
        "text":          [],
        "amount_min":    None,
        "amount_max":    None,
        "amount_exact":  None,
        "date_exact":    None,
        "date_prefix":   None,
        "date_start":    None,   # inclusive range start (YYYY-MM-DD)
        "date_end":      None,   # inclusive range end
        "date_label":    None,   # human label like "last month"
        "only_types":    set(),  # restrict result categories
        "status":        None,   # 'paid' | 'unpaid' | 'overdue'
    }

    # First: strip natural-language date shortcuts ("last month", "ytd", etc.)
    q, date_shortcut = _resolve_date_shortcut(q)
    if date_shortcut:
        f["date_start"] = date_shortcut["start"]
        f["date_end"]   = date_shortcut["end"]
        f["date_label"] = date_shortcut["label"]

    parsed_year  = None
    parsed_month = None
    parsed_quarter = None
    # shlex respects quoted phrases: `"net salary" acme` → ['net salary', 'acme']
    try:
        raw_tokens = _shlex.split(q)
    except ValueError:
        # Unbalanced quote — fall back to simple split
        raw_tokens = q.split()

    for tok in raw_tokens:
        lower = tok.lower()

        # type:bill / in:invoices — narrow which entity types appear in results
        m = _re.match(r"^(type|in):(\w+)$", lower)
        if m and m.group(2) in _TYPE_ALIASES:
            f["only_types"].add(_TYPE_ALIASES[m.group(2)])
            continue
        # paid / unpaid / overdue — status filter (standalone token only)
        if lower in _STATUS_KEYWORDS:
            f["status"] = lower
            continue

        # ISO date YYYY-MM-DD  (must come BEFORE amount-range, which would otherwise eat YYYY-MM)
        m = _re.match(r"^(\d{4})-(\d{2})-(\d{2})$", tok)
        if m:
            f["date_exact"] = tok
            parsed_year = int(m.group(1)); parsed_month = int(m.group(2))
            continue
        # ISO month YYYY-MM
        m = _re.match(r"^(\d{4})-(\d{1,2})$", tok)
        if m and 1900 <= int(m.group(1)) <= 2100 and 1 <= int(m.group(2)) <= 12:
            parsed_year = int(m.group(1)); parsed_month = int(m.group(2))
            continue
        # Amount range: 1000-2000  (after date regexes so YYYY-MM doesn't get eaten)
        m = _re.match(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$", tok)
        if m:
            f["amount_min"] = float(m.group(1))
            f["amount_max"] = float(m.group(2))
            continue
        # Amount > N
        m = _re.match(r"^>(\d+(?:\.\d+)?)$", tok)
        if m:
            f["amount_min"] = float(m.group(1)); continue
        # Amount < N
        m = _re.match(r"^<(\d+(?:\.\d+)?)$", tok)
        if m:
            f["amount_max"] = float(m.group(1)); continue
        # Q1..Q4
        m = _re.match(r"^q([1-4])$", lower)
        if m:
            parsed_quarter = int(m.group(1)); continue
        # Pure number → year vs amount (+ remember the raw int for invoice-#
        # matching: the user typing `24` probably means invoice #0024, not
        # "amount ≈ 24 CHF")
        m = _re.match(r"^(\d+(?:\.\d+)?)$", tok)
        if m:
            num = float(m.group(1))
            # 4-digit integers in the plausible year range → year
            if num.is_integer() and 1900 <= num <= 2100 and "." not in tok:
                parsed_year = int(num)
            else:
                f["amount_exact"] = num
                if num.is_integer() and "." not in tok:
                    f.setdefault("numeric_int_tokens", []).append(tok)
            continue
        # Month names (English / French / German + abbreviations)
        for tbl in (_MONTH_NAMES_LOWER, _MONTH_ABBR_LOWER, _MONTH_FR, _MONTH_DE):
            if lower in tbl:
                parsed_month = tbl[lower]
                break
        else:
            # Fell through → free text
            f["text"].append(tok)
            continue

    # Combine the date pieces
    today = date.today()
    if parsed_year and parsed_month and not f["date_exact"]:
        f["date_prefix"] = f"{parsed_year:04d}-{parsed_month:02d}"
    elif parsed_month and not f["date_exact"]:
        f["date_prefix"] = f"{today.year:04d}-{parsed_month:02d}"
    elif parsed_year and not f["date_exact"]:
        f["date_prefix"] = f"{parsed_year:04d}"
    if parsed_quarter:
        y = parsed_year or today.year
        # Encode quarter as multiple prefixes — the SQL helper handles a list
        m1 = (parsed_quarter - 1) * 3 + 1
        f["date_quarter"] = [f"{y:04d}-{m1:02d}",
                             f"{y:04d}-{m1+1:02d}",
                             f"{y:04d}-{m1+2:02d}"]
    # If user typed a status keyword and didn't pin a type, only consider
    # tables that actually have a status field. Otherwise `unpaid` would
    # return random rows from expense/income/transfer too.
    if f["status"] and not f["only_types"]:
        f["only_types"] = {"invoice", "bill", "obligation", "payslip"}
    return f


def _amount_clause(col: str, f: dict) -> tuple[str, list]:
    """SQL fragment + args for the amount filter on a column."""
    parts, args = [], []
    if f["amount_exact"] is not None:
        # ±5% tolerance, with a minimum of CHF 0.50 for tiny numbers
        tol = max(f["amount_exact"] * 0.05, 0.5)
        parts.append(f"ABS({col} - ?) <= ?"); args.extend([f["amount_exact"], tol])
    if f["amount_min"] is not None:
        parts.append(f"{col} >= ?"); args.append(f["amount_min"])
    if f["amount_max"] is not None:
        parts.append(f"{col} <= ?"); args.append(f["amount_max"])
    return (" AND ".join(parts), args)


def _date_clause(col: str, f: dict) -> tuple[str, list]:
    """SQL fragment + args for the date filter on a date-typed column."""
    parts, args = [], []
    if f["date_exact"]:
        parts.append(f"{col} = ?"); args.append(f["date_exact"])
    elif f.get("date_start") and f.get("date_end"):
        # Range from a shortcut like "last month" / "ytd"
        parts.append(f"{col} BETWEEN ? AND ?")
        args.extend([f["date_start"], f["date_end"]])
    elif f["date_prefix"]:
        parts.append(f"{col} LIKE ?"); args.append(f["date_prefix"] + "%")
    if f.get("date_quarter"):
        prefixes = f["date_quarter"]
        parts.append("(" + " OR ".join(f"{col} LIKE ?" for _ in prefixes) + ")")
        args.extend(p + "%" for p in prefixes)
    return (" AND ".join(parts), args)


def _text_clause(cols: list, f: dict) -> tuple[str, list]:
    """SQL fragment + args for text tokens — each token must match SOMETHING."""
    parts, args = [], []
    for tok in f["text"]:
        like = f"%{tok.lower()}%"
        parts.append("(" + " OR ".join(f"LOWER(COALESCE({c},'')) LIKE ?" for c in cols) + ")")
        args.extend([like] * len(cols))
    return (" AND ".join(parts), args)


def _glue(*chunks: tuple[str, list]) -> tuple[str, list]:
    """Combine multiple (sql, args) fragments with AND; skip empty fragments."""
    parts, args = [], []
    for sql, a in chunks:
        if sql:
            parts.append(sql)
            args.extend(a)
    return (" AND ".join(parts) if parts else "1=1", args)


@router.get("/search")
async def global_search(q: str, limit: int = Query(10, ge=1, le=1000)):
    """Search across entities. `limit` caps invoices/bills (page search bars
    pass a high limit to filter a whole table); other kinds stay at 10."""
    if len(q.strip()) < 2:
        return {"results": [], "parsed": None}
    f = _parse_search_query(q)
    text_tokens = f["text"]

    def include(type_name: str) -> bool:
        return not f["only_types"] or type_name in f["only_types"]

    def status_filter(col: str, due_col: str | None = None) -> tuple[str, list]:
        """Translate the parsed status keyword into an SQL fragment."""
        s = f["status"]
        if not s:
            return "", []
        if s == "overdue" and due_col:
            return f"({col} = 'unpaid' AND {due_col} < date('now'))", []
        return (f"{col} = ?", [s])

    def hl(t):
        return _highlight(t, text_tokens)

    results = []
    with get_db() as db:
        # Invoices: only by amount/date — invoice_number remains substring-matchable as text
        # ─── Invoices ─────────────────────────────────────────────────
        if include("invoice"):
            # Free text matches against invoice notes
            text_sql, text_args = _text_clause(["notes"], f)
            # For numeric tokens, combine amount match with invoice_number match
            # using OR — so `24` finds invoice #0024 even though the amount
            # filter would only match a CHF 24 invoice.
            amount_sql, amount_args = _amount_clause("total", f)
            num_int_tokens = f.get("numeric_int_tokens") or []
            num_or_parts, num_or_args = [], []
            if amount_sql:
                num_or_parts.append(amount_sql); num_or_args.extend(amount_args)
            if num_int_tokens:
                # Match either the padded or the un-padded form: typing "0024" or
                # "24" both find invoice #24 (stored as integer in the DB).
                normalised = [str(int(n)) for n in num_int_tokens]
                nsql = "(" + " OR ".join("CAST(invoice_number AS TEXT) LIKE ?" for _ in normalised) + ")"
                num_or_parts.append(nsql)
                num_or_args.extend(f"%{n}%" for n in normalised)
            num_sql = "(" + " OR ".join(num_or_parts) + ")" if num_or_parts else ""
            # Map date filters to year+month columns
            period_pieces, period_args = [], []
            if f["date_exact"]:
                y, m, _ = f["date_exact"].split("-")
                period_pieces.append("year = ? AND month = ?"); period_args.extend([int(y), int(m)])
            elif f.get("date_start") and f.get("date_end"):
                # Range — convert to year*12+month bounds
                ys, ms, _ = f["date_start"].split("-")
                ye, me, _ = f["date_end"].split("-")
                period_pieces.append("(year * 12 + month) BETWEEN ? AND ?")
                period_args.extend([int(ys)*12 + int(ms), int(ye)*12 + int(me)])
            elif f["date_prefix"]:
                parts = f["date_prefix"].split("-")
                if len(parts) == 2:
                    period_pieces.append("year = ? AND month = ?"); period_args.extend([int(parts[0]), int(parts[1])])
                else:
                    period_pieces.append("year = ?"); period_args.append(int(parts[0]))
            if f.get("date_quarter"):
                qs = []
                for px in f["date_quarter"]:
                    yy, mm = px.split("-")
                    qs.append("(year = ? AND month = ?)"); period_args.extend([int(yy), int(mm)])
                period_pieces.append("(" + " OR ".join(qs) + ")")
            period_sql = " AND ".join(period_pieces)
            status_sql, status_args = ("", [])
            if f["status"] == "paid":
                status_sql, status_args = "paid_status = 'paid'", []
            elif f["status"] == "unpaid":
                status_sql, status_args = "(paid_status IS NULL OR paid_status = 'unpaid')", []
            elif f["status"] == "overdue":
                status_sql, status_args = "(paid_status IS NULL OR paid_status = 'unpaid') AND due_date < date('now')", []
            where, args = _glue(("hours > 0", []),
                                (text_sql, text_args),
                                (num_sql, num_or_args),
                                (period_sql, period_args),
                                (status_sql, status_args))
            for r in db.execute(
                f"SELECT id, invoice_number, year, month, total, paid_status FROM invoices "
                f"WHERE {where} ORDER BY year DESC, month DESC LIMIT {int(limit)}",
                args,
            ).fetchall():
                paid = (r["paid_status"] or "unpaid")
                title = f"Invoice #{r['invoice_number']:04d}"
                sub   = f"{calendar.month_name[r['month']]} {r['year']} · CHF {r['total']:,.2f} · {paid}"
                results.append({
                    "type": "invoice", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "invoices",
                })

        # ─── Bills ────────────────────────────────────────────────────
        if include("bill"):
            status_sql, status_args = status_filter("status", "due_date")
            where, args = _glue(_text_clause(["vendor", "description", "category"], f),
                                _amount_clause("amount", f),
                                _date_clause("doc_date", f),
                                (status_sql, status_args))
            for r in db.execute(
                f"SELECT * FROM company_docs WHERE {where} ORDER BY doc_date DESC LIMIT {int(limit)}",
                args,
            ).fetchall():
                title = r["vendor"]
                sub   = f"{r['description']} · {r['currency']} {r['amount']:,.2f} · {r['status']}"
                results.append({
                    "type": "bill", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "accounting",
                })

        # ─── Travel expenses ─────────────────────────────────────────
        if include("expense"):
            where, args = _glue(_text_clause(["description", "category"], f),
                                _amount_clause("amount", f),
                                _date_clause("expense_date", f))
            for r in db.execute(
                f"SELECT * FROM expenses WHERE {where} ORDER BY expense_date DESC LIMIT 10",
                args,
            ).fetchall():
                title = r["description"]
                sub   = f"{r['expense_date']} · CHF {r['amount']:,.2f} · {r['category']}"
                results.append({
                    "type": "expense", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "expenses",
                })

        # ─── Customers (text-only — no amount/date filter possible) ─
        if include("customer") and text_tokens and not (
            f["amount_exact"] or f["amount_min"] or f["amount_max"]
            or f["date_exact"] or f["date_prefix"] or f.get("date_start")
        ):
            where, args = _text_clause(["name", "email"], f)
            for r in db.execute(
                f"SELECT * FROM customers WHERE {where} LIMIT 5", args,
            ).fetchall():
                title = r["name"]; sub = r["email"] or ""
                results.append({
                    "type": "customer", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "customers",
                })

        # ─── Obligations ─────────────────────────────────────────────
        if include("obligation"):
            status_sql, status_args = status_filter("status", "due_date")
            where, args = _glue(_text_clause(["obligation_type", "period_label", "notes"], f),
                                _amount_clause("amount", f),
                                _date_clause("due_date", f),
                                (status_sql, status_args))
            for r in db.execute(
                f"SELECT * FROM obligations WHERE {where} ORDER BY due_date DESC LIMIT 10",
                args,
            ).fetchall():
                title = f"{r['obligation_type']} — {r['period_label'] or ''}".rstrip(' —')
                sub   = f"CHF {r['amount']:,.2f} · due {r['due_date'] or '—'} · {r['status']}"
                results.append({
                    "type": "obligation", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "obligations",
                })

        # ─── Income ──────────────────────────────────────────────────
        if include("income"):
            where, args = _glue(_text_clause(["source", "description", "category"], f),
                                _amount_clause("amount", f),
                                _date_clause("income_date", f))
            for r in db.execute(
                f"SELECT * FROM income_entries WHERE {where} ORDER BY income_date DESC LIMIT 10",
                args,
            ).fetchall():
                title = r["source"]
                sub   = f"{r['income_date']} · CHF {r['amount']:,.2f} · {r['category']}"
                results.append({
                    "type": "income", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "income",
                })

        # ─── Transfers ───────────────────────────────────────────────
        if include("transfer"):
            where, args = _glue(_text_clause(["direction", "description"], f),
                                _amount_clause("amount", f),
                                _date_clause("transfer_date", f))
            for r in db.execute(
                f"SELECT * FROM account_transfers WHERE {where} ORDER BY transfer_date DESC LIMIT 10",
                args,
            ).fetchall():
                arrow = "→ GmbH" if r["direction"] == "personal_to_gmbh" else "→ Personal"
                title = f"Transfer {arrow}"
                sub   = f"{r['transfer_date']} · CHF {r['amount']:,.2f} · {r['description'] or ''}".rstrip(' ·')
                results.append({
                    "type": "transfer", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "bank",   # transfers merged into Bank Statements (owner ledger)
                })

        # ─── Payslips ────────────────────────────────────────────────
        if include("payslip"):
            psql = "SELECT * FROM payslips WHERE 1=1"
            pargs = []
            if f["amount_exact"] is not None:
                tol = max(f["amount_exact"] * 0.05, 0.5)
                psql += " AND ABS(net_salary - ?) <= ?"; pargs.extend([f["amount_exact"], tol])
            if f["amount_min"] is not None:
                psql += " AND net_salary >= ?"; pargs.append(f["amount_min"])
            if f["amount_max"] is not None:
                psql += " AND net_salary <= ?"; pargs.append(f["amount_max"])
            if f["date_exact"]:
                yy, mm, _ = f["date_exact"].split("-")
                psql += " AND year = ? AND month = ?"; pargs.extend([int(yy), int(mm)])
            elif f.get("date_start") and f.get("date_end"):
                ys, ms, _ = f["date_start"].split("-")
                ye, me, _ = f["date_end"].split("-")
                psql += " AND (year * 12 + month) BETWEEN ? AND ?"
                pargs.extend([int(ys)*12 + int(ms), int(ye)*12 + int(me)])
            elif f["date_prefix"]:
                parts = f["date_prefix"].split("-")
                if len(parts) == 2:
                    psql += " AND year = ? AND month = ?"; pargs.extend([int(parts[0]), int(parts[1])])
                else:
                    psql += " AND year = ?"; pargs.append(int(parts[0]))
            if f["status"] == "paid":
                psql += " AND status = 'paid'"
            elif f["status"] == "unpaid":
                psql += " AND (status IS NULL OR status != 'paid')"
            psql += " ORDER BY year DESC, month DESC LIMIT 5"
            for r in db.execute(psql, pargs).fetchall():
                label = f"{calendar.month_name[r['month']]} {r['year']}".lower()
                if text_tokens and not all(t.lower() in label or t.lower() in str(r["status"] or "").lower() for t in text_tokens):
                    continue
                title = f"Payslip {calendar.month_name[r['month']]} {r['year']}"
                sub   = f"Net CHF {r['net_salary']:,.2f} · {r['status']}"
                results.append({
                    "type": "payslip", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "payroll",
                })

        # ─── Budget items ────────────────────────────────────────────
        if include("budget"):
            bsql = "SELECT * FROM budget_items WHERE 1=1"
            bargs = []
            ttext, ttargs = _text_clause(["subcategory", "grp"], f)
            if ttext:
                bsql += " AND " + ttext; bargs.extend(ttargs)
            amt, amtargs = _amount_clause("budgeted", f)
            if amt:
                bsql += " AND " + amt; bargs.extend(amtargs)
            bsql += " ORDER BY grp, sort_order LIMIT 10"
            for r in db.execute(bsql, bargs).fetchall():
                title = r["subcategory"]
                sub   = f"{r['grp']} · budgeted CHF {r['budgeted']:,.2f} · balance CHF {(r['balance'] or 0):,.2f}"
                results.append({
                    "type": "budget", "id": r["id"],
                    "title": title, "subtitle": sub,
                    "title_html": hl(title), "subtitle_html": hl(sub),
                    "page": "balances",
                })

    # Human-readable summary of what was parsed (for the dropdown header chip)
    parsed_chips = []
    if f["text"]:
        parsed_chips.append({"kind": "text", "label": " ".join(f"\"{t}\"" if ' ' in t else t for t in f["text"])})
    if f["amount_exact"] is not None:
        parsed_chips.append({"kind": "amount", "label": f"≈ CHF {f['amount_exact']:,.0f} (±5 %)"})
    if f["amount_min"] is not None and f["amount_max"] is not None:
        parsed_chips.append({"kind": "amount", "label": f"CHF {f['amount_min']:,.0f} – {f['amount_max']:,.0f}"})
    elif f["amount_min"] is not None:
        parsed_chips.append({"kind": "amount", "label": f"> CHF {f['amount_min']:,.0f}"})
    elif f["amount_max"] is not None:
        parsed_chips.append({"kind": "amount", "label": f"< CHF {f['amount_max']:,.0f}"})
    if f["date_exact"]:
        parsed_chips.append({"kind": "date", "label": f["date_exact"]})
    elif f.get("date_label"):
        parsed_chips.append({"kind": "date", "label": f"{f['date_label']} ({f['date_start']} → {f['date_end']})"})
    elif f["date_prefix"]:
        parsed_chips.append({"kind": "date", "label": f["date_prefix"]})
    if f.get("date_quarter"):
        parsed_chips.append({"kind": "date", "label": "Quarter (" + " / ".join(f["date_quarter"]) + ")"})
    if f["status"]:
        parsed_chips.append({"kind": "status", "label": f"status: {f['status']}"})
    if f["only_types"]:
        parsed_chips.append({"kind": "type", "label": "type: " + " / ".join(sorted(f["only_types"]))})

    return {"query": q, "results": results, "parsed": parsed_chips}

