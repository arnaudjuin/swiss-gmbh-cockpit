import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { listObligations, BASE_OBLIGATION_TYPES } from "@/server/obligations";
import { db } from "@/server/db";
import { saveUpload, DIRS } from "@/server/files";
import { err } from "@/server/http";

export const GET = guard(async (req: NextRequest) => {
  const y = req.nextUrl.searchParams.get("year");
  return json(listObligations(y ? Number(y) : undefined));
});

export const POST = guard(async (req: NextRequest) => {
  const f = await req.formData();
  const obType = String(f.get("obligation_type") ?? "");
  if (!(obType in BASE_OBLIGATION_TYPES)) return err(400, `Invalid type: ${obType}`);
  const docFile = await saveUpload(f.get("doc") as File | null, DIRS.accounting, "obl");
  const r = db().prepare(`INSERT INTO obligations
    (obligation_type, period_label, period_year, amount, currency,
     due_date, status, notes, recurrence, doc_file, expected_bill_date, expected_bill_amount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(obType, String(f.get("period_label")), Number(f.get("period_year")), Number(f.get("amount")),
      String(f.get("currency") ?? "CHF"), String(f.get("due_date") ?? "") || null,
      String(f.get("status") ?? "unpaid"), String(f.get("notes") ?? ""),
      String(f.get("recurrence") ?? "none") || "none", docFile,
      String(f.get("expected_bill_date") ?? "") || null,
      f.get("expected_bill_amount") != null && String(f.get("expected_bill_amount")) !== "" ? Number(f.get("expected_bill_amount")) : null);
  return json({ id: Number(r.lastInsertRowid) });
});
