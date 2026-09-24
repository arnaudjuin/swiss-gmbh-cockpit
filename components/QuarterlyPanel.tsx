"use client";
// Reports → Quarterly Summary (AHV / BVG / Filings). Q1–Q4 selector + the
// per-quarter stat row, invoices table and bills-by-category breakdown.
// Mirrors loadQuarterly() in static/js/08-payroll.js.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { badgeClass } from "@/lib/badge";

const pad4 = (n: number) => String(n).padStart(4, "0");

interface Quarterly {
  year: number; quarter: number; period_label: string;
  invoices: { count: number; total: number; items: { invoice_number: number; month: number; total: number; hours: number }[] };
  salary: { monthly: number; quarterly_total: number; payslip_count: number };
  ahv_estimate: { employee_contribution: number; employer_contribution: number; total: number; basis: string };
  gross_income: number;
  bills_by_category: { category: string; count: number; total: number }[];
  bills_total: number;
  obligations_total: number;
}

export function QuarterlyPanel({ year }: { year: number }) {
  const [q, setQ] = useState<number>(() => Math.floor(new Date().getMonth() / 3) + 1);
  const [data, setData] = useState<Quarterly | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setData(null); setError("");
    api<Quarterly>(`/reports/quarterly/${year}/${q}`).then(setData).catch(e => setError(String(e.message ?? e)));
  }, [year, q]);
  useEffect(load, [load]);

  return (
    <div className="finance-section">
      <div className="report-widget-header">
        <h3 style={{ margin: 0 }}>Quarterly Summary (AHV / BVG / Filings)</h3>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {[1, 2, 3, 4].map(n => (
          <button key={n} className={`btn ${n === q ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setQ(n)}>Q{n}</button>
        ))}
      </div>
      <div id="quarterly-content">
        {error && <p className="hint">{error}</p>}
        {!error && !data && <p className="hint">Loading…</p>}
        {data && (
          <>
            <div className="stats-grid" style={{ marginBottom: 12 }}>
              <div className="stat">
                <div className="stat__label">Gross Income</div>
                <div className="stat__value stat__value--ok">{chf(data.gross_income)}</div>
                <div className="stat__hint">Invoices {chf(data.invoices.total)} + wages {chf(data.salary.quarterly_total)} ({data.salary.payslip_count ?? "?"} payslips)</div>
              </div>
              <div className="stat">
                <div className="stat__label">AHV Employee (5.3%)</div>
                <div className="stat__value">{chf(data.ahv_estimate.employee_contribution)}</div>
                <div className="stat__hint">{data.ahv_estimate.basis || ""}</div>
              </div>
              <div className="stat">
                <div className="stat__label">AHV Employer (5.3%)</div>
                <div className="stat__value">{chf(data.ahv_estimate.employer_contribution)}</div>
              </div>
              <div className="stat stat--info">
                <div className="stat__label">AHV Total</div>
                <div className="stat__value stat__value--info">{chf(data.ahv_estimate.total)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Bills Paid</div>
                <div className="stat__value">{chf(data.bills_total)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Obligations Due</div>
                <div className="stat__value">{chf(data.obligations_total)}</div>
              </div>
            </div>

            {data.invoices.items.length > 0 && (
              <div className="table-card" style={{ marginBottom: 12 }}>
                <div className="table-header"><h3 style={{ fontSize: 13 }}>Invoices in {data.period_label}</h3></div>
                <table className="table table--compact">
                  <thead><tr><th>#</th><th>Month</th><th>Hours</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {data.invoices.items.map(i => (
                      <tr key={i.invoice_number}>
                        <td className="mono">#{pad4(i.invoice_number)}</td>
                        <td>{new Date(year, i.month - 1).toLocaleString("en", { month: "long" })}</td>
                        <td>{i.hours}</td>
                        <td className="money">{chf(i.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.bills_by_category.length > 0 && (
              <div className="table-card" style={{ marginBottom: 12 }}>
                <div className="table-header"><h3 style={{ fontSize: 13 }}>Bills by Category</h3></div>
                <table className="table table--compact">
                  <thead><tr><th>Category</th><th>Count</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {data.bills_by_category.map(c => (
                      <tr key={c.category}>
                        <td><span className={`${badgeClass(c.category)} chip--sm`}>{c.category}</span></td>
                        <td>{c.count}</td>
                        <td className="money">{chf(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
