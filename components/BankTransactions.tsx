"use client";
// View a statement's parsed transactions (GET /bank-statements/:id/transactions,
// live-parsed from the stored XML/CSV — read-only) plus an optional reconcile
// pass: POST the rows to /bank/csv-match to get suggested bill/obligation/
// invoice matches, then POST /bank/apply-match to mark the chosen one paid.
// Field names match app/api/bank/csv-match/route.ts + apply-match/route.ts.
import { useCallback, useEffect, useState } from "react";
import { api, type BankStatement } from "@/lib/api";
import { chf } from "@/lib/money";
import { Modal } from "@/components/Modal";

interface TxRow {
  date: string; value_date: string; amount: number; counterparty: string;
  description: string; transaction_no: string; reference: string; balance: number | null;
  sub_entries?: { amount: number; counterparty: string; description: string }[];
}
interface TxResponse {
  source?: string | null; period_start?: string; period_end?: string;
  opening?: number | null; closing?: number | null; currency?: string;
  count?: number; total_in?: number; total_out?: number; net?: number;
  transactions: TxRow[]; error?: string;
}
// csv-match / apply-match wire types.
interface MatchCandidate { type: "bill" | "obligation" | "invoice"; id: number; label: string; amount: number; due: string | null }
interface CsvRow { date: string; description: string; amount: number; reference: string | null }
interface MatchResult { csv_row: CsvRow; matches: MatchCandidate[]; suggested: MatchCandidate | null }

export function BankTransactions({ statement, onClose }: { statement: BankStatement; onClose: () => void }) {
  const [data, setData] = useState<TxResponse | null>(null);
  const [error, setError] = useState("");
  const [matching, setMatching] = useState(false);
  // keyed by transaction row index → its match result / applied state.
  const [matches, setMatches] = useState<Record<number, MatchResult> | null>(null);
  const [applied, setApplied] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    setError("");
    api<TxResponse>(`/bank-statements/${statement.id}/transactions`)
      .then(setData).catch(e => setError(String(e.message ?? e)));
  }, [statement.id]);
  useEffect(load, [load]);

  const runMatch = async () => {
    if (!data?.transactions?.length) return;
    setMatching(true); setError("");
    try {
      const rows = data.transactions.map(t => ({
        date: t.date, description: t.description || t.counterparty, amount: t.amount, reference: t.reference,
      }));
      const res = await api<{ rows: MatchResult[] }>("/bank/csv-match",
        { method: "POST", body: JSON.stringify({ rows }) });
      const map: Record<number, MatchResult> = {};
      res.rows.forEach((r, i) => { map[i] = r; });
      setMatches(map);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setMatching(false); }
  };

  const apply = async (idx: number, m: MatchCandidate, csv_row: CsvRow) => {
    try {
      const res = await api<{ message: string }>("/bank/apply-match",
        { method: "POST", body: JSON.stringify({ type: m.type, id: m.id, csv_row }) });
      setApplied(prev => ({ ...prev, [idx]: res.message || "Applied" }));
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  return (
    <Modal title={`Transactions · ${statement.period_start} → ${statement.period_end}`} onClose={onClose} wide>
      {error && <div className="notice notice--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div className="hint">Loading transactions…</div>}
      {data?.error && <div className="notice notice--info">{data.error}</div>}
      {data && !data.error && (
        <>
          <div className="row-split" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <span className="hint">
              {data.source ?? "—"} · {data.count ?? 0} transactions ·{" "}
              in <span className="money t-ok">{chf(data.total_in ?? 0)}</span> ·{" "}
              out <span className="money t-danger">{chf(data.total_out ?? 0)}</span> ·{" "}
              net <span className="money">{chf(data.net ?? 0)}</span>
            </span>
            <button type="button" className="btn btn--outline btn--sm" onClick={runMatch}
              disabled={matching || !data.transactions.length}>
              {matching ? "Matching…" : "🔎 Auto-match"}</button>
          </div>
          <div className="table-card">
            <table className="table table--compact table--zebra">
              <thead><tr>
                <th>Date</th><th>Counterparty</th><th>Description</th>
                <th className="text-right">Amount</th>
                {matches && <th>Match</th>}
              </tr></thead>
              <tbody>
                {data.transactions.length === 0 &&
                  <tr><td colSpan={matches ? 5 : 4} className="empty-cell">No transactions parsed</td></tr>}
                {data.transactions.map((t, i) => {
                  const mr = matches?.[i];
                  const suggestion = mr?.suggested;
                  return (
                    <tr key={i}>
                      <td className="mono">{t.date}</td>
                      <td>{t.counterparty || "—"}</td>
                      <td className="hint" style={{ maxWidth: 320 }}>{t.description}</td>
                      <td className={`money ${t.amount >= 0 ? "t-ok" : "t-danger"}`}>{chf(t.amount)}</td>
                      {matches && (
                        <td>
                          {applied[i]
                            ? <span className="t-ok">✓ {applied[i]}</span>
                            : suggestion
                              ? <span className="row-split" style={{ gap: 6 }}>
                                  <span className="hint">{suggestion.label} ({chf(suggestion.amount)})</span>
                                  <button type="button" className="btn btn--ok btn--sm"
                                    onClick={() => apply(i, suggestion, mr!.csv_row)}>Apply</button>
                                </span>
                              : <span className="hint">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
