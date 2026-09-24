"use client";
// Payroll — payslip preview (employee + employer side, with the verification
// notes), forward salary scenario, YTD cards (from /payroll/ytd), the setup
// reference and the payslips table. Mirrors the classic page-payroll screen.
import { useCallback, useEffect, useState } from "react";
import { api, type Payslip, type PayrollPreview } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat, Chip } from "@/components/ui";
import { SalaryScenario } from "@/components/SalaryScenario";
import { PayrollSettingsForm } from "@/components/PayrollSettingsForm";
import { GeneratePayslipForm } from "@/components/GeneratePayslipForm";
import { UploadPayslipForm } from "@/components/UploadPayslipForm";
import { ConfirmModal } from "@/components/Modal";

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

interface Ytd { year: number; count: number; totals: Record<string, number> }

function Row({ label, note, value, strong, mod }: {
  label: string; note?: string; value: string; strong?: boolean; mod?: "ok" | "danger" | "info";
}) {
  return (
    <div className="row-split" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={strong ? { fontWeight: 600 } : undefined}>
        {label} {note && <span className="hint hint--sm" style={{ marginLeft: 6 }}>{note}</span>}
      </span>
      <span className={`money${mod ? ` t-${mod}` : ""}`} style={strong ? { fontWeight: 700 } : undefined}>{value}</span>
    </div>
  );
}

