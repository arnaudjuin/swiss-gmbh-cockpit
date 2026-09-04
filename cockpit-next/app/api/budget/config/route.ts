import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { SALARY, BUDGET_GROUPS } from "@/server/budget";

export const GET = guard(async () => {
  const rows: any[] = db().prepare("SELECT * FROM budget_items ORDER BY grp, sort_order").all();
  if (!rows.length) return json({ salary: SALARY, items: [], groups: BUDGET_GROUPS });
  return json({
    salary: SALARY,
    groups: BUDGET_GROUPS,
    items: rows.map(r => ({
      id: r.id, grp: r.grp, subcategory: r.subcategory,
      budgeted: r.budgeted, sort_order: r.sort_order,
    })),
  });
});

export const POST = guard(async (req: NextRequest) => {
  // Replace the config — UPSERT so existing IDs and their ledger history
  // survive (wipe + re-insert used to orphan all ledger rows).
  const body = await req.json();
  const items: any[] = body.items ?? [];
  const incoming = new Set(items.map(i => `${i.grp}\u0000${i.subcategory}`));
  const existing: any[] = db().prepare("SELECT id, grp, subcategory FROM budget_items").all();
  for (const row of existing) {
    if (!incoming.has(`${row.grp}\u0000${row.subcategory}`)) {
      db().prepare("DELETE FROM budget_ledger WHERE budget_item_id=?").run(row.id);
      db().prepare("DELETE FROM budget_items WHERE id=?").run(row.id);
    }
  }
  items.forEach((item, i) => {
    db().prepare(
      `INSERT INTO budget_items (grp, subcategory, budgeted, sort_order) VALUES (?,?,?,?)
       ON CONFLICT(grp, subcategory) DO UPDATE SET
         budgeted=excluded.budgeted, sort_order=excluded.sort_order`
    ).run(item.grp, item.subcategory, item.budgeted ?? 0, i);
  });
  return json({ message: "Budget saved" });
});
