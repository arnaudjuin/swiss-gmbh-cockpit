// Payslip PDF — pdfkit port of generate_invoice.generate_payslip().
import PDFDocument from "pdfkit";
import { MONTH_NAME } from "./db";

const mm = (v: number) => v * 2.83465;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderPayslipPdf(year: number, month: number, issuedDate: string,
  paymentDate: string, settings: any, calc: any, ytd: Record<string, number>): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on("end", () => res(Buffer.concat(chunks))));
  const monthName = MONTH_NAME[month];
  const cur = settings.currency ?? "CHF";

  const text = (s: string, x: number, y: number, o: any = {}) => {
    doc.font(o.font ?? "Helvetica").fontSize(o.size ?? 9).fillColor(o.color ?? "#323232");
    doc.text(s, mm(x), mm(y), { lineBreak: false, ...o });
  };
  const right = (s: string, x: number, y: number, w: number, o: any = {}) =>
    text(s, x, y, { ...o, width: mm(w), align: "right" });

  text(settings.employer_name, 15, 13, { font: "Helvetica-Bold", size: 13, color: "#141414" });
  right("Salary Slip", 110, 11, 88, { font: "Helvetica-Bold", size: 20, color: "#141414" });
  right(`${monthName} ${year}`, 110, 22, 88, { size: 10, color: "#5a5a5a" });
  right(`Payment date: ${paymentDate}`, 110, 27, 88, { size: 10, color: "#5a5a5a" });

  text("Employer", 15, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  text("Employee", 115, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  const employerLines = [settings.employer_name, "c/o Alpen Treuhand AG", "Musterstrasse 1", "8000 Zurich", "Switzerland"];
  const employeeLines = [settings.employee_name,
    ...(settings.employee_address ? String(settings.employee_address).split(",").map((p: string) => p.trim()) : [])];
  let y = 48;
  for (let i = 0; i < Math.max(employerLines.length, employeeLines.length); i++) {
    if (employerLines[i]) text(employerLines[i], 15, y);
    if (employeeLines[i]) text(employeeLines[i], 115, y);
    y += 4.5;
  }

  doc.rect(mm(15), mm(72), mm(183), mm(8)).fill("#d7e1e8");
  text(`Pay period: ${monthName} ${year}  (${year}-${String(month).padStart(2, "0")}-01 to ${issuedDate})`,
    17, 74.5, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });
  right(`Canton: ${settings.canton}`, 150, 74.5, 46, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });

  const section = (yy: number, title: string) => {
    doc.rect(mm(15), mm(yy), mm(183), mm(7)).fill("#f0f4f8");
    text(title, 17, yy + 2, { font: "Helvetica-Bold", size: 9, color: "#282828" });
    return yy + 9;
  };
  const line = (yy: number, label: string, amount: number, note = "", bold = false, color = "#1e1e1e") => {
    text(label, 17, yy, { font: bold ? "Helvetica-Bold" : "Helvetica", size: 9, color });
    if (note) text(note, 107, yy, { font: "Helvetica-Oblique", size: 8, color: "#828282" });
    right(`${cur} ${fmt(amount)}`, 160, yy, 36, { font: bold ? "Helvetica-Bold" : "Helvetica", size: 9, color });
    return yy + 6;
  };

  let ty = 88;
  ty = section(ty, "Earnings");
  ty = line(ty, "Gross salary", calc.gross, "", true);
  ty += 3;
  ty = section(ty, "Employee deductions");
  ty = line(ty, "AHV / IV / EO", calc.emp_ahv, `Official ${settings.ahv_employee_pct}%`);
  ty = line(ty, "ALV (unemployment)", calc.emp_alv, `Official ${settings.alv_employee_pct}% / 0.5% above plafond`);
  ty = line(ty, `BVG - 2nd pillar (${settings.bvg_provider || "AXA"})`, calc.emp_bvg, "Exact");
  ty = line(ty, "UVG - Non-occupational accident (AXA)", calc.emp_uvg, "Exact");
  ty = line(ty, `KTG - Daily sickness (${(100 - settings.ktg_employer_share_pct).toFixed(0)}%)`, calc.emp_ktg, "Exact");
  if (calc.emp_source_tax > 0) {
    const t = settings.source_tax_tariff;
    ty = line(ty, `Source Tax (Quellensteuer)${t ? " - " + t : ""}`, calc.emp_source_tax, "Per tariff");
  }
  doc.moveTo(mm(17), mm(ty)).lineTo(mm(196), mm(ty)).lineWidth(0.85).strokeColor("#c8c8c8").stroke();
  ty += 2;
  ty = line(ty, "Total deductions", calc.emp_total_deductions, "", true, "#b42828");
  ty += 3;

  doc.rect(mm(15), mm(ty), mm(183), mm(10)).fill("#d7e8da");
  text("Net salary", 17, ty + 3, { font: "Helvetica-Bold", size: 12, color: "#144628" });
  right(`${cur} ${fmt(calc.net_salary)}`, 150, ty + 3, 46, { font: "Helvetica-Bold", size: 12, color: "#144628" });
  ty += 14;

  ty = section(ty, "Employer contributions (not deducted from net)");
  ty = line(ty, "AHV / IV / EO", calc.employer_ahv, `Official ${settings.ahv_employer_pct}%`);
  ty = line(ty, "ALV (unemployment)", calc.employer_alv, `Official ${settings.alv_employer_pct}% / 0.5% above plafond`);
  ty = line(ty, `BVG - 2nd pillar (${settings.bvg_provider || "AXA"})`, calc.employer_bvg, "Exact");
  ty = line(ty, "UVG - Occupational + Supplementary (AXA)", calc.employer_uvg, "Exact");
  ty = line(ty, `KTG - Daily sickness (${settings.ktg_employer_share_pct.toFixed(0)}%)`, calc.employer_ktg, "Exact");
  if (calc.employer_fak > 0)
    ty = line(ty, "FAK (Family Allowance Fund)", calc.employer_fak, `Zurich ~${settings.fak_employer_pct}%`);
  doc.moveTo(mm(17), mm(ty)).lineTo(mm(196), mm(ty)).lineWidth(0.85).strokeColor("#c8c8c8").stroke();
  ty += 2;
  ty = line(ty, "Total employer contributions", calc.employer_total, "", true);
  ty += 3;

  doc.rect(mm(15), mm(ty), mm(183), mm(10)).fill("#d7e1e8");
  text("Total employer cost (gross + employer contributions)", 17, ty + 3, { font: "Helvetica-Bold", size: 12, color: "#141414" });
  right(`${cur} ${fmt(calc.total_employer_cost)}`, 150, ty + 3, 46, { font: "Helvetica-Bold", size: 12, color: "#141414" });
  ty += 14;

  if (ytd && ytd.gross > 0) {
    ty = section(ty, `Year-to-date totals (${year})`);
    for (const [label, val] of [["Gross", ytd.gross], ["Net", ytd.net_salary],
      ["Employee deductions", ytd.emp_total_deductions],
      ["Employer contributions", ytd.employer_total],
      ["Total employer cost", ytd.total_employer_cost]] as [string, number][]) {
      text(label, 17, ty, { size: 8.5, color: "#3c3c3c" });
      right(`${cur} ${fmt(val)}`, 160, ty, 36, { size: 8.5, color: "#3c3c3c" });
      ty += 5.5;
    }
  }
  const fy = Math.max(ty + 6, 278);
  text("Exact = contractual values from BVG/KTG provider. Est. = estimated Swiss standard rates.",
    15, fy, { font: "Helvetica-Oblique", size: 7.5, color: "#8c8c8c", width: mm(183), align: "center" });
  text(`Issued on ${issuedDate} · ${settings.employer_name} · Canton of ${settings.canton}`,
    15, fy + 4, { font: "Helvetica-Oblique", size: 7.5, color: "#8c8c8c", width: mm(183), align: "center" });

  doc.end();
  return done;
}
