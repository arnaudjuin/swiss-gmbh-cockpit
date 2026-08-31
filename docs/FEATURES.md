# Muster Consulting Financial Tracker — Feature Reference

Last updated: 2026-07-02 (**Project reorganized**: `routes_*.py` → `routes/` package, `*.md` → `docs/`, backups + private PDFs moved out of root, `.gitignore` + git repo initialized · **Bank statement expanded view — 3 new sections**: (1) **Net flow with counterparty (excluding salary)** — auto-detects whether this is a GmbH or personal account by looking at counterparty patterns, filters intra-company transfers, uses first-name-token match to avoid relatives with shared surname, subtracts detected salaries (±10 % amount + ±7 days payday match), lets user Ignore/Restore individual transactions with localStorage persistence; (2) **Obligations reconciliation** — matches tracked obligations to statement outflows using counterparty-type keywords (`ahv`→ausgleichskasse, `bvg`→AXA/Swisscanto, `vat`→ESTV, etc.), global greedy assignment to avoid loop-order bias, one-click Mark-paid from a match, downloads a CSV for Treuhand with matched/unpaid/untracked/duplicate sections; (3) **Possible-duplicate detector** — flags same-counterparty + same-amount transactions within 60 days, distinguishes recurring (25-35d cadence = probably subscription) from suspicious · **Cross-statement Kontokorrent card**: sums non-salary GmbH↔Personal flow across all uploaded statements → running IOU balance, cached by statement-id hash · **Dashboard "Next Obligations Due" tile**: top 3 unpaid obligations sorted by due date with days-until color coding, click-through to obligations page)

Previous updates: 2026-06-24 (UBS native CSV format also accepted alongside PDF + CAMT.053 XML · Script-based bank-statement analyzer that emits up-to-25 proposals per CSV — no AI/LLM, deterministic pattern matching against ~12 known Swiss vendors · Proposal-review modal with smart-default checkboxes by confidence + sequential apply · Inline-expand row on Bank Statements — click any row to see all parsed transactions with filter buttons (All / In / Out) · Clean CSV export per statement (one row per transaction, sub-entries flattened, Excel-friendly UTF-8 BOM + commas) · Three new tables: `shareholder_loans` (Rangrücktritt tracking for OR 725a/b), `vehicles` (Privatanteil + depreciation), `bank_transactions` (reserved for future persisted reconciliation) · Full CRUD routes for vehicles + shareholder_loans · Vehicle book-value endpoint that auto-computes depreciation (degressive 40 % or linear 20 %) · UBS CSV parser handles multi-order sub-entries — semicolon CSV with BOM, Swiss number format, embedded reference QR-bill data)

**Demo build** — this repository ships with fictional demo data (`python seed_demo.py`); every name, amount and document in the docs is illustrative.

Previous updates: 2026-06-22 (UBS Bank Statements with PDF + CAMT.053 XML upload, auto-parse opening/closing/period/IBAN · Business Trips abstraction with auto-assign · Cash-flow Timeline widget (180-day SVG projection) · Reserves / Sinking Funds widget with full CRUD · Spesenabrechnung now month-aware (Generate Report month picker, Excel mirror) · LLM tools rewritten: `dashboard_summary` returns cash + accrual + receivables, new `receivables_summary`, `dividend_capacity`, `propose_add_expense`, `propose_add_bill`, `propose_mark_invoice_paid` · Model-size warning banner in AI chat for local <14B models · Server-side HEIC→JPG conversion on upload (pillow_heif) · Hash-based filenames for receipt scans + statement files (automatic dedup) · Auto cache-bust on static assets via SHA1 hash · Payslips + bank statements + receipt scans now bundled in accountant-package ZIP · New expense categories: Connectivity, Fuel · New bill category: Payroll Settlement · Payroll wired to AXA payslip exactly: gross 13,000, Quellensteuer 13.4 %, BVG fixed 522.60, KTG 50/50 split, SAI added, ALV solidarity removed (abolished 2023))

Previous updates: 2026-05-22 (search bar mini-query language — amounts, dates, status, type:, quoted phrases, match highlighting · iPhone/iPad layout fixes · remote-dev options · security hardening · favicon · invoice↔income auto-link · multi-year dividend planner · transfers CSV export · accounting checklist · `start.sh` launcher · AI write tool with confirm-step · in-app docs viewer · time-range filter · widget sizing · Net Salary widget · Reports customization)

Quick reference for all advanced features beyond basic invoicing/expenses.

---

## 🎛 Dashboard Customization

**Where:**
- Dashboard → **Customize** button (top-right) — global widget on/off list
- &#9432; icon on any widget — per-widget settings & info panel

The dashboard is fully configurable per-user, with settings persisted server-side
(SQLite `user_preferences` table) so the layout follows you across browsers and
devices. `localStorage` mirrors the cache for instant reads and offline tolerance,
and writes are debounced (500ms) to avoid hammering the server on rapid changes.

### Global controls (Customize button)

- **Widget visibility** — toggle each of 12 stat cards, 2 charts, 3 lists on/off
- **Widget order** — drag-and-drop stat cards to reorder

### Time range (whole-dashboard filter)

Top-right of the Dashboard there's a time-range dropdown:
**Year to date** · **This month** · **Last 30 days** · **Last 12 months** ·
**This year** · **Last year** · **All time**.

Selection persists in `prefs.dashboard.range` and applies to every income/cost/
profit/% widget on the dashboard. A small banner under the page header always
shows the active range and the date interval, e.g.
*"Showing: Last 30 days · 2026-03-29 → 2026-04-28"*.

Widgets that aren't time-bounded (Overdue, Due Next 30 Days, Recent Invoices,
Kontokorrent, Net Salary, the page-recap tiles) ignore the range and always show their natural
semantics.

### Per-widget settings (&#9432; icon)

The &#9432; on every card opens a per-widget settings panel. The icon is now
**always visible at 55% opacity** (full opacity on hover). Changes apply
immediately (no Save button) — Prefs flushes to the server 500ms after the
last change.

| Widget type | Settings exposed |
|---|---|
| **Stat cards** (13) | Visibility · **Width**: Normal / Wide / Full · Accent color (None / Blue / Green / Amber / Red / Purple) |
| **Charts** (2)      | Visibility · **Width**: Half / Full · **Height**: Compact / Medium / Tall · Chart type · Show legend |
| **Lists** (3)       | Visibility · **Width**: Half / Full · Rows shown: 3 / 5 / 8 / 12 |

The chart and list containers became 2-column grids — pick **Half** to put two
side-by-side, **Full** to span the row. Phones (< 720px) collapse everything to
single column automatically.

### Net Salary widget (Payroll bridge)

A new **Net Salary (monthly)** stat card surfaces your computed net pay
(gross − employee contributions − source tax) directly on the dashboard, with
an inline **Edit** link that jumps straight to Payroll → Settings. Pulled live
from `/api/payroll/preview` only when the widget is enabled (saves a fetch
otherwise). If payroll isn't set up yet, the card shows a "Set up payroll →"
prompt.

### Next Obligations Due widget

Stat card showing the top 3 unpaid obligations sorted by due date, filtered to
those due within 60 days. Each row shows the obligation label, amount, and a
day-count badge with color coding:

- **Red** — overdue (past due date)
- **Amber** — due within 7 days
- **Muted** — 8-60 days out

The tile's own border/color goes red when any of the top 3 is overdue, amber
otherwise. Click any row to navigate to the Obligations page. Fetches
`/api/upcoming-payments?days=60` only when the widget is enabled. If no unpaid
obligations exist, the card shows "Add obligation →" prompt.

Available chart types per chart:
- Monthly Revenue: **Bar / Line / Area**
- Costs by Category: **Doughnut / Pie / Bar**

Each panel also has a **Reset to defaults** button that wipes only that widget's
overrides (other widgets untouched).

### Calculation transparency

The settings panel includes a collapsible **"What's in this number?"** section showing:
- **Formula** — the exact calculation in plain English
- **Includes** (green) — which DB tables/rows feed the number
- **Excludes** (red) — what's deliberately left out (e.g. travel-expense
  reimbursements are always excluded from income widgets)

The same panel is reachable from the Customize modal via the &#9432; on each row,
so you can decide what to show without enabling a widget first.

### Storage shape

