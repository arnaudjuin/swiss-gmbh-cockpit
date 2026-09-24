"use client";
// Book / edit a company vehicle — posts multipart FormData to /vehicles
// (POST new, PUT /vehicles/:id edit). Booking a projected car turns it into a
// real asset the forecast depreciates from the booked figures.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

export interface Vehicle {
  id?: number; name?: string; vendor?: string; purchase_date?: string; purchase_price?: number;
  depreciation_method?: string; registration_number?: string; vat_paid?: number | null;
  privatanteil_method?: string; notes?: string;
}
const today = () => new Date().toISOString().slice(0, 10);

export function VehicleForm({ vehicle, onSaved, onClose }: {
  vehicle: Vehicle | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = !!vehicle?.id;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api(editing ? `/vehicles/${vehicle!.id}` : "/vehicles", { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit vehicle" : "Book company car"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field__label">Name</span>
          <input className="control" name="name" required defaultValue={vehicle?.name ?? "Company car"} /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Purchase date</span>
            <input className="control" type="date" name="purchase_date" required defaultValue={vehicle?.purchase_date ?? today()} /></label>
          <label className="field"><span className="field__label">Purchase price (CHF)</span>
            <input className="control" type="number" step="100" min="0" name="purchase_price" required defaultValue={vehicle?.purchase_price ?? 20500} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Depreciation method</span>
            <select className="control" name="depreciation_method" defaultValue={vehicle?.depreciation_method ?? "degressive_40"}>
              <option value="degressive_40">40% degressive</option>
              <option value="linear_20">20% straight-line</option>
            </select></label>
          <label className="field"><span className="field__label">Privatanteil method</span>
            <select className="control" name="privatanteil_method" defaultValue={vehicle?.privatanteil_method ?? "pauschal"}>
              <option value="pauschal">Pauschal (0.9%/mo)</option>
              <option value="effektiv">Effektiv (logbook)</option>
            </select></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Vendor (optional)</span>
            <input className="control" name="vendor" defaultValue={vehicle?.vendor ?? ""} /></label>
          <label className="field"><span className="field__label">Registration № (optional)</span>
            <input className="control" name="registration_number" defaultValue={vehicle?.registration_number ?? ""} /></label>
        </div>
        <label className="field"><span className="field__label">VAT paid on purchase (optional)</span>
          <input className="control" type="number" step="0.01" min="0" name="vat_paid" defaultValue={vehicle?.vat_paid ?? ""} /></label>
        <label className="field"><span className="field__label">Notes</span>
          <input className="control" name="notes" defaultValue={vehicle?.notes ?? ""} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Book vehicle"}</button>
        </div>
      </form>
    </Modal>
  );
}
