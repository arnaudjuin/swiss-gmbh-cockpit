"use client";
// Generate a monthly payslip — POSTs JSON to /payroll/generate/:year/:month
// (the route reads req.json() for the opt-in side-effect flags). Mirrors the
// classic "Generate Payslip" dialog in 50-dialogs.html.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function GeneratePayslipForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [income, setIncome] = useState(true);
  const [transfer, setTransfer] = useState(true);
  const [obligations, setObligations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await api(`/payroll/generate/${year}/${month}`, {
        method: "POST",
        body: JSON.stringify({ create_income: income, create_transfer: transfer, create_obligations: obligations }),
      });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Generate payslip" onClose={onClose}>
      <p className="hint" style={{ margin: "4px 0 12px" }}>
        Creates a monthly payslip PDF using current settings. Each side-effect is opt-in;
        already-logged entries are detected and skipped.
      </p>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Year</span>
            <input className="control" type="number" required value={year}
              onChange={e => setYear(Number(e.target.value))} /></label>
          <label className="field"><span className="field__label">Month</span>
            <select className="control" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></label>
        </div>

        <div className="section-label">Automatic side-effects</div>
        <label className="field" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={income} onChange={e => setIncome(e.target.checked)} />
          <span><strong>Log income entry</strong>
            <span className="hint"> — adds net salary to the Income page (Category: Salary).</span></span>
        </label>
        <label className="field" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={transfer} onChange={e => setTransfer(e.target.checked)} />
          <span><strong>Log transfer (GmbH → Personal)</strong>
            <span className="hint"> — records net moving from company to personal on the payment date.</span></span>
        </label>
        <label className="field" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={obligations} onChange={e => setObligations(e.target.checked)} />
          <span><strong>Create obligations (AHV/ALV, UVG, KTG)</strong>
            <span className="hint"> — the amounts the GmbH owes the authorities for this month.</span></span>
        </label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Generating…" : "Generate"}</button>
        </div>
      </form>
    </Modal>
  );
}
