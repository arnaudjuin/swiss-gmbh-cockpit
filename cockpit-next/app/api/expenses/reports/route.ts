import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM expense_reports ORDER BY year DESC, report_number DESC").all();
  return json(rows);
});
