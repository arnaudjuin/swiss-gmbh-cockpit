"use client";
// Reports → Booked vs income-derived. Puts the income-derived corporate-tax and
// output-VAT figures next to what's actually booked as obligations, and flags any
// gap. Mirrors renderIncomeReconcile() in static/js/08-payroll.js.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import type { Forecast, Obligation } from "@/lib/api";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ReconcilePanel({ year }: { year: number }) {
  const [fc, setFc] = useState<Forecast | null>(null);
  const [obs, setObs] = useState<Obligation[] | null>(null);
  const [projPrice, setProjPrice] = useState(0);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false); setFc(null); setObs(null);
    Promise.all([
      api<Forecast>(`/finance/forecast?year=${year}`),
      api<Obligation[]>(`/obligations?year=${year}`),
    ]).then(([f, o]) => { setFc(f); setObs(o); }).catch(() => setFailed(true));
    api<Record<string, any>>("/preferences")
      .then(p => setProjPrice(Number(p?.vehicle?.projPrice) || 0)).catch(() => setProjPrice(0));
  }, [year]);
  useEffect(load, [load]);

  return (
    <div className="finance-section">
      <div className="report-widget-header">
        <h3 style={{ margin: 0 }}>Booked vs income-derived</h3>
      </div>
      <p className="hint" style={{ margin: "8px 0 12px 0" }}>
        Your VAT and corporate tax should track total income (booked invoices + forecast). This shows the
        income-derived figure next to what&apos;s actually booked, and flags any gap — nothing is rewritten.
      </p>
      {failed && <p className="hint">Could not load.</p>}
      {!failed && (!fc || !obs) && <p className="hint">Loading…</p>}
      {fc && obs && <Body fc={fc} obs={obs} year={year} projPrice={projPrice} />}
    </div>
  );
}

function Body({ fc, obs, year, projPrice }: { fc: Forecast; obs: Obligation[]; year: number; projPrice: number }) {
  const pl = fc.pl || ({} as Forecast["pl"]);
  const incomeNet = (pl.revenue_actual_net || 0) + (pl.revenue_projected_net || 0);
  const derivedTax = pl.est_corporate_tax || 0;
  const bookedTax = obs.filter(o => (o.obligation_type || "").startsWith("corporate_tax")).reduce((s, o) => s + (o.amount || 0), 0);
  const bookedVat = obs.filter(o => o.obligation_type === "vat").reduce((s, o) => s + (o.amount || 0), 0);
  const derivedOutputVat = incomeNet * 0.081;
  const taxGap = round2(derivedTax - bookedTax);
  const privYr = projPrice * 0.009 * 12;
  const off = Math.abs(taxGap) >= 50;

  return (
    <div className="panel">
      <div className="stats-grid" style={{ marginBottom: 6 }}>
        <div className="stat">
          <div className="stat__label">Total income {year} (net of VAT)</div>
          <div className="stat__value money">{chf(incomeNet)}</div>
          <div className="stat__hint">invoices {chf(pl.revenue_actual_net || 0)} + forecast {chf(pl.revenue_projected_net || 0)}</div>
        </div>
      </div>

      <div className="row-split" style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Corporate tax</strong> <span className="hint">forecast profit × effective rate vs the booked FY obligations</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="money">derived {chf(derivedTax)}</div>
          <div className="money hint">booked {chf(bookedTax)}</div>
          <div className={`money ${off ? "t-warn" : "t-ok"}`} style={{ fontWeight: 600 }}>
            {off ? `${taxGap > 0 ? "under-booked" : "over-booked"} ${chf(Math.abs(taxGap))}` : "in step ✓"}
          </div>
        </div>
      </div>

      <div className="row-split" style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>VAT</strong> <span className="hint">output VAT on total income vs the booked (net) obligations</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="money">output {chf(derivedOutputVat)}</div>
          <div className="money hint">booked net {chf(bookedVat)}</div>
          <div className="hint hint--sm">booked is net of input VAT — see the VAT Tracker for the real per-quarter booked-vs-derived</div>
        </div>
      </div>

      {projPrice > 0 && (
        <div className="notice notice--info" style={{ marginTop: 10 }}>
          Privatanteil projection (car {chf(projPrice)}): would add <span className="money">{chf(privYr * 0.064)}</span> AHV
          and <span className="money">{chf(privYr * 0.081)}</span> output VAT once the car is booked — <strong>not yet in the obligations above</strong>.
        </div>
      )}
      {Math.abs(taxGap) >= 50 && (
        <div className="notice notice--warn" style={{ marginTop: 8 }}>
          Corporate tax is {taxGap > 0 ? "under" : "over"}-booked by {chf(Math.abs(taxGap))} vs what your income implies.
          Update the FY corporate-tax obligation on the Obligations page if the forecast is firm.
        </div>
      )}
    </div>
  );
}
