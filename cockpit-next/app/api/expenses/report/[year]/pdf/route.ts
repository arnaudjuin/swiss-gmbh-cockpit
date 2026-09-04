import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { guard, err } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { DIRS, contentDisposition } from "@/server/files";
import { reportFilename, COMPANY } from "@/server/expenseReports";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const monthQ = req.nextUrl.searchParams.get("month");
  const month = monthQ ? Number(monthQ) : null;
  const download = ["1", "true", "True"].includes(req.nextUrl.searchParams.get("download") ?? "");

  const row: any = month
    ? db().prepare("SELECT * FROM expense_reports WHERE year=? AND month=? ORDER BY id DESC LIMIT 1").get(year, month)
    : db().prepare("SELECT * FROM expense_reports WHERE year=? AND month IS NULL ORDER BY id DESC LIMIT 1").get(year);
  if (!row) return err(404, "No report for this scope");

  const p = path.join(DIRS.reports, reportFilename(year, month, row.report_number));
  if (!fs.existsSync(p)) return err(404, "Report PDF not found");
  const periodLabel = month ? `${MONTH_NAME[month]} ${year}` : String(year);
  const headers: Record<string, string> = { "Content-Type": "application/pdf" };
  if (download)
    headers["Content-Disposition"] =
      contentDisposition(`Travel Expenses ${periodLabel} ${COMPANY} 101119.LOD-SW_GCS-24032.pdf`);
  return new NextResponse(new Uint8Array(fs.readFileSync(p)), { headers });
});
