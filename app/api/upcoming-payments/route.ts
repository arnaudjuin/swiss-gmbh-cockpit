import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { PAYABLE_SQL, payableDate, typeLabel } from "@/server/obligations";

export const GET = guard(async (req: NextRequest) => {
  const days = Number(req.nextUrl.searchParams.get("days") ?? 60);
  const d = db();
  const today = todayISO();
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const items: any[] = [];
  for (const b of d.prepare("SELECT * FROM company_docs WHERE status='unpaid' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date").all(cutoff) as any[]) {
    items.push({ id: b.id, kind: "bill", title: b.vendor, description: b.description,
      category: b.category, amount: b.amount, currency: b.currency,
      due_date: b.due_date, overdue: b.due_date < today });
  }
  for (const o of d.prepare(`SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL AND ${PAYABLE_SQL} <= ? ORDER BY ${PAYABLE_SQL}`).all(cutoff) as any[]) {
    const pay = payableDate(o)!;
    items.push({ id: o.id, kind: "obligation", title: typeLabel(o.obligation_type),
      description: o.period_label, category: o.obligation_type,
      amount: o.amount, currency: o.currency, due_date: pay, period_due: o.due_date,
      overdue: pay < today });
  }
  items.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return json({ today, days,
    total: items.reduce((s, i) => s + i.amount, 0),
    overdue_total: items.filter(i => i.overdue).reduce((s, i) => s + i.amount, 0),
    count: items.length, items });
});
