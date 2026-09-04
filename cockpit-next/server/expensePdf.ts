// Expense-report PDF — port of generate_invoice.generate_expense_report.
// Page 1 invoice, page 2+ detail table, then one page per receipt scan.
// Image scans are embedded by pdfkit; PDF scans keep their vector pages —
// pdf-lib draws the same reference banner and composites them in place
// (Python rasterizes via PyMuPDF instead; layout is equivalent).
import PDFDocument from "pdfkit";
import fs from "fs";
import { PDFDocument as PdfLib, StandardFonts, rgb } from "pdf-lib";
import type { Biz } from "./biz";
import { MONTH_NAME } from "./db";

const mm = (v: number) => v * 2.83465;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AED_TO_CHF = 0.2178;
const RATES: Record<string, number> = { AED: AED_TO_CHF, USD: 0.88, EUR: 0.94 };

export function latin1Safe(s: string): string {
  const map: Record<string, string> = {
    "—": "-", "–": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', "•": "*", "…": "...",
    "·": ".", " ": " ", "→": "->", "←": "<-", "↔": "<->",
  };
  let out = "";
  for (const ch of s) {
    const m = map[ch];
    if (m != null) { out += m; continue; }
    out += ch.codePointAt(0)! > 255 ? "?" : ch;
  }
  return out;
}

export interface ReportExpense {
  date: string; description: string; category: string; amount: number;
  original_amount?: number | null; original_currency?: string | null;
  scan_path?: string | null;
}
interface Customer { name: string; address?: string | null; city?: string | null;
  country?: string | null; email?: string | null; reference?: string | null }

