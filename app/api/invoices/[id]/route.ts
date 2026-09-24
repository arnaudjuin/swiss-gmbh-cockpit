import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import fs from "fs";
import path from "path";
import { bizSettings } from "@/server/biz";
import { renderInvoicePdf } from "@/server/pdf";
import { DIRS } from "@/server/files";
import { computeDates, getCustomer } from "@/server/invoices";

export const PUT = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const data = await req.json();
  const d = db();
  const row = d.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as any;
  if (!row) return err(404, "Invoice not found");
  const [issued, due] = computeDates(data.year, data.month);
  const biz = bizSettings();
  const subtotal = data.hours * biz.rate;
  const tax = Math.round(subtotal * biz.vat_rate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const pdf = await renderInvoicePdf(data.year, data.month, data.hours, row.invoice_number,
    getCustomer(data.customer_id), biz);
  fs.writeFileSync(path.join(DIRS.invoices, `invoice_${String(row.invoice_number).padStart(4, "0")}.pdf`), pdf);
  d.prepare(`UPDATE invoices SET year=?, month=?, hours=?, subtotal=?, tax=?, total=?,
    issued_date=?, due_date=?, notes=? WHERE id=?`)
    .run(data.year, data.month, data.hours, subtotal, tax, total, issued, due, data.notes ?? "", id);
  return json({ message: `Invoice #${String(row.invoice_number).padStart(4, "0")} updated` });
});

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = db();
  const row = d.prepare("SELECT invoice_number FROM invoices WHERE id = ?").get(id) as any;
  if (!row) return err(404, "Invoice not found");
  const p = path.join(DIRS.invoices, `invoice_${String(row.invoice_number).padStart(4, "0")}.pdf`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  d.prepare("DELETE FROM income_entries WHERE invoice_id = ?").run(id);
  d.prepare("DELETE FROM invoices WHERE id = ?").run(id);
  return json({ message: "Invoice deleted" });
});
