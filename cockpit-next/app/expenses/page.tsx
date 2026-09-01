"use client";
// Travel expenses & reports — reimbursable pass-through costs.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Chip } from "@/components/ui";

interface Expense { id: number; expense_date: string; description: string; amount: number; category: string; trip_id?: number | null }
interface Report { id: number; report_number: number; year: number; month: number | null; total: number; expense_count: number; reimbursed_at: string | null }

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<Expense[]>("/expenses"), api<Report[]>("/expenses/reports").catch(() => [])])
      .then(([e, r]) => { setRows(e); setReports(r); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;
  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Travel Expenses</h1></div>
      <div className="table-card">
        <table className="table table--compact">
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="empty-cell">No expenses logged — travel costs are reimbursable pass-throughs, tracked here and billed back via reports.</td></tr>}
            {rows.map(e => (
              <tr key={e.id}>
                <td className="mono">{e.expense_date}</td>
                <td>{e.description}</td>
                <td><span className="chip chip--sm">{e.category}</span></td>
                <td className="money">{chf(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="finance-section">
        <h3>Generated Reports <span className="count">{reports.length}</span></h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr><th>#</th><th>Period</th><th className="text-right">Expenses</th><th className="text-right">Total</th><th>Status</th></tr></thead>
            <tbody>
              {reports.length === 0 && <tr><td colSpan={5} className="empty-cell">No reports yet</td></tr>}
              {reports.map(r => (
                <tr key={r.id}>
                  <td className="mono">#{String(r.report_number).padStart(4, "0")}</td>
                  <td>{r.month ? `${r.month}/${r.year}` : r.year}</td>
                  <td className="text-right">{r.expense_count}</td>
                  <td className="money">{chf(r.total)}</td>
                  <td><Chip mod={r.reimbursed_at ? "ok" : "warn"}>{r.reimbursed_at ? "Reimbursed" : "Open"}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
