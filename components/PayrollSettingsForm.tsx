"use client";
// Edit payroll settings — PUTs JSON to /payroll/settings (the route reads
// req.json()). Field names mirror the PUT handler exactly. Fetches the current
// settings on mount to prefill, like the classic 50-dialogs.html payroll dialog.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Shape returned by GET /payroll/settings (server/payroll.ts::rowToSettings).
export interface PayrollSettings {
  employer_name: string; employee_name: string; employee_address: string;
  employment_start: string; canton: string; currency: string; payment_day: number;
  gross_monthly: number;
  ahv_employee_pct: number; ahv_employer_pct: number;
  alv_employee_pct: number; alv_employer_pct: number;
  bvg_monthly_employee: number; bvg_monthly_employer: number; bvg_provider: string;
  uvg_employee_monthly: number; uvg_employer_monthly: number;
  ktg_monthly_total: number; ktg_employer_share_pct: number;
  fak_employer_pct: number; source_tax_monthly: number; source_tax_tariff: string;
}

const NUMERIC: (keyof PayrollSettings)[] = [
  "payment_day", "gross_monthly", "ahv_employee_pct", "ahv_employer_pct",
  "alv_employee_pct", "alv_employer_pct", "bvg_monthly_employee", "bvg_monthly_employer",
  "uvg_employee_monthly", "uvg_employer_monthly", "ktg_monthly_total",
  "ktg_employer_share_pct", "fak_employer_pct", "source_tax_monthly",
];

export function PayrollSettingsForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PayrollSettings>("/payroll/settings")
      .then(setSettings)
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true); setError("");
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      payload[k] = (NUMERIC as string[]).includes(k) ? Number(v) : v;
    }
    try {
      await api("/payroll/settings", { method: "PUT", body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Payroll settings" onClose={onClose} wide>
      {error && <div className="notice notice--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!settings ? <div className="hint">Loading…</div> : (
        <form onSubmit={submit}>
          <div className="section-label">Parties</div>
          <label className="field"><span className="field__label">Employer name</span>
            <input className="control" name="employer_name" required defaultValue={settings.employer_name} /></label>
          <label className="field"><span className="field__label">Employee name</span>
            <input className="control" name="employee_name" required defaultValue={settings.employee_name} /></label>
          <label className="field"><span className="field__label">Employee address</span>
            <input className="control" name="employee_address" required defaultValue={settings.employee_address} /></label>
          <div className="cols-2">
            <label className="field"><span className="field__label">Employment start</span>
              <input className="control" type="date" name="employment_start" required defaultValue={settings.employment_start} /></label>
            <label className="field"><span className="field__label">Canton</span>
              <input className="control" name="canton" defaultValue={settings.canton} /></label>
          </div>
          <div className="cols-2">
            <label className="field"><span className="field__label">Payment day</span>
              <input className="control" type="number" name="payment_day" min="1" max="28" defaultValue={settings.payment_day} /></label>
            <label className="field"><span className="field__label">Currency</span>
              <input className="control" name="currency" defaultValue={settings.currency} /></label>
          </div>

          <div className="section-label">Salary</div>
          <label className="field"><span className="field__label">Gross monthly (CHF)</span>
            <input className="control" type="number" step="0.01" min="0" name="gross_monthly" required defaultValue={settings.gross_monthly} /></label>

          <div className="section-label">AHV / IV / EO &amp; ALV (%)</div>
          <div className="cols-2">
            <label className="field"><span className="field__label">AHV employee %</span>
              <input className="control" type="number" step="0.01" name="ahv_employee_pct" defaultValue={settings.ahv_employee_pct} /></label>
            <label className="field"><span className="field__label">AHV employer %</span>
              <input className="control" type="number" step="0.01" name="ahv_employer_pct" defaultValue={settings.ahv_employer_pct} /></label>
          </div>
          <div className="cols-2">
            <label className="field"><span className="field__label">ALV employee %</span>
              <input className="control" type="number" step="0.01" name="alv_employee_pct" defaultValue={settings.alv_employee_pct} /></label>
            <label className="field"><span className="field__label">ALV employer %</span>
              <input className="control" type="number" step="0.01" name="alv_employer_pct" defaultValue={settings.alv_employer_pct} /></label>
          </div>

          <div className="section-label">BVG — 2nd pillar</div>
          <label className="field"><span className="field__label">BVG provider</span>
            <input className="control" name="bvg_provider" defaultValue={settings.bvg_provider} /></label>
          <div className="cols-2">
            <label className="field"><span className="field__label">BVG monthly — employee</span>
              <input className="control" type="number" step="0.01" min="0" name="bvg_monthly_employee" defaultValue={settings.bvg_monthly_employee} /></label>
            <label className="field"><span className="field__label">BVG monthly — employer</span>
              <input className="control" type="number" step="0.01" min="0" name="bvg_monthly_employer" defaultValue={settings.bvg_monthly_employer} /></label>
          </div>

          <div className="section-label">UVG accident insurance</div>
          <div className="cols-2">
            <label className="field"><span className="field__label">UVG employee (NBU) / mo</span>
              <input className="control" type="number" step="0.01" min="0" name="uvg_employee_monthly" defaultValue={settings.uvg_employee_monthly} /></label>
            <label className="field"><span className="field__label">UVG employer (BU) / mo</span>
              <input className="control" type="number" step="0.01" min="0" name="uvg_employer_monthly" defaultValue={settings.uvg_employer_monthly} /></label>
          </div>

          <div className="section-label">KTG — daily sickness</div>
          <div className="cols-2">
            <label className="field"><span className="field__label">KTG monthly total</span>
              <input className="control" type="number" step="0.01" min="0" name="ktg_monthly_total" defaultValue={settings.ktg_monthly_total} /></label>
            <label className="field"><span className="field__label">Employer share %</span>
              <input className="control" type="number" step="1" min="0" max="100" name="ktg_employer_share_pct" defaultValue={settings.ktg_employer_share_pct} /></label>
          </div>

          <div className="section-label">FAK — family allowance (employer-only)</div>
          <label className="field"><span className="field__label">FAK rate %</span>
            <input className="control" type="number" step="0.01" min="0" name="fak_employer_pct" defaultValue={settings.fak_employer_pct} /></label>

          <div className="section-label">Source tax (Quellensteuer)</div>
          <div className="cols-2">
            <label className="field"><span className="field__label">Tariff code</span>
              <input className="control" name="source_tax_tariff" maxLength={8} placeholder="e.g. A0N" defaultValue={settings.source_tax_tariff} /></label>
            <label className="field"><span className="field__label">Monthly amount (CHF)</span>
              <input className="control" type="number" step="0.01" min="0" name="source_tax_monthly" defaultValue={settings.source_tax_monthly} /></label>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
