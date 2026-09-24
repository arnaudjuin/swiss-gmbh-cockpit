"use client";
import { useEffect, useState } from "react";
import { api, type Overview, type Reserve, type Runway, type Forecast, type PayrollPreview } from "@/lib/api";
import { loadPrefs, pref, divTax } from "@/lib/prefs";
import { chf } from "@/lib/money";
import { Stat, ChartCard, Legend, Meter } from "@/components/ui";
import RecapStrip from "@/components/RecapStrip";
import DashboardConfig, { activeWidgets } from "@/components/DashboardConfig";
import { IncomeCostsChart, ForecastChart, CategoryBars } from "@/components/charts";
import { vizToken } from "@/lib/money";

interface DividendYear { fiscalYear: number; startMonth: number; amounts: number[] }
interface UpcomingItem { id: number; kind: string; title: string; amount: number; due_date: string; overdue: boolean }
interface Anomaly { bill_id: number; vendor: string; current_amount: number; expected_mean: number; message: string; severity: string }
interface BankLatest { present: boolean; bank?: string; account_label?: string; currency?: string; closing_balance?: number; period_end?: string }

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
  const dt = divTax(prefs);
  const eff = dt.fedIncl * ((saved.fedRatePct ?? 12) / 100) + dt.cantIncl * ((saved.cantRatePct ?? 21.5) / 100);
  return { gross, net: gross - gross * eff, monthly: monthlyAmt, months, payout: `Jun ${fy + 1}` };
}

