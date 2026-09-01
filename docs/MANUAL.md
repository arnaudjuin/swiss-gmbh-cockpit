# User Manual

The 15-minute tour of running a founder-managed Swiss GmbH with this tool.
(Deeper reference: FEATURES.md · calculations: FORMULAS.md · Swiss payroll
background: PAYROLL_NOTES.md.)

## First run

1. `python seed_demo.py` gives you fictional data to explore — or skip it and
   start blank.
2. Log in (password = `ADMIN_PASSWORD`, default `demo`).
3. **Settings** (Next frontend) or Payroll → Settings (classic): set your
   company name, currency display, hourly rate, VAT rate and the invoice
   identity block (address, IBAN, UID).
4. Payroll → Settings: employee, gross salary, insurance amounts, source tax.

## The monthly rhythm

| When | Do | Where |
|---|---|---|
| Month end | Create the month's invoice (hours auto-price at your rate) | Invoices |
| Payday (25th) | Generate the payslip — it books the AHV/UVG/KTG/QST *obligations* automatically | Payroll |
| As they arrive | Upload receipts & bills, mark who paid (company / personal card) | Bills & Documents |
| When paid | Toggle invoice / bill / obligation to paid | each page |
| Statement day | Upload the bank statement (CAMT.053 or CSV) — opening + transactions must equal closing | Bank Statements |

## The ideas that make the numbers trustworthy

- **Due vs payable.** An obligation for "April AHV" is *due* end of April
  (accrual) but *payable* when the akonto bill arrives (say 15 Oct). Overdue
  warnings, the calendar and the forecast all use the payable date — so
  nothing screams "overdue" that you couldn't actually have paid.
- **Obligations are not costs.** Payroll cost enters P&L through payslips;
  the obligations page tracks the *payments* of those charges. Never both.
- **Kontokorrent.** Paid something privately for the company? Mark the bill
  "personal" — it raises what the company owes you. Salary transfers don't
  count (wages aren't debt). The tile on the dashboard shows who owes whom.
- **Envelopes (Cash Allocation).** The bank balance minus what's earmarked
  for future bills = what you can actually spend. Pots accrue monthly and
  fund next year's bills, and the Forecast charges the pots instead of
  double-counting those bills.

## Planning

- **Forecast** — type expected revenue per month, see cash month by month to
  year end; later years carry December's cash forward. The lowest point tells
  you when a shareholder loan or more revenue is needed.
- **Dividends** — set monthly set-asides per fiscal year; the planner applies
  Swiss partial taxation (qualified holding) and shows net-in-pocket per year.
- **Reports** — the accrual P&L your fiduciary will recognize, plus the
  accountant package (one ZIP with everything).

## Keyboard

`/` focus the page's search · `g d / g o …` go to pages · `?` all shortcuts
(classic frontend).
