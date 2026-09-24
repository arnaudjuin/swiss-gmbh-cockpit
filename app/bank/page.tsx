"use client";
// Bank Statements — latest balance summary + statements table with file links.
// Data entry: upload (parse CAMT.053 → create), view parsed transactions with
// an optional reconcile/match pass, and delete.
import { useCallback, useEffect, useState } from "react";
import { api, type BankStatement } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat } from "@/components/ui";
import { BankUpload } from "@/components/BankUpload";
import { BankTransactions } from "@/components/BankTransactions";
import { TransferForm } from "@/components/TransferForm";
import { Chip } from "@/components/ui";
import { Modal, ConfirmModal } from "@/components/Modal";

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");
const tokenUrl = (path: string) => `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token())}`;

interface Transfer {
  id: number; transfer_date: string; direction: "personal_to_gmbh" | "gmbh_to_personal";
  amount: number; currency: string; description: string; has_file: boolean;
}
interface KkBalance {
  net_owed_to_personal: number; personal_to_gmbh: number; gmbh_to_personal: number;
  salary_transfers_excluded: number; reimbursement_transfers_excluded: number;
  personal_card_expenses: number;
}
const isAuto = (t: Transfer) => /^(Net salary|Personal-card reimbursement)/.test(t.description || "");

// The /bank-statements payload carries a notes field the shared type omits.
type Stmt = BankStatement & { notes: string | null };

// One reconciliation suggestion from POST /bank-statements/:id/analyze.
interface Proposal {
  type: string; summary: string; payload: Record<string, unknown>;
  endpoint: string; method: string; format: string; confidence: string; notes: string;
}
interface AnalyzeResult {
  source?: string; transactions_count?: number; proposals?: Proposal[];
  proposals_count?: number; error?: string;
}
const CONF_MOD: Record<string, "ok" | "warn" | "danger"> = { high: "ok", medium: "warn", low: "danger" };
const actionable = (p: Proposal) => p.type !== "info_only" && !!p.endpoint;

