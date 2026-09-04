import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { saveUpload, DIRS } from "@/server/files";

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM account_transfers ORDER BY transfer_date DESC").all() as any[];
  return json(rows.map(r => ({ id: r.id, transfer_date: r.transfer_date, direction: r.direction,
    amount: r.amount, currency: r.currency, description: r.description ?? "",
    doc_file: r.doc_file, has_file: r.doc_file != null,
    file_type: r.doc_file ? String(r.doc_file).split(".").pop() : null })));
});

export const POST = guard(async (req: NextRequest) => {
  const f = await req.formData();
  const direction = String(f.get("direction") ?? "");
  if (direction !== "personal_to_gmbh" && direction !== "gmbh_to_personal") return err(400, "Invalid direction");
  const docFile = await saveUpload(f.get("doc") as File | null, DIRS.accounting, "xfer");
  const r = db().prepare("INSERT INTO account_transfers (transfer_date, direction, amount, currency, description, doc_file) VALUES (?,?,?,?,?,?)")
    .run(String(f.get("transfer_date")), direction, Number(f.get("amount")),
      String(f.get("currency") ?? "CHF"), String(f.get("description") ?? ""), docFile);
  return json({ id: Number(r.lastInsertRowid) });
});
