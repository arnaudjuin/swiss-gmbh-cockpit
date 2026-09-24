import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, storeBytes, deleteStored } from "@/server/files";
import path from "path";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM expenses WHERE id = ?").get(Number(id));
  if (!row) return err(404, "Expense not found");
  return json({
    id: row.id, expense_date: row.expense_date, description: row.description,
    amount: row.amount, category: row.category,
    scan_file: row.scan_file, has_scan: row.scan_file != null,
  });
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM expenses WHERE id = ?").get(Number(id));
  if (!row) return err(404, "Expense not found");
  const form = await req.formData();
  const s = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  let scanFilename: string | null = row.scan_file;
  const scan = form.get("scan") as File | null;
  if (scan && scan.name) {
    const raw = Buffer.from(await scan.arrayBuffer());
    const ext = path.extname(scan.name).toLowerCase();
    const newName = storeBytes(DIRS.scans, "exp", ext, raw);
    // Only delete the old scan if no sibling row references the same blob.
    if (scanFilename && scanFilename !== newName) {
      const stillUsed = db().prepare(
        "SELECT 1 FROM expenses WHERE scan_file=? AND id!=? LIMIT 1").get(scanFilename, Number(id));
      if (!stillUsed) deleteStored(DIRS.scans, scanFilename);
    }
    scanFilename = newName;
  }
  db().prepare(
    "UPDATE expenses SET expense_date=?, description=?, amount=?, category=?, scan_file=? WHERE id=?"
  ).run(s("expense_date"), s("description"), Number(s("amount")), s("category"), scanFilename, Number(id));
  return json({ message: "Expense updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT scan_file FROM expenses WHERE id = ?").get(Number(id));
  if (!row) return err(404, "Expense not found");
  db().prepare("DELETE FROM expenses WHERE id = ?").run(Number(id));
  // Content-hash filenames can be shared — unlink only when unreferenced.
  if (row.scan_file) {
    const stillUsed = db().prepare("SELECT 1 FROM expenses WHERE scan_file=? LIMIT 1").get(row.scan_file);
    if (!stillUsed) deleteStored(DIRS.scans, row.scan_file);
  }
  return json({ message: "Expense deleted" });
});
