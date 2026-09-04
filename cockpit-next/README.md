# cockpit-next — full-stack Next.js port

Started as a second frontend for the FastAPI backend; now also carries a
**TypeScript port of the backend core** in `server/` + `app/api/**` over the
same SQLite file. Ported endpoints serve from Node; the rest falls through to
FastAPI via a fallback rewrite — and with the core done, **the whole app — including a **fresh install on an empty database** — runs
standalone with the Python backend off (`DB_PATH=./cockpit.db npm start`). See [PORTING.md](PORTING.md) for the
exact split and `scripts/parity.mjs` for the byte-level parity harness.

## Run

```bash
# backend (from the repo root)
.venv/bin/python seed_demo.py && .venv/bin/python app.py     # :8000

# frontend
cd cockpit-next
npm install
npm run dev              # :3000 — /api/* proxied to :8000 (API_URL to override)
```

Log in with the demo password (`demo`). Note: `next.config.mjs` rewrites are
resolved at **build** time — set `API_URL` when running `npm run build` for a
non-default backend.

## How the port maps

| Classic SPA | Here |
|---|---|
| `navigateTo()` + hidden page divs | file-based routes (`app/*/page.tsx`) |
| template strings in `static/js/01–09` | React components (`components/`) |
| global `api()` + Bearer token | `lib/api.ts` — typed client, 401 → `/login` |
| `Prefs.get/set` (server-backed) | `lib/prefs.ts` — same `/preferences` endpoint |
| `static/app.css` classes | **the same file** (`app/app.css` is a copy — keep in sync); components are thin wrappers over the canonical classes |
| Chart.js reading CSS tokens | identical: `vizToken()` + a `themechange` event re-renders charts |

## Ported so far

- Auth (login, token, 401 handling), app shell, dark mode
- **Dashboard**: headline stats, the per-page recap strip, reserves,
  Income-vs-Costs / Cash-forecast / Costs-by-Category charts, recent invoices
- **Forecast**: per-year cash projection with editable per-month income
  (writes the same server-backed preference the classic page reads)
- **Obligations**: payment-day groups on the payable date, mark paid/unpaid,
  by-type and full tables

## Still in the classic frontend

Create/edit dialogs (invoices, bills, obligations, reserves), the dividend
plan editor, docs viewer and checklists, dashboard customization and the
per-page Display dialog — all state is server-side, so both frontends stay
consistent while those migrate.
