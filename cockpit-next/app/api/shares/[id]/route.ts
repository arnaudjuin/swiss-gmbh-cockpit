import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  db().prepare("DELETE FROM shared_links WHERE id=?").run(Number(id));
  return json({ message: "Share link deleted" });
});
