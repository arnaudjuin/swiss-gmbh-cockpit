import { NextRequest, NextResponse } from "next/server";
import { guard, err } from "@/server/http";
import { buildBankXlsx } from "@/server/bankXlsx";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const p = req.nextUrl.searchParams;
  const quarter = p.get("quarter") ? Number(p.get("quarter")) : null;
  const year = p.get("year") ? Number(p.get("year")) : null;
  const result = await buildBankXlsx(Number(id), quarter, year);
  if ("error" in result) return err(result.status, result.error);
  return new NextResponse(new Uint8Array(result.buf), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${result.filename}"`,
  } });
});
