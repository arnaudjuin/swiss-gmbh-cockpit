"use client";
// Obligations — port of the classic page (static/js/06-money.js): summary
// cards, payment-day groups (payable date), by-type table, all obligations.
import { useCallback, useEffect, useState } from "react";
import { api, type Obligation } from "@/lib/api";
import { chf, daysUntil } from "@/lib/money";
import { Stat, Chip, Money } from "@/components/ui";
import { ObligationForm } from "@/components/ObligationForm";
import { ConfirmModal } from "@/components/Modal";

// The /obligations payload also carries type_label + has_file (see
// routes/obligations.py); the shared Obligation type omits them, so widen here.
type Ob = Obligation & { type_label?: string; has_file?: boolean };

const pd = (o: Obligation) => o.payable_date ?? o.due_date ?? "";
const isProjected = (o: Obligation) => /PROJECTED|PLACEHOLDER/i.test(o.notes || "");

function fileUrl(id: number) {
  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : "";
  return `/api/obligations/${id}/file?token=${encodeURIComponent(token ?? "")}`;
}

function DayGroup({ date, items, onToggle, onPayAll }: {
  date: string; items: Obligation[]; onToggle: (o: Obligation) => void; onPayAll: (items: Obligation[]) => void;
}) {
  const days = daysUntil(date);
  const total = items.reduce((s, o) => s + o.amount, 0);
  return (
    <div className="panel" style={{ padding: "10px 14px", marginBottom: 10 }}>
      <div className="row-split" style={{ marginBottom: 6 }}>
        <span><span className="mono" style={{ fontWeight: 700 }}>{date}</span>{" "}
          <Chip mod={days < 0 ? "danger" : days <= 7 ? "warn" : undefined}>
            {days === 0 ? "today" : days < 0 ? `${-days}d overdue` : `in ${days}d`}
          </Chip></span>
        <span className="row-split" style={{ gap: 10 }}>
          <span className="money" style={{ fontWeight: 700 }}>{chf(total)}</span>
          {items.length > 1 && <button className="btn btn--ok btn--sm" onClick={() => onPayAll(items)}>Pay all ({items.length})</button>}
        </span>
      </div>
      {items.map(o => (
        <div key={o.id} className="row-split" style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
          <span className="hint">
            <b style={{ color: "var(--text)" }}>{typeLabel(o.obligation_type)}</b> · {o.period_label}
            {o.expected_bill_date && <span> · bill ~{o.expected_bill_date}{o.expected_bill_amount ? ` (${chf(o.expected_bill_amount)})` : ""}</span>}
          </span>
          <span className="row-split" style={{ gap: 10 }}>
            <Money v={o.amount} />
            <button className="btn btn--ok btn--sm" onClick={() => onToggle(o)}>Pay</button>
          </span>
        </div>
      ))}
    </div>
  );
}

let TYPES: Record<string, string> = {};
const typeLabel = (t: string) => TYPES[t] ?? t;

