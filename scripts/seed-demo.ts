#!/usr/bin/env tsx
/**
 * Seed a coherent, fully fictional demo dataset for the Swiss GmbH Cockpit.
 *
 * Writes directly to the SQLite file (no running server needed). It (re)creates
 * the database from the app's own schema, then populates every screen with
 * internally-plausible data for fiscal year 2026 — company "Muster Consulting
 * GmbH", owner "Max Muster". All names, IBANs and figures are invented.
 *
 *   npm run seed          # -> ./data/demo.db  (or DB_PATH if set)
 *
 * Run again to rebuild from scratch (the existing demo DB is deleted first).
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SCHEMA, SINGLETON_SEEDS } from "../server/schema";
import { computePayslip, rowToSettings } from "../server/payroll";

const YEAR = 2026;
const MONTHS = 10; // Jan–Oct: invoices + payslips
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, "0");
const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Locate + reset the database file ───────────────────────────────────────
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "./data/demo.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch { /* ignore */ }
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema + singleton rows (from the app's own definitions) ───────────────
for (const stmt of SCHEMA) db.exec(stmt);
for (const seed of SINGLETON_SEEDS) db.exec(seed);

const counts: Record<string, number> = {};
const bump = (t: string, n = 1) => { counts[t] = (counts[t] ?? 0) + n; };

// ── Payroll settings (id=1) ────────────────────────────────────────────────
db.prepare(`
  UPDATE payroll_settings SET
    employer_name=@employer_name, employee_name=@employee_name,
    employee_address=@employee_address, employment_start=@employment_start,
    canton=@canton, currency='CHF', payment_day=@payment_day,
    gross_monthly=@gross_monthly,
    ahv_employee_pct=@ahv_employee_pct, ahv_employer_pct=@ahv_employer_pct,
    alv_employee_pct=@alv_employee_pct, alv_employer_pct=@alv_employer_pct,
    bvg_monthly_employee=@bvg_monthly_employee, bvg_monthly_employer=@bvg_monthly_employer,
    bvg_provider=@bvg_provider,
    uvg_employee_monthly=@uvg_employee_monthly, uvg_employer_monthly=@uvg_employer_monthly,
    ktg_monthly_total=@ktg_monthly_total, ktg_employer_share_pct=@ktg_employer_share_pct,
    fak_employer_pct=@fak_employer_pct,
    source_tax_monthly=@source_tax_monthly, source_tax_tariff=@source_tax_tariff
  WHERE id=1
`).run({
  employer_name: "Muster Consulting GmbH",
  employee_name: "Max Muster",
  employee_address: "Musterstrasse 1, 8000 Zurich",
  employment_start: `${YEAR}-01-01`,
  canton: "Zurich", payment_day: 25,
  gross_monthly: 10000.0,
  ahv_employee_pct: 5.3, ahv_employer_pct: 5.3,
  alv_employee_pct: 1.1, alv_employer_pct: 1.1,
  bvg_monthly_employee: 500.0, bvg_monthly_employer: 750.0,
  bvg_provider: "Demo Pension Foundation",
  uvg_employee_monthly: 45.0, uvg_employer_monthly: 60.0,
  ktg_monthly_total: 120.0, ktg_employer_share_pct: 70.0,
  fak_employer_pct: 1.025,
  source_tax_monthly: 1300.0, source_tax_tariff: "A0N",
});
const settings = rowToSettings(db.prepare("SELECT * FROM payroll_settings WHERE id=1").get());

// ── Preferences (id=1): company + business + dividend + dashboard defaults ──
const prefs = {
  app: {
    companyName: "Muster Consulting GmbH",
    currency: "CHF",
    locale: "de-CH",
    business: {
      company: "Muster Consulting GmbH",
      rate: 62.0,
      vat_rate: 0.081,
      from_lines: [
        "Max MUSTER", "c/o Alpen Treuhand AG", "Musterstrasse 1",
        "8000 Zurich", "Switzerland", "", "owner@example.com",
        "+41 79 123 45 67", "CHE-123.456.789",
      ],
      account_name: "Muster Consulting GmbH",
      iban: "CH93 0076 2011 6238 5295 7",
      bic: "UBSWCHZH80A",
      bank: "UBS Switzerland AG",
    },
    dividendTax: { wht_pct: 35, fed_inclusion_pct: 70, cant_inclusion_pct: 50 },
  },
  dashboard: { range: "ytd" },
};
db.prepare("UPDATE user_preferences SET prefs=? WHERE id=1").run(JSON.stringify(prefs));

// ── VAT + cash singletons ──────────────────────────────────────────────────
db.prepare(`INSERT INTO vat_settings (id, estimate_missing, estimate_rate,
    excluded_categories, flat_quarterly_deduction)
  VALUES (1, 1, 8.1, ?, 0)
  ON CONFLICT(id) DO NOTHING`).run(
  JSON.stringify(["Insurance", "Bank Fees", "Payroll Settlement", "Taxes / VAT"]));
db.prepare("UPDATE cash_balance SET balance=?, as_of=?, notes=? WHERE id=1")
  .run(48250.0, `${YEAR}-10-31`, "Business current account, month-end");

// ── Customers (the singleton already seeds one; add two more) ───────────────
const insCustomer = db.prepare(`INSERT INTO customers (name, address, city, country, email, reference)
  VALUES (@name, @address, @city, @country, @email, @reference)`);
for (const c of [
  { name: "ACME Systems AG", address: "Technikweg 12", city: "8005 Zurich",
    country: "Switzerland", email: "billing@acme.example", reference: "PO-2026-001" },
  { name: "Helvetia Digital GmbH", address: "Seestrasse 88", city: "6003 Lucerne",
    country: "Switzerland", email: "ap@helvetia-digital.example", reference: "CTR-4471" },
]) { insCustomer.run(c); bump("customers"); }
const mainCustomerId = db.prepare("SELECT id FROM customers WHERE name='ACME Systems AG'").get() as { id: number };

// ── Invoices (Jan–Oct); most paid, last two open ───────────────────────────
const insInvoice = db.prepare(`INSERT INTO invoices
  (invoice_number, year, month, hours, rate, vat_rate, subtotal, tax, total,
   issued_date, due_date, notes, paid_status, paid_date)
  VALUES (@invoice_number, @year, @month, @hours, @rate, @vat_rate,
    @subtotal, @tax, @total, @issued_date, @due_date, @notes, @paid_status, @paid_date)`);
const invHours = [152, 148.5, 168, 160.5, 171, 155, 176.5, 162, 158, 165];
const RATE = 62.0, VAT = 0.081;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
for (let m = 1; m <= MONTHS; m++) {
  const hours = invHours[m - 1];
  const subtotal = round2(hours * RATE);
  const tax = round2(subtotal * VAT);
  const total = round2(subtotal + tax);
  const issued = `${YEAR}-${pad2(m)}-${pad2(lastDay(YEAR, m))}`;
  const [dy, dm] = m < 12 ? [YEAR, m + 1] : [YEAR + 1, 1];
  const due = `${dy}-${pad2(dm)}-${pad2(lastDay(dy, dm))}`;
  const paid = m <= MONTHS - 2; // last two still open
  insInvoice.run({
    invoice_number: YEAR * 100 + m, year: YEAR, month: m,
    hours, rate: RATE, vat_rate: VAT, subtotal, tax, total,
    issued_date: issued, due_date: due,
    notes: `Consulting services — ${MONTH_ABBR[m]} ${YEAR}`,
    paid_status: paid ? "paid" : "unpaid",
    paid_date: paid ? `${dy}-${pad2(dm)}-15` : null,
  });
  bump("invoices");
}

// ── Payslips (Jan–Oct) computed by the app's own engine ────────────────────
const ps = computePayslip(settings);
const insPayslip = db.prepare(`INSERT INTO payslips
  (year, month, issued_date, payment_date, gross,
   emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_ktg, emp_source_tax,
   emp_total_deductions, net_salary,
   employer_ahv, employer_alv, employer_bvg, employer_uvg, employer_ktg, employer_fak,
   employer_total, total_employer_cost, status, source)
  VALUES (@year, @month, @issued_date, @payment_date, @gross,
   @emp_ahv, @emp_alv, @emp_bvg, @emp_uvg, @emp_ktg, @emp_source_tax,
   @emp_total_deductions, @net_salary,
   @employer_ahv, @employer_alv, @employer_bvg, @employer_uvg, @employer_ktg, @employer_fak,
   @employer_total, @total_employer_cost, 'issued', 'generated')`);
for (let m = 1; m <= MONTHS; m++) {
  const pay = `${YEAR}-${pad2(m)}-25`;
  insPayslip.run({
    year: YEAR, month: m, issued_date: pay, payment_date: pay,
    gross: ps.gross, emp_ahv: ps.emp_ahv, emp_alv: ps.emp_alv, emp_bvg: ps.emp_bvg,
    emp_uvg: ps.emp_uvg, emp_ktg: ps.emp_ktg, emp_source_tax: ps.emp_source_tax,
    emp_total_deductions: ps.emp_total_deductions, net_salary: ps.net_salary,
    employer_ahv: ps.employer_ahv, employer_alv: ps.employer_alv,
    employer_bvg: ps.employer_bvg, employer_uvg: ps.employer_uvg,
    employer_ktg: ps.employer_ktg, employer_fak: ps.employer_fak,
    employer_total: ps.employer_total, total_employer_cost: ps.total_employer_cost,
  });
  bump("payslips");
}

// ── Company docs / bills across categories ─────────────────────────────────
// [month, vendor, description, amount(gross), category, paid_via, status, recurrence]
type Bill = [number, string, string, number, string, string, string, string];
const BILLS: Bill[] = [
  [1, "CloudPeak Hosting", "App hosting — annual plan", 348.00, "Software/Subscriptions", "company", "paid", "yearly"],
  [1, "Northwind Insurance AG", "Business liability policy (annual)", 540.00, "Insurance", "company", "paid", "yearly"],
  [1, "Demo Bank", "Account service fee Q1", 15.00, "Bank Fees", "company", "paid", "none"],
  [2, "Swiss Telecom Demo AG", "Business mobile subscription", 59.00, "Telecom", "company", "paid", "monthly"],
  [2, "CodeForge Tools", "IDE subscription", 19.90, "Software/Subscriptions", "company", "paid", "monthly"],
  [3, "Bureau Basics AG", "Standing desk + monitor arm", 640.00, "Office Supplies", "company", "paid", "none"],
  [3, "Fuel Station Demo", "Fuel — client visit", 84.50, "Vehicle", "personal", "unpaid", "none"],
  [4, "Alpine Treuhand Demo", "Bookkeeping — Q1", 450.00, "Professional Services", "company", "paid", "quarterly"],
  [4, "Demo Bank", "Account service fee Q2", 15.00, "Bank Fees", "company", "paid", "none"],
  [5, "Swiss Telecom Demo AG", "Business mobile subscription", 59.00, "Telecom", "company", "paid", "monthly"],
  [5, "Garage Muster Demo AG", "Company car service", 380.00, "Vehicle", "company", "paid", "none"],
  [6, "PrintShop Demo", "Business cards + letterhead", 96.00, "Office Supplies", "company", "paid", "none"],
  [6, "Restaurant zur Demo", "Client lunch", 128.00, "Office Supplies", "personal", "unpaid", "none"],
  [7, "ESTV Demo", "VAT settlement Q1–Q2", 2950.00, "Taxes / VAT", "company", "paid", "none"],
  [7, "CloudPeak Hosting", "Add-on storage tier", 42.00, "Software/Subscriptions", "company", "paid", "monthly"],
  [8, "Alpine Treuhand Demo", "Bookkeeping — Q2", 450.00, "Professional Services", "company", "unpaid", "quarterly"],
  [9, "Northwind Insurance AG", "Cyber-liability rider", 180.00, "Insurance", "company", "paid", "yearly"],
  [9, "Swiss Telecom Demo AG", "Business mobile subscription", 59.00, "Telecom", "company", "unpaid", "monthly"],
];
const VAT_EXCLUDED = new Set(["Insurance", "Bank Fees", "Taxes / VAT"]);
const insBill = db.prepare(`INSERT INTO company_docs
  (doc_date, vendor, description, amount, currency, category, due_date, status,
   recurrence, vat_amount, vat_rate, paid_via, reimbursed_at)
  VALUES (@doc_date, @vendor, @description, @amount, 'CHF', @category, @due_date, @status,
   @recurrence, @vat_amount, @vat_rate, @paid_via, @reimbursed_at)`);
for (const [m, vendor, desc, amount, cat, via, status, rec] of BILLS) {
  const taxed = !VAT_EXCLUDED.has(cat);
  const vat_rate = taxed ? VAT : 0;
  const vat_amount = taxed ? round2(amount - amount / (1 + VAT)) : 0;
  insBill.run({
    doc_date: `${YEAR}-${pad2(m)}-12`, vendor, description: desc, amount,
    category: cat, due_date: `${YEAR}-${pad2(m)}-28`, status,
    recurrence: rec, vat_amount, vat_rate, paid_via: via,
    // personal-card bills stay unreimbursed (feed the Kontokorrent)
    reimbursed_at: null,
  });
  bump("company_docs");
}

// ── Obligations: AHV monthly, VAT/Source Tax/BVG quarterly ─────────────────
const insObl = db.prepare(`INSERT INTO obligations
  (obligation_type, period_label, period_year, amount, currency, due_date, status,
   notes, recurrence, expected_bill_date, expected_bill_amount)
  VALUES (@obligation_type, @period_label, @period_year, @amount, 'CHF', @due_date, @status,
   @notes, @recurrence, @expected_bill_date, @expected_bill_amount)`);

const ahvMonthly = round2(ps.emp_ahv + ps.employer_ahv + ps.emp_alv + ps.employer_alv + ps.employer_fak);
for (let m = 1; m <= 12; m++) {
  const due = `${YEAR}-${pad2(m)}-25`;
  insObl.run({
    obligation_type: "ahv", period_label: `${MONTH_ABBR[m]} ${YEAR}`, period_year: YEAR,
    amount: ahvMonthly, due_date: due, status: m <= 8 ? "paid" : "unpaid",
    notes: "AHV/ALV/FAK monthly contribution", recurrence: "monthly",
    expected_bill_date: due, expected_bill_amount: ahvMonthly,
  });
  bump("obligations");
}
const QUARTERS: Array<[string, string, string]> = [
  ["Q1", "03-31", "04-30"], ["Q2", "06-30", "07-31"],
  ["Q3", "09-30", "10-31"], ["Q4", "12-31", `${YEAR + 1}-01-31`],
];
const vatQuarterly = 2950.0;
const sourceTaxQuarterly = round2(ps.emp_source_tax * 3);
const bvgQuarterly = round2((ps.emp_bvg + ps.employer_bvg) * 3);
for (const [q, periodEnd, billMd] of QUARTERS) {
  const paid = q === "Q1" || q === "Q2";
  // billMd is either "MM-DD" (needs the year prefixed) or a full "YYYY-MM-DD".
  const dueVat = /^\d{4}-/.test(billMd) ? billMd : `${YEAR}-${billMd}`;
  insObl.run({
    obligation_type: "vat", period_label: `${q} ${YEAR}`, period_year: YEAR,
    amount: vatQuarterly, due_date: dueVat, status: paid ? "paid" : "unpaid",
    notes: "VAT return (effective method)", recurrence: "quarterly",
    expected_bill_date: dueVat, expected_bill_amount: vatQuarterly,
  });
  insObl.run({
    obligation_type: "source_tax", period_label: `${q} ${YEAR}`, period_year: YEAR,
    amount: sourceTaxQuarterly, due_date: `${YEAR}-${periodEnd}`,
    status: paid ? "paid" : "unpaid", notes: "Quellensteuer settlement",
    recurrence: "quarterly", expected_bill_date: `${YEAR}-${periodEnd}`,
    expected_bill_amount: sourceTaxQuarterly,
  });
  insObl.run({
    obligation_type: "bvg_employer", period_label: `${q} ${YEAR}`, period_year: YEAR,
    amount: bvgQuarterly, due_date: `${YEAR}-${periodEnd}`,
    status: paid ? "paid" : "unpaid", notes: "BVG 2nd-pillar contribution",
    recurrence: "quarterly", expected_bill_date: `${YEAR}-${periodEnd}`,
    expected_bill_amount: bvgQuarterly,
  });
  bump("obligations", 3);
}

// ── Bank statements (H1 + H2) ──────────────────────────────────────────────
const insStmt = db.prepare(`INSERT INTO bank_statements
  (bank, account_label, iban, period_start, period_end, statement_type,
   opening_balance, closing_balance, currency, notes)
  VALUES (@bank, @account_label, @iban, @period_start, @period_end, @statement_type,
   @opening_balance, @closing_balance, 'CHF', @notes)`);
for (const s of [
  { period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30`,
    opening_balance: 12000.0, closing_balance: 31480.55, notes: "First half 2026" },
  { period_start: `${YEAR}-07-01`, period_end: `${YEAR}-12-31`,
    opening_balance: 31480.55, closing_balance: 48250.0, notes: "Second half 2026" },
]) {
  insStmt.run({
    bank: "UBS Switzerland AG", account_label: "Business Current Account CHF",
    iban: "CH93 0076 2011 6238 5295 7", statement_type: "custom", ...s,
  });
  bump("bank_statements");
}

// ── Account transfers (Kontokorrent, owner <-> GmbH) ───────────────────────
const insXfer = db.prepare(`INSERT INTO account_transfers
  (transfer_date, direction, amount, currency, description)
  VALUES (@transfer_date, @direction, @amount, 'CHF', @description)`);
for (const t of [
  { transfer_date: `${YEAR}-01-05`, direction: "personal_to_gmbh", amount: 5000.0,
    description: "Owner top-up during setup (Kontokorrent)" },
  { transfer_date: `${YEAR}-01-25`, direction: "gmbh_to_personal", amount: ps.net_salary,
    description: `Net salary ${MONTH_ABBR[1]} ${YEAR}` },
  { transfer_date: `${YEAR}-02-25`, direction: "gmbh_to_personal", amount: ps.net_salary,
    description: `Net salary ${MONTH_ABBR[2]} ${YEAR}` },
  { transfer_date: `${YEAR}-03-25`, direction: "gmbh_to_personal", amount: ps.net_salary,
    description: `Net salary ${MONTH_ABBR[3]} ${YEAR}` },
  { transfer_date: `${YEAR}-04-10`, direction: "personal_to_gmbh", amount: 1500.0,
    description: "Owner loan — bridge for VAT payment" },
  { transfer_date: `${YEAR}-06-15`, direction: "gmbh_to_personal", amount: 210.30,
    description: "Personal-card reimbursement — Q1 fuel + supplies" },
]) { insXfer.run(t); bump("account_transfers"); }

// ── Reserves (Cash Allocation pots) ────────────────────────────────────────
const insReserve = db.prepare(`INSERT INTO reserves
  (name, purpose, target_amount, target_date, monthly_accrual, accrual_start,
   accumulated_manual, is_active)
  VALUES (@name, @purpose, @target_amount, @target_date, @monthly_accrual, @accrual_start,
   @accumulated_manual, 1)`);
for (const r of [
  { name: `Future obligations (${YEAR + 1} bills)`,
    purpose: "AHV settlement, fiduciary, corporate tax and VAT landing after December.",
    target_amount: 24000.0, target_date: `${YEAR + 1}-03-31`,
    monthly_accrual: 2000.0, accrual_start: `${YEAR}-01-01`, accumulated_manual: 16000.0 },
  { name: "Equipment & Laptops",
    purpose: "Next laptop and peripherals, saved up monthly.",
    target_amount: 3000.0, target_date: `${YEAR + 1}-08-31`,
    monthly_accrual: 250.0, accrual_start: `${YEAR}-01-01`, accumulated_manual: 2000.0 },
] ) { insReserve.run(r); bump("reserves"); }

// ── Trips + expenses + expense report ──────────────────────────────────────
const trip = db.prepare(`INSERT INTO trips (name, purpose, start_date, end_date, countries, notes, is_active)
  VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
  "Client on-site — Geneva", "Kickoff workshop with ACME Systems",
  `${YEAR}-05-12`, `${YEAR}-05-14`, JSON.stringify(["Switzerland"]),
  "Two-night stay, train + hotel");
const tripId = Number(trip.lastInsertRowid);
bump("trips");

const insExpense = db.prepare(`INSERT INTO expenses
  (expense_date, description, amount, category, trip_id)
  VALUES (@expense_date, @description, @amount, @category, @trip_id)`);
const TRIP_EXPENSES = [
  { expense_date: `${YEAR}-05-12`, description: "Train Zurich–Geneva (return)", amount: 176.0, category: "Travel" },
  { expense_date: `${YEAR}-05-12`, description: "Hotel — 2 nights", amount: 320.0, category: "Accommodation" },
  { expense_date: `${YEAR}-05-13`, description: "Meals", amount: 84.5, category: "Meals" },
];
for (const e of TRIP_EXPENSES) { insExpense.run({ ...e, trip_id: tripId }); bump("expenses"); }
const expTotal = round2(TRIP_EXPENSES.reduce((s, e) => s + e.amount, 0));
db.prepare(`INSERT INTO expense_reports (report_number, year, total, expense_count, month, reimbursed_at)
  VALUES (?, ?, ?, ?, ?, ?)`).run(1, YEAR, expTotal, TRIP_EXPENSES.length, 5, null);
bump("expense_reports");

// ── Income entry (a little extra colour) ───────────────────────────────────
db.prepare(`INSERT INTO income_entries (income_date, source, description, amount, currency, category)
  VALUES (?, ?, ?, ?, 'CHF', ?)`).run(
  `${YEAR}-06-30`, "Demo Bank", "Interest on business account", 12.5, "Interest");
bump("income_entries");

db.close();

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`Demo database created: ${DB_PATH}\n`);
console.log("Rows inserted:");
for (const [table, n] of Object.entries(counts).sort()) {
  console.log(`  ${table.padEnd(20)} ${n}`);
}
console.log("\nStart the app:  npm run dev  →  http://localhost:3000  (password: demo)");
