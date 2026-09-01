"use client";
// Invoices & Income — table, paid toggles, PDF links, segmented search.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Invoice, type SearchResponse } from "@/lib/api";
import { chf } from "@/lib/money";
import { Chip } from "@/components/ui";

const pad4 = (n: number) => String(n).padStart(4, "0");
const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

export default function InvoicesPage() {
  const [all, setAll] = useState<Invoice[] | null>(null);
  const [q, setQ] = useState("");
  const [ids, setIds] = useState<Set<number> | null>(null);
  const [chips, setChips] = useState<{ kind: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reload = useCallback(() => {
    api<Invoice[]>("/invoices").then(setAll).catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(reload, [reload]);

  const search = (value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    if (value.trim().length < 2) { setIds(null); setChips([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const d = await api<SearchResponse>(`/search?q=${encodeURIComponent("type:invoice " + value.trim())}&limit=1000`);
        setIds(new Set(d.results.filter(r => r.type === "invoice").map(r => r.id)));
        setChips((d.parsed ?? []).filter(c => c.kind !== "type"));
      } catch { setIds(null); }
    }, 250);
  };

  const toggle = async (inv: Invoice) => {
    await api(`/invoices/${inv.id}/status`, {
      method: "PATCH", body: JSON.stringify({ status: inv.paid_status === "paid" ? "unpaid" : "paid" }),
    });
    reload();
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!all) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const rows = ids ? all.filter(i => ids.has(i.id)) : all;

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Invoices &amp; Income</h1></div>
      <div className="page-search">
        <input type="search" className="control page-search__input" autoComplete="off" value={q}
          placeholder="Search invoices — number (#21), notes, 1500, >10000, 2026-06, q2, paid / unpaid / overdue"
          onChange={e => search(e.target.value)} />
        {chips.length > 0 && <div className="page-search__chips">{chips.map((c, i) => <Chip key={i}>{c.label}</Chip>)}</div>}
      </div>
      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>#</th><th>Period</th><th className="text-right">Hours</th>
            <th className="text-right">Subtotal</th><th className="text-right">VAT</th>
            <th className="text-right">Total</th><th>Due</th><th>Status</th><th className="text-right">PDF</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="empty-cell">No invoices match</td></tr>}
            {rows.map(i => (
              <tr key={i.id}>
                <td className="mono">#{pad4(i.invoice_number)}</td>
                <td>{i.month_name} {i.year}</td>
                <td className="text-right">{i.hours}</td>
                <td className="money">{chf(i.subtotal)}</td>
                <td className="money">{chf(i.tax)}</td>
                <td className="money"><strong>{chf(i.total)}</strong></td>
                <td className="mono">{i.due_date}</td>
                <td>
                  <button className="btn btn--ghost btn--sm" onClick={() => toggle(i)} title="Click to toggle">
                    <Chip mod={i.paid_status === "paid" ? "ok" : "warn"}>{i.paid_status === "paid" ? "Paid" : "Unpaid"}</Chip>
                  </button>
                </td>
                <td className="text-right">
                  <a href={`/api/invoices/${i.id}/pdf?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer">📄</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
