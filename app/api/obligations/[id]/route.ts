import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { serializeObligation } from "@/server/obligations";
import { saveUpload, deleteStored, DIRS } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM obligations WHERE id=?").get(id);
  if (!row) return err(404, "Not found");
  return json(serializeObligation(row));
});

export const PUT = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const f = await req.formData();
  const d = db();
  const row = d.prepare("SELECT doc_file FROM obligations WHERE id=?").get(id) as any;
  if (!row) return err(404, "Not found");
  let docFile = row.doc_file;
  const upload = f.get("doc") as File | null;
  if (upload && upload.size) {
    deleteStored(DIRS.accounting, docFile);
    docFile = await saveUpload(upload, DIRS.accounting, "obl");
  }
  d.prepare(`UPDATE obligations SET obligation_type=?, period_label=?, period_year=?, amount=?,
    currency=?, due_date=?, status=?, notes=?, recurrence=?, doc_file=?,
    expected_bill_date=?, expected_bill_amount=? WHERE id=?`)
    .run(String(f.get("obligation_type")), String(f.get("period_label")), Number(f.get("period_year")),
      Number(f.get("amount")), String(f.get("currency") ?? "CHF"),
      String(f.get("due_date") ?? "") || null, String(f.get("status") ?? "unpaid"),
      String(f.get("notes") ?? ""), String(f.get("recurrence") ?? "none") || "none", docFile,
      String(f.get("expected_bill_date") ?? "") || null,
      f.get("expected_bill_amount") != null && String(f.get("expected_bill_amount")) !== "" ? Number(f.get("expected_bill_amount")) : null, id);
  return json({ message: "Updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = db();
  const row = d.prepare("SELECT doc_file FROM obligations WHERE id=?").get(id) as any;
  if (!row) return err(404, "Not found");
  deleteStored(DIRS.accounting, row.doc_file);
  const oldest = d.prepare("SELECT id FROM obligations WHERE parent_obligation_id=? ORDER BY due_date LIMIT 1").get(id) as any;
  if (oldest) {
    d.prepare("UPDATE obligations SET parent_obligation_id=? WHERE parent_obligation_id=? AND id != ?").run(oldest.id, id, oldest.id);
    d.prepare("UPDATE obligations SET parent_obligation_id=NULL WHERE id=?").run(oldest.id);
  }
  d.prepare("DELETE FROM obligations WHERE id=?").run(id);
  return json({ message: "Deleted" });
});
