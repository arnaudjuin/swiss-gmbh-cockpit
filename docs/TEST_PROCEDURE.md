# Test Procedure

Manual smoke-test script for a release. The Checklist page parses this file
(`## §N` sections, `### TC-N-M:` cases) into an interactive Pass/Fail list —
keep the format if you add cases. Run the automated suite first:

```bash
.venv/bin/python -m pytest tests/test_smoke.py -q     # 172 route/behavior tests
```

All names and amounts below refer to the demo dataset (`python seed_demo.py`).

---

## §1 Login & shell

### TC-1-01: Login and theme
**Priority:** P1

**Steps:**
1. Open http://127.0.0.1:8000 — log in with the `ADMIN_PASSWORD` (demo)
   - [ ] Pass [ ] Fail · Notes: ____
2. Toggle dark mode (moon icon) — every page repaints, charts re-skin
   - [ ] Pass [ ] Fail · Notes: ____

### TC-1-02: Per-page display setup
**Priority:** P2

**Steps:**
1. On Obligations, click ⚙ Display — switch a section off and on again
   - [ ] Pass [ ] Fail · Notes: ____
2. Reload — the choice persists (saved server-side in preferences)
   - [ ] Pass [ ] Fail · Notes: ____

---

## §2 Dashboard

### TC-2-01: Cards agree with Reports
**Priority:** P1

**Steps:**
1. Net Profit on the dashboard equals Reports → P&L for the same range
   - [ ] Pass [ ] Fail · Notes: ____
2. Every recap tile opens its page when clicked; ⓘ shows the formula
   - [ ] Pass [ ] Fail · Notes: ____

### TC-2-02: Customize
**Priority:** P2

**Steps:**
1. Customize → hide a widget, drag a stat card to reorder — layout persists
   - [ ] Pass [ ] Fail · Notes: ____

---

## §3 Invoices

### TC-3-01: Create, PDF, paid flow
**Priority:** P1

**Steps:**
1. New Invoice → next number is prefilled → generate; PDF preview renders
   - [ ] Pass [ ] Fail · Notes: ____
2. Mark it paid — an income entry appears under Other income's table source
   - [ ] Pass [ ] Fail · Notes: ____

### TC-3-02: Page search
**Priority:** P2

**Steps:**
1. Type an invoice number (e.g. `21`) — the table filters; `unpaid` filters by status
   - [ ] Pass [ ] Fail · Notes: ____

---

## §4 Bills & Documents

### TC-4-01: Upload and query language
**Priority:** P1

**Steps:**
1. Add Document with an image receipt — thumbnail + preview work
   - [ ] Pass [ ] Fail · Notes: ____
2. Search `>100 paid` — chips appear, only matching rows remain
   - [ ] Pass [ ] Fail · Notes: ____

### TC-4-02: Personal-card flow
**Priority:** P1

**Steps:**
1. A bill with "paid via personal" shows the purple chip and counts in the
   Kontokorrent tile until reimbursed
   - [ ] Pass [ ] Fail · Notes: ____

---

## §5 Payroll

### TC-5-01: Generate a payslip
**Priority:** P1

**Steps:**
1. Generate the next month's payslip — net = gross − employee AHV/ALV/BVG/UVG/KTG − source tax
   - [ ] Pass [ ] Fail · Notes: ____
2. With "create obligations" on, AHV/UVG/KTG/source-tax obligations appear for that period
   - [ ] Pass [ ] Fail · Notes: ____

---

## §6 Obligations & Calendar

### TC-6-01: Payable date drives everything
**Priority:** P1

**Steps:**
1. An obligation with an expected-bill date later than its period due date
   shows under that later date (page grouping, calendar, dashboard "due next")
   - [ ] Pass [ ] Fail · Notes: ____
2. Overdue counts only items whose PAYABLE date has passed
   - [ ] Pass [ ] Fail · Notes: ____

---

## §7 Bank & Kontokorrent

### TC-7-01: Statement math
**Priority:** P1

**Steps:**
1. Upload a CAMT.053/CSV statement — opening + transactions = closing (green check)
   - [ ] Pass [ ] Fail · Notes: ____
2. The Kontokorrent card excludes salary and reimbursement transfers
   - [ ] Pass [ ] Fail · Notes: ____

---

## §8 Cash Allocation & Forecast

### TC-8-01: Envelopes
**Priority:** P1

**Steps:**
1. Waterfall: bank balance − earmarked pots − due soon = free cash
   - [ ] Pass [ ] Fail · Notes: ____
2. Contribute to a pot — its ledger records the movement
   - [ ] Pass [ ] Fail · Notes: ____

### TC-8-02: Forecast
**Priority:** P1

**Steps:**
1. Type a revenue figure into one month — that and later months recompute;
   the dashboard forecast chart matches
   - [ ] Pass [ ] Fail · Notes: ____
2. Switch to next year — January starts from December's projected cash
   - [ ] Pass [ ] Fail · Notes: ____

---

## §9 Security

### TC-9-01: Auth gates
**Priority:** P1

**Steps:**
1. Log out — every `/api/*` call returns 401; the UI shows the login screen
   - [ ] Pass [ ] Fail · Notes: ____
2. With `HOST=0.0.0.0` and the default password the app refuses to start
   - [ ] Pass [ ] Fail · Notes: ____

### TC-9-02: Injection
**Priority:** P2

**Steps:**
1. Search `'; DROP TABLE invoices; --` in Bills — treated as text, nothing breaks
   - [ ] Pass [ ] Fail · Notes: ____
