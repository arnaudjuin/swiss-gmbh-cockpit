import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { loadVatSettings, vatQuarterData } from "@/server/vat";

// GET /api/vat/{year}/{quarter} — mirror of vat_quarter. Q1=1-3 … Q4=10-12.
export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const p = await ctx.params;
  const year = Number(p.year), quarter = Number(p.quarter);
  if (quarter < 1 || quarter > 4) return err(400, "Quarter must be 1-4");
  const d = db();
  const settings = loadVatSettings(d);
  return json(vatQuarterData(d, year, quarter, settings));
});
