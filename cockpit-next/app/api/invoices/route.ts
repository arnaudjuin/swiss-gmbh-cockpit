import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import fs from "fs";
import path from "path";
import { bizSettings } from "@/server/biz";
import { renderInvoicePdf } from "@/server/pdf";
import { DIRS } from "@/server/files";
import { db } from "@/server/db";
import { invoiceToDict, computeDates, getCustomer } from "@/server/invoices";

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM invoices WHERE hours > 0 ORDER BY year DESC, month DESC").all();
  return json(rows.map(invoiceToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const data = await req.json();
  const d = db();
  const invNum = data.invoice_number ??
    (((d.prepare("SELECT MAX(invoice_number) n FROM invoices").get() as any).n ?? 17) + 1);
  const [issued, due] = computeDates(data.year, data.month);
  const biz = bizSettings();
  const subtotal = data.hours * biz.rate;
  const tax = Math.round(subtotal * biz.vat_rate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const customer = getCustomer(data.customer_id);
  const pdf = await renderInvoicePdf(data.year, data.month, data.hours, invNum, customer, biz);
  fs.mkdirSync(DIRS.invoices, { recursive: true });
  fs.writeFileSync(path.join(DIRS.invoices, `invoice_${String(invNum).padStart(4, "0")}.pdf`), pdf);
  try {
    const r = d.prepare(`INSERT INTO invoices
      (invoice_number, year, month, hours, rate, vat_rate, subtotal, tax, total, issued_date, due_date, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(invNum, data.year, data.month, data.hours, biz.rate, biz.vat_rate,
        subtotal, tax, total, issued, due, data.notes ?? "");
    return json({ id: Number(r.lastInsertRowid), invoice_number: invNum });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) return err(400, `Invoice #${invNum} already exists`);
    throw e;
  }
});
