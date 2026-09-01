"use client";
// Bills & Documents — port of the classic page (static/js/05-accounting.js):
// year/category filters, the segmented search bar (server query language,
// locked to bills), totals line, documents table with file links.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Bill, type SearchResponse } from "@/lib/api";
import { chf } from "@/lib/money";
import { Chip } from "@/components/ui";

const CATEGORIES = ["Office Supplies", "Software/Subscriptions", "Professional Services",
  "Insurance", "Vehicle", "Rent", "Telecom", "Legal", "Bank Fees", "Payroll Settlement", "Taxes / VAT", "Other"];

function fileUrl(id: number) {
  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : "";
  return `/api/accounting/${id}/file?token=${encodeURIComponent(token ?? "")}`;
}

export default function BillsPage() {
  const [all, setAll] = useState<Bill[] | null>(null);
  const [year, setYear] = useState("");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [ids, setIds] = useState<Set<number> | null>(null);
  const [chips, setChips] = useState<{ kind: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api<Bill[]>("/accounting").then(setAll).catch(e => setError(String(e.message ?? e)));
  }, []);

  const search = useCallback((value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    if (value.trim().length < 2) { setIds(null); setChips([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const d = await api<SearchResponse>(
          `/search?q=${encodeURIComponent("type:bill " + value.trim())}&limit=1000`);
        setIds(new Set(d.results.filter(r => r.type === "bill").map(r => r.id)));
        setChips((d.parsed ?? []).filter(c => c.kind !== "type"));
      } catch { setIds(null); }
    }, 250);
  }, []);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!all) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const years = [...new Set(all.map(b => b.doc_date.slice(0, 4)))].sort().reverse();
  let rows = all;
  if (year) rows = rows.filter(b => b.doc_date.startsWith(year));
  if (cat) rows = rows.filter(b => b.category === cat);
  if (ids) rows = rows.filter(b => ids.has(b.id));
  else if (q.trim()) rows = rows.filter(b =>
    (b.vendor + " " + b.description).toLowerCase().includes(q.trim().toLowerCase()));
  rows = [...rows].sort((a, b) => b.doc_date.localeCompare(a.doc_date));

  const total = rows.reduce((s, b) => s + b.amount, 0);
  const personalOpen = rows.filter(b => b.paid_via === "personal" && !b.reimbursed_at)
    .reduce((s, b) => s + b.amount, 0);
  const chipMod: Record<string, "ok" | "info" | "warn" | "owner"> =
    { amount: "ok", date: "info", status: "warn", type: "owner" };

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Bills &amp; Documents</h1></div>

      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <label>Year:</label>
        <select className="control" style={{ width: "auto" }} value={year} onChange={e => setYear(e.target.value)}>
          <option value="">All</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Category:</label>
        <select className="control" style={{ width: "auto" }} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="hint" style={{ marginLeft: "auto", fontWeight: 600 }}>
          {rows.length} documents = {chf(total)}
          {personalOpen > 0 && <> — of which {chf(personalOpen)} fronted on the personal card, not yet reimbursed</>}
        </span>
      </div>

      <div className="page-search">
        <input type="search" className="control page-search__input" autoComplete="off" value={q}
          placeholder='Search bills & documents — vendor, text, "exact phrase", 1500, >1000, 2026-07, last month, paid / unpaid'
          onChange={e => search(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") search(""); }} />
        {chips.length > 0 && (
          <div className="page-search__chips">
            {chips.map((c, i) => <Chip key={i} mod={chipMod[c.kind]}>{c.label}</Chip>)}
          </div>
        )}
      </div>

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Date</th><th>Vendor</th><th>Description</th><th>Category</th>
            <th className="text-right">Amount</th><th>Due</th><th>Status</th><th>File</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="empty-cell">No documents match</td></tr>}
            {rows.map(b => (
              <tr key={b.id}>
                <td className="mono">{b.doc_date}</td>
                <td>
                  <strong>{b.vendor}</strong>{" "}
                  {b.paid_via === "personal" && <Chip mod="owner">💳 personal</Chip>}
                </td>
                <td className="hint" style={{ maxWidth: 340 }}>{b.description}</td>
                <td><span className="chip chip--sm">{b.category}</span></td>
                <td className="money">
                  {chf(b.amount)}
                  {b.original_currency && b.original_currency !== "CHF" && (
                    <div className="hint">{b.original_amount?.toFixed(2)} {b.original_currency}</div>
                  )}
                </td>
                <td className="mono">{b.due_date ?? "–"}</td>
                <td><Chip mod={b.status === "paid" ? "ok" : "warn"}>{b.status === "paid" ? "Paid" : "Unpaid"}</Chip></td>
                <td>{b.has_file
                  ? <a href={fileUrl(b.id)} target="_blank" rel="noreferrer" title="Open document">📎</a>
                  : <span className="hint">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
