import { db, MONTH_NAME } from "./db";
import { DEFAULT_CUSTOMER } from "./biz";

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

export function computeDates(year: number, month: number): [string, string] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const issued = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const [dy, dm] = month < 12 ? [year, month + 1] : [year + 1, 1];
  const dLast = new Date(Date.UTC(dy, dm, 0)).getUTCDate();
  return [issued, `${dy}-${String(dm).padStart(2, "0")}-${String(dLast).padStart(2, "0")}`];
}

export function getCustomer(customerId?: number | null) {
  if (customerId) {
    const r = db().prepare("SELECT * FROM customers WHERE id=?").get(customerId) as any;
    if (r) return r;
  }
  return DEFAULT_CUSTOMER;
}
