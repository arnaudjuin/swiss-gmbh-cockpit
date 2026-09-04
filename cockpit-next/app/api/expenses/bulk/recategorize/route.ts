import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

const VALID = new Set(["Meals", "Transport", "Accommodation", "Other"]);

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  if (!VALID.has(body.category)) return err(400, `Invalid category: ${body.category}`);
  const ids: number[] = body.ids ?? [];
  for (const eid of ids) db().prepare("UPDATE expenses SET category=? WHERE id=?").run(body.category, eid);
  return json({ updated: ids.length });
});
