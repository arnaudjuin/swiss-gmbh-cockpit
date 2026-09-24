"use client";
// Invoices & Income — table, paid toggles, PDF links.
import { useCallback, useEffect, useState } from "react";
import { api, type Invoice } from "@/lib/api";
import { chf } from "@/lib/money";
import { Chip } from "@/components/ui";
import { IncomeForm } from "@/components/IncomeForm";
import { ConfirmModal } from "@/components/Modal";

interface Income { id: number; income_date: string; source: string; description: string; amount: number; currency: string; category: string; invoice_id: number | null; has_file: boolean }

const pad4 = (n: number) => String(n).padStart(4, "0");
const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

export default function InvoicesPage() {
  const [all, setAll] = useState<Invoice[] | null>(null);
  const [income, setIncome] = useState<Income[]>([]);
  const [error, setError] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [addIncome, setAddIncome] = useState(false);
  const [delIncome, setDelIncome] = useState<Income | null>(null);

  const reload = useCallback(() => {
    api<Invoice[]>("/invoices").then(setAll).catch(e => setError(String(e.message ?? e)));
    api<Income[]>("/income").then(setIncome).catch(() => setIncome([]));
  }, []);
  useEffect(reload, [reload]);

  const toggle = async (inv: Invoice) => {
    await api(`/invoices/${inv.id}/status`, {
      method: "PATCH", body: JSON.stringify({ status: inv.paid_status === "paid" ? "unpaid" : "paid" }),
    });
    reload();
  };
  const removeIncome = async (e: Income) => {
    try { await api(`/income/${e.id}`, { method: "DELETE" }); reload(); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!all) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const years = [...new Set(all.map(i => String(i.year)))].sort().reverse();
  let rows = all;
  if (year) rows = rows.filter(i => String(i.year) === year);
  if (status === "paid") rows = rows.filter(i => i.paid_status === "paid");
  else if (status === "unpaid") rows = rows.filter(i => i.paid_status !== "paid");
  else if (status === "overdue") rows = rows.filter(i => i.paid_status !== "paid" && i.due_date < today);
  const manualIncome = income.filter(e => e.invoice_id == null);
  const totalRows = rows.reduce((s, i) => s + i.total, 0);

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Invoices &amp; Income</h1>
        <button className="btn btn--primary" onClick={() => setAddIncome(true)}>＋ Add income</button>
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <label>Year:</label>
        <select className="control" style={{ width: "auto" }} value={year} onChange={e => setYear(e.target.value)}>
          <option value="">All</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Status:</label>
        <select className="control" style={{ width: "auto" }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All</option><option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option><option value="overdue">Overdue</option>
        </select>
        <span className="hint" style={{ marginLeft: "auto", fontWeight: 600 }}>
          {rows.length} invoice{rows.length !== 1 ? "s" : ""} = {chf(totalRows)}
        </span>
      </div>

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>#</th><th>Period</th><th className="text-right">Hours</th>
            <th className="text-right">Subtotal</th><th className="text-right">VAT</th>
            <th className="text-right">Total</th><th>Due</th><th>Status</th><th>Notes</th><th className="text-right">PDF</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="empty-cell">No invoices match</td></tr>}
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
                <td className="hint" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.notes ?? ""}>{i.notes || "—"}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <a href={`/api/invoices/${i.id}/pdf?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer"
                    className="btn btn--ghost btn--icon" title="Preview PDF">📄</a>
                  <a href={`/api/invoices/${i.id}/pdf?download=true&token=${encodeURIComponent(token())}`}
                    className="btn btn--ghost btn--icon" title="Download">💾</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="finance-section">
        <h3>Other income <span className="count">{manualIncome.length}</span>{" "}
          <span className="hint">manual, non-invoice income entries</span></h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Category</th>
              <th className="text-right">Amount</th><th>File</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {manualIncome.length === 0 && <tr><td colSpan={7} className="empty-cell">No manual income entries</td></tr>}
              {manualIncome.map(e => (
                <tr key={e.id}>
                  <td className="mono">{e.income_date}</td>
                  <td>{e.source}</td>
                  <td className="hint">{e.description}</td>
                  <td><span className="chip chip--sm">{e.category}</span></td>
                  <td className="money">{chf(e.amount)}{e.currency !== "CHF" && <span className="hint"> {e.currency}</span>}</td>
                  <td>{e.has_file
                    ? <a href={`/api/income/${e.id}/file?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer" className="btn btn--ghost btn--icon" title="View file">📄</a>
                    : "—"}</td>
                  <td className="text-right">
                    <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setDelIncome(e)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addIncome && <IncomeForm onClose={() => setAddIncome(false)} onSaved={() => { setAddIncome(false); reload(); }} />}
      {delIncome && (
        <ConfirmModal title="Delete income entry"
          message={<>Delete <strong>{delIncome.source}</strong> ({chf(delIncome.amount)})? This can&apos;t be undone.</>}
          onConfirm={() => removeIncome(delIncome)} onClose={() => setDelIncome(null)} />
      )}
    </div>
  );
}