export default function ObligationsPage() {
  const [all, setAll] = useState<Ob[] | null>(null);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // undefined = form closed; null = adding; Obligation = editing that obligation.
  const [form, setForm] = useState<Obligation | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Obligation | null>(null);
  const [payGroup, setPayGroup] = useState<Obligation[] | null>(null);
  // Filters for the "All Obligations" table only (top sections always show all).
  const [fYear, setFYear] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");

  const reload = useCallback(() => {
    Promise.all([api<Ob[]>("/obligations"), api<Record<string, string>>("/obligations/types")])
      .then(([rows, t]) => { TYPES = t; setTypes(t); setAll(rows); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!all) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const payAll = async (items: Obligation[]) => {
    try {
      await Promise.all(items.filter(o => o.status !== "paid").map(o =>
        api(`/obligations/${o.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) })));
      reload();
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };
  const toggle = async (o: Obligation) => {
    await api(`/obligations/${o.id}/status`, {
      method: "PATCH", body: JSON.stringify({ status: o.status === "paid" ? "unpaid" : "paid" }),
    });
    reload();
  };

  const remove = async (o: Obligation) => {
    try { await api(`/obligations/${o.id}`, { method: "DELETE" }); reload(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const year = new Date().getFullYear();
  const unpaid = all.filter(o => o.status === "unpaid" && pd(o));
  const overdue = unpaid.filter(o => daysUntil(pd(o)) < 0).sort((a, b) => pd(a).localeCompare(pd(b)));
  const upcoming = unpaid.filter(o => { const d = daysUntil(pd(o)); return d >= 0 && d <= 60; })
    .sort((a, b) => pd(a).localeCompare(pd(b)));
  const later = unpaid.filter(o => daysUntil(pd(o)) > 60 && o.period_year === year);
  const paidYtd = all.filter(o => o.status === "paid" && o.period_year === year).reduce((s, o) => s + o.amount, 0);
  const remaining = all.filter(o => o.status === "unpaid" && o.period_year === year).reduce((s, o) => s + o.amount, 0);
  const projectedPart = all.filter(o => o.status === "unpaid" && o.period_year === year && isProjected(o))
    .reduce((s, o) => s + o.amount, 0);

  // "All Obligations" filters
  const years = [...new Set(all.map(o => o.period_year))].sort((a, b) => b - a);
  let listed = all;
  if (fYear) listed = listed.filter(o => String(o.period_year) === fYear);
  if (fType) listed = listed.filter(o => o.obligation_type === fType);
  if (fStatus) listed = listed.filter(o => o.status === fStatus);

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
      <div className="page-header">
        <h1 className="page-title">GmbH Obligations</h1>
        <button className="btn btn--primary" onClick={() => setForm(null)}>＋ New obligation</button>
      </div>

      <div className="stats-grid">
        <Stat label="Overdue" value={chf(overdue.reduce((s, o) => s + o.amount, 0))}
          mod={overdue.length ? "danger" : null} />
        <Stat label="Due Next 60 Days" value={chf(upcoming.reduce((s, o) => s + o.amount, 0))} mod="warn" />
        <Stat label="Paid This Year" value={chf(paidYtd)} mod="ok" />
        <Stat label="Remaining This Year" value={chf(remaining)}
          hint={projectedPart > 0 ? `of which ${chf(projectedPart)} projected` : undefined} />
      </div>

      {overdue.length > 0 && (
        <div className="finance-section">
          <h3 className="t-danger">Overdue — settle these first <span className="count">{overdue.length}</span></h3>
          {groupBy(overdue).map(([d, items]) => <DayGroup key={d} date={d} items={items} onToggle={toggle} onPayAll={setPayGroup} />)}
        </div>
      )}

      <div className="finance-section">
        <h3>Coming Up (Next 60 Days) <span className="count">{upcoming.length}</span></h3>
        {upcoming.length
          ? groupBy(upcoming).map(([d, items]) => <DayGroup key={d} date={d} items={items} onToggle={toggle} onPayAll={setPayGroup} />)
          : <p className="hint">Nothing payable in the next 60 days.</p>}
        {later.length > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            Later this year: {chf(later.reduce((s, o) => s + o.amount, 0))} across {later.length}{" "}
            obligation{later.length === 1 ? "" : "s"} — see the table below.
          </p>
        )}
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
        <div className="filter-bar" style={{ flexWrap: "wrap" }}>
          <label>Year:</label>
          <select className="control" style={{ width: "auto" }} value={fYear} onChange={e => setFYear(e.target.value)}>
            <option value="">All</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <label>Type:</label>
          <select className="control" style={{ width: "auto" }} value={fType} onChange={e => setFType(e.target.value)}>
            <option value="">All</option>
            {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label>Status:</label>
          <select className="control" style={{ width: "auto" }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr>
              <th>Type</th><th>Period</th><th>Due</th>
              <th className="text-right">Amount</th>
              <th>Expected Bill</th><th>Status</th><th>File</th>
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {listed.length === 0 && <tr><td colSpan={8} className="empty-cell">No obligations found</td></tr>}
              {listed.map(o => {
                const noteLabel = o.obligation_type === "other" && o.notes
                  ? o.notes.replace(/^Payroll obligation:\s*/, "").split(/[—.;]/)[0].trim().slice(0, 40)
                  : "";
                return (
                  <tr key={o.id}>
                    <td>
                      <strong>{typeLabel(o.obligation_type)}</strong>
                      {noteLabel && <div className="hint">{noteLabel}</div>}
                    </td>
                    <td>{o.period_label}</td>
                    <td className="mono">{o.due_date || "—"}</td>
                    <td className="money">{chf(o.amount)}</td>
                    <td>
                      {o.expected_bill_date
                        ? <span className="mono">{o.expected_bill_date}
                            {o.expected_bill_amount != null && Math.abs(o.expected_bill_amount - o.amount) > 0.05 && (
                              <div className="hint">~{chf(o.expected_bill_amount)}</div>
                            )}
                          </span>
                        : <span className="hint">—</span>}
                    </td>
                    <td><Chip mod={o.status === "paid" ? "ok" : "warn"}>{o.status}</Chip></td>
                    <td>{o.has_file
                      ? <a href={fileUrl(o.id)} target="_blank" rel="noreferrer" title="Open document">📄</a>
                      : <span className="hint">—</span>}</td>
                    <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => toggle(o)}>
                        {o.status === "paid" ? "Mark unpaid" : "Mark paid"}
                      </button>
                      <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(o)}>✎</button>
                      <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setToDelete(o)}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {form !== undefined && (
        <ObligationForm obligation={form} types={types} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); reload(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete obligation"
          message={<>Delete <strong>{typeLabel(toDelete.obligation_type)}</strong> · {toDelete.period_label} ({chf(toDelete.amount)})? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
      {payGroup && (
        <ConfirmModal title="Pay all" confirmLabel="Mark all paid" danger={false}
          message={<>Mark all {payGroup.filter(o => o.status !== "paid").length} obligations due on <strong>{pd(payGroup[0])}</strong> as paid (from cash), total {chf(payGroup.reduce((s, o) => s + o.amount, 0))}? Use the per-item Pay button if one should come out of a budget reserve.</>}
          onConfirm={() => payAll(payGroup)} onClose={() => setPayGroup(null)} />
      )}
    </div>
  );
}
