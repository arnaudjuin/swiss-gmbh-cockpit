# AI Chat — How It Works

A natural-language interface to your GmbH finances. Ask questions in plain
English (or French / German — the model is multilingual) and get answers backed
by your actual SQLite data and your project documentation.

---

## How to open it

| Where | How |
|---|---|
| Anywhere in the app | Click the **💬** button at the bottom-right corner |
| Anywhere in the app | Keyboard shortcut **Cmd+K** (macOS) / **Ctrl+K** (Windows/Linux) |
| Quick-clear conversation | **🔄** button in the chat header |

The chat panel is a right-side drawer with streaming responses, conversation
memory, and a collapsible "tool used" detail under each answer.

---

## Two modes (auto-classified)

Every question is sent to the same `/api/llm/ask` endpoint, which routes it to
one of two paths based on simple keyword detection:

### 1. **Data mode** — for questions that need numbers from your DB

Triggered by words like *show, list, how much, how many, total, sum, balance,
this year, last year, ytd, runway, overdue, due, spent, income*.

The model picks **exactly one tool** (no raw SQL — safer), the backend executes
it against SQLite, and the model writes a natural-language summary of the
result.

### 2. **Knowledge mode** — for "how does X work?" questions

Triggered by words like *how does, how is, what is, what are, explain, tell me
about, KTG, BVG, tariff, what's the rate, what does, why, how do I, where is*.

