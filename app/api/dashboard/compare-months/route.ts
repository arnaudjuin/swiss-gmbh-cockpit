import { guard, json } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";

function statsFor(monthStr: string) {
  const [year, m] = monthStr.split("-").map(Number);
  const rev = (db().prepare(
    "SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND month=? AND hours>0").get(year, m) as any).t;
  const inc = (db().prepare(
    "SELECT COALESCE(SUM(amount),0) as t FROM income_entries WHERE substr(income_date,1,7)=?").get(monthStr) as any).t;
  const bills = (db().prepare(
    "SELECT COALESCE(SUM(amount),0) as t FROM company_docs WHERE substr(doc_date,1,7)=?").get(monthStr) as any).t;
  const obs = (db().prepare(
    "SELECT COALESCE(SUM(amount),0) as t FROM obligations WHERE substr(due_date,1,7)=?").get(monthStr) as any).t;
  return { income: rev + inc, costs: bills + obs, net: (rev + inc) - (bills + obs) };
}

const diff = (a: number, b: number) => ({
  absolute: round2(a - b),
  pct: b ? Math.round((a - b) / b * 1000) / 10 : null,
});

export const GET = guard(async () => {
  const today = todayISO();
  const [y, m] = today.split("-").map(Number);
  const thisMonth = today.slice(0, 7);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const t = statsFor(thisMonth), l = statsFor(lastMonth);
  return json({
    this_month: { label: thisMonth, ...t },
    last_month: { label: lastMonth, ...l },
    diff: {
      income: diff(t.income, l.income),
      costs: diff(t.costs, l.costs),
      net: diff(t.net, l.net),
    },
  });
});
