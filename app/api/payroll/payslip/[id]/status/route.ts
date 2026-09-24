import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const PATCH = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const status = body.status;
  if (status !== "issued" && status !== "paid") return err(400, "Invalid status");
  db().prepare("UPDATE payslips SET status=? WHERE id=?").run(status, Number(id));
  return json({ message: `Set to ${status}` });
});
