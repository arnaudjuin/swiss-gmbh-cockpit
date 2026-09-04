"use client";
// Forecast — port of the classic page (static/js/05-accounting.js).
// One cash lens: bank balance + income − salary − obligations (payable date)
// − bills − Cash Allocation pot accruals, per calendar year.
import { useCallback, useEffect, useState } from "react";
import { api, type Forecast } from "@/lib/api";
import { loadPrefs, pref, setPref } from "@/lib/prefs";
import { chf, vizToken } from "@/lib/money";
import { Stat, ChartCard, Legend } from "@/components/ui";
import { ForecastChart } from "@/components/charts";

async function fetchForecast(): Promise<Forecast> {
  const prefs = await loadPrefs();
  const year = pref<number>(prefs, "forecast.year", new Date().getFullYear());
  const inc = pref<number | null>(prefs, "forecast.income", null);
  const byMonth = pref<Record<string, number>>(prefs, "forecast.incomeByMonth", {});
  const incomes = Object.entries(byMonth)
    .filter(([, v]) => Number.isFinite(Number(v)))
    .map(([k, v]) => `${k}:${Number(v)}`).join(",");
  return api<Forecast>(
    `/finance/forecast?year=${year}` +
    (inc != null ? `&income=${inc}` : "") +
    (incomes ? `&incomes=${encodeURIComponent(incomes)}` : ""));
}

