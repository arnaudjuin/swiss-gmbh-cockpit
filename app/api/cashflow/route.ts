import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";
import { rowToSettings, computePayslip } from "@/server/payroll";

const DEFAULT_PAYMENT_LAG_DAYS = 30;  // typical days from invoice issue to cash receipt
const PAYROLL_DAY = 25;               // day of month salary cash hits

const fmt2 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 86400000;
const parseIso = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(t) ? t : null;
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Ev { date: string; amount: number; kind: string; label: string }

function vatDueDates(events: Ev[], year: number) {
  // Q1 due 31.05, Q2 31.08, Q3 30.11, Q4 28.02 of following year
  const deadlines: [string, number][] = [
    [`${year}-05-31`, 1], [`${year}-08-31`, 2], [`${year}-11-30`, 3], [`${year + 1}-02-28`, 4],
  ];
  for (const [due, q] of deadlines) {
    const mStart = (q - 1) * 3 + 1;
    const row: any = db().prepare(
      "SELECT COALESCE(SUM(tax),0) AS vat FROM invoices WHERE year=? AND month BETWEEN ? AND ?"
    ).get(year, mStart, mStart + 2);
    const vat = Number(row.vat || 0);
    if (vat > 0) events.push({ date: due, amount: -round2(vat), kind: "vat", label: `VAT Q${q} ${year} → ESTV` });
  }
}

const hasIsActive = (): boolean =>
  (db().prepare("PRAGMA table_info(company_docs)").all() as any[]).some(c => c.name === "is_active");

export const GET = guard(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const horizonDays = Number(p.get("horizon_days") || 180);
  const openingBalance = Number(p.get("opening_balance") || 0);
  const paymentLagDays = Number(p.get("payment_lag_days") ?? DEFAULT_PAYMENT_LAG_DAYS);

  const todayS = todayISO();
  const today = parseIso(todayS)!;
  const start = today - 30 * DAY;
  const end = today + horizonDays * DAY;

  const events: Ev[] = [];

  // ── Revenue: invoices flip to cash on paid_date, else issue + lag
  const invs: any[] = db().prepare(
    "SELECT invoice_number, issued_date, due_date, paid_date, paid_status, total, notes FROM invoices ORDER BY issued_date").all();
  for (const inv of invs) {
    if (inv.notes && String(inv.notes).includes("Travel expense")) continue; // reimbursements aren't new cash
    let cashDt: number;
    const paidDt = parseIso(inv.paid_date);
    if (paidDt != null) cashDt = paidDt;
    else {
      const issued = parseIso(inv.issued_date) ?? today;
      cashDt = Math.max(issued + paymentLagDays * DAY, issued);
    }
    if (start <= cashDt && cashDt <= end) {
      events.push({ date: iso(cashDt), amount: round2(Number(inv.total || 0)), kind: "invoice",
        label: `Invoice #${String(inv.invoice_number).padStart(4, "0")} paid (CHF ${fmt2(Number(inv.total))})` });
    }
  }

  // ── Payroll: net out on PAYROLL_DAY monthly, from employment_start onward
  const ps: any = db().prepare("SELECT * FROM payroll_settings WHERE id=1").get();
  if (ps && ps.gross_monthly) {
    const calc = computePayslip(rowToSettings(ps));
    const net = calc.net_salary, emplTotal = calc.total_employer_cost;
    const empStart = parseIso(ps.employment_start) ?? start;
    const startD = new Date(start);
    let cy = startD.getUTCFullYear(), cm = startD.getUTCMonth() + 1;
    while (Date.UTC(cy, cm - 1, 1) <= end) {
      const payDt = Date.UTC(cy, cm - 1, Math.min(PAYROLL_DAY, 28));
      if (empStart <= payDt && payDt <= end && payDt >= start) {
        events.push({ date: iso(payDt), amount: -round2(net), kind: "salary_net",
          label: `Net salary → you (CHF ${fmt2(net)})` });
        const other = round2(emplTotal - net);
        if (other > 0) events.push({ date: iso(payDt), amount: -other, kind: "salary_emp",
          label: `Employer charges & deductions (CHF ${fmt2(other)})` });
      }
      if (cm === 12) { cy += 1; cm = 1; } else cm += 1;
    }
  }

  // ── Recurring + annual bills
  const bills: any[] = hasIsActive()
    ? db().prepare("SELECT vendor, amount, currency, doc_date, due_date, status, recurrence, category FROM company_docs WHERE is_active IS NULL OR is_active=1").all()
    : db().prepare("SELECT vendor, amount, currency, doc_date, due_date, status, recurrence, category FROM company_docs").all();
  for (const b of bills) {
    if ((b.currency || "CHF") !== "CHF") continue;      // FX bills skipped
    const amt = Number(b.amount || 0);
    if (amt <= 0) continue;
    const rec = (b.recurrence || "none").toLowerCase();
    if ((b.category || "").toLowerCase().startsWith("payroll")) continue; // already in employer charges
    const first = parseIso(b.due_date) ?? parseIso(b.doc_date) ?? today;
    if (rec === "monthly") {
      let d = first;
      while (d <= end) {
        if (start <= d) events.push({ date: iso(d), amount: -round2(amt), kind: "bill", label: `${b.vendor} (monthly)` });
        const dd = new Date(d);
        const y2 = dd.getUTCFullYear() + (dd.getUTCMonth() === 11 ? 1 : 0);
        const m2 = (dd.getUTCMonth() + 1) % 12 + 1;
        d = Date.UTC(y2, m2 - 1, Math.min(dd.getUTCDate(), 28));
      }
    } else if (rec === "yearly") {
      let d = first;
      while (d <= end) {
        if (start <= d) events.push({ date: iso(d), amount: -round2(amt), kind: "bill", label: `${b.vendor} (annual)` });
        const dd = new Date(d);
        d = Date.UTC(dd.getUTCFullYear() + 1, dd.getUTCMonth(), Math.min(dd.getUTCDate(), 28));
      }
    } else if (start <= first && first <= end) {
      events.push({ date: iso(first), amount: -round2(amt), kind: "bill", label: b.vendor });
    }
  }

  // ── VAT (current + next year if the horizon crosses)
  const todayYear = new Date(today).getUTCFullYear();
  vatDueDates(events, todayYear);
  if (new Date(end).getUTCFullYear() > todayYear) vatDueDates(events, todayYear + 1);

  const startS = iso(start), endS = iso(end);
  const windowed = events.filter(e => startS <= e.date && e.date <= endS);
  windowed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));

  let running = openingBalance;
  const timeline = windowed.map(e => ({ ...e, balance: round2(running += e.amount) }));

  // Daily series (forward-fill balance between events)
  const series: { date: string; balance: number }[] = [];
  let bal = openingBalance, idx = 0;
  for (let t = start; t <= end; t += DAY) {
    const d = iso(t);
    while (idx < timeline.length && timeline[idx].date === d) bal = timeline[idx++].balance;
    series.push({ date: d, balance: round2(bal) });
  }

  const balances = series.map(s => s.balance);
  const lowest = Math.min(...balances), highest = Math.max(...balances);
  return json({
    start: startS, end: endS, today: todayS,
    opening_balance: openingBalance,
    payment_lag_days: paymentLagDays,
    events: timeline,
    series,
    lowest: { date: series[balances.indexOf(lowest)].date, balance: lowest },
    highest: { date: series[balances.indexOf(highest)].date, balance: highest },
    end_balance: balances.length ? balances[balances.length - 1] : openingBalance,
  });
});
