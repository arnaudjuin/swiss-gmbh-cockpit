# Muster Consulting GmbH - Invoice & Expense Manager

## Setup & Installation

### Prerequisites

- **Python 3.11+** (tested with 3.13)
- **Anthropic API key** (required only for AI receipt scanning)

### 1. Clone / copy the project

Place the project folder anywhere on your machine. The working directory should contain:

```
Tool/
  app.py                  # FastAPI wiring root (~290 lines)
  auth.py                 # Session middleware + login/logout
  receipts.py             # LLM vision + duplicate detection
  db.py                   # Schema + migrations + get_db()
  helpers.py              # Date math, file I/O, currency conversion
  llm.py                  # LLM provider abstraction
  llm_tools.py            # Tool defs for AI chat
  routes/                 # Per-feature routers (~25 modules: accounting, bank,
                          #   payroll, calendar_view, reports, dividends…)
  generate_invoice.py     # PDF generation engine
  templates/parts/*.html  # Page shell + DOM markup (assembled in name order)
  static/app.css          # Extracted styles
  static/js/01…09-*.js    # Application JS split by domain (classic scripts, load order in parts/60-tail.html)
  tests/test_smoke.py     # Pytest smoke tests (every GET + write routes + CRUD round-trip)
  docs/                   # All markdown docs (this file, FEATURES, FORMULAS, …)
  invoices.db             # SQLite database (auto-created on first run)
  .env.example            # Environment variable template
  Caddyfile               # HTTPS reverse proxy config
  documents/              # All generated files (auto-created)
    invoices/             #   Invoice PDFs
    expenses/
      scans/              #   Receipt scan copies
      reports/            #   Expense report PDFs & Excel files
    accounting/           #   Bill scans + accountant ZIPs
    payslips/             #   Generated payslip PDFs
```

See the docstring at the top of `app.py` for the full module → router map.

### 2. Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

(Pinned versions; the package table below describes what each one is for.)

| Package            | Purpose                                       |
|--------------------|-----------------------------------------------|
| `fastapi`          | Web framework & REST API                      |
| `uvicorn`          | ASGI server                                   |
| `fpdf2`            | PDF generation for invoices & expense reports |
| `pillow`           | Image processing for receipt scans            |
| `anthropic`        | Claude Vision API for AI receipt analysis     |
| `PyMuPDF` (fitz)   | Convert PDF receipts to images for embedding  |
| `openpyxl`         | Excel export for expense reports              |
| `python-multipart` | File upload handling                          |

### 4. Configure environment variables

Copy the example file and edit it:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | `demo` | Login password for the web UI |
| `SESSION_TTL` | `86400` | Session duration in seconds (24h) |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `SECURE_COOKIES` | `false` | Set to `true` when behind HTTPS |
| `ANTHROPIC_API_KEY` | - | Required for AI receipt scanning |

To load from a `.env` file, export them before starting:

```bash
export $(cat .env | xargs)
```

### 5. Start the server

```bash
cd "~/swiss-gmbh-cockpit"
source .venv/bin/activate
python app.py
```

The app runs at **http://your-server-ip:8000**. Open this URL in your browser.

On first launch, the database and document folders are created automatically.

### 6. Production deployment with HTTPS

For secure access over the internet (required for phone access), use a reverse proxy.

**Option A: Caddy (recommended -- automatic HTTPS)**

1. Install Caddy: https://caddyserver.com/docs/install
2. Edit the `Caddyfile` -- replace `yourdomain.com` with your domain
3. Run: `caddy run`

Caddy automatically provisions and renews Let's Encrypt certificates.

**Option B: Nginx**

Use the standard nginx reverse proxy setup with Let's Encrypt certbot for SSL certificates, proxying to `localhost:8000`.

When behind HTTPS, set `SECURE_COOKIES=true` in your environment.

---

## User Guide

### Authentication

On first visit, you'll see a login screen. Enter the password set via the `ADMIN_PASSWORD` environment variable (default: `demo`).

