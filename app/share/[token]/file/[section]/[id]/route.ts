import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { DIRS, serveFile } from "@/server/files";
import { pub } from "@/server/pub";

const notFound = (msg: string) => NextResponse.json({ detail: msg }, { status: 404 });

export const GET = pub(async (_req: NextRequest, ctx: any) => {
  const { token, section, id } = await ctx.params;
  const link: any = db().prepare("SELECT * FROM shared_links WHERE token=?").get(token);
  if (!link || link.section !== section) return notFound("Not found");
  if (section === "accounting") {
    const row: any = db().prepare("SELECT doc_file FROM company_docs WHERE id=?").get(Number(id));
    if (!row || !row.doc_file) return notFound("File not found");
    return serveFile(DIRS.accounting, row.doc_file);
  }
  const row: any = db().prepare("SELECT scan_file FROM expenses WHERE id=?").get(Number(id));
  if (!row || !row.scan_file) return notFound("File not found");
  return serveFile(DIRS.scans, row.scan_file);
});
