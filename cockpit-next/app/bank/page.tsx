"use client";
// Bank Statements — latest balance summary + statements table with file links.
import { useEffect, useState } from "react";
import { api, type BankStatement } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat } from "@/components/ui";

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

export default function BankPage() {
  const [rows, setRows] = useState<BankStatement[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<BankStatement[]>("/bank-statements").then(setRows).catch(e => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const latest = rows.length
    ? [...rows].sort((a, b) => b.period_end.localeCompare(a.period_end))[0]
    : null;

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Bank Statements</h1></div>

      {latest && (
        <div className="stats-grid">
          <Stat label={`Latest balance · ${latest.bank}`} value={chf(latest.closing_balance)} mod="info"
            hint={`${latest.account_label} · as of ${latest.period_end}`} />
          <Stat label="Opening balance" value={chf(latest.opening_balance)}
            hint={`period ${latest.period_start} → ${latest.period_end}`} />
          <Stat label="IBAN" value={latest.iban || "—"} hint={latest.currency} />
        </div>
      )}

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Bank</th><th>Period</th><th className="text-right">Opening</th>
            <th className="text-right">Closing</th><th className="text-right">Δ</th><th className="text-right">Files</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="empty-cell">No statements uploaded yet</td></tr>}
            {rows.map(s => (
              <tr key={s.id}>
                <td><strong>{s.bank}</strong> <span className="hint">{s.account_label}</span></td>
                <td className="mono">{s.period_start} → {s.period_end}</td>
                <td className="money">{chf(s.opening_balance)}</td>
                <td className="money"><strong>{chf(s.closing_balance)}</strong></td>
                <td className={`money ${s.closing_balance - s.opening_balance >= 0 ? "t-ok" : "t-danger"}`}>
                  {chf(s.closing_balance - s.opening_balance)}
                </td>
                <td className="text-right">
                  {s.has_pdf && <a href={`/api/bank-statements/${s.id}/file?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer" title="PDF">📄</a>}
                  {!s.has_pdf && !s.has_xml && <span className="hint">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
