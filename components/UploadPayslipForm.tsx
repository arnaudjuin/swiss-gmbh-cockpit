"use client";
// Upload an official payslip PDF from the accountant — POSTs multipart to
// /payroll/payslips/upload. If a payslip already exists for the month it replaces
// the generated PDF (source → 'uploaded'). Mirrors the classic upload dialog.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function UploadPayslipForm({ defaultYear, onSaved, onClose }: {
  defaultYear: number; onSaved: () => void; onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [paymentDate, setPaymentDate] = useState("");
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setError("Please choose a PDF"); return; }
    setSaving(true); setError("");
    const fd = new FormData();
    fd.append("year", String(year));
    fd.append("month", String(month));
    if (paymentDate) fd.append("payment_date", paymentDate);
    if (gross) fd.append("gross", gross);
    if (net) fd.append("net", net);
    fd.append("doc", file);
    try {
      await api("/payroll/payslips/upload", { method: "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Upload payslip" onClose={onClose}>
      <p className="hint" style={{ margin: "4px 0 12px" }}>
        Attach the accountant&apos;s official PDF. If a payslip already exists for the month, this replaces the
        generated one. Leave gross/net blank to keep the estimated breakdown.
      </p>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Year</span>
            <input className="control" type="number" required value={year} onChange={e => setYear(Number(e.target.value))} /></label>
          <label className="field"><span className="field__label">Month</span>
            <select className="control" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></label>
        </div>
        <label className="field"><span className="field__label">Payment date <span className="hint">optional</span></span>
          <input className="control" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Gross <span className="hint">optional</span></span>
            <input className="control" type="number" step="0.01" value={gross} onChange={e => setGross(e.target.value)} /></label>
          <label className="field"><span className="field__label">Net <span className="hint">optional</span></span>
            <input className="control" type="number" step="0.01" value={net} onChange={e => setNet(e.target.value)} /></label>
        </div>
        <label className="field"><span className="field__label">Payslip PDF</span>
          <input className="control" type="file" accept="application/pdf" required
            onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        {error && <div className="notice notice--danger" style={{ marginTop: 10 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Uploading…" : "Upload payslip"}</button>
        </div>
      </form>
    </Modal>
  );
}
