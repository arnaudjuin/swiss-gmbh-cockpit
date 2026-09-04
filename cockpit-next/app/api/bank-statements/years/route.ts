import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    "SELECT DISTINCT substr(period_end,1,4) AS y FROM bank_statements ORDER BY y DESC").all();
  return json(rows.map(r => r.y));
});
