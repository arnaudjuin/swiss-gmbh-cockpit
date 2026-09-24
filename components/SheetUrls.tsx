"use client";
// Reports → Google Sheets sync. Collapsible list of live =IMPORTDATA(url) cells
// that auto-refresh in Google Sheets, built off the accounting share link.
// Mirrors loadSheetsUrls() in static/js/08-payroll.js.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Share { id: number; token: string; section: string }

export function SheetUrls() {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<{ label: string; url: string }[] | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    api<Share[]>("/shares").then(shares => {
      const acct = shares.find(s => s.section === "accounting");
      if (!acct) { setEmpty(true); return; }
      const base = `${window.location.origin}/share/${acct.token}/sheet`;
      setUrls([
        { label: "Invoices", url: `${base}/invoices.csv` },
        { label: "Bills", url: `${base}/bills.csv` },
        { label: "Travel Expenses", url: `${base}/expenses.csv` },
      ]);
    }).catch(() => setEmpty(true));
  }, []);

  return (
    <div className="chart-card" style={{ padding: 0, marginBottom: 16 }}>
      <div className="report-widget-header" style={{ padding: "14px 20px", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <h3 style={{ margin: 0, fontSize: 14 }}>📊 Google Sheets sync</h3>
        <span className="hint">{open ? "click to collapse" : "click to expand"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 20px 16px 20px", borderTop: "1px solid var(--border)" }}>
          <p className="hint" style={{ margin: "12px 0" }}>
            Live URLs that auto-refresh in Google Sheets via <code>=IMPORTDATA(url)</code>. Requires a share link to be
            created first (Bills &amp; Documents → Share).
          </p>
          {empty && <p className="hint">No share link yet — create one on Bills &amp; Documents (Share button).</p>}
          {!empty && !urls && <p className="hint">Loading…</p>}
          {urls && (
            <>
              {urls.map(u => {
                const cell = `=IMPORTDATA("${u.url}")`;
                return (
                  <div key={u.label} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
                    <strong style={{ minWidth: 120 }}>{u.label}</strong>
                    <input type="text" value={cell} readOnly onClick={e => (e.target as HTMLInputElement).select()}
                      className="control" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                    <button className="btn btn--ghost btn--sm" title="Copy"
                      onClick={() => navigator.clipboard.writeText(cell)}>📋</button>
                  </div>
                );
              })}
              <p className="hint" style={{ marginTop: 8 }}>Paste any cell into Google Sheets — it pulls the live data and refreshes hourly.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
