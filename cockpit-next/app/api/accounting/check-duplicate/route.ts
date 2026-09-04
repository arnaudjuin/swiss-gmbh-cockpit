import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const vendor = p.get("vendor") || "";
  const amount = Number(p.get("amount"));
  const month = p.get("month") || "";
  const rows: any[] = db().prepare(
    `SELECT id, doc_date, vendor, amount, description FROM company_docs
     WHERE LOWER(vendor)=? AND substr(doc_date,1,7)=? AND ABS(amount - ?) < 0.01`
  ).all(vendor.toLowerCase(), month, amount);
  return json({ duplicates: rows.map(r => ({
    id: r.id, doc_date: r.doc_date, vendor: r.vendor,
    amount: r.amount, description: r.description })) });
});
