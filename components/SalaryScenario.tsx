"use client";
// Forward salary scenario — the single source the Forecast reads for future
// years. Port of static/js/08-payroll.js::renderSalaryScenario. Writes
// payrollPlan.<year>._netSalary / _grossSalary / _sickFrom into the same
// server-backed preferences the forecast engine reads.
import { useEffect, useState } from "react";
import { loadPrefs, pref, setPref } from "@/lib/prefs";

const MONTHS = ["Working all year", "from January", "from February", "from March", "from April",
  "from May", "from June", "from July", "from August", "from September", "from October",
  "from November", "from December"];

interface Plan { _netSalary?: number | string; _grossSalary?: number | string; _sickFrom?: number }

export function SalaryScenario() {
  const y0 = new Date().getFullYear();
  const years = [y0, y0 + 1, y0 + 2];
  const [plans, setPlans] = useState<Record<number, Plan> | null>(null);

  useEffect(() => {
    loadPrefs().then(p => {
      const out: Record<number, Plan> = {};
      for (const y of years) out[y] = pref<Plan>(p, `payrollPlan.${y}`, {}) || {};
      setPlans(out);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!plans) return null;

  const write = async (year: number, field: "net" | "gross" | "sick", raw: string) => {
    const key = field === "net" ? "_netSalary" : field === "gross" ? "_grossSalary" : "_sickFrom";
    let value: number | string;
    if (field === "sick") value = parseInt(raw, 10) || 0;
    else { const n = parseFloat(raw); value = raw === "" || !Number.isFinite(n) ? "" : n; }
    await setPref(`payrollPlan.${year}.${key}`, value);
    setPlans(prev => ({ ...prev!, [year]: { ...prev![year], [key]: value } }));
  };

  const numVal = (v: number | string | undefined) =>
    v != null && v !== "" ? String(Math.round(Number(v))) : "";

  return (
    <div className="finance-section">
      <h3>Forward salary scenario{" "}
        <span className="hint">what the Forecast assumes for future years</span></h3>
      <div className="table-card" style={{ marginTop: 6 }}>
        <table className="table table--compact">
          <thead><tr><th>Year</th><th>Net /mo</th><th>Gross /mo</th><th>Sick leave</th></tr></thead>
          <tbody>
            {years.map(y => {
              if (y <= y0) return (
                <tr key={y}>
                  <td><strong>{y}</strong> <span className="chip chip--ok chip--sm">actual</span></td>
                  <td className="hint" colSpan={3}>from your issued payslips (Payroll Settings)</td>
                </tr>
              );
              const pl = plans[y] || {};
              return (
                <tr key={y}>
                  <td><strong>{y}</strong> <span className="chip chip--expected chip--sm">scenario</span></td>
                  <td>
                    <input type="number" className="control control--auto" style={{ width: 96 }} min={0} step={100}
                      placeholder="net/mo" defaultValue={numVal(pl._netSalary)} key={`n${y}-${numVal(pl._netSalary)}`}
                      onBlur={e => write(y, "net", e.target.value)} />
                  </td>
                  <td>
                    <input type="number" className="control control--auto" style={{ width: 104 }} min={0} step={100}
                      placeholder="gross/mo" defaultValue={numVal(pl._grossSalary)} key={`g${y}-${numVal(pl._grossSalary)}`}
                      onBlur={e => write(y, "gross", e.target.value)} />
                  </td>
                  <td>
                    <select className="control control--auto" value={Number(pl._sickFrom) || 0}
                      onChange={e => write(y, "sick", e.target.value)}>
                      {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Set a future year&apos;s net salary (and gross for the source-tax basis), plus the month the GmbH
        salary stops if you go on paid sick leave (KTG takes over). The <strong>Forecast</strong> and its
        month-by-month cards read exactly these values.
      </p>
    </div>
  );
}