// Analyze modal — mirrors the classic analyzeBankStatement flow: POST the
// statement, list proposals, let the user apply the selected ones by firing
// each proposal's own endpoint (form or JSON body, as the proposal dictates).
function AnalyzeModal({ statement, onClose, onApplied }: {
  statement: BankStatement; onClose: () => void; onApplied: () => void;
}) {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<Record<number, "applying" | "ok" | "fail">>({});
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let live = true;
    api<AnalyzeResult>(`/bank-statements/${statement.id}/analyze`, { method: "POST" })
      .then(d => {
        if (!live) return;
        setResult(d);
        const props = d.proposals ?? [];
        // Default-check high-confidence actionable proposals (classic default).
        setSel(new Set(props.map((p, i) => (actionable(p) && p.confidence === "high" ? i : -1)).filter(i => i >= 0)));
      })
      .catch(e => live && setError(String((e as Error).message ?? e)));
    return () => { live = false; };
  }, [statement.id]);

  const props = result?.proposals ?? [];
  const actionableIdx = props.map((p, i) => (actionable(p) ? i : -1)).filter(i => i >= 0);
  const toggle = (i: number) => setSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleAll = (checked: boolean) => setSel(checked ? new Set(actionableIdx) : new Set());

  const apply = async () => {
    setApplying(true);
    for (const i of [...sel]) {
      const p = props[i];
      if (!p || !actionable(p)) continue;
      setStatus(s => ({ ...s, [i]: "applying" }));
      try {
        const path = p.endpoint.replace(/^\/api/, "");
        let body: BodyInit;
        if ((p.format || "form") === "form") {
          const fd = new FormData();
          for (const [k, v] of Object.entries(p.payload || {})) if (v !== undefined && v !== null) fd.append(k, String(v));
          body = fd;
        } else {
          body = JSON.stringify(p.payload || {});
        }
        await api(path, { method: p.method || "POST", body });
        setStatus(s => ({ ...s, [i]: "ok" }));
        setSel(s => { const n = new Set(s); n.delete(i); return n; });
      } catch {
        setStatus(s => ({ ...s, [i]: "fail" }));
      }
    }
    setApplying(false);
    onApplied();
  };

  return (
    <Modal wide title={`Review proposals — ${statement.period_start} → ${statement.period_end}`} onClose={onClose}>
      {error && <div className="notice notice--danger">{error}</div>}
      {!result && !error && <div className="hint" style={{ padding: 20 }}>Analyzing…</div>}
      {result?.error && <div className="notice notice--warn">{result.error}</div>}
      {result && !result.error && (
        <>
          <div className="hint hint--sm" style={{ marginBottom: 8 }}>
            Source: {result.source || "?"} · {result.transactions_count ?? 0} transactions parsed · {result.proposals_count ?? props.length} proposals
          </div>
          {props.length === 0 ? (
            <div className="empty-state">No proposals — statement matches the records already.</div>
          ) : (
            <>
              <div className="row-split" style={{ marginBottom: 8 }}>
                <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={sel.size > 0 && sel.size === actionableIdx.length}
                    onChange={e => toggleAll(e.target.checked)} disabled={applying || actionableIdx.length === 0} />
                  Select all · {sel.size} of {actionableIdx.length} selected
                </label>
                <button className="btn btn--primary btn--sm" onClick={apply} disabled={applying || sel.size === 0}>
                  {applying ? "Applying…" : `Apply selected (${sel.size})`}
                </button>
              </div>
              <div className="table-card">
                <table className="table table--compact">
                  <thead><tr><th></th><th>Type</th><th>Confidence</th><th>Proposal</th><th className="text-right">Status</th></tr></thead>
                  <tbody>
                    {props.map((p, i) => (
                      <tr key={i}>
                        <td>{actionable(p)
                          ? <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)}
                              disabled={applying || status[i] === "ok"} />
                          : <span className="hint" title="Info only — no action">—</span>}</td>
                        <td><Chip mod={p.type === "info_only" ? "info" : undefined}>{p.type.replace(/_/g, " ")}</Chip></td>
                        <td><Chip mod={CONF_MOD[p.confidence]}>{p.confidence}</Chip></td>
                        <td>
                          <div style={{ whiteSpace: "pre-wrap" }}>{p.summary}</div>
                          {p.notes && <div className="hint hint--sm" style={{ marginTop: 4 }}>💡 {p.notes}</div>}
                          {p.endpoint && <div className="hint hint--sm ref" style={{ marginTop: 2 }}>{p.method || "POST"} {p.endpoint}</div>}
                        </td>
                        <td className="text-right hint hint--sm">
                          {status[i] === "applying" && "Applying…"}
                          {status[i] === "ok" && <span className="t-ok">✓ Applied</span>}
                          {status[i] === "fail" && <span className="t-danger">✗ Failed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export default function BankPage() {
  const [rows, setRows] = useState<Stmt[] | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [balance, setBalance] = useState<KkBalance | null>(null);
  const [showAuto, setShowAuto] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [viewing, setViewing] = useState<BankStatement | null>(null);
  const [analyzing, setAnalyzing] = useState<BankStatement | null>(null);
  const [toDelete, setToDelete] = useState<BankStatement | null>(null);
  const [delTransfer, setDelTransfer] = useState<Transfer | null>(null);
  const [stmtYear, setStmtYear] = useState("");

  const load = useCallback(() => {
    setError("");
    api<Stmt[]>("/bank-statements").then(setRows).catch(e => setError(String(e.message ?? e)));
    api<Transfer[]>("/transfers").then(setTransfers).catch(() => setTransfers([]));
    api<KkBalance>("/transfers/balance").then(setBalance).catch(() => setBalance(null));
  }, []);
  useEffect(load, [load]);

  const remove = async (s: BankStatement) => {
    try { await api(`/bank-statements/${s.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };
  const removeTransfer = async (t: Transfer) => {
    try { await api(`/transfers/${t.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const latest = rows.length
    ? [...rows].sort((a, b) => b.period_end.localeCompare(a.period_end))[0]
    : null;
  const stmtYears = [...new Set(rows.map(s => s.period_start.slice(0, 4)))].sort().reverse();
  const filteredStmts = stmtYear ? rows.filter(s => s.period_start.startsWith(stmtYear)) : rows;

  // Kontokorrent headline: one net number, no sign gymnastics (port of loadTransfers).
  const net = balance?.net_owed_to_personal ?? 0;
  const ownerOut = balance
    ? balance.gmbh_to_personal - balance.salary_transfers_excluded - balance.reimbursement_transfers_excluded
    : 0;
  const breakdownParts = balance ? [
    `you put in ${chf(balance.personal_to_gmbh)}`,
    `repaid to you ${chf(ownerOut)}`,
    ...(balance.personal_card_expenses > 0 ? [`fronted bills awaiting reimbursement ${chf(balance.personal_card_expenses)}`] : []),
  ] : [];

  // Owner-relevant rows stay prominent; auto-logged rows (salary, card
  // settlements) tuck behind a toggle. Running balance is owner rows only,
  // computed oldest→newest, displayed newest-first. + = GmbH owes you.
  const mainRows = transfers.filter(t => !isAuto(t));
  const autoRows = transfers.filter(isAuto);
  const autoTotal = autoRows.reduce((s, t) => s + t.amount, 0);
  const runBal: Record<number, number> = {};
  let run = 0;
  [...mainRows]
    .sort((a, b) => (a.transfer_date + a.id).localeCompare(b.transfer_date + b.id))
    .forEach(t => { run += t.direction === "personal_to_gmbh" ? t.amount : -t.amount; runBal[t.id] = run; });

  const transferRow = (t: Transfer, auto = false) => {
    const bal = runBal[t.id];
    return (
      <tr key={t.id} style={auto ? { opacity: 0.65 } : undefined}>
        <td className="date">{t.transfer_date}</td>
        <td>{t.direction === "personal_to_gmbh"
          ? <span className="t-info">Personal → GmbH</span>
          : <span className="t-warn">GmbH → Personal</span>}</td>
        <td>{t.description || "—"}</td>
        <td className="money">{t.currency} {t.amount.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td className={`money ${bal === undefined ? "t-muted" : bal >= 0 ? "t-ok" : "t-danger"}`}
          title={bal === undefined ? undefined : `${bal >= 0 ? "GmbH owes you" : "You owe the GmbH"} after this movement`}>
          {bal === undefined ? "—" : `${bal > 0 ? "+" : ""}${chf(bal)}`}
        </td>
        <td>{t.has_file
          ? <a href={tokenUrl(`/api/transfers/${t.id}/file`)} target="_blank" rel="noreferrer" className="btn btn--ghost btn--icon" title="View file">📄</a>
          : "—"}</td>
        <td className="text-right">
          <button className="btn btn--ghost btn--icon btn--icon-danger" title="Delete" onClick={() => setDelTransfer(t)}>🗑</button>
        </td>
      </tr>
    );
  };

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Bank Statements</h1>
        <button className="btn btn--primary" onClick={() => setUploading(true)}>＋ Upload statement</button>
      </div>

      {latest && (
        <div className="stats-grid">
          <Stat label={`Latest balance · ${latest.bank}`} value={chf(latest.closing_balance)} mod="info"
            hint={`${latest.account_label} · as of ${latest.period_end}`} />
          <Stat label="Opening balance" value={chf(latest.opening_balance)}
            hint={`period ${latest.period_start} → ${latest.period_end}`} />
        </div>
      )}

      {stmtYears.length > 1 && (
        <div className="filter-bar" style={{ flexWrap: "wrap" }}>
          <label>Year:</label>
          <select className="control" style={{ width: "auto" }} value={stmtYear} onChange={e => setStmtYear(e.target.value)}>
            <option value="">All</option>{stmtYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="hint" style={{ marginLeft: "auto", fontWeight: 600 }}>{filteredStmts.length} statement{filteredStmts.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Bank</th><th>Period</th><th className="text-right">Opening</th>
            <th className="text-right">Closing</th><th className="text-right">Δ</th>
            <th>Notes</th><th className="text-right">Files</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {filteredStmts.length === 0 && <tr><td colSpan={8} className="empty-cell">No statements match</td></tr>}
            {filteredStmts.map(s => (
              <tr key={s.id}>
                <td><strong>{s.bank}</strong> <span className="hint">{s.account_label}</span></td>
                <td className="mono">{s.period_start} → {s.period_end}</td>
                <td className="money">{chf(s.opening_balance)}</td>
                <td className="money"><strong>{chf(s.closing_balance)}</strong></td>
                <td className={`money ${s.closing_balance - s.opening_balance >= 0 ? "t-ok" : "t-danger"}`}>
                  {chf(s.closing_balance - s.opening_balance)}
                </td>
                <td className="hint hint--sm">{s.notes || ""}</td>
                <td className="text-right">
                  {s.has_pdf && <a href={`/api/bank-statements/${s.id}/file?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer" title="PDF">📄</a>}
                  {!s.has_pdf && !s.has_xml && <span className="hint">–</span>}
                </td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  {(s.has_xml || s.has_pdf) && (
                    <button className="btn btn--ghost btn--icon" title="Analyze — propose data corrections from this statement"
                      onClick={() => setAnalyzing(s)}>🔎</button>
                  )}
                  {s.has_xml && (
                    <button className="btn btn--ghost btn--icon" title="View transactions"
                      onClick={() => setViewing(s)}>🔍</button>
                  )}
                  <button className="btn btn--ghost btn--icon btn--icon-danger" title="Delete"
                    onClick={() => setToDelete(s)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Owner ledger (Kontokorrent — you ↔ GmbH), merged from the classic Transfers tab */}
      <div className="finance-section" style={{ marginTop: 20 }}>
        <h3 className="row-split" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>Owner ledger <span className="hint" style={{ fontWeight: 400 }}>(Kontokorrent — you ↔ GmbH)</span></span>
          <span className="btn-group">
            <a className="btn btn--outline btn--sm" href={tokenUrl("/api/transfers/export.csv")} download
              title="Download all transfers as CSV with running totals">Export CSV</a>
            <a className="btn btn--outline btn--sm" href={tokenUrl("/api/bank-statements/0/export.xlsx")} download
              title="Full-history Excel: every statement combined, lifetime Kontokorrent recap">Excel (full history)</a>
            <button className="btn btn--primary btn--sm" onClick={() => setLogging(true)}>＋ Log Transfer</button>
          </span>
        </h3>
        <div className="panel headline-panel" style={{ marginBottom: 12 }}>
          <div className="headline-panel__value">
            {Math.abs(net) < 0.005
              ? <span className="t-muted">Settled — nobody owes anybody</span>
              : net > 0
                ? <>GmbH owes you <span className="headline-panel__value--ok">{chf(net)}</span></>
                : <>You owe the GmbH <span className="headline-panel__value--danger">{chf(-net)}</span></>}
          </div>
          {balance && (
            <div className="headline-panel__sub">
              {breakdownParts.join(" · ")} — salaries excluded (wages, not debt)
            </div>
          )}
        </div>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr>
              <th>Date</th><th>Direction</th><th>Description</th>
              <th className="text-right">Amount</th>
              <th className="text-right" title="Net position after this movement: + = GmbH owes you">Balance</th>
              <th>File</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {transfers.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No transfers yet — log money flowing between your personal account and the GmbH.</td></tr>
              )}
              {transfers.length > 0 && mainRows.length === 0 && (
                <tr><td colSpan={7} className="hint" style={{ textAlign: "center", padding: 14 }}>No owner transfers yet — dividends, capital contributions and manual movements will appear here.</td></tr>
              )}
              {mainRows.map(t => transferRow(t))}
              {autoRows.length > 0 && (
                <tr style={{ cursor: "pointer", background: "var(--bg)" }} onClick={() => setShowAuto(v => !v)}>
                  <td colSpan={7} className="hint">
                    {showAuto ? "▾" : "▸"} {autoRows.length} auto-logged (salary &amp; reimbursements) — {chf(autoTotal)} — click to show/hide
                  </td>
                </tr>
              )}
              {showAuto && autoRows.map(t => transferRow(t, true))}
            </tbody>
          </table>
        </div>
      </div>

      {uploading && (
        <BankUpload onClose={() => setUploading(false)}
          onSaved={() => { setUploading(false); load(); }} />
      )}
      {logging && (
        <TransferForm onClose={() => setLogging(false)}
          onSaved={() => { setLogging(false); load(); }} />
      )}
      {delTransfer && (
        <ConfirmModal title="Delete transfer"
          message={<>Delete this transfer of <strong>{delTransfer.currency} {delTransfer.amount.toLocaleString("de-CH", { minimumFractionDigits: 2 })}</strong>? This can&apos;t be undone.</>}
          onConfirm={() => removeTransfer(delTransfer)} onClose={() => setDelTransfer(null)} />
      )}
      {viewing && <BankTransactions statement={viewing} onClose={() => setViewing(null)} />}
      {analyzing && (
        <AnalyzeModal statement={analyzing} onClose={() => setAnalyzing(null)} onApplied={load} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete bank statement"
          message={<>Delete the statement for <strong>{toDelete.period_start} → {toDelete.period_end}</strong>? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
