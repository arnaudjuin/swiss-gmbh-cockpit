// LLM tool registry — port of llm_tools.py. One tool per user question;
// read tools return data, propose_* tools return an Apply/Discard proposal
// and NEVER mutate the database.
import { db, round2, todayISO, MONTH_NAME } from "./db";
import { rowToSettings, computePayslip } from "./payroll";
import { SALARY } from "./budget";
import { pyFloat } from "./pycsv";

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");
const f2 = (n: number) => Number(n).toFixed(2);

export interface Tool {
  fn: (args: Record<string, any>) => any;
  desc: string;
  params: Record<string, string>;
}

function searchBills(a: any) {
  let sql = "SELECT doc_date, vendor, description, amount, currency, category, due_date, status, paid_via FROM company_docs WHERE 1=1";
  const args: unknown[] = [];
  if (a.year) { sql += " AND substr(doc_date,1,4)=?"; args.push(String(a.year)); }
  if (a.vendor) { sql += " AND LOWER(vendor) LIKE ?"; args.push(`%${String(a.vendor).toLowerCase()}%`); }
  if (a.category) { sql += " AND category=?"; args.push(a.category); }
  if (a.status === "paid" || a.status === "unpaid") { sql += " AND status=?"; args.push(a.status); }
  if (a.paid_via === "company" || a.paid_via === "personal") { sql += " AND paid_via=?"; args.push(a.paid_via); }
  sql += " ORDER BY doc_date DESC LIMIT ?"; args.push(Math.min(a.limit ?? 50, 200));
  const rows: any[] = db().prepare(sql).all(...args);
  return {
    count: rows.length,
    total_chf: round2(rows.reduce((s, r) => s + r.amount, 0)),
    personal_card_chf: round2(rows.filter(r => r.paid_via === "personal").reduce((s, r) => s + r.amount, 0)),
    rows,
  };
}

function searchExpenses(a: any) {
  let sql = "SELECT expense_date, description, amount, category, original_amount, original_currency FROM expenses WHERE 1=1";
  const args: unknown[] = [];
  if (a.year) { sql += " AND substr(expense_date,1,4)=?"; args.push(String(a.year)); }
  if (a.category) { sql += " AND category=?"; args.push(a.category); }
  sql += " ORDER BY expense_date DESC LIMIT ?"; args.push(Math.min(a.limit ?? 50, 200));
  const rows: any[] = db().prepare(sql).all(...args);
  return { count: rows.length, total_chf: round2(rows.reduce((s, r) => s + r.amount, 0)), rows };
}

function listObligationsTool(a: any) {
  let sql = "SELECT obligation_type, period_label, amount, due_date, status, notes FROM obligations WHERE 1=1";
  const args: unknown[] = [];
  if (a.status === "paid" || a.status === "unpaid") { sql += " AND status=?"; args.push(a.status); }
  if (a.year) { sql += " AND period_year=?"; args.push(a.year); }
  sql += " ORDER BY due_date DESC LIMIT 100";
  const rows: any[] = db().prepare(sql).all(...args);
  return { count: rows.length, total_chf: round2(rows.reduce((s, r) => s + r.amount, 0)), rows };
}

