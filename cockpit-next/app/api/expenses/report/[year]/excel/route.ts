import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { guard, err } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { DIRS, contentDisposition } from "@/server/files";
import { COMPANY, AED_TO_CHF } from "@/server/expenseReports";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const monthQ = req.nextUrl.searchParams.get("month");
  const month = monthQ ? Number(monthQ) : null;

  const periodLabel = month ? `${MONTH_NAME[month]} ${year}` : String(year);
  const fileStem = month ? `expenses_${year}_${String(month).padStart(2, "0")}` : `expenses_${year}`;

  const rows: any[] = month
    ? db().prepare(
        `SELECT * FROM expenses WHERE substr(expense_date,1,4)=? AND substr(expense_date,6,2)=? ORDER BY expense_date`
      ).all(String(year), String(month).padStart(2, "0"))
    : db().prepare("SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date").all(String(year));
  if (!rows.length) return err(404, `No expenses for ${periodLabel}`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Expenses ${periodLabel}`.slice(0, 31));
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7E1E8" } };
  const chfFmt = "#,##0.00";
  const thinBorder: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };

  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = `Muster Consulting GmbH - Travel Expenses ${periodLabel}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = `Exchange rate: 1 AED = ${AED_TO_CHF} CHF`;
  ws.getCell("A2").font = { size: 9, color: { argb: "FF888888" } };

  const headers = ["Date", "Description", "Category", "Amount (CHF)"];
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 11 };
    cell.fill = headerFill;
  });

  rows.forEach((r, i) => {
    const row = 5 + i;
    ws.getCell(row, 1).value = r.expense_date;
    ws.getCell(row, 2).value = r.description;
    ws.getCell(row, 3).value = r.category;
    const amt = ws.getCell(row, 4);
    amt.value = r.amount;
    amt.numFmt = chfFmt;
    for (let col = 1; col <= 4; col++) ws.getCell(row, col).border = thinBorder;
  });

  const totalRow = rows.length + 5;
  ws.getCell(totalRow, 3).value = "TOTAL";
  ws.getCell(totalRow, 3).font = { bold: true };
  const totalCell = ws.getCell(totalRow, 4);
  totalCell.value = rows.reduce((s, r) => s + r.amount, 0);
  totalCell.numFmt = chfFmt;
  totalCell.font = { bold: true };

  const widths: [string, number][] = [["A", 12], ["B", 50], ["C", 16], ["D", 14], ["E", 14]];
  for (const [col, w] of widths) ws.getColumn(col).width = w;

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  fs.mkdirSync(DIRS.reports, { recursive: true });
  fs.writeFileSync(path.join(DIRS.reports, `${fileStem}.xlsx`), buf);

  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": contentDisposition(`Travel Expenses ${periodLabel} ${COMPANY} 101119.LOD-SW_GCS-24032.xlsx`),
  } });
});
