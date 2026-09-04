import { guard, json } from "@/server/http";
import { db, addMonths, todayISO, MONTH_ABBR } from "@/server/db";

export const POST = guard(async () => {
  const d = db();
  const horizon = addMonths(todayISO(), 6);
  let created = 0;
  const templates = d.prepare("SELECT * FROM obligations WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_obligation_id IS NULL OR parent_obligation_id = 0)").all() as any[];
  for (const t of templates) {
    if (!t.due_date) continue;
    const latest = d.prepare("SELECT * FROM obligations WHERE id=? OR parent_obligation_id=? ORDER BY due_date DESC LIMIT 1").get(t.id, t.id) as any;
    const step = { monthly: 1, quarterly: 3, yearly: 12 }[t.recurrence as "monthly"] ?? 12;
    let cur = latest.due_date as string;
    for (let i = 0; i < 36; i++) {
      const nxt = addMonths(cur, step);
      if (nxt > horizon) break;
      const exists = d.prepare("SELECT id FROM obligations WHERE parent_obligation_id=? AND due_date=?").get(t.id, nxt);
      if (!exists) {
        const yy = Number(nxt.slice(0, 4)), mmNo = Number(nxt.slice(5, 7));
        const period = t.recurrence === "monthly" ? `${MONTH_ABBR[mmNo]} ${yy}`
          : t.recurrence === "quarterly" ? `Q${Math.floor((mmNo - 1) / 3) + 1} ${yy}` : `FY ${yy}`;
        d.prepare(`INSERT INTO obligations
          (obligation_type, period_label, period_year, amount, currency, due_date, status, notes, recurrence, parent_obligation_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(t.obligation_type, period, yy, t.amount, t.currency, nxt, "unpaid", t.notes, "none", t.id);
        created++;
      }
      cur = nxt;
    }
  }
  return json({ created });
});
