import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, storeBytes } from "@/server/files";
import path from "path";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = (year
    ? db().prepare("SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date").all(year)
    : db().prepare("SELECT * FROM expenses ORDER BY expense_date DESC").all()) as any[];
  return json(rows.map(r => ({
    id: r.id, expense_date: r.expense_date, description: r.description,
    amount: r.amount, category: r.category,
    original_amount: r.original_amount, original_currency: r.original_currency,
    scan_file: r.scan_file, has_scan: r.scan_file != null,
    scan_type: r.scan_file ? String(r.scan_file).split(".").pop() : null,
    trip_id: r.trip_id ?? null,
  })));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  let scanFilename: string | null = null;
  const scan = form.get("scan") as File | null;
  if (scan && scan.name) {
    const raw = Buffer.from(await scan.arrayBuffer());
    scanFilename = storeBytes(DIRS.scans, "exp", path.extname(scan.name).toLowerCase(), raw);
  }
  const cur = db().prepare(
    "INSERT INTO expenses (expense_date, description, amount, category, scan_file) VALUES (?,?,?,?,?)"
  ).run(s("expense_date"), s("description"), Number(s("amount")), s("category"), scanFilename);
  return json({ id: Number(cur.lastInsertRowid) });
});
