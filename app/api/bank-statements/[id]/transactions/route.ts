import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { listTransactions } from "@/server/bankTx";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const data = listTransactions(Number(id));
  if ("notFound" in data) return err(404, "Statement not found");
  return json(data);
});
