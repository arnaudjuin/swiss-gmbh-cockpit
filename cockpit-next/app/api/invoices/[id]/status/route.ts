import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";

// Faithful port of routes/misc.py::update_invoice_status incl. the
// invoice-income mirror (one income row per paid billable invoice).
export const PATCH = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const status = body.status;
  if (status !== "paid" && status !== "unpaid") return err(400, "Invalid status");
  const paidDate = status === "paid" ? todayISO() : null;
  const d = db();
  const inv = d.prepare("SELECT id, invoice_number, year, month, hours, total FROM invoices WHERE id=?").get(id) as any;
  if (!inv) return err(404, "Invoice not found");
  d.prepare("UPDATE invoices SET paid_status=?, paid_date=? WHERE id=?").run(status, paidDate, id);
  if (inv.hours > 0) {
    if (status === "paid") {
      const existing = d.prepare("SELECT id FROM income_entries WHERE invoice_id=?").get(id);
      if (!existing) {
        const num = String(inv.invoice_number).padStart(4, "0");
        d.prepare(
          "INSERT INTO income_entries (income_date, source, description, amount, currency, category, invoice_id) " +
          "VALUES (?, ?, ?, ?, 'CHF', 'Invoice Payment', ?)"
        ).run(paidDate, `Invoice #${num}`, `Auto-linked to invoice #${num}`, inv.total, inv.id);
      }
    } else {
      d.prepare("DELETE FROM income_entries WHERE invoice_id=?").run(id);
    }
  }
  return json({ message: `Status set to ${status}` });
});
