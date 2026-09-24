import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    `SELECT vendor, category, amount, COUNT(*) as cnt, MAX(doc_date) as last_date
     FROM company_docs GROUP BY vendor ORDER BY cnt DESC, last_date DESC`).all();
  return json(rows.map(r => ({
    vendor: r.vendor, category: r.category, last_amount: r.amount,
    count: r.cnt, last_date: r.last_date,
  })));
});
