import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, addMonths, MONTH_NAME } from "@/server/db";
import { PAYABLE_SQL, payableDate, typeLabel } from "@/server/obligations";
import { payrollSettingsRow } from "@/server/payroll";

// Port of routes/calendar_view.py — obligations on payable date, bills,
// payslips, expected paydays, projected recurring templates.
export const GET = guard(async (req: NextRequest) => {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end || end < start) return err(400, "start/end required");
  const d = db();
  const events: any[] = [];

  for (const r of d.prepare(`SELECT * FROM obligations WHERE ${PAYABLE_SQL} >= ? AND ${PAYABLE_SQL} <= ?`).all(start, end) as any[]) {
    events.push({ date: payableDate(r), kind: "obligation",
      title: `${typeLabel(r.obligation_type)} — ${r.period_label}`,
      amount: r.amount, currency: r.currency, status: r.status,
      real: r.doc_file != null, projected: false, source_id: r.id,
      doc_url: r.doc_file ? `/api/obligations/${r.id}/file` : null, page: "obligations" });
  }
  for (const r of d.prepare("SELECT * FROM company_docs WHERE COALESCE(due_date, doc_date) >= ? AND COALESCE(due_date, doc_date) <= ?").all(start, end) as any[]) {
    events.push({ date: r.due_date ?? r.doc_date, kind: "bill",
      title: `${r.vendor} — ${r.description}`, amount: r.amount, currency: r.currency,
      status: r.status, real: r.doc_file != null, projected: false, source_id: r.id,
      doc_url: r.doc_file ? `/api/accounting/${r.id}/file` : null, page: "accounting" });
  }
  const payslipMonths = new Set<string>();
  for (const r of d.prepare("SELECT * FROM payslips WHERE payment_date >= ? AND payment_date <= ?").all(start, end) as any[]) {
    payslipMonths.add(`${r.year}-${r.month}`);
    events.push({ date: r.payment_date, kind: "payroll",
      title: `Salary (net) — ${MONTH_NAME[r.month]} ${r.year}`, amount: r.net_salary,
      currency: "CHF", status: r.status, real: true, projected: false, source_id: r.id,
      doc_url: r.pdf_file ? `/api/payroll/payslip/${r.id}/pdf` : null, page: "payroll" });
  }
  for (const r of d.prepare("SELECT year, month FROM payslips").all() as any[]) payslipMonths.add(`${r.year}-${r.month}`);

  const ps = payrollSettingsRow();
  if (ps) {
    const last = d.prepare("SELECT net_salary FROM payslips ORDER BY year DESC, month DESC LIMIT 1").get() as any;
    const expectedNet = last?.net_salary ?? ps.gross_monthly;
    const payday = Math.min(Number(ps.payment_day || 25), 28);
    let cur = `${start.slice(0, 7)}-01`;
    while (cur <= end) {
      const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
      const payDate = `${cur.slice(0, 7)}-${String(payday).padStart(2, "0")}`;
      if (payDate >= start && payDate <= end && payDate >= ps.employment_start && !payslipMonths.has(`${y}-${m}`)) {
        events.push({ date: payDate, kind: "payroll",
          title: `Salary expected (~net) — ${MONTH_NAME[m]} ${y}`, amount: expectedNet,
          currency: ps.currency || "CHF", status: "expected", real: false, projected: true,
          source_id: null, doc_url: null, page: "payroll" });
      }
      cur = addMonths(cur, 1);
    }
  }
  const step = { monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>;
  for (const t of d.prepare("SELECT * FROM obligations WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_obligation_id IS NULL OR parent_obligation_id = 0) AND due_date IS NOT NULL").all() as any[]) {
    const latest = (d.prepare("SELECT due_date FROM obligations WHERE id=? OR parent_obligation_id=? ORDER BY due_date DESC LIMIT 1").get(t.id, t.id) as any).due_date;
    let cur = latest;
    for (let i = 0; i < 36; i++) {
      cur = addMonths(cur, step[t.recurrence]);
      if (cur > end) break;
      if (cur < start) continue;
      events.push({ date: cur, kind: "obligation", title: `${typeLabel(t.obligation_type)} (projected)`,
        amount: t.amount, currency: t.currency, status: "expected", real: false, projected: true,
        source_id: t.id, doc_url: null, page: "obligations" });
    }
  }
  for (const t of d.prepare("SELECT * FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_doc_id IS NULL OR parent_doc_id = 0)").all() as any[]) {
    const latest = (d.prepare("SELECT COALESCE(due_date, doc_date) AS dd FROM company_docs WHERE id=? OR parent_doc_id=? ORDER BY dd DESC LIMIT 1").get(t.id, t.id) as any).dd;
    let cur = latest;
    for (let i = 0; i < 36; i++) {
      cur = addMonths(cur, step[t.recurrence]);
      if (cur > end) break;
      if (cur < start) continue;
      events.push({ date: cur, kind: "bill", title: `${t.vendor} — ${t.description} (projected)`,
        amount: t.amount, currency: t.currency, status: "expected", real: false, projected: true,
        source_id: t.id, doc_url: null, page: "accounting" });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = events.filter(e => e.status === "unpaid" && e.date < today);
  const totals = {
    count: events.length,
    real: events.filter(e => e.real).length,
    expected: events.filter(e => !e.real).length,
    amount_due: Math.round(events.filter(e => e.status === "unpaid" || e.status === "expected")
      .reduce((s, e) => s + e.amount, 0) * 100) / 100,
    overdue_count: overdue.length,
  };
  return json({ start, end, events, totals });
});
