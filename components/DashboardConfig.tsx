"use client";
// Dashboard "Customize" modal — a React port of showDashboardConfig() /
// saveDashboardConfig() from the classic SPA (static/js/02-dashboard.js).
// It reads and writes the SAME server-backed prefs the classic uses, so both
// frontends agree on which cards/sections are visible:
//   - `dashboard.widgets` : string[] of ENABLED widget ids
//   - `dashboard.seen`    : string[] of widget ids the user has judged (so a
//                            newly-shipped default widget shows once instead of
//                            being silently hidden by an older saved layout).
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { pref, setPref } from "@/lib/prefs";

export interface WidgetDef { id: string; label: string; group: string; default: boolean }

// Ids match the classic DASHBOARD_WIDGETS so a layout saved in either frontend
// is understood by the other. `recap-strip`, `bank-balance` and
// `reserves-detail` are Next-only aggregates (the classic renders those inside
// its per-tile recap widgets); the classic simply ignores ids it doesn't know.
export const WIDGET_DEFS: WidgetDef[] = [
  // Stat cards
  { id: "income-ytd", label: "Total Income", group: "Cards", default: true },
  { id: "costs-ytd", label: "Total Costs", group: "Cards", default: true },
  { id: "profit-ytd", label: "Net Profit", group: "Cards", default: true },
  { id: "profit-margin", label: "Profit Margin %", group: "Cards", default: true },
  { id: "avg-monthly-rev", label: "Average Monthly Revenue", group: "Cards", default: true },
  { id: "avg-monthly-hours", label: "Average Monthly Hours", group: "Cards", default: true },
  { id: "overdue", label: "Overdue Amount", group: "Cards", default: true },
  { id: "upcoming-30d", label: "Due Next 30 Days", group: "Cards", default: true },
  { id: "net-salary", label: "Net Salary (monthly)", group: "Cards", default: true },
  { id: "upcoming-obligations", label: "Next Obligations Due", group: "Cards", default: true },
  // Sections
  { id: "recap-strip", label: "Page recap tiles", group: "Sections", default: true },
  { id: "bank-balance", label: "Latest bank balance", group: "Sections", default: true },
  { id: "reserves-detail", label: "Reserves / Sinking Funds", group: "Sections", default: true },
  { id: "revenue-chart", label: "Income vs Costs by Month", group: "Sections", default: true },
  { id: "forecast-chart", label: "Cash Forecast", group: "Sections", default: true },
  { id: "cost-breakdown", label: "Costs by Category", group: "Sections", default: true },
  { id: "recent-invoices", label: "Recent Invoices", group: "Sections", default: true },
  { id: "anomalies", label: "Anomalies", group: "Sections", default: true },
];

// Mirror of getDashboardConfig(): the set of enabled widget ids given prefs.
// A stored array wins; defaults fill in only for widgets the user hasn't judged.
export function activeWidgets(prefs: Record<string, unknown>): Set<string> {
  const stored = pref<unknown>(prefs, "dashboard.widgets", null);
  if (Array.isArray(stored)) {
    const seen = new Set<string>(pref<string[]>(prefs, "dashboard.seen", stored as string[]));
    const active = new Set<string>(stored as string[]);
    for (const w of WIDGET_DEFS) if (w.default && !seen.has(w.id)) active.add(w.id);
    return active;
  }
  return new Set(WIDGET_DEFS.filter(w => w.default).map(w => w.id));
}

export default function DashboardConfig({ prefs, onClose, onSaved }: {
  prefs: Record<string, unknown>;
  onClose: () => void;
  onSaved: (active: Set<string>) => void;
}) {
  const initial = activeWidgets(prefs);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(WIDGET_DEFS.map(w => [w.id, initial.has(w.id)])),
  );
  const [saving, setSaving] = useState(false);
  const groups = Array.from(new Set(WIDGET_DEFS.map(w => w.group)));

  const save = async () => {
    setSaving(true);
    try {
      // Preserve widget ids the classic manages but this page doesn't render,
      // so saving here never wipes the classic's per-tile recap choices.
      const managed = new Set(WIDGET_DEFS.map(w => w.id));
      const prevStored = pref<unknown>(prefs, "dashboard.widgets", []);
      const preserved = Array.isArray(prevStored)
        ? (prevStored as string[]).filter(id => !managed.has(id)) : [];
      const checkedIds = WIDGET_DEFS.filter(w => checked[w.id]).map(w => w.id);
      await setPref("dashboard.widgets", [...checkedIds, ...preserved]);

      const prevSeen = pref<unknown>(prefs, "dashboard.seen", []);
      const seenBase = Array.isArray(prevSeen) ? (prevSeen as string[]) : [];
      await setPref("dashboard.seen", Array.from(new Set([...seenBase, ...managed])));

      onSaved(new Set([...checkedIds, ...preserved]));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Customize dashboard" onClose={onClose}>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Choose which cards and sections appear on your dashboard.
      </p>
      {groups.map(g => (
        <div key={g} style={{ marginBottom: 14 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>{g}</div>
          {WIDGET_DEFS.filter(w => w.group === g).map(w => (
            <label key={w.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={checked[w.id] ?? false}
                onChange={e => setChecked(s => ({ ...s, [w.id]: e.target.checked }))} />
              <span style={{ flex: 1 }}>{w.label}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