Sessions last 24 hours by default. Click **Logout** at the bottom of the sidebar to end your session.

### Mobile Access

The interface is fully responsive and works on phones and tablets:
- The sidebar collapses to a hamburger menu on small screens
- Tables scroll horizontally
- Buttons and touch targets are enlarged for mobile use

### Dashboard

The landing page shows four summary cards:

- **Total Revenue** - sum of all invoice totals
- **Invoices** - number of invoices created
- **Average Invoice** - mean invoice value
- **Total Hours** - cumulative hours billed

A bar chart below shows monthly revenue over time.

### Calendar

**GmbH Finances → Calendar** shows every money event on a month grid: obligations (blue), bills (amber), payroll (green). Solid chips carry a real uploaded document (click to preview the PDF); dashed chips are expected — rows without a document, projections of recurring bills/obligations, and upcoming salary paydays. Days with several events show a day total; the footer shows the month total. See `FEATURES.md → Calendar` for details.

### Common monthly workflow

1. Upload the UBS statement (Bank Statements → Upload), click **Analyze** and review the proposals — invoice payments, new bills, and obligations settled by bank outflows are detected automatically.
2. Upload the accountant's payslip (Payroll → **Upload Payslip**) or generate one.
3. Record any expense you fronted privately as a bill with **Paid with = Personal card** — the Kontokorrent tracks what the GmbH owes you back.
4. Check the Calendar for what's due; quarterly, create the VAT obligation from Reports → VAT Tracker and later readjust it with the official ESTV assessment.

### Invoices

#### Creating an invoice

1. Click **New Invoice** in the sidebar.
2. Select the **year** and **month**.
3. Enter the number of **hours** worked.
4. Optionally select a **customer** (defaults to Acme Technologies).
5. Optionally add **notes** (custom remarks that appear in the invoice list).
6. The invoice number auto-increments but can be overridden.
7. Click **Create Invoice**.

A PDF is generated automatically and stored in `documents/invoices/`.

#### Viewing invoices

Go to the **Invoices** page to see all invoices in a table. For each invoice you can:

- **Preview PDF** - opens an inline PDF viewer within the app
- **Download** - downloads the PDF with a formatted filename
- **Edit** - modify hours, month, year, or notes (regenerates the PDF)
- **Delete** - confirmation modal, then removes the invoice and its PDF

#### Invoice details

Each invoice includes:
- Company letterhead (Muster Consulting GmbH)
- From/To addresses
- Line item: Engineering Services with hours, rate (CHF 62.00/h), and 8.1% VAT
- Invoice summary with subtotal, tax, and total
- Payment terms with IBAN banking details

### Expenses

#### Adding an expense manually

1. Click **Add Expense** in the sidebar.
2. Fill in the date, description, amount (in CHF), and category.
3. Optionally upload a receipt scan (JPG, PNG, or PDF).
4. Click **Save**.

#### Categories

Expenses are organized into four categories:
- **Meals** - food and drinks
- **Transport** - taxi, flights, train, fuel
- **Accommodation** - hotels
- **Other** - anything else

#### AI-powered folder import

To bulk-import receipts from a folder:

1. Go to the **Expenses** page and click **Import Folder**.
2. Enter the folder path (e.g., `/Users/you/receipts`).
3. Click **Scan & Import**.

The system uses Claude Vision to automatically extract from each receipt image:
- Date
- Vendor name and item description
- Total amount
- Category

**Duplicate detection:** Receipts that have already been imported (matched by file content hash) are automatically skipped and marked as "DUP" in the results.

Supported image formats: JPG, PNG. Each receipt is analyzed individually, and the extracted data is saved as an expense with the scan attached.

> **Note:** This feature requires the `ANTHROPIC_API_KEY` environment variable to be set.

#### Browsing expenses

The **Expenses** page shows all expenses in a sortable, filterable table with a dynamic summary line showing count and total for the current filter.

