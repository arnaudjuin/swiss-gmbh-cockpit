#!/usr/bin/env python3
"""Web UI for Muster Consulting GmbH invoice management.

This file is the FastAPI wiring root. It instantiates the app, mounts the
static files, configures the database, and includes every router. Almost no
business logic lives here — see the per-feature modules listed below.

Wiring (top → bottom):
  Config            — BASE_DIR + path constants + server env vars
  auth.py           — session middleware + login/logout/auth-check routes
  StaticFiles       — /static/{app.css, js/*.js} served without auth
  db.py             — schema, migrations, init_db(), get_db(), helpers
  receipts.py       — LLM vision + file-hash duplicate detection
  startup + GET /   — init_db on boot, assemble + serve templates/parts/*

Routers (each include_router'd at /api/* unless noted):
  routes_invoicing      — invoices, customers, /api/next-invoice-number
  routes_expenses       — travel expenses + folder import + report PDFs/Excel
  routes_accounting     — company bills (company_docs)
  routes_obligations    — AHV, BVG, taxes, etc. (defines OBLIGATION_TYPES)
  routes_money          — Personal↔GmbH transfers + manual income entries
  routes_misc           — recurring bills/obligations, status patches,
                          QR-bill scanner, vendor suggest, bulk upload, backup
  routes_payroll        — Swiss payroll: settings, preview, generate, PDFs
  routes_budget         — budget config, balances, ledger
  routes_share          — shared links, iCal feed, public read-only HTML
                          (mounted at root, not /api)
  routes_reports        — quarterly AHV, accountant package, P&L, VAT, tax
  routes_finance        — cash-balance, runway, reserve health, bank-CSV
                          match, anomaly detection, global search
  routes_public         — /quick (mobile receipt) + /share/.../sheet/*.csv
                          (mounted at root, not /api)
  routes_dashboard      — /dashboard, /dashboard/overview (?range=ytd|month|
                          30d|12m|year|prev_year|all), /upcoming-payments,
                          /finance/dashboard, /dashboard/{compare,trends}
  routes_preferences    — GET/PUT /api/preferences (single-user JSON blob,
                          backs the dashboard customize / chart-type prefs)
  routes_docs           — GET /api/docs (list) + /api/docs/{name} (markdown
                          text); whitelisted set served behind auth
  routes_llm            — /api/llm/{status,ask,stream}

Helpers:
  helpers.py        — date math, file save/delete/serve, currency conversion
  llm.py            — provider abstraction (Ollama / Anthropic / OpenAI)
  llm_tools.py      — tool definitions used by AI chat
  generate_invoice.py — PDF generators (invoice, expense report, payslip)

Frontend:
  templates/parts/*.html — page shell + DOM markup, assembled in name order
  static/app.css       — extracted styles
  static/js/*.js       — application JS, split by domain (load order in parts/60-tail.html)

Tests:
  tests/test_smoke.py — boots the app via TestClient, hits every GET and write
                      route (with mutation-safe inputs: empty bodies hit
                      Pydantic 422, id=999999 hits 404), full customer CRUD +
                      preferences round-trip. Asserts no 500s.
                      Run: .venv/bin/python -m pytest tests/test_smoke.py -q
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

from generate_invoice import AED_TO_CHF, COMPANY, DEFAULT_CUSTOMER, RATE, VAT_RATE

# ─── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "invoices.db"
DOCS_DIR = BASE_DIR / "documents"
PDF_DIR = DOCS_DIR / "invoices"
SCAN_DIR = DOCS_DIR / "expenses" / "scans"
REPORT_DIR = DOCS_DIR / "expenses" / "reports"
ACCT_DIR = DOCS_DIR / "accounting"
PAYSLIP_DIR = DOCS_DIR / "payslips"
BANK_DIR = DOCS_DIR / "bank_statements"
TEMPLATE_PARTS_DIR = BASE_DIR / "templates" / "parts"
STATIC_DIR = BASE_DIR / "static"

# Server config — default to localhost-only so the app isn't exposed to the
# local network out of the box. Override HOST=0.0.0.0 if you intentionally
# want to listen on all interfaces (e.g. behind a reverse proxy).
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

app = FastAPI(title="Muster Consulting Invoice Manager")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Restrict-by-default security response headers. Applies to every response
# regardless of route.
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    # Strict-Transport-Security is only useful behind HTTPS — emit only when
    # the X-Forwarded-Proto reverse-proxy hint says https.
    if request.headers.get("x-forwarded-proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ─── Auth (extracted to auth.py) ─────────────────────────────────────────────

import auth
auth.register(
    app,
    password=os.environ.get("ADMIN_PASSWORD", "demo"),
    ttl=int(os.environ.get("SESSION_TTL", "86400")),
    host=HOST,
)
active_sessions = auth.active_sessions  # used by routes_public token check


# ─── Database (extracted to db.py) ───────────────────────────────────────────

import db as _dbmod
from db import get_db, init_db

_dbmod.configure(DB_PATH, PDF_DIR, SCAN_DIR, REPORT_DIR, ACCT_DIR, PAYSLIP_DIR,
                 bank_dir=BANK_DIR)


# ─── Receipts (extracted to receipts.py) ─────────────────────────────────────

from receipts import (
    SUPPORTED_EXT,
    analyze_receipt, compute_file_hash, make_is_duplicate,
)
is_duplicate_scan = make_is_duplicate(SCAN_DIR)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_customer(db, customer_id=None):
    if customer_id:
        row = db.execute("SELECT * FROM customers WHERE id=?", (customer_id,)).fetchone()
        if row:
            return {k: row[k] for k in ("name", "address", "city", "country", "email", "reference")}
    return DEFAULT_CUSTOMER


@app.on_event("startup")
def startup():
    init_db()
    if os.environ.get("ADMIN_PASSWORD", "demo") == "demo":
        log.warning("Using default password 'demo' -- set ADMIN_PASSWORD env var for production!")


def _asset_hash(filename: str) -> str:
    """Short SHA1 of a file in STATIC_DIR, used as ?v= cache-bust token.
    Falls back to a deploy-time constant if the file is missing."""
    import hashlib
    p = STATIC_DIR / filename
    if not p.exists():
        return "0000000000"
    return hashlib.sha1(p.read_bytes()).hexdigest()[:10]


@app.get("/", response_class=HTMLResponse)
async def index():
    # The page is assembled from templates/parts/*.html in name order
    # (10-shell → 20/30/40 pages → 50-dialogs → 60-tail).
    html = "".join(p.read_text() for p in sorted(TEMPLATE_PARTS_DIR.glob("*.html")))
    # Rewrite the cache-bust query on every JS/CSS asset reference to a content
    # hash. Matches `?v=...` after `app.js` / `app.css` (any token, any length).
    import re
    def sub(match):
        name = match.group(1)
        return f'{name}?v={_asset_hash(name)}'
    html = re.sub(r'((?:js/)?[\w.-]+\.(?:js|css))\?v=[^"\']+', sub, html)
    return HTMLResponse(html)


# ─── Dashboard (extracted to routes_dashboard.py) ─────────────────────────

from routes import dashboard as routes_dashboard
app.include_router(routes_dashboard.router, prefix='/api')

from routes import preferences as routes_preferences
app.include_router(routes_preferences.router, prefix='/api')

from routes import docs as routes_docs
routes_docs.configure(BASE_DIR)
app.include_router(routes_docs.router, prefix='/api')

from routes import test_procedure as routes_test_procedure
routes_test_procedure.configure(BASE_DIR)
app.include_router(routes_test_procedure.router, prefix='/api')


# ─── Invoices + Customers (extracted to routes_invoicing.py) ───────────────

from routes import invoicing as routes_invoicing
from generate_invoice import COMPANY, RATE, VAT_RATE, DEFAULT_CUSTOMER
routes_invoicing.configure(PDF_DIR, DEFAULT_CUSTOMER, COMPANY, RATE, VAT_RATE)
app.include_router(routes_invoicing.router, prefix='/api')


# ─── Expenses (extracted to routes_expenses.py) ────────────────────────────

from routes import expenses as routes_expenses
routes_expenses.configure(
    SCAN_DIR, REPORT_DIR, COMPANY, AED_TO_CHF, SUPPORTED_EXT,
    get_customer, analyze_receipt, compute_file_hash, is_duplicate_scan,
)
app.include_router(routes_expenses.router, prefix='/api')



# ─── Accounting (extracted to routes_accounting.py) ───────────────────────

from routes import accounting as routes_accounting
routes_accounting.configure(ACCT_DIR)
app.include_router(routes_accounting.router, prefix='/api')



# ─── Obligations (extracted to routes_obligations.py) ─────────────────────

from routes import obligations as routes_obligations
from routes.obligations import OBLIGATION_TYPES
routes_obligations.configure(ACCT_DIR)
app.include_router(routes_obligations.router, prefix='/api')


# ─── Calendar (obligations / bills / payroll events) ───────────────────────

from routes import calendar_view as routes_calendar
app.include_router(routes_calendar.router, prefix='/api')




# ─── Transfers + Income (extracted to routes_money.py) ────────────────────

from routes import money as routes_money
routes_money.configure(ACCT_DIR)
app.include_router(routes_money.router, prefix='/api')



# ─── Misc routes (extracted to routes_misc.py) ────────────────────────────

from routes import misc as routes_misc
routes_misc.configure(ACCT_DIR, DB_PATH, DOCS_DIR, BASE_DIR)
app.include_router(routes_misc.router, prefix='/api')


# ─── Payroll + Budget (extracted modules) ──────────────────────────────────

SALARY = 13000.00  # Monthly salary (referenced by budget + reports + tools)

from routes import payroll as routes_payroll
routes_payroll.configure(PAYSLIP_DIR)
app.include_router(routes_payroll.router, prefix='/api')
from routes.payroll import _row_to_settings, _compute_payslip

from routes import budget as routes_budget
routes_budget.configure(SALARY, _row_to_settings, _compute_payslip)
app.include_router(routes_budget.router, prefix='/api')


# ─── Reserves / sinking funds (extracted to routes_reserves.py) ──────────
from routes import reserves as routes_reserves
app.include_router(routes_reserves.router, prefix='/api')

# ─── Cash-flow timeline (extracted to routes_cashflow.py) ────────────────
from routes import cashflow as routes_cashflow
app.include_router(routes_cashflow.router, prefix='/api')

# ─── Trips / business-trip grouping (extracted to routes_trips.py) ───────
from routes import trips as routes_trips
app.include_router(routes_trips.router, prefix='/api')

# ─── Bank statements (extracted to routes_bank.py) ────────────────────────
from routes import bank as routes_bank
from routes import bank_export as routes_bank_export
routes_bank.configure(BANK_DIR)
app.include_router(routes_bank.router, prefix='/api')
app.include_router(routes_bank_export.router, prefix='/api')

# ─── Vehicles + Shareholder loans (new schemas, new routes) ───────────────
from routes import vehicles as routes_vehicles
app.include_router(routes_vehicles.router, prefix='/api')
from routes import shareholder_loans as routes_shareholder_loans
app.include_router(routes_shareholder_loans.router, prefix='/api')





# ─── Sharing + iCal + Public pages (extracted to routes_share.py) ──────────

from routes import share as routes_share
from routes import reports as _rr_share
routes_share.configure(ACCT_DIR, SCAN_DIR, REPORT_DIR, OBLIGATION_TYPES, _rr_share.accountant_package)
app.include_router(routes_share.router)











# ─── P&L + VAT + Tax (extracted to routes_reports.py) ───────────────────────

from routes import reports as _rr_early
_rr_early.configure(PDF_DIR, ACCT_DIR, REPORT_DIR, OBLIGATION_TYPES, SALARY,
                    scan_dir=SCAN_DIR, payslip_dir=PAYSLIP_DIR,
                    bank_dir=BANK_DIR)
app.include_router(_rr_early.router, prefix='/api')
app.include_router(_rr_early.tax_router, prefix='/api')

# ─── Finance (extracted to routes_finance.py) ─────────────────────────────

from routes import finance as routes_finance
app.include_router(routes_finance.router, prefix='/api')
from routes import search as routes_search
app.include_router(routes_search.router, prefix='/api')


# Payroll already mounted earlier

# ─── Quick-add + Sheets exports (extracted to routes_public.py) ────────────

from routes import public as routes_public
routes_public.configure(active_sessions)
app.include_router(routes_public.router)

# Reports already mounted earlier via _rr_early

# ─── LLM Tools (extracted to llm_tools.py) ──────────────────────────────────

from llm_tools import build_tools, build_tools_prompt as _build_tools_prompt_impl

_TOOLS_CACHE = None

def _get_tools():
    global _TOOLS_CACHE
    if _TOOLS_CACHE is None:
        _TOOLS_CACHE = build_tools(get_db, _row_to_settings, _compute_payslip, OBLIGATION_TYPES, SALARY)
    return _TOOLS_CACHE

# Backwards-compat: TOOLS as a lazy proxy used by other code
class _ToolsProxy:
    def __getitem__(self, key): return _get_tools()[key]
    def __contains__(self, key): return key in _get_tools()
    def __iter__(self): return iter(_get_tools())
    def keys(self): return _get_tools().keys()
    def items(self): return _get_tools().items()
    def values(self): return _get_tools().values()
TOOLS = _ToolsProxy()

def _build_tools_prompt():
    return _build_tools_prompt_impl(_get_tools())


# ─── LLM Chat (extracted to routes_llm.py) ──────────────────────────────────

from routes import llm as routes_llm
routes_llm.configure(BASE_DIR, _get_tools(), _build_tools_prompt_impl)
app.include_router(routes_llm.router, prefix='/api')



if __name__ == "__main__":
    import uvicorn
    # Auto-reload by default (local tool — code changes apply on save).
    # Set RELOAD=0 in .env for hosted/production runs.
    if os.environ.get("RELOAD", "1") == "1":
        uvicorn.run("app:app", host=HOST, port=PORT, reload=True)
    else:
        uvicorn.run(app, host=HOST, port=PORT)
