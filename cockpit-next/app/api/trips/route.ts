import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
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

export const GET = guard(async () => {
  const rows: any[] = db().prepare("SELECT * FROM trips WHERE is_active=1 ORDER BY start_date DESC").all();
  const totals = fetchTotals();
  return json(rows.map(r => tripToDict(r, totals)));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const cur = db().prepare(
    "INSERT INTO trips (name, purpose, start_date, end_date, countries, notes) VALUES (?,?,?,?,?,?)"
  ).run(s("name"), s("purpose"), s("start_date"), s("end_date"), s("countries"), s("notes"));
  return json({ id: Number(cur.lastInsertRowid) });
});
