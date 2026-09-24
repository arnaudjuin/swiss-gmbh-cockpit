"use client";
// Reports — VAT & tax filings, payroll summaries, vehicle depreciation and the
// accountant export. Widget order mirrors the classic #reports-widgets:
// Quarterly Summary → VAT Tracker → Booked vs income-derived → Vehicle &
// Depreciation → Google Sheets sync → Accountant Package.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Chip } from "@/components/ui";
import { QuarterlyPanel } from "@/components/QuarterlyPanel";
import { ReconcilePanel } from "@/components/ReconcilePanel";
import { VehicleCard } from "@/components/VehicleCard";
import { SheetUrls } from "@/components/SheetUrls";

export default function ReportsPage() {
  const y0 = new Date().getFullYear();
  const [year, setYear] = useState(y0);

  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "";

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="hint">VAT &amp; tax filings, payroll summaries, vehicle depreciation and the accountant export</p>
        </div>
        <div className="btn-group">
          <label className="hint" htmlFor="reports-year" style={{ alignSelf: "center" }}>Year</label>
          <select id="reports-year" className="control" style={{ width: "auto" }} value={year}
            onChange={e => setYear(parseInt(e.target.value, 10))}>
            {[y0, y0 - 1, y0 - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <a className="btn btn--outline" href={`/api/reports/pl/${year}/excel?token=${encodeURIComponent(token)}`}>P&amp;L Excel</a>
        </div>
      </div>

      <div id="reports-widgets">
        <QuarterlyPanel year={year} />

        <div className="finance-section">
          <div className="report-widget-header"><h3 style={{ margin: 0 }}>VAT Tracker</h3></div>
          <p className="hint" style={{ margin: "8px 0 12px 0" }}>
            Quarterly filings (effective method, payment due 60 days after quarter end). Output VAT = charged on your
            invoices. Deductions = recorded bill VAT + simulated input VAT for bills without one + your flat allowance.
          </p>
          <VatQuarters year={year} />
        </div>

        <ReconcilePanel year={year} />

        <div className="finance-section">
          <div className="report-widget-header"><h3 style={{ margin: 0 }}>Vehicle &amp; Depreciation</h3></div>
          <p className="hint" style={{ margin: "8px 0 12px 0" }}>
            GmbH-owned vehicles: book value and annual depreciation, plus the downstream tax effects — the
            corporate-tax saving on the depreciation, and the Privatanteil (private-use benefit) with its AHV,
            source tax and VAT.
          </p>
          <VehicleCard />
        </div>

        <SheetUrls />

        <div className="chart-card">
          <div className="report-widget-header"><h3 style={{ margin: 0 }}>Accountant Package</h3></div>
          <p className="hint" style={{ margin: "8px 0 12px 0" }}>
            One-click export: all invoices (PDF), bills (with files), expense report, obligations summary —
            everything your accountant needs.
          </p>
          <a className="btn btn--primary" href={`/api/reports/accountant-package/${year}?token=${encodeURIComponent(token)}`}>
            Download full package (ZIP)
          </a>
        </div>
      </div>
    </div>
  );
}

interface VatQ {
  year: number; quarter: number; period: string;
  output_vat: number; input_vat_recorded: number; input_vat_estimated: number;
  estimated_bills: number; flat_deduction: number; input_vat: number;
  vat_due: number; vat_due_file: number; due_date: string;
  obligation: { id: number; amount: number; status: string; due_date: string | null; doc_file: string | null } | null;
}

// Effective-method VAT: file-ready net (recorded input only) is the headline;
// the planning figure (incl. simulated input) is secondary. Mirrors loadVAT().
function VatQuarters({ year }: { year: number }) {
  const [qs, setQs] = useState<VatQ[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false); setQs(null);
    Promise.all([1, 2, 3, 4].map(q => api<VatQ>(`/vat/${year}/${q}`)))
      .then(setQs).catch(() => setFailed(true));
  }, [year]);
  useEffect(load, [load]);

  async function book(quarter: number) {
    try { await api(`/vat/${year}/${quarter}/obligation`, { method: "POST" }); load(); } catch { /* toast elsewhere */ }
  }
  async function toggle(id: number, status: string) {
    const next = status === "paid" ? "unpaid" : "paid";
    try { await api(`/obligations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) }); load(); } catch { /* */ }
  }

  if (failed) return <p className="hint">No VAT data available</p>;
  if (!qs) return <p className="hint">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  let yearFile = 0, yearPlanning = 0, anySimulated = false;

  const cards = qs.map(v => {
    const qEnd = new Date(v.year, v.quarter * 3, 0);          // last day of the quarter
    const qStart = new Date(v.year, (v.quarter - 1) * 3, 1);
    const state = qEnd < now ? "past" : (qStart <= now ? "current" : "future");
    const ob = v.obligation;
    const readjusted = !!(ob && ob.doc_file);                 // official assessment uploaded → authoritative
    const fileNet = readjusted ? ob!.amount : (v.vat_due_file != null ? v.vat_due_file : v.vat_due);
    const simulated = v.input_vat_estimated || 0;
    const planningNet = v.vat_due;                            // incl. simulated (optimistic)
    const overdue = state !== "future" && fileNet > 0 && v.due_date < today && (!ob || ob.status !== "paid");
    const credit = state === "past" && fileNet < -0.01;       // real refund position (audit-sensitive)
    if (state !== "future") { yearFile += fileNet; yearPlanning += planningNet; }
    if (simulated > 0) anySimulated = true;

    let chip: React.ReactNode;
    if (ob && ob.status === "paid") chip = <Chip mod="ok">filed &amp; paid</Chip>;
    else if (overdue) chip = <Chip mod="danger">overdue</Chip>;
    else if (credit) chip = <Chip mod="danger">credit — verify</Chip>;
    else if (state === "future") chip = <Chip>upcoming</Chip>;
    else if (state === "current") chip = <Chip mod="info">in progress</Chip>;
    else chip = <Chip mod="warn">to file</Chip>;

    let obl: React.ReactNode;
    if (ob) {
      const drift = !readjusted && Math.abs(ob.amount - fileNet) > 0.01 && ob.status !== "paid";
      obl = (
        <>
          <span className={`chip chip--sm ${ob.status === "paid" ? "chip--ok" : "chip--warn"}`}
                style={{ cursor: "pointer" }}
                title={`Click to mark ${ob.status === "paid" ? "unpaid" : "paid"}`}
                onClick={() => toggle(ob.id, ob.status)}>{ob.status}</span>
          {readjusted && <span className="hint hint--sm" title="Official assessment uploaded — authoritative"> 📎 assessment</span>}
          {drift && <a href="#" style={{ fontSize: 11, marginLeft: 6 }}
                       title={`Booked amount differs from the file figure — click to update to ${chf(fileNet)}`}
                       onClick={e => { e.preventDefault(); book(v.quarter); }}>update to {chf(fileNet)}</a>}
        </>
      );
    } else if (state !== "future" && fileNet > 0) {
      obl = <a href="#" style={{ fontSize: 11 }} onClick={e => { e.preventDefault(); book(v.quarter); }}>+ book obligation</a>;
    } else {
      obl = <span className="hint hint--sm">{state === "future" ? "not invoiced yet" : (credit ? "refund position" : "nothing due")}</span>;
    }

    return (
      <div className="panel" key={v.quarter} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="row-split" style={{ alignItems: "baseline" }}>
          <strong>{v.period}</strong> {chip}
        </div>
        <div className="row-split" style={{ alignItems: "baseline", margin: "2px 0 6px" }}>
          <span className="hint hint--sm">Net to file</span>
          <span className={`money money--lg ${fileNet > 0 ? "" : "money--ok"}`}>{state === "future" ? "—" : chf(fileNet)}</span>
        </div>
        <div className="row-split" style={{ padding: "1px 0" }}><span className="hint hint--sm">Output VAT</span><span className="money">{chf(v.output_vat)}</span></div>
        <div className="row-split" style={{ padding: "1px 0" }}><span className="hint hint--sm">− Recorded input</span><span className="money">−{chf(v.input_vat_recorded)}</span></div>
        {v.flat_deduction > 0 && (
          <div className="row-split" style={{ padding: "1px 0" }}><span className="hint hint--sm">− Flat allowance</span><span className="money">−{chf(v.flat_deduction)}</span></div>
        )}
        {simulated > 0 && (
          <div className="hint hint--sm t-warn" style={{ marginTop: 4 }}>
            Planning only: with ~{chf(simulated)} simulated input ({v.estimated_bills} bill{v.estimated_bills === 1 ? "" : "s"} lacking a VAT amount), net ≈ {chf(planningNet)} — not for filing.
          </div>
        )}
        <div className="row-split" style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid var(--border)" }}>
          <span className="hint hint--sm">{state === "future" ? "file after" : "due"} {(ob && ob.due_date) || v.due_date}</span>
          <span>{obl}</span>
        </div>
      </div>
    );
  });

  return (
    <div className="stats-grid" style={{ marginTop: 8 }}>
      <div className="panel" style={{ gridColumn: "1/-1" }}>
        <div className="row-split" style={{ alignItems: "center", gap: 16 }}>
          <div>
            <div className="section-label">Net VAT to file · {year}</div>
            <div className={`money ${yearFile > 0 ? "" : "money--ok"}`} style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{chf(yearFile)}</div>
            <div className="hint hint--sm">recorded input only — the figure you file</div>
          </div>
          {anySimulated && (
            <div style={{ textAlign: "right" }}>
              <div className="hint hint--sm">with simulated input</div>
              <div className="money" style={{ fontSize: 16 }}>{chf(yearPlanning)}</div>
              <div className="hint hint--sm t-warn">planning only</div>
            </div>
          )}
        </div>
      </div>
      {cards}
    </div>
  );
}
