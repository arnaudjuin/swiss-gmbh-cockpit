"use client";
// Add / edit a bill (company_docs) — posts multipart FormData to the existing
// /accounting endpoints (POST new, PUT /accounting/:id edit). Mirrors the
// classic 50-dialogs.html bill dialog fields.
import { useState } from "react";
import { api, type Bill } from "@/lib/api";
import { Modal } from "@/components/Modal";

const CATEGORIES = ["Office Supplies", "Software/Subscriptions", "Professional Services",
  "Insurance", "Vehicle", "Rent", "Telecom", "Legal", "Bank Fees", "Payroll Settlement", "Taxes / VAT", "Other"];
const today = () => new Date().toISOString().slice(0, 10);

export function BillForm({ bill, onSaved, onClose }: {
  bill: Bill | null; onSaved: () => void; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState(bill?.currency ?? "CHF");
  const editing = !!bill;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (file) fd.set("doc", file); else fd.delete("doc");
    try {
      await api(editing ? `/accounting/${bill!.id}` : "/accounting", { method: editing ? "PUT" : "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit bill" : "New bill"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Date</span>
            <input className="control" type="date" name="doc_date" required defaultValue={bill?.doc_date ?? today()} /></label>
          <label className="field"><span className="field__label">Due date</span>
            <input className="control" type="date" name="due_date" defaultValue={bill?.due_date ?? ""} /></label>
        </div>
        <label className="field"><span className="field__label">Vendor</span>
          <input className="control" name="vendor" required defaultValue={bill?.vendor ?? ""} placeholder="e.g. Swisscom" /></label>
        <label className="field"><span className="field__label">Description</span>
          <input className="control" name="description" defaultValue={bill?.description ?? ""} /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Amount</span>
            <input className="control" type="number" step="0.01" min="0" name="amount" required
              defaultValue={bill ? (bill.original_amount ?? bill.amount) : ""} /></label>
          <label className="field"><span className="field__label">Currency</span>
            <select className="control" name="currency" value={currency} onChange={e => setCurrency(e.target.value)}>
              {["CHF", "EUR", "USD", "AED", "GBP"].map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        {currency !== "CHF" && (
          <label className="field"><span className="field__label">FX rate to CHF (optional — else today&apos;s rate)</span>
            <input className="control" type="number" step="0.0001" min="0" name="fx_rate" placeholder="e.g. 0.96" /></label>
        )}
        <div className="cols-2">
          <label className="field"><span className="field__label">Category</span>
            <select className="control" name="category" defaultValue={bill?.category ?? "Office Supplies"}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="field"><span className="field__label">Status</span>
            <select className="control" name="status" defaultValue={bill?.status ?? "unpaid"}>
              <option value="unpaid">Unpaid</option><option value="paid">Paid</option>
            </select></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Recurrence</span>
            <select className="control" name="recurrence" defaultValue="none">
              <option value="none">One-off</option><option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
            </select></label>
          <label className="field"><span className="field__label">Paid via</span>
            <select className="control" name="paid_via" defaultValue={bill?.paid_via ?? "company"}>
              <option value="company">Company</option><option value="personal">Personal card</option>
            </select></label>
        </div>
        <label className="field"><span className="field__label">Document link (optional)</span>
          <input className="control" name="doc_url" placeholder="https://…" /></label>
        <label className="field"><span className="field__label">Attach file (optional)</span>
          <input className="control" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add bill"}</button>
        </div>
      </form>
    </Modal>
  );
}
