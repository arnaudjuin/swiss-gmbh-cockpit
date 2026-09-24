"use client";
// Trips — groups travel expenses into business trips (name, purpose, dates,
// countries). Port of the classic renderer in static/js/03-bank.js (the page
// was never carried over). Each row shows the trip's assigned-expense count
// and total; actions view those expenses, auto-assign any unassigned expense
// whose date falls inside the trip, and edit / delete the trip.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { badgeClass } from "@/lib/badge";
import { Chip } from "@/components/ui";
import { TripForm, type Trip } from "@/components/TripForm";
import { Modal, ConfirmModal } from "@/components/Modal";

interface TripExpense {
  id: number; expense_date: string; description: string; amount: number;
  category: string; original_amount: number | null; original_currency: string | null;
  scan_file: string | null; has_scan: boolean;
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // undefined = form closed; null = adding; Trip = editing that trip.
  const [form, setForm] = useState<Trip | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Trip | null>(null);
  const [toAssign, setToAssign] = useState<Trip | null>(null);
  const [viewing, setViewing] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<TripExpense[] | null>(null);

  const load = useCallback(() => {
    api<Trip[]>("/trips").then(setTrips).catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const remove = async (t: Trip) => {
    try { await api(`/trips/${t.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const autoAssign = async (t: Trip) => {
    try {
      const r = await api<{ assigned: number }>(`/trips/${t.id}/auto-assign`, { method: "POST" });
      setNotice(`${r.assigned} expense${r.assigned !== 1 ? "s" : ""} assigned to ${t.name}.`);
      load();
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const view = (t: Trip) => {
    setViewing(t); setExpenses(null);
    api<TripExpense[]>(`/trips/${t.id}/expenses`).then(setExpenses)
      .catch(e => { setExpenses([]); setError(String((e as Error).message ?? e)); });
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!trips) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Trips</h1>
        <button className="btn btn--primary" onClick={() => setForm(null)}>＋ New trip</button>
      </div>

      {notice && <div className="notice notice--info" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>#</th><th>Name</th><th>Dates</th><th>Countries</th>
            <th className="text-right">Expenses</th><th className="text-right">Total</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {trips.length === 0 && <tr><td colSpan={7} className="empty-cell">No trips yet — group travel expenses into business trips to track them by destination and date range.</td></tr>}
            {trips.map(t => (
              <tr key={t.id}>
                <td className="mono">#{t.id}</td>
                <td>
                  <strong>{t.name}</strong>
                  {t.purpose && <div className="hint">{t.purpose}</div>}
                </td>
                <td className="mono">{t.start_date} → {t.end_date}</td>
                <td>{t.countries || <span className="hint">–</span>}</td>
                <td className="text-right">{t.expense_count}</td>
                <td className="money">{chf(t.total_chf)}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn--ghost btn--icon" title="View expenses" onClick={() => view(t)}>🔍</button>
                  <button className="btn btn--ghost btn--icon" title="Auto-assign expenses in date range" onClick={() => setToAssign(t)}>🔗</button>
                  <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(t)}>✎</button>
                  <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setToDelete(t)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form !== undefined && (
        <TripForm trip={form} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); load(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete trip"
          message={<>Delete <strong>{toDelete.name}</strong>? Expenses will be detached but kept.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
      {toAssign && (
        <ConfirmModal title="Auto-assign expenses" danger={false} confirmLabel="Auto-assign"
          message={<>Assign any unassigned expense whose date falls inside <strong>{toAssign.name}</strong> ({toAssign.start_date} → {toAssign.end_date})?</>}
          onConfirm={() => autoAssign(toAssign)} onClose={() => setToAssign(null)} />
      )}
      {viewing && (
        <Modal wide title={`Expenses — ${viewing.name}`} onClose={() => { setViewing(null); setExpenses(null); }}>
          {!expenses ? <div className="hint">Loading…</div> : (
            <div className="table-card">
              <table className="table table--compact">
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {expenses.length === 0 && <tr><td colSpan={4} className="empty-cell">No expenses assigned to this trip yet.</td></tr>}
                  {expenses.map(e => (
                    <tr key={e.id}>
                      <td className="mono">{e.expense_date}</td>
                      <td>{e.description}</td>
                      <td><span className={`${badgeClass(e.category)} chip--sm`}>{e.category}</span></td>
                      <td className="money">
                        {chf(e.amount)}
                        {e.original_currency && e.original_currency !== "CHF" && (
                          <div className="hint">{e.original_amount?.toFixed(2)} {e.original_currency}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot><tr className="table__total">
                    <td colSpan={3}>Total ({expenses.length})</td>
                    <td className="money">{chf(expenses.reduce((s, e) => s + e.amount, 0))}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
