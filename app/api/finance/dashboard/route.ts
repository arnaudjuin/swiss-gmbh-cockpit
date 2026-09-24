import { guard, json } from "@/server/http";
import { db, todayISO, MONTH_NAME } from "@/server/db";

const toList = (rows: any[]) => rows.map(r => ({
  id: r.id, doc_date: r.doc_date, vendor: r.vendor, description: r.description,
  amount: r.amount, currency: r.currency, category: r.category,
  due_date: r.due_date, status: r.status,
}));

export const GET = guard(async () => {
  const today = todayISO();
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const overdue: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE status='unpaid' AND due_date < ? ORDER BY due_date").all(today);
  const dueMonth: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE status='unpaid' AND due_date >= ? AND due_date < ? ORDER BY due_date").all(monthStart, nextMonth);
  const upcoming: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE status='unpaid' AND due_date >= ? ORDER BY due_date LIMIT 20").all(nextMonth);
  const noDate: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE status='unpaid' AND due_date IS NULL ORDER BY doc_date DESC").all();
  const paidRecent: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE status='paid' ORDER BY due_date DESC LIMIT 10").all();

  const overdueTotal = overdue.reduce((s, r) => s + r.amount, 0);
  const monthTotal = dueMonth.reduce((s, r) => s + r.amount, 0);
  return json({
    today,
    month: `${MONTH_NAME[m]} ${y}`,
    overdue: toList(overdue),
    overdue_total: overdueTotal,
    due_this_month: toList(dueMonth),
    month_total: monthTotal,
    total_due: overdueTotal + monthTotal,
    upcoming: toList(upcoming),
    no_due_date: toList(noDate),
    recently_paid: toList(paidRecent),
  });
});
