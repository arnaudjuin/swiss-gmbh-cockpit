import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    `SELECT substr(expense_date,1,4) as year, COUNT(*) as count, SUM(amount) as total
     FROM expenses GROUP BY year ORDER BY year`).all();
  return json(rows.map(r => ({ year: r.year, count: r.count, total: r.total })));
});
