# Accounting Checklist

Practical accounting tasks for running the GmbH — what to do daily, monthly,
quarterly, and yearly. Each task has steps you can check off in the app.

Statuses: ✓ Pass = done · ✗ Fail = problem found · Skip = not applicable this
period · Reset = clear the mark. Use the Notes field on each step to record
anything unusual.

---

## §1 Daily / Weekly

### AT-01-01: Capture receipts as they arrive
**Priority:** P1

**Steps:**
1. On your phone, open `https://YOUR-TUNNEL.trycloudflare.com/quick` (or use the **Quick add (mobile)** icon in the sidebar to grab the link).
   - **Expected:** mobile page loads with a single Upload Receipt button.

2. Take a photo of every restaurant / taxi / hotel receipt from the day. Submit one by one.
   - **Expected:** each upload shows AI-parsed vendor, amount, currency, category before saving.

3. Verify on the Expenses page that the row was created with the correct amount in CHF.
   - **Expected:** `original_amount` shows the foreign-currency value, `amount` shows CHF.

### AT-01-02: Quick-record a new bill
**Priority:** P1

**Steps:**
1. Navigate to **Bills & Documents** in the sidebar.

2. Click **+ New Bill** (or drop the PDF onto the page).
   - **Expected:** form opens; if you drop a PDF the file is attached automatically.

3. Fill in: vendor, amount, currency, category, due date (if known), recurrence (if it repeats monthly/quarterly/yearly).
   - **Expected:** **Check duplicate** indicator below the vendor warns if a near-identical bill already exists this month.

4. Save.
   - **Expected:** the bill appears in the list with status `unpaid` and a 📎 icon if a file was attached.

### AT-01-03: Mark invoices paid as bank transfers come in
**Priority:** P1

**Steps:**
1. Open **Invoices**.

2. For each invoice your client has paid, click the status badge (top right of the row) to flip it `unpaid` → `paid`.
   - **Expected:** badge turns green; `paid_date` set to today.

3. Verify on the Dashboard that **% Invoices Paid** widget reflects the change.

### AT-01-04: Review unpaid bills weekly
**Priority:** P2

**Steps:**
1. Dashboard → check **Overdue Amount** and **Due Next 30 Days** widgets.
   - **Expected:** numbers match the upcoming-payments list below.

2. For anything overdue, decide: pay now / dispute / wait. Mark paid via the status badge once settled.

3. Use the **&#9432;** on a bill row to see its full history if you can't remember what it was for.

---

## §2 Monthly close (1st – 5th of next month)

### AT-02-01: Generate the monthly payslip
**Priority:** P1

**Steps:**
1. Navigate to **Payroll** → check the year selector matches the period you're closing.

2. Click **+ Generate Payslip**, pick the month you just finished.
   - **Expected:** modal shows the breakdown: gross, employee deductions, source tax, net.

3. Verify totals against `FORMULAS.md` § Swiss Payroll (or open Settings to inspect rates).
   - **Expected:** net = gross − employee_total_deductions − source_tax.

4. Click **Generate** → PDF appears in the payslips list.
   - **Expected:** row added with status `pending`. Download PDF and confirm it's well-formed.

### AT-02-02: Mark salary payments + source tax as paid
**Priority:** P1

**Steps:**
1. On the payslip row, click the status to flip to `paid` once the bank transfer to your personal account has settled.

2. Source tax: in **Obligations**, create / update the source-tax row for the month with the same value as on the payslip.
   - **Expected:** obligation amount matches the payslip's `source_tax` field.

### AT-02-03: Reconcile GmbH cash balance with the bank statement
**Priority:** P1

**Steps:**
1. Open your GmbH bank account statement for the just-closed month.

2. Dashboard → click the Cash Balance widget → enter the **end-of-month** balance.
   - **Expected:** "as of" date set to last day of the month.

3. Compare line by line: any debit in the statement should correspond to a `paid` bill or obligation in the app. Any credit to a `paid` invoice or an `income_entries` row.

4. If you find unmatched transactions, use **Bank CSV Import** (Reports page or via direct upload) to bulk-match.
   - **Expected:** match candidates are suggested for each row; Apply the right one.