function getRunway() {
  const today = todayISO();
  const cashRow: any = db().prepare("SELECT * FROM cash_balance WHERE id=1").get();
  const balance = cashRow ? cashRow.balance : 0;
  const asOf = cashRow ? cashRow.as_of : today;
  const recurring: any[] = db().prepare(
    "SELECT amount, recurrence FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_doc_id IS NULL OR parent_doc_id = 0)").all();
  const obligationsFuture: any[] = db().prepare(
    "SELECT amount, due_date FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL").all();
  const t = new Date(today);
  const sixAgo = new Date(t.getTime() - 180 * 86400000);
  const avgInvoice = (db().prepare(
    "SELECT COALESCE(AVG(total), 0) as avg FROM invoices WHERE hours > 0 AND year * 12 + month >= ?"
  ).get(sixAgo.getUTCFullYear() * 12 + sixAgo.getUTCMonth() + 1) as any).avg;
  const psr: any = db().prepare("SELECT * FROM payroll_settings WHERE id=1").get();

  const DIV: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };
  const monthlyRecurring = recurring.reduce((s, r) => s + r.amount / DIV[r.recurrence], 0);
  const horizon = new Date(t.getTime() + 365 * 86400000).toISOString().slice(0, 10);
  const monthlyOb = obligationsFuture.filter(o => o.due_date <= horizon).reduce((s, o) => s + o.amount, 0) / 12;
  let payrollMonthly = 0;
  if (psr && psr.gross_monthly > 0) payrollMonthly = computePayslip(rowToSettings(psr)).total_employer_cost;
  const monthlyBurn = round2(monthlyRecurring + monthlyOb + payrollMonthly - avgInvoice);
  const runwayMonths = monthlyBurn <= 0 ? null : Math.round(balance / monthlyBurn * 10) / 10;
  return {
    balance, as_of: String(asOf),
    monthly_burn: monthlyBurn,
    monthly_recurring_cost: round2(monthlyRecurring),
    monthly_obligations_cost: round2(monthlyOb),
    monthly_payroll_cost: round2(payrollMonthly),
    monthly_expected_income: round2(avgInvoice),
    runway_months: runwayMonths,
    description: runwayMonths == null ? "Cash positive - no burn" : `${pyFloat(runwayMonths)} months at current burn`,
  };
}

function topVendors(a: any) {
  let sql = "SELECT vendor, COUNT(*) as count, SUM(amount) as total FROM company_docs WHERE 1=1";
  const args: unknown[] = [];
  if (a.year) { sql += " AND substr(doc_date,1,4)=?"; args.push(String(a.year)); }
  sql += " GROUP BY vendor ORDER BY total DESC LIMIT ?"; args.push(Math.min(a.limit ?? 10, 50));
  const rows = db().prepare(sql).all(...args);
  return { count: rows.length, rows };
}

function dashboardSummary() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const one = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as any);
  const inv = one("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, COALESCE(SUM(hours),0) as hrs FROM invoices WHERE hours>0 AND year=?", year);
  const invPaid = one("SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND hours>0 AND paid_status='paid'", year).t;
  const invUnpaid = one("SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND hours>0 AND paid_status!='paid'", year).t;
  const extra = one("SELECT COALESCE(SUM(amount),0) as t FROM income_entries WHERE substr(income_date,1,4)=?", String(year)).t;
  const bills = one("SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE substr(doc_date,1,4)=?", String(year)).t;
  const obs = one("SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE period_year=?", year).t;
  const overdueBills = one("SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE status='unpaid' AND due_date<?", today).t;
  const overdueObs = one("SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE status='unpaid' AND due_date<?", today).t;

  const incomeCash = round2(extra);
  const costsCash = round2(bills + obs);
  const profitCash = round2(incomeCash - costsCash);
  const nonInvoiceIncome = Math.max(0, round2(extra - invPaid));
  const incomeAccrual = round2(inv.rev + nonInvoiceIncome);
  const profitAccrual = round2(incomeAccrual - costsCash);
  const fmtM = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    year,
    income_ytd_cash: incomeCash,
    income_ytd_accrual: incomeAccrual,
    profit_ytd_cash: profitCash,
    profit_ytd_accrual: profitAccrual,
    receivables_outstanding: round2(invUnpaid),
    invoices_revenue_total: inv.rev,
    invoices_count: inv.cnt,
    invoices_paid_ytd: invPaid,
    invoices_unpaid_ytd: round2(invUnpaid),
    extra_income_ytd: extra,
    costs_ytd: costsCash,
    bills_ytd: bills,
    obligations_ytd: obs,
    overdue_total: round2(overdueBills + overdueObs),
    total_hours: inv.hrs,
    income_ytd: incomeCash,
    profit_ytd: profitCash,
    _basis_note:
      "income_ytd / profit_ytd are CASH basis (paid invoices only). " +
      "Use *_accrual fields for legal P&L (OR 725a, dividend capacity, equity tests). " +
      `Receivables outstanding: CHF ${fmtM(round2(invUnpaid))}.`,
  };
}

