import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { saveUpload, DIRS } from "@/server/files";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = (year
    ? db().prepare("SELECT * FROM income_entries WHERE substr(income_date,1,4)=? ORDER BY income_date DESC").all(year)
    : db().prepare("SELECT * FROM income_entries ORDER BY income_date DESC").all()) as any[];
  return json(rows.map(r => ({ id: r.id, income_date: r.income_date, source: r.source,
    description: r.description ?? "", amount: r.amount, currency: r.currency,
    category: r.category, doc_file: r.doc_file, has_file: r.doc_file != null,
    file_type: r.doc_file ? String(r.doc_file).split(".").pop() : null,
    invoice_id: r.invoice_id ?? null })));
});

export const POST = guard(async (req: NextRequest) => {
  const f = await req.formData();
  const docFile = await saveUpload(f.get("doc") as File | null, DIRS.accounting, "income");
  const r = db().prepare("INSERT INTO income_entries (income_date, source, description, amount, currency, category, doc_file) VALUES (?,?,?,?,?,?,?)")
    .run(String(f.get("income_date")), String(f.get("source")), String(f.get("description") ?? ""),
      Number(f.get("amount")), String(f.get("currency") ?? "CHF"), String(f.get("category") ?? "Other"), docFile);
  return json({ id: Number(r.lastInsertRowid) });
});
