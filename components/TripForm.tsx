"use client";
// Add / edit a trip — posts multipart FormData to the existing /trips
// endpoints (POST new, PUT /trips/:id edit). Mirrors the classic 03-bank.js
// trip modal fields. The Trip type is defined locally because lib/api.ts does
// not export one.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

export interface Trip {
  id: number; name: string; purpose: string; start_date: string;
  end_date: string; countries: string; notes: string; is_active: boolean;
  expense_count: number; total_chf: number;
}

export function TripForm({ trip, onSaved, onClose }: {
  trip: Trip | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = !!trip;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    if (editing) fd.set("is_active", "1");
    try {
      await api(editing ? `/trips/${trip!.id}` : "/trips", { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit trip" : "New trip"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field__label">Name</span>
          <input className="control" name="name" required defaultValue={trip?.name ?? ""} placeholder="e.g. Oman &amp; UAE — June 2026" /></label>
        <label className="field"><span className="field__label">Purpose</span>
          <input className="control" name="purpose" defaultValue={trip?.purpose ?? ""} placeholder="Why was this trip business-related?" /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Start date</span>
            <input className="control" type="date" name="start_date" required defaultValue={trip?.start_date ?? ""} /></label>
          <label className="field"><span className="field__label">End date</span>
            <input className="control" type="date" name="end_date" required defaultValue={trip?.end_date ?? ""} /></label>
        </div>
        <label className="field"><span className="field__label">Countries</span>
          <input className="control" name="countries" defaultValue={trip?.countries ?? ""} placeholder="comma-separated, e.g. Oman, UAE" /></label>
        <label className="field"><span className="field__label">Notes</span>
          <textarea className="control" name="notes" rows={3} defaultValue={trip?.notes ?? ""} placeholder="Anything else worth remembering." /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add trip"}</button>
        </div>
      </form>
    </Modal>
  );
}