function receivablesSummary() {
  const today = todayISO();
  const t = Date.parse(today);
  const rows: any[] = db().prepare(
    "SELECT invoice_number, year, month, total, issued_date, due_date, paid_status, notes FROM invoices WHERE hours>0 AND paid_status!='paid' ORDER BY issued_date").all();
  const out = rows.map(r => {
    let daysOverdue = 0;
    if (r.due_date) {
      const d = Date.parse(String(r.due_date).slice(0, 10));
      if (Number.isFinite(d)) daysOverdue = Math.max(0, Math.round((t - d) / 86400000));
    }
    const monthIdx = Number(r.month || 0);
    const monthName = monthIdx >= 1 && monthIdx <= 12 ? MONTH_NAME[monthIdx] : "?";
    return {
      invoice_number: r.invoice_number,
      period: `${monthName} ${r.year}`,
      total: Number(r.total || 0),
      issued_date: r.issued_date,
      due_date: r.due_date,
      days_overdue: daysOverdue,
      expected_payment_window: daysOverdue < 30
        ? `~${30 - daysOverdue} days remaining in 30-day terms`
        : `OVERDUE by ${daysOverdue} days`,
    };
  });
  const total = round2(out.reduce((s, r) => s + r.total, 0));
  const overdue = out.filter(r => r.days_overdue > 0);
  return {
    count: out.length,
    total_outstanding: total,
    overdue_count: overdue.length,
    overdue_amount: round2(overdue.reduce((s, r) => s + r.total, 0)),
    invoices: out,
    _note: "These invoices have been issued but not yet paid. They are receivable by the GmbH and counted in accrual revenue but NOT in cash income.",
  };
}

function dividendCapacity() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const one = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as any);
  const invRev = one("SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE hours>0 AND year=?", year).t;
  const invVat = one("SELECT COALESCE(SUM(tax),0) as t FROM invoices WHERE hours>0 AND year=?", year).t;
  const bills = one("SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE substr(doc_date,1,4)=?", String(year)).t;
  const obs = one("SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE period_year=?", year).t;
  const psRow: any = db().prepare("SELECT * FROM payroll_settings WHERE id=1").get() ?? {};
  const emplStart: string | null = psRow.employment_start ?? null;
  let employerTotal = 0, monthsEmployed = 0;
  if (psRow && emplStart) {
    const [sy, sm] = emplStart.split("-").map(Number);
    const [ty, tm] = today.split("-").map(Number);
    if (sy && sm && sy <= year && `${sy}-${pad2(sm)}-01` <= today) {
      const effY = Math.max(sy, year), effM = sy < year ? 1 : sm;
      monthsEmployed = Math.max(0, (ty - effY) * 12 + (tm - effM) + 1);
      try {
        employerTotal = monthsEmployed * computePayslip(rowToSettings(psRow)).total_employer_cost;
      } catch { employerTotal = 0; }
    }
  }
  const shareCapital = Number(psRow.share_capital) || 20000;
  const legalReserveCap = round2(shareCapital * 0.5);

  const netRevenue = round2(invRev - invVat);
  const accrualPnl = round2(netRevenue - bills - obs - employerTotal);
  const mandatoryReserve = accrualPnl > 0 ? round2(Math.min(accrualPnl * 0.05, legalReserveCap)) : 0;
  const distributableNow = round2(Math.max(0, accrualPnl - mandatoryReserve));

  let gross = 0, vst = 0, netImmediate = 0, personalTax = 0, netShareholder = 0;
  if (distributableNow > 0) {
    gross = distributableNow;
    vst = round2(gross * 0.35);
    netImmediate = round2(gross - vst);
    personalTax = round2(gross * 0.10);
    netShareholder = round2(gross - personalTax);
  }
  return {
    year, as_of: today,
    net_revenue_accrual: netRevenue,
    costs_accrual: round2(bills + obs + employerTotal),
    payroll_employer_cost_ytd: round2(employerTotal),
    months_employed_ytd: monthsEmployed,
    accrual_pnl_ytd: accrualPnl,
    mandatory_reserve_allocation: mandatoryReserve,
    distributable_now: distributableNow,
    interim_dividend_possible: distributableNow > 0,
    share_capital: shareCapital,
    legal_reserve_cap_50pct: legalReserveCap,
    tax_math_if_distributed_now: {
      gross_dividend: gross,
      verrechnungssteuer_35pct: vst,
      net_received_immediately: netImmediate,
      personal_tax_estimate_10pct_teilbesteuerung: personalTax,
      net_to_shareholder_after_all_taxes: netShareholder,
    },
    _note:
      "Interim dividend per OR 675a requires an interim balance sheet and Generalversammlung resolution. " +
      "If accrual_pnl_ytd is negative, no distribution is legally possible. Tax math assumes the user " +
      "qualifies for Teilbesteuerung (>=10% participation), which is the case for a sole shareholder.",
  };
}

