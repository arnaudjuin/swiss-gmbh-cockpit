import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const POST = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const trip: any = db().prepare("SELECT * FROM trips WHERE id=?").get(Number(id));
  if (!trip) return err(404, "Trip not found");
  const result = db().prepare(
    "UPDATE expenses SET trip_id=? WHERE trip_id IS NULL AND expense_date BETWEEN ? AND ?"
  ).run(Number(id), trip.start_date, trip.end_date);
  return json({ assigned: result.changes });
});
