"use client";
// Add / edit a GmbH obligation — posts multipart FormData to the existing
// /obligations endpoints (POST new, PUT /obligations/:id edit). Mirrors the
// classic 50-dialogs.html obligation dialog fields; the Next API route
// (app/api/obligations) is authoritative for field names.
import { useState } from "react";
import { api, type Obligation } from "@/lib/api";
import { Modal } from "@/components/Modal";

const today = () => new Date().toISOString().slice(0, 10);
const thisYear = () => new Date().getFullYear();

export function ObligationForm({ obligation, types, onSaved, onClose }: {
  obligation: Obligation | null; types: Record<string, string>;
  onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const editing = !!obligation;
  const typeEntries = Object.entries(types);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (file) fd.set("doc", file); else fd.delete("doc");
    try {
      await api(editing ? `/obligations/${obligation!.id}` : "/obligations",
        { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit obligation" : "New obligation"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field__label">Type</span>
          <select className="control" name="obligation_type" required
            defaultValue={obligation?.obligation_type ?? typeEntries[0]?.[0]}>
            {typeEntries.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Year</span>
            <input className="control" type="number" name="period_year" min="2020" max="2035" required
              defaultValue={obligation?.period_year ?? thisYear()} /></label>
          <label className="field"><span className="field__label">Period label</span>
            <input className="control" name="period_label" required
              defaultValue={obligation?.period_label ?? ""} placeholder="e.g. Q1 2026, Jan 2026, 2025" /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Amount</span>
            <input className="control" type="number" step="0.01" min="0" name="amount" required
              defaultValue={obligation?.amount ?? ""} /></label>
          <label className="field"><span className="field__label">Currency</span>
            <select className="control" name="currency" defaultValue={obligation?.currency ?? "CHF"}>
              <option value="CHF">CHF</option>
            </select></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Due date</span>
            <input className="control" type="date" name="due_date" defaultValue={obligation?.due_date ?? ""} /></label>
          <label className="field"><span className="field__label">Status</span>
            <select className="control" name="status" defaultValue={obligation?.status ?? "unpaid"}>
              <option value="unpaid">Unpaid</option><option value="paid">Paid</option>
            </select></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Recurrence</span>
            <select className="control" name="recurrence" defaultValue="none">
              <option value="none">One-time</option><option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
            </select></label>
          <label className="field"><span className="field__label">Expected bill date</span>
            <input className="control" type="date" name="expected_bill_date"
              defaultValue={obligation?.expected_bill_date ?? ""} /></label>
        </div>
        <label className="field"><span className="field__label">Expected bill amount (if it differs)</span>
          <input className="control" type="number" step="0.01" min="0" name="expected_bill_amount"
            defaultValue={obligation?.expected_bill_amount ?? ""} placeholder="Optional" /></label>
        <label className="field"><span className="field__label">Notes</span>
          <input className="control" name="notes" defaultValue={obligation?.notes ?? ""} placeholder="Optional" /></label>
        <label className="field"><span className="field__label">Document (optional)</span>
          <input className="control" type="file" accept="image/*,.pdf"
            onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add obligation"}</button>
        </div>
      </form>
    </Modal>
  );
}
