"use client";
// Log a transfer between the owner's personal account and the GmbH — posts
// multipart FormData to the existing POST /transfers endpoint. Transfers are
// add/delete only (no edit), mirroring the classic transfer-dialog.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

const today = () => new Date().toISOString().slice(0, 10);

export function TransferForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    if (file) fd.set("doc", file); else fd.delete("doc");
    try { await api("/transfers", { method: "POST", body: fd }); onSaved(); }
    catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Log transfer" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Date</span>
            <input className="control" type="date" name="transfer_date" required defaultValue={today()} /></label>
          <label className="field"><span className="field__label">Amount</span>
            <input className="control" type="number" step="0.01" min="0" name="amount" required /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Direction</span>
            <select className="control" name="direction" defaultValue="personal_to_gmbh">
              <option value="personal_to_gmbh">Personal → GmbH</option>
              <option value="gmbh_to_personal">GmbH → Personal</option>
            </select></label>
          <label className="field"><span className="field__label">Currency</span>
            <select className="control" name="currency" defaultValue="CHF">
              {["CHF", "EUR", "USD", "GBP"].map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="field"><span className="field__label">Description</span>
          <input className="control" name="description" placeholder="e.g. Capital contribution, dividend" /></label>
        <label className="field"><span className="field__label">Document (optional)</span>
          <input className="control" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Log transfer"}</button>
        </div>
      </form>
    </Modal>
  );
}