**Sorting:**
- Click any column header to sort by that column.
- Click again to reverse the sort direction.
- An arrow (triangle) indicates the current sort.

**Filtering:**
- **Year** dropdown - show expenses from a specific year
- **Category** dropdown - filter by Meals, Transport, etc.
- **Search** box - search across descriptions

All three filters work together. The summary line updates to show active filters, e.g. `12 receipts (2024, Transport) = CHF 890.50`.

**Viewing scans:**
- Image scans (JPG/PNG) show a thumbnail; click to enlarge in a lightbox.
- PDF scans show a document icon; click to open in the inline PDF viewer.

#### Bulk actions

Select multiple expenses using the checkboxes (or the "select all" checkbox in the header). A blue action bar appears with:

- **Re-categorize** - change the category of all selected expenses at once
- **Delete Selected** - delete all selected expenses (with confirmation modal)
- **Cancel** - clear the selection

#### Editing / deleting expenses

Click the edit or delete button on any expense row. Deleting shows a confirmation modal. When editing, you can also replace the receipt scan.

### Expense Reports

Expense reports compile all expenses for a given year into a professional PDF invoice.

#### Generating a report

1. Go to the **Expenses** page.
2. Select a **year** from the dropdown.
3. Click **Generate Report**.

The report is assigned the next invoice number and includes:

- **Page 1:** Invoice format with total expenses in CHF at 0% VAT
- **Page 2+:** Detailed table listing every expense (ref number, date, description, category, amount)
- **Remaining pages:** One page per receipt scan, with the reference header and the scan image embedded

PDF receipt scans are automatically converted to images for embedding using PyMuPDF.

#### Downloading reports

After generating, use the action buttons:
- **PDF icon** - preview the report in the inline PDF viewer
- **Download icon** - download the Excel spreadsheet

Files are named: `Travel Expenses {year} Muster Consulting GmbH 101119.LOD-SW_GCS-24032.pdf`

### Customers

#### Managing customers

1. Go to the **Customers** page in the sidebar.
2. Click **+ Add Customer**.
3. In the dialog, fill in: name, address, city, country, email, reference.
4. To edit or delete, use the action buttons on each row. Deleting shows a confirmation modal.

The default customer (Acme Technologies) is seeded on first run.

When creating an invoice, select any customer from the dropdown. The customer details appear on the generated PDF.

### Currency

All amounts in the system are stored in **CHF** (Swiss Francs). The following exchange rates are used for conversion during import:

| Currency | Rate to CHF |
|----------|-------------|
| AED      | 0.2178      |
| USD      | 0.88        |

---

## CLI Usage

Invoices can also be generated from the command line without starting the web server:

```bash
python generate_invoice.py --month 2026-03 --hours 160
```

Options:
- `--month YYYY-MM` - invoice month (required)
- `--hours N` - hours worked (required)
- `--invoice-number N` - override auto-increment
- `-o PATH` - custom output file path

---

## File Structure

