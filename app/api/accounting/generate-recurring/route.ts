import { guard, json } from "@/server/http";
import { db, addMonths, todayISO } from "@/server/db";

export const POST = guard(async () => {
  const d = db();
  const today = todayISO();
  const horizon = addMonths(today, 2);
  let created = 0;
  const templates = d.prepare("SELECT * FROM company_docs WHERE recurrence IN ('monthly','yearly','quarterly') AND (parent_doc_id IS NULL OR parent_doc_id = 0) ORDER BY id").all() as any[];
  for (const t of templates) {
    const latest = d.prepare("SELECT * FROM company_docs WHERE id=? OR parent_doc_id=? ORDER BY doc_date DESC LIMIT 1").get(t.id, t.id) as any;
    const step = { monthly: 1, quarterly: 3, yearly: 12 }[t.recurrence as "monthly"] ?? 12;
    let curDate = latest.doc_date as string;
    let curDue = latest.due_date as string | null;
    for (let i = 0; i < 36; i++) {
      const nextDate = addMonths(curDate, step);
      const nextDue = curDue ? addMonths(curDue, step) : null;
      if (nextDate > horizon) break;
      const exists = d.prepare("SELECT id FROM company_docs WHERE parent_doc_id=? AND doc_date=?").get(t.id, nextDate);
      if (!exists) {
        d.prepare(`INSERT INTO company_docs
          (doc_date, vendor, description, amount, currency, category, due_date, status, recurrence, parent_doc_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(nextDate, t.vendor, t.description, t.amount, t.currency, t.category,
            nextDue, "unpaid", "none", t.id);
        created++;
      }
      curDate = nextDate; curDue = nextDue;
    }
  }
  return json({ created });
});
