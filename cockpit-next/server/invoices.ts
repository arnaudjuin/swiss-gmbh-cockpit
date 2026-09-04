import { MONTH_NAME } from "./db";

export function invoiceToDict(r: any) {
  return {
    id: r.id, invoice_number: r.invoice_number, year: r.year, month: r.month,
    month_name: MONTH_NAME[r.month], hours: r.hours, rate: r.rate,
    subtotal: r.subtotal, tax: r.tax, total: r.total,
    issued_date: r.issued_date, due_date: r.due_date, notes: r.notes ?? "",
    paid_status: r.paid_status ?? "unpaid", paid_date: r.paid_date ?? null,
    created_at: r.created_at,
  };
}
