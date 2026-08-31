# Payroll Setup Notes — Muster Consulting GmbH

Reference for the monthly salary slip of Max Muster.
Employment start: 2026-04-01 · Canton: Zurich · Permit: B

> **RETROACTIVE CHANGE (24.08.2026):** salary reduced to **CHF 8'000 net
> (gross 9'500.00)**, applied retroactively from April. Payslips Apr–Aug
> were regenerated; the overpaid net (3 × old payments) was reclassified
> as Kontokorrent repayment in the owner ledger. Treuhand must mirror this
> in the AHV wage declaration, the source-tax correction and the AXA
> insured salary. The tables below show the CURRENT payslip.

---

## 📋 Monthly breakdown (gross CHF 9'500.00)

### Employee side (deductions from gross)

| Line | Amount | Source |
|------|--------|--------|
| AHV / IV / EO | CHF 576.87 | Official 5.3% |
| ALV | CHF 119.73 | Official 1.1% (gross now below the 12'350/mo plafond) |
| BVG 2nd pillar | CHF 522.60 | **Exact** — AXA policy (still on the OLD insured salary — re-rate pending) |
| UVG — Non-occupational (NOA/NBU) | CHF 153.26 | **Exact** — AXA policy |
| KTG — Daily sickness (50%) | CHF 53.43 | **Exact** — AXA policy |
| Source Tax (Quellensteuer, tariff A0N) | CHF 1'100.00 | **⚠ Held at 13.4% effective — get the exact A0N amount for 10'884 gross** |
| **Total deductions** | **CHF 2'300.00** | |
| **Net salary** | **CHF 7'200.00** | |

### Employer side (GmbH contributions on top of gross)

| Line | Amount | Source |
|------|--------|--------|
| AHV / IV / EO | CHF 576.87 | Official 5.3% |
| ALV | CHF 119.73 | Official 1.1% |
| BVG 2nd pillar | CHF 783.90 | **Exact** — AXA policy (re-rate pending) |
| UVG — Occupational + Supplementary | CHF 29.92 | **Exact** — AXA policy (OA 8.65 + Supp 21.27) |
| KTG — Daily sickness (50%) | CHF 53.43 | **Exact** — AXA policy |
| FAK — Family Allowance Fund | CHF 130.61 | **⚠ Estimate — Zurich typical 1.2%** |
| **Total employer contributions** | **CHF 1'694.46** | |
| **Total employer cost** | **CHF 11'000.00** | |

---

## 🏦 AXA policy reference

**Policy:** Personal Insurance · **#44.204.594** (replaces interim policy #1.234.567.890)
**Term:** 2026-05-08 → 2029-12-31 (annual renewal afterwards, 3-month notice as of Dec 31)
**Annual premium:** CHF 3,480.43 (billed annually, not monthly) — start-up discount applied
**First invoice:** CHF **2,252.60** pro-rated for 08.05.2026 → 31.12.2026, due 11.06.2026

### Insured salary

- **Annual salary base: CHF 156,000**
  - **AIA salary** (capped at CHF 148,200) — used for OA / NOA / KTG / Supp AIA
  - **Surplus salary** (CHF 7,800, the slice above CHF 148,200) — used for Supp surplus only

### Premium breakdown (annual)

| Module | Premium (CHF/yr) | Rate (‰) | Salary base | Monthly | Side |
|---|---:|---:|---|---:|---|
| Occupational Accident (OA) | 103.74 | 0.70 | 148,200 | 8.65 | Employer only |
| Non-occupational Accident (NOA) | 1,839.16 | 12.41 | 148,200 | 153.26 | **Employee only** |
| Supplementary AIA salary | 189.70 | 1.28 | 148,200 | 15.81 | Employer (management coverage) |
| Supplementary Surplus salary | 65.52 | 8.40 | 7,800 | 5.46 | Employer (management coverage) |
| Daily sickness (KTG) | 1,282.32 | 8.22 | 156,000 | 106.86 | Split 70/30 employer/employee |
| **Total annual premium** | **3,480.43** | | | **290.04** | |

Coverage highlights (Managing Director Max Muster):
- Accident — Daily benefits CHF 124,800/yr, 2-day waiting, 80% level, until AIA retirement
- Accident — Disability pension max CHF 124,800/yr; survivor pension max CHF 109,200/yr
- Daily sickness — CHF 124,800/yr, 30-day waiting per illness, 80%, 730 days per case

### Why the policy was reissued

The original policy #1.234.567.890 was an interim contract from 2026-04-01. AXA
re-issued under a new permanent policy number (#44.204.594) effective
2026-05-08 with identical pricing. The April 2026 period is covered under the
old policy number — if any salary was paid for April, ensure the AHV/UVG/KTG
declarations to the Ausgleichskasse / AXA reference the correct policy for the
right month.

### Where to attach the latest invoice in the app

When the next AXA bill arrives, record it in **Bills & Documents** → +New Bill:

- Vendor: `AXA Insurance Ltd`
- Description: `Personal Insurance #44.204.594 — AIA + Supplementary + KTG, <period>`
- Amount: invoice total · Currency: CHF · Category: Insurance
- Due date: invoice due date · Recurrence: `yearly` (full premium = CHF 3,480.43)
- Attach the Décompte de prime PDF as the document.

---

## 🇨🇭 Swiss rules applied

### AHV/IV/EO (1st pillar) — 5.3% each side (official)
- AHV 4.35% + IV 0.7% + EO 0.25%
- Not an estimate — these are the legally mandated rates

### ALV (unemployment) — with plafond
- **Up to CHF 148,200/year** (CHF 12,350/month): 1.1% each side
- **Above** that: 0.5% "solidarity" contribution each side
- At the current gross of 9'500.00/mo (130.6k/yr) the whole salary sits
  below the plafond → plain 1.1% = CHF 119.73 per side

### BVG (2nd pillar) — AXA plan, coordinated salary
- Policy still computed on the OLD insured salary (156k): coordinated
  129'540 → CHF 1'306.50/mo (employee 522.60 / employer 783.90)
- After the retro change AXA must re-rate to insured 130'613 →
  premiums drop ~14% and a credit for Apr–Aug is expected

### FAK (Family Allowance Fund)
- **Employer-only** contribution to Zurich family compensation office
- Required even without children
- Rate varies by Ausgleichskasse (1.0–1.4% in Zurich typical)
- Currently set: 1.2% → CHF 130.61/mo
- **Verify exact rate on your Ausgleichskasse annual sheet**

### Source Tax (Quellensteuer) — B permit
- **Applies because** I hold a B permit — withheld monthly from gross salary
- At the current gross (~130.6k/yr **at the old salary it exceeded 120k; after the retro
  change 2026 gross ≈ 98k → below the mandatory-NOV threshold** — a voluntary NOV
  can still be filed to claim deductions
- Source tax acts as an advance payment against the final tax bill — year-end NOV reconciles (refund or extra payment)
- **Tariff A0N** = single, no children, no church
- Currently set: CHF 1'100.00/mo (13.4% effective held from the old tariff point) — pull the exact A0N amount for 10'884 gross

**Official ZH tariff tables:** https://www.zh.ch/de/steuern-finanzen/steuern/quellensteuer.html

**Tariff code meaning:**
- 1st letter — civil status: A=single, B=married sole earner, C=married both earners, H=single parent
- Digit — number of dependent children (0-9)
- Last letter — church tax: N=no, Y=yes

**When I need to change tariff:**
- Marriage → change to B or C
- Child → increment the digit
- Church registration → change N to Y
- → update in Payroll → Settings → Source Tax

---

## 💸 Monthly money flow (what the GmbH actually pays out)

| Destination | Amount | Why |
|-------------|--------|-----|
| Personal bank account | CHF 7'200.00 | Net salary (25th) |
| Canton ZH (source tax) | CHF 1'100.00 | Quellensteuer — remitted QUARTERLY (tracked as source_tax obligations) |
| Ausgleichskasse | CHF 1'250.00 | AHV/IV/EO/ALV both sides (billed quarterly akonto, +FAK+~2% admin ≈ 1'549 on the bill) |
| Ausgleichskasse | CHF 130.61 | FAK (employer only, on the same bill) |
| AXA (BVG) | CHF 1'306.50 | 2nd pillar — billed QUARTERLY (e.g. Q2 invoice 3'919.50) |
| AXA (accident + KTG) | CHF 290.04 | Annual premium (paid 16.06.2026 for 08.05–31.12) |
| **Total monthly employer cost** | **CHF 11'000.00** | accrual view — actual bank outflows follow the billing rhythms above |

> **Note on AXA:** The policy is billed annually (CHF 3,480.43). The monthly CHF 290.04 is accrued bookkeeping — the actual bank transfer to AXA happens once a year.

---

## 🗓 Key dates

- **25th of each month**: Net salary paid to personal account
- **End of each month**: Obligations accrued (AHV, BVG, UVG, KTG, FAK, Source Tax)
- **Annually (spring)**: AXA premium invoice ~CHF 3,480
- **Q1 2027**: Treuhand fee ~CHF 7'000 (tracked as the 'Treuhand' obligation)
- **Annually (by March 31)**: NOV ordinary tax declaration

---

## ⚠ Items still to verify

1. **Source tax CHF 1'100.00 is a held rate** — pull the exact A0N amount for CHF 9'500.00/mo from the ZH tables
2. **FAK 1.2% is typical for ZH** but your actual Ausgleichskasse rate may differ (check annual sheet)
3. **BVG CHF 15,678/year from AXA** — verify the rate matches the age bracket (30 years old should be 7%; current looks like ~12% of coordinated salary, which corresponds to age 35–44. Check if AXA is using a more generous plan)
4. **AXA April 2026 coverage** — old policy #1.234.567.890 covered 01.04 → 07.05.2026; confirm there's no gap if April salary was already paid before the policy reissue
5. **Year-end NOV reconciliation** — file the ordinary tax declaration so the Quellensteuer prepayments are credited against the final cantonal + federal bill

---

## 📂 Where to find things in the app

| Need | Location |
|------|----------|
| Edit any rate/amount | Payroll → Settings |
| Generate monthly payslip | Payroll → + Generate Payslip |
| View PDF archive | Payroll → Payslips list |
| Track AHV/BVG/UVG/KTG payments due | Obligations page |
| See net salary as income | Income page |
| See money flow GmbH → Personal | Transfers page |
| Annual P&L for accountant | Dashboard → P&L Report |
| Full accountant package | Reports → Download full package |
