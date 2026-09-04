import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { contentDisposition } from "@/server/files";
import { buildAccountantPackage } from "@/server/accountantPackage";
import { pub } from "@/server/pub";

export const GET = pub(async (_req: NextRequest, ctx: any) => {
  const { token } = await ctx.params;
  const link: any = db().prepare("SELECT * FROM shared_links WHERE token=?").get(token);
  if (!link || link.section !== "accounting")
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const { buf, filename } = await buildAccountantPackage(link.year);
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(filename),
  } });
});
