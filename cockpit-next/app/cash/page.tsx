"use client";
// Cash Allocation — bank-balance waterfall + reserve envelopes.
import { useEffect, useState } from "react";
import { api, type Reserve, type CashBalance, type Obligation } from "@/lib/api";
import { chf, daysUntil } from "@/lib/money";
import { Meter } from "@/components/ui";

export default function CashPage() {
  const [reserves, setReserves] = useState<Reserve[] | null>(null);
  const [cash, setCash] = useState<CashBalance | null>(null);
  const [obs, setObs] = useState<Obligation[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Reserve[]>("/reserves"),
      api<CashBalance>("/cash-balance").catch(() => null),
      api<Obligation[]>("/obligations").catch(() => []),
    ]).then(([r, c, o]) => { setReserves(r); setCash(c); setObs(o); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!reserves) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const bal = cash?.balance ?? 0;
  const dueSoon = obs.filter(o => {
    const d = o.payable_date ?? o.due_date;
    return o.status === "unpaid" && d && daysUntil(d) <= 30;
  });
  const due30 = dueSoon.reduce((s, o) => s + o.amount, 0);
  const earmarked = reserves.reduce((s, r) => s + r.accumulated, 0);
  const free = bal - earmarked - due30;

  const row = (label: string, v: number, opts: { minus?: boolean; strong?: boolean; mod?: string } = {}) => (
    <div className="row-split" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span className={opts.strong ? "" : "hint"} style={opts.strong ? { fontWeight: 700 } : undefined}>{label}</span>
      <span className={`money${opts.mod ? ` t-${opts.mod}` : ""}`} style={opts.strong ? { fontWeight: 700 } : undefined}>
        {opts.minus ? "− " : ""}{chf(Math.abs(v))}
      </span>
    </div>
  );

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Cash Allocation</h1></div>
      <p className="page-intro">The real bank balance, split into what&apos;s already spoken for. Envelopes are
        virtual — the money stays on the account; earmarking just stops it from looking spendable.</p>

      <div className="panel" style={{ padding: "10px 16px", maxWidth: 640, marginBottom: 18 }}>
        {row(`Bank balance (${cash?.source ?? "—"} · ${cash?.as_of ?? "—"})`, bal, { strong: true })}
        {row(`Earmarked in ${reserves.length} envelopes`, earmarked, { minus: true })}
        {row(`Obligations due next 30 days (${dueSoon.length})`, due30, { minus: true })}
        {row("Freely spendable", free, { strong: true, mod: free < 0 ? "danger" : "ok" })}
      </div>

      <div className="finance-section">
        <h3>Envelopes</h3>
        {reserves.map(r => (
          <div key={r.id} className="panel" style={{ padding: "10px 14px", marginBottom: 10 }}>
            <div className="row-split">
              <strong>{r.name}</strong>
              <span className="hint">target {chf(r.target_amount)}{r.target_date ? ` · due ${r.target_date}` : ""}</span>
            </div>
            {r.purpose && <div className="hint" style={{ margin: "2px 0 6px" }}>{r.purpose}</div>}
            <div className="row-split" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}><Meter pct={r.progress_pct} mod={r.progress_pct >= 95 ? "ok" : undefined} /></div>
              <span className="hint" style={{ whiteSpace: "nowrap" }}>
                <b style={{ color: "var(--text)" }}>{chf(r.accumulated)}</b> / {chf(r.target_amount)} · +{chf(r.monthly_accrual)}/mo
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
