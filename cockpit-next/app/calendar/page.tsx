"use client";
// Calendar — month grid of money events (obligations on payable date, bills,
// payroll), same .cal-* classes as the classic page.
import { useCallback, useEffect, useState } from "react";
import { api, type CalendarEvent } from "@/lib/api";
import { chf } from "@/lib/money";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function CalendarPage() {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState("");
  const [year, month] = ym;

  const load = useCallback(() => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endD = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(endD).padStart(2, "0")}`;
    api<{ events: CalendarEvent[] }>(`/calendar?start=${start}&end=${end}`)
      .then(d => setEvents(d.events)).catch(e => setError(String(e.message ?? e)));
  }, [year, month]);
  useEffect(load, [load]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;

  const move = (d: number) => {
    const dt = new Date(year, month + d, 1);
    setEvents(null); setYm([dt.getFullYear(), dt.getMonth()]);
  };

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const byDay = new Map<number, CalendarEvent[]>();
  (events ?? []).forEach(e => {
    const d = parseInt(e.date.slice(8, 10), 10);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  });
  const total = (events ?? []).reduce((s, e) => s + e.amount, 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const kindColor: Record<string, string> = {
    obligation: "var(--danger-fill)", bill: "var(--warn-fill)", payroll: "var(--ok-fill)",
  };

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">{MONTHS[month]} {year}</h1>
        <div className="btn-group">
          <button className="btn btn--outline" onClick={() => move(-1)}>←</button>
          <button className="btn btn--outline" onClick={() => { setEvents(null); setYm([now.getFullYear(), now.getMonth()]); }}>Today</button>
          <button className="btn btn--outline" onClick={() => move(1)}>→</button>
        </div>
      </div>
      <div className="chart-legend" style={{ marginBottom: 10 }}>
        {(["obligation", "bill", "payroll"] as const).map(k => (
          <span key={k}><span className="chart-legend__sw" style={{ background: kindColor[k], borderRadius: "50%" }} />
            {k[0].toUpperCase() + k.slice(1)}s</span>
        ))}
        <span className="hint" style={{ marginLeft: "auto" }}>
          {events ? `${events.length} events · month total ${chf(total)}` : "Loading…"}
        </span>
      </div>

      <div className="table-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
            <div key={d} className="hint" style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{d}</div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`e${i}`} style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)", minHeight: 92, background: "var(--bg)" }} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const evs = byDay.get(d) ?? [];
            return (
              <div key={d} style={{
                borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)",
                minHeight: 92, padding: 6, background: iso === todayIso ? "var(--info-bg)" : undefined,
              }}>
                <div className="mono hint" style={{ fontWeight: iso === todayIso ? 700 : 400 }}>{d}</div>
                {evs.map((e, j) => (
                  <div key={j} title={`${e.title} — ${chf(e.amount)}`} style={{
                    fontSize: 11, borderLeft: `3px solid ${kindColor[e.kind]}`,
                    padding: "1px 4px", margin: "2px 0", background: "var(--card)",
                    opacity: e.status === "paid" ? 0.5 : 1,
                    textDecoration: e.status === "paid" ? "line-through" : undefined,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    fontStyle: e.projected ? "italic" : undefined,
                  }}>
                    {e.title.split("—")[0].trim()} <span className="hint">{chf(e.amount)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
