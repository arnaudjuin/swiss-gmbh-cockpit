import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const PATCH = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const status = body.status;
  if (status !== "paid" && status !== "unpaid") return err(400, "Status must be 'paid' or 'unpaid'");
  if (!db().prepare("SELECT id FROM company_docs WHERE id=?").get(Number(id))) return err(404, "Document not found");
  db().prepare("UPDATE company_docs SET status=? WHERE id=?").run(status, Number(id));
  return json({ message: `Status set to ${status}` });
});
