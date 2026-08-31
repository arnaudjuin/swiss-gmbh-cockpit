# Calculations & Formulas

Every number the app shows you, with the exact formula and the SQL/Python that
produces it. Use this when you're not sure whether a stat card matches what
your bookkeeper expects.

Most queries respect the **Dashboard time range** selector (`prefs.dashboard.range`)
and use these date bounds:

| Range key | Window |
|---|---|
| `ytd` (default) | Jan 1 current year → today |
| `month` | 1st of current month → today |
| `30d` | today − 30 days → today |
| `12m` | today − 365 days → today |
| `year` | Jan 1 → Dec 31 current year |
| `prev_year` | Jan 1 → Dec 31 previous year |
| `all` | 1970-01-01 → today |

Where a metric ignores the range (e.g. *Overdue*), it's noted explicitly.

---

## Monthly money flow — customer → GmbH → savings (after tax)

Big-picture view of where every CHF goes each month. Numbers come from the
seeded `payroll_settings` (retro-changed 24.08.2026 to Gross 9'500.00 · Source tax 1'100.00 · net 8'000 · Zurich rates).
Tweak Payroll → Settings to recompute for your real values.

```
            ┌─────────────────────────────────────────────┐
            │       CUSTOMER (e.g. Acme Tech)            │
            │  pays Invoice  ~ X CHF       depends on      │
            │                                hours billed  │
            └────────────────────┬────────────────────────┘
                                 │
                                 ▼
            ┌─────────────────────────────────────────────┐
            │           GmbH bank account                 │
            │             cash_balance.balance            │
            └────────────────────┬────────────────────────┘
                                 │
                                 │  monthly outflow ≈ 14,880 CHF
                                 │     + variable bills (Treuhand, software, …)
                                 │
   ┌─────────────────────────────┼─────────────────────────────────────┐
   │                             │                                     │
   ▼                             ▼                                     ▼
┌────────────┐         ┌────────────────────┐                  ┌───────────────────┐
│ Bills      │         │ Obligations        │                  │ Payroll outflows  │
│ company_   │         │ (Ausgleichskasse,  │                  │                   │
│ docs       │         │  AXA, ESTV, Canton)│                  │  9,123.98  → you  │
│            │         │                    │                  │                   │
│ Treuhand,  │         │  AHV/IV/EO + ALV   │                  │  2,340.00  ZH tax │
│ software,  │         │     1,664          │                  │     (source tax)  │
│ rent, etc. │         │  FAK         156   │                  │                   │
│            │         │  BVG       1,306.50│                  │  1,664.00 Ausgl.K│
│            │         │  UVG+KTG     290.04│                  │     (AHV/ALV both│
└────────────┘         │  VAT   quarterly   │                  │      sides)       │
                       │  Corporate tax     │                  │                   │
                       │     yearly         │                  │    156.00 FAK     │
                       └────────────────────┘                  │  1,306.50 BVG     │
                                                               │    290.04 AXA     │
                                                               │           (KTG+UVG)│
                                                               └─────────┬─────────┘
                                                                         │
                                                            net salary  ▼ 9,123.98
                                                               ┌──────────────────┐
                                                               │ Personal bank    │
                                                               │ (Max)         │
                                                               └────────┬─────────┘
                                                                        │
                                                                        ▼
                                          ┌─────────────────────────────────────────┐
                                          │ Living expenses              ─ X        │
                                          │ → handled OUTSIDE the app               │
                                          └────────────────────┬────────────────────┘
                                                               │
                                                               ▼
                                                       Savings account
                                                  = net salary − living costs
```

### Monthly outflow detail

| Step | Where in the app | Amount (CHF) |
|---|---|---|
| Customer pays invoice | Invoice row flipped `paid` (status badge or `propose_action`) | varies |
| GmbH pays bills | `company_docs` rows flipped `paid` | varies |
| AHV/IV/EO + ALV (both sides) → Ausgleichskasse | obligation `ahv` | 1,664.00 |
| FAK (employer only) | usually rolled into the AHV invoice | 156.00 |
| BVG (both sides) → AXA | obligation `bvg_*` | 1,306.50 |
| UVG + KTG (accrual to AXA, billed yearly) | obligation entries | 290.04 |
| Source tax → Canton ZH | obligation `vat`/`other` | 2,340.00 |
| Net salary → personal | Payroll → payslip status `paid` | **9,123.98** |
| **Total GmbH monthly outflow (payroll side)** | | **≈ 14,880.52** |

### End-of-period flows

| Period | Flow | Where |
|---|---|---|
| Quarterly (Apr / Jul / Oct / Jan) | VAT due (`output_vat − input_vat`) → ESTV | Reports → VAT Tracker |
| Yearly | Corporate tax (≈ 21.5 % of pre-tax profit, Zurich baseline) → cantonal tax office | Reports → Corporate Tax Estimate |
| Yearly (optional) | Dividend = retained earnings − legal reserve; 35 % Verrechnungssteuer to ESTV (refundable for residents); remainder taxed at personal income tax bracket | Dividends page |

### What's tracked where

- 🟢 **Inside the app** — every customer invoice, every bill / obligation,
  every payslip, the GmbH cash balance, runway forecasting, anomaly detection,
  dividend planning.
- 🟡 **Manual today** — personal living expenses and the personal savings
  balance live outside the app (they're not GmbH books — different accounting
  scope).
- 🔴 **Not yet automated** — bank-side confirmation that a transfer actually
  settled. The **Bank CSV Import** page closes this gap when you upload a CSV
  or (future) CAMT.053 statement.

### Quick-glance widgets

- **Net Salary (monthly)** stat card on the Dashboard — live from
  `/api/payroll/preview`.
- **Cash Balance** + **Runway** stat cards on the Dashboard — GmbH side.
- **Dividend Planner** page — what could eventually flow out to you on top of
  the salary.
- **Anomalies** list — flags bills that deviate from the vendor's baseline so
  unusual outflows surface before they reach `paid`.

The numbers above come from `payroll_settings` (row id=1). Change them in
**Payroll → Settings**; the full formulas are in [§ Swiss Payroll](#swiss-payroll)
below.

---

## Income

### Total Income (in range)

```
total_income  =  Σ income_entries.amount (where income_date in range)
```

Income is **cash actually received**, not invoiced. Paid invoices auto-create
a matching `income_entries` row (linked via `invoice_id`), so the single
SUM above captures both invoice payments and manual income (refunds, bank
interest, etc.).

- **Excluded** — invoices that haven't been marked paid yet (they'd be
  *revenue*, not *received income* — see the Billed widget for that).
- **Excluded** — invoices with `hours = 0` (travel-expense reimbursement
  reports; they're cash-in but they zero out against the matching expenses
  pass-through).
- **Excluded** — Personal ↔ GmbH transfers (balance-sheet, not P&L).

### How invoice ↔ income linking works

When you toggle an invoice's status to `paid` (UI badge, AI `propose_action`,
or any other path through `PATCH /api/invoices/{id}/status`):
1. The invoice row updates with `paid_status='paid'` and `paid_date=today`.
2. A new `income_entries` row is created with:
   - `income_date = today`
   - `source = Invoice #NNNN`
   - `amount = invoice.total`
   - `category = Invoice Payment`
   - `invoice_id = invoice.id` (foreign key)

