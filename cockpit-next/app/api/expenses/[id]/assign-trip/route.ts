import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const POST = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM expenses WHERE id=?").get(Number(id))) return err(404, "Expense not found");
  const form = await req.formData();
  const raw = form.get("trip_id");
  const tripId = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
  if (tripId != null && !db().prepare("SELECT 1 FROM trips WHERE id=?").get(tripId)) return err(404, "Trip not found");
  db().prepare("UPDATE expenses SET trip_id=? WHERE id=?").run(tripId, Number(id));
  return json({ message: "Updated" });
});
