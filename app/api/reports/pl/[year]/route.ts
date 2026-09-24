import { guard, json } from "@/server/http";
import { plReport } from "@/server/pl";

export const GET = guard(async (_req, ctx: { params: Promise<{ year: string }> }) => {
  const { year } = await ctx.params;
  return json(plReport(Number(year)));
});
