import { NextRequest } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { guard, json } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { DIRS } from "@/server/files";

export const POST = guard(async (req: NextRequest) => {
  // Each uploaded file becomes a draft bill with minimal metadata.
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && !!f.name);
  const today = todayISO();
  const created = [];
  fs.mkdirSync(DIRS.accounting, { recursive: true });
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    const docFilename = `acct_${crypto.randomBytes(5).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(DIRS.accounting, docFilename), Buffer.from(await file.arrayBuffer()));
    const stem = path.basename(file.name, path.extname(file.name)).slice(0, 40);
    const cur = db().prepare(
      `INSERT INTO company_docs
         (doc_date, vendor, description, amount, currency, category, due_date, status, recurrence, doc_file)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(today, stem, `Uploaded: ${file.name}`, 0.0, "CHF", "Other", null, "unpaid", "none", docFilename);
    created.push({ id: Number(cur.lastInsertRowid), filename: file.name });
  }
  return json({ count: created.length, items: created });
});
