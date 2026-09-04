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
kontokorrent · reserves · bank statements (list/latest) · cash balance ·
customers · expenses & reports · search (query language: text, phrases,
amounts, dates, quarters, status, `type:` — invoice+bill entities)

**Standalone proof:** all 14 pages + a write path pass Playwright with the
Python backend dead.

## Still Python (falls through while FastAPI runs)

- PDF generation (invoice / payslip / expense report) and file serving/uploads
- CAMT.053 / CSV bank import + transaction classification + Excel exports
- payroll *generation* (payslip rows + obligation booking), recurring
  generators, reimbursement flows, anomalies, cashflow, budget, share links /
  ICS, backup, AI chat & receipt OCR, docs viewer, checklist parser
- schema creation/migrations (`db.py` / `seed_demo.py` still initialize the DB)

## Notes for porters

- Route-level module state is **not** shared across bundles in a production
  build — sessions live in SQLite, the DB handle on `globalThis`.
- `rewrites()` must return `{ fallback: [...] }`, not a plain array.
- JS `Math.round` is half-up; Python's `round` is banker's. No observed
  divergence on real data, but keep money math in whole rappen when extending.
