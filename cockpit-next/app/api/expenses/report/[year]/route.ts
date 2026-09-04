import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db, MONTH_NAME, todayISO } from "@/server/db";
import { DIRS } from "@/server/files";
import { getCustomer } from "@/server/invoices";
import { bizSettings } from "@/server/biz";
import { renderExpenseReport } from "@/server/expensePdf";
import { reportFilename } from "@/server/expenseReports";

export const POST = guard(async (req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const monthQ = req.nextUrl.searchParams.get("month");
  const month = monthQ ? Number(monthQ) : null;

  const rows: any[] = month
    ? db().prepare(
        `SELECT * FROM expenses WHERE substr(expense_date,1,4)=? AND substr(expense_date,6,2)=? ORDER BY expense_date`
      ).all(String(year), String(month).padStart(2, "0"))
    : db().prepare(
        "SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date").all(String(year));
  const scope = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
  if (!rows.length) return err(400, `No expenses found for ${scope}`);

  // Replace any report for this exact scope but KEEP its number (it is the
  // invoice number the accountant and client already hold).
  let keepNumber: number | null = null;
  let keepReimbursed: string | null = null;
  let keepTotal: number | null = null;
  const existing: any[] = month
    ? db().prepare("SELECT report_number FROM expense_reports WHERE year=? AND month=?").all(year, month)
    : db().prepare("SELECT report_number FROM expense_reports WHERE year=? AND month IS NULL").all(year);
  for (const old of existing) {
    if (keepNumber == null) {
      keepNumber = old.report_number;
      const prev: any = db().prepare(
        "SELECT reimbursed_at, total FROM expense_reports WHERE report_number=?").get(old.report_number);
      keepReimbursed = prev ? prev.reimbursed_at : null;
      keepTotal = prev ? Number(prev.total || 0) : null;
    }
    const oldPdf = path.join(DIRS.reports, reportFilename(year, month, old.report_number));
    if (fs.existsSync(oldPdf)) fs.unlinkSync(oldPdf);
    db().prepare("DELETE FROM invoices WHERE invoice_number=?").run(old.report_number);
  }
  if (month) db().prepare("DELETE FROM expense_reports WHERE year=? AND month=?").run(year, month);
  else db().prepare("DELETE FROM expense_reports WHERE year=? AND month IS NULL").run(year);
  if (!month) {
    const oldExcel = path.join(DIRS.reports, `expenses_${year}.xlsx`);
    if (fs.existsSync(oldExcel)) fs.unlinkSync(oldExcel);
  }

  const expenses = rows.map(r => ({
    date: r.expense_date, description: r.description, category: r.category,
    amount: r.amount, original_amount: r.original_amount, original_currency: r.original_currency,
    scan_path: r.scan_file ? path.join(DIRS.scans, r.scan_file) : null,
  }));

  const invNum = keepNumber != null ? keepNumber
    : (((db().prepare("SELECT MAX(invoice_number) as n FROM invoices").get() as any).n ?? 17) || 17) + 1;
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const customer = getCustomer(1);

  const pdfBytes = await renderExpenseReport(year, expenses, invNum, customer, bizSettings(), month);
  fs.mkdirSync(DIRS.reports, { recursive: true });
  fs.writeFileSync(path.join(DIRS.reports, reportFilename(year, month, invNum)), pdfBytes);

  const periodLabel = month ? `${MONTH_NAME[month]} ${year}` : String(year);
  const issued = todayISO();
  const [iy, im] = issued.split("-").map(Number);
  const [dueY, dueM] = im < 12 ? [iy, im + 1] : [iy + 1, 1];
  const dueLast = new Date(Date.UTC(dueY, dueM, 0)).getUTCDate();
  const dueDate = `${dueY}-${String(dueM).padStart(2, "0")}-${String(dueLast).padStart(2, "0")}`;
  db().prepare(
    `INSERT INTO invoices
       (invoice_number, year, month, hours, rate, vat_rate, subtotal, tax, total, issued_date, due_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(invNum, year, month || 12, 0, 0, 0, total, 0, total, issued, dueDate,
    `Travel expenses ${periodLabel}`);
  // A regenerated report stays reimbursed only if its total didn't change.
  if (keepReimbursed && keepTotal != null && Math.abs(keepTotal - total) > 0.005) keepReimbursed = null;
  db().prepare(
    "INSERT INTO expense_reports (report_number, year, month, total, expense_count, reimbursed_at) VALUES (?,?,?,?,?,?)"
  ).run(invNum, year, month, total, expenses.length, keepReimbursed);

  return json({ report_number: invNum, year, month, total,
    count: expenses.length, regenerated: keepNumber != null });
});
