import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2 } from "@/server/db";

const fetchTotals = (): Map<number, { count: number; total: number }> => {
  const rows: any[] = db().prepare(
    "SELECT trip_id, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM expenses WHERE trip_id IS NOT NULL GROUP BY trip_id").all();
  return new Map(rows.map(r => [r.trip_id, { count: r.n, total: Number(r.total || 0) }]));
};
const tripToDict = (r: any, totals: Map<number, { count: number; total: number }>) => {
  const t = totals.get(r.id) ?? { count: 0, total: 0 };
  return {
    id: r.id, name: r.name, purpose: r.purpose, start_date: r.start_date,
    end_date: r.end_date, countries: r.countries, notes: r.notes,
    is_active: !!r.is_active, expense_count: t.count, total_chf: round2(t.total),
  };
};

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM trips WHERE id=?").get(Number(id));
  if (!row) return err(404, "Trip not found");
  return json(tripToDict(row, fetchTotals()));
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM trips WHERE id=?").get(Number(id))) return err(404, "Trip not found");
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const isActive = s("is_active", "1").trim() === "" ? 1 : Number(s("is_active", "1"));
  db().prepare(
    `UPDATE trips SET name=?, purpose=?, start_date=?, end_date=?,
       countries=?, notes=?, is_active=?, updated_at=datetime('now') WHERE id=?`
  ).run(s("name"), s("purpose"), s("start_date"), s("end_date"), s("countries"), s("notes"), isActive, Number(id));
  return json({ message: "Trip updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM trips WHERE id=?").get(Number(id))) return err(404, "Trip not found");
  // Detach all expenses (trip_id=NULL), then remove the trip.
  db().prepare("UPDATE expenses SET trip_id=NULL WHERE trip_id=?").run(Number(id));
  db().prepare("DELETE FROM trips WHERE id=?").run(Number(id));
  return json({ message: "Trip deleted" });
});
