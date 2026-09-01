"use client";
// Reports — the annual P&L (accrual, same lens as the dashboard).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Stat } from "@/components/ui";

interface PL {
  year: number; basis: string;
  revenue: { invoices_issued: number; invoices_paid: number; extra_income: number; total: number };
  costs: { salary: number; payslip_count: number; company_docs_total: number; total: number;
    company_docs: { category: string; total: number }[] };
  obligations: { breakdown: { type: string; label?: string; total: number }[]; total: number; note: string };
  profit_before_tax: number; profit_margin_pct: number;
}

export default function ReportsPage() {
  const y0 = new Date().getFullYear();
  const [year, setYear] = useState(y0);
  const [pl, setPl] = useState<PL | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setPl(null);
    api<PL>(`/reports/pl/${year}`).then(setPl).catch(e => setError(String(e.message ?? e)));
  }, [year]);
  useEffect(load, [load]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!pl) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "";

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Reports — P&amp;L {pl.year}</h1>
        <div className="btn-group">
          <select className="control" style={{ width: "auto" }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
            {[y0, y0 - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <a className="btn btn--outline" href={`/api/reports/pl/${year}/excel?token=${encodeURIComponent(token)}`}>P&amp;L Excel</a>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Revenue" value={chf(pl.revenue.total)} mod="ok"
          hint={`invoiced ${chf(pl.revenue.invoices_issued)} · other ${chf(pl.revenue.extra_income)}`} />
        <Stat label="Costs" value={chf(pl.costs.total)} mod="danger"
          hint={`payroll ${chf(pl.costs.salary)} (${pl.costs.payslip_count} payslips) + bills ${chf(pl.costs.company_docs_total)}`} />
        <Stat label="Profit before tax" value={chf(pl.profit_before_tax)}
          mod={pl.profit_before_tax >= 0 ? "ok" : "danger"} hint={`${pl.profit_margin_pct}% margin · ${pl.basis}`} />
      </div>

      <div className="cols-2">
        <div className="table-card">
          <div className="table-header"><h3>Bills by category</h3></div>
          <table className="table table--compact">
            <tbody>
              {pl.costs.company_docs.map(c => (
                <tr key={c.category}><td>{c.category}</td><td className="money">{chf(c.total)}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="money"><strong>{chf(pl.costs.company_docs_total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <div className="table-card">
          <div className="table-header"><h3>Obligations (payment side — not in P&amp;L)</h3></div>
          <table className="table table--compact">
            <tbody>
              {pl.obligations.breakdown.map((o, i) => (
                <tr key={i}><td>{o.label ?? o.type}</td><td className="money">{chf(o.total)}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="money"><strong>{chf(pl.obligations.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">{pl.obligations.note}</p>
    </div>
  );
}
