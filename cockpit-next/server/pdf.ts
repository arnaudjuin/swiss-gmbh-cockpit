// Invoice PDF — pdfkit port of generate_invoice.generate(). fpdf works in
// millimetres; pdfkit in points (1 mm = 2.8346 pt), hence mm().
import PDFDocument from "pdfkit";
import { MONTH_NAME } from "./db";
import type { Biz } from "./biz";

const mm = (v: number) => v * 2.83465;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Customer { name: string; address?: string | null; city?: string | null;
  country?: string | null; email?: string | null; reference?: string | null }

export function renderInvoicePdf(year: number, month: number, hours: number,
  invoiceNum: number, customer: Customer, b: Biz): Promise<Buffer> {
  const monthName = MONTH_NAME[month];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const issued = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const [dueY, dueM] = month < 12 ? [year, month + 1] : [year + 1, 1];
  const dueLast = new Date(Date.UTC(dueY, dueM, 0)).getUTCDate();
  const due = `${dueY}-${String(dueM).padStart(2, "0")}-${String(dueLast).padStart(2, "0")}`;
  const subtotal = hours * b.rate;
  const tax = Math.round(subtotal * b.vat_rate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on("end", () => res(Buffer.concat(chunks))));

  const text = (s: string, xMm: number, yMm: number, opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    doc.font(opts.font ?? "Helvetica").fontSize(opts.size ?? 9).fillColor(opts.color ?? "#323232");
    doc.text(s, mm(xMm), mm(yMm), { lineBreak: false, ...opts });
  };
  const rightText = (s: string, xMm: number, yMm: number, wMm: number, o: any = {}) =>
    text(s, xMm, yMm, { ...o, width: mm(wMm), align: "right", lineBreak: false });

  // header
  text(b.company, 15, 13, { font: "Helvetica-Bold", size: 13, color: "#141414" });
  rightText(`Invoice: ${String(invoiceNum).padStart(4, "0")}`, 110, 10, 88, { font: "Helvetica-Bold", size: 24, color: "#141414" });
  rightText(`Issued on: ${issued}`, 110, 23, 88, { size: 9, color: "#5a5a5a" });
  rightText(`Due by: ${due}`, 110, 28, 88, { size: 9, color: "#5a5a5a" });

  // from / to
  text("From", 15, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  let y = 48;
  for (const line of [b.company, ...b.from_lines]) { text(line, 15, y); y += 4.5; }
  text("To", 115, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  let yt = 48;
  const toLines = [customer.name, customer.address, customer.city, customer.country, "",
    customer.email, customer.reference].filter((l): l is string => l != null && l !== undefined);
  for (const line of toLines) { text(line, 115, yt); yt += 4.5; }

  // table
  const ty = 100;
  doc.rect(mm(15), mm(ty), mm(183), mm(9)).fill("#d7e1e8");
  text("Product", 17, ty + 2.5, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });
  text("Hours", 85, ty + 2.5, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e", width: mm(30), align: "center" });
  text("Unit Price", 118, ty + 2.5, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e", width: mm(30), align: "center" });
  text("Tax", 148, ty + 2.5, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e", width: mm(20), align: "center" });
  rightText("Total", 170, ty + 2.5, 26, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });
  const dy = ty + 14;
  text("Engineering Services", 17, dy, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  text(`${monthName} ${year}`, 17, dy + 6, { size: 8.5, color: "#6e6e6e" });
  text(String(hours), 85, dy + 3, { size: 10, color: "#1e1e1e", width: mm(30), align: "center" });
  text(`CHF ${b.rate.toFixed(2)}`, 118, dy + 3, { size: 10, color: "#1e1e1e", width: mm(30), align: "center" });
  text(`${(b.vat_rate * 100).toFixed(1)}%`, 148, dy + 3, { size: 10, color: "#1e1e1e", width: mm(20), align: "center" });
  rightText(`CHF ${fmt(total)}`, 170, dy + 3, 26, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  doc.moveTo(mm(15), mm(dy + 14)).lineTo(mm(198), mm(dy + 14)).lineWidth(0.85).strokeColor("#c8c8c8").stroke();

  // summary
  let sy = dy + 24;
  doc.rect(mm(120), mm(sy), mm(78), mm(10)).fill("#d7e1e8");
  for (const [dx, dyy, w, h] of [[0, 4, 2.5, 3], [3.5, 2, 2.5, 5], [7, 0.5, 2.5, 6.5], [10.5, 3, 2.5, 4]] as const) {
    doc.rect(mm(126 + dx), mm(sy + 1.5 + dyy), mm(w), mm(h)).fill("#323232");
  }
  text("Invoice Summary", 142, sy + 3, { font: "Helvetica-Bold", size: 11, color: "#1e1e1e", width: mm(54), align: "center" });
  sy += 14;
  for (const [label, amount] of [["Subtotal", subtotal], ["Tax", tax]] as const) {
    text(label, 122, sy + 1.5, { size: 10 });
    rightText(`CHF ${fmt(amount as number)}`, 160, sy + 1.5, 36, { size: 10 });
    sy += 8;
  }
  text("Total", 122, sy + 1.5, { font: "Helvetica-Bold", size: 12, color: "#141414" });
  rightText(`CHF ${fmt(total)}`, 160, sy + 1.5, 36, { font: "Helvetica-Bold", size: 12, color: "#141414" });

  // terms + footer
  text("Terms", 15, 237, { font: "Helvetica-Bold", size: 9, color: "#1e1e1e" });
  let tyy = 243;
  for (const line of ["Payment Information", `Account Name: ${b.account_name}`,
    `IBAN: ${b.iban}`, `BIC: ${b.bic}`, `Bank: ${b.bank}`]) {
    text(line, 15, tyy); tyy += 5;
  }
  rightText("1/1", 170, 285, 26, { size: 8, color: "#787878" });

  doc.end();
  return done;
}
