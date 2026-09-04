import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { invoiceToDict } from "@/server/invoices";

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM invoices WHERE hours > 0 ORDER BY year DESC, month DESC").all();
  return json(rows.map(invoiceToDict));
});
