import { NextRequest } from "next/server";
import { guard, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, serveFile } from "@/server/files";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT scan_file FROM expenses WHERE id = ?").get(Number(id));
  if (!row || !row.scan_file) return err(404, "No scan found");
  return serveFile(DIRS.scans, row.scan_file);
});
