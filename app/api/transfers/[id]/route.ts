import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { deleteStored, DIRS } from "@/server/files";

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT doc_file FROM account_transfers WHERE id=?").get(id) as any;
  if (!row) return err(404, "Transfer not found");
  deleteStored(DIRS.accounting, row.doc_file);
  db().prepare("DELETE FROM account_transfers WHERE id=?").run(id);
  return json({ message: "Transfer deleted" });
});