function invoiceSummary(a: any) {
  let sql = "SELECT year, COUNT(*) as count, SUM(total) as total, SUM(CASE WHEN paid_status='paid' THEN total ELSE 0 END) as paid FROM invoices WHERE hours>0";
  const args: unknown[] = [];
  if (a.year) { sql += " AND year=?"; args.push(a.year); }
  sql += " GROUP BY year ORDER BY year DESC";
  return { rows: db().prepare(sql).all(...args) };
}

const budgetBalances = () => ({
  items: db().prepare("SELECT subcategory, grp, budgeted, balance FROM budget_items ORDER BY grp, sort_order").all(),
});

function payslipSummary(a: any) {
  let sql = "SELECT year, COUNT(*) as count, SUM(gross) as gross, SUM(net_salary) as net, SUM(total_employer_cost) as employer_cost FROM payslips";
  const args: unknown[] = [];
  if (a.year) { sql += " WHERE year=?"; args.push(a.year); }
  sql += " GROUP BY year";
  return { rows: db().prepare(sql).all(...args) };
}

function searchTransfers(a: any) {
  let sql = "SELECT transfer_date, direction, amount, currency, description FROM account_transfers WHERE 1=1";
  const args: unknown[] = [];
  if (a.direction === "personal_to_gmbh" || a.direction === "gmbh_to_personal") {
    sql += " AND direction=?"; args.push(a.direction);
  }
  if (a.year) { sql += " AND substr(transfer_date,1,4)=?"; args.push(String(a.year)); }
  sql += " ORDER BY transfer_date DESC LIMIT ?"; args.push(Math.min(Number(a.limit ?? 50), 200));
  const rows: any[] = db().prepare(sql).all(...args);
  const balRows: any[] = db().prepare(
    "SELECT direction, COALESCE(SUM(amount),0) as total FROM account_transfers GROUP BY direction").all();
  const toGmbh = balRows.find(r => r.direction === "personal_to_gmbh")?.total ?? 0;
  const toPersonal = balRows.find(r => r.direction === "gmbh_to_personal")?.total ?? 0;
  return {
    count: rows.length,
    total_chf_in_query: round2(rows.reduce((s, r) => s + r.amount, 0)),
    net_owed_to_personal: round2(toGmbh - toPersonal),
    lifetime_personal_to_gmbh: toGmbh,
    lifetime_gmbh_to_personal: toPersonal,
    rows,
  };
}

// ── Propose-only write tools ──
const ACTIONS: Record<string, [string, string, Record<string, string>, string]> = {
  mark_invoice_paid:      ["invoices",     "/api/invoices/{id}/status",    { status: "paid" },   "Mark invoice as PAID"],
  mark_invoice_unpaid:    ["invoices",     "/api/invoices/{id}/status",    { status: "unpaid" }, "Mark invoice as UNPAID"],
  mark_bill_paid:         ["company_docs", "/api/accounting/{id}/status",  { status: "paid" },   "Mark bill as PAID"],
  mark_bill_unpaid:       ["company_docs", "/api/accounting/{id}/status",  { status: "unpaid" }, "Mark bill as UNPAID"],
  mark_obligation_paid:   ["obligations",  "/api/obligations/{id}/status", { status: "paid" },   "Mark obligation as PAID"],
  mark_obligation_unpaid: ["obligations",  "/api/obligations/{id}/status", { status: "unpaid" }, "Mark obligation as UNPAID"],
};

const EXPENSE_CATEGORIES = ["Accommodation", "Connectivity", "Fuel", "Meals", "Other", "Transport"];
const BILL_CATEGORIES = ["Bank Fees", "Insurance", "Legal", "Office Supplies", "Other",
  "Payroll Settlement", "Professional Services", "Rent", "Software/Subscriptions", "Telecom"];

const pyRepr = (v: unknown) => typeof v === "string" ? `'${v}'` : String(v);

