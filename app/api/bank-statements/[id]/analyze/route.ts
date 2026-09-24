import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { analyzeStatement } from "@/server/bankAnalyze";

export const POST = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const data = analyzeStatement(Number(id));
  if ("notFound" in data) return err(404, "Statement not found");
  return json(data);
});
