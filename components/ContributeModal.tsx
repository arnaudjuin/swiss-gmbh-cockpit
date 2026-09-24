"use client";
// Contribute to / withdraw from a reserve envelope. Posts multipart FormData
// (amount + optional description) to /reserves/:id/contribute | /withdraw —
// exactly the fields server/reserveMove.ts reads from req.formData().
import { useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Modal } from "@/components/Modal";

export type MoveTarget = { id: number; name: string; accumulated: number };

export function ContributeModal({ reserve, kind, onSaved, onClose }: {
  reserve: MoveTarget; kind: "contribute" | "withdraw"; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const contributing = kind === "contribute";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/reserves/${reserve.id}/${kind}`, { method: "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={`${contributing ? "Contribute to" : "Withdraw from"} ${reserve.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="hint" style={{ margin: "0 0 12px" }}>
          Currently earmarked: <span className="money">{chf(reserve.accumulated)}</span>
        </p>
        <label className="field"><span className="field__label">Amount</span>
          <input className="control" type="number" step="0.01" min="0.01" name="amount" required autoFocus
            placeholder="0.00" /></label>
        <label className="field"><span className="field__label">Note (optional)</span>
          <input className="control" name="description"
            defaultValue={contributing ? "Manual contribution (Cash Allocation page)"
              : "Manual withdrawal (Cash Allocation page)"} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className={`btn ${contributing ? "btn--ok" : "btn--outline"}`} disabled={saving}>
            {saving ? "Saving…" : contributing ? "Earmark it" : "Release it"}</button>
        </div>
      </form>
    </Modal>
  );
}
