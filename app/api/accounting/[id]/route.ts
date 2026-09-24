import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { billToDict, bookAmount, cleanDocUrl } from "@/server/bills";
import { saveUpload, deleteStored, DIRS } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM company_docs WHERE id=?").get(id);
  if (!row) return err(404, "Document not found");
  return json(billToDict(row));
});

export const PUT = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const f = await req.formData();
  const paidVia = String(f.get("paid_via") ?? "company");
  if (paidVia !== "company" && paidVia !== "personal") return err(400, "paid_via must be 'company' or 'personal'");
  const booked = bookAmount(Number(f.get("amount")), String(f.get("currency") ?? "CHF"),
    f.get("fx_rate") ? Number(f.get("fx_rate")) : null);
  if ("error" in booked) return err(400, booked.error);
  const d = db();
  const row = d.prepare("SELECT * FROM company_docs WHERE id=?").get(id) as any;
  if (!row) return err(404, "Document not found");
  let docFile = row.doc_file;
  const upload = f.get("doc") as File | null;
  if (upload && upload.size) {
    deleteStored(DIRS.accounting, docFile);
    docFile = await saveUpload(upload, DIRS.accounting, "acct");
  }
  d.prepare(`UPDATE company_docs SET doc_date=?, vendor=?, description=?, amount=?, currency=?,
    category=?, due_date=?, status=?, recurrence=?, paid_via=?, doc_url=?, doc_file=?,
    original_amount=?, original_currency=?, fx_rate=? WHERE id=?`)
    .run(String(f.get("doc_date")), String(f.get("vendor")), String(f.get("description")),
      booked.chf, "CHF", String(f.get("category")), String(f.get("due_date") ?? "") || null,
      String(f.get("status") ?? "unpaid"), String(f.get("recurrence") ?? "none") || "none",
      paidVia, cleanDocUrl(String(f.get("doc_url") ?? "")), docFile,
      booked.originalAmount, booked.originalCurrency, booked.fxRate, id);
  return json({ message: "Document updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = db();
  const row = d.prepare("SELECT doc_file FROM company_docs WHERE id=?").get(id) as any;
  if (!row) return err(404, "Document not found");
  deleteStored(DIRS.accounting, row.doc_file);
  const oldest = d.prepare("SELECT id FROM company_docs WHERE parent_doc_id=? ORDER BY doc_date LIMIT 1").get(id) as any;
  if (oldest) {
    d.prepare("UPDATE company_docs SET parent_doc_id=? WHERE parent_doc_id=? AND id != ?").run(oldest.id, id, oldest.id);
    d.prepare("UPDATE company_docs SET parent_doc_id=NULL WHERE id=?").run(oldest.id);
  }
  d.prepare("DELETE FROM company_docs WHERE id=?").run(id);
  return json({ message: "Document deleted" });
});