function daysUntilLocal(dStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

export default function Dashboard() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [dividends, setDividends] = useState<ReturnType<typeof dividendSummary>>(null);
  const [payroll, setPayroll] = useState<PayrollPreview | null>(null);
  const [upcomingObs, setUpcomingObs] = useState<UpcomingItem[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [bank, setBank] = useState<BankLatest | null>(null);
  const [range, setRange] = useState("ytd");
  const [error, setError] = useState("");
  const [prefs, setPrefs] = useState<Record<string, unknown> | null>(null);
  const [visible, setVisible] = useState<Set<string> | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const y0 = new Date().getFullYear();
  const [plYear, setPlYear] = useState(y0);
  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "";

  useEffect(() => {
    (async () => {
      try {
        const prefs = await loadPrefs();
        setPrefs(prefs);
        setVisible(activeWidgets(prefs));
        const savedRange = pref(prefs, "dashboard.range", "ytd");
        setRange(savedRange);
        const [o, r, rw, fc, pay, up, an, bk] = await Promise.all([
          api<Overview>(`/dashboard/overview?range=${encodeURIComponent(savedRange)}`),
          api<Reserve[]>("/reserves").catch(() => []),
          api<Runway>("/runway").catch(() => null),
          api<Forecast>("/finance/forecast").catch(() => null),
          api<PayrollPreview>("/payroll/preview").catch(() => null),
          api<{ items: UpcomingItem[] }>("/upcoming-payments?days=60").catch(() => ({ items: [] as UpcomingItem[] })),
          api<{ items: Anomaly[] }>("/anomalies").catch(() => ({ items: [] as Anomaly[] })),
          api<BankLatest>("/bank-statements/latest").catch(() => null),
        ]);
        setOv(o); setReserves(r); setRunway(rw); setForecast(fc);
        setPayroll(pay);
        setUpcomingObs((up.items || []).filter(i => i.kind === "obligation").slice(0, 3));
        setAnomalies(an.items || []);
        setBank(bk);
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

  // A tile/section is shown unless the user turned it off in Customize.
  const show = (id: string) => !visible || visible.has(id);
  // Per-tile width from the saved layout (1 = Normal, 2 = Wide, 3 = Full) — the
  // classic reads dashboard.widgetSettings.<id>.size and spans the grid.
  const wsettings = pref<Record<string, { size?: number }>>(prefs ?? {}, "dashboard.widgetSettings", {}) || {};
  const sz = (id: string) => { const s = wsettings[id]?.size; return typeof s === "number" ? s : 1; };

  const inc = ov.income, c = ov.costs, pr = ov.profit;
  const ink = () => vizToken("--text");
  const invoicedMonths = (ov as Overview & { monthly_series?: unknown[] }).monthly_series?.length ?? ov.monthly_pl.length;

  // Net salary stat (from /payroll/preview)
  const calc = payroll?.calculation ?? null;

  // Next obligations due stat (from /upcoming-payments)
  const obsTotal = upcomingObs.reduce((s, o) => s + (o.amount || 0), 0);
  const anyObsOverdue = upcomingObs.some(o => o.overdue);

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="btn-group">
          <select className="control" value={range} onChange={e => reload(e.target.value)} style={{ width: "auto" }}>
            <option value="ytd">Year to date</option>
            <option value="month">This month</option>
            <option value="30d">Last 30 days</option>
            <option value="12m">Last 12 months</option>
            <option value="year">This year</option>
            <option value="prev_year">Last year</option>
            <option value="all">All time</option>
          </select>
          <select className="control" value={plYear} aria-label="P&L report year"
            onChange={e => setPlYear(parseInt(e.target.value, 10))} style={{ width: "auto" }}>
            {[y0, y0 - 1, y0 - 2, y0 - 3].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <a className="btn btn--outline" href={`/api/reports/pl/${plYear}/excel?token=${encodeURIComponent(token)}`}>
            P&amp;L Report
          </a>
          <button type="button" className="btn btn--outline" onClick={() => setShowConfig(true)}>Customize</button>
        </div>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        Showing: {ov.range.label} · {ov.range.start} → {ov.range.end}
      </div>

      <div className="stats-grid">
        {show("income-ytd") && <Stat span={sz("income-ytd")} label="Total Income" value={chf(inc.total_ytd)} mod="ok"
          hint={`Invoiced ${chf(inc.invoiced_net_ytd)} net of VAT${inc.other_ytd > 0 ? ` + other ${chf(inc.other_ytd)}` : ""} · cash received ${chf(inc.cash_received_ytd)}`} />}
        {show("costs-ytd") && <Stat span={sz("costs-ytd")} label="Total Costs" value={chf(c.total_ytd)} mod="danger"
          hint={`Bills ${chf(c.bills_ytd)} + Payroll ${chf(c.payroll_ytd)} — accrual, matches Reports → P&L`} />}
        {show("profit-ytd") && <Stat span={sz("profit-ytd")} label="Net Profit" value={chf(pr.ytd)} mod={pr.ytd >= 0 ? "ok" : "danger"} />}
        {show("profit-margin") && <Stat span={sz("profit-margin")} label="Profit Margin" value={`${pr.margin_pct}%`} mod="info" />}
        {show("avg-monthly-rev") && <Stat span={sz("avg-monthly-rev")} label="Avg Monthly Revenue" value={chf(ov.invoices.avg_monthly_revenue)}
          hint={`Across ${invoicedMonths} invoiced months`} />}
        {show("avg-monthly-hours") && <Stat span={sz("avg-monthly-hours")} label="Avg Monthly Hours" value={ov.invoices.avg_monthly_hours.toFixed(1)}
          hint={`Across ${invoicedMonths} invoiced months`} />}
        {show("overdue") && <Stat span={sz("overdue")} label="Overdue" value={chf(ov.upcoming.overdue_total)}
          mod={ov.upcoming.overdue_total > 0 ? "danger" : null} />}
        {show("upcoming-30d") && <Stat span={sz("upcoming-30d")} label="Due Next 30 Days" value={chf(ov.upcoming.due_30d)} mod="warn" />}
        {show("net-salary") && <Stat span={sz("net-salary")} label="Net Salary (monthly)" value={calc ? chf(calc.net_salary) : "—"} mod={calc ? "info" : null}
          hint={calc ? `Gross ${chf(calc.gross)} − contrib ${chf(calc.emp_total_deductions)} − tax ${chf(calc.emp_source_tax)}` : "Set up payroll to see net salary"} />}
        {show("upcoming-obligations") && (upcomingObs.length > 0
          ? <Stat span={sz("upcoming-obligations")} label={`Next ${upcomingObs.length} Obligations Due`} value={chf(obsTotal)} mod={anyObsOverdue ? "danger" : "warn"}
              hint={<>{upcomingObs.map((o, i) => {
                const dd = daysUntilLocal(o.due_date);
                const lbl = dd < 0 ? `${Math.abs(dd)}d overdue` : dd === 0 ? "today" : `in ${dd}d`;
                return <span key={i} style={{ display: "block" }}>
                  {o.title.length > 20 ? o.title.slice(0, 18) + "…" : o.title}
                  {" "}<span style={{ color: "var(--text-muted)" }}>· {chf(o.amount)}</span>{" "}
                  <span style={{ fontWeight: 600, color: dd < 0 ? "var(--danger-text)" : dd <= 7 ? "var(--warn-text)" : "var(--text-muted)" }}>{lbl}</span>
                </span>;
              })}</>} />
          : <Stat label="Next Obligations Due" value="—" hint="No obligations due in the next 60 days" />)}
      </div>

      {show("recap-strip") && <RecapStrip ov={ov} reserves={reserves} runway={runway} forecast={forecast} dividends={dividends} />}

      {show("bank-balance") && bank?.present && (
        <div className="table-card" style={{ padding: "12px 14px", margin: "18px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
          <div>
            <div className="hint">Latest bank balance — {bank.bank} {bank.account_label || ""}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{bank.currency} {chf(bank.closing_balance)}</div>
            <div className="hint hint--sm">As of {bank.period_end}</div>
          </div>
        </div>
      )}

      {show("reserves-detail") && reserves.length > 0 && (
        <div className="table-card" style={{ padding: 0, margin: "18px 0" }}>
          <div className="row-split" style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Reserves / Sinking Funds</h3>
            <span className="hint">
              accrued <b style={{ color: "var(--text)" }}>{chf(reserves.reduce((s, r) => s + r.accumulated, 0))}</b> of{" "}
              {chf(reserves.reduce((s, r) => s + r.target_amount, 0))} · monthly accrual{" "}
              <b style={{ color: "var(--text)" }}>{chf(reserves.reduce((s, r) => s + r.monthly_accrual, 0))}</b>
            </span>
          </div>
          {reserves.map(r => {
            const pct = Math.min(100, r.progress_pct || 0);
            const due = r.target_date ? new Date(r.target_date) : null;
            const overdue = !!due && due < new Date() && r.remaining > 0.5;
            return (
              <div key={r.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <div className="row-split" style={{ alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  <span className="hint">
                    target {chf(r.target_amount)} · due {due ? due.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
                    {overdue && <span className="t-danger" style={{ fontWeight: 600 }}> overdue</span>}
                  </span>
                </div>
                {r.purpose && <div className="hint hint--sm" style={{ margin: "2px 0 6px" }}>{r.purpose}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Meter pct={pct} mod={overdue ? "danger" : pct >= 95 ? "ok" : undefined} />
                  </div>
                  <span className="money hint" style={{ whiteSpace: "nowrap" }}>
                    <b style={{ color: "var(--text)" }}>{chf(r.accumulated)}</b> / {chf(r.target_amount)} · +{chf(r.monthly_accrual)}/mo
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {show("revenue-chart") && (
        <ChartCard title={`Income vs Costs · ${ov.monthly_pl[0]?.year ?? ov.year}`}
          legend={<Legend items={[
            { label: "Income", color: "var(--viz-income)" },
            { label: "Costs", color: "var(--viz-costs)" },
            { label: "Profit", color: ink(), line: true }]} />}>
          <IncomeCostsChart months={ov.monthly_pl} />
        </ChartCard>
      )}

      {show("forecast-chart") && forecast && forecast.months.length > 0 && (
        <ChartCard title={`Cash forecast · ${forecast.year}`}
          legend={<Legend items={[
            { label: "Income", color: "var(--viz-income)" },
            { label: "Outflow", color: "var(--viz-costs)" },
            { label: "Cash at end", color: ink(), line: true }]} />}>
          <ForecastChart months={forecast.months} />
        </ChartCard>
      )}

      {show("cost-breakdown") && c.by_category.length > 0 && (
        <ChartCard title={`Costs by Category · ${ov.range.label}`} height={240}>
          <CategoryBars byCategory={c.by_category} />
        </ChartCard>
      )}

      {show("recent-invoices") && (
      <div className="table-card">
        <div className="table-header"><h3>Recent Invoices</h3></div>
        <table>
          <thead><tr><th>#</th><th>Period</th><th>Hours</th><th className="text-right">Total</th><th>Status</th></tr></thead>
          <tbody>
            {ov.recent_invoices.slice(0, 5).map(i => {
              const overdue = i.paid_status !== "paid" && !!i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
              return (
                <tr key={i.id}>
                  <td className="mono">#{String(i.invoice_number).padStart(4, "0")}</td>
                  <td>{i.month_name} {i.year}</td>
                  <td>{i.hours}</td>
                  <td className="money">{chf(i.total)}</td>
                  <td><span className={`chip chip--sm ${i.paid_status === "paid" ? "chip--ok" : overdue ? "chip--danger" : "chip--warn"}`}>
                    {i.paid_status === "paid" ? "Paid" : overdue ? "Overdue" : "Unpaid"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {show("anomalies") && anomalies.length > 0 && (
        <div className="table-card" style={{ marginTop: 18 }}>
          <div className="table-header">
            <h3>⚠ Anomalies — bills that deviate from usual amount</h3>
            <span className="hint">{anomalies.length} flagged</span>
          </div>
          <table>
            <thead><tr><th>Vendor / Detail</th><th className="text-right">Current vs Avg</th></tr></thead>
            <tbody>
              {anomalies.slice(0, 8).map(a => (
                <tr key={a.bill_id}>
                  <td><strong>{a.vendor}</strong><div className="hint hint--sm">{a.message}</div></td>
                  <td className="money text-right" style={{ color: a.severity === "high" ? "var(--danger-text)" : "var(--warn-text)" }}>
                    {chf(a.current_amount)}<div className="hint hint--sm">vs avg {chf(a.expected_mean)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showConfig && prefs && (
        <DashboardConfig prefs={prefs} onClose={() => setShowConfig(false)} onSaved={setVisible} />
      )}
    </div>
  );
}