export async function renderExpenseReport(year: number, expensesIn: ReportExpense[],
  invoiceNum: number, customer: Customer, b: Biz, month?: number | null): Promise<Buffer> {
  const periodLabel = month ? `${MONTH_NAME[month]} ${year}` : String(year);
  const expenses = expensesIn.map(e => ({
    ...e,
    description: latin1Safe(e.description || ""),
    category: latin1Safe(e.category || ""),
    original_currency: latin1Safe(e.original_currency || "") || null,
  }));
  const today = new Date();
  const issued = today.toISOString().slice(0, 10);
  const [dueY, dueM] = today.getMonth() + 1 < 12
    ? [today.getFullYear(), today.getMonth() + 2] : [today.getFullYear() + 1, 1];
  const dueLast = new Date(Date.UTC(dueY, dueM, 0)).getUTCDate();
  const due = `${dueY}-${String(dueM).padStart(2, "0")}-${String(dueLast).padStart(2, "0")}`;

  const totalChf = Math.round(expenses.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const count = expenses.length;
  const sorted = [...expenses].sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
  const currenciesUsed = [...new Set(expenses.map(e => e.original_currency).filter((c): c is string => !!c))].sort();

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on("end", () => res(Buffer.concat(chunks))));

  const text = (s: string, xMm: number, yMm: number,
    opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    doc.font(opts.font ?? "Helvetica").fontSize(opts.size ?? 9).fillColor(opts.color ?? "#323232");
    doc.text(s, mm(xMm), mm(yMm), { lineBreak: false, ...opts });
  };
  const rightText = (s: string, xMm: number, yMm: number, wMm: number, o: any = {}) =>
    text(s, xMm, yMm, { ...o, width: mm(wMm), align: "right", lineBreak: false });

  // ── Page 1: Invoice ──
  doc.addPage();
  let pdfkitPages = 1;

  // header (same layout as the invoice PDF)
  text(b.company, 15, 13, { font: "Helvetica-Bold", size: 13, color: "#141414" });
  rightText(`Invoice: ${String(invoiceNum).padStart(4, "0")}`, 110, 10, 88, { font: "Helvetica-Bold", size: 24, color: "#141414" });
  rightText(`Issued on: ${issued}`, 110, 23, 88, { size: 9, color: "#5a5a5a" });
  rightText(`Due by: ${due}`, 110, 28, 88, { size: 9, color: "#5a5a5a" });
  text("From", 15, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  let fy = 48;
  for (const line of [b.company, ...b.from_lines]) { text(line, 15, fy); fy += 4.5; }
  text("To", 115, 40, { font: "Helvetica-Bold", size: 10, color: "#141414" });
  let yt = 48;
  const toLines = [customer.name];
  if (customer.address) toLines.push(customer.address);
  if (customer.city) toLines.push(customer.city);
  if (customer.country) toLines.push(customer.country);
  toLines.push("");
  if (customer.email) toLines.push(customer.email);
  if (customer.reference) toLines.push(customer.reference);
  for (const line of toLines) { text(line, 115, yt); yt += 4.5; }

  // product table
  const ty = 105;
  doc.rect(mm(15), mm(ty), mm(183), mm(9)).fill("#d7e1e8");
  text("Product", 17, ty + 2, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });
  text("Tax", 148, ty + 2, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e", width: mm(20), align: "center" });
  rightText("Total", 170, ty + 2, 26, { font: "Helvetica-Bold", size: 9.5, color: "#1e1e1e" });
  const dy = ty + 14;
  text("Travel Expenses", 17, dy, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  text(`Total exp. for ${periodLabel} (${count} receipts)`, 17, dy + 6, { size: 8.5, color: "#6e6e6e" });
  text("0%", 148, dy + 3, { size: 10, color: "#1e1e1e", width: mm(20), align: "center" });
  rightText(`CHF ${fmt(totalChf)}`, 170, dy + 3, 26, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  doc.moveTo(mm(15), mm(dy + 16)).lineTo(mm(198), mm(dy + 16)).lineWidth(0.85).strokeColor("#c8c8c8").stroke();

  // summary
  let sy = dy + 26;
  doc.rect(mm(120), mm(sy), mm(78), mm(10)).fill("#d7e1e8");
  for (const [dx, dyy, w, h] of [[0, 4, 2.5, 3], [3.5, 2, 2.5, 5], [7, 0.5, 2.5, 6.5], [10.5, 3, 2.5, 4]] as const) {
    doc.rect(mm(126 + dx), mm(sy + 1.5 + dyy), mm(w), mm(h)).fill("#323232");
  }
  text("Invoice Summary", 142, sy + 3, { font: "Helvetica-Bold", size: 11, color: "#1e1e1e", width: mm(54), align: "center" });
  sy += 14;
  text("Subtotal", 122, sy + 1.5, { size: 10 });
  rightText(`CHF ${fmt(totalChf)}`, 160, sy + 1.5, 36, { size: 10 });
  sy += 8;
  text("Tax (0%)", 122, sy + 1.5, { size: 10 });
  rightText("CHF 0.00", 160, sy + 1.5, 36, { size: 10 });
  sy += 8;
  text("Total", 122, sy + 1.5, { font: "Helvetica-Bold", size: 12, color: "#141414" });
  rightText(`CHF ${fmt(totalChf)}`, 160, sy + 1.5, 36, { font: "Helvetica-Bold", size: 12, color: "#141414" });

  // exchange-rate note
  const rateParts = currenciesUsed.filter(c => c in RATES).map(c => `1 ${c} = ${RATES[c]} CHF`);
  if (rateParts.length) text("Exchange rates: " + rateParts.join(", "), 15, 228, { size: 8, color: "#828282" });

  // terms
  text("Terms", 15, 237, { font: "Helvetica-Bold", size: 9, color: "#1e1e1e" });
  let tyy = 243;
  for (const line of ["Payment Information", `Account Name: ${b.account_name}`,
    `IBAN: ${b.iban}`, `BIC: ${b.bic}`, `Bank: ${b.bank}`]) {
    text(line, 15, tyy); tyy += 5;
  }

  // ── Page 2+: detail table ──
  const ROW_H = 6.5, PAGE_BOTTOM = 260;
  const detailHeader = (y: number): number => {
    doc.rect(mm(15), mm(y), mm(183), mm(9)).fill("#d7e1e8");
    const h = y + 2.5;
    text("Ref", 17, h, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    text("Date", 26, h, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    text("Description", 45, h, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    text("Category", 103, h, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    rightText("Original", 128, h, 33, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    rightText("CHF", 165, h, 31, { font: "Helvetica-Bold", size: 8.5, color: "#1e1e1e" });
    return y + 11;
  };

  doc.addPage(); pdfkitPages++;
  text("Expense Details", 15, 13, { font: "Helvetica-Bold", size: 13, color: "#1e1e1e" });
  text(`Invoice ${String(invoiceNum).padStart(4, "0")} - Travel Expenses ${periodLabel}`, 15, 21, { size: 9, color: "#646464" });
  let startY = 28;
  if (rateParts.length) {
    text("Conversion rates: " + rateParts.join("  |  "), 15, startY, { font: "Helvetica-Oblique", size: 8, color: "#828282" });
    startY += 6;
  }
  let dty = detailHeader(startY + 2);
  sorted.forEach((exp, i) => {
    if (dty + ROW_H > PAGE_BOTTOM) { doc.addPage(); pdfkitPages++; dty = detailHeader(15); }
    text(String(i + 1), 17, dty, { font: "Helvetica-Bold", size: 8, color: "#646464" });
    text(exp.date, 26, dty, { size: 8.5, color: "#282828" });
    let desc = exp.description;
    if (desc.length > 35) desc = desc.slice(0, 32) + "...";
    text(desc, 45, dty, { size: 8.5, color: "#282828" });
    text(exp.category, 103, dty, { size: 8.5, color: "#646464" });
    if (exp.original_amount && exp.original_currency)
      rightText(`${exp.original_currency} ${fmt(exp.original_amount)}`, 128, dty, 33, { size: 7.5, color: "#505050" });
    rightText(fmt(exp.amount), 165, dty, 31, { size: 8.5, color: "#282828" });
    dty += ROW_H;
  });
  dty += 2;
  doc.moveTo(mm(15), mm(dty)).lineTo(mm(198), mm(dty)).lineWidth(0.85).strokeColor("#c8c8c8").stroke();
  dty += 4;
  text(`Total (${count})`, 130, dty, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  rightText(`CHF ${fmt(totalChf)}`, 162, dty, 34, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });

  // ── Receipt scan pages ──
  // pdfkit pages for image scans; PDF scans queued for pdf-lib compositing.
  interface PdfInsert { at: number; path: string; idx: number; exp: ReportExpense }
  const pdfInserts: PdfInsert[] = [];

  const banner = (idx: number, exp: ReportExpense, pageNo: number, totalPages: number) => {
    doc.rect(mm(15), mm(12), mm(183), mm(12)).fill("#d7e1e8");
    let ref = `Ref ${idx}`;
    if (totalPages > 1) ref += ` (${pageNo}/${totalPages})`;
    text(ref, 17, 15.5, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
    text(`${exp.date}  |  ${exp.description}`, 35, 15.5, { size: 9, color: "#323232" });
    if (exp.original_amount && exp.original_currency)
      rightText(`${exp.original_currency} ${fmt(exp.original_amount)}`, 125, 15.5, 30, { size: 8, color: "#787878" });
    rightText(`CHF ${fmt(exp.amount)}`, 158, 15.5, 38, { font: "Helvetica-Bold", size: 10, color: "#1e1e1e" });
  };

  sorted.forEach((exp, i) => {
    const idx = i + 1;
    const scanPath = exp.scan_path;
    if (!scanPath || !fs.existsSync(scanPath)) return;
    if (scanPath.toLowerCase().endsWith(".pdf")) {
      pdfInserts.push({ at: pdfkitPages, path: scanPath, idx, exp });
      return;
    }
    doc.addPage(); pdfkitPages++;
    banner(idx, exp, 1, 1);
    try {
      doc.image(scanPath, mm(15), mm(30), { fit: [mm(180), mm(245)], align: "center" });
    } catch {
      text("Scan page could not be loaded", 15, 140, { font: "Helvetica-Oblique", size: 9, color: "#969696", width: mm(180), align: "center" });
    }
  });

  doc.end();
  const base = await done;
  if (!pdfInserts.length) return base;

  // Composite PDF scans: same banner, source page scaled beneath it.
  const out = await PdfLib.load(base);
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvB = await out.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const drawBanner = (page: any, idx: number, exp: ReportExpense, pageNo: number, totalPages: number) => {
    const topY = A4[1] - mm(12) - mm(12);
    page.drawRectangle({ x: mm(15), y: topY, width: mm(183), height: mm(12), color: rgb(0.843, 0.882, 0.910) });
    let ref = `Ref ${idx}`;
    if (totalPages > 1) ref += ` (${pageNo}/${totalPages})`;
    const baseY = topY + mm(4);
    page.drawText(ref, { x: mm(17), y: baseY, size: 10, font: helvB, color: rgb(0.12, 0.12, 0.12) });
    page.drawText(latin1Safe(`${exp.date}  |  ${exp.description}`), { x: mm(35), y: baseY, size: 9, font: helv, color: rgb(0.2, 0.2, 0.2) });
    if (exp.original_amount && exp.original_currency) {
      const s = `${exp.original_currency} ${fmt(exp.original_amount)}`;
      page.drawText(s, { x: mm(155) - helv.widthOfTextAtSize(s, 8), y: baseY, size: 8, font: helv, color: rgb(0.47, 0.47, 0.47) });
    }
    const t = `CHF ${fmt(exp.amount)}`;
    page.drawText(t, { x: mm(196) - helvB.widthOfTextAtSize(t, 10), y: baseY, size: 10, font: helvB, color: rgb(0.12, 0.12, 0.12) });
  };

  for (const ins of [...pdfInserts].reverse()) {
    let inserted = 0;
    try {
      const src = await PdfLib.load(fs.readFileSync(ins.path), { ignoreEncryption: true });
      const embedded = await out.embedPdf(src, src.getPageIndices());
      const totalPages = embedded.length;
      embedded.forEach((ep, pi) => {
        const page = out.insertPage(ins.at + pi, A4);
        drawBanner(page, ins.idx, ins.exp, pi + 1, totalPages);
        const scale = Math.min(mm(180) / ep.width, mm(245) / ep.height);
        const w = ep.width * scale, h = ep.height * scale;
        page.drawPage(ep, { x: mm(15) + (mm(180) - w) / 2, y: A4[1] - mm(30) - h, width: w, height: h });
        inserted++;
      });
    } catch {
      const page = out.insertPage(ins.at, A4);
      drawBanner(page, ins.idx, ins.exp, 1, 1);
      page.drawText("Scan could not be loaded", { x: mm(80), y: A4[1] - mm(145), size: 9, font: helv, color: rgb(0.59, 0.59, 0.59) });
      inserted++;
    }
    void inserted;
  }
  return Buffer.from(await out.save());
}
