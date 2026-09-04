# Backend port: Python → TypeScript

`server/` + `app/api/**` is a TypeScript rewrite of the FastAPI backend,
running inside Next.js route handlers over the **same SQLite file**. During
the port both backends coexist: Next's own routes win, and anything not yet
ported **falls through to FastAPI** via a `fallback`-phase rewrite (that
phase matters — `afterFiles` rewrites would shadow dynamic routes; we
learned the hard way).

Parity is enforced by `scripts/parity.mjs`: it runs the same requests against
both backends on the same database and diffs canonicalized JSON. Current
status: **byte-identical on all core endpoints** (one known deviation: the
informational "type:" chip Python adds to a bare `overdue` search).

## Ported (serves from Node, works with FastAPI off)

auth (login/logout/check, sessions in SQLite) · preferences · dashboard
overview (full accrual aggregation) · finance/forecast (+ expected-P&L block) ·
runway · reports P&L · calendar (payable dates, projections, expected paydays) ·
obligations (list/types/labels/status) · invoices (list, paid toggle **incl.
the income-mirror invariant**) · bills · payroll (settings/preview engine/
payslips) · payslip math (ALV plafond port of `_compute_payslip`) ·
kontokorrent · reserves (list + create/update/delete + contribute/withdraw +
ledger) · **bank statements** (list/latest/years/get, create/update/delete
with content-hashed file storage + still-referenced checks, CAMT.053 header
auto-parse on upload, `parse-xml` preview, and the live `transactions`
endpoint — CAMT entry-level + UBS CSV with multi-order sub-entries and
"Reason for payment" extraction — plus the normalized `transactions.csv`
export, byte-identical to Python's) · **bank statement analyze** (the
reconciliation proposal engine: vendor categorization, owner-ledger
matching, salary aggregation, invoice matching by embedded number or
amount, and obligation settlement incl. same-type/same-due-date subset
sums) · cash balance (get/put) · customers (incl. get/update/delete) ·
expenses & reports · **vehicles** (CRUD + depreciation book-value) ·
**trips** (CRUD + rollup totals + expense auto-assign/assign) ·
**shareholder loans** (CRUD + net-position summary) · accounting extras
(years/categories/summary/vendors/check-duplicate/status toggle/bank-check
against parsed statements/**personal-card outstanding + reimburse** with the
Kontokorrent-safe transfer tagging) · payroll extras (YTD totals, payslip
status/delete, **accountant-payslip upload** with settings-estimated
breakdown) · **expenses** (CRUD + scan blobs with shared-content-hash
lifecycle, years/summary, bulk delete/recategorize, scan serving) ·
**expense reports** (generate — keeps the invoice number on regenerate,
reopens reimbursement when the total changes — plus the multi-page PDF
with receipt scans via pdfkit/pdf-lib, the exceljs Excel export, list and
delete with invoice-mirror cleanup) · RFC 5987 download filenames on all
PDF/Excel endpoints (Starlette-identical) · next-invoice-number ·
reserves create + summary · income delete/file · transfers
file + the annotated `export.csv` · **quarterly report** (AHV Lohnsumme from
issued payslips) · **P&L Excel** · **accounting export ZIP** and the full
**accountant package ZIP** (invoice/bill/expense/payslip/bank-statement
files + byte-identical summary CSVs) · **bank statement Excel export**
(4 sheets — Summary with Kontokorrent residual, classified Transactions,
Reimbursements, Personal card — same classification engine: salary
detection against the owner ledger incl. retro-splits, reimbursement and
owner-contribution matching, family/intra-company detection; single,
quarter-filtered and full-history modes) · **sharing** (share-link CRUD,
the public read-only HTML pages at /share/{token} — byte-identical markup —
shared file serving, the shared accountant ZIP, the dynamic **iCal feed**
with bills/obligations/invoices/budget/VAT events, and the Google-Sheets
CSV endpoints with CORS) · the **/quick** mobile capture page · dashboard extras (legacy stats,
finance dashboard, compare-months, category-trends) · **anomaly detection**
(vendor mean/stdev deviation + dismiss) · **cashflow** (day-by-day balance
projection: invoice lag, payroll, recurring bills, VAT quarters) · bank
csv-match + apply-match · **the whole budget module** (config UPSERT,
monthly view, ledger-derived balances, contribute/withdraw/adjust,
ledger CRUD with undo snapshots, health forecast) · search (query language: text, phrases, amounts, dates,
quarters, status, `type:` — invoice+bill entities) · **payroll generation**
(payslip upsert + AHV/UVG/KTG + quarterly Quellensteuer obligations + salary
transfer/income side effects; PDF render pending) · obligations
(create/summary) · recurring generators (bills + obligations) · **schema
self-install** (fresh DB → full DDL + defaults, zero Python needed) · upcoming-payments · transfers (list/create/delete) ·
income (list/create) · **file serving** (bill/obligation/statement files,
payslip & invoice PDFs) · **invoice & payslip PDF generation** (pdfkit port of the
fpdf2 layout — visually equivalent, business settings honored) · invoices
create/update/delete (rate/VAT from Settings, PDF written, income-mirror
cascade on delete) · bills create/update/delete (FX booking port, uploads,
recurring-parent promotion) · obligations update/delete (promotion)

**Standalone proof:** all 14 pages + a write path pass Playwright with the
Python backend dead.

## Still Python (falls through while FastAPI runs)

- `expenses/import-folder` + receipt OCR (needs the LLM provider — AI tranche)
- backup ZIP, bulk-upload, QR-bill scan, AI chat & receipt OCR,
  docs viewer, checklist parser
- demo-data seeding (`seed_demo.py`); schema itself now **self-installs** —
  a fresh `DB_PATH` gets the full current DDL + singleton rows on first open
  (`server/schema.ts`, regenerate with `scripts/gen-schema.sh`)

## Notes for porters

- Route-level module state is **not** shared across bundles in a production
  build — sessions live in SQLite, the DB handle on `globalThis`.
- `rewrites()` must return `{ fallback: [...] }`, not a plain array.
- JS `Math.round` is half-up; Python's `round` is banker's. No observed
  divergence on real data, but keep money math in whole rappen when extending.
- The old hybrid proxy only forwarded `/api/*` — `/share/*` and `/quick`
  never reached FastAPI from the Next app. Porting them fixed that.
- Known deviation: Python's `zipfile` permits duplicate archive names (two
  expenses sharing one scan + identical labels); JSZip stores one entry.
