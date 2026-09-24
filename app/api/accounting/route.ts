import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { billToDict, bookAmount, cleanDocUrl } from "@/server/bills";
import { saveUpload, DIRS } from "@/server/files";
import { err } from "@/server/http";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = year
    ? db().prepare("SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date DESC").all(year)
    : db().prepare("SELECT * FROM company_docs ORDER BY doc_date DESC").all();
  return json(rows.map(billToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const f = await req.formData();
  const paidVia = String(f.get("paid_via") ?? "company");
  if (paidVia !== "company" && paidVia !== "personal") return err(400, "paid_via must be 'company' or 'personal'");
  const booked = bookAmount(Number(f.get("amount")), String(f.get("currency") ?? "CHF"),
    f.get("fx_rate") ? Number(f.get("fx_rate")) : null);
  if ("error" in booked) return err(400, booked.error);
  const docFile = await saveUpload(f.get("doc") as File | null, DIRS.accounting, "acct");
  const r = db().prepare(`INSERT INTO company_docs
    (doc_date, vendor, description, amount, currency, category, due_date, status, recurrence,
     paid_via, doc_url, doc_file, original_amount, original_currency, fx_rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(String(f.get("doc_date")), String(f.get("vendor")), String(f.get("description")),
      booked.chf, "CHF", String(f.get("category")), String(f.get("due_date") ?? "") || null,
      String(f.get("status") ?? "unpaid"), String(f.get("recurrence") ?? "none") || "none",
      paidVia, cleanDocUrl(String(f.get("doc_url") ?? "")), docFile,
      booked.originalAmount, booked.originalCurrency, booked.fxRate);
  return json({ id: Number(r.lastInsertRowid) });
});
