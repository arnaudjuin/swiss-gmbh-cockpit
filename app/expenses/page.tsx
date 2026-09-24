"use client";
// Travel expenses & reports — reimbursable pass-through costs.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { badgeClass } from "@/lib/badge";
import { ExpenseForm, type Expense } from "@/components/ExpenseForm";
import { ImportFolderModal } from "@/components/ImportFolderModal";
import { ConfirmModal } from "@/components/Modal";

interface Report { id: number; report_number: number; year: number; month: number | null; total: number; expense_count: number; reimbursed_at: string | null; created_at: string }
interface Trip { id: number; name: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Bulk recategorize targets — must match the backend's VALID set (bulk/recategorize).
const BULK_CATEGORIES = ["Meals", "Transport", "Accommodation", "Other"];
const pad4 = (n: number) => String(n).padStart(4, "0");

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");
const reportUrl = (r: Pick<Report, "year" | "month">, kind: "pdf" | "excel", download = false) =>
  `/api/expenses/report/${r.year}/${kind}?${r.month ? `month=${r.month}&` : ""}${download ? "download=1&" : ""}token=${encodeURIComponent(token())}`;

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [form, setForm] = useState<Expense | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Expense | null>(null);
  const [toDeleteReport, setToDeleteReport] = useState<Report | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [year, setYear] = useState("");
  const [cat, setCat] = useState("");
  const [trip, setTrip] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<Expense[]>("/expenses"),
      api<Report[]>("/expenses/reports").catch(() => []),
      api<Trip[]>("/trips").catch(() => []),
    ])
      .then(([e, r, t]) => { setRows(e); setReports(r); setTrips(t); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const remove = async (e: Expense) => {
    try { await api(`/expenses/${e.id}`, { method: "DELETE" }); load(); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };
  const removeReport = async (r: Report) => {
    try { await api(`/expenses/reports/${r.id}`, { method: "DELETE" }); load(); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };

  // ── Bulk selection ──
  const clearSelection = () => setSelected(new Set());
  const toggleOne = (id: number, checked: boolean) => setSelected(prev => {
    const next = new Set(prev);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const toggleAll = (ids: number[], checked: boolean) => setSelected(prev => {
    const next = new Set(prev);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });

  const bulkDelete = async () => {
    if (!selected.size) return;
    try {
      await api("/expenses/bulk/delete", { method: "POST", body: JSON.stringify({ ids: [...selected] }) });
      setFlash(`${selected.size} expense${selected.size > 1 ? "s" : ""} deleted`);
      clearSelection(); load();
    } catch (err) { setError(String((err as Error).message ?? err)); }
  };
  const bulkRecategorize = async () => {
    if (!selected.size) return;
    if (!bulkCat) { setFlash("Select a category first."); return; }
    try {
      await api("/expenses/bulk/recategorize", { method: "POST", body: JSON.stringify({ ids: [...selected], category: bulkCat }) });
      setFlash(`${selected.size} expense${selected.size > 1 ? "s" : ""} re-categorized to ${bulkCat}`);
      setBulkCat(""); clearSelection(); load();
    } catch (err) { setError(String((err as Error).message ?? err)); }
  };

  // Trigger a file download without navigating away (keeps the SPA in place).
  const download = (url: string) => {
    const a = document.createElement("a");
    a.href = url; a.style.display = "none";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const downloadExcel = () => {
    if (!year) { setFlash("Select a year first."); return; }
    setFlash("");
    download(reportUrl({ year: Number(year), month: month ? Number(month) : null }, "excel"));
  };

  const generateReport = async () => {
    if (!year) { setFlash("Select a year first."); return; }
    setFlash(""); setGenerating(true);
    const m = month ? `?month=${month}` : "";
    const period = month ? `${MON[Number(month) - 1]} ${year}` : year;
    try {
      const r = await api<{ report_number: number; total: number }>(`/expenses/report/${year}${m}`, { method: "POST" });
      setFlash(`Report #${pad4(r.report_number)} (${period}) generated — ${chf(r.total)}`);
      load();
      download(reportUrl({ year: Number(year), month: month ? Number(month) : null }, "pdf", true));
    } catch (err) { setError(String((err as Error).message ?? err)); }
    finally { setGenerating(false); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const years = [...new Set(rows.map(e => e.expense_date.slice(0, 4)))].sort().reverse();
  const cats = [...new Set(rows.map(e => e.category).filter(Boolean))].sort();
  let filtered = rows;
  if (year) filtered = filtered.filter(e => e.expense_date.startsWith(year));
  if (cat) filtered = filtered.filter(e => e.category === cat);
  if (trip === "__none__") filtered = filtered.filter(e => !e.trip_id);
  else if (trip) filtered = filtered.filter(e => String(e.trip_id) === trip);
  if (search.trim()) { const q = search.toLowerCase().trim(); filtered = filtered.filter(e => e.description.toLowerCase().includes(q)); }

  const filteredIds = filtered.map(e => e.id);
  const allChecked = filtered.length > 0 && filtered.every(e => selected.has(e.id));

  const scanCell = (e: Expense) => e.has_scan
    ? <a href={`/api/expenses/${e.id}/scan?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer"
        title={`View receipt (${e.scan_type ?? "file"})`}>{e.scan_type === "pdf" ? "📄" : "🖼️"}</a>
    : <span className="hint">–</span>;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Travel Expenses</h1>
        <div className="btn-group">
          <button className="btn btn--outline" onClick={() => setShowImport(true)}>Import Folder</button>
          <button className="btn btn--outline" onClick={downloadExcel}>Excel</button>
          <select className="control" style={{ width: "auto" }} value={month} onChange={e => setMonth(e.target.value)}
            title="Optional: limit report to a single month">
            <option value="">Whole year</option>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <button className="btn btn--outline" onClick={generateReport} disabled={generating}>
            {generating ? "Generating…" : "Generate Report"}</button>
          <button className="btn btn--primary" onClick={() => setForm(null)}>＋ Add Expense</button>
        </div>
      </div>

      {flash && <div className="notice notice--info" style={{ marginBottom: 12 }}>{flash}</div>}

      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <label>Year:</label>
        <select className="control" style={{ width: "auto" }} value={year} onChange={e => setYear(e.target.value)}>
          <option value="">All</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Category:</label>
        <select className="control" style={{ width: "auto" }} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label>Trip:</label>
        <select className="control" style={{ width: "auto" }} value={trip} onChange={e => setTrip(e.target.value)}>
          <option value="">All</option>
          <option value="__none__">(no trip)</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label>Search:</label>
        <input className="control" style={{ width: 160 }} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="description…" />
        <span className="hint" style={{ marginLeft: "auto", fontWeight: 600 }}>
          {filtered.length} receipt{filtered.length !== 1 ? "s" : ""} = <span className="money">{chf(filtered.reduce((s, e) => s + e.amount, 0))}</span>
        </span>
      </div>

      {selected.size > 0 && (
        <div className="notice notice--info row-split" style={{ marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
          <span className="row-split" style={{ flex: 1, justifyContent: "flex-end" }}>
            <select className="control" style={{ width: "auto" }} value={bulkCat} onChange={e => setBulkCat(e.target.value)}
              aria-label="Recategorize selected to">
              <option value="">Recategorize to…</option>
              {BULK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn--outline btn--sm" onClick={bulkRecategorize} disabled={!bulkCat}>Apply</button>
            <button className="btn btn--danger btn--sm" onClick={() => setShowBulkDelete(true)}>Delete selected</button>
            <button className="btn btn--ghost btn--sm" onClick={clearSelection}>Clear</button>
          </span>
        </div>
      )}

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th style={{ width: 1 }}><input type="checkbox" checked={allChecked}
              onChange={e => toggleAll(filteredIds, e.target.checked)} aria-label="Select all" /></th>
            <th>Date</th><th>Description</th><th>Category</th><th className="text-right">Amount</th><th>Scan</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="empty-cell">No expenses match — travel costs are reimbursable pass-throughs, tracked here and billed back via reports.</td></tr>}
            {filtered.map(e => (
              <tr key={e.id}>
                <td><input type="checkbox" checked={selected.has(e.id)}
                  onChange={ev => toggleOne(e.id, ev.target.checked)} aria-label={`Select ${e.description}`} /></td>
                <td className="mono">{e.expense_date}</td>
                <td>{e.description}</td>
                <td><span className={`${badgeClass(e.category)} chip--sm`}>{e.category}</span></td>
                <td className="money">{chf(e.amount)}</td>
                <td>{scanCell(e)}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(e)}>✎</button>
                  <button className="btn btn--ghost btn--icon btn--icon-danger" title="Delete" onClick={() => setToDelete(e)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="finance-section">
        <h3>Generated Reports <span className="count">{reports.length}</span></h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr><th>#</th><th>Period</th><th className="text-right">Receipts</th><th className="text-right">Total (CHF)</th><th className="text-right">Created</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {reports.length === 0 && <tr><td colSpan={6} className="empty-cell">No reports generated yet</td></tr>}
              {reports.map(r => (
                <tr key={r.id}>
                  <td className="mono">#{pad4(r.report_number)}</td>
                  <td>{r.month ? `${MON[r.month - 1]} ${r.year}` : r.year}</td>
                  <td className="text-right">{r.expense_count}</td>
                  <td className="money">{chf(r.total)}</td>
                  <td className="text-right date">{r.created_at?.split(" ")[0] ?? "–"}</td>
                  <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                    <a className="btn btn--ghost btn--icon" href={reportUrl(r, "pdf")} target="_blank" rel="noreferrer" title="Preview PDF">📄</a>
                    <a className="btn btn--ghost btn--icon" href={reportUrl(r, "pdf", true)} title="Download PDF" download>⬇</a>
                    <a className="btn btn--ghost btn--icon" href={reportUrl(r, "excel")} title="Download Excel" download>💾</a>
                    <button className="btn btn--ghost btn--icon btn--icon-danger" title="Delete" onClick={() => setToDeleteReport(r)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form !== undefined && (
        <ExpenseForm expense={form} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); load(); }} />
      )}
      {showImport && (
        <ImportFolderModal onClose={() => setShowImport(false)} onImported={load} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete expense"
          message={<>Delete <strong>{toDelete.description}</strong> ({chf(toDelete.amount)})? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
      {toDeleteReport && (
        <ConfirmModal title="Delete report"
          message={<>Delete expense report <strong>#{pad4(toDeleteReport.report_number)}</strong>? This can&apos;t be undone.</>}
          onConfirm={() => removeReport(toDeleteReport)} onClose={() => setToDeleteReport(null)} />
      )}
      {showBulkDelete && (
        <ConfirmModal title="Delete selected"
          confirmLabel="Delete selected"
          message={<>Delete <strong>{selected.size}</strong> selected expense{selected.size > 1 ? "s" : ""}? This can&apos;t be undone.</>}
          onConfirm={bulkDelete} onClose={() => setShowBulkDelete(false)} />
      )}
    </div>
  );
}
