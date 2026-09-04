# cockpit-next — the full-stack Next.js app

Started as a second frontend for the FastAPI backend; it is now the
**complete application**: all 13 pages *and* a full TypeScript port of the
backend (`server/` + `app/api/**`) over the same SQLite file. Every one of
the 176 endpoints serves from Node — invoicing and payslip PDFs (pdfkit),
Excel exports (exceljs), ZIP packages, CAMT.053/CSV bank parsing, the Swiss
payroll engine, the AI chat, public share pages, the iCal feed. The schema
self-installs on an empty database, so a fresh install needs zero Python.

[PORTING.md](PORTING.md) documents how the port was done tranche by tranche
with a byte-level parity harness against the FastAPI reference
(`scripts/parity.mjs`), which remains in the repo root.

## Run

```bash
npm install
npm run build
npm run seed                        # fictional demo data (spawns a temp server)
ADMIN_PASSWORD=demo npm start       # http://127.0.0.1:3000
```

`npm run dev` for the hot-reloading dev server, `npm run smoke` for the
route-sweep smoke test on a scratch database (fresh-install proof included).
Point `DB_PATH` / `DOCS_DIR` elsewhere to relocate data (defaults: repo
root `invoices.db` + `documents/`).

## How the port maps

| Classic SPA | Here |
|---|---|
| `navigateTo()` + hidden page divs | file-based routes (`app/*/page.tsx`) |
| template strings in `static/js/01–09` | React components (`components/`) |
| global `api()` + Bearer token | `lib/api.ts` — typed client, 401 → `/login` |
| `Prefs.get/set` (server-backed) | `lib/prefs.ts` — same `/preferences` endpoint |
| `static/app.css` classes | **the same file** (`app/app.css` is a copy — keep in sync) |
| Chart.js reading CSS tokens | identical: `vizToken()` + a `themechange` event re-renders charts |
| FastAPI `routes/*.py` | route handlers in `app/api/**` over shared logic in `server/*.ts` |
| fpdf2 PDFs / openpyxl Excel | pdfkit + pdf-lib / exceljs — visually and structurally equivalent |
| `seed_demo.py` / `test_smoke.py` | `scripts/seed-demo.mjs` / `scripts/smoke.mjs` |

## Still in the classic frontend

Create/edit dialogs (invoices, bills, obligations, reserves), the dividend
plan editor, docs viewer and checklists, dashboard customization and the
per-page Display dialog — all state is server-side, so both frontends stay
consistent while those migrate.
