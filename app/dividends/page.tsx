"use client";
// Dividends — two-column layout matching the classic page: the plan editor
// (bucket matrix × fiscal years) on the left, the result (headline net + the
// gross→WHT→tax→net breakdown) on the right. Everything recomputes live; Save
// persists the same prefs.dividends the classic frontend reads.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { loadPrefs, pref, setPref, divTax, type DivTax } from "@/lib/prefs";
import { chf } from "@/lib/money";
import { DividendPlanEditor, normalisePlan, type Plan } from "@/components/DividendPlanEditor";

export default function DividendsPage() {
  const [draft, setDraft] = useState<Plan | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [dt, setDt] = useState<DivTax>({ wht: 0.35, fedIncl: 0.7, cantIncl: 0.5 });
  const [cap, setCap] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const loadCap = useCallback((plan: Plan) => {
    const uniq = [...new Set(plan.years.map(y => y.fiscalYear))];
    Promise.all(uniq.map(y =>
      api<{ pl?: { est_distributable?: number } }>(`/finance/forecast?year=${y}`)
        .then(fc => [y, fc.pl?.est_distributable ?? null] as const).catch(() => [y, null] as const)))
      .then(res => setCap(Object.fromEntries(res.filter(([, v]) => v != null) as [number, number][])));
  }, []);

  useEffect(() => {
    loadPrefs().then(p => {
      setDt(divTax(p));
      const plan = normalisePlan(pref<Partial<Plan> | null>(p, "dividends", null));
      setDraft(plan); setSaved(JSON.stringify(plan)); loadCap(plan);
    });
  }, [loadCap]);

  if (!draft) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const fed = draft.fedRatePct, cant = draft.cantRatePct;
  const eff = dt.fedIncl * fed / 100 + dt.cantIncl * cant / 100;
  const perYear = draft.years.slice().sort((a, b) => a.fiscalYear - b.fiscalYear).map(y => {
    const months = 12 - Math.max(1, Math.min(12, y.startMonth || 1)) + 1;
    const monthly = y.amounts.reduce((s, a) => s + (Number(a) || 0), 0);
    return { fy: y.fiscalYear, months, monthly, gross: monthly * months };
  });
  const totalMonths = perYear.reduce((s, p) => s + p.months, 0);
  const contributions = perYear.reduce((s, p) => s + p.gross, 0);
  const gross = draft.starting + contributions;
  const wht = gross * dt.wht;
  const incomeTax = gross * eff;
  const netKeep = gross - incomeTax;
  // Per-bucket × per-year net breakdown (the "detail by category").
  const sortedYears = draft.years.slice().sort((a, b) => a.fiscalYear - b.fiscalYear);
  const monthsOf = (y: { startMonth: number }) => 12 - Math.max(1, Math.min(12, y.startMonth || 1)) + 1;
  const bucketRows = draft.bucketNames.map((name, bi) => {
    const cells = sortedYears.map(y => {
      const g = (Number(y.amounts[bi]) || 0) * monthsOf(y);
      return { gross: g, net: g * (1 - eff) };
    });
    return { name, cells, gross: cells.reduce((s, c) => s + c.gross, 0), net: cells.reduce((s, c) => s + c.net, 0) };
  });
  const capOver = perYear.filter(p => cap[p.fy] != null && p.gross > cap[p.fy] + 1);
  const capKnown = Object.keys(cap).length > 0;
  const dirty = JSON.stringify(draft) !== saved;

  const save = async () => {
    setSaving(true);
    try { await setPref("dividends", draft); setSaved(JSON.stringify(draft)); loadCap(draft); }
    finally { setSaving(false); }
  };

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dividend Planner</h1>
          <span className="hint">Decision support — not tax advice. Verify with the fiduciary before the AGM.</span>
        </div>
        <div className="row-split" style={{ gap: 8 }}>
          {dirty && <span className="chip chip--warn chip--sm">unsaved</span>}
          <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save plan"}</button>
        </div>
      </div>

      <div className="cols-2">
        {/* Left — the plan */}
        <DividendPlanEditor value={draft} onChange={setDraft} />

        {/* Right — the result */}
        <div className="chart-card">
          <h3>If you stick to the plan</h3>

          <div className="headline-panel" style={{ marginBottom: 16 }}>
            <div className="section-label">Cumulative across all fiscal years</div>
            <div className="headline-panel__value headline-panel__value--ok money">{chf(netKeep)}</div>
            <div className="headline-panel__sub">net into your personal account once all dividends are
              distributed (after the WHT credit + income tax)</div>
          </div>

          {capKnown && (capOver.length ? capOver.map(p => (
            <div key={p.fy} className="notice notice--warn" style={{ marginBottom: 8 }}>
              FY {p.fy}: planned gross <span className="money">{chf(p.gross)}</span> exceeds the forecast
              distributable <span className="money">{chf(cap[p.fy])}</span> by <strong>{chf(p.gross - cap[p.fy])}</strong>{" "}
              — a dividend can&apos;t exceed distributable profit.
            </div>
          )) : (
            <div className="notice notice--ok" style={{ marginBottom: 8 }}>
              Every planned year is within its forecast distributable ceiling. ✓
            </div>
          ))}

          <table className="table table--compact">
            <tbody>
              <tr><td>Total contribution months <span className="hint">(across all years)</span></td><td className="money">{totalMonths}</td></tr>
              <tr><td>+ Starting pot</td><td className="money">{chf(draft.starting)}</td></tr>
              <tr><td>+ Monthly contributions</td><td className="money">{chf(contributions)}</td></tr>
              <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                <td>= Gross dividend pot</td><td className="money">{chf(gross)}</td></tr>
            </tbody>
          </table>

          <h4 className="section-label" style={{ margin: "18px 0 6px" }}>When you actually distribute it</h4>
          <table className="table table--compact">
            <tbody>
              <tr><td>Gross dividend</td><td className="money">{chf(gross)}</td></tr>
              <tr><td>− Withholding tax (Verrechnungssteuer {(dt.wht * 100).toFixed(0)}%)</td><td className="money t-danger">{chf(wht)}</td></tr>
              <tr><td>= Hits your account <span className="hint">({(dt.wht * 100).toFixed(0)}% refunded via NOV)</span></td><td className="money">{chf(gross)}</td></tr>
              <tr><td>≈ Income tax <span className="hint">({(dt.fedIncl * 100).toFixed(0)}% fed / {(dt.cantIncl * 100).toFixed(0)}% ZH of gross)</span></td><td className="money t-danger">{chf(incomeTax)}</td></tr>
              <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                <td>Net you really keep</td><td className="money t-ok">{chf(netKeep)}</td></tr>
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            Effective rate on the gross ≈ <strong>{(eff * 100).toFixed(1)}%</strong> — qualified holding (≥10%):
            {" "}{(dt.fedIncl * 100).toFixed(0)}% taxable federally, {(dt.cantIncl * 100).toFixed(0)}% cantonally.
          </p>

          {perYear.length > 0 && (
            <>
              <h4 className="section-label" style={{ margin: "18px 0 6px" }}>Net capital per fiscal year</h4>
              <table className="table table--compact">
                <thead><tr><th>Fiscal year</th><th className="text-right">Gross</th>
                  <th className="text-right">Net kept</th><th>Paid out</th></tr></thead>
                <tbody>
                  {perYear.map(p => (
                    <tr key={p.fy}>
                      <td><strong>FY {p.fy}</strong></td>
                      <td className="money">{chf(p.gross)}</td>
                      <td className="money t-ok">{chf(p.gross * (1 - eff))}</td>
                      <td className="mono">Jun {p.fy + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4 className="section-label" style={{ margin: "18px 0 6px" }}>Net result per bucket per year</h4>
              <div className="hint" style={{ marginBottom: 6 }}>Each cell = the net that bucket keeps for that fiscal year. Right column = bucket total across years; bottom row = year total.</div>
              <div style={{ overflowX: "auto" }}>
                <table className="table table--compact">
                  <thead><tr><th>Bucket</th>{sortedYears.map(y => <th key={y.fiscalYear} className="text-right">FY {y.fiscalYear}</th>)}<th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {bucketRows.map((b, bi) => (
                      <tr key={bi}>
                        <td>{b.name}</td>
                        {b.cells.map((c, ci) => <td key={ci} className="money t-ok">{chf(c.net)}</td>)}
                        <td className="money t-ok" style={{ fontWeight: 600 }}>{chf(b.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                      <td>Year total</td>
                      {sortedYears.map((_, ci) => <td key={ci} className="money">{chf(bucketRows.reduce((s, b) => s + b.cells[ci].net, 0))}</td>)}
                      <td className="money">{chf(bucketRows.reduce((s, b) => s + b.net, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <h4 className="section-label" style={{ margin: "18px 0 6px" }}>How the net splits across your buckets</h4>
              <table className="table table--compact">
                <thead><tr><th>Bucket</th><th className="text-right">Gross</th><th className="text-right">Net after tax</th></tr></thead>
                <tbody>
                  {bucketRows.map((b, bi) => (
                    <tr key={bi}><td>{b.name}</td><td className="money">{chf(b.gross)}</td><td className="money t-ok">{chf(b.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