| Path | Description |
|------|-------------|
| `app.py` | FastAPI wiring root: config, module mounts, `/` and startup |
| `auth.py` | Session middleware + login/logout/auth-check routes |
| `receipts.py` | LLM vision receipt parsing + file-hash duplicate detection |
| `db.py` | SQLite schema, migrations, `get_db()`, `init_db()` |
| `helpers.py` | Date math, file save/delete/serve, currency conversion |
| `llm.py` | Provider abstraction (Ollama / Anthropic / OpenAI) |
| `llm_tools.py` | Tool definitions used by the AI chat |
| `routes/invoicing.py` | Invoices + customers CRUD + PDF |
| `routes/expenses.py` | Travel expenses, folder import, reports |
| `routes/accounting.py` | Company bills CRUD + ZIP export |
| `routes/obligations.py` | AHV / BVG / taxes + `OBLIGATION_TYPES` |
| `routes/money.py` | Personal↔GmbH transfers + manual income |
| `routes/payroll.py` | Swiss payroll: settings, preview, generate, PDFs |
| `routes/budget.py` | Budget config (spending targets for Financial Overview); the sinking-funds UI was removed 08/2026 |
| `routes/dashboard.py` | Dashboard widgets, compare-months, category trends |
| `routes/preferences.py` | Server-backed user preferences (dashboard layout, chart types) |
| `routes/finance.py` | Cash balance, runway, reserve health, bank-CSV match, anomalies, search |
| `routes/reports.py` | Quarterly AHV, accountant package, P&L, VAT, tax |
| `routes/share.py` | Shared links, iCal feed, public read-only HTML |
| `routes/public.py` | `/quick` mobile receipt page + Google-Sheets CSVs |
| `routes/llm.py` | `/api/llm/{status,ask,stream}` |
| `routes/docs.py` | `/api/docs` + `/api/docs/{name}` — serves whitelisted markdown to the in-app Docs page |
| `routes/test_procedure.py` | `/api/test-procedure` — parses `TEST_PROCEDURE.md` into structured JSON for the in-app interactive checklist |
| `FORMULAS.md` | Reference for every monthly / yearly calculation (income, costs, payroll, runway, dividend planner, anomaly detection) |
| `ACCOUNTING_TASKS.md` | Daily / monthly / quarterly / yearly accounting checklist rendered interactively on the **Accounting Checklist** page |
| `SECURITY.md` | Threat model + hardening defaults + what you the user must do — read before exposing the app to anything outside `127.0.0.1` |
| `routes/misc.py` | Recurring bills/obligations, status patches, QR-bill, vendor suggest, bulk upload, backup |
| `generate_invoice.py` | PDF generation (invoices, expense reports, payslips) |
| `templates/parts/*.html` | Page shell + DOM markup, assembled in name order |
| `static/app.css` | Extracted CSS |
| `static/js/*.js` | Application JS, split by domain (01-core … 09-misc) |
| `static/favicon.svg` | Inline-editable SVG favicon (browser tab + iOS home-screen icon) |
| `tests/test_smoke.py` | Pytest smoke test (every GET + write routes, CRUD + preferences round-trip) |
| `docs/AI_CHAT.md` | Reference for the in-app AI chat: modes, tools, knowledge base, providers, limitations |
| `invoices.db` | SQLite database |
| `.env.example` | Environment variable template |
| `Caddyfile` | Caddy reverse proxy configuration |
| `documents/invoices/` | Generated invoice PDFs |
| `documents/expenses/scans/` | Copies of uploaded/imported receipt scans |
| `documents/expenses/reports/` | Generated expense report PDFs and Excel files |
| `documents/accounting/` | Bill scans + yearly accountant ZIPs |
| `documents/payslips/` | Generated payslip PDFs |

### Running tests

```bash
.venv/bin/python -m pytest tests/test_smoke.py -v
```

The smoke test boots the app via `TestClient`, logs in, then runs:

- **Every GET route** with placeholder path params — asserts no 500.
- **Every POST/PUT/PATCH/DELETE route** with mutation-safe inputs — empty JSON
  bodies (Pydantic returns 422 before the handler), `{id}=999999` (handlers
  return 404 before any DB write). Asserts no 500.
- **Full customer CRUD round-trip** — create → list → update → delete →
  verify the temp record is gone.
- **Preferences round-trip** — snapshots the user's real prefs first, exercises
  PUT/GET, then restores the snapshot.
- A short skip list for the few mutating no-body routes
  (`/api/accounting/generate-recurring`, `/api/cash-balance`, etc.).

It catches extraction bugs (missing imports, broken DI), unhandled `KeyError` /
`IntegrityError` on missing fields, and route wiring regressions. Doesn't
validate response payloads — it's a tripwire, not an integration test.

## Data consistency: self-heal on startup

`db.init_db()` runs on every app boot and reconciles a few cross-table
invariants. Each step is idempotent (re-running on a clean DB is a no-op):