The model is given the entire contents of your documentation (see
[Documents the chat reads](#documents-the-chat-reads)) and answers from there.
No DB queries.

If neither set of signals matches, **data mode is the default**.

---

## What the chat can answer (9 tools)

Each tool is a typed function the model can call. The tool definitions live in
`llm_tools.py`. Below is what the model sees in its system prompt.

| Tool | What it does | Optional params |
|---|---|---|
| `search_bills` | Search company bills (incoming, paid by GmbH) | `year`, `vendor` (partial match), `category`, `status` (paid/unpaid), `limit` |
| `search_expenses` | Search travel expenses (reimbursable — billed back to clients) | `year`, `category` (Meals/Transport/Accommodation/Other), `limit` |
| `list_obligations` | List GmbH obligations to authorities/insurers (AHV, BVG, taxes, KTG, UVG) | `status`, `year` |
| `get_runway` | Current cash balance, monthly burn rate, runway in months | — |
| `top_vendors` | Top vendors by total bill amount | `year`, `limit` |
| `dashboard_summary` | Full dashboard overview: income / costs / profit / overdue / upcoming | — |
| `invoice_summary` | Invoice totals by year (count, total, paid amount) | `year` |
| `budget_balances` | Current balance of every sinking-fund reserve (Car, Wine, Mariage, …) | — |
| `payslip_summary` | Payslip totals by year (gross, net, employer cost) | `year` |
| `search_transfers` | List Personal ↔ GmbH account transfers (balance-sheet moves, NOT salary/income/dividends). Always includes the lifetime net owed to personal. | `direction` (`personal_to_gmbh` / `gmbh_to_personal`), `year`, `limit` |
| `propose_action` | **Write tool — confirm-required.** Proposes marking an invoice / bill / obligation paid or unpaid. The model never mutates directly: this tool returns a proposal card in the chat, you click **Apply** to actually run the change (which goes through the existing `PATCH /api/...` endpoints with full auth). Allowed `action` values: `mark_invoice_paid`, `mark_invoice_unpaid`, `mark_bill_paid`, `mark_bill_unpaid`, `mark_obligation_paid`, `mark_obligation_unpaid`. | `action`, `target_id` |

**Why tool calling instead of raw SQL?** Three reasons:
- **Safety** — the model can't accidentally `DROP TABLE invoices`.
- **Determinism** — the same question always hits the same tool with the same args.
- **Auditability** — every answer shows the tool + args + raw result in a
  collapsible block under the response, so you can verify the model didn't make
  numbers up.

---

## Documents the chat reads

In **knowledge mode**, the model is given the full text of these three files
(loaded once and cached at server startup):

| File | What's in it |
|---|---|
| `PAYROLL_NOTES.md` | Swiss payroll deep dive: AHV / ALV / BVG / UVG / KTG / FAK rates, AXA policy details, source-tax tariffs, monthly money-flow breakdown |
| `FEATURES.md` | Feature reference for every advanced feature (AI chat, runway, anomaly detection, QR-bills, dashboard customization, etc.) |
| `GUIDE.md` | Setup + architecture + API endpoint reference + file structure |

What's **not** loaded: `TEST_PROCEDURE.md`, `HOSTING.md`, this file (`AI_CHAT.md`),
the database schema, source code. If you want a doc to be answerable, add its
filename to the `kb_files` list in `routes/llm.py:_load_knowledge_base()`.

The cache only refreshes on app restart — if you edit a doc, restart the app to
pick up the change.

---

## What the chat does NOT have access to

To set expectations:
- **No internet access** — can't look up Swiss law updates, exchange rates, or
  vendor websites.
- **No file system access** — can't read your invoices/scans on disk; only the
  metadata stored in SQLite.
- **No autonomous writes** — the model can *propose* state changes (mark paid /
  unpaid via `propose_action`), but the change only fires when **you click
  Apply** in the chat. No INSERT/DELETE tools; no schema changes; no shell.
- **No memory across sessions** — clearing the conversation (or refreshing the
  page) wipes context. The history is in browser memory only, never persisted.
- **No access to other apps** — Gmail, Calendar, your bank, etc. are not
  connected.

---

## Conversation memory

The last **12 messages** of the current chat session are sent with each new
question, so follow-ups like *"how about last year?"* work without restating
context. History lives in JavaScript memory only — closing the tab or clicking
**🔄 Clear** wipes it. Nothing is persisted server-side.

---

## Streaming responses

Replies stream in token-by-token via Server-Sent Events at
`/api/llm/stream`, so you see the answer appearing live with a blinking cursor
instead of waiting for the full response.

---

## Provider abstraction (where the model actually runs)

`llm.py` is provider-agnostic. Switch via `.env`:

| Provider | Setting | Where the model runs | Cost |
|---|---|---|---|
| **Ollama** (default) | `LLM_PROVIDER=ollama` + `OLLAMA_URL=http://localhost:11434` | Your own machine (qwen2.5-coder:7b for chat, optional llama3.2-vision:11b for receipts) | Free, but ~5 GB RAM resident |
| **Anthropic** | `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=...` | Anthropic's servers (Claude) | ~$3 / $15 per 1M tokens |
| **OpenAI** | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=...` | OpenAI's servers | Per their pricing |

**Privacy note:** with Ollama, no data ever leaves your machine. With cloud
providers, your question + the relevant DB rows or doc text are sent to their
API.

---

## Status indicator

The top of the chat panel shows a green/red dot:
- 🟢 **Provider reachable** — model is loaded, ready to answer.
- 🔴 **Unreachable** — Ollama daemon stopped or API key missing/invalid.

You can also hit `/api/llm/status` directly for a JSON health check.

---

## Example questions

**Data mode** (model picks a tool):
- *"How much did I spend on bills this year?"* → `search_bills(year=2026)` → "You spent CHF 10,205 across 14 bills…"
- *"What's my runway right now?"* → `get_runway()` → "Cash CHF 42,300 with monthly burn CHF 8,200 = 5.2 months…"
- *"List my unpaid obligations"* → `list_obligations(status='unpaid')`
- *"Who are my top 5 vendors this year?"* → `top_vendors(year=2026, limit=5)`
- *"Show me all Meals expenses from last year"* → `search_expenses(year=2025, category='Meals')`
- *"What's in my Car budget?"* → `budget_balances()` → filtered to Car
- *"How much did I pay in payroll last year?"* → `payslip_summary(year=2025)`

**Knowledge mode** (model reads the docs):
- *"How is KTG split between employer and employee?"*
- *"What's the BVG coordination deduction?"*
- *"How does the runway calculation work?"*
- *"Where do I configure source tax tariff?"*
- *"What does the accountant package include?"*

**Mixed / multi-step** — currently the model picks one tool per turn. For a
question like *"compare bills vs income for last 3 months"*, ask in two turns
or open the dashboard and use the time-range selector instead.

---

## Limitations / gotchas

- **Single tool per question** — no chained tool calls in one turn. The model
  has to be re-prompted for each fact. Follow up with another question if
  needed.
- **Date awareness is loose** — the model knows today's date from the system
  prompt but doesn't always parse "last quarter" perfectly. Prefer explicit
  years (e.g. "in 2025").
- **Number formatting is the model's job** — if a CHF figure comes out wrong,
  expand the tool-detail block under the answer to see the raw values.
- **No financial advice** — the chat reports your numbers; it doesn't tell you
  what to do with them. Especially for tax / dividend questions, verify with
  Treuhand.

---

## Where the code lives

| File | Purpose |
|---|---|
| `routes/llm.py` | `/api/llm/{status,ask,stream}` endpoints, classifier, knowledge-base loader |
| `llm_tools.py` | The 9 tool definitions + their SQL/Python implementations |
| `llm.py` | Provider abstraction (Ollama / Anthropic / OpenAI), streaming helpers |
| `static/js/09-misc.js` (`AI Chat` section) | Frontend chat UI, streaming display, conversation memory |
