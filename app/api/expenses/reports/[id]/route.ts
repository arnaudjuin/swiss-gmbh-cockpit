import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS } from "@/server/files";
import { reportFilename } from "@/server/expenseReports";

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM expense_reports WHERE id=?").get(Number(id));
  if (!row) return err(404, "Report not found");
  const pdfPath = path.join(DIRS.reports, reportFilename(row.year, row.month, row.report_number));
  if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  const excelPath = path.join(DIRS.reports, `expenses_${row.year}.xlsx`);
  if (fs.existsSync(excelPath) && !row.month) fs.unlinkSync(excelPath);
  db().prepare("DELETE FROM invoices WHERE invoice_number=?").run(row.report_number);
  db().prepare("DELETE FROM expense_reports WHERE id=?").run(Number(id));
  return json({ message: `Report #${String(row.report_number).padStart(4, "0")} deleted` });
});
