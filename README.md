# Swiss GmbH Cockpit

A self-hosted bookkeeping and forecasting cockpit for a Swiss one-person
GmbH. It pulls invoicing, bills, Swiss payroll, VAT and corporate-tax
tracking, dividend and cash-flow forecasting, and bank reconciliation into a
single dashboard, all backed by a local SQLite file you own. Everything runs
on your own machine — no cloud account, no third-party data sharing.

## Tech stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript** end to end — the API routes (`app/api/**`) run over shared
  server logic in `server/*.ts`
- **better-sqlite3** — a single self-installing SQLite database (the schema
  is created automatically on first run)
- PDF generation (pdfkit / pdf-lib), Excel export (exceljs), CAMT.053 / CSV
  bank-statement parsing, and an optional local/hosted LLM chat assistant

## Quickstart

```bash
cp .env.example .env.local     # defaults are fine for the demo
npm install
npm run seed                   # creates ./data/demo.db with fictional data
npm run dev                    # http://localhost:3000
```

Open http://localhost:3000 and log in with the password **`demo`**
(configurable via `ADMIN_PASSWORD` in `.env.local`).

Re-run `npm run seed` at any time to rebuild the demo database from scratch.

## Features

- **Dashboard** — cash position, revenue vs. cost, upcoming obligations, and
  configurable widget cards.
- **Invoicing** — issue monthly consulting invoices with Swiss VAT, track
  paid/unpaid status, and export PDFs.
- **Bills** — company documents across categories (software, vehicle,
  insurance, telecom, office, professional services, bank fees, taxes),
  including personal-card expenses awaiting reimbursement.
- **Payroll** — a Swiss payroll engine (AHV/ALV, BVG, UVG, KTG, FAK,
  Quellensteuer) that issues monthly payslips and the matching social-charge
  obligations.
- **Obligations** — AHV (monthly), VAT, source tax and BVG (quarterly), with
  due dates, expected billing dates and payment tracking.
- **VAT & tax reports** — periodic VAT summaries and corporate-tax estimates.
- **Forecasting** — dividend planning and forward cash-flow projection.
- **Bank reconciliation** — import statements (CAMT.053 / CSV) and match
  transactions to invoices, bills and obligations.
- **Kontokorrent** — owner ↔ GmbH shareholder current-account tracking.
- **Reserves** — cash-allocation pots with monthly accrual toward targets.
- **Expenses & trips** — business trips, itemized expenses and expense
  reports.

## Demo data

All seeded data is **entirely fictional**. The demo company is
"Muster Consulting GmbH", owner "Max Muster", with placeholder Swiss vendors,
a placeholder IBAN and invented figures for fiscal year 2026. Nothing in the
repository refers to a real person, company or bank account.

## Configuration

Copy `.env.example` to `.env.local` and adjust as needed. Key variables:

| Variable         | Default            | Purpose                                  |
|------------------|--------------------|------------------------------------------|
| `ADMIN_PASSWORD` | `demo`             | Login password                           |
| `DB_PATH`        | `./data/demo.db`   | SQLite database file                     |
| `DOCS_DIR`       | `./data/documents` | Uploaded document storage                |
| `LLM_PROVIDER`   | `ollama`           | AI chat provider (`ollama`/`anthropic`/`openai`, optional) |

The AI chat assistant is entirely optional; the app runs fully without it.

## Disclaimer

This is **educational / demonstration software**. It is **not** financial,
accounting, tax or legal advice, and it is **not** a certified accounting
system. Do not rely on it for filing taxes or statutory reporting. The
figures it produces are illustrative. The software is provided **"as is",
without warranty of any kind**, express or implied. Verify everything with a
qualified Swiss fiduciary (Treuhänder) before making any decision.

## License

Released under the [MIT License](LICENSE).
