import { NextRequest } from "next/server";
import { requireAuth } from "@/server/http";
import { db } from "@/server/db";
import { serveFile, DIRS } from "@/server/files";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const row = db().prepare("SELECT statement_file_pdf FROM bank_statements WHERE id=?").get(id) as any;
  return serveFile(DIRS.bank, row?.statement_file_pdf);
}
