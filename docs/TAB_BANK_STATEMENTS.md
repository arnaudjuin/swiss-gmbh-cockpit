# Tab · Bank Statements

Everything on the **Banking → Bank Statements** tab, top to bottom. This tab has
two jobs:

1. **Bank truth** — store the UBS statements and turn their transactions into
   bookkeeping actions (via *Analyze*).
2. **Owner ledger (Kontokorrent)** — track who owes whom between you and the
   GmbH, verified against that bank truth.

---

## Page anatomy

```
Latest balance strip            ← closing balance of the newest statement
Statements table                ← one row per uploaded statement
Owner ledger
  ├─ headline panel             ← "GmbH owes you CHF X" + breakdown + ✓ verification
  └─ transfers table            ← owner movements with running balance
```

---

## 1 · Latest balance strip

The closing balance and date of the most recent statement — what was actually
in the UBS account. This also feeds the Dashboard "Latest balance" widget.
It is **not** live: it updates when you upload the next statement.

## 2 · Statements table

One row per uploaded statement. Columns: period, bank, account (label + IBAN),
opening/closing balance, your notes.

**Row actions:**

| Icon | Action |
|---|---|
| ▶ | Expand the row into the full **transaction table** — every movement with its classification (Salary, Reimbursement, Owner contribution, Intra-company, Payroll/social charges…), plus the per-quarter Excel export links |
| 🔍 | **Analyze** — read-only scan that proposes bookkeeping actions (see §4) |
| 📄 | Preview the statement PDF |
| XML | Download the machine-readable file (UBS CSV or CAMT.053) |
| ✎ | Edit statement metadata (period, balances, notes, replace files) |
| 🗑 | Delete the statement (files included) |

### Uploading (monthly routine)

Click **+ Upload Statement** and attach **both** the PDF (human copy, goes to
the accountant package) and the CSV/XML (machine copy, powers everything else).
UBS e-banking → account → export CSV. A new upload for the same account can
replace the previous one — note it in the Notes field. Checklist: **AT-02-03**.

Supported machine formats: **UBS native CSV** (semicolon, with sub-entries for
multi e-banking orders) and **CAMT.053 XML**.

### Quarterly Excel export