function validIsoDate(s: any, field: string): [string | null, string | null] {
  if (!s) return [null, `${field} is required (YYYY-MM-DD)`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s)) || !Number.isFinite(Date.parse(s)))
    return [null, `${field} must be YYYY-MM-DD, got ${pyRepr(s)}`];
  return [String(s), null];
}

function validAmount(amount: any, field = "amount"): [number | null, string | null] {
  if (amount == null) return [null, `${field} is required`];
  const v = Number(amount);
  if (!Number.isFinite(v)) return [null, `${field} must be a number, got ${pyRepr(amount)}`];
  if (v <= 0) return [null, `${field} must be positive, got ${v}`];
  return [v, null];
}

function proposeAddExpense(a: any) {
  const [dateV, e1] = validIsoDate(a.expense_date, "expense_date");
  if (e1) return { error: e1 };
  const [amountV, e2] = validAmount(a.amount);
  if (e2) return { error: e2 };
  if (!a.description) return { error: "description is required" };
  const cat = String(a.category ?? "").trim() || "Other";
  if (!EXPENSE_CATEGORIES.includes(cat))
    return { error: `category must be one of ${JSON.stringify(EXPENSE_CATEGORIES).replace(/","/g, "', '").replace(/\["/, "['").replace(/"\]/, "']")}, got ${pyRepr(cat)}` };
  return {
    _proposal: {
      action: "add_expense",
      label: `Add expense — ${String(a.description).slice(0, 50)}`,
      endpoint: "/api/expenses",
      method: "POST",
      format: "form",
      payload: { expense_date: dateV, description: a.description, amount: pyFloat(amountV), category: cat },
      description: `${dateV} · CHF ${f2(amountV!)} · [${cat}] · ${a.description}`,
    },
  };
}

function proposeAddBill(a: any) {
  const [dateV, e1] = validIsoDate(a.doc_date, "doc_date");
  if (e1) return { error: e1 };
  const [amountV, e2] = validAmount(a.amount);
  if (e2) return { error: e2 };
  if (!a.vendor) return { error: "vendor is required" };
  if (!a.description) return { error: "description is required" };
  const cat = String(a.category ?? "").trim() || "Other";
  if (!BILL_CATEGORIES.includes(cat))
    return { error: `category must be one of ${JSON.stringify(BILL_CATEGORIES).replace(/","/g, "', '").replace(/\["/, "['").replace(/"\]/, "']")}, got ${pyRepr(cat)}` };
  const rec = String(a.recurrence ?? "none").toLowerCase();
  if (!["none", "monthly", "yearly"].includes(rec))
    return { error: `recurrence must be one of none/monthly/yearly, got ${pyRepr(rec)}` };
  let dueV: string | null = null;
  if (a.due_date) {
    const [v, e3] = validIsoDate(a.due_date, "due_date");
    if (e3) return { error: e3 };
    dueV = v;
  }
  const payload: Record<string, string> = {
    doc_date: dateV!, vendor: a.vendor, description: a.description,
    amount: pyFloat(amountV), currency: a.currency ?? "CHF", category: cat,
    recurrence: rec, status: "unpaid",
  };
  if (dueV) payload.due_date = dueV;
  return {
    _proposal: {
      action: "add_bill",
      label: `Add bill — ${a.vendor} CHF ${f2(amountV!)}`,
      endpoint: "/api/accounting",
      method: "POST",
      format: "form",
      payload,
      description: `${dateV} · ${a.vendor} · CHF ${f2(amountV!)} · [${cat}]` +
        `${rec !== "none" ? " · " + rec : ""}${dueV ? " · due " + dueV : ""} · ${a.description}`,
    },
  };
}

function proposeMarkInvoicePaid(a: any) {
  if (a.invoice_id == null) return { error: "invoice_id is required" };
  const invId = Number(a.invoice_id);
  if (!Number.isInteger(invId)) return { error: `invoice_id must be an integer, got ${pyRepr(a.invoice_id)}` };
  let paidV: string | null = null;
  if (a.paid_date) {
    const [v, e] = validIsoDate(a.paid_date, "paid_date");
    if (e) return { error: e };
    paidV = v;
  }
  const row: any = db().prepare(
    "SELECT invoice_number, year, month, total, paid_status FROM invoices WHERE id=?").get(invId);
  if (!row) return { error: `Invoice id=${invId} not found` };
  if (row.paid_status === "paid") return { error: `Invoice #${pad4(row.invoice_number)} is already paid` };
  const payload: Record<string, string> = { status: "paid" };
  if (paidV) payload.paid_date = paidV;
  return {
    _proposal: {
      action: "mark_invoice_paid",
      label: `Mark Invoice #${pad4(row.invoice_number)} as PAID`,
      endpoint: `/api/invoices/${invId}/status`,
      method: "PATCH",
      format: "json",
      payload,
      description: `Invoice #${pad4(row.invoice_number)} · ${row.year}-${pad2(row.month)} · ` +
        `CHF ${f2(row.total)}${paidV ? " · paid on " + paidV : ""}`,
    },
  };
}

