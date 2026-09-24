import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    "SELECT DISTINCT substr(expense_date,1,4) as y FROM expenses ORDER BY y").all();
  return json(rows.map(r => r.y));
});