In the expanded row: Q1–Q4 links produce a multi-sheet workbook per quarter —
**Summary** (cash-flow split, Kontokorrent recap), **Transactions** (with
classifications, aggregator rows expanded), **Reimbursements** (bank inflow ↔
expense report matches), **Personal card** (bills fronted privately, with
Reimbursed column; period-correct: a bill repaid after the quarter still shows
as owed at that quarter's end).

## 3 · Transaction classifications

Assigned automatically in the expanded view, the Excel exports and the clean
CSV:

| Classification | Meaning |
|---|---|
| Salary | Payment to you within 10% of an issued payslip's net, near payday |
| Reimbursement (report #N) | Client inflow exactly matching a travel expense report — **your** money, not revenue |
| Owner contribution (logged in ledger) | Credit matching a logged Personal → GmbH transfer — Kontokorrent, not revenue |
| Personal-card reimbursement | Outflow matching a "Reimburse Yourself" transfer — settles fronted bills, not new debt |
| Personal transfer (non-salary) | Other payment to you — Kontokorrent debt repayment |
| Intra-company transfer | Money appearing to come from Muster Consulting itself (capital release, inter-account) |
| Payroll / social charges | AHV, BVG, Quellensteuer, VAT keywords |

## 4 · Analyze (proposal review)

🔍 parses the statement and proposes DB actions — **nothing is written until
you Apply** each proposal:

- **Mark invoice paid** — Acme credits matched by embedded invoice number or amount.
- **Add bill** — unknown outflows, with vendor→category suggestions; multi
  e-banking orders expand into one proposal per sub-entry.
- **Mark obligation paid** — outflows matching unpaid obligations by
  counterparty keywords (AXA → BVG/UVG/KTG, ESTV → VAT, Ausgleichskasse → AHV,
  Steueramt → corporate tax) and amount — including **grouped** matches
  (AXA's quarterly 3'919.50 settles the three monthly BVG rows at once).
- **Log as transfer** — non-salary payment to you that has **no matching
  ledger row**: the safety net that keeps the owner ledger complete
  (checklist AT-02-05 step 3).
- **Shareholder loan** — credits from you with no matching logged transfer.
- Already-reconciled movements (matched to logged transfers, amount ±0.05,
  date ±7 days) are silently skipped — re-running Analyze is always safe.

## 5 · Owner ledger (Kontokorrent)

### The headline panel

- **"GmbH owes you CHF X"** (green) / **"You owe the GmbH CHF X"** (red — the
  direction to avoid: hidden-dividend scrutiny) / "Settled".
- **Breakdown line**: *you put in A · repaid to you B · fronted bills C —
  salaries excluded (wages, not debt)*.
- **Verification badge**: the same position is recomputed independently from
  the bank transactions.
  - **✓ Verified — ledger and bank data agree**: nothing to do.
  - **⚠ difference of CHF X**: an owner movement is unlogged (run Analyze on
    the latest statement) or a payment hasn't reached a statement yet.
- **"how it's calculated"** expands the reconciliation waterfall — plain-language
  rows in "+ = GmbH owes you more" terms that sum to the headline: travel
  reimbursements collected on your behalf, payments back to you, matched
  contributions, fronted bills. Salary total shown as an excluded footnote.

### What counts, what doesn't

| Counts toward "GmbH owes you" | Excluded |
|---|---|
| Travel reimbursements the client paid to the GmbH on your behalf | Salary payments (wages you earned, not debt) |
| Contributions/loans you paid in from private accounts | Personal-card **reimbursement** transfers (they settle bills that stop counting at the same moment) |
| Bills you fronted privately, not yet reimbursed (live on Bills & Documents) | Share capital (equity — only comes back as dividends/liquidation) |
| minus: non-salary payments back to you | |

### The transfers table

Owner movements newest-first with a running **Balance** column (position after
each movement; + = GmbH owes you). System-generated rows (salaries,
personal-card reimbursements) are collapsed behind the *auto-logged* toggle.

- **+ Log Transfer** — for movements that aren't bills: contributions,
  dividends (attach the resolution PDF), cash advances, repayments you make
  manually. **Not** for privately-paid bills — those are recorded on
  **Bills & Documents** with *Paid with: Private card / bank account*; the
  bill is the debt record and *Reimburse Yourself* creates the settlement
  transfer automatically. Logging both would double-count.
- **Export CSV** — all transfers with a **Type** column (owner transfer /
  salary / personal-card reimbursement) and Kontokorrent-correct totals
  (salaries and reimbursement-settlements shown as info lines, excluded from
  the "NET owed" figure).

## 6 · How this tab connects to the others

| Tab | Connection |
|---|---|
| Bills & Documents | Privately-paid bills raise the Kontokorrent here; *Reimburse Yourself* lowers it and its bank payment is auto-classified on the next upload |
| Payroll | Payslip generation logs the salary transfer (auto-logged group); payslip nets teach the salary classifier |
| Obligations | Analyze proposes mark-paid when bank outflows match unpaid obligations |
| Invoices | Analyze flips invoices to paid when the Acme credit arrives |
| Reports | The accountant package bundles statement PDFs; quarterly VAT figures come from invoices/bills, not from here |
| Dashboard | "Latest balance" and "GmbH Owes You" widgets read this tab's data |

## 7 · Monthly routine (checklist §2)

1. Export CSV + PDF from UBS e-banking, **+ Upload Statement** (AT-02-03).
2. Click 🔍 **Analyze**, apply the sensible proposals — invoices paid, bills
   booked, obligations settled, forgotten transfers logged (AT-02-05).
3. If you fronted anything privately this month: **Bills & Documents →
   Reimburse Yourself**, then pay yourself the same amount from UBS
   (AT-02-05b).
4. Glance at the headline panel: **✓ verified** and a number you recognize —
   done.

## Glossary

- **Kontokorrent** — the running current account between you (shareholder) and
  the GmbH. Negative for the company = it owes you: harmless, standard,
  bookable. The reverse direction (you owing the company) invites
  hidden-dividend scrutiny — keep it positive-for-you or settled.
- **Reimbursement receivable** — money a client paid to the company that
  belongs to you (travel expense reports); the company holds it until repaid.