| Invariant | Self-heal action |
|---|---|
| Every paid billable invoice (`hours > 0`, `paid_status = 'paid'`) has exactly one linked `income_entries` row | Create the missing row for any paid invoice without a link |
| No `income_entries.invoice_id` points to a missing or unpaid invoice | Delete orphan income rows whose linked invoice is gone or no longer paid |
| No `budget_ledger.budget_item_id` points to a missing budget item | Delete orphan ledger rows |
| No `company_docs.parent_doc_id` points to a missing parent | Promote the oldest orphan to be the new parent (`parent_doc_id = NULL`); point siblings at it |
| No `obligations.parent_obligation_id` points to a missing parent | Same promotion logic for obligations |

The same protections are applied at the **endpoint** level (PATCH/DELETE
handlers) so new orphans can't be created. Startup self-heal exists for
historical drift only — every fresh write goes through code that maintains
these invariants directly. See `db.py:init_db` for the exact SQL.

## API Endpoints

All `/api/*` endpoints require authentication (session cookie) except `/api/login` and `/api/auth/check`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Web UI |
| `POST` | `/api/login` | Authenticate with password |
| `POST` | `/api/logout` | End session |
| `GET` | `/api/auth/check` | Check session validity |
| `GET` | `/api/dashboard` | Dashboard statistics |
| `GET` | `/api/preferences` | Get user preferences (JSON blob) |
| `PUT` | `/api/preferences` | Replace user preferences (full object) |
| `GET` | `/api/docs` | List in-app readable docs (whitelisted) |
| `GET` | `/api/docs/{name}` | Return raw markdown of one whitelisted doc |
| `GET` | `/api/test-procedure` | Parsed TEST_PROCEDURE.md as structured JSON (sections → tests → steps) |
| `GET` | `/api/transfers/export.csv` | CSV of all transfers + lifetime totals (optional `?year=`) |
| `GET` | `/api/llm/status` | Health check for the configured LLM provider |
| `POST` | `/api/llm/ask` | Single-shot question (returns answer + tool used) |
| `POST` | `/api/llm/stream` | Streaming SSE version of `/ask` |
| `GET` | `/api/invoices` | List all invoices |
| `POST` | `/api/invoices` | Create invoice + PDF |
| `GET` | `/api/invoices/{id}` | Get invoice details |
| `PUT` | `/api/invoices/{id}` | Update invoice |
| `DELETE` | `/api/invoices/{id}` | Delete invoice + PDF |
| `GET` | `/api/invoices/{id}/pdf` | Download invoice PDF |
| `GET` | `/api/next-invoice-number` | Get next auto-increment number |
| `GET` | `/api/customers` | List customers |
| `POST` | `/api/customers` | Add customer |
| `PUT` | `/api/customers/{id}` | Update customer |
| `DELETE` | `/api/customers/{id}` | Delete customer |
| `GET` | `/api/expenses` | List expenses (optional `?year=`) |
| `POST` | `/api/expenses` | Add expense with optional scan |
| `POST` | `/api/expenses/import-folder` | AI bulk-import from folder |
| `POST` | `/api/expenses/bulk/delete` | Bulk delete expenses |
| `POST` | `/api/expenses/bulk/recategorize` | Bulk re-categorize expenses |
| `GET` | `/api/expenses/years` | List years with expenses |
| `GET` | `/api/expenses/summary` | Yearly expense totals |
| `GET` | `/api/expenses/{id}` | Get expense details |
| `PUT` | `/api/expenses/{id}` | Update expense |
| `DELETE` | `/api/expenses/{id}` | Delete expense + scan |
| `GET` | `/api/expenses/{id}/scan` | Serve receipt scan file |
| `GET` | `/api/expenses/reports` | List generated reports |
| `POST` | `/api/expenses/report/{year}` | Generate yearly expense report |
| `GET` | `/api/expenses/report/{year}/pdf` | Download report PDF |
| `GET` | `/api/expenses/report/{year}/excel` | Download report Excel |