function proposeAction(a: any) {
  const action = a.action;
  if (!(action in ACTIONS))
    return { error: `Unknown action: ${pyRepr(action)}. Allowed: ${JSON.stringify(Object.keys(ACTIONS).sort()).replace(/","/g, "', '").replace(/\["/, "['").replace(/"\]/, "']")}` };
  if (a.target_id == null) return { error: "target_id is required" };
  const targetId = Number(a.target_id);
  if (!Number.isInteger(targetId)) return { error: `target_id must be an integer, got ${pyRepr(a.target_id)}` };
  const [table, endpointTmpl, payload, label] = ACTIONS[action];
  const row: any = db().prepare(`SELECT * FROM ${table} WHERE id=?`).get(targetId);
  if (!row) return { error: `#${targetId} not found in ${table}` };
  let desc: string;
  if (table === "invoices")
    desc = `Invoice #${pad4(row.invoice_number)} — ${row.year}-${pad2(row.month)} — CHF ${f2(row.total)} — currently ${row.paid_status || "unpaid"}`;
  else if (table === "company_docs")
    desc = `${row.vendor} — ${row.description} — CHF ${f2(row.amount)} on ${row.doc_date} — currently ${row.status}`;
  else
    desc = `${row.obligation_type} ${row.period_label} — CHF ${f2(row.amount)} due ${row.due_date} — currently ${row.status}`;
  return {
    _proposal: {
      action, label, target_id: targetId,
      endpoint: endpointTmpl.replace("{id}", String(targetId)),
      method: "PATCH", payload, description: desc,
    },
  };
}

