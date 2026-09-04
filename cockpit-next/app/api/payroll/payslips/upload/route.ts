import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db, round2 } from "@/server/db";
import { DIRS } from "@/server/files";
import { rowToSettings, computePayslip } from "@/server/payroll";

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoDate = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const n = (k: string) => { const v = s(k); return v.trim() === "" ? null : Number(v); };
  const year = Number(s("year")), month = Number(s("month"));
  let paymentDate = s("payment_date");
  const gross = n("gross"), net = n("net");
  const doc = form.get("doc") as File | null;

  if (month < 1 || month > 12) return err(400, "Month must be 1-12");
  if (!doc || !doc.name || !doc.name.toLowerCase().endsWith(".pdf"))
    return err(400, "Please upload a PDF file");
  if (gross != null && net != null && net > gross) return err(400, "Net cannot exceed gross");

  const pdfName = `payslip_${year}_${String(month).padStart(2, "0")}_accountant.pdf`;
  fs.mkdirSync(DIRS.payslips, { recursive: true });
  fs.writeFileSync(path.join(DIRS.payslips, pdfName), Buffer.from(await doc.arrayBuffer()));

  const existing: any = db().prepare("SELECT * FROM payslips WHERE year=? AND month=?").get(year, month);
  if (existing) {
    const newGross = gross != null ? gross : existing.gross;
    const newNet = net != null ? net : existing.net_salary;
    const newDeductions = (gross != null || net != null)
      ? round2(newGross - newNet) : existing.emp_total_deductions;
    db().prepare(
      `UPDATE payslips SET gross=?, net_salary=?, emp_total_deductions=?,
         payment_date=COALESCE(NULLIF(?, ''), payment_date),
         pdf_file=?, source='uploaded',
         notes=TRIM(COALESCE(notes,'') || ' Accountant payslip uploaded.')
       WHERE id=?`
    ).run(newGross, newNet, newDeductions, paymentDate, pdfName, existing.id);
    return json({ id: existing.id, replaced: true, source: "uploaded" });
  }

  // New month — estimate the breakdown from settings, honor overrides.
  const settingsRow: any = db().prepare("SELECT * FROM payroll_settings WHERE id=1").get();
  if (!settingsRow) return err(400, "Payroll settings not configured");
  const settings = rowToSettings(settingsRow);
  const calc: any = computePayslip(settings);

  const newGross = gross != null ? gross : calc.gross;
  const newNet = net != null ? net : calc.net_salary;
  const newDeductions = (gross != null || net != null)
    ? round2(newGross - newNet) : calc.emp_total_deductions;
  const last = lastDay(year, month);
  const issued = isoDate(year, month, last);
  if (!paymentDate) paymentDate = isoDate(year, month, Math.min(settings.payment_day, last));

  const cur = db().prepare(
    `INSERT INTO payslips
       (year, month, issued_date, payment_date, gross,
        emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_ktg, emp_source_tax,
        emp_total_deductions, net_salary,
        employer_ahv, employer_alv, employer_bvg, employer_uvg, employer_ktg, employer_fak,
        employer_total, total_employer_cost,
        status, pdf_file, source, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    year, month, issued, paymentDate, newGross,
    calc.emp_ahv, calc.emp_alv, calc.emp_bvg, calc.emp_uvg, calc.emp_ktg, calc.emp_source_tax ?? 0,
    newDeductions, newNet,
    calc.employer_ahv, calc.employer_alv, calc.employer_bvg,
    calc.employer_uvg, calc.employer_ktg, calc.employer_fak ?? 0,
    calc.employer_total, calc.total_employer_cost,
    "issued", pdfName, "uploaded",
    "Accountant payslip uploaded — contribution breakdown estimated from settings.");
  return json({ id: Number(cur.lastInsertRowid), replaced: false, source: "uploaded" });
});
