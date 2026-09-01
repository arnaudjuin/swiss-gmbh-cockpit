"use client";
// Dividends — read view of the saved multi-year plan (Swiss partial taxation).
// Editing stays in the classic frontend for now; both read the same preference.
import { useEffect, useState } from "react";
import { loadPrefs, pref } from "@/lib/prefs";
import { chf } from "@/lib/money";
import { Stat } from "@/components/ui";

interface DivYear { fiscalYear: number; startMonth: number; amounts: number[] }
interface Plan { bucketNames?: string[]; years?: DivYear[]; fedRatePct?: number; cantRatePct?: number; starting?: number }

export default function DividendsPage() {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  useEffect(() => { loadPrefs().then(p => setPlan(pref<Plan | null>(p, "dividends", null))); }, []);
  if (plan === undefined) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const years = (plan?.years ?? []).slice().sort((a, b) => a.fiscalYear - b.fiscalYear);
  const fed = plan?.fedRatePct ?? 12, cant = plan?.cantRatePct ?? 21.5;
  const eff = 0.7 * fed / 100 + 0.5 * cant / 100;
  const perYear = years.map(y => {
    const months = 12 - Math.max(1, Math.min(12, y.startMonth || 1)) + 1;
    const monthly = (y.amounts ?? []).reduce((s, a) => s + (Number(a) || 0), 0);
    return { fy: y.fiscalYear, months, monthly, gross: monthly * months };
  });
  const gross = (plan?.starting ?? 0) + perYear.reduce((s, p) => s + p.gross, 0);
  const net = gross * (1 - eff);

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Dividend Planner</h1></div>
      {years.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">⚡</div>
          <div className="empty-state__title">No plan yet</div>
          <p className="hint">Set monthly amounts per fiscal year in the classic frontend — this page reads the same saved plan.</p>
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <Stat label="Gross pot (all years)" value={chf(gross)} mod="owner"
              hint={`WHT 35% is timing only — refunded when declared`} />
            <Stat label="Net after income tax" value={chf(net)} mod="ok"
              hint={`≈${(eff * 100).toFixed(1)}% effective (70% × ${fed}% fed + 50% × ${cant}% cantonal — qualified holding)`} />
            <Stat label="Fiscal years" value={String(years.length)}
              hint={`paid out each June after the AGM`} />
          </div>
          <div className="table-card">
            <table className="table table--compact">
              <thead><tr><th>Fiscal year</th><th className="text-right">Monthly set-aside</th>
                <th className="text-right">Months</th><th className="text-right">Gross</th>
                <th className="text-right">Net after tax</th><th>Paid out</th></tr></thead>
              <tbody>
                {perYear.map(p => (
                  <tr key={p.fy}>
                    <td><strong>FY {p.fy}</strong></td>
                    <td className="money">{chf(p.monthly)}</td>
                    <td className="text-right">{p.months}</td>
                    <td className="money">{chf(p.gross)}</td>
                    <td className="money">{chf(p.gross * (1 - eff))}</td>
                    <td className="mono">Jun {p.fy + 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
