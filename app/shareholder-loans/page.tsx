"use client";
// Shareholder Loans — was never ported from the classic SPA. Summary stats
// (net owed, in/out, subordinated, repaid) + a list with New / edit / delete.
// Fields and verbs mirror app/api/shareholder-loans exactly (FormData body).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat, Chip } from "@/components/ui";
import { ShareholderLoanForm } from "@/components/ShareholderLoanForm";
import { ConfirmModal } from "@/components/Modal";

// Types are local — lib/api.ts is off-limits. Shape matches loanToDict() in
// app/api/shareholder-loans/route.ts.
export interface ShareholderLoan {
  id: number; loan_date: string; amount: number; currency: string;
  direction: "gmbh_to_shareholder" | "shareholder_to_gmbh";
  is_subordinated: boolean; notes: string | null; document_file: string | null;
  repayment_date: string | null; is_repaid: boolean; created_at: string | null;
}
interface LoanSummary {
  net_owed_to_shareholder: number; total_in: number; total_out: number;
  subordinated_amount: number; repaid_total: number;
}

const DIR_LABEL: Record<ShareholderLoan["direction"], string> = {
  shareholder_to_gmbh: "Shareholder → GmbH",
  gmbh_to_shareholder: "GmbH → Shareholder",
};

export default function ShareholderLoansPage() {
  const [loans, setLoans] = useState<ShareholderLoan[] | null>(null);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [error, setError] = useState("");
  // undefined = form closed; null = adding; ShareholderLoan = editing that loan.
  const [form, setForm] = useState<ShareholderLoan | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<ShareholderLoan | null>(null);

  const load = useCallback(() => {
    api<ShareholderLoan[]>("/shareholder-loans").then(setLoans).catch(e => setError(String(e.message ?? e)));
    api<LoanSummary>("/shareholder-loans/summary").then(setSummary).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const remove = async (l: ShareholderLoan) => {
    try { await api(`/shareholder-loans/${l.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!loans) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const net = summary?.net_owed_to_shareholder ?? 0;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Shareholder Loans</h1>
        <button className="btn btn--primary" onClick={() => setForm(null)}>＋ New loan</button>
      </div>

      {summary && (
        <div className="stats-grid">
          <Stat label="Net owed to shareholder" value={chf(net)} mod={net >= 0 ? "owner" : "danger"}
            hint={net >= 0 ? "GmbH owes you (net)" : "You owe the GmbH (net)"} />
          <Stat label="Shareholder → GmbH" value={chf(summary.total_in)} mod="ok"
            hint="Total lent into the company" />
          <Stat label="GmbH → Shareholder" value={chf(summary.total_out)} mod="warn"
            hint="Total drawn out of the company" />
          <Stat label="Subordinated" value={chf(summary.subordinated_amount)} mod="info"
            hint="Rangrücktritt — inbound only" />
          <Stat label="Repaid" value={chf(summary.repaid_total)}
            hint="Marked repaid, both directions" />
        </div>
      )}

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Date</th><th>Direction</th><th className="text-right">Amount</th>
            <th>Flags</th><th>Repayment</th><th>Notes</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {loans.length === 0 && <tr><td colSpan={7} className="empty-cell">No shareholder loans recorded</td></tr>}
            {loans.map(l => (
              <tr key={l.id}>
                <td className="mono">{l.loan_date}</td>
                <td>
                  <Chip mod={l.direction === "shareholder_to_gmbh" ? "ok" : "warn"}>{DIR_LABEL[l.direction]}</Chip>
                </td>
                <td className="money">
                  {chf(l.amount)}
                  {l.currency && l.currency !== "CHF" && <div className="hint">{l.currency}</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {l.is_subordinated && <Chip mod="info">subordinated</Chip>}{" "}
                  {l.is_repaid && <Chip mod="ok">repaid</Chip>}
                  {!l.is_subordinated && !l.is_repaid && <span className="hint">–</span>}
                </td>
                <td className="mono">{l.repayment_date ?? "–"}</td>
                <td className="hint" style={{ maxWidth: 300 }}>{l.notes ?? ""}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(l)}>✎</button>
                  <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setToDelete(l)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form !== undefined && (
        <ShareholderLoanForm loan={form} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); load(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete shareholder loan"
          message={<>Delete the {DIR_LABEL[toDelete.direction]} loan of <strong>{chf(toDelete.amount)}</strong>? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
