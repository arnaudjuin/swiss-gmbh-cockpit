#!/usr/bin/env node
// Seed the app with a coherent, fully fictional demo dataset — port of
// seed_demo.py. Drives the app's own HTTP API so every number is produced
// by the real business logic: payroll settings → generated payslips (which
// create the AHV/UVG/KTG/Quellensteuer obligations), invoices, bills, VAT &
// corporate-tax obligations, a bank statement, reserves, transfers.
//
// Usage:
//   BASE_URL=http://127.0.0.1:3000 node scripts/seed-demo.mjs   # running server
//   node scripts/seed-demo.mjs                                  # spawns `next start` itself
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = process.env.ADMIN_PASSWORD || "demo";

export async function waitReady(base, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/auth/check`, { signal: AbortSignal.timeout(1500) });
      if (r.status === 401 || r.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`Server at ${base} not ready after ${timeoutMs}ms`);
    await new Promise(res => setTimeout(res, 300));
  }
}

export async function seed(base, password = process.env.ADMIN_PASSWORD || "demo") {
  const login = await fetch(`${base}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`);
  const token = (await login.json()).token;
  const H = { Authorization: `Bearer ${token}` };

  const json = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { ...H, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? {} : r.json();
  };
  const form = async (url, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const r = await fetch(base + url, { method: "POST", headers: H, body: fd });
    if (r.status >= 400) throw new Error(`POST ${url} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  const existing = await json("GET", "/api/invoices");
  if (existing.length > 0) {
    console.log("Demo data already present — nothing to do. (Delete invoices.db to reseed.)");
    return false;
  }

  const now = new Date();
  const YEAR = now.getFullYear();
  const THIS_MONTH = now.getMonth() + 1;

  // ── Payroll: settings, then issue payslips (creates the obligations too) ──
  await json("PUT", "/api/payroll/settings", {
    employer_name: "Muster Consulting GmbH",
    employee_name: "Max Muster",
    employee_address: "Musterstrasse 1, 8000 Zürich",
    employment_start: `${YEAR}-01-01`,
    canton: "Zurich", currency: "CHF", payment_day: 25,
    gross_monthly: 9500.0,
    ahv_employee_pct: 5.3, ahv_employer_pct: 5.3,
    alv_employee_pct: 1.1, alv_employer_pct: 1.1,
    bvg_monthly_employee: 450.0, bvg_monthly_employer: 650.0,
    bvg_provider: "Demo Pension Ltd",
    uvg_employee_monthly: 40.0, uvg_employer_monthly: 25.0,
    ktg_monthly_total: 90.0, ktg_employer_share_pct: 50.0,
    fak_employer_pct: 1.2,
    source_tax_monthly: 1150.0, source_tax_tariff: "A0N",
  });
  for (let m = 1; m <= THIS_MONTH; m++) {
    await json("POST", `/api/payroll/generate/${YEAR}/${m}`,
      { create_obligations: true, create_transfer: true });
  }

  // ── Customer + invoices ──
  const cust = await json("POST", "/api/customers", {
    name: "ACME Systems AG", address: "Technikweg 12",
    city: "8005 Zürich", country: "Switzerland",
    email: "billing@acme.example", reference: "PO-2026-001",
  });
  const hours = [152.0, 148.5, 168.0, 160.5, 171.0, 155.0, 176.5, 162.0];
  const invIds = [];
  for (let m = 1; m <= THIS_MONTH; m++) {
    const inv = await json("POST", "/api/invoices",
      { year: YEAR, month: m, hours: hours[(m - 1) % hours.length], customer_id: cust.id });
    invIds.push(inv.id);
  }
  for (const iid of invIds.slice(0, -1)) {
    if (iid) await json("PATCH", `/api/invoices/${iid}/status`, { status: "paid" });
  }

  // ── Bills (vendors invented) ──
  const BILLS = [
    [1, "CloudPeak Hosting", "App hosting — annual plan", 290.00, "Software/Subscriptions", "company", "paid", "yearly"],
    [2, "Swiss Telecom Demo AG", "Business mobile subscription", 55.00, "Telecom", "company", "paid", "monthly"],
    [2, "Helvetia Demo Insurance", "Business liability policy", 480.00, "Insurance", "company", "paid", "yearly"],
    [3, "Bureau Basics AG", "Standing desk + monitor arm", 620.00, "Office Supplies", "company", "paid", "none"],
    [3, "Fuel Station Demo", "Fuel — client visit", 84.50, "Vehicle", "personal", "paid", "none"],
    [4, "JetBrains Demo", "IDE subscription", 17.90, "Software/Subscriptions", "company", "paid", "monthly"],
    [4, "Demo Bank", "Account service fee Q1", 15.00, "Bank Fees", "company", "paid", "none"],
    [5, "Fuel Station Demo", "Fuel — client visit", 92.30, "Vehicle", "personal", "paid", "none"],
    [5, "Restaurant zur Demo", "Team lunch with client", 145.00, "Other", "personal", "paid", "none"],
    [6, "Swiss Telecom Demo AG", "Home fiber (business share)", 44.00, "Telecom", "company", "paid", "monthly"],
    [7, "Demo Bank", "Account service fee Q2", 15.00, "Bank Fees", "company", "paid", "none"],
    [7, "Garage Muster AG", "Company car service", 380.00, "Vehicle", "company", "paid", "none"],
    [8, "PrintShop Demo", "Business cards + letterhead", 96.00, "Office Supplies", "company", "unpaid", "none"],
  ];
  const pad2 = n => String(n).padStart(2, "0");
  for (const [m, vendor, desc, amount, cat, via, status, rec] of BILLS) {
    await form("/api/accounting", {
      doc_date: `${YEAR}-${pad2(m)}-12`, vendor, description: desc,
      amount, currency: "CHF", category: cat,
      due_date: status === "unpaid" ? `${YEAR}-${pad2(m)}-28` : "",
      status, recurrence: rec, paid_via: via,
    });
  }

  // ── Obligations beyond payroll: VAT + corporate tax + accountant ──
  await form("/api/obligations", {
    obligation_type: "vat", period_label: `Q2 ${YEAR}`, period_year: YEAR,
    amount: 2950.00, due_date: `${YEAR}-08-30`,
    expected_bill_date: `${YEAR}-08-30`, expected_bill_amount: 2950.00,
    notes: "First VAT return (effective method)",
  });
  await form("/api/obligations", {
    obligation_type: "corporate_tax_federal", period_label: `FY ${YEAR}`,
    period_year: YEAR, amount: 1800.00, due_date: `${YEAR + 1}-03-31`,
    expected_bill_date: `${YEAR + 1}-02-15`, expected_bill_amount: 1800.00,
  });
  await form("/api/obligations", {
    obligation_type: "accounting", period_label: `FY ${YEAR}`,
    period_year: YEAR, amount: 5500.00, due_date: `${YEAR + 1}-03-31`,
    expected_bill_date: `${YEAR + 1}-01-15`, expected_bill_amount: 5500.00,
    notes: "Year-end closing + tax return (fiduciary)",
  });

  // ── Bank statement (freshest cash source) ──
  await form("/api/bank-statements", {
    period_start: `${YEAR}-08-01`, period_end: `${YEAR}-08-28`,
    bank: "Demo Bank", account_label: "Business Current Account CHF",
    iban: "CH93 0076 2011 6238 5295 7", statement_type: "monthly",
    opening_balance: 18400.00, closing_balance: 23456.78,
  });

  // ── Reserves (Cash Allocation pots) ──
  await form("/api/reserves", {
    name: `Future obligations (${YEAR + 1} bills)`,
    purpose: "Everything landing after December in one pot: AHV settlement, fiduciary, corporate tax, VAT.",
    target_amount: 24000.00, target_date: `${YEAR + 1}-03-31`,
    monthly_accrual: 2000.00, accrual_start: `${YEAR}-09-01`,
  });
  await form("/api/reserves", {
    name: "Equipment & Laptops",
    purpose: "Next laptop and peripherals, saved up monthly.",
    target_amount: 3000.00, target_date: `${YEAR + 1}-08-31`,
    monthly_accrual: 250.00, accrual_start: `${YEAR}-09-01`,
  });

  // ── A little extra colour ──
  await form("/api/income", {
    income_date: `${YEAR}-06-30`, source: "Demo Bank",
    description: "Interest on business account", amount: 12.50,
    category: "Interest",
  });
  await form("/api/transfers", {
    transfer_date: `${YEAR}-03-05`, direction: "personal_to_gmbh",
    amount: 2000.00, description: "Owner top-up during setup (Kontokorrent)",
  });

  console.log("Demo data seeded. Start the app:  npm start  →  http://127.0.0.1:3000  (password: demo)");
  return true;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const external = process.env.BASE_URL;
  if (external) {
    await waitReady(external);
    await seed(external);
  } else {
    // Spawn a temporary production server on a side port, seed, shut down.
    const port = 3999;
    const child = spawn(path.join(ROOT, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
      cwd: ROOT, stdio: "ignore",
      env: { ...process.env, ADMIN_PASSWORD: PASSWORD, API_URL: "http://127.0.0.1:9" },
    });
    try {
      await waitReady(`http://127.0.0.1:${port}`);
      await seed(`http://127.0.0.1:${port}`);
    } finally {
      child.kill();
    }
  }
}
