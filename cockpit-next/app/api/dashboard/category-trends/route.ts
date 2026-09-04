import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";

export const GET = guard(async (req: NextRequest) => {
  const months = Number(req.nextUrl.searchParams.get("months") || 6);
  const today = todayISO();
  let [y, m] = today.split("-").map(Number);
  const periods: string[] = [];
  for (let i = 0; i < months; i++) {
    periods.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  periods.reverse();

  const rows: any[] = db().prepare("SELECT * FROM company_docs WHERE doc_date >= ?").all(periods[0] + "-01");
  const byCat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const month = (r.doc_date as string).slice(0, 7);
    if (!byCat.has(r.category)) byCat.set(r.category, new Map(periods.map(p => [p, 0])));
    const series = byCat.get(r.category)!;
    if (series.has(month)) series.set(month, series.get(month)! + r.amount);
  }
  const total = (cat: string) => [...byCat.get(cat)!.values()].reduce((s, v) => s + v, 0);
  const cats = [...byCat.keys()].sort((a, b) => total(b) - total(a));
  return json({
    periods,
    categories: cats.map(cat => ({
      category: cat,
      series: periods.map(p => round2(byCat.get(cat)!.get(p)!)),
      total: total(cat),
    })),
  });
});
