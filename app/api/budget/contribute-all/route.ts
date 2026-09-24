import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { lastDayOf, recomputeBalance } from "@/server/budget";

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const monthStr: string = body.month || todayISO().slice(0, 7);
  const y = Number(monthStr.slice(0, 4)), m = Number(monthStr.slice(5, 7));
  const entryDate = `${monthStr}-${String(lastDayOf(y, m)).padStart(2, "0")}`;

  let updated = 0, total = 0;
  const rows: any[] = db().prepare("SELECT * FROM budget_items").all();
  for (const r of rows) {
    if (r.budgeted <= 0) continue;
    const exists = db().prepare(
      "SELECT id FROM budget_ledger WHERE budget_item_id=? AND kind='contribute' AND substr(entry_date,1,7)=?"
    ).get(r.id, monthStr);
    if (exists) continue;
    db().prepare(
      "INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind) VALUES (?,?,?,?,?)"
    ).run(r.id, entryDate, r.budgeted, `Monthly contribution for ${monthStr}`, "contribute");
    recomputeBalance(r.id);
    db().prepare("UPDATE budget_items SET last_contributed_month=? WHERE id=?").run(monthStr, r.id);
    updated += 1;
    total += r.budgeted;
  }
  return json({ contributed_items: updated, total_contributed: total, month: monthStr });
});
