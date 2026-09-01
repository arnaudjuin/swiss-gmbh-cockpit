"use client";
// Payroll — payslip preview (employee + employer side), YTD cards, payslips table.
import { useEffect, useState } from "react";
import { api, type Payslip, type PayrollPreview } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat, Chip } from "@/components/ui";

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

function Row({ label, value, strong, mod }: { label: string; value: string; strong?: boolean; mod?: "ok" | "danger" | "info" }) {
  return (
    <div className="row-split" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={strong ? { fontWeight: 600 } : undefined}>{label}</span>
      <span className={`money${mod ? ` t-${mod}` : ""}`} style={strong ? { fontWeight: 700 } : undefined}>{value}</span>
    </div>
  );
}

export default function PayrollPage() {
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<PayrollPreview>("/payroll/preview"), api<Payslip[]>("/payroll/payslips")])
      .then(([p, s]) => { setPreview(p); setSlips(s); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!preview) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const c = preview.calculation;
  const year = new Date().getFullYear();
  const ytd = slips.filter(s => s.year === year);
  const grossYtd = ytd.reduce((s, p) => s + p.gross, 0);
  const netYtd = ytd.reduce((s, p) => s + p.net_salary, 0);
  const costYtd = ytd.reduce((s, p) => s + p.total_employer_cost, 0);

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Payroll</h1></div>

      <div className="chart-card">
        <h3>Current monthly payslip preview{" "}
          <span className="hint">{preview.settings.employee_name} · Gross {chf(preview.settings.gross_monthly)}/mo · payday {preview.settings.payment_day}.</span></h3>
        <div className="cols-2">
          <div>
            <div className="section-label">Employee side</div>
            <Row label="Gross salary" value={chf(c.gross)} strong />
            <Row label="AHV / IV / EO" value={chf(c.emp_ahv)} />
            <Row label="ALV" value={chf(c.emp_alv)} />
            <Row label="BVG" value={chf(c.emp_bvg)} />
            <Row label="UVG" value={chf(c.emp_uvg)} />
            <Row label="KTG" value={chf(c.emp_ktg)} />
            <Row label="Source tax" value={chf(c.emp_source_tax)} />
            <Row label="Total deductions" value={chf(c.emp_total_deductions)} strong mod="danger" />
            <Row label="Net salary" value={chf(c.net_salary)} strong mod="ok" />
          </div>
          <div>
            <div className="section-label">Employer side</div>
            <Row label="AHV / IV / EO" value={chf(c.employer_ahv)} />
            <Row label="ALV" value={chf(c.employer_alv)} />
            <Row label="BVG" value={chf(c.employer_bvg)} />
            <Row label="UVG" value={chf(c.employer_uvg)} />
            <Row label="KTG" value={chf(c.employer_ktg)} />
            <Row label="FAK" value={chf(c.employer_fak)} />
            <Row label="Total employer contributions" value={chf(c.employer_total)} strong />
            <Row label="Total employer cost" value={chf(c.total_employer_cost)} strong mod="info" />
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label={`Gross YTD ${year}`} value={chf(grossYtd)} />
        <Stat label="Net YTD" value={chf(netYtd)} mod="ok" />
        <Stat label="Employer cost YTD" value={chf(costYtd)} mod="info" />
        <Stat label="Payslips issued" value={String(ytd.length)} />
      </div>

      <div className="finance-section">
        <h3>Payslips <span className="count">{slips.length}</span></h3>
        <div className="table-card">
          <table className="table table--compact">
            <thead><tr>
              <th>Month</th><th>Payment date</th><th className="text-right">Gross</th>
              <th className="text-right">Deductions</th><th className="text-right">Net</th>
              <th className="text-right">Employer cost</th><th>Status</th><th className="text-right">PDF</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
