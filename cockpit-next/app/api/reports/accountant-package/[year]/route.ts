import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { guard } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { DIRS, contentDisposition } from "@/server/files";
import { csvRow, pyFloat } from "@/server/pycsv";
import { typeLabel } from "@/server/obligations";

const pad4 = (n: number) => String(n).padStart(4, "0");
const addFile = (zip: JSZip, names: Set<string>, fp: string, arc: string) => {
  if (names.has(arc) || !fs.existsSync(fp)) return;
  zip.file(arc, fs.readFileSync(fp), { createFolders: false });
  names.add(arc);
};

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const zip = new JSZip();
  const names = new Set<string>();
  const d = db();

  // Invoices (reimbursement reports excluded — they live in expenses/)
  const invoices: any[] = d.prepare("SELECT * FROM invoices WHERE year=? AND hours>0 ORDER BY month").all(year);
  let csv = csvRow(["Invoice #", "Month", "Hours", "Subtotal", "VAT", "Total", "Status", "Paid Date", "Due Date"]);
  for (const r of invoices) {
    csv += csvRow([pad4(r.invoice_number), MONTH_NAME[r.month], pyFloat(r.hours), pyFloat(r.subtotal),
      pyFloat(r.tax), pyFloat(r.total), r.paid_status ?? "", r.paid_date ?? "", r.due_date]);
  }
  zip.file(`${year}/invoices/_summary.csv`, csv, { createFolders: false });
  for (const r of invoices)
    addFile(zip, names, path.join(DIRS.invoices, `invoice_${pad4(r.invoice_number)}.pdf`),
      `${year}/invoices/invoice_${pad4(r.invoice_number)}.pdf`);

  // Accounting docs
  const bills: any[] = d.prepare("SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date").all(String(year));
  csv = csvRow(["Date", "Vendor", "Description", "Amount", "Currency", "Category", "Status", "Due Date"]);
  for (const r of bills)
    csv += csvRow([r.doc_date, r.vendor, r.description, pyFloat(r.amount), r.currency, r.category, r.status, r.due_date || ""]);
  zip.file(`${year}/accounting/_summary.csv`, csv, { createFolders: false });
  for (const r of bills) {
    if (!r.doc_file) continue;
    const ext = path.extname(r.doc_file);
    const safe = String(r.vendor).replace(/\//g, "-").slice(0, 30);
    addFile(zip, names, path.join(DIRS.accounting, r.doc_file),
      `${year}/accounting/docs/${r.doc_date}_${safe}_${pyFloat(r.amount)}${ext}`);
  }

  // Travel expense reports — ALL of them (year-wide + month-specific)
  const reports: any[] = d.prepare("SELECT * FROM expense_reports WHERE year=? ORDER BY id").all(year);
  for (const rep of reports) {
    const n = pad4(rep.report_number);
    const fname = rep.month
      ? `expenses_${year}_${String(rep.month).padStart(2, "0")}_${n}.pdf` : `expenses_${year}_${n}.pdf`;
    const arc = rep.month
      ? `${year}/travel_expenses/report_${year}-${String(rep.month).padStart(2, "0")}_${n}.pdf`
      : `${year}/travel_expenses/report_${n}.pdf`;
    addFile(zip, names, path.join(DIRS.reports, fname), arc);
  }

  const expenses: any[] = d.prepare("SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date").all(String(year));
  csv = csvRow(["Date", "Description", "Category", "Amount (CHF)", "Original Amount", "Original Currency", "Scan filename"]);
  for (const r of expenses)
    csv += csvRow([r.expense_date, r.description, r.category, pyFloat(r.amount),
      r.original_amount != null ? pyFloat(r.original_amount) : "", r.original_currency || "", r.scan_file || ""]);
  zip.file(`${year}/travel_expenses/_summary.csv`, csv, { createFolders: false });

  // Receipt scans (so the Treuhand sees the originals)
  for (const r of expenses) {
    if (!r.scan_file) continue;
    const ext = path.extname(r.scan_file);
    const safe = String(r.description || "expense").replace(/\//g, "-").slice(0, 40);
    addFile(zip, names, path.join(DIRS.scans, r.scan_file),
      `${year}/travel_expenses/scans/${r.expense_date}_${safe}_${pyFloat(r.amount)}${ext}`);
  }

  // Payslips (Lohnabrechnungen)
  const payslips: any[] = d.prepare(
    "SELECT id, year, month, gross, net_salary, total_employer_cost, pdf_file FROM payslips WHERE year=? ORDER BY month").all(year);
  if (payslips.length) {
    csv = csvRow(["Year", "Month", "Gross", "Net", "Employer cost", "PDF file"]);
    for (const r of payslips)
      csv += csvRow([r.year, r.month, pyFloat(r.gross), pyFloat(r.net_salary), pyFloat(r.total_employer_cost), r.pdf_file || ""]);
    zip.file(`${year}/payslips/_summary.csv`, csv, { createFolders: false });
    for (const r of payslips) {
      if (!r.pdf_file) continue;
      const ext = path.extname(r.pdf_file);
      addFile(zip, names, path.join(DIRS.payslips, r.pdf_file),
        `${year}/payslips/${year}-${String(r.month).padStart(2, "0")}_Lohnabrechnung${ext}`);
    }
  }
  // Raw payslip PDFs sitting in the dir (not in DB), if they mention the year
  if (fs.existsSync(DIRS.payslips)) {
    for (const name of fs.readdirSync(DIRS.payslips).sort()) {
      const fp = path.join(DIRS.payslips, name);
      if (!fs.statSync(fp).isFile()) continue;
      if (![".pdf", ".jpg", ".jpeg", ".png"].includes(path.extname(name).toLowerCase())) continue;
      const arc = `${year}/payslips/${name}`;
      if (!names.has(arc) && name.includes(String(year))) addFile(zip, names, fp, arc);
    }
  }

  // Bank statements for the year
  const stmts: any[] = d.prepare(
    "SELECT * FROM bank_statements WHERE substr(period_end,1,4)=? ORDER BY period_end").all(String(year));
  if (stmts.length) {
    csv = csvRow(["Period start", "Period end", "Bank", "Account", "IBAN", "Type", "Currency",
      "Opening balance", "Closing balance", "Notes", "PDF file", "XML file"]);
    for (const r of stmts)
      csv += csvRow([r.period_start, r.period_end, r.bank, r.account_label || "", r.iban || "",
        r.statement_type, r.currency,
        r.opening_balance != null ? pyFloat(r.opening_balance) : "",
        r.closing_balance != null ? pyFloat(r.closing_balance) : "",
        r.notes || "", r.statement_file_pdf || "", r.statement_file_xml || ""]);
    zip.file(`${year}/bank_statements/_summary.csv`, csv, { createFolders: false });
    for (const r of stmts) {
      const safeAcct = String(r.account_label || r.bank).replace(/\//g, "-").slice(0, 30);
      for (const fname of [r.statement_file_pdf, r.statement_file_xml]) {
        if (!fname) continue;
        const ext = path.extname(fname);
        addFile(zip, names, path.join(DIRS.bank, fname), `${year}/bank_statements/${r.period_end}_${safeAcct}${ext}`);
      }
    }
  }

  // Obligations
  const obs: any[] = d.prepare("SELECT * FROM obligations WHERE period_year=? ORDER BY due_date").all(year);
  csv = csvRow(["Type", "Period", "Amount", "Due Date", "Status", "Notes"]);
  for (const r of obs)
    csv += csvRow([typeLabel(r.obligation_type), r.period_label, pyFloat(r.amount), r.due_date || "", r.status, r.notes || ""]);
  zip.file(`${year}/obligations/_summary.csv`, csv, { createFolders: false });

  const buf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.mkdirSync(DIRS.reports, { recursive: true });
  fs.writeFileSync(path.join(DIRS.reports, `accountant_package_${year}.zip`), buf);
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(`Muster Consulting Accountant Package ${year}.zip`),
  } });
});
