"use client";
// Calendar — month grid of money events (obligations on payable date, bills,
// payroll) plus the events-list table below it. Uses the canonical .cal-*
// classes, a direct port of renderCalendar() from the classic frontend
// (static/js/09-misc.js).
import { useCallback, useEffect, useState } from "react";
import { api, type CalendarEvent } from "@/lib/api";
import { chf } from "@/lib/money";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

type Kind = "obligation" | "bill" | "payroll";
const KINDS: Kind[] = ["obligation", "bill", "payroll"];
const KIND_LABEL: Record<Kind, string> = { obligation: "Obligations", bill: "Bills", payroll: "Payroll" };

const token = () => (typeof window !== "undefined" ? localStorage.getItem("session_token") ?? "" : "");

export default function CalendarPage() {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [filters, setFilters] = useState<Record<Kind, boolean>>({ obligation: true, bill: true, payroll: true });
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const visible = (events ?? []).filter(e => filters[e.kind as Kind]);
  const byDay = new Map<number, CalendarEvent[]>();
  visible.forEach(e => {
    const d = parseInt(e.date.slice(8, 10), 10);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const monthTotal = visible.reduce((s, e) => s + e.amount, 0);
  const due = visible.filter(e => e.status === "unpaid" || e.status === "expected")
    .reduce((s, e) => s + e.amount, 0);

  const evClass = (e: CalendarEvent) => {
    const overdue = e.status === "unpaid" && e.date < todayIso;
    const done = e.status === "paid" || e.status === "issued";
    return `cal-ev ${e.kind} ${e.real ? "real" : "expected"}${overdue ? " overdue" : ""}${done ? " done" : ""}`;
  };

  // Grid cells: leading blanks from the previous month, then each day.
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} className="cal-day other-month" />);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const evs = byDay.get(d) ?? [];
    cells.push(
      <div key={d} className={`cal-day${iso === todayIso ? " today" : ""}`}>
        <div className="cal-day-num">{d}</div>
        {evs.map((e, j) => (
          <div key={j} className={evClass(e)} title={`${e.title} — ${chf(e.amount)} (${e.real ? "document uploaded" : "expected"}, ${e.status})`}>
            <span className="cal-ev-title">{e.title}</span>
            <span className="cal-ev-amt">{chf(e.amount)}</span>
          </div>
        ))}
        {evs.length > 1 && (
          <div className="cal-day-total" title={`Total for ${iso}`}>= {chf(evs.reduce((s, e) => s + e.amount, 0))}</div>
        )}
      </div>,
    );
  }
  while (cells.length % 7 !== 0) cells.push(<div key={`t${cells.length}`} className="cal-day other-month" />);

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">{MONTHS[month]} {year}</h1>
        <div className="btn-group">
          <button className="btn btn--outline" onClick={() => move(-1)} title="Previous month">‹</button>
          <button className="btn btn--outline" onClick={() => { setEvents(null); setYm([now.getFullYear(), now.getMonth()]); }}>Today</button>
          <button className="btn btn--outline" onClick={() => move(1)} title="Next month">›</button>
        </div>
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap", rowGap: 8 }}>
        {KINDS.map(k => (
          <label key={k} className="cal-filter">
            <input type="checkbox" checked={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.checked }))} />
            {" "}<span className="cal-dot" style={{ background: `var(--cal-${k})` }} /> {KIND_LABEL[k]}
          </label>
        ))}
        <span style={{ flex: 1 }} />
        <span className="cal-legend">
          <span className="cal-ev-sample real" /> real document &nbsp;
          <span className="cal-ev-sample expected" /> expected / projected
        </span>
      </div>

      <div className="table-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="cal-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div key={d}>{d}</div>)}
        </div>
        <div className="cal-grid">{cells}</div>
        <div className="cal-month-total">{visible.length ? `Month total: ${chf(monthTotal)}` : ""}</div>
      </div>

      <div className="finance-section" style={{ marginTop: 24 }}>
        <h3>Events this month <span className="count">{visible.length}</span>
          <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            {due > 0 ? `Month total: ${chf(monthTotal)} · still due: ${chf(due)}`
              : visible.length ? `Month total: ${chf(monthTotal)}` : ""}
          </span>
        </h3>
        <div className="table-card">
          <table>
            <thead><tr>
              <th>Date</th><th>What</th><th className="text-right">Amount</th><th>Status</th><th>Document</th>
            </tr></thead>
            <tbody>
              {visible.length ? visible.map((e, i) => {
                const overdue = e.status === "unpaid" && e.date < todayIso;
                const done = e.status === "paid" || e.status === "issued";
                return (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                    <td><span className="cal-dot" style={{ background: `var(--cal-${e.kind})` }} /> {e.title}</td>
                    <td className="text-right money">{chf(e.amount)}</td>
                    <td>
                      {e.real
                        ? <span className={`chip chip--sm ${done ? "chip--ok" : overdue ? "chip--danger" : "chip--warn"}`}>{e.status}{overdue ? " · overdue" : ""}</span>
                        : <span className="chip chip--sm chip--expected">expected</span>}
                    </td>
                    <td>
                      {e.doc_url
                        ? <a href={`${e.doc_url}?token=${encodeURIComponent(token())}`} target="_blank" rel="noreferrer">📄 view</a>
                        : <span className="hint">—</span>}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5} className="empty-cell">Nothing due this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
