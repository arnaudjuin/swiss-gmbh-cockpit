"use client";
import { useEffect, useState } from "react";
import { api, type Customer } from "@/lib/api";

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Customer[]>("/customers").then(setRows).catch(e => setError(String(e.message ?? e))); }, []);
  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!rows) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;
  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Customers</h1></div>
      <div className="table-card">
        <table className="table table--compact">
          <thead><tr><th>Name</th><th>Address</th><th>Email</th><th>Reference</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="empty-cell">No customers yet</td></tr>}
            {rows.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td className="hint">{[c.address, c.city, c.country].filter(Boolean).join(", ")}</td>
                <td>{c.email ?? "—"}</td>
                <td className="mono">{c.reference ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
