import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, deleteStored } from "@/server/files";

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT doc_file FROM income_entries WHERE id=?").get(Number(id));
  if (!row) return err(404, "Income not found");
  deleteStored(DIRS.accounting, row.doc_file);
  db().prepare("DELETE FROM income_entries WHERE id=?").run(Number(id));
  return json({ message: "Income deleted" });
});
