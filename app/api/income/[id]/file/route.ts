import { NextRequest } from "next/server";
import { guard, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, serveFile } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT doc_file FROM income_entries WHERE id=?").get(Number(id));
  if (!row) return err(404, "Not found");
  return serveFile(DIRS.accounting, row.doc_file);
});