When you toggle back to `unpaid`, or delete the invoice, the linked
`income_entries` row is deleted. A `UNIQUE` partial index on `invoice_id`
guarantees at most one income row per invoice — re-marking paid is idempotent.

Backfill: on app startup, every paid invoice without a linked income row gets
one auto-created (using `paid_date` or `YYYY-MM-25` as a fallback).

### Invoices YTD vs Paid YTD

```
invoices_in_range  =  Σ invoices.total where hours>0 and period in range
paid_in_range      =  Σ invoices.total where hours>0 and paid_status='paid' and period in range
% paid             =  paid_in_range / invoices_in_range × 100
```

`paid_status` flips when you click the status badge in the invoice list (or use
the AI chat's `propose_action`).

### Average Monthly Revenue

```
avg_monthly_rev  =  Σ all billable invoice totals (ALL time) / count of distinct invoiced months
```

Always all-time, regardless of the dashboard range — the denominator only
counts months that have at least one invoice, so empty months don't drag the
average down.

---

## Costs

### Total Costs (in range)

```
total_costs  =  Σ company_docs.amount (where doc_date in range)
              + Σ obligations.amount (where period_year ∈ years covered by range)
```

- **Includes** — every bill in the period (paid + unpaid) and every obligation
  for the year (AHV, BVG, taxes, KTG, UVG, FAK, source tax).
- **Excluded** — travel expenses (they're reimbursable, billed back to clients,
  not GmbH costs).
- **Excluded** — payroll (already represented by the AHV/BVG obligations and
  the salary outflow; otherwise we'd double-count).

### Payable date (obligations)

```
payable_date = max(due_date, expected_bill_date)   # expected_bill_date may be NULL
```

`due_date` marks the accrual period (e.g. AHV Apr 2026 → 30.04.2026); the
money only leaves when the bill arrives (akonto 15.10 / 28.02, Quellensteuer
quarterly, …). **Overdue, Due next 30/60 days, Next obligation, Calendar,
Cash Allocation "due soon", Forecast and upcoming-payments all use the payable
date** (`PAYABLE_SQL` in `routes/obligations.py`, `payable_date` in the API).

### Costs by Category

```
for each category in company_docs:
  total_for_cat = Σ company_docs.amount where category = cat and doc_date in range
```

Shown in the Costs by Category chart — ranked horizontal bars by default
(largest first, one hue = magnitude), switchable to a doughnut via the &#9432;
settings panel. More than six categories fold the tail into "Other".

### Income vs Costs by Month (chart)

```
for each month m of the chart year:
  income_m = Σ invoices.subtotal (hours > 0, invoice month = m)
           + Σ income_entries.amount (invoice_id IS NULL, income_date in m)
  costs_m  = Σ company_docs.amount (doc_date in m, category ∉ {Payroll Settlement, Taxes / VAT})
           + Σ payslips.total_employer_cost (payment_date in m)
  profit_m = income_m − costs_m          # dashed line, same axis
```

Same accrual lens as the headline cards and Reports → P&L; Σ profit_m over
the year equals the Net Profit card for the "This year" range.

### Page recap tiles

One tile per page (Bank, Cash & reserves, Bills, Obligations, Payroll,
Invoices, Kontokorrent, VAT, Dividends, Expenses & trips). Each shows the page's headline
figure plus a status chip; clicking opens the page. The Kontokorrent tile uses
the `/transfers/balance` formula (salary and reimbursement transfers excluded;
unreimbursed personal-card bills and open expense reports included) — positive
= GmbH owes you, negative = you owe the GmbH.

### Bills paid YTD

```
bills_paid_in_range = Σ company_docs.amount where doc_date in range and status='paid'
```

---

## Profit

```
profit          =  total_income − total_costs
profit_margin_% =  profit / total_income × 100   (0 if total_income == 0)
```

Both honor the dashboard time range.

---

## Overdue + Upcoming

These widgets ignore the range — they always reflect *as of today*.

```
overdue_total  =  Σ unpaid company_docs where due_date < today
                + Σ unpaid obligations where due_date < today

due_next_30d   =  Σ unpaid company_docs where today ≤ due_date ≤ today+30
                + Σ unpaid obligations where today ≤ due_date ≤ today+30
```

---

## Cash, Runway, Reserve Health

### Cash Balance

```
balance      = cash_balance.balance     # single row, user-entered
as_of        = cash_balance.as_of
```

### Monthly Burn

```
monthly_recurring_cost  =  Σ recurring bills / recurrence factor
   (monthly: ÷1, quarterly: ÷3, yearly: ÷12)

obligations_horizon  =  365 days
monthly_obligations  =  (Σ unpaid obligations with due_date ≤ today+365) / 12

monthly_payroll      =  total_employer_cost (from current payroll settings, if gross > 0)

avg_monthly_invoice  =  AVG(invoices.total) over the last 6 months, hours > 0

monthly_burn  =  monthly_recurring_cost
              +  monthly_obligations
              +  monthly_payroll
              −  avg_monthly_invoice
```

### Runway

```
runway_months  =  cash_balance.balance / monthly_burn       (only if monthly_burn > 0)
               =  ∞ (cash positive — no burn)              (otherwise)
```

Shown as N.N months, rounded to one decimal.

### Reserve Health Forecast

For each `budget_items` row:

```
current_balance       =  budget_items.balance
monthly_contribution  =  budget_items.budgeted
projected_12m         =  current_balance + monthly_contribution × 12

# Match against upcoming bills by substring on vendor/description/category
if a matching upcoming bill exists:
    months_until_due  =  (due_year - today.year) × 12 + (due_month - today.month)
    balance_at_due    =  current_balance + monthly_contribution × months_until_due
    gap               =  balance_at_due − bill.amount
    status            =  "healthy"    if gap ≥ 0
                      =  "shortfall"  if gap < 0
```

---

## Anomaly Detection

For every vendor with ≥ 3 historical bills, compare the most recent bill to the
mean of the rest:

```
amounts  =  all bills.amount for this vendor, ordered desc by doc_date
recent   =  amounts[0]
previous =  amounts[1:]

mean     =  AVG(previous)
stdev    =  STDEV(previous)         (0 if only 1 prior bill)
deviation_chf  =  recent − mean
deviation_pct  =  deviation_chf / mean × 100

flagged if  |deviation_pct| ≥ 20  AND  |deviation_chf| ≥ CHF 10
severity = "high"    if |deviation_pct| ≥ 50
         = "medium"  otherwise
```

Bills marked `[anomaly-reviewed]` in their description are skipped.

---

## Swiss Payroll

All rates are read from `payroll_settings` (row id=1). Computed per month.

### Employee deductions

```
ahv_employee  =  gross_monthly × ahv_employee_pct / 100        # ALV cap: 5.3 % of gross
alv_employee  =  gross_monthly × alv_employee_pct / 100        # 1.1 % up to CHF 148'200/yr, 0.5 % surplus

bvg_employee  =  bvg_monthly_employee                          # exact CHF, AXA plan
uvg_employee  =  uvg_employee_monthly                          # exact CHF, AXA plan
ktg_employee  =  ktg_monthly_total × (1 − ktg_employer_share_pct / 100)

source_tax    =  source_tax_monthly                            # user enters from canton tariff

emp_total_deductions  =  ahv + alv + bvg + uvg + ktg
net_salary            =  gross − emp_total_deductions − source_tax
```

### Employer-side contributions

```
employer_ahv  =  gross × ahv_employer_pct / 100                # 5.3 %
employer_alv  =  gross × alv_employer_pct / 100                # 1.1 %
employer_bvg  =  bvg_monthly_employer
employer_uvg  =  uvg_employer_monthly
employer_ktg  =  ktg_monthly_total × (ktg_employer_share_pct / 100)
employer_fak  =  gross × fak_employer_pct / 100                # ~1.2 % cantonal

employer_total       =  employer_ahv + employer_alv + employer_bvg + employer_uvg + employer_ktg + employer_fak
total_employer_cost  =  gross + employer_total
```

### YTD payroll

```
ytd_gross           =  Σ payslips.gross               where year = current year
ytd_net             =  Σ payslips.net_salary          where year = current year
ytd_employer_cost   =  Σ payslips.total_employer_cost where year = current year
```

---

## VAT (quarterly)

```
output_vat  =  Σ invoices.tax (where year = chosen year)
input_vat   =  Σ company_docs.amount × (VAT rate / (100 + VAT rate))    # recoverable VAT
vat_due     =  output_vat − input_vat
```

The 8.1 % Swiss standard rate is configured in `generate_invoice.py:VAT_RATE`.

---

## Corporate Tax (estimate)

```
pretax_profit  =  total_income_ytd − total_costs_ytd
tax_estimate   =  pretax_profit × tax_provision_pct / 100         # default 21.5 % (8.5 federal + 13 cantonal Zurich)
```

The estimate is shown on the Reports → Corporate Tax Estimate panel. Real
liability depends on the full Steuererklärung — verify with Treuhand.

---

## Corporate tax & dividends — full worked example (FY 2026)

> Planning example written 2026-07 with the numbers current at the time
> (revenue plan: ~10.6k/mo Mar–Jul, 22k Aug, 35k/mo Sept–Dec; Zurich City;
> single; B permit → mandatory retroactive ordinary assessment since gross
> salary > CHF 120k). Not tax advice — confirm each step with Treuhand.

### Two taxpayers, two taxes — why "I already pay Steuer monthly" ≠ done

The monthly Quellensteuer on the payslip (tariff A0N) settles **your personal
income tax on the salary** — federal, cantonal and communal all bundled.
Corporate tax is a **different taxpayer** (the GmbH) taxed on a different
base (what's left *after* your salary and all other costs):

```
Customer pays the GmbH
   ├─► your salary  → deductible cost for the GmbH
   │                  → taxed once, on YOU, via monthly Quellensteuer ✓
   └─► profit stays → taxed once, on the GMBH (~19.7 % Zurich City)
                      → taxed AGAIN (partially) on you only when
                        distributed as a dividend
```

### What the GmbH pays and when (first fiscal year = 2026)

| Tax | Rate (ZH City) | On ~CHF 33–40k profit before tax |
|---|---|---|
| Federal profit tax | 8.5 % statutory ≈ 7.8 % effective (tax deducts itself) | ~2'600–3'100 |
| Cantonal + communal profit tax | ≈ 11.9 % effective | ~3'900–4'800 |
| **Total profit tax** | **≈ 19.7 % of pre-tax profit** | **~6'500–8'000** |
| Capital tax | ≈ 0.17 % of taxable equity | ~50–100 |

```
2026        nothing billed — reserve ~CHF 2'000/month from September
2027 ~Feb   federal provisional bill arrives
2027 31.03  ► pay federal ~2'600–3'100  (due 1.3 + 30 d; late ≈ 4.5 % interest,
                                          early = 0 % credit → pay on time)
2027 Q2–Q3  ► pay ZH cantonal/communal provisional ~3'900–4'800
2027 ≤30.09 Treuhand files the FY2026 return (extension routine)
2028 ~H1    definitive assessment: final ± small difference + capital tax
```

Rules of thumb: bills always run 3–15 months behind the profit; provisional
first, definitive later; interest only punishes lateness, never rewards
early payment.

### Dividend waterfall — from profit to pocket

Constraint that surprises everyone: **cash saved ≠ distributable**. A dividend
can only be paid from approved retained profit (Art. 798 OR); the cash balance
is irrelevant to the cap. Ordinary dividend = after the AGM approves the
closed year (Feb–June of year+1). A **December interim dividend** from the
current year is possible since 2023 (Art. 675a OR): needs interim statements
from Treuhand + shareholder resolution (audit waivable with opting-out).

```
FY2026 profit before tax                    ~36'000
− corporate tax ≈ 19.7 %                    − 7'100
− legal reserve (5 % of profit,             − 1'450
  mandatory until reserve = 20 % of capital)
= max dividend FY2026 supports              ~27'500
```

On payout of a gross dividend D:

```
paid to you now          = 0.65 × D          # 35 % Verrechnungssteuer withheld
VST to ESTV within 30 d  = 0.35 × D          # refunded via your tax return —
                                             # ONLY if the dividend is declared
personal income tax      ≈ 18–20 % × D       # qualified holding ≥ 10 %:
                                             # 70 % taxable federally,
                                             # 50 % cantonally (ZH), at ~32 %
                                             # marginal (156k salary, single)
net kept, all settled    ≈ 80 % × D
```

Compare: extra salary/bonus nets ~60–65 % (AHV/ALV/BVG + full income tax) but
has no profit cap and is deductible — the fallback when the dividend cap binds.

### The 52k example (no car purchase, pot is genuinely free cash)

Saving CHF 52'000 for dividends does NOT allow one 52k payout — FY2026 caps
tranche 1 at ~27.5k; the rest needs FY2027 profit behind it:

| When | Event | Lands on personal account | Running total |
|---|---|---|---|
| Dec 2026 | Interim dividend 27'500 (65 %) | +17'900 | 17'900 |
| Jan 2027 | GmbH pays VST 9'600 to ESTV | — | |
| ~Mid 2027 | Tranche 2: 24'500 once FY2027 profit covers it (65 %) | +15'900 | 33'800 |
| 2028–29 | Tax assessments: +18'200 VST refund − ~10'000 income tax | +8'200 | **≈ 42'000** |

**≈ CHF 42'000 net on ~52'000 gross (~80 %)** — but only ~18k by 31.12.2026,
~34k by summer 2027, the last ~8k via the assessments a year later.

Prerequisites for the full amount:
1. The 52k pot is free cash **after** corporate tax (~7k, bills 2027), Q4 VAT
   (~8k, due March 2027) and running payroll.
2. Both dividends are declared in the tax returns (undeclared → the 35 %
   withholding becomes a definitive loss).
3. FY2026 profit lands as planned and 2027 keeps earning (tranche 2).
4. Distribution never endangers creditor coverage (Art. 675a II OR) — the
   40k-car-in-December variant fails exactly this test (cash would go
   negative); car belongs in Q1 2027 after revenue confirms.

---

## Dividend Planner — multi-year set-aside model

Each dividend covers **one fiscal year's profits**, so per-year contributions
cap at 12 months by definition. The planner lets you stack as many fiscal
years as you want (e.g. plan 2026, 2027, 2028 together) and shows the
cumulative gross pot + per-bucket totals across all of them.

### Inputs

- `bucketNames` — shared list of bucket category names (e.g. *Wine*, *Bague*,
  *Down payment*). One row per category, same names across all years.
- `years` — list of `{fiscalYear, startMonth, amounts}` rows. One row per
  planned dividend year.
  - `fiscalYear` — GmbH fiscal year (e.g. 2026)
  - `startMonth` — 1–12, month within that year you began contributing.
    January = 12 contributing months; April = 9; December = 1.
  - `amounts` — array of CHF/month aligned 1:1 with `bucketNames`. So
    `years[1].amounts[3]` is *how much you set aside per month for bucket 3
    during fiscal year 1*. **Amounts vary by year** — that's the whole point.
- `fedRatePct` — your **marginal federal** income-tax rate (default 12% —
  the marginal band at ~CHF 150–200k taxable, single)
- `cantRatePct` — your **marginal cantonal + communal** rate (default 21.5% —
  ZH base rate × Steuerfuss, canton 98% + Zurich City 119%)
- `starting` — extra amount already in the pot from before the plan begins
  (default 0)

Distribution payout for each year is informational only: June of
`fiscalYear + 1` (typical post-AGM window).

### Calculations

```
for each year y in years:
    y.months         =  12 − y.startMonth + 1              # CAPPED at 12 by definition
    y.monthly        =  Σ y.amounts[k]                     # sum of column k for year y
    y.gross          =  y.monthly × y.months
total_months         =  Σ y.months                          # cumulative across years
contributions        =  Σ y.gross                           # cumulative across years
gross_pot            =  max(0, starting) + contributions

withholding_tax      =  gross_pot × 0.35              # withheld at source, refundable
net_to_shareholder   =  gross_pot − withholding_tax    # what lands in personal account
# Partial taxation for qualified holdings (≥ 10%): only 70% of the dividend
# is taxable federally and 50% cantonally (ZH) — each at the MARGINAL rate:
effective_rate       =  0.70 × fedRatePct/100 + 0.50 × cantRatePct/100
                     # defaults: 0.70×12% + 0.50×21.5% ≈ 19.15%
personal_tax         =  gross_pot × effective_rate
net_after_tax        =  gross_pot − personal_tax       # WHT later credited via NOV refund
```

The **hero number** displayed at the top is `net_after_tax` — what you actually
keep once income tax is settled.

### Per-bucket allocation (sum across years, with per-year amounts)

Each bucket's slice sums its per-year contributions:

```
for each bucket index b:
    b.gross  =  Σ over years y:  y.amounts[b] × y.months
    b.net    =  b.gross × (1 − effective_rate)
```

So if Wine = `500 in FY 2026 (9 months)` and `700 in FY 2027 (12 months)` at
the default rates (effective ≈ 19.15%), Wine gross = `500 × 9 + 700 × 12 =
4,500 + 8,400 = CHF 12,900`, Wine net = `12,900 × 0.8085 ≈ CHF 10,430`. The sum of every bucket's
gross equals the overall gross pot, and the sum of every bucket's net equals
`net_after_tax`.

### Warnings

- **Amber** if `months_remaining == 0` (distribution date is past or this
  month — pick a later month/year).
- **Green ✓** otherwise (plan saved; Treuhand still confirms distributable
  profit at GV time).

> Cash-impact warnings were intentionally removed from this page — the
> dividend planner is a *projection*, not a current-cash check. Use the
> Dashboard's **Cash Balance** + **Runway** widgets for live cash status.

### What this planner does NOT model

Deliberately simpler than the full Swiss dividend mechanics so the page stays
glanceable. The following are still your (and Treuhand's) job at GV time:
- 5%-to-legal-reserve allocation rule until reserve reaches 50% of share capital
- Distributable-profit ceiling vs actual retained earnings on the balance sheet
- Qualified-shareholding (≥10%) partial-exemption reducing effective personal tax
- Cantonal variations in personal-income tax calculation

Treat the projection as a **plan + reality check**, not the final GV figure.

---

## Conventions

- All amounts shown as CHF unless the source row has a different `currency`.
- "Period" for invoices = `(year, month)` tuple; queries use
  `year × 12 + month` for sortable comparison.
- "Date" for company_docs = `doc_date` (ISO `YYYY-MM-DD`).
- "Period year" for obligations = the year the obligation applies to, not the
  due date.
- Travel expenses (`expenses` table) are **never** counted in income or costs —
  they are reimbursable pass-throughs.
