"use client";
// Add / edit a customer — posts JSON to the existing /customers endpoints
// (POST new, PUT /customers/:id edit). Mirrors the classic 50-dialogs.html
// customer dialog fields.
import { useState } from "react";
import { api, type Customer } from "@/lib/api";
import { Modal } from "@/components/Modal";

export function CustomerForm({ customer, onSaved, onClose }: {
  customer: Customer | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = !!customer;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      address: String(fd.get("address") ?? "").trim(),
      city: String(fd.get("city") ?? "").trim(),
      country: String(fd.get("country") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim() || null,
      reference: String(fd.get("reference") ?? "").trim() || null,
    };
    try {
      await api(editing ? `/customers/${customer!.id}` : "/customers",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit customer" : "New customer"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field__label">Name</span>
          <input className="control" name="name" required defaultValue={customer?.name ?? ""} placeholder="e.g. Acme AG" /></label>
        <label className="field"><span className="field__label">Address</span>
          <input className="control" name="address" defaultValue={customer?.address ?? ""} /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">City</span>
            <input className="control" name="city" defaultValue={customer?.city ?? ""} /></label>
          <label className="field"><span className="field__label">Country</span>
            <input className="control" name="country" defaultValue={customer?.country ?? "Switzerland"} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Email</span>
            <input className="control" type="email" name="email" defaultValue={customer?.email ?? ""} /></label>
          <label className="field"><span className="field__label">Reference</span>
            <input className="control" name="reference" defaultValue={customer?.reference ?? ""} /></label>
        </div>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add customer"}</button>
        </div>
      </form>
    </Modal>
  );
}
