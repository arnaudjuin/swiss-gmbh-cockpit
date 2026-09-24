import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";

const fmt2 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const GET = guard(async () => {
  // Bills that significantly deviate from their vendor's historical average.
  const vendors: any[] = db().prepare(
    "SELECT vendor, COUNT(*) as cnt FROM company_docs GROUP BY vendor HAVING cnt >= 3").all();
  const anomalies: any[] = [];
  for (const v of vendors) {
    const history: any[] = db().prepare(
      "SELECT id, doc_date, amount, status, description FROM company_docs WHERE vendor=? ORDER BY doc_date DESC"
    ).all(v.vendor);
    if (history.length && (history[0].description || "").includes("[anomaly-reviewed]")) continue;
    if (history.length < 3) continue;
    const mostRecent = history[0];
    const previous: number[] = history.slice(1).map(h => h.amount);
    if (!previous.length) continue;

    const mean = previous.reduce((s, x) => s + x, 0) / previous.length;
    // statistics.stdev = sample standard deviation (n − 1)
    const stdev = previous.length > 1
      ? Math.sqrt(previous.reduce((s, x) => s + (x - mean) ** 2, 0) / (previous.length - 1))
      : 0;
    const current = mostRecent.amount;
    const diff = current - mean;
    const pct = mean ? diff / mean * 100 : 0;

    if (Math.abs(pct) >= 20 && Math.abs(diff) >= 10) {
      anomalies.push({
        bill_id: mostRecent.id,
        vendor: v.vendor,
        current_amount: current,
        expected_mean: round2(mean),
        stdev: stdev ? round2(stdev) : 0,
        deviation_chf: round2(diff),
        deviation_pct: Math.round(pct * 10) / 10,
        doc_date: mostRecent.doc_date,
        history_count: previous.length,
        severity: Math.abs(pct) >= 50 ? "high" : "medium",
        direction: diff > 0 ? "over" : "under",
        message: `${v.vendor} usually CHF ${fmt2(mean)} (based on ${previous.length} bills) ` +
          `but this one is CHF ${fmt2(current)} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%) on ${mostRecent.doc_date}.`,
      });
    }
  }
  anomalies.sort((a, b) => Math.abs(b.deviation_chf) - Math.abs(a.deviation_chf));
  return json({ count: anomalies.length, items: anomalies });
});
