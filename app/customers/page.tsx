"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Customer } from "@/lib/api";
import { CustomerForm } from "@/components/CustomerForm";
import { ConfirmModal } from "@/components/Modal";

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  // undefined = form closed; null = adding; Customer = editing that customer.
  const [form, setForm] = useState<Customer | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Customer | null>(null);

  const load = useCallback(() => {
    api<Customer[]>("/customers").then(setRows).catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const remove = async (c: Customer) => {
    try { await api(`/customers/${c.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Customers</h1>
        <button className="btn btn--primary" onClick={() => setForm(null)}>＋ New customer</button>
      </div>
      <div className="table-card">
        <table className="table table--compact">
          <thead><tr>
            <th>Name</th><th>Address</th><th>Email</th><th>Reference</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="empty-cell">No customers yet</td></tr>}
            {rows.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td className="hint">{[c.address, c.city, c.country].filter(Boolean).join(", ")}</td>
                <td>{c.email ?? "—"}</td>
                <td className="mono">{c.reference ?? "—"}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setForm(c)}>✎</button>
                  <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setToDelete(c)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form !== undefined && (
        <CustomerForm customer={form} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); load(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete customer"
          message={<>Delete <strong>{toDelete.name}</strong>? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