### AT-02-04: Record any manual income (refunds, deposits, interest)
**Priority:** P2

**Steps:**
1. Navigate to **Income**.

2. For each bank credit that wasn't an invoice payment, click **+ Add Income** with date, source, amount, category.
   - **Expected:** row appears; YTD income on the Dashboard increases.

### AT-02-05: Record any Personal ↔ GmbH transfers
**Priority:** P2

**Steps:**
1. Navigate to **Bank Statements → Owner ledger** (bottom of the page).

2. For each money movement between your personal and GmbH accounts, click **+ Log Transfer** with direction, amount, description.
   - **Expected:** **Kontokorrent** tile / stat card on the Dashboard updates; the row shows the running Kontokorrent position after the movement.

3. Safety net: if you forget to log one, the next statement upload's **Analyze** proposes "Owner payment not in the ledger — log as transfer" for any non-salary payment to you that has no matching ledger row.

### AT-02-05b: Reimburse yourself for personal-card expenses
**Priority:** P2

**Steps:**
1. Navigate to **Bills & Documents**. If any bills carry the purple **💳 personal** badge, a **💳 Reimburse Yourself** button appears in the header.

2. Click it, review the outstanding bills (all pre-selected), set the transfer date, confirm.
   - **Expected:** one **GmbH → Personal** transfer is logged for the total; the bills flip to a green **💳 reimbursed** badge; the Kontokorrent (Bank Statements → Owner ledger + Kontokorrent card) drops by the same amount.

3. Pay yourself the exact same amount from the UBS account, same date, reference "Personal-card reimbursement".
   - **Expected:** on the next statement upload, the payment is auto-classified **Personal-card reimbursement (settles fronted bills)** — not counted as new non-salary debt.

### AT-02-06: Verify the dashboard tells a coherent story
**Priority:** P2

**Steps:**
1. Set the Dashboard time range to **This month**.

2. Sanity-check:
   - **Total Income** ≈ what hit your GmbH account (invoices + manual income)
   - **Total Costs** ≈ what left your GmbH account in bills + obligations
   - **Net Profit** should match what you'd expect for the month
   - **% Invoices Paid** should be 100% once collections are done

3. If a number looks off, click its **&#9432;** to see the formula and what rows feed it.

### AT-02-07: Review anomalies
**Priority:** P3

**Steps:**
1. On the Dashboard, look at the **Anomalies** list.
   - **Expected:** rows where a bill is ≥ 20% (and ≥ CHF 10) off the vendor's historical mean.

2. For each flagged bill, decide if it's legitimate (e.g. one-off surge) or an error.
   - Legitimate → click ✓ to dismiss.
   - Error → edit the bill to fix the amount.

---

## §3 Quarterly (April / July / October / January)

### AT-03-01: VAT filing preparation
**Priority:** P1

**Steps:**
1. Navigate to **Reports** → **VAT Tracker**.

2. Set the year selector to the year covering the quarter you're filing.
   - **Expected:** output VAT (sum of invoice tax fields) + input VAT (recoverable from bills) shown for the year.

3. Compare with the VAT due in the official ESTV form for the quarter. Use the export buttons on the Invoices and Bills pages to get the underlying detail.
   - **Expected:** output VAT in the app matches your invoice CSV; input VAT matches your bill CSV (filtered by quarter).

4. Submit the VAT form to ESTV. Record the payment in **Obligations** with type `vat`, period label like `Q2 2026`, amount, due date.

### AT-03-02: Quarterly AHV summary
**Priority:** P1

**Steps:**
1. Navigate to **Reports** → click the quarter button (Q1 / Q2 / Q3 / Q4) at the top.
   - **Expected:** summary shows AHV/IV/EO + ALV totals for the quarter + employer's FAK contribution.

2. Cross-reference with the Ausgleichskasse invoice for the quarter.
   - **Expected:** amounts match within a few francs (rounding).

3. Mark the AHV obligation `paid` in the Obligations page once you've transferred to the Ausgleichskasse.

### AT-03-03: Generate recurring bills + obligations for the next quarter
**Priority:** P2

**Steps:**
1. Bills & Documents → click **Generate recurring** (button in the page header).
   - **Expected:** any monthly/quarterly/yearly bills whose next occurrence falls in the next 2 months are created as `unpaid`.

