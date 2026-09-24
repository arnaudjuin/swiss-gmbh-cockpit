"use client";
// Test Procedure — the interactive checklist parsed from the same docs the
// classic page uses (/test-procedure?source=accounting|technical). Per-step
// pass/fail/skip is a per-viewer convenience kept in localStorage.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Step { num: number; text: string; expected: string; details: string[] | string }
interface Tc { id: string; title: string; priority: string; type: string; preconditions: string; steps: Step[] }
interface Section { section_num: number; section: string; tests: Tc[] }
interface Proc { sections: Section[]; total_tests: number; total_steps: number }
type Status = "pass" | "fail" | "skip";

const key = (src: string) => `tp-status:${src}`;
function loadStatus(src: string): Record<string, Status> {
  try { return JSON.parse(localStorage.getItem(key(src)) || "{}"); } catch { return {}; }
}

export default function TestProcedurePage() {
  const [source, setSource] = useState<"accounting" | "technical">("accounting");
  const [proc, setProc] = useState<Proc | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setProc(null); setError("");
    api<Proc>(`/test-procedure?source=${source}`).then(setProc).catch(e => setError(String(e.message ?? e)));
    setStatus(loadStatus(source));
  }, [source]);
  useEffect(load, [load]);

  const setStep = (id: string, num: number, s: Status) => {
    const k = `${id}#${num}`;
    setStatus(prev => {
      const next = { ...prev };
      if (next[k] === s) delete next[k]; else next[k] = s;
      try { localStorage.setItem(key(source), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const reset = () => { try { localStorage.removeItem(key(source)); } catch { /* ignore */ } setStatus({}); };

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const v of Object.values(status)) counts[v]++;
  const total = proc?.total_steps ?? 0;
  const pct = (n: number) => total ? (n / total) * 100 : 0;

  return (
    <div className="page active">
      <div className="page-header">
        <h1 className="page-title">Test Procedure</h1>
        <div className="btn-group">
          <select className="control control--auto" value={source} onChange={e => setSource(e.target.value as "accounting" | "technical")}>
            <option value="accounting">Accounting checklist</option>
            <option value="technical">Technical checklist</option>
          </select>
          <button className="btn btn--danger btn--sm" onClick={reset}>Reset all</button>
        </div>
      </div>

      {!proc ? <div className="hint" style={{ padding: 24 }}>Loading…</div> : (
        <>
          <div className="panel" style={{ padding: "12px 16px", marginBottom: 16 }}>
            <div className="meter" style={{ display: "flex", height: 10, overflow: "hidden" }}>
              <div className="meter__bar meter__bar--ok" style={{ width: `${pct(counts.pass)}%` }} />
              <div className="meter__bar meter__bar--danger" style={{ width: `${pct(counts.fail)}%` }} />
              <div className="meter__bar" style={{ width: `${pct(counts.skip)}%`, background: "var(--text-muted)", opacity: 0.4 }} />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              <span className="t-ok">{counts.pass} pass</span> · <span className="t-danger">{counts.fail} fail</span> ·{" "}
              {counts.skip} skip · of {total} steps across {proc.total_tests} tests
            </div>
          </div>

          {proc.sections.map(sec => (
            <div key={sec.section_num} className="finance-section">
              <h3>{sec.section_num}. {sec.section} <span className="count">{sec.tests.length}</span></h3>
              {sec.tests.map(tc => (
                <div key={tc.id} className="panel" style={{ padding: "12px 16px", marginBottom: 12 }}>
                  <div className="row-split" style={{ marginBottom: 6 }}>
                    <strong>{tc.id} — {tc.title}</strong>
                    {tc.priority && <span className="chip chip--sm">{tc.priority}</span>}
                  </div>
                  {tc.preconditions && <p className="hint" style={{ marginTop: 0 }}>Preconditions: {tc.preconditions}</p>}
                  <div className="table-card">
                    <table className="table table--compact">
                      <thead><tr><th style={{ width: 40 }}>#</th><th>Step</th><th>Expected</th><th style={{ width: 150 }}>Result</th></tr></thead>
                      <tbody>
                        {tc.steps.map(st => {
                          const cur = status[`${tc.id}#${st.num}`];
                          return (
                            <tr key={st.num}>
                              <td className="mono">{st.num}</td>
                              <td>{st.text}</td>
                              <td className="hint">{st.expected}</td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {(["pass", "fail", "skip"] as Status[]).map(s => (
                                  <button key={s} title={s}
                                    className={`btn btn--icon btn--sm ${cur === s ? (s === "pass" ? "btn--ok" : s === "fail" ? "btn--danger" : "btn--outline") : "btn--ghost"}`}
                                    onClick={() => setStep(tc.id, st.num, s)}>
                                    {s === "pass" ? "✓" : s === "fail" ? "✗" : "–"}
                                  </button>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
