"use client";
// Add / edit a travel expense — posts multipart FormData to the existing
// /expenses endpoints (POST new, PUT /expenses/:id edit). Mirrors the classic
// 20-pages-core.html expense form fields. The Expense type is defined locally
// because lib/api.ts does not export one.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

export interface Expense {
  id: number; expense_date: string; description: string; amount: number;
  category: string; trip_id?: number | null;
  has_scan?: boolean; scan_type?: string | null;
}

const CATEGORIES = ["Meals", "Transport", "Accommodation", "Fuel", "Connectivity", "Other"];
const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseForm({ expense, onSaved, onClose }: {
  expense: Expense | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const editing = !!expense;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (file) fd.set("scan", file); else fd.delete("scan");
    try {
      await api(editing ? `/expenses/${expense!.id}` : "/expenses", { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit expense" : "New expense"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Date</span>
            <input className="control" type="date" name="expense_date" required defaultValue={expense?.expense_date ?? today()} /></label>
          <label className="field"><span className="field__label">Amount (CHF)</span>
            <input className="control" type="number" step="0.01" min="0" name="amount" required defaultValue={expense?.amount ?? ""} /></label>
        </div>
        <label className="field"><span className="field__label">Description</span>
          <input className="control" name="description" required defaultValue={expense?.description ?? ""} placeholder="e.g. Breakfast - Hotel Restaurant" /></label>
        <label className="field"><span className="field__label">Category</span>
          <select className="control" name="category" defaultValue={expense?.category ?? "Meals"}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="field"><span className="field__label">Receipt scan (optional)</span>
          <input className="control" type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add expense"}</button>
        </div>
      </form>
    </Modal>
  );
}
