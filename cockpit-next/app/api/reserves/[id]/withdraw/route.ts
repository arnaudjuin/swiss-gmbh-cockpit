import { NextRequest } from "next/server";
import { guard } from "@/server/http";
import { reserveMove } from "@/server/reserveMove";
export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  reserveMove(req, (await ctx.params).id, "withdraw"));
