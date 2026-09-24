"use client";
// Cash Allocation — bank-balance waterfall + reserve envelopes.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Reserve, type CashBalance, type Obligation } from "@/lib/api";
import { chf, daysUntil } from "@/lib/money";
import { Meter } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { ReserveForm, type ReserveEditable } from "@/components/ReserveForm";
import { ContributeModal } from "@/components/ContributeModal";

// The /reserves payload carries the raw accrual columns lib/api.ts's Reserve
// type omits; widen locally so the edit form can round-trip them.
type ReserveRow = Reserve & { accrual_start?: string | null; accumulated_manual?: number; is_active?: boolean };
type Move = { reserve: ReserveRow; kind: "contribute" | "withdraw" };

// Update the manually-entered bank balance (classic showCashBalance /
// saveCashBalance). PUT /cash-balance takes { balance, as_of, notes } as JSON.
function CashBalanceModal({ cash, onClose, onSaved }: {
  cash: CashBalance | null; onClose: () => void; onSaved: () => void;
}) {
  const [balance, setBalance] = useState(cash?.balance != null ? String(cash.balance) : "");
  const [asOf, setAsOf] = useState(cash?.as_of ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await api("/cash-balance", { method: "PUT", body: JSON.stringify({ balance: Number(balance) || 0, as_of: asOf, notes }) });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Update bank balance" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="notice notice--danger" style={{ marginBottom: 12 }}>{error}</div>}
        <label className="field"><span className="field__label">Balance (CHF)</span>
          <input className="control" type="number" step="0.01" value={balance} required
            onChange={e => setBalance(e.target.value)} /></label>
        <label className="field"><span className="field__label">As of</span>
          <input className="control" type="date" value={asOf} required onChange={e => setAsOf(e.target.value)} /></label>
        <label className="field"><span className="field__label">Notes</span>
          <input className="control" type="text" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function CashPage() {
  const [reserves, setReserves] = useState<ReserveRow[] | null>(null);
  const [cash, setCash] = useState<CashBalance | null>(null);
  const [obs, setObs] = useState<Obligation[]>([]);
  const [error, setError] = useState("");
  // undefined = form closed; null = adding; ReserveRow = editing that reserve.
  const [form, setForm] = useState<ReserveRow | null | undefined>(undefined);
  const [move, setMove] = useState<Move | null>(null);
  const [toDelete, setToDelete] = useState<ReserveRow | null>(null);
  const [budgetMsg, setBudgetMsg] = useState("");
  const [editingBalance, setEditingBalance] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    Promise.all([
      api<ReserveRow[]>("/reserves"),
      api<CashBalance>("/cash-balance").catch(() => null),
      api<Obligation[]>("/obligations").catch(() => []),
    ]).then(([r, c, o]) => { setReserves(r); setCash(c); setObs(o); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const remove = async (r: ReserveRow) => {
    try { await api(`/reserves/${r.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const contributeAll = async () => {
    setBudgetMsg("");
    try {
      const res = await api<{ contributed_items: number; total_contributed: number; month: string }>(
        "/budget/contribute-all", { method: "POST", body: JSON.stringify({}) });
      setBudgetMsg(res.contributed_items === 0
        ? `Budget for ${res.month} was already contributed — nothing to do.`
        : `Contributed ${chf(res.total_contributed)} across ${res.contributed_items} budget line${res.contributed_items === 1 ? "" : "s"} for ${res.month}.`);
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

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
  const staleDays = cash?.as_of ? Math.round((Date.now() - new Date(cash.as_of).getTime()) / 86400000) : null;

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
      <div className="page-header">
        <h1 className="page-title">Cash Allocation</h1>
        <div className="btn-group">
          <button className="btn btn--primary" onClick={() => setForm(null)}>＋ New reserve</button>
          <button className="btn btn--outline" onClick={() => setEditingBalance(true)}>Update bank balance</button>
          <button className="btn btn--outline" onClick={() => router.push("/bank")}>Bank statements →</button>
        </div>
      </div>
      <p className="page-intro">The real bank balance, split into what&apos;s already spoken for. Envelopes are
        virtual — the money stays on the account; earmarking just stops it from looking spendable.</p>

      <div className="panel" style={{ padding: "10px 16px", maxWidth: 640, marginBottom: 18 }}>
        <div className="row-split" style={{ marginBottom: 4 }}>
          <strong>Cash allocation</strong>
          <span className="hint hint--sm">{cash?.source ?? "—"} · as of {cash?.as_of ?? "—"}
            {staleDays != null && staleDays > 21 && <span className="t-warn"> · {staleDays} days old — update it</span>}</span>
        </div>
        {row("Bank balance", bal)}
        {row(`− Earmarked in reserves (${reserves.length} pots)`, earmarked, { minus: true })}
        {row(`− Obligations due next 30 days (${dueSoon.length})`, due30, { minus: true })}
        <div className="row-split" style={{ padding: "6px 0", borderTop: "2px solid var(--border-strong)", marginTop: 2 }}>
          <strong>{free >= 0 ? "Free cash" : "Over-allocated"}</strong>
          <span className={`money money--lg ${free >= 0 ? "t-ok" : "t-danger"}`}>{free < 0 ? "− " : ""}{chf(Math.abs(free))}</span>
        </div>
        {free < 0
          ? <div className="notice notice--danger" style={{ marginTop: 6 }}>The envelopes + near-term obligations exceed the bank balance by {chf(-free)} — the plan needs incoming revenue or smaller earmarks.</div>
          : <div className="hint hint--sm" style={{ marginTop: 4 }}>Only this number is safe to spend on anything new (laptops → contribute it to the Equipment reserve first, so it stays earmarked).</div>}
      </div>

      <div className="finance-section">
        <div className="row-split" style={{ alignItems: "baseline" }}>
          <h3>Envelopes</h3>
          <button className="btn btn--outline btn--sm" onClick={contributeAll}
            title="Run this month's budgeted contributions across all budget lines">
            Contribute all budgets
          </button>
        </div>
        {budgetMsg && <div className="notice notice--info" style={{ margin: "6px 0 10px" }}>{budgetMsg}</div>}
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
            <div className="row-split" style={{ marginTop: 8, gap: 6 }}>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn btn--ok btn--sm" onClick={() => setMove({ reserve: r, kind: "contribute" })}>Contribute</button>
                <button className="btn btn--outline btn--sm" onClick={() => setMove({ reserve: r, kind: "withdraw" })}>Withdraw</button>
              </span>
              <span style={{ display: "flex", gap: 4 }}>
                <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(r)}>✎</button>
                <button className="btn btn--ghost btn--icon btn--icon-danger" title="Delete" onClick={() => setToDelete(r)}>🗑</button>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="finance-section">
        <h3>Month-by-month plan</h3>
        <div className="notice notice--info">The month-by-month plan — income, outflow, running cash, the
          salary/sick-leave scenario and the pre-fund — now lives on the <strong>Forecast</strong>.{" "}
          <a href="#" onClick={e => { e.preventDefault(); router.push("/forecast"); }}>Open the Forecast →</a></div>
      </div>

      {editingBalance && (
        <CashBalanceModal cash={cash} onClose={() => setEditingBalance(false)}
          onSaved={() => { setEditingBalance(false); load(); }} />
      )}
      {form !== undefined && (
        <ReserveForm reserve={form as ReserveEditable | null} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); load(); }} />
      )}
      {move && (
        <ContributeModal reserve={move.reserve} kind={move.kind} onClose={() => setMove(null)}
          onSaved={() => { setMove(null); load(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete reserve"
          message={<>Delete <strong>{toDelete.name}</strong> (earmarked {chf(toDelete.accumulated)})? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
