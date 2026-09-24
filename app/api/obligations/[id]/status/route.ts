import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const PATCH = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.status !== "paid" && body.status !== "unpaid") return err(400, "Invalid status");
  db().prepare("UPDATE obligations SET status=? WHERE id=?").run(body.status, id);
  return json({ message: "Updated" });
});
