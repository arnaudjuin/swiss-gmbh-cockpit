import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/server/http";
import { contentDisposition } from "@/server/files";
import { buildAccountantPackage } from "@/server/accountantPackage";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { year } = await ctx.params;
  const { buf, filename } = await buildAccountantPackage(Number(year));
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(filename),
  } });
});
