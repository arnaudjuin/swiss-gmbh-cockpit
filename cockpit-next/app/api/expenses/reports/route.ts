import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    "SELECT * FROM expense_reports ORDER BY year DESC, COALESCE(month, 0) DESC, id DESC").all();
  return json(rows.map(r => ({
    id: r.id, report_number: r.report_number, year: r.year,
    month: r.month ?? null, total: r.total, total_chf: r.total,
    expense_count: r.expense_count, created_at: r.created_at,
  })));
});
