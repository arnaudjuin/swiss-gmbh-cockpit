# Architecture

One SQLite file, one FastAPI process, two frontends. No ORM, no bundler, no
message queue — a deliberate small-footprint design for a single-tenant
finance tool.

```
                    ┌────────────────────────────┐
   classic SPA ───▶ │  FastAPI (app.py)          │
   templates/parts  │   ├─ routes/* (~25 routers)│      invoices.db (SQLite)
   static/js/01–09  │   ├─ auth.py (Bearer/cookie│ ───▶ documents/   (files)
                    │   │  + query-token files)  │
   cockpit-next ──▶ │   ├─ db.py (schema +       │
   Next 15 / React  │   │  migrations + self-heal│
   /api/* rewrite   │   └─ generate_invoice.py   │
                    └────────────────────────────┘
```

## Backend

- **`app.py`** assembles the classic SPA from `templates/parts/*.html` (name
  order), mounts every router under `/api`, injects cache-busted asset URLs,
  and wires cross-module dependencies via small `configure()` calls instead of
  a DI framework.
- **`db.py`** owns the schema. `init_db()` = base tables → startup self-heal
  (idempotent cross-table invariants, e.g. every paid invoice has exactly one
  linked income entry) → additive migrations guarded by column probes.
- **`routes/`** is one focused APIRouter per domain (invoicing, accounting,
  payroll, obligations, bank, reserves, forecast…). Literal paths are declared
  before parameterized ones (FastAPI route order matters).
- **`auth.py`** — single-password login, in-memory session tokens, accepted as
  `Authorization: Bearer`, session cookie, or `?token=` for file downloads.
  Refuses to bind non-localhost with the default password.

## Domain rules (the part worth reading)

- **Accrual vs cash, never mixed.** Revenue = invoice *subtotals* (VAT belongs
  to the tax office) + non-invoice income. Payroll cost = *issued payslips*.
  The dashboard, Reports → P&L and the forecast all agree by construction.
- **Obligations are the payment side** of costs already booked (payroll
  charges, VAT, taxes) — they are never added to P&L costs.
- **Payable date** = `max(due_date, expected_bill_date)`. The due date marks
  the accrual period; money leaves when the bill arrives. Every overdue /
  upcoming / calendar / forecast view uses `PAYABLE_SQL`.
- **Kontokorrent** (owner current account): personal→company transfers +
  unreimbursed personal-card bills + open expense reports − company→personal
  transfers excluding wages and reimbursements. One formula
  (`routes/money.kontokorrent_balance`), used everywhere.
- **Self-healing storage**: parent/child recurrence links, invoice↔income
  mirrors and orphaned ledger rows are reconciled on every boot.

## Frontends

- **Classic SPA** — framework-free: template strings, shared globals, classic
  scripts loaded in order. Pages are `<div class="page">` toggled by
  `navigateTo()`. Server-backed user preferences (`/preferences`) drive
  widgets, per-page display, plans.
- **`cockpit-next/`** — Next.js 15 App Router port over the *same* API: typed
  client (`lib/api.ts`), the same canonical CSS file, charts that read their
  palette from CSS tokens at render time. State lives server-side, so both
  frontends stay consistent; see `cockpit-next/README.md`.

## Design system

`design-system/canonical.css` defines tokens (§1) and every primitive
(§2–§13). Rules: no raw hex in app code, color = meaning only (green ok, red
danger, amber pending, blue info, purple owner-money), `tabular-nums` for all
money, light + dark at token level. `static/app.css` is the live copy.

## Testing

`tests/test_smoke.py` walks every GET route plus behavior flows (172 cases)
against a TestClient; `design-audit/` captures ~31 Playwright screenshots for
visual regression; CI runs both suites plus the Next build.
