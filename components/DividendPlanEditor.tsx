"use client";
// The dividend plan editor — matches the classic layout exactly: a bucket
// matrix (buckets as ROWS × fiscal years as COLUMNS) plus a separate fiscal-
// years table, both using the classic .div-bucket-table styling. Controlled;
// the page owns the value and persists prefs.dividends:
//   { bucketNames[], years[{fiscalYear,startMonth,amounts[]}], fedRatePct, cantRatePct, starting }

interface DivYear { fiscalYear: number; startMonth: number; amounts: number[] }
export interface Plan { bucketNames: string[]; years: DivYear[]; fedRatePct: number; cantRatePct: number; starting: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthsIn = (startMonth: number) => 12 - Math.max(1, Math.min(12, startMonth || 1)) + 1;

export function normalisePlan(p: Partial<Plan> | null): Plan {
  const bucketNames = p?.bucketNames?.length ? [...p.bucketNames] : ["Dividend"];
  const years = (p?.years ?? []).map(y => ({
    fiscalYear: y.fiscalYear, startMonth: y.startMonth || 1,
    amounts: bucketNames.map((_, i) => Number(y.amounts?.[i]) || 0),
  }));
  return { bucketNames, years,
    fedRatePct: p?.fedRatePct ?? 12, cantRatePct: p?.cantRatePct ?? 21.5, starting: p?.starting ?? 0 };
}

export function DividendPlanEditor({ value, onChange }: { value: Plan; onChange: (p: Plan) => void }) {
  const p = value;
  const y0 = new Date().getFullYear();
  const up = (fn: (d: Plan) => void) => { const n = structuredClone(p); fn(n); onChange(n); };
  const addBucket = () => up(d => { d.bucketNames.push(`Bucket ${d.bucketNames.length + 1}`); d.years.forEach(y => y.amounts.push(0)); });
  const removeBucket = (i: number) => up(d => { if (d.bucketNames.length <= 1) return; d.bucketNames.splice(i, 1); d.years.forEach(y => y.amounts.splice(i, 1)); });
  const addYear = () => up(d => { const fy = d.years.length ? Math.max(...d.years.map(y => y.fiscalYear)) + 1 : y0; d.years.push({ fiscalYear: fy, startMonth: 1, amounts: d.bucketNames.map(() => 0) }); });
  const removeYear = (i: number) => up(d => d.years.splice(i, 1));

  const cols = p.years.slice().sort((a, b) => a.fiscalYear - b.fiscalYear);
  const colIndex = cols.map(c => p.years.indexOf(c));   // map sorted column → underlying year index
  const totalMonths = p.years.reduce((s, y) => s + monthsIn(y.startMonth), 0);

  return (
    <div className="chart-card">
      <h3>Plan</h3>
      <p className="hint" style={{ marginBottom: 14 }}>
        Plan a monthly amount to set aside until you can withdraw it as a dividend after next year&apos;s AGM
        (typically <strong>June</strong>).
      </p>

      <div className="field">
        <label className="field__label">Monthly allocation per bucket (rows) × fiscal year (columns)</label>
        <div style={{ overflowX: "auto" }}>
          <table className="div-bucket-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Bucket</th>
                {cols.map(c => <th key={c.fiscalYear} style={{ textAlign: "right" }}>FY {c.fiscalYear}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.bucketNames.map((name, bi) => (
                <tr key={bi}>
                  <td>
                    <input className="control" type="text" style={{ minWidth: 120 }} value={name}
                      onChange={e => up(d => { d.bucketNames[bi] = e.target.value; })} />
                  </td>
                  {colIndex.map((yi, ci) => (
                    <td key={ci} style={{ textAlign: "right" }}>
                      <input className="control money" type="number" step="10" min="0" style={{ width: 100, textAlign: "right" }}
                        value={p.years[yi].amounts[bi]}
                        onChange={e => up(d => { d.years[yi].amounts[bi] = Number(e.target.value) || 0; })} />
                    </td>
                  ))}
                  <td>{p.bucketNames.length > 1 && <button className="btn btn--ghost btn--icon btn--sm" title="Remove bucket" onClick={() => removeBucket(bi)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 600 }}>Monthly total</td>
                {colIndex.map((yi, ci) => (
                  <td key={ci} className="money" style={{ textAlign: "right", fontWeight: 600 }}>
                    {p.years[yi].amounts.reduce((s, a) => s + (Number(a) || 0), 0)}
                  </td>
                ))}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 6 }} onClick={addBucket}>＋ Add bucket</button>
      </div>

      <div className="field">
        <label className="field__label">Fiscal years to include</label>
        <table className="div-bucket-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Fiscal year</th>
              <th style={{ textAlign: "left" }}>Started contributing</th>
              <th style={{ textAlign: "right" }}>Months</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.years.length === 0 && <tr><td colSpan={4} className="hint">No years yet — add one</td></tr>}
            {cols.map((y) => {
              const yi = p.years.indexOf(y);
              return (
                <tr key={yi}>
                  <td><input className="control" type="number" style={{ width: 90 }} value={y.fiscalYear}
                    onChange={e => up(d => { d.years[yi].fiscalYear = parseInt(e.target.value, 10) || y0; })} /></td>
                  <td><select className="control" value={y.startMonth}
                    onChange={e => up(d => { d.years[yi].startMonth = parseInt(e.target.value, 10) || 1; })}>
                    {MONTHS.map((m, mi) => <option key={mi} value={mi + 1}>{m}</option>)}
                  </select></td>
                  <td className="money" style={{ textAlign: "right" }}>{monthsIn(y.startMonth)}</td>
                  <td><button className="btn btn--ghost btn--icon btn--sm" title="Remove year" onClick={() => removeYear(yi)}>🗑</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600 }}>Total months across years</td>
              <td></td>
              <td className="money" style={{ textAlign: "right", fontWeight: 600 }}>{totalMonths}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 6 }} onClick={addYear}>＋ Add fiscal year</button>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

      <div className="cols-2">
        <label className="field"><span className="field__label">Federal marginal rate (%)</span>
          <input className="control" type="number" step="0.1" value={p.fedRatePct} onChange={e => up(d => { d.fedRatePct = Number(e.target.value) || 0; })} /></label>
        <label className="field"><span className="field__label">Cantonal + communal marginal rate (%)</span>
          <input className="control" type="number" step="0.1" value={p.cantRatePct} onChange={e => up(d => { d.cantRatePct = Number(e.target.value) || 0; })} /></label>
      </div>
      <label className="field"><span className="field__label">Already accumulated (CHF, optional)</span>
        <input className="control" type="number" step="100" min="0" value={p.starting} onChange={e => up(d => { d.starting = Number(e.target.value) || 0; })} /></label>
    </div>
  );
}