Preferences are stored as a single JSON blob keyed at `id=1`:

```json
{
  "dashboard": {
    "range":          "30d",
    "widgets":        ["income-ytd", "profit-ytd", "net-salary", ...],
    "order":          ["profit-ytd", "income-ytd", ...],
    "widgetSettings": {
      "income-ytd":      { "color": "green", "size": 2 },
      "revenue-chart":   { "chartType": "line", "size": "tall", "width": "full", "showLegend": true },
      "recent-invoices": { "rowCount": 8, "width": "half" }
    }
  },
  "reports": {
    "widgets": ["quarterly", "vat", "tax", "sheets", "accountant-package"],
    "order":   ["tax", "vat", "quarterly", "sheets", "accountant-package"]
  }
}
```

Adding new preference categories (filters, theme, etc.) doesn't require a schema
change — extend the JSON shape on the frontend. Old `dashboard.chartTypes.{id}`
prefs auto-migrate into `dashboard.widgetSettings.{id}.chartType` on first load
of the new client.

---

## 🤖 AI Chat (Local LLM via Ollama)

**Where:** 💬 button (bottom-right) or **Cmd+K / Ctrl+K**

Natural-language interface to your finances. Auto-classifies questions as either:
- **Data queries** → routed to safe tool calling (no raw SQL)
- **Knowledge queries** → answered from PAYROLL_NOTES.md / FEATURES.md / GUIDE.md

### Setup (one-time)

```bash
brew install ollama
brew services start ollama
launchctl setenv OLLAMA_KEEP_ALIVE -1   # keep model in memory forever
ollama pull qwen2.5-coder:7b             # main brain (~4.5 GB)
ollama pull llama3.2-vision:11b          # optional, for receipt scanning
brew services restart ollama
```

### Features

- **Streaming responses** — tokens appear live with a blinking cursor
- **Conversation memory** — last 12 messages kept; "how about last year?" follows up properly
- **🔄 Clear button** to reset conversation
- **Tool transparency** — every answer shows which tool was called and the raw data (collapsed)
- **Quick suggestion chips** for common queries

### Available tools (the model picks one per question)

**Read tools**

| Tool | Purpose |
|------|---------|
| `search_bills` | Filter company bills by year/vendor/category/status |
| `search_expenses` | Filter travel expenses by year/category |
| `list_obligations` | List GmbH obligations (AHV, BVG, taxes, KTG, UVG) |
| `get_runway` | Cash balance + monthly burn + runway in months |
| `top_vendors` | Top vendors by total spend |
| `dashboard_summary` | YTD income / costs / profit / overdue **on BOTH cash AND accrual basis**. Returns `income_ytd_cash`, `income_ytd_accrual`, `profit_ytd_cash`, `profit_ytd_accrual`, `receivables_outstanding` and a `_basis_note` explaining when to use which. Use accrual for OR 725a, dividend capacity, equity tests. |
| `receivables_summary` | Every unpaid invoice with ageing (days overdue) and total CHF outstanding. Stops the model confabulating receivables figures. |
| `dividend_capacity` | Distributable profit for an interim dividend per OR 675a. Returns accrual YTD P&L, mandatory reserve allocation, tax math (Verrechnungssteuer 35 % + Teilbesteuerung ~10 %), and whether `interim_dividend_possible: true/false`. |
| `invoice_summary` | Invoice totals by year (count, paid amount) |
| `budget_balances` | (legacy AI tool — sinking funds removed 08/2026; returns empty) |
| `payslip_summary` | Payslip totals by year |
| `search_transfers` | Personal ↔ GmbH transfers + lifetime net owed |

**Write tools (all confirmation-gated)**

| Tool | Purpose |
|------|---------|
| `propose_action` | Mark an invoice / bill / obligation paid or unpaid. Returns an Apply / Discard card. Allowed actions: `mark_invoice_paid`, `mark_invoice_unpaid`, `mark_bill_paid`, `mark_bill_unpaid`, `mark_obligation_paid`, `mark_obligation_unpaid`. |
| `propose_add_expense` | Propose adding a new travel expense (date, description, amount, category). Validates input, returns Apply card. Category must be one of Meals / Transport / Accommodation / Fuel / Connectivity / Other. |
| `propose_add_bill` | Propose adding a new vendor bill / recurring charge (date, vendor, description, amount, category, due_date, recurrence). |
| `propose_mark_invoice_paid` | Propose marking a specific invoice paid with an explicit `paid_date` — different from `propose_action` because the cash receipt date lets the cashflow timeline plot the actual receipt correctly. |

The chat UI handles two payload formats:
- **JSON** (`PATCH` to status endpoints) — for `propose_action` and `propose_mark_invoice_paid`
- **Form-encoded** (`POST` to create endpoints) — for `propose_add_expense` and `propose_add_bill`

The `format` field on the proposal tells the UI which to use.

**Confirm-step flow:** any time the chat returns a proposal card, you'll see
the exact endpoint + payload that would fire, plus a human description of the
target row (number, period, amount, current status). Click **Apply** to run it,
**Discard** to cancel. Nothing hits the DB until you click Apply. Insert /
delete tools are deliberately not exposed.

### Switch providers (env vars)

```bash
LLM_PROVIDER=ollama|anthropic|openai
OLLAMA_URL=http://localhost:11434
OLLAMA_TEXT_MODEL=qwen2.5-coder:7b
OLLAMA_VISION_MODEL=llama3.2-vision:11b
ANTHROPIC_API_KEY=sk-ant-...     # if using anthropic
OPENAI_API_KEY=sk-...             # if using openai
OPENAI_BASE_URL=https://...       # any OpenAI-compatible endpoint
```

### Safety

- Only the predefined tools can be called (no SQL injection possible)
- Input args are type-coerced + validated before tool execution
- Tool results capped + truncated for prompt safety
- **All write actions are confirmation-gated** — no tool mutates the DB directly; the chat always shows an Apply / Discard card
- **Model-size warning banner** — when running a local Ollama model under ~14B params (e.g., `qwen2.5-coder:7b`), the chat panel shows a yellow banner explaining that tool-calling will be unreliable on small models (confabulated numbers, failed JSON, missed tool selection). Recommends upgrading to `qwen2.5-coder:32b` / `llama3.3:70b` or switching to `LLM_PROVIDER=anthropic`. Auto-hidden for larger local models and any cloud provider.
- Knowledge mode reads only from `*.md` files in project root

---

## 💰 Cash Balance & Runway

**Where:** Dashboard (Bank recap tile) and Forecast page

Tracks GmbH bank balance and projects months until cash runs out.

### Calculation

```
Monthly burn = recurring bills (normalized monthly)
             + unpaid obligations (spread over 12 months)
             + total employer cost from payroll settings
             − average monthly invoice income (last 6 months)

Runway = Current balance ÷ Monthly burn
```

### Visual thresholds
- 🟢 ≥ 6 months — healthy
- 🟡 3–6 months — amber warning
- 🔴 < 3 months — red alert
- ∞ — cash positive (no burn)

---

## 📊 Reserve Health Forecast — REMOVED (08/2026)

Projected the personal sinking funds 12 months ahead. Removed together
with the Budget Balances page; the Cash Allocation waterfall and the
month-by-month plan cover the same question for GmbH money.
---

## ⚠ Anomaly Detection

**Where:** Dashboard widget (toggle via Customize)

Flags bills that significantly deviate from a vendor's historical average.

### Detection logic
- For vendors with ≥3 bills, compute mean of previous bills
- Flag current bill if deviation ≥20% AND difference ≥CHF 10
- Severity: High (≥50% deviation) or Medium (20–50%)

### Example
> ⚠ Mac Leasing usually CHF 250.00 (based on 8 bills) but this one is CHF 320.00 (+28%) on 2026-04-15.

