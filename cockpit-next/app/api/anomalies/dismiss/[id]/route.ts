import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const POST = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT description FROM company_docs WHERE id=?").get(Number(id));
  if (!row) return err(404, "Not found");
  db().prepare("UPDATE company_docs SET description=? WHERE id=?")
    .run((row.description || "") + " [anomaly-reviewed]", Number(id));
  return json({ message: "Anomaly dismissed" });
});
