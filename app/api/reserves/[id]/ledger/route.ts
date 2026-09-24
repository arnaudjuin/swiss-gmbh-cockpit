import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return json(db().prepare("SELECT * FROM reserve_ledger WHERE reserve_id=? ORDER BY entry_date DESC, id DESC").all(id));
});
