import { guard, json } from "@/server/http";
import { db, MONTH_ABBR } from "@/server/db";

export const GET = guard(async () => {
  const stats: any = db().prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(hours), 0) as hours
     FROM invoices WHERE hours > 0`).get();
  const monthly: any[] = db().prepare(
    `SELECT year, month, SUM(total) as revenue, SUM(hours) as hours
     FROM invoices WHERE hours > 0 GROUP BY year, month ORDER BY year, month`).all();
  const n = monthly.length;
  return json({
    total_revenue: stats.revenue,
    invoice_count: stats.count,
    average_monthly_revenue: n ? stats.revenue / n : 0,
    average_monthly_hours: n ? stats.hours / n : 0,
    total_hours: stats.hours,
    monthly_data: monthly.map(r => ({
      label: `${MONTH_ABBR[r.month]} ${r.year}`, revenue: r.revenue, hours: r.hours,
    })),
  });
});