### Actions
- ✓ — mark as reviewed (won't show again)
- ✎ — open the bill to inspect/edit

---

## 🏦 Bank CSV Import

**Where:** Bills & Documents → "Bank CSV" button

Upload a bank statement and auto-match against existing bills/invoices/obligations.

### Expected CSV format
- Date column (`Date` / `Buchungsdatum` / `Valuta`)
- Description column (`Description` / `Beschreibung` / `Text` / `Libellé`)
- Amount column (`Amount` / `Betrag` / `Montant`)
- Comma or semicolon separator, Swiss format `1'234.56` supported

### Matching
- **Negative amounts** → matches unpaid bills/obligations within ±CHF 0.50
- **Positive amounts** → matches unpaid invoices, or offers to log as income

---

## 🏦 UBS Bank Statements (PDF + CAMT.053 XML + UBS native CSV)

**Where:** Banking → Bank Statements (nav sidebar) · 🏦 widget on Dashboard

Long-term storage for official monthly bank statements. Each period accepts
**both a PDF (official) AND a machine-readable file** — either CAMT.053 XML or
UBS's native CSV transaction export. Both file types are auto-detected by
content (XML starts with `<`, otherwise treated as CSV) and the CSV doesn't
need a separate slot.

All files go to Treuhand in the accountant_package ZIP; the machine-readable
file also lets the app auto-fill fields, list per-transaction details, and
emit analyzer proposals.

Distinct from the one-shot "Bank CSV Import" above — this is the permanent
audit-trail archive plus the cash-balance anchor for the Cashflow Timeline.

### Upload form

Two file inputs side by side:
1. **PDF statement (official)** — the document Treuhand and the tax authority recognize
2. **XML / CAMT.053 / CSV** — when selected, triggers `/api/bank-statements/parse-xml` (XML only) which auto-fills period, IBAN, currency, opening + closing balance. CSV files are stored verbatim; the form fields can be filled manually using the values from the CSV header (or the analyzer can be run after save).

The preview line shows what was extracted before save:
> ✓ Auto-filled from XML — 📅 2026-05-01 → 2026-05-31 · 🏦 CH00… · CHF · open 4'847.00 · close 5'365.47 · 1 transactions

User can override any field manually before saving.

### CAMT.053 parser

`helpers.parse_camt053(xml_bytes)` — namespace-agnostic ElementTree parser that
extracts:

| Field | Source in XML |
|---|---|
| `iban` | `<Stmt>/<Acct>/<Id>/<IBAN>` |
| `currency` | `<Stmt>/<Acct>/<Ccy>` |
| `period_start` / `period_end` | `<Stmt>/<FrToDt>/<FrDtTm>` / `<ToDtTm>` |
| `opening_balance` | `<Bal>` with `<Cd>OPBD</Cd>` (or `OPAV` as fallback) |
| `closing_balance` | `<Bal>` with `<Cd>CLBD</Cd>` (overrides `CLAV` if both present) |
| `transaction_count` | count of `<Stmt>/<Ntry>` |

Handles multiple ISO 20022 namespace versions (`camt.053.001.04`, `.08`, etc.).

### UBS native CSV parser

`helpers.parse_ubs_csv(csv_bytes)` — handles UBS Business Current Account CSV exports:

- UTF-8 with BOM (auto-detected, falls back to latin-1)
- Semicolon-delimited
- 8 metadata header lines (Account, IBAN, From, Until, Opening, Closing, Currency, Transaction count)
- Transaction header starting with `Trade date`
- **Multi-order sub-entries**: rows with no Trade date but an Individual amount are attached as `sub_entries[]` of the previous main row (UBS uses this for grouped payments like rent + utilities in one e-banking order)
- Swiss number format (`1'234.56`) auto-converted to standard decimal

Returns:
```python
{
  "header": {Account, IBAN, From, Until, Opening balance, Closing balance, ...},
  "transactions": [
    {trade_date, booking_date, value_date, currency, amount (signed),
     balance, transaction_no, description1/2/3, sub_entries[]},
    ...
  ]
}
```

### File endpoint

```
GET /api/bank-statements/{id}/file?format=pdf   # default
GET /api/bank-statements/{id}/file?format=xml   # serves XML *or* CSV (the same slot)
```

Files stored hash-based in `documents/bank_statements/` — same file content
uploaded twice resolves to the same blob, saving disk and preventing duplicates.

### Inline-expand row → transactions table

**Click any bank statement row** → expands inline to show every parsed transaction.
Chevron toggles ▶ ↔ ▼.

```
▼  2026-02-13 → 2026-06-19   UBS   GmbH Main CHF   0.00   1,137.35   ...
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Source: UBS CSV · Open 0 · Close 1,137.35 · In +48k · Out −47k · …  │
   │                                          [All] [In only] [Out only] [⬇ CSV] │
   │  Date         Counterparty           Description       Amount  Balance     │
   │  2026-06-19   Max Muster  multi e-banking  -1,000.00  1,137.35  │
   │  2026-06-16   multi e-banking        multi e-banking  -2,793.85  2,137.35  │
   │     └─        Strassenverkehrsamt    QRR: 80 0045...    -541.25            │
   │     └─        AXA Insurance Ltd      QRR: 44 2045...  -2,252.60            │
   │  ...                                                                       │
   └─────────────────────────────────────────────────────────────────────┘
```

Features:
- Filter buttons: **All / In only / Out only**
- Multi-order **sub-entries indented** under their parent row
- Color-coded amounts (green credits, red debits)
- Running balance column
- Transaction number for cross-reference with UBS e-banking
- Lazy-loaded (transactions fetched only when row expands)
- Multiple rows can be expanded simultaneously

### Clean CSV export

In the expanded panel, top-right: **⬇ CSV** button. Downloads a normalized
CSV that's much cleaner than UBS's native format:

| | UBS native | Clean export |
|---|---|---|
| Separator | `;` | `,` |
| Number format | Swiss `1'234.56` | Standard `1234.56` |
| Amount columns | Two (Debit / Credit) | One signed column |
| Sub-entries | Spread, no link | Own row, linked via `Parent Tx No.` |
| Header rows | 8 metadata + blank | 1 column header line |
| Encoding | UTF-8 BOM | UTF-8 BOM (Excel-friendly) |

Endpoint: `GET /api/bank-statements/{id}/transactions.csv`
Columns: Date · Value Date · Amount · Currency · Counterparty · Description · Reference · Transaction No. · Parent Tx No. · Balance · Is Sub-Entry

Filename includes the period: `bank_transactions_2026-02-13_to_2026-06-19.csv`

### Dashboard "Latest balance" widget

Shows the closing balance from the most recent statement, with:
- Bank + account label
- "As of" date and age in days (turns red if > 45 days → prompt to upload latest)
- Quick link to the Bank Statements page

Hidden if no statement uploaded yet (shows a one-line "Upload your first
statement →" prompt instead).

### Treuhand ZIP integration

The accountant-package ZIP includes a `bank_statements/` folder with:
- `_summary.csv` (period, balances, file names)
- Each PDF as `{period_end}_{account_label}.pdf`
- Each XML/CSV as `{period_end}_{account_label}.{ext}`

Both files for the same period are side-by-side so Treuhand sees the official
record + the machine-readable data together.

---

## 🧭 Bank Statement Expanded View — Personal ↔ GmbH Flow

**Where:** Bank Statements → click any row with XML/CSV to expand.

Three analytical panels appear above the raw transaction list, each answering a specific question about the statement.

### 1. Net flow with counterparty (excluding salary)

Answers: *"Outside of my regular paycheck, how much money moved between this account and the other party?"*

**Auto-detects account side.** Counts counterparty-name hits — if the employee name (from Payroll settings) appears more than the employer name (Muster Consulting), this is the GmbH's account (paying the employee out); if reversed, this is the personal account (receiving salary from Muster Consulting). Labels and math flip accordingly.

**Filters out intra-company transfers.** On the GmbH account, `Muster Consulting GmbH` appearing as counterparty is an inter-account movement (Sperrkonto → operating, savings → checking) — auto-excluded with a transparent "Auto-excluded: N intra-company transfer(s)" callout.

**Salary detection (direction-agnostic).** A transaction counts as salary if `abs(amount)` is within ±10% of the configured net salary AND the day-of-month is within ±7 of the configured payday. Works whether salary comes IN (personal account) or goes OUT (GmbH account).

**First-name-token matching** on the employee counterparty avoids false positives — a relative with a shared surname (e.g. "A. M. M. Muster Demonteil") does NOT match "Max Muster" because "Max" doesn't appear.

**Per-transaction Ignore / Restore.** Every transaction has an inline Ignore button — click to permanently exclude from the calculation (e.g. founding capital injection, one-off reimbursement). Persisted in `localStorage` keyed by `date|amount|counterparty` so the exclusion survives refreshes.

**Headline breakdown:**
```
Total flow with [counterparty]       (raw sum, before adjustments)
− Salary paid/received               (detected only — never phantom "expected")
= Net non-salary flow                (the answer)
```

### 2. Obligations reconciliation

Answers: *"Which of my tracked AHV/BVG/VAT/tax obligations did this statement pay? Which are still unpaid? What large outflows aren't tracked as obligations?"*

**Match scoring** — each obligation gets scored against each outflow:
- Amount within ±CHF 5 or ±1% (whichever is larger) — required
- Payment date within 30 days of due date
- Counterparty keywords per obligation type — see table below

**Counterparty keyword map** (`_OBLIGATION_KEYWORDS`, now in `static/js/03-bank.js`):

| Obligation type | Keywords matched (case-insensitive substring) |
|---|---|
| `ahv` | ahv, avs, ausgleichskasse, sva, compensation, caisse |
| `bvg_employee` / `bvg_employer` | bvg, lpp, pension, axa, swisscanto, zurich, allianz, pensionskasse, sammelstiftung |
| `corporate_tax_federal` | estv, eidg, bundessteuer, steuerverwaltung |
| `corporate_tax_cantonal` | kanton, steueramt, steuerverwaltung |
| `vat` | estv, mwst, vat, tva, iva, steuerverwaltung |

**Global greedy assignment.** All candidate `(obligation, outflow)` pairs are scored (`100 * cptyMatch − 2 * dateDiff`) and sorted globally. Best score wins. Prevents the loop-order bias where a weak-counterparty obligation would grab an outflow that fits a stronger candidate. Fallback matches without counterparty hint require date within ±7 days.

**Three panels shown** with color dots:
- 🟢 **Matched** — obligation reconciled to a bank outflow. Shows counterparty, days gap, obligation status.
- 🔴 **Unpaid due in period** — obligation due within statement dates, no matching outflow. Action-item list.
- 🟡 **Untracked large outflows** — bank outflow ≥ CHF 500, not routine payroll/tax, no matching obligation. Nudges to add these as tracked obligations or bills.

**One-click "Mark paid"** — matched obligations with `status='unpaid'` show a button that PATCHes `/api/obligations/{id}/status` to `paid` without opening the reserve-picker dialog (bank already confirms payment). Updates both the reconciliation and the main obligations cache.

**CSV export** — `⬇ CSV` button downloads `reconciliation_[start]_to_[end].csv` with 4 logical sections stacked (`Matched`, `Unpaid due in period`, `Untracked outflow`, `Possible duplicate` / `Recurring`). Standard CSV escaping. Filename includes statement period. Format designed for Treuhand's annual close review.

### 3. Possible-duplicate detector

Answers: *"Did any charge get billed twice by mistake?"*

**Cluster logic** — same normalized counterparty + same absolute amount (rounded to 2 dp), same direction (both in or both out), ≥ CHF 20, at least two entries within a 60-day rolling window. Sub-entries are included in the scan.

**Recurring vs suspicious distinction** — median gap between charges classifies the cluster:
- 25-35 days → badged `recurring?` (probably a monthly subscription — safe, low priority)
- Any other cadence → badged `suspicious` (uneven charge, worth reviewing)

Sorted with suspicious clusters first. Feeds into the CSV export too, so Treuhand can filter on Section `= "Possible duplicate"` during the annual close.

## 📊 Cross-statement Kontokorrent (Bank Statements page top)

**Where:** Bank Statements page, above the statements table.

**What it shows:** Running non-salary flow between GmbH and personal account **across all uploaded statements**. Sums the "Net non-salary flow" figure from every statement into a cumulative IOU balance.

- Green `+CHF X → personal` = you owe the GmbH (non-salary money you took out that hasn't been settled)
- Red `−CHF X ← GmbH` = GmbH owes you (reimbursements, advances, pending dividends)
- Zero = balanced

**Per-statement breakdown** in a collapsible `<details>` — see each statement's contribution to the running total plus how much salary was excluded.

**Cache** keyed by sorted list of statement IDs. Invalidated automatically when statements are added / deleted. Statements already in memory (from expanded rows) don't re-fetch transactions.

This mirrors what Treuhand books as the **Verrechnungskonto (Kontokorrent)** — the shareholder-current-account balance. A number every founder-GmbH needs to know but almost never sees clearly.

## 🔍 Bank Statement Analyzer (script-based, no AI)

**Where:** Click 🔍 on any bank statement row → opens proposal-review modal

Reads the stored CSV/XML file and emits a list of proposed data corrections —
new bills to add, invoice payments to mark, shareholder loans to record, vehicle
purchases to register. **Pure Python pattern matching, no LLM involved.**

### How it works (no AI)

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. routes/bank.py / analyze_statement()                            │
│    Loads the CSV/XML file from disk                                │
├────────────────────────────────────────────────────────────────────┤
│ 2. parse_ubs_csv() or parse_camt053()                              │
│    Returns structured {header, transactions[]}                     │
├────────────────────────────────────────────────────────────────────┤
│ 3. Pattern matching loop  ← hardcoded if/elif rules                │
│    For each transaction, walks through known patterns:             │
│      "acme"       → mark_invoice_paid                             │
│      "juin de fa…" → shareholder_loan (credit) / salary (debit)    │
│      "zeroshtat"   → add_vehicle                                   │
│      "muster consulting"+ "freigabe" → info_only (share capital)        │
│      "notariat"    → add_bill, category=Professional Services      │
│      "axa"         → add_bill, category=Payroll Settlement         │
│      "helvetia"    → add_bill, category=Insurance                  │
│      …                                                             │
│    (full vendor → category map in routes/bank.py:VENDOR_CATEGORY)  │
├────────────────────────────────────────────────────────────────────┤
│ 4. Returns list of proposals with: type, summary, payload,         │
│    endpoint, method, format, confidence, notes                     │
└────────────────────────────────────────────────────────────────────┘
```

**Total LLM tokens consumed: zero.** Deterministic, free, instant.

### Proposal types

| Type | Action when applied | Endpoint |
|---|---|---|
| `add_bill` | New row in `company_docs` with status=paid | `POST /api/accounting` |
| `add_vehicle` | New row in `vehicles` with auto-Privatanteil 0.9 %/mo | `POST /api/vehicles` |
| `add_shareholder_loan` | New row in `shareholder_loans` (Rangrücktritt unknown by default) | `POST /api/shareholder-loans` |
| `mark_invoice_paid` | Updates `invoices.paid_status` + `paid_date` from bank | `PATCH /api/invoices/{id}/status` |
| `info_only` | No action — surfaced for awareness (e.g., salary fragments, refunds, share capital release) | — |

### Confidence levels

| Level | Meaning | Modal default |
|---|---|---|
| `high` | Pattern matches a known vendor + clear amount | **checked** |
| `medium` | Plausible but needs review (unknown vendor matched generically, or amount ambiguous) | unchecked |
| `low` | Generic credit/debit that could be many things (e.g., refund vs. new income) | unchecked |

### Proposal-review modal

Triggered by 🔍 on each bank statement row.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Review proposals                                              [Close]    │
│ Source: UBS CSV · 26 transactions parsed · 25 proposals                  │
├──────────────────────────────────────────────────────────────────────────┤
│ ☑ Select all      14 of 21 actionable proposals selected   [Apply (14)]  │
├──────────────────────────────────────────────────────────────────────────┤
│ ☑  [Add bill]    Bill Strassenverkehrsamt: CHF 541.25 on 16.06           │
│    ● high        💡 From multi-order tx no. ...                          │
│                  POST /api/accounting                                    │
│ ☐  [Add bill]    Bill digitec Galaxus: CHF 305.80 on 08.05               │
│    ● medium                                                              │
│ —   [Info only]  Share capital release: CHF 20,000 on 13.02              │
│    ● high        (no action — this IS the share capital being booked)    │
│ ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Per-proposal:
- **Checkbox** (only for actionable proposals) — high-confidence defaults to checked, medium/low unchecked
- **Type badge** (color-coded by action type)
- **Confidence dot** (green/orange/red)
- **Notes** in italic (caveats, e.g., "Needs Rangrücktritt paperwork for OR 725a/b protection")
- **Endpoint preview** so you see exactly what will fire

**Apply selected** runs proposals sequentially, showing per-row status:
- `Applying…` while in-flight
- `✓ Applied` on success (turns green, row becomes uneditable)
- `✗ Failed` with error tooltip on failure

After completion, refreshes Bank Statements / Invoices / Accounting / Dashboard
lists automatically.

### When AI WOULD add value

The script handles ~85 % of typical proposals correctly. AI could improve:

| Case | What AI would do |
|---|---|
| Unknown vendor | Suggest a category from the description |
| Refund vs. new income | Match a credit to a recent debit from the same counterparty |
| Salary fragments | Allocate CHF 9,200 + 1,800 across "net salary + reimbursement + Privatanteil" |
| QR-bill reference matching | Read the structured reference and find the matching invoice in DB |

Add by either:
- **Post-processing low-confidence proposals** with an LLM call
- **Falling back to LLM only for unknown vendors** (cheap — one call per *new* vendor)

Both ~30-60 min to bolt on if needed.

---

## 🇨🇭 Swiss QR-bill Scanner

**Where:** Add Document form → "🔍 Scan Swiss QR-bill" button

Snap or upload a Swiss QR-bill image; auto-fills vendor, amount, currency, description, and due date (+30 days).

### Setup (one-time)

```bash
brew install zbar
.venv/bin/pip install pyzbar
```

Without setup: button appears, server returns clear install instructions on click.

---

## 📱 Quick-add Mobile Page

**Where:** `/quick` URL or sidebar footer "📱 Quick add (mobile)" link

Stripped-down form optimized for phones. One-screen UI with:
- Tab switcher: Travel Expense / Company Bill
- Date (defaults today), Amount, Description, Category
- Big photo-capture button using `capture="environment"` (opens camera directly)
- No sidebar, no navigation — single-purpose

---

## 📊 Google Sheets Sync

**Where:** Reports page → "Google Sheets sync" collapsible section

Live URLs that auto-refresh in Google Sheets via `=IMPORTDATA(url)`.

### Available feeds
- Invoices CSV
- Bills CSV
- Travel Expenses CSV

Requires a share link to be created first (Bills & Documents → Share button). Paste the formula into any Sheets cell — refreshes hourly.

---

## 📅 Dynamic iCal Calendar Feed

**Where:** `https://your-app/share/{TOKEN}/calendar.ics`

Subscribe from any calendar app (iPhone, Google Calendar, Outlook). Always live — auto-refreshes hourly.

### What's included (with reminder alarms)
- 💳 Unpaid bills (alarm 3 days before)
- 🏛 Unpaid obligations (alarm 7 days before)
- 💰 Unpaid invoices (alarm 3 days before)
- 📊 Monthly budget contribution reminder (1st of each month)
- 📋 Quarterly VAT filing deadlines (alarm 14 days before)

---

## 💼 Payroll System

**Where:** Payroll page (in GmbH Finances section)

Full Swiss payslip generator — see [PAYROLL_NOTES.md](PAYROLL_NOTES.md) for the policy details.

### Features
- Configurable rates: AHV, ALV (with plafond), BVG, UVG, KTG, FAK, source tax
- Monthly payslip PDF generation
- YTD totals with automatic accumulation
- 3 opt-in side effects per payslip:
  - Log income entry (net salary)
  - Log transfer (GmbH → Personal)
  - Create 4 obligations (AHV/ALV, BVG, UVG, KTG)
- Status toggle (issued ↔ paid)
- Regenerate refreshes only the PDF, not side effects (no duplicates)

---

## 🛡 Travel Expense Isolation

Travel expenses are **reimbursable client costs** and explicitly excluded from:
- Cash Allocation earmarks
- Forecast page / runway
- P&L operating costs (P&L Excel has a separate "TRAVEL (PASS-THROUGH — NOT IN P&L)" section)

### Why
You pay vendor → bill client via yearly expense report → client reimburses. Net impact on P&L is zero, so they're tracked separately.

The P&L now shows a **travel pass-through** block:
- Expenses paid YTD
- Reimbursed by client YTD
- **Net outstanding** (what client still owes you)

### Upload pipeline
- **HEIC support** — iPhone HEIC photos are auto-converted to JPG server-side via `pillow_heif` so the browser thumbnail works. The conversion happens on upload; the original HEIC is never stored.
- **Hash-based filenames** — receipt scans land as `exp_<sha1[:10]>.<ext>`. Re-uploading the same file resolves to the same blob (no duplicates). Delete only unlinks the file if no other expense row references it.
- **Categories**: Meals, Transport, Accommodation, Fuel, Connectivity, Other (Fuel + Connectivity added 2026-06)

---

## ✈ Business Trips

**Where:** ✈ Trips (nav sidebar)

Groups expenses by a single travel event. Each trip has a name, purpose, date
range, countries, and notes. The Spesenabrechnung view becomes per-trip
instead of per-date-range.

### CRUD page

| Column | Notes |
|---|---|
| # | Trip id |
| Name + purpose | |
| Dates | start → end |
| Countries | comma-separated |
| Expenses | live count |
| Total (CHF) | sum of linked expenses |
| Actions | 🔍 view expenses · 🔗 auto-assign · ✏️ edit · 🗑 delete |

### Auto-assign

Click 🔗 on a trip → all unassigned expenses whose `expense_date` falls inside
the trip window are linked in one operation. Idempotent — won't reassign
already-linked expenses.

### Wired into Expenses page

- **New filter dropdown** "Trip:" with options "All / (no trip) / each trip"
- **New field on the expense form** "Trip (optional)" — assign on create or edit
- Each expense row carries `trip_id` from the API; filter applies client-side

### Reports

Today: per-month or per-year report (covers any trip whose dates intersect
that period). Per-trip-only PDF generation is a planned extension — would
allow one Spesenabrechnung per trip regardless of date window.

---

## 💰 Reserves / Sinking Funds (Dashboard Widget + CRUD)

**Where:** Dashboard (between stats and charts)

Each reserve has a target amount, target date, monthly accrual, and "accumulated
manual" (one-shot adjustments / prior payments). The widget computes
`accumulated = months_elapsed × monthly_accrual + accumulated_manual` and
shows progress bars:

- 🔵 Blue: under 95 % accrued
- 🟢 Green: ≥ 95 %
- 🔴 Red: overdue (target_date past + remaining > 0.5)

### Header summary
`accrued CHF X of Y · monthly accrual CHF Z` — single-glance status across all
buckets.

### + Add / ✏️ Edit / 🗑 Delete modals
Full CRUD via `routes/reserves.py`:
- `GET/POST/PUT/DELETE /api/reserves`
- `GET /api/reserves/summary`

### Seeded buckets

| Bucket | Target | Due |
|---|---:|---|
| AXA payroll settlement FY2026 | 3,480 | 11.06.2026 |
| Treuhand FY2026 accounting | 5,000 | 31.01.2027 |
| Gewinnsteuer FY2026 | 5,000 | 31.03.2027 |
| Kapitalsteuer FY2026 | 100 | 31.03.2027 |

Distinct from **Reserve Health Forecast** (above) and **Budget Balances**
(below) which are different abstractions:
- *Reserve Health Forecast* — 12-month projection of existing budget categories
  vs. matched bills
- *Budget Balances* — interactive sinking funds with ledger entries (Car, Wine, etc.)
- *Reserves / Sinking Funds (this section)* — declarative monthly accruals
  toward dated FY-close obligations

---

## 📈 Cash-flow Timeline (Dashboard Widget)

**Where:** Dashboard (between Reserves and charts)

180-day SVG line chart of projected GmbH bank balance, day by day. Models:

- Invoice cash receipts (with configurable lag, default 30 days from issue)
- Monthly net + employer-side payroll
- Monthly recurring bills + annual bills (AXA, Treuhand)
- Quarterly VAT due dates (Q1-Q4)

Skips travel-expense reimbursement invoices and Payroll-Settlement bills to
avoid double-counting against the monthly salary accrual.

### Chart features

- Blue line = projected balance
- Red shading below the zero line (immediate visual cue for cash crunch periods)
- Dashed green "today" marker
- X-axis ticks on the first of each month
- Header strip: End balance · Lowest balance + date · Highest balance + date

### Endpoint

```
GET /api/cashflow?horizon_days=180&opening_balance=0&payment_lag_days=30
```

Returns `series` (daily balance points), `events` (every transaction with
running balance), `lowest`, `highest`, `end_balance`.

### Status today

`opening_balance=0` (anchored to nothing — purely projection from invoice
cadence). Future enhancement: anchor to the latest Bank Statements closing
balance for an actuals-based starting point.

---

## 💵 Cash Allocation (replaced Budget Balances, 08/2026)

**Where:** Cash Allocation page (GmbH Finances)

One planning page for all GmbH cash, three sections:

1. **Waterfall** — real bank balance (fresher of manual entry / latest
   statement) − earmarked reserves − obligations due next 30 days =
   **Free cash** (green) or **Over-allocated** (red notice). Stale-balance
   warning after 3 weeks.
2. **Envelopes** — GmbH reserves as virtual cash envelopes (the money
   stays at UBS): *Future obligations (2027 bills)* (consolidated pot for
   AHV settlement, QSt Q4, BVG Q4, VAT Q4, corporate taxes, Treuhand,
   April UVG/KTG), *Equipment & Laptops*, *Savings buffer*. Each card:
   meter, auto-accrual chip, inline **Add / Take** movements — recorded in
   the `reserve_ledger` audit table.
3. **Month-by-month plan** — informal cards (see Payroll section) merged
   here: per remaining month, net salary + obligations by real cash date
   + per-item month selectors ('Spread /N' or a specific month, persisted
   in Prefs) + an 'Equal months' checkbox that levels every card.

### Pay bills & obligations from an envelope
The Mark-as-Paid dialog offers the GmbH reserves with a smart suggestion
(hardware → Equipment, taxes → Future obligations). Confirming marks the
item paid AND logs a reserve withdrawal named after it.

> The old personal sinking-funds system (Car/Wine/… with monthly
> contributions and its Reserve Health Forecast) was removed in 08/2026.

---

## ⏳ Global Loading Bar

Top-of-page progress bar that animates during any API call. No configuration.

---

## 📁 Collapsible Sections

Reusable pattern with auto chevron arrow. Used on:
- Payroll page → "Payroll setup reference"
- (formerly) Budget Balances → "Reserve health forecast"
- Reports → "Google Sheets sync"

---

## ⌨ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus this page's search bar (Bills & Documents, Invoices) |

**Display setup per page** — every page with two or more sections gets a ⚙ *Display* button in its header; switch sections off/on (saved per user in Preferences under `panels.<page>`; "Show everything" resets).
| `Cmd+K` / `Ctrl+K` | Toggle AI chat |
| `?` | Show shortcut sheet |
| `Esc` | Close modals |
| `g d` | Dashboard |
| `g o` | Forecast |
| `g r` | (removed — was Budget Balances) |
| `g b` | Bills & Documents |
| `g o b` | Obligations |
| `g p` | Payroll |
| `g i` | Invoices |
| `g t` | Transfers |
| `g n` | Income |
| `g c` | Customers |
| `g e` | Travel Expenses |
| `g x` | Reports |
| `n i / n b / n e / n o / n t` | New invoice / bill / expense / obligation / transfer |
| `c a` | Contribute All reserves |
| `c c` | Update cash balance |
| `t` | Toggle theme |
| `q` | Quick-add mobile page |
| `b` | Download backup |

---

## 🎨 UI Polish

### Mobile-first tweaks (<640px)
- Touch targets ≥44×44 (Apple HIG)
- Form inputs at 16px font (prevents iOS zoom)
- Larger sidebar nav, table cells, bill cards

### Dark mode
- Full dark theme with WCAG-compliant badge contrast
- Chart.js colors auto-adjust on theme toggle
- Tooltip backgrounds adapt

### Animations
- 600ms `easeOutQuart` on chart data updates
- Value flash animation when stat numbers change
- Skeleton loaders during data fetch

### Sortable dashboard widgets
- Drag any stat card to reorder
- Mobile defaults: focused 6-widget set
- Desktop defaults: full set
- Customize button to toggle individual widgets

### Empty states
Friendly cards with icon + title + descriptive message + action button. On every list page when no data exists.

### Better error messages
- Network errors: "Cannot reach server. Is it running?"
- 401: "Session expired — please log in again."
- 500+: "Server error: [detail]. Check the server logs."
- Pydantic validation: shows the exact field + reason

---

## 🛡 Confirm Before Revoke

All destructive ledger actions ask `confirm()` before deleting, plus offer an Undo toast for 5 seconds after.

---

## 📦 Backup & Sharing

### Backup
- Sidebar footer "💾 Backup" → downloads ZIP with `invoices.db` + all documents
- Restore: replace files manually

### Shared links
- Generate per-section share links (Bills & Documents → Share)
- Each gets a tokenized URL
- Read-only HTML view at `/share/{token}` with banner
- Yearly bills/expenses/invoices CSVs at `/share/{token}/sheet/*.csv`
- Calendar feed at `/share/{token}/calendar.ics`
- Accountant package ZIP at `/share/{token}/zip` (accounting only)

### Accountant package ZIP (Treuhand handover)

**Where:** Reports → "Accountant Package" widget → "Download full package (ZIP)"
**Endpoint:** `GET /api/reports/accountant-package/{year}`
**Filename:** `Muster Consulting Accountant Package {year}.zip`

Comprehensive year-end bundle Treuhand needs to prepare the Jahresrechnung,
the Lohnausweis, VAT reconciliations, and any audit follow-up.

```
{year}/
├── invoices/
│   ├── _summary.csv
│   └── invoice_NNNN.pdf  ×N
├── accounting/
│   ├── _summary.csv
│   └── docs/{date}_{vendor}_{amount}.{ext}  ×N (when file attached)
├── payslips/
│   ├── _summary.csv
│   └── {year}-{mm}_Lohnabrechnung.pdf  ×N
├── travel_expenses/
│   ├── _summary.csv
│   ├── report_{year}-{mm}_NNNN.pdf  ×N (month-specific reports)
│   ├── report_NNNN.pdf  ×N (year-wide reports)
│   └── scans/{date}_{description}_{amount}.{ext}  ×N receipt scans
├── bank_statements/
│   ├── _summary.csv
│   ├── {period_end}_{account}.pdf  ×N
│   └── {period_end}_{account}.xml  ×N (CAMT.053 when uploaded)
└── obligations/
    └── _summary.csv
```

What's in each `_summary.csv` is what Treuhand would type into Abacus / Bexio
manually — having it as CSV cuts hours of re-entry.

Use the **Shared link** mechanism above to give Treuhand ongoing access at
`/share/{token}/zip` so they can pull the current ZIP at any time without
asking you for it.

---

## 🔗 How features connect

```
                ┌─────────────────────────────┐
                │   Cash Balance (manual)     │
                │   ↓                         │
                │   Runway (auto-computed)    │
                └──────────┬──────────────────┘
                           │ depends on
       ┌───────────────────┼───────────────────┐
       │                   │                   │
  Recurring bills   Unpaid obligations   Payroll cost
                                              │
                              Average invoice income
                              (last 6 months — excludes travel)
```

```
  Reserve Balances ─────┐
       │                 │
       │ projected +    │ matched against
       │ 12mo growth    │
       ▼                 ▼
  Reserve Health ◄──── Upcoming Bills (company_docs)
       │
       ▼
  Flagged shortfalls
```

```
  Bank CSV ──parse──► Row list ──match──► Existing records
                                               │
                                               ▼
                                    Mark paid OR log income
```

```
  Payslip ──┬──► PDF saved
            ├──► Income entry (net) [opt-in]
            ├──► Transfer GmbH→Personal [opt-in]
            └──► 4 obligations created [opt-in]
```

```
  AI Chat question ──► Classifier
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
        "knowledge"           "data"
            │                     │
            ▼                     ▼
       *.md docs            Tool selection
            │                     │
            ▼                     ▼
       Stream answer        Execute tool
                                  │
                                  ▼
                           Stream formatted answer
```

---

## 📂 Where each feature is stored

| Data | Table |
|------|-------|
| Cash balance | `cash_balance` (single row) |
| Budget reserves (interactive) | `budget_items` · `budget_ledger` |
| Sinking-fund reserves (dashboard widget) | `reserves` |
| Bills | `company_docs` |
| Obligations | `obligations` |
| Invoices | `invoices` |
| Income entries | `income_entries` |
| Payroll config | `payroll_settings` (single row) |
| Payslips | `payslips` |
| Transfers | `account_transfers` |
| Share links | `shared_links` |
| Customers | `customers` |
| Travel expenses | `expenses` (+ `trip_id` FK) |
| Travel reports | `expense_reports` (year + optional month) |
| Business trips | `trips` |
| Bank statements | `bank_statements` (one row per period, two file refs PDF + XML/CSV) |
| Bank transactions (future reconciliation) | `bank_transactions` (currently empty — reserved for persisted CAMT.053/CSV transaction-level data) |
| Vehicles owned by GmbH | `vehicles` (purchase price, depreciation method, Privatanteil amount) |
| Shareholder loans | `shareholder_loans` (Rangrücktritt status, direction, repayment tracking) |

All in `invoices.db` at the project root. Backup with the `Backup` button in the sidebar footer.

### Document storage paths

| Category | Filesystem |
|---|---|
| Invoice PDFs | `documents/invoices/` |
| Bill / accounting attachments | `documents/accounting/` |
| Travel receipt scans | `documents/expenses/scans/` (hash-named, dedup) |
| Travel expense reports (PDF + Excel) | `documents/expenses/reports/` |
| Payslip PDFs | `documents/payslips/` |
| Bank statements (PDF + XML) | `documents/bank_statements/` (hash-named, dedup) |

All paths can be redirected to a Google Drive Desktop folder by setting `DOCS_DIR` to e.g. `~/Google Drive/My Drive/Muster Consulting GmbH/` — files then auto-sync via the Drive Desktop daemon (Treuhand can be granted shared access to a subfolder).

---

## 🔮 Future ideas (not yet implemented)

### Higher value
- Cloudflare Tunnel auto-setup (script that runs the install + tunnel)
- ~~Auto-contribute prompt when loading Budget Balances~~ — obsolete (feature removed 08/2026)
- ~~Salary auto-paid detection from bank CSV~~ — partially done via the Bank Statement Analyzer (script-based, detects salary fragments)
- Tax provision tracker (running reserve based on YTD profit)
- PWA manifest for installable home-screen app
- **OR 725a equity-protection banner** — legal compliance auto-warning when equity drops below 50 % / below 0
- **VAT cadence widget** — auto-reminder of next VAT due date with computed amount
- **Insurance-gap detector** — cross-check `employment_start` vs UVG `policy_start`, surface uncovered days
- **Bank balance anchor on Cashflow chart** — anchor projection to latest bank statement closing balance instead of 0
- **Persist parsed bank transactions** — populate the `bank_transactions` table on upload so reconciliation history is queryable
- **Trip-level Spesenabrechnung PDF** — generate one report per trip (not just per month/year)
- **LLM-augmented analyzer** — fall back to LLM only for unknown vendors or ambiguous proposals; script handles the 85 % known-pattern case for free
- **Per-vehicle Privatanteil auto-line in payroll** — read `vehicles` table, add 0.9 % × purchase_price as a fringe-benefit line on each Lohnabrechnung
- **In-app LLM provider switcher** — Settings panel to toggle Ollama/Anthropic/OpenAI without env vars

### Nice-to-have
- Receipt OCR fallback (Tesseract) when LLM vision fails
- Voice input in chat (Web Speech API)
- Anomaly explanations from LLM ("Mac leasing usually 250, intentional?")
- Vendor history drill-down (click a vendor → see all bills + trend)
- Year-over-year P&L comparison
- Forecast next month's net cash with line chart
- **Personal safety net page** — KTG benefit/day, AXA contact, Hausarzt info, IV application URL in one screen
- **Liquidity floor alert** — red banner when projected cash < 1 month fixed costs
- **Lohn-vs-Dividende calculator widget** — interactive sliders showing the salary/dividend optimal split
- **Distributable profit dashboard widget** — running display of dividend capacity (computed from `dividend_capacity` tool)
- **Loss carryforward tracker** — record FY losses, auto-apply against future-year profits in the tax projection
- **Personal NOV reminder** — flag the ~CHF 19k personal tax owed beyond Quellensteuer, with reservation reminder
- **Entities table** — track the sole-prop `MUSTER SOLO VENTURES` (CHE-123.456.789) separately from Muster Consulting GmbH

### Operations
- Auto-nightly backup to iCloud Drive
- Audit log table tracking every modification
- Two-factor auth (TOTP) for shared sessions
- Read-only mode toggle in main UI
- **Email automation for monthly UBS statements** — IMAP poller that drops new statements into Bank Statements automatically (alternative to manual upload)
- **EBICS or UBS Connect API** integration for fully automated statement pull (requires UBS contract / API access)
- **Google Drive Desktop folder integration** — point `DOCS_DIR` at `~/Google Drive/...` for automatic sync to Treuhand shared folder

---

## 📅 Calendar (GmbH Finances → Calendar)

Month-grid view of every money event: obligations (blue), bills & documents (amber), payroll (green). Navigate with ‹ / Today / ›; category checkboxes filter both grid and totals.

- **Real vs expected** — solid chips are backed by a document (obligation file, bill scan, issued payslip PDF); clicking opens the PDF preview. Dashed/faded chips are expected: DB rows without a document, read-only projections of recurring bills/obligations, and future salary paydays (estimated from the latest net). Nothing is written to the DB for projections.
- Overdue unpaid items turn red; paid ones are struck through.
- Days with several events show a `= CHF …` day total; a footer bar shows the month total, and the list header shows "Month total … · still due …".
- Backend: `GET /api/calendar?start=&end=` (`routes/calendar_view.py`) aggregating obligations, `company_docs`, payslips, payroll settings and recurring templates.

## 💳 Company expenses paid with your personal card

Bills & Documents has a **Paid with** field: *Company account* (default) or *Personal card (GmbH owes you)* — stored as `company_docs.paid_via`.

- Purple 💳 *personal* badge in the bills list + "of which CHF X paid with personal card" subtotal.
- Feeds every "who owes whom" view: `/api/transfers/balance` (Transfers page, dashboard Kontokorrent tile), the cross-statement Kontokorrent card on Bank Statements, and the quarterly Excel export — which gains a **"Personal card" sheet** plus Summary lines ("Off-bank: company expenses paid by personal card", "Total costs incl. personal card") and a Kontokorrent line.
- Accountant ZIP CSV gains a "Paid via" column. AI chat `search_bills` accepts `paid_via` and returns `personal_card_chf`.
- P&L/VAT/cost totals are deliberately unchanged — a company expense is a company expense regardless of whose card paid it.

## ⬆ Accountant payslip upload + regenerate guard

**Upload Payslip** button on Payroll stores the accountant's official PDF (`POST /api/payroll/payslips/upload`).

- Existing month → the PDF replaces the generated one; stored numbers stay unless gross/net overrides are entered (then deductions = gross − net).
- New month → payslip row created: gross/net from the slip take precedence, contribution breakdown estimated from settings (noted as such). Indigo *accountant* badge (`payslips.source='uploaded'`); Calendar treats the month's salary as real.
- **Regenerate guard**: ↺ recomputes with *today's* settings. If gross/net would change (or an accountant PDF would be replaced), a confirmation shows the exact diff before overwriting.

## 🧾 VAT Tracker with simulated deductions (Reports page)

Effective method, quarterly, payment due 60 days after quarter end. Per quarter: `VAT due = output VAT (invoices) − recorded input VAT (bills with a VAT amount) − simulated input VAT − flat allowance`.

- **⚙ Deductions** dialog (stored in `vat_settings`): toggle simulation, assumed rate (default 8.1%), flat CHF/quarter, and VAT-exempt categories (defaults: Insurance, Bank Fees, Payroll Settlement, Taxes / VAT). Settings never modify bills; a recorded VAT amount always wins over the estimate. `PUT /api/vat/settings` is a partial update — omitted fields keep their value.
- **"+ create obligation"** books the quarter (type `vat`, due date auto) → appears in Obligations + Calendar. If figures drift later, the card offers one-click "update to CHF X".
- **Readjustment lifecycle**: when the real ESTV assessment arrives, edit the obligation — correct the amount, attach the PDF. From then on the uploaded assessment is authoritative: card headline shows the filed amount (simulated shown small), 📎 link opens the PDF, and the refresh endpoint refuses to overwrite. The paid/unpaid badge on the quarter card toggles by click.
- Dedicated bill category **"Taxes / VAT"** for VAT payments (exempt from simulation by default — a VAT payment contains no deductible input VAT).

## 🏦 Bank analyzer → obligations matching

`POST /api/bank-statements/{id}/analyze` now matches outflows (incl. multi-order sub-entries) against **unpaid obligations** and proposes `mark_obligation_paid` instead of booking a duplicate bill. Matching: counterparty keywords per type (AXA/Vorsorge → BVG·UVG·KTG, ESTV/MWST → VAT, Ausgleichskasse/SVA → AHV, Steueramt → corporate tax) + exact amount, or a **subset of same-type/same-due-date rows summing to the payment** (e.g. AXA's quarterly CHF 3'919.50 = 3 monthly BVG rows).

## 🗓 Quarterly BVG + other payroll conventions

- AXA bills BVG **quarterly** (contract 2/547440, invoiced ~3 days after quarter end, payable within a month). Payslips no longer create monthly BVG obligations; a recurring quarterly obligation (period `Qx YYYY`, CHF 3'919.50) covers it — extended by *Generate Recurring* and projected in the Calendar. Monthly rows up to June 2026 predate this and add up to the Q2 invoice.
- UVG/KTG run through **AXA, not SUVA** (SUVA only covers mandated industries) — labels updated everywhere.
- `/api/transfers/balance` excludes `Net salary payment` transfers from "Net Owed to Personal" — wages are compensation, not Kontokorrent debt. The excluded total is reported as `salary_transfers_excluded`.

---

## ⚡ Dividend Planner — proper Swiss net (partial taxation)

The planner's net figures use the real qualified-shareholding model (≥ 10%
holding) instead of a single guessed "tax bracket":

- Inputs: **federal marginal rate** (default 12%) and **cantonal + communal
  marginal rate** (default 21.5% — ZH base × Steuerfuss canton 98% + City 119%).
- `effective rate on gross = 70% × federal + 50% × cantonal ≈ 19.15%` at the
  defaults — displayed live next to the inputs and in the income-tax row.
- Applied consistently to the hero number, the distribution table, the
  per-fiscal-year breakdown, the bucket × year matrix and the allocation table.
- The 35% Verrechnungssteuer stays a *timing* column: withheld at payout,
  refunded via the ordinary assessment (only if declared) — the net column
  already credits it back.
- What the planner does **not** model: corporate profit tax (~19.7% — must be
  paid before money becomes distributable), the 5% legal reserve, and whether
  a fiscal year's profit actually supports the planned amount. Full worked
  example: FORMULAS.md → *Corporate tax & dividends*.

---

## 💳 Reimburse Yourself (personal-card settlement)

Closes the loop on personal-card expenses. On **Bills & Documents**, a
**💳 Reimburse Yourself** button appears whenever un-reimbursed personal-card
bills exist:

- Dialog lists outstanding bills (checkbox per bill, running total, transfer
  date). Confirming creates **one GmbH → Personal transfer** tagged
  `Personal-card reimbursement — N bill(s): …` and stamps
  `company_docs.reimbursed_at` on each bill (green *reimbursed* badge).
- The Kontokorrent counts **unreimbursed bills only**, and reimbursement
  transfers are excluded from "non-salary paid to you" — symmetric, so the
  balance returns to exactly where it was before the bills were fronted.
  Double-reimbursing is rejected (400).
- Quarterly Excel export is **period-correct**: a bill fronted in Q2 but
  repaid in Q3 still shows as owed in the Q2 export ("Still owed to you at
  period end"), and the Q3 export auto-classifies the settling bank payment
  as *Personal-card reimbursement* (matched by amount ±0.05 / date ±10 days)
  instead of new debt. The "Personal card" sheet gained a **Reimbursed** column.
- Manual step that remains: actually send yourself the money from UBS (same
  date + reference) — checklist AT-02-05b.

## 📊 P&L / quarterly reports — accrual basis (double-counts fixed)

`/api/reports/pl/{year}` (feeds the Excel P&L and the corporate-tax estimate):
revenue = invoice **subtotals** net of VAT (service invoices only); extra
income = non-invoice-linked, non-salary entries; payroll = employer cost of
**issued payslips** (was 12 × current settings); bills exclude *Payroll
Settlement* and *Taxes / VAT*; obligations are shown for cash planning but
**not** added to costs (their P&L side already lives in payroll/bills). The
response declares its `basis`. Quarterly summary likewise uses the quarter's
real payslips (wage sum + exact AHV) instead of 3 × settings.

Corporate-tax obligations follow the documented scheme (FORMULAS.md): federal
estimate due 31.03 of year+1, cantonal during year+1, both flagged ESTIMATED.

---

## 📚 Document history

- **2026-07-13** — Bank page UX redesign: one Kontokorrent headline ("GmbH owes
  you X") + breakdown line + bank-verification badge replaces the duplicate
  card and gross stat cards; bank-derived figure now acts as a health check
  (✓ agrees / ⚠ difference with hint) instead of a rival number
- **2026-07-13** — Owner-ledger CSV overhaul (Type column, Kontokorrent-correct
  totals excluding salary/reimbursements), accountant CSV gains Paid-via /
  Reimbursed / Document-link columns; bills accept a per-document external
  link (Google Drive / Dropbox / any URL — `doc_url`), shown as 🔗 in the
  list and exported in the CSV
- **2026-07-13** — Reimburse-yourself flow (reimbursed_at, symmetric
  Kontokorrent, period-correct Excel), P&L + quarterly report double-counts
  fixed (accrual basis, issued payslips, VAT-net revenue), corporate-tax
  obligations restructured to the 2027 payment scheme; Transfers tab merged
  into Bank Statements as the "Owner ledger" section (auto-logged salary +
  reimbursement rows collapsed behind a toggle; old links/shortcuts redirect;
  API unchanged); owner-ledger reconciliation: running Kontokorrent column per
  row, historical flows seeded, and the bank analyzer now matches owner
  in/outflows against logged transfers (amount ±0.05, date ±7 d) — salary-sized
  payments aggregate silently, unlogged owner payments produce a "log as
  transfer" proposal, already-logged ones are skipped; bank credits matching
  logged Personal → GmbH transfers count as owner contributions in the
  Kontokorrent (card, Excel residual + classification) instead of revenue
- **2026-07-10** — Dividend Planner proper net (partial taxation, marginal-rate
  inputs); UI/UX overhaul: sidebar + nav scrolling, horizontal-overflow fixes on
  all pages (`.main`/grid `min-width:0`, scoped table min-widths, markdown table
  scroll), mobile calendar/payroll layouts; fixed route shadowing that broke
  vendor autosuggest + duplicate detection (422); fixed post-reorg paths that
  silently emptied the Docs viewer, Accounting Checklist and AI-chat knowledge
  base; corporate tax & dividends worked example in FORMULAS.md
- **2026-07-09** — Calendar page, personal-card expenses (paid_via + Kontokorrent integration + Excel "Personal card" sheet), accountant payslip upload + regenerate guard, VAT simulation with customizable deductions + readjustment lifecycle, "Taxes / VAT" bill category, bank analyzer ↔ obligations matching, quarterly BVG obligations, SUVA→AXA rename, salary-transfer exclusion in transfers balance
- **2026-06-24** — Bank statement analyzer, proposal-review modal, inline-expand row, clean CSV export, UBS native CSV parser, vehicles + shareholder_loans + bank_transactions schemas, vehicle CRUD + book-value endpoint
- **2026-06-22** — UBS Bank Statements (PDF + CAMT.053 XML), Business Trips, Cash-flow Timeline, Reserves CRUD, month-aware reports, LLM tools rewrite, model-size warning, HEIC conversion, hash dedup, auto cache-bust, payslips in accountant ZIP, payroll matched to AXA payslip
- **2026-05-22** — Search bar mini-query language, iPhone/iPad layout fixes, remote-dev options, security hardening, invoice↔income auto-link, multi-year dividend planner, transfers CSV export, accounting checklist, `start.sh` launcher, AI write tool with confirm-step, in-app docs viewer, time-range filter, widget sizing, Net Salary widget, Reports customization
