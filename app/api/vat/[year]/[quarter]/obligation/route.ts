import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { createVatObligation } from "@/server/vat";

// POST /api/vat/{year}/{quarter}/obligation — mirror of create_vat_obligation.
// Creates (or refreshes) the quarterly VAT obligation so it shows up in
// Obligations and the Calendar. Refuses to touch a paid obligation.
export const POST = guard(async (_req: NextRequest, ctx: any) => {
  const p = await ctx.params;
  const year = Number(p.year), quarter = Number(p.quarter);
  if (quarter < 1 || quarter > 4) return err(400, "Quarter must be 1-4");
  const r = createVatObligation(db(), year, quarter);
  if (!r.ok) return err(r.status, r.detail);
  return json({ id: r.id, updated: r.updated, amount: r.amount });
});
