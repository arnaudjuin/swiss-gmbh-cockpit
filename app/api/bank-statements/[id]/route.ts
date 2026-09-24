import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { statementToDict } from "@/server/bank";
import { DIRS, storeBytes, deleteStored } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM bank_statements WHERE id=?").get(Number(id));
  if (!row) return err(404, "Statement not found");
  return json(statementToDict(row));
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM bank_statements WHERE id=?").get(Number(id));
  if (!row) return err(404, "Statement not found");
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const n = (k: string) => { const v = s(k); return v.trim() === "" ? null : Number(v); };
  const period_start = s("period_start"), period_end = s("period_end");
  if (!period_start || !period_end) return err(400, "period_start and period_end are required");

  const maybeReplace = async (file: File | null, current: string | null): Promise<string | null> => {
    if (!file || !file.name) return current;
    const raw = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).toLowerCase();
    const newName = storeBytes(DIRS.bank, "bank", ext, raw);
    if (current && current !== newName) {
      const stillUsed = db().prepare(
        "SELECT 1 FROM bank_statements WHERE (statement_file_pdf=? OR statement_file_xml=?) AND id!=? LIMIT 1"
      ).get(current, current, Number(id));
      if (!stillUsed) deleteStored(DIRS.bank, current);
    }
    return newName;
  };
  const pdfName = await maybeReplace(form.get("file_pdf") as File | null, row.statement_file_pdf);
  const xmlName = await maybeReplace(form.get("file_xml") as File | null, row.statement_file_xml);

  db().prepare(
    `UPDATE bank_statements SET
       bank=?, account_label=?, iban=?, period_start=?, period_end=?,
       statement_type=?, opening_balance=?, closing_balance=?, currency=?,
       statement_file_pdf=?, statement_file_xml=?, notes=?,
       updated_at=datetime('now')
     WHERE id=?`
  ).run(s("bank", "UBS"), s("account_label") || null, s("iban") || null, period_start, period_end,
    s("statement_type", "monthly"), n("opening_balance"), n("closing_balance"), s("currency", "CHF") || "CHF",
    pdfName, xmlName, s("notes") || null, Number(id));
  return json({ message: "Statement updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM bank_statements WHERE id=?").get(Number(id));
  if (!row) return err(404, "Statement not found");
  const filesToCheck = [row.statement_file_pdf, row.statement_file_xml];
  db().prepare("DELETE FROM bank_statements WHERE id=?").run(Number(id));
  for (const f of filesToCheck) {
    if (!f) continue;
    const stillUsed = db().prepare(
      "SELECT 1 FROM bank_statements WHERE statement_file_pdf=? OR statement_file_xml=? LIMIT 1").get(f, f);
    if (!stillUsed) deleteStored(DIRS.bank, f);
  }
  return json({ message: "Statement deleted" });
});
