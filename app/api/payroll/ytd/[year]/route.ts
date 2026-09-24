import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";

const FIELDS = ["gross", "emp_ahv", "emp_alv", "emp_bvg", "emp_uvg", "emp_ktg",
  "emp_source_tax", "emp_total_deductions", "net_salary",
  "employer_ahv", "employer_alv", "employer_bvg", "employer_uvg", "employer_ktg",
  "employer_fak", "employer_total", "total_employer_cost"];

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { year } = await ctx.params;
  const rows: any[] = db().prepare("SELECT * FROM payslips WHERE year=? ORDER BY month").all(Number(year));
  const totals: Record<string, number> = {};
  for (const f of FIELDS) {
    totals[f] = rows.some(r => r[f] === undefined)
      ? 0
      : round2(rows.reduce((s, r) => s + (r[f] ?? 0), 0));
  }
  return json({ year: Number(year), count: rows.length, months: rows.map(r => r.month), totals });
});
