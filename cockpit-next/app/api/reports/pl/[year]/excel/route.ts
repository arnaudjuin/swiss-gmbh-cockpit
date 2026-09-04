import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { guard } from "@/server/http";
import { plReport } from "@/server/pl";
import { DIRS, contentDisposition } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const data: any = plReport(year);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`P&L ${year}`);
  const bold = { bold: true, size: 12 };
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7E1E8" } };
  const chf = "#,##0.00";
  let row = 1;
  const cell = (r: number, c: number, v: any) => { const x = ws.getCell(r, c); x.value = v; return x; };
  const money = (r: number, v: number, f?: object) => { const x = cell(r, 2, v); x.numFmt = chf; if (f) x.font = f as any; };

  cell(row, 1, `Muster Consulting GmbH — Annual P&L ${year}`).font = { bold: true, size: 16 };
  row += 2;
  cell(row, 1, "REVENUE").font = bold; ws.getCell(row, 1).fill = headerFill; row += 1;
  cell(row, 1, "Invoices issued"); money(row, data.revenue.invoices_issued); row += 1;
  cell(row, 1, "  of which paid"); money(row, data.revenue.invoices_paid); row += 1;
  cell(row, 1, "Other income"); money(row, data.revenue.extra_income); row += 1;
  cell(row, 1, "Total Revenue").font = bold; money(row, data.revenue.total, bold); row += 2;

  cell(row, 1, "COSTS").font = bold; ws.getCell(row, 1).fill = headerFill; row += 1;
  cell(row, 1, "Salary (annual)"); money(row, data.costs.salary); row += 1;
  for (const cat of data.costs.company_docs) {
    cell(row, 1, `  ${cat.category}`); money(row, cat.total); row += 1;
  }
  cell(row, 1, "Total Costs").font = bold; money(row, data.costs.total, bold); row += 2;

  cell(row, 1, "OBLIGATIONS (AHV / BVG / Tax)").font = bold; ws.getCell(row, 1).fill = headerFill; row += 1;
  for (const ob of data.obligations.breakdown) {
    cell(row, 1, `  ${ob.type}`); money(row, ob.total); row += 1;
  }
  cell(row, 1, "Total Obligations").font = bold; money(row, data.obligations.total, bold); row += 2;

  cell(row, 1, "PROFIT BEFORE TAX").font = { bold: true, size: 14 };
  money(row, data.profit_before_tax, { bold: true, size: 14 }); row += 1;
  cell(row, 1, "Profit margin %"); cell(row, 2, `${data.profit_margin_pct}%`); row += 2;

  const tp = data.travel_pass_through;
  cell(row, 1, "TRAVEL (PASS-THROUGH — NOT IN P&L)").font = bold; ws.getCell(row, 1).fill = headerFill; row += 1;
  cell(row, 1, `  Expenses paid (${tp.expenses_count} receipts)`); money(row, tp.expenses_paid); row += 1;
  cell(row, 1, "  Reimbursed by client"); money(row, tp.reimbursed_by_client); row += 1;
  cell(row, 1, "  Net outstanding (still owed by client)").font = bold; money(row, tp.net_outstanding, bold);

  ws.getColumn("A").width = 45;
  ws.getColumn("B").width = 18;

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  fs.mkdirSync(DIRS.reports, { recursive: true });
  fs.writeFileSync(path.join(DIRS.reports, `PL_${year}.xlsx`), buf);
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": contentDisposition(`Muster Consulting P&L ${year}.xlsx`),
  } });
});