export default function PayrollPage() {
  const y0 = new Date().getFullYear();
  const [year, setYear] = useState(y0);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [ytd, setYtd] = useState<Ytd | null>(null);
  const [projPrice, setProjPrice] = useState(0);
  const [error, setError] = useState("");
  const [editSettings, setEditSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<Payslip | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<PayrollPreview>("/payroll/preview"),
      api<Payslip[]>(`/payroll/payslips?year=${year}`),
      api<Ytd>(`/payroll/ytd/${year}`),
    ]).then(([p, s, y]) => { setPreview(p); setSlips(s); setYtd(y); })
      .catch(e => setError(String(e.message ?? e)));
    api<Record<string, any>>("/payroll/settings").then(setSettings).catch(() => setSettings(null));
    api<Record<string, any>>("/preferences").then(pr => setProjPrice(Number(pr?.vehicle?.projPrice) || 0)).catch(() => setProjPrice(0));
  }, [year]);
  useEffect(load, [load]);

  const setStatus = async (s: Payslip, status: "issued" | "paid") => {
    try { await api(`/payroll/payslip/${s.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };
  const remove = async (s: Payslip) => {
    try { await api(`/payroll/payslip/${s.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!preview) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const c = preview.calculation;
  const s = settings || {};
  const ktgEmpSharePct = s.ktg_employer_share_pct != null ? 100 - Number(s.ktg_employer_share_pct) : null;
  const provider = s.bvg_provider || "AXA";
  const tariff = s.source_tax_tariff || "";
  const t = ytd?.totals || {};
  const privMo = projPrice * 0.009;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Payroll</h1>
        <div className="btn-group">
          <select className="control" style={{ width: "auto" }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
            {[y0, y0 - 1, y0 - 2, y0 - 3].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn--outline" onClick={() => setEditSettings(true)}>⚙️ Settings</button>
          <button className="btn btn--outline" onClick={() => setUploading(true)}>⬆ Upload Payslip</button>
          <button className="btn btn--primary" onClick={() => setGenerating(true)}>＋ Generate Payslip</button>
        </div>
      </div>

      <div className="chart-card">
        <h3>Current monthly payslip preview{" "}
          <span className="hint">{preview.settings.employee_name} · Gross {chf(preview.settings.gross_monthly)}/mo · Start {preview.settings.employment_start}</span></h3>
        <div className="cols-2">
          <div>
            <div className="section-label">Employee side</div>
            <Row label="Gross salary" value={chf(c.gross)} strong />
            <Row label="AHV / IV / EO" note={s.ahv_employee_pct != null ? `Official ${s.ahv_employee_pct}%` : undefined} value={chf(c.emp_ahv)} />
            <Row label="ALV" note={s.alv_employee_pct != null ? `Official ${s.alv_employee_pct}% / 0.5% above plafond` : undefined} value={chf(c.emp_alv)} />
            <Row label={`BVG (${provider})`} note="Exact" value={chf(c.emp_bvg)} />
            <Row label="UVG (NOA)" note="Exact" value={chf(c.emp_uvg)} />
            <Row label={ktgEmpSharePct != null ? `KTG (${ktgEmpSharePct.toFixed(0)}%)` : "KTG"} note="Exact" value={chf(c.emp_ktg)} />
            {c.emp_source_tax > 0 && (
              <Row label={`Source Tax${tariff ? ` (${tariff})` : ""}`} note="Per tariff" value={chf(c.emp_source_tax)} />
            )}
            <Row label="Total deductions" value={chf(c.emp_total_deductions)} strong mod="danger" />
            <Row label="Net salary" value={chf(c.net_salary)} strong mod="ok" />
          </div>
          <div>
            <div className="section-label">Employer side</div>
            <Row label="AHV / IV / EO" note={s.ahv_employer_pct != null ? `Official ${s.ahv_employer_pct}%` : undefined} value={chf(c.employer_ahv)} />
            <Row label="ALV" note={s.alv_employer_pct != null ? `Official ${s.alv_employer_pct}% / 0.5% above plafond` : undefined} value={chf(c.employer_alv)} />
            <Row label={`BVG (${provider})`} note="Exact" value={chf(c.employer_bvg)} />
            <Row label="UVG (OA + Supp)" note="Exact" value={chf(c.employer_uvg)} />
            <Row label={s.ktg_employer_share_pct != null ? `KTG (${Number(s.ktg_employer_share_pct).toFixed(0)}%)` : "KTG"} note="Exact" value={chf(c.employer_ktg)} />
            {c.employer_fak > 0 && (
              <Row label="FAK (Family Allowance)" note={s.fak_employer_pct != null ? `${s.fak_employer_pct}%` : undefined} value={chf(c.employer_fak)} />
            )}
            <Row label="Total employer contributions" value={chf(c.employer_total)} strong />
            <Row label="Total employer cost" value={chf(c.total_employer_cost)} strong mod="info" />
          </div>
        </div>
        {projPrice > 0 && (
          <div className="notice notice--info" style={{ marginTop: 14 }}>
            <strong>Privatanteil — planned company car ({chf(projPrice)})</strong>: a benefit-in-kind of{" "}
            <span className="money">{chf(privMo)}</span>/mo (0.9%) would be added to gross salary once the car is booked —
            raising AHV/ALV (both sides ≈ <span className="money">{chf(privMo * 0.128)}</span>/mo), source tax, and adding 8.1% output VAT.
            <div className="hint hint--sm" style={{ marginTop: 4 }}>
              Not in the payslip above yet — it activates when the vehicle is booked. Details on Reports → Vehicle &amp; Depreciation.
            </div>
          </div>
        )}
      </div>

      <SalaryScenario />

      <div className="stats-grid">
        <Stat label={`Gross YTD ${year}`} value={chf(t.gross ?? 0)} />
        <Stat label="Net YTD" value={chf(t.net_salary ?? 0)} mod="ok" />
        <Stat label="Employee deductions" value={chf(t.emp_total_deductions ?? 0)} mod="danger" />
        <Stat label="Employer contributions" value={chf(t.employer_total ?? 0)} />
        <Stat label="Total employer cost" value={chf(t.total_employer_cost ?? 0)} mod="info" />
        <Stat label="Payslips issued" value={String(ytd?.count ?? 0)} />
      </div>

      <div className="chart-card" style={{ padding: 0 }}>
        <div style={{ padding: "14px 20px", cursor: "pointer" }} className="row-split" onClick={() => setNotesOpen(o => !o)}>
          <h3 style={{ margin: 0, fontSize: 14 }}>📒 Payroll setup reference — click to expand</h3>
          <span className="hint">verification · rules · money flow</span>
        </div>
        {notesOpen && (
          <div style={{ padding: "0 20px 16px 20px", borderTop: "1px solid var(--border)", fontSize: 13, lineHeight: 1.7 }}>
            <h4 className="section-label" style={{ margin: "16px 0 8px" }}>Exact vs Estimated</h4>
            <div><strong className="t-ok">Exact</strong> — BVG, UVG, KTG, Supplementary accident (all AXA policy #1.008.815.426)</div>
            <div><strong style={{ color: "var(--primary)" }}>Official</strong> — AHV/IV/EO 5.3% and ALV 1.1% (Swiss federal law; ALV drops to 0.5% on surplus above CHF 148,200/year)</div>
            <div><strong className="t-warn">Estimate — verify</strong> — Source Tax (get exact amount from ZH tariff tables) and FAK (check Ausgleichskasse annual rate sheet)</div>

            <h4 className="section-label" style={{ margin: "16px 0 8px" }}>Source Tax — B permit</h4>
            <div>Tariff code format: <code>A0N</code> = single / 0 children / no church</div>
            <div>1st letter: A=single · B=married sole earner · C=married both · H=single parent</div>
            <div>Digit: number of dependent children</div>
            <div>Last letter: N=no church · Y=with church</div>
            <div className="t-warn" style={{ marginTop: 6 }}>⚠ Gross &gt; CHF 120k/year → ordinary tax declaration (NOV) required. Source tax is an advance payment reconciled via annual declaration.</div>
            <div style={{ marginTop: 6 }}>Official tables: <a href="https://www.zh.ch/de/steuern-finanzen/steuern/quellensteuer.html" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>zh.ch/quellensteuer</a></div>

            <h4 className="section-label" style={{ margin: "16px 0 8px" }}>AXA policy #1.008.815.426</h4>
            <div>Validity: 2026-04-01 to 2029-12-31 · billed annually CHF 3,480.43</div>
            <div>Breakdown: OA 103.74 + NOA 1,839.16 + Supp. 255.21 + KTG 1,282.32</div>
            <div className="t-warn" style={{ marginTop: 4 }}>⚠ AXA is billed once per year — the monthly CHF 290.04 is bookkeeping accrual only.</div>

            <h4 className="section-label" style={{ margin: "16px 0 8px" }}>Monthly money flow from GmbH</h4>
            <div className="table-card" style={{ marginTop: 6 }}>
              <table className="table table--compact">
                <tbody>
                  <tr><td>Personal bank account (net salary)</td><td className="money">CHF 9,123.98</td></tr>
                  <tr><td>Canton ZH (source tax withholding)</td><td className="money">CHF 2,340.00</td></tr>
                  <tr><td>Ausgleichskasse (AHV/IV/EO/ALV both sides)</td><td className="money">CHF 1,664.00</td></tr>
                  <tr><td>Ausgleichskasse (FAK employer only)</td><td className="money">CHF 156.00</td></tr>
                  <tr><td>AXA — BVG (2nd pillar)</td><td className="money">CHF 1,306.50</td></tr>
                  <tr><td>AXA — accident + KTG (accrued)</td><td className="money">CHF 290.04</td></tr>
                  <tr className="table__total"><td>Total GmbH outflow</td><td className="money">CHF 14,880.52</td></tr>
                </tbody>
              </table>
            </div>

            <h4 className="section-label" style={{ margin: "16px 0 8px" }}>Items to verify</h4>
            <ol style={{ marginLeft: 20 }}>
              <li>Source tax amount — pull exact from ZH tariff table for your tariff code</li>
              <li>FAK rate — check your Ausgleichskasse annual rate sheet</li>
              <li>BVG rate matches age bracket (current ~12% of coordinated salary, corresponds to age 35–44 bracket)</li>
              <li>Supplementary accident split — currently 100% employer, may optionally be split</li>
            </ol>
            <div className="hint" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>Full reference kept in <code>PAYROLL_NOTES.md</code> at the project root.</div>
          </div>
        )}
      </div>

      <div className="finance-section">
        <h3>Payslips <span className="count">{slips.length}</span></h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr>
              <th>Month</th><th>Payment date</th><th className="text-right">Gross</th>
              <th className="text-right">Deductions</th><th className="text-right">Net</th>
              <th className="text-right">Employer cost</th><th>Status</th><th className="text-right">PDF</th>
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {slips.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.month_name} {s.year}</strong></td>
                  <td className="mono">{s.payment_date}</td>
                  <td className="money">{chf(s.gross)}</td>
                  <td className="money t-danger">{chf(s.emp_total_deductions)}</td>
                  <td className="money t-ok">{chf(s.net_salary)}</td>
                  <td className="money">{chf(s.total_employer_cost)}</td>
                  <td><Chip mod={s.status === "issued" ? "warn" : "ok"}>{s.status}</Chip></td>
                  <td className="text-right">
                    {s.has_pdf
                      ? <a href={`/api/payroll/payslip/${s.id}/pdf?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer">📄</a>
                      : <span className="hint">–</span>}
                  </td>
                  <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                    {s.status === "issued"
                      ? <button className="btn btn--ok btn--sm" title="Mark paid" onClick={() => setStatus(s, "paid")}>Mark paid</button>
                      : <button className="btn btn--warn btn--sm" title="Mark issued" onClick={() => setStatus(s, "issued")}>Mark issued</button>}
                    <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => setToDelete(s)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editSettings && (
        <PayrollSettingsForm onClose={() => setEditSettings(false)}
          onSaved={() => { setEditSettings(false); load(); }} />
      )}
      {generating && (
        <GeneratePayslipForm onClose={() => setGenerating(false)}
          onSaved={() => { setGenerating(false); load(); }} />
      )}
      {uploading && (
        <UploadPayslipForm defaultYear={year} onClose={() => setUploading(false)}
          onSaved={() => { setUploading(false); load(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete payslip"
          message={<>Delete the payslip for <strong>{toDelete.month_name} {toDelete.year}</strong> ({chf(toDelete.net_salary)} net)? This can&apos;t be undone.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
