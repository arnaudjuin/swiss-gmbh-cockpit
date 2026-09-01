"use client";
// Obligations — port of the classic page (static/js/06-money.js): summary
// cards, payment-day groups (payable date), by-type table, all obligations.
import { useCallback, useEffect, useState } from "react";
import { api, type Obligation } from "@/lib/api";
import { chf, daysUntil } from "@/lib/money";
import { Stat, Chip, Money } from "@/components/ui";

const pd = (o: Obligation) => o.payable_date ?? o.due_date ?? "";

function DayGroup({ date, items, onToggle }: { date: string; items: Obligation[]; onToggle: (o: Obligation) => void }) {
  const days = daysUntil(date);
  const total = items.reduce((s, o) => s + o.amount, 0);
  return (
    <div className="panel" style={{ padding: "10px 14px", marginBottom: 10 }}>
      <div className="row-split" style={{ marginBottom: 6 }}>
        <span><span className="mono" style={{ fontWeight: 700 }}>{date}</span>{" "}
          <Chip mod={days < 0 ? "danger" : days <= 7 ? "warn" : undefined}>
            {days === 0 ? "today" : days < 0 ? `${-days}d overdue` : `in ${days}d`}
          </Chip></span>
        <span className="money" style={{ fontWeight: 700 }}>{chf(total)}</span>
      </div>
      {items.map(o => (
        <div key={o.id} className="row-split" style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
          <span className="hint">
            <b style={{ color: "var(--text)" }}>{typeLabel(o.obligation_type)}</b> · {o.period_label}
            {o.expected_bill_date && <span> · bill ~{o.expected_bill_date}{o.expected_bill_amount ? ` (${chf(o.expected_bill_amount)})` : ""}</span>}
          </span>
          <span className="row-split" style={{ gap: 10 }}>
            <Money v={o.amount} />
            <button className="btn btn--ghost btn--sm" onClick={() => onToggle(o)}>Pay</button>
          </span>
        </div>
      ))}
    </div>
  );
}

let TYPES: Record<string, string> = {};
const typeLabel = (t: string) => TYPES[t] ?? t;

export default function ObligationsPage() {
  const [all, setAll] = useState<Obligation[] | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    Promise.all([api<Obligation[]>("/obligations"), api<Record<string, string>>("/obligations/types")])
      .then(([rows, types]) => { TYPES = types; setAll(rows); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!all) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const toggle = async (o: Obligation) => {
    await api(`/obligations/${o.id}/status`, {
      method: "PATCH", body: JSON.stringify({ status: o.status === "paid" ? "unpaid" : "paid" }),
    });
    reload();
  };

  const year = new Date().getFullYear();
  const unpaid = all.filter(o => o.status === "unpaid" && pd(o));
  const overdue = unpaid.filter(o => daysUntil(pd(o)) < 0).sort((a, b) => pd(a).localeCompare(pd(b)));
  const upcoming = unpaid.filter(o => { const d = daysUntil(pd(o)); return d >= 0 && d <= 60; })
    .sort((a, b) => pd(a).localeCompare(pd(b)));
  const paidYtd = all.filter(o => o.status === "paid" && o.period_year === year).reduce((s, o) => s + o.amount, 0);
  const remaining = all.filter(o => o.status === "unpaid" && o.period_year === year).reduce((s, o) => s + o.amount, 0);

  const groupBy = (rows: Obligation[]) => {
    const m = new Map<string, Obligation[]>();
    rows.forEach(o => { const k = pd(o); m.set(k, [...(m.get(k) ?? []), o]); });
    return [...m.entries()];
  };

  const byType = new Map<string, { total: number; unpaid: number; n: number }>();
  all.filter(o => o.period_year === year).forEach(o => {
    const e = byType.get(o.obligation_type) ?? { total: 0, unpaid: 0, n: 0 };
    e.total += o.amount; e.n += 1; if (o.status === "unpaid") e.unpaid += o.amount;
    byType.set(o.obligation_type, e);
  });

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">GmbH Obligations</h1></div>

      <div className="stats-grid">
        <Stat label="Overdue" value={chf(overdue.reduce((s, o) => s + o.amount, 0))}
          mod={overdue.length ? "danger" : null} />
        <Stat label="Due Next 60 Days" value={chf(upcoming.reduce((s, o) => s + o.amount, 0))} />
        <Stat label="Paid This Year" value={chf(paidYtd)} mod="ok" />
        <Stat label="Remaining This Year" value={chf(remaining)} />
      </div>

      {overdue.length > 0 && (
        <div className="finance-section">
          <h3 className="t-danger">Overdue — settle these first <span className="count">{overdue.length}</span></h3>
          {groupBy(overdue).map(([d, items]) => <DayGroup key={d} date={d} items={items} onToggle={toggle} />)}
        </div>
      )}

      <div className="finance-section">
        <h3>Coming Up (Next 60 Days) <span className="count">{upcoming.length}</span></h3>
        {upcoming.length
          ? groupBy(upcoming).map(([d, items]) => <DayGroup key={d} date={d} items={items} onToggle={toggle} />)
          : <p className="hint">Nothing payable in the next 60 days.</p>}
      </div>

      <div className="finance-section">
        <h3>This Year by Type</h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr><th>Type</th><th className="text-right">Items</th><th className="text-right">Total</th><th className="text-right">Still unpaid</th></tr></thead>
            <tbody>
              {[...byType.entries()].sort((a, b) => b[1].total - a[1].total).map(([t, e]) => (
                <tr key={t}>
                  <td>{typeLabel(t)}</td>
                  <td className="text-right">{e.n}</td>
                  <td className="money">{chf(e.total)}</td>
                  <td className={`money${e.unpaid > 0 ? " t-warn" : ""}`}>{chf(e.unpaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="finance-section">
        <h3>All Obligations</h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr>
              <th>Type</th><th>Period</th><th className="text-right">Amount</th>
              <th>Payable</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {all.map(o => (
                <tr key={o.id}>
                  <td>{typeLabel(o.obligation_type)}</td>
                  <td>{o.period_label}</td>
                  <td className="money">{chf(o.amount)}</td>
                  <td className="mono">{pd(o) || "—"}</td>
                  <td><Chip mod={o.status === "paid" ? "ok" : "warn"}>{o.status}</Chip></td>
                  <td className="text-right">
                    <button className="btn btn--ghost btn--sm" onClick={() => toggle(o)}>
                      {o.status === "paid" ? "Mark unpaid" : "Mark paid"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
