"use client";
// Add / edit a reserve envelope (sinking fund) — posts multipart FormData to
// the existing /reserves endpoints (POST new, PUT /reserves/:id edit). Mirrors
// the classic 02-dashboard.js reserve modal fields; field names match exactly
// what app/api/reserves/route.ts (POST) and [id]/route.ts (PUT) read.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// The editable slice of a reserve. lib/api.ts's Reserve type omits the raw
// accrual_start / accumulated_manual / is_active columns the API round-trips,
// so we widen it locally (they exist at runtime on the /reserves payload).
export type ReserveEditable = {
  id: number; name: string; purpose: string; target_amount: number;
  target_date: string | null; monthly_accrual: number;
  accrual_start?: string | null; accumulated_manual?: number; is_active?: boolean;
};

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

export function ReserveForm({ reserve, onSaved, onClose }: {
  reserve: ReserveEditable | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = !!reserve;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api(editing ? `/reserves/${reserve!.id}` : "/reserves",
        { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit reserve" : "New reserve"} onClose={onClose}>
      <form onSubmit={submit}>
        {editing && <input type="hidden" name="is_active" value={reserve?.is_active === false ? 0 : 1} />}
        <label className="field"><span className="field__label">Name</span>
          <input className="control" name="name" required defaultValue={reserve?.name ?? ""}
            placeholder="e.g. Gewinnsteuer FY2027" /></label>
        <label className="field"><span className="field__label">Purpose</span>
          <input className="control" name="purpose" defaultValue={reserve?.purpose ?? ""}
            placeholder="What is this saving for?" /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Target amount</span>
            <input className="control" type="number" step="0.01" min="0" name="target_amount" required
              defaultValue={reserve ? reserve.target_amount : ""} /></label>
          <label className="field"><span className="field__label">Target date</span>
            <input className="control" type="date" name="target_date"
              defaultValue={dateOnly(reserve?.target_date)} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Monthly accrual</span>
            <input className="control" type="number" step="0.01" min="0" name="monthly_accrual"
              defaultValue={reserve ? reserve.monthly_accrual : 0} /></label>
          <label className="field"><span className="field__label">Accrual start</span>
            <input className="control" type="date" name="accrual_start"
              defaultValue={dateOnly(reserve?.accrual_start)} /></label>
        </div>
        <label className="field">
          <span className="field__label">Manual adjustment — one-shot prior contribution / cash already paid in</span>
          <input className="control" type="number" step="0.01" name="accumulated_manual"
            defaultValue={reserve ? (reserve.accumulated_manual ?? 0) : 0} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add reserve"}</button>
        </div>
      </form>
    </Modal>
  );
}
