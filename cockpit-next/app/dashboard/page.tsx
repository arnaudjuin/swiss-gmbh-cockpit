"use client";
import { useEffect, useState } from "react";
import { api, type Overview, type Reserve, type Runway, type Forecast } from "@/lib/api";
import { loadPrefs, pref } from "@/lib/prefs";
import { chf } from "@/lib/money";
import { Stat, ChartCard, Legend, Meter } from "@/components/ui";
import RecapStrip from "@/components/RecapStrip";
import { IncomeCostsChart, ForecastChart, CategoryBars } from "@/components/charts";
import { vizToken } from "@/lib/money";

interface DividendYear { fiscalYear: number; startMonth: number; amounts: number[] }

// FY summary from the saved dividend plan — mirrors divSummaryFromPrefs().
function dividendSummary(prefs: Record<string, unknown>) {
  const saved = pref<{ years?: DividendYear[]; fedRatePct?: number; cantRatePct?: number } | null>(prefs, "dividends", null);
  if (!saved?.years?.length) return null;
  const fy = new Date().getFullYear();
  const y = saved.years.find(x => x.fiscalYear === fy);
  if (!y) return null;
  const months = 12 - Math.max(1, Math.min(12, y.startMonth || 1)) + 1;
  const monthlyAmt = (y.amounts || []).reduce((s, a) => s + (Number(a) || 0), 0);
  const gross = monthlyAmt * months;
  const eff = 0.7 * ((saved.fedRatePct ?? 12) / 100) + 0.5 * ((saved.cantRatePct ?? 21.5) / 100);
  return { gross, net: gross - gross * eff, monthly: monthlyAmt, months, payout: `Jun ${fy + 1}` };
}

export default function Dashboard() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [dividends, setDividends] = useState<ReturnType<typeof dividendSummary>>(null);
  const [range, setRange] = useState("ytd");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const prefs = await loadPrefs();
        const savedRange = pref(prefs, "dashboard.range", "ytd");
        setRange(savedRange);
        const [o, r, rw, fc] = await Promise.all([
          api<Overview>(`/dashboard/overview?range=${encodeURIComponent(savedRange)}`),
          api<Reserve[]>("/reserves").catch(() => []),
          api<Runway>("/runway").catch(() => null),
          api<Forecast>("/finance/forecast").catch(() => null),
        ]);
        setOv(o); setReserves(r); setRunway(rw); setForecast(fc);
        setDividends(dividendSummary(prefs));
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  const reload = async (key: string) => {
    setRange(key);
    setOv(await api<Overview>(`/dashboard/overview?range=${encodeURIComponent(key)}`));
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!ov) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const inc = ov.income, c = ov.costs, pr = ov.profit;
  const ink = () => vizToken("--text");

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="btn-group">
          <select className="control" value={range} onChange={e => reload(e.target.value)} style={{ width: "auto" }}>
            <option value="ytd">Year to date</option>
            <option value="month">This month</option>
            <option value="12m">Last 12 months</option>
            <option value="prev_year">Last year</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        Showing: {ov.range.label} · {ov.range.start} → {ov.range.end}
      </div>

      <div className="stats-grid">
        <Stat label="Total Income" value={chf(inc.total_ytd)} mod="ok"
          hint={`Invoiced ${chf(inc.invoiced_net_ytd)} net of VAT · cash received ${chf(inc.cash_received_ytd)}`} />
        <Stat label="Total Costs" value={chf(c.total_ytd)} mod="danger"
          hint={`Bills ${chf(c.bills_ytd)} + Payroll ${chf(c.payroll_ytd)} — accrual, matches Reports → P&L`} />
        <Stat label="Net Profit" value={chf(pr.ytd)} mod={pr.ytd >= 0 ? "ok" : "danger"} />
        <Stat label="Profit Margin" value={`${pr.margin_pct}%`} mod="info" />
        <Stat label="Overdue" value={chf(ov.upcoming.overdue_total)}
          mod={ov.upcoming.overdue_total > 0 ? "danger" : null} />
        <Stat label="Due Next 30 Days" value={chf(ov.upcoming.due_30d)} mod="warn" />
      </div>

      <RecapStrip ov={ov} reserves={reserves} runway={runway} forecast={forecast} dividends={dividends} />

      {reserves.length > 0 && (
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 18 }}>
          <div className="row-split" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Reserves</h3>
            <span className="hint">
              accrued <b>{chf(reserves.reduce((s, r) => s + r.accumulated, 0))}</b> of{" "}
              {chf(reserves.reduce((s, r) => s + r.target_amount, 0))}
            </span>
          </div>
          {reserves.map(r => (
            <div key={r.id} style={{ padding: "6px 0" }}>
              <div className="row-split">
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span className="hint">{chf(r.accumulated)} / {chf(r.target_amount)} · +{chf(r.monthly_accrual)}/mo</span>
              </div>
              <Meter pct={r.progress_pct} mod={r.progress_pct >= 95 ? "ok" : undefined} />
            </div>
          ))}
        </div>
      )}

      <ChartCard title={`Income vs Costs · ${ov.monthly_pl[0]?.year ?? ov.year}`}
        legend={<Legend items={[
          { label: "Income", color: "var(--viz-income)" },
          { label: "Costs", color: "var(--viz-costs)" },
          { label: "Profit", color: ink(), line: true }]} />}>
        <IncomeCostsChart months={ov.monthly_pl} />
      </ChartCard>

      {forecast && forecast.months.length > 0 && (
        <ChartCard title={`Cash forecast · ${forecast.year}`}
          legend={<Legend items={[
            { label: "Income", color: "var(--viz-income)" },
            { label: "Outflow", color: "var(--viz-costs)" },
            { label: "Cash at end", color: ink(), line: true }]} />}>
          <ForecastChart months={forecast.months} />
        </ChartCard>
      )}

      {c.by_category.length > 0 && (
        <ChartCard title={`Costs by Category · ${ov.range.label}`} height={240}>
          <CategoryBars byCategory={c.by_category} />
        </ChartCard>
      )}

      <div className="table-card">
        <div className="table-header"><h3>Recent Invoices</h3></div>
        <table>
          <thead><tr><th>#</th><th>Period</th><th>Hours</th><th className="text-right">Total</th><th>Status</th></tr></thead>
          <tbody>
            {ov.recent_invoices.slice(0, 5).map(i => (
              <tr key={i.id}>
                <td className="mono">#{String(i.invoice_number).padStart(4, "0")}</td>
                <td>{i.month_name} {i.year}</td>
                <td>{i.hours}</td>
                <td className="money">{chf(i.total)}</td>
                <td><span className={`chip chip--sm ${i.paid_status === "paid" ? "chip--ok" : "chip--warn"}`}>
                  {i.paid_status === "paid" ? "Paid" : "Unpaid"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