2. Obligations → click **Generate recurring**.
   - **Expected:** future-period obligations are populated for the next 6 months.

3. Spot-check a few rows to confirm dates + amounts are right.

---

## §4 End of year

### AT-04-01: Generate the annual P&L report
**Priority:** P1

**Steps:**
1. Dashboard → pick the year in the **P&L year** selector → click **P&L Report**.
   - **Expected:** Excel file downloads with income / costs / profit broken out, travel-expense reimbursements isolated.

2. Open the file and confirm it matches what's on screen (YTD totals when time range is set to **This year**).

### AT-04-02: Generate the travel expense report for the year
**Priority:** P1 (if you bill expenses back to clients)

**Steps:**
1. Navigate to **Expenses** → year filter set to the year you're closing.

2. Click **Generate Report**.
   - **Expected:** PDF generated, downloaded automatically, and the report appears in the "Generated reports" list. Any prior report for the same year is replaced.

3. Send the PDF to your client (or attach to the year's pass-through invoice).

### AT-04-03: Build the accountant package
**Priority:** P1

**Steps:**
1. Reports → **Accountant Package** → **Download full package (ZIP)**.
   - **Expected:** ZIP contains: all invoices (PDFs), all bill files, expense report PDF, obligations summary, monthly P&L CSV.

2. Hand it to Alpen Treuhand AG for the annual closing.

### AT-04-04: Dividend planning (if applicable)
**Priority:** P2

**Steps:**
1. Navigate to **Dividends**.

2. Fill in: share capital, current legal reserve, carry-forward, tax provision %, personal tax %.

3. Try a proposed dividend amount → review:
   - **Distributable** must be ≥ proposed (otherwise the GV resolution is voidable).
   - **Runway after** should not fall below 3 months for safety.

4. If the numbers look healthy and Treuhand agrees, draft the **GV resolution**, pay the dividend, register the **35% Verrechnungssteuer** with ESTV.

### AT-04-05: Verify retained earnings will carry forward
**Priority:** P2

**Steps:**
1. Sum the year's net profit (income − costs − tax provision − dividends paid).

2. Note that figure as next year's **carry-forward** in the Dividend Planner inputs once the books are closed.
   - **Expected:** value matches what Treuhand records on the balance sheet under "Bilanzgewinn".

---

## §5 Sanity checks (any time)

### AT-05-01: Spot-check a random invoice
**Priority:** P3

**Steps:**
1. Pick any invoice from the list → click 👁 to preview the PDF.
   - **Expected:** amount, period, customer, VAT line match what's in the table row.

2. Click the customer column → confirm the customer record has the right address and VAT number.

### AT-05-02: Spot-check a random bill
**Priority:** P3

**Steps:**
1. Pick a bill with a 📎 file → click the file icon.
   - **Expected:** PDF/image opens and the amount on the document matches the row.

2. Confirm the category is sensible (Office Supplies, Software, Professional Services, etc. — anything in `Other` should be reviewed).

### AT-05-03: Anomaly sweep
**Priority:** P3

**Steps:**
1. Dashboard → look at the **Anomalies** widget.
   - **Expected:** all visible items have explanations you can write in the Notes field of the corresponding step here.

2. Anything you can't explain → investigate or follow up with the vendor.

### AT-05-04: Backup
**Priority:** P1 (monthly minimum)

**Steps:**
1. Click the **💾 Backup** icon in the sidebar footer.
   - **Expected:** a `cockpit_backup_YYYY-MM-DD.zip` file downloads containing the database and every document.

2. Move it to your safe place (external drive / cloud).

---

## §6 Reconciliation prompts — fill these in as you find issues

Use the Notes field on each step here to track recurring problems you want to
fix or investigate further.

### AT-06-01: Open questions for Treuhand
**Priority:** P3

**Steps:**
1. List anything ambiguous that came up this month that needs your accountant's input. Use the Notes field on this single step as a running journal.
   - **Expected:** ideally empty by end of quarter.

### AT-06-02: Things to automate / improve
**Priority:** P3

**Steps:**
1. Note anything in the workflow that felt repetitive or error-prone — use this as a backlog for app improvements.