export default function ForecastPage() {
  const [fc, setFc] = useState<Forecast | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    fetchForecast().then(setFc).catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!fc) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const low = fc.lowest ?? { label: "—", cash_end: fc.opening };
  const lowMod = low.cash_end < 0 ? "danger" : low.cash_end < fc.payroll_net ? "warn" : "ok";
  const avgOut = fc.months.length ? fc.months.reduce((s, m) => s + m.out, 0) / fc.months.length : 0;
  const y0 = new Date().getFullYear();

  const setIncome = async (v: string) => {
    const n = parseFloat(v);
    await setPref("forecast.income", Number.isFinite(n) && n >= 0 ? n : null);
    reload();
  };
  const setYear = async (v: string) => { await setPref("forecast.year", parseInt(v, 10) || y0); reload(); };
  const setMonthIncome = async (key: string, v: string) => {
    const prefs = await loadPrefs();
    const byMonth = { ...pref<Record<string, number>>(prefs, "forecast.incomeByMonth", {}) };
    const n = parseFloat(v);
    if (v === "" || !Number.isFinite(n)) delete byMonth[key]; else byMonth[key] = n;
    await setPref("forecast.incomeByMonth", byMonth);
    reload();
  };

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Forecast</h1>
        <div className="btn-group">
          <label className="hint" htmlFor="fc-income">Expected income / month</label>
          <input id="fc-income" type="number" className="control forecast__income" min={0} step={100}
                 defaultValue={Math.round(fc.income_monthly)} key={fc.income_monthly}
                 onBlur={e => setIncome(e.target.value)} />
          <button className="btn btn--outline btn--sm" onClick={() => setIncome("")}>Use average</button>
          <select className="control forecast__horizon" value={fc.year} onChange={e => setYear(e.target.value)}>
            {[y0, y0 + 1, y0 + 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label={fc.carried_from ? `Cash at start of ${fc.year}` : "Cash today"} value={chf(fc.opening)} mod="info"
          hint={fc.carried_from
            ? `projected · carried from ${fc.carried_from} (bank ${chf(fc.bank_balance)} as of ${fc.as_of})`
            : `${fc.source} · as of ${fc.as_of}`} />
        <Stat label="Lowest point" value={chf(low.cash_end)} mod={lowMod}
          hint={`in ${low.label}${low.cash_end < 0 ? " — needs income or a shareholder loan" : ""}`} />
        <Stat label={`Cash end of ${fc.year}`} value={chf(fc.end_cash)} mod={fc.end_cash >= fc.opening ? "ok" : "warn"}
          hint={`income ${chf(fc.income_monthly)}/mo (${fc.income_source})`} />
        <Stat label="Monthly outflow" value={chf(avgOut)}
          hint={`avg · net salary ${chf(fc.payroll_net)} + obligations + bills + pots ${chf(fc.pots.reduce((t, p) => t + p.monthly_accrual, 0))}/mo`} />
      </div>

      {fc.pl && (
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 16 }}>
          <div className="row-split" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Expected profit {fc.pl.year}{" "}
              <span className="hint">(accrual — what the closing should roughly show)</span></h3>
            <span className={`money ${fc.pl.profit_before_tax >= 0 ? "t-ok" : "t-danger"}`}
                  style={{ fontWeight: 700, fontSize: 18 }}>{chf(fc.pl.profit_before_tax)}</span>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Revenue net of VAT: <b>{chf(fc.pl.revenue_actual_net)}</b> booked + <b>{chf(fc.pl.revenue_projected_net)}</b> projected
            {" "}− payroll {chf(fc.pl.payroll_actual + fc.pl.payroll_projected)}
            {" "}− bills {chf(fc.pl.bills_actual + fc.pl.bills_projected)}
            {" "}− fiduciary accrual {chf(fc.pl.fiduciary_accrual)}
          </div>
          {fc.pl.profit_before_tax >= 0 ? (
            <div className="hint" style={{ marginTop: 4 }}>
              After ~tax {chf(fc.pl.est_corporate_tax)} and the 5% legal reserve {chf(fc.pl.legal_reserve)} →{" "}
              <b className="t-owner">≈ {chf(fc.pl.est_distributable)} distributable as dividend</b> at the next AGM.
            </div>
          ) : (
            <div className="hint" style={{ marginTop: 4 }}>
              A loss carries forward and reduces next year&apos;s taxable profit — no dividend from this year.
            </div>
          )}
        </div>
      )}

      <ChartCard title="Cash month by month"
        legend={<Legend items={[
          { label: "Income", color: "var(--viz-income)" },
          { label: "Outflow", color: "var(--viz-costs)" },
          { label: "Cash at end", color: vizToken("--text"), line: true }]} />}>
        <ForecastChart months={fc.months} />
      </ChartCard>

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Month</th><th className="text-right">Income (edit)</th><th className="text-right">Net salary</th>
            <th className="text-right">Obligations</th><th className="text-right">Bills</th>
            <th className="text-right">Pots</th><th className="text-right">Net</th>
            <th className="text-right">Cash at end</th><th>What&apos;s due</th>
          </tr></thead>
          <tbody>
            {fc.months.map(m => {
              const due = [...m.items].sort((a, b) => b.amount - a.amount).slice(0, 3)
                .map(i => `${i.label} ${chf(i.amount)}`).join(" · ");
              return (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td className="money">
                    <input type="number" min={0} step={100}
                      className={`control forecast__cell${m.income_override ? " forecast__cell--set" : ""}`}
                      defaultValue={Math.round(m.income)} key={`${m.key}-${m.income}`}
                      title={m.income_override ? "Entered for this month — clear to use the default" : "Default expected income — type to override this month"}
                      onBlur={e => { if (Number(e.target.value) !== Math.round(m.income)) setMonthIncome(m.key, e.target.value); }} />
                  </td>
                  <td className="money">{chf(m.payroll_net)}</td>
                  <td className="money">{chf(m.obligations)}</td>
                  <td className="money">{chf(m.bills)}</td>
                  <td className="money">{chf(m.reserves)}</td>
                  <td className={`money ${m.net < 0 ? "t-danger" : "t-ok"}`}>{chf(m.net)}</td>
                  <td className={`money${m.cash_end < 0 ? " t-danger" : ""}`}><strong>{chf(m.cash_end)}</strong></td>
                  <td className="hint">{due || "—"}{m.items.length > 3 && <span className="hint"> +{m.items.length - 3} more</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="notice notice--info">
        <b>How this is built.</b> Starts from the freshest bank balance. Each month: income (the amount typed in the
        row, else {fc.income_source}) − net salary − obligations payable this year on the date their bill is expected −
        unpaid and recurring bills − the Cash Allocation pots
        ({fc.pots.map(p => `${p.name} ${chf(p.monthly_accrual)}/mo`).join(", ") || "none"}).
        {fc.pots_fund_after && ` Obligation bills landing after ${fc.pots_fund_after} are paid out of those pots, so they are not charged again.`}
      </div>
    </div>
  );
}