export const TOOLS: Record<string, Tool> = {
  search_bills: {
    fn: searchBills,
    desc: "Search company bills (incoming bills of the GmbH). paid_via says who " +
      "fronted the money: 'personal' = owner's personal card (GmbH owes it back).",
    params: {
      year: "int (optional) — filter to a specific year",
      vendor: "string (optional) — partial vendor name match",
      category: "string (optional) — exact category",
      status: "string (optional) — 'paid' or 'unpaid'",
      paid_via: "string (optional) — 'company' or 'personal' (paid with owner's personal card)",
      limit: "int (optional, default 50) — max rows",
    },
  },
  search_expenses: {
    fn: searchExpenses,
    desc: "Search travel expenses (REIMBURSABLE — billed to clients separately).",
    params: {
      year: "int (optional)",
      category: "string (optional) — Meals, Transport, Accommodation, Other",
      limit: "int (optional, default 50)",
    },
  },
  list_obligations: {
    fn: listObligationsTool,
    desc: "List GmbH obligations to authorities/insurers (AHV, BVG, taxes, KTG, UVG).",
    params: { status: "string (optional) — 'paid' or 'unpaid'", year: "int (optional)" },
  },
  get_runway: {
    fn: getRunway,
    desc: "Current cash balance, monthly burn rate, and runway in months.",
    params: {},
  },
  top_vendors: {
    fn: topVendors,
    desc: "Top vendors by total bill amount.",
    params: { year: "int (optional)", limit: "int (optional, default 10)" },
  },
  dashboard_summary: {
    fn: dashboardSummary,
    desc: "Full GmbH dashboard overview YTD on BOTH cash AND accrual basis. " +
      "Cash = paid invoices only (liquidity). " +
      "Accrual = all issued invoices vs all incurred costs (legal P&L). " +
      "Use accrual for OR 725a, equity tests, dividend capacity. " +
      "Receivables outstanding is the gap between the two.",
    params: {},
  },
  invoice_summary: {
    fn: invoiceSummary,
    desc: "Invoice totals by year (count, total, paid amount).",
    params: { year: "int (optional)" },
  },
  receivables_summary: {
    fn: receivablesSummary,
    desc: "List every unpaid invoice with ageing. Use whenever asked about " +
      "money owed to the GmbH, outstanding receivables, or late payers. " +
      "Returns total CHF outstanding + per-invoice details.",
    params: {},
  },
  dividend_capacity: {
    fn: dividendCapacity,
    desc: "Compute distributable profit for an interim dividend today, plus " +
      "Swiss tax math (Verrechnungssteuer 35% + Teilbesteuerung). Uses " +
      "ACCRUAL P&L. Returns 0 if currently in loss. Use whenever the " +
      "user asks about dividends, distributions, or paying themselves.",
    params: {},
  },
  budget_balances: {
    fn: budgetBalances,
    desc: "Current balance of every sinking-fund reserve (Car, Wine, Mariage, etc.).",
    params: {},
  },
  payslip_summary: {
    fn: payslipSummary,
    desc: "Payslip totals by year (gross, net, employer cost).",
    params: { year: "int (optional)" },
  },
  search_transfers: {
    fn: searchTransfers,
    desc: "List Personal ↔ GmbH account transfers (balance-sheet moves, NOT salary, " +
      "income, or dividends). Always returns the lifetime net owed to personal.",
    params: {
      direction: "string (optional) — 'personal_to_gmbh' or 'gmbh_to_personal'",
      year: "int (optional) — filter to a specific year",
      limit: "int (optional, default 50) — max rows",
    },
  },
  propose_action: {
    fn: proposeAction,
    desc: "Propose a state change. Use ONLY when the user explicitly asks to mark something paid/unpaid. " +
      "The change is NOT applied — the user must click Apply in the UI. " +
      "If the user asks to find an item without changing it, use search_bills / list_obligations / invoice_summary instead.",
    params: {
      action: "string — one of: mark_invoice_paid, mark_invoice_unpaid, mark_bill_paid, mark_bill_unpaid, mark_obligation_paid, mark_obligation_unpaid",
      target_id: "int — the row id (invoice id, bill id, or obligation id)",
    },
  },
  propose_add_expense: {
    fn: proposeAddExpense,
    desc: "Propose adding a new travel expense (employee reimbursement). " +
      "The expense is NOT created — user clicks Apply to confirm. " +
      "Use when user says things like 'I spent CHF X on Y' or 'add an expense for...'",
    params: {
      expense_date: "string YYYY-MM-DD",
      description: "string — what was bought (vendor + item)",
      amount: "number — CHF amount",
      category: "string — Meals, Transport, Accommodation, Fuel, Connectivity, or Other",
    },
  },
  propose_add_bill: {
    fn: proposeAddBill,
    desc: "Propose adding a new company bill / recurring charge. " +
      "Use when user mentions receiving an invoice from a vendor, a new subscription, etc. " +
      "NOT applied until user clicks Apply.",
    params: {
      doc_date: "string YYYY-MM-DD",
      vendor: "string — vendor name",
      description: "string — what the bill is for",
      amount: "number — CHF amount",
      category: "string — one of the bill categories (Software/Subscriptions, Insurance, etc.)",
      due_date: "string YYYY-MM-DD (optional)",
      recurrence: "string — none/monthly/yearly (default none)",
      currency: "string — 3-letter ISO (default CHF)",
    },
  },
  propose_mark_invoice_paid: {
    fn: proposeMarkInvoicePaid,
    desc: "Propose marking a specific invoice as PAID with the cash receipt date. " +
      "Use when user says 'invoice X was paid on Y'. Includes paid_date so the " +
      "cash-flow timeline plots the receipt correctly.",
    params: {
      invoice_id: "int — the invoice id (NOT the invoice_number)",
      paid_date: "string YYYY-MM-DD (optional)",
    },
  },
};

export function buildToolsPrompt(): string {
  const lines = ["Available tools (you MUST pick exactly one to answer the question):"];
  for (const [name, t] of Object.entries(TOOLS)) {
    const params = Object.keys(t.params).length
      ? Object.entries(t.params).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "no params";
    lines.push(`- ${name}(${params}) — ${t.desc}`);
  }
  return lines.join("\n");
}

void SALARY; // parity note: SALARY constant unused by tools but kept importable
