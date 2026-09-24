import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = (year
    ? db().prepare("SELECT * FROM payslips WHERE year=? ORDER BY month").all(year)
    : db().prepare("SELECT * FROM payslips ORDER BY year DESC, month DESC").all()) as any[];
  return json(rows.map(r => ({
    id: r.id, year: r.year, month: r.month, month_name: MONTH_NAME[r.month],
    issued_date: r.issued_date, payment_date: r.payment_date, gross: r.gross,
    emp_ahv: r.emp_ahv, emp_alv: r.emp_alv, emp_bvg: r.emp_bvg,
    emp_uvg: r.emp_uvg, emp_ktg: r.emp_ktg, emp_source_tax: r.emp_source_tax ?? 0,
    emp_total_deductions: r.emp_total_deductions, net_salary: r.net_salary,
    employer_ahv: r.employer_ahv, employer_alv: r.employer_alv,
    employer_bvg: r.employer_bvg, employer_uvg: r.employer_uvg,
    employer_ktg: r.employer_ktg, employer_fak: r.employer_fak ?? 0,
    employer_total: r.employer_total, total_employer_cost: r.total_employer_cost,
    status: r.status, notes: r.notes ?? "", source: r.source ?? "generated",
    has_pdf: r.pdf_file != null,
  })));
});
