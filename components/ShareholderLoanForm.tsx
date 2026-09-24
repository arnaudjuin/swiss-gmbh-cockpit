"use client";
// Add / edit a shareholder loan — posts multipart FormData to the existing
// /shareholder-loans endpoints (POST new, PUT /shareholder-loans/:id edit).
// Booleans are set explicitly to "1"/"0" so the API's Number(...) parsing is
// never handed a raw "on" checkbox value.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import type { ShareholderLoan } from "@/app/shareholder-loans/page";

const today = () => new Date().toISOString().slice(0, 10);

export function ShareholderLoanForm({ loan, onSaved, onClose }: {
  loan: ShareholderLoan | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState(loan?.direction ?? "shareholder_to_gmbh");
  const [subordinated, setSubordinated] = useState(loan?.is_subordinated ?? false);
  const [repaid, setRepaid] = useState(loan?.is_repaid ?? false);
  const editing = !!loan;
  const inbound = direction === "shareholder_to_gmbh";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    fd.set("direction", direction);
    fd.set("is_subordinated", inbound && subordinated ? "1" : "0");
    fd.set("is_repaid", repaid ? "1" : "0");
    try {
      await api(editing ? `/shareholder-loans/${loan!.id}` : "/shareholder-loans",
        { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit shareholder loan" : "New shareholder loan"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field__label">Direction</span>
          <select className="control" value={direction}
            onChange={e => setDirection(e.target.value as ShareholderLoan["direction"])}>
            <option value="shareholder_to_gmbh">Shareholder → GmbH (GmbH owes you)</option>
            <option value="gmbh_to_shareholder">GmbH → Shareholder (you owe the GmbH)</option>
          </select></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Loan date</span>
            <input className="control" type="date" name="loan_date" required defaultValue={loan?.loan_date ?? today()} /></label>
          <label className="field"><span className="field__label">Repayment date (optional)</span>
            <input className="control" type="date" name="repayment_date" defaultValue={loan?.repayment_date ?? ""} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Amount</span>
            <input className="control" type="number" step="0.01" min="0" name="amount" required
              defaultValue={loan?.amount ?? ""} /></label>
          <label className="field"><span className="field__label">Currency</span>
            <select className="control" name="currency" defaultValue={loan?.currency ?? "CHF"}>
              {["CHF", "EUR", "USD", "AED", "GBP"].map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="field"><span className="field__label">Notes</span>
          <input className="control" name="notes" defaultValue={loan?.notes ?? ""} placeholder="e.g. bridge financing" /></label>

        {inbound && (
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={subordinated} onChange={e => setSubordinated(e.target.checked)} />
            <span className="field__label" style={{ margin: 0 }}>Subordinated (Rangrücktritt) — waives priority in over-indebtedness</span>
          </label>
        )}
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={repaid} onChange={e => setRepaid(e.target.checked)} />
          <span className="field__label" style={{ margin: 0 }}>Repaid</span>
        </label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add loan"}</button>
        </div>
      </form>
    </Modal>
  );
}
