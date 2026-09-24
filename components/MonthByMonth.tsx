"use client";
// Month-by-month informal cash plan — a faithful port of the classic
// renderPayrollCashPlan() (static/js/08-payroll.js). One mini-payslip card per
// remaining month of the selected year. Every obligation line carries a PLAN
// CHOICE persisted in server-backed prefs:
//   'YYYY-MM' → the full amount lands in that month's card
//   'spread'  → an equal share in every remaining month
// Defaults: due-in-window → its cash month; overdue and next-year bills →
// spread. The selects on each row move balances around. "Equal months" spreads
// everything evenly. The current year can pre-fund next year up to a ceiling.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Forecast } from "@/lib/api";
import { loadPrefs, pref, setPref } from "@/lib/prefs";
import { chf } from "@/lib/money";

// ── Local shapes (a superset of what /obligations, /accounting, /payroll return
// that this plan actually reads). Defined here so lib/api.ts stays untouched.
interface PlanObligation {
  id: number;
  obligation_type: string;
  type_label: string;
  period_label: string;
  period_year: number;
  amount: number;
  status: string;
  due_date: string | null;
  expected_bill_date: string | null;
  expected_bill_amount: number | null;
}
interface PlanBill {
  id: number;
  vendor: string;
  category: string;
  amount: number;
  recurrence: string;
  parent_doc_id: number | null;
  status: string;
  due_date: string | null;
  doc_date: string;
}
interface PlanPreview {
  settings: { payment_day?: number };
  calculation: { net_salary: number; gross: number };
}
interface IncomeInfo { income: number | null; passive: number }

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const amountOf = (o: PlanObligation) => o.expected_bill_amount ?? o.amount;

// The payment month: the later of due date / expected bill date, sliced to YYYY-MM.
function cashMonth(o: PlanObligation): string | null {
  const base = o.expected_bill_date && o.due_date && o.expected_bill_date > o.due_date
    ? o.expected_bill_date : (o.due_date || o.expected_bill_date);
  return base ? base.slice(0, 7) : null;
}
function cashYearOf(o: PlanObligation): number {
  const cm = cashMonth(o);
  return cm ? parseInt(cm.slice(0, 4)) : o.period_year;
}

// How much of NEXT year's obligations the CURRENT year can pre-fund by topping
// each remaining month up to its ceiling (prefs payrollPlan.<curYear>._ceiling).
// Returns { total, byKey } — mirrors the base-cost calc used for the cards.
function curYearPrefund(
  prefs: Record<string, unknown>,
  obligations: PlanObligation[],
  bills: PlanBill[],
  calc: PlanPreview["calculation"],
): { total: number; byKey: Record<string, number> } {
  const now = new Date();
  const curYear = now.getFullYear();
  const ceiling = Number(pref(prefs, `payrollPlan.${curYear}._ceiling`, 0) || 0);
  const startM = now.getMonth() + 1;
  if (!ceiling || startM > 12) return { total: 0, byKey: {} };
  const monthsLeft = 12 - startM + 1;
  const monthKeys: string[] = [];
  for (let m = startM; m <= 12; m++) monthKeys.push(`${curYear}-${String(m).padStart(2, "0")}`);
  const unpaid = obligations.filter(o => o.status === "unpaid" && cashYearOf(o) === curYear);
  const equalized = !!pref(prefs, `payrollPlan.${curYear}._equalize`, false);
  const choiceOf = (o: PlanObligation): string => {
    if (equalized) return "spread";
    const stored = pref<unknown>(prefs, `payrollPlan.${curYear}.${o.id}`, undefined);
    if (stored === "spread" || (typeof stored === "string" && monthKeys.includes(stored))) return stored as string;
    const cm = cashMonth(o);
    return (cm && monthKeys.includes(cm)) ? cm : "spread";
  };
  const fullBy: Record<string, number> = {};
  let spreadSum = 0;
  for (const o of unpaid) {
    const c = choiceOf(o);
    if (c === "spread") spreadSum += amountOf(o);
    else fullBy[c] = (fullBy[c] || 0) + amountOf(o);
  }
  const spreadShare = spreadSum / monthsLeft;
  const EX = new Set(["Payroll Settlement", "Taxes / VAT"]);
  const ab = bills.filter(b => !EX.has(b.category));
  const rate = (b: PlanBill) => b.recurrence === "monthly" ? b.amount
    : b.recurrence === "quarterly" ? b.amount / 3
    : b.recurrence === "yearly" ? b.amount / 12 : 0;
  const recurTotal = ab
    .filter(b => ["monthly", "quarterly", "yearly"].includes(b.recurrence) && !b.parent_doc_id && rate(b) > 0)
    .reduce((s, b) => s + rate(b), 0);
  const billMonth = (b: PlanBill) => (b.due_date || b.doc_date || "").slice(0, 7);
  const billByMonth: Record<string, number> = {};
  for (const b of ab.filter(b => b.status === "unpaid" && (!b.recurrence || b.recurrence === "none") && monthKeys.includes(billMonth(b))))
    billByMonth[billMonth(b)] = (billByMonth[billMonth(b)] || 0) + b.amount;
  const planNet = Number(pref(prefs, `payrollPlan.${curYear}._netSalary`, calc.net_salary) ?? calc.net_salary);
  const sickFrom = Number(pref(prefs, `payrollPlan.${curYear}._sickFrom`, 0) || 0);
  let remaining = obligations
    .filter(o => o.status === "unpaid" && o.period_year === curYear + 1)
    .reduce((s, o) => s + amountOf(o), 0);
  let total = 0;
  const byKey: Record<string, number> = {};
  for (const key of monthKeys) {
    const m = parseInt(key.slice(5));
    const monthNet = (sickFrom && m >= sickFrom) ? 0 : planNet;
    const base = monthNet + (fullBy[key] || 0) + spreadShare + recurTotal + (billByMonth[key] || 0);
    const pf = Math.max(0, Math.min(ceiling - base, remaining));
    byKey[key] = pf; total += pf; remaining -= pf;
  }
  return { total, byKey };
}

interface PlanData {
  preview: PlanPreview | null;
  obligations: PlanObligation[];
  bills: PlanBill[];
  incomeMap: Record<string, IncomeInfo>;
}

// Build the same per-month income map the classic derives from the forecast:
// { 'YYYY-MM': { income, passive } }, with the row/global overrides applied.
async function fetchIncomeMap(year: number): Promise<Record<string, IncomeInfo>> {
  const prefs = await loadPrefs();
  const inc = pref<number | null>(prefs, "forecast.income", null);
  const byMonth = pref<Record<string, number>>(prefs, "forecast.incomeByMonth", {});
  const incomes = Object.entries(byMonth)
    .filter(([, v]) => Number.isFinite(Number(v)))
    .map(([k, v]) => `${k}:${Number(v)}`).join(",");
  const fc = await api<Forecast>(
    `/finance/forecast?year=${year}` +
    (inc != null ? `&income=${inc}` : "") +
    (incomes ? `&incomes=${encodeURIComponent(incomes)}` : ""));
  return Object.fromEntries((fc.months || []).map(m => [m.key, { income: m.income, passive: m.passive || 0 }]));
}

export function MonthByMonth({ year }: { year: number }) {
  const [data, setData] = useState<PlanData | null>(null);
  const [prefs, setPrefs] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");

  const reload = useCallback(() => {
    Promise.all([
      api<PlanPreview>("/payroll/preview").catch(() => null),
      api<PlanObligation[]>("/obligations").catch(() => [] as PlanObligation[]),
      api<PlanBill[]>("/accounting").catch(() => [] as PlanBill[]),
      fetchIncomeMap(year).catch(() => ({} as Record<string, IncomeInfo>)),
    ]).then(([preview, obligations, bills, incomeMap]) => {
      setData({ preview, obligations, bills, incomeMap });
    }).catch(e => setErr(String(e?.message ?? e)));
    // Re-read prefs from the shared cache (mutated in place by setPref).
    loadPrefs().then(p => setPrefs({ ...p }));
  }, [year]);
  useEffect(reload, [reload]);

  // ── Handlers — persist to server-backed prefs, then re-render.
  const setChoice = async (id: number, value: string, planYear: number) => {
    await setPref(`payrollPlan.${planYear}.${id}`, value); reload();
  };
  const toggleEqualize = async (on: boolean, planYear: number) => {
    await setPref(`payrollPlan.${planYear}._equalize`, !!on); reload();
  };
  const resetPlan = async (planYear: number) => {
    await setPref(`payrollPlan.${planYear}`, {}); reload();
  };
  const setMonthIncome = async (key: string, v: string) => {
    const p = await loadPrefs();
    const byMonth = { ...pref<Record<string, number>>(p, "forecast.incomeByMonth", {}) };
    const n = parseFloat(v);
    if (v === "" || !Number.isFinite(n)) delete byMonth[key]; else byMonth[key] = n;
    await setPref("forecast.incomeByMonth", byMonth); reload();
  };

  const plan = useMemo(() => {
    if (!data || !prefs) return null;
    const calc = data.preview?.calculation;
    const s = data.preview?.settings || {};
    const now = new Date();
    const curYear = now.getFullYear();
    // Current year opens at the current month; a future year shows Jan–Dec.
    const startM = (year === curYear) ? now.getMonth() + 1 : 1;
    if (!calc || startM > 12) return { empty: true } as const;

    const monthsLeft = 12 - startM + 1;
    const monthKeys: string[] = [];
    for (let m = startM; m <= 12; m++) monthKeys.push(`${year}-${String(m).padStart(2, "0")}`);
    const firstKey = monthKeys[0];

    const belongsToView = (o: PlanObligation) =>
      (year === curYear) ? cashYearOf(o) === year : o.period_year === year;
    const unpaid = data.obligations.filter(o => o.status === "unpaid" && belongsToView(o));
    const isOverdue = (o: PlanObligation) => { const m = cashMonth(o); return !!m && m < firstKey; };

    const equalized = !!pref(prefs, `payrollPlan.${year}._equalize`, false);
    const choiceOf = (o: PlanObligation): string => {
      if (equalized) return "spread";
      const stored = pref<unknown>(prefs, `payrollPlan.${year}.${o.id}`, undefined);
      if (stored === "spread" || (typeof stored === "string" && monthKeys.includes(stored))) return stored as string;
      const cm = cashMonth(o);
      if (cm && monthKeys.includes(cm)) return cm;
      return "spread";
    };
    const anyOverride = unpaid.some(o => {
      const v = pref<unknown>(prefs, `payrollPlan.${year}.${o.id}`, undefined);
      return v === "spread" || (typeof v === "string" && monthKeys.includes(v));
    });

    const fullBy: Record<string, PlanObligation[]> = {};
    const spreadItems: PlanObligation[] = [];
    for (const o of unpaid) {
      const c = choiceOf(o);
      if (c === "spread") spreadItems.push(o);
      else (fullBy[c] = fullBy[c] || []).push(o);
    }
    const spreadShare = spreadItems.reduce((sum, o) => sum + amountOf(o), 0) / monthsLeft;

    // Operating bills — recurring templates at run-rate every month + one-off
    // unpaid bills in their own payment month. Categories already on the payment
    // side (payroll settlement, VAT) are excluded to avoid double counting.
    const EXCLUDE = new Set(["Payroll Settlement", "Taxes / VAT"]);
    const allBills = data.bills.filter(b => !EXCLUDE.has(b.category));
    const perMonthRate = (b: PlanBill) => b.recurrence === "monthly" ? b.amount
      : b.recurrence === "quarterly" ? b.amount / 3
      : b.recurrence === "yearly" ? b.amount / 12 : 0;
    const recurBills = allBills
      .filter(b => ["monthly", "quarterly", "yearly"].includes(b.recurrence) && !b.parent_doc_id && perMonthRate(b) > 0)
      .map(b => ({ label: b.vendor, category: b.category, amount: perMonthRate(b) }));
    const recurTotal = recurBills.reduce((sum, b) => sum + b.amount, 0);
    const billMonth = (b: PlanBill) => (b.due_date || b.doc_date || "").slice(0, 7);
    const oneTimeByMonth: Record<string, PlanBill[]> = {};
    for (const b of allBills.filter(b => b.status === "unpaid" && (!b.recurrence || b.recurrence === "none") && monthKeys.includes(billMonth(b))))
      (oneTimeByMonth[billMonth(b)] = oneTimeByMonth[billMonth(b)] || []).push(b);

    // Per-year salary overrides (default: live payroll settings). _sickFrom is the
    // month (1–12) from which the GmbH stops paying salary (KTG carries it).
    const planNet = Number(pref(prefs, `payrollPlan.${year}._netSalary`, calc.net_salary) ?? calc.net_salary);
    const planGross = Number(pref(prefs, `payrollPlan.${year}._grossSalary`, calc.gross) ?? calc.gross);
    const sickFrom = Number(pref(prefs, `payrollPlan.${year}._sickFrom`, 0) || 0);

    const ceiling = Number(pref(prefs, `payrollPlan.${curYear}._ceiling`, 0) || 0);
    const prefund = curYearPrefund(prefs, data.obligations, data.bills, calc);
    const isCurYear = year === curYear;
    const creditPerMonth = (year === curYear + 1 && prefund.total > 0) ? prefund.total / monthsLeft : 0;

    const overdueTotal = unpaid.filter(isOverdue).reduce((sum, o) => sum + amountOf(o), 0);
    const paymentDay = s.payment_day || 25;

    return {
      empty: false as const, monthKeys, monthsLeft, spreadItems, spreadShare, fullBy,
      recurBills, recurTotal, oneTimeByMonth, planNet, planGross, sickFrom, ceiling,
      prefund, isCurYear, creditPerMonth, equalized, anyOverride, isOverdue,
      overdueTotal, paymentDay, incomeMap: data.incomeMap, curYear,
    };
  }, [data, prefs, year]);

  if (err) return <div className="notice notice--danger">{err}</div>;
  if (!plan) return <div className="hint">Loading…</div>;
  if (plan.empty) return <p className="hint">No months left this year.</p>;

  const {
    monthKeys, monthsLeft, spreadItems, spreadShare, fullBy, recurBills, recurTotal,
    oneTimeByMonth, planNet, planGross, sickFrom, ceiling, prefund, isCurYear,
    creditPerMonth, equalized, anyOverride, isOverdue, overdueTotal, paymentDay, incomeMap,
  } = plan;

  const itemLabel = (o: PlanObligation) => (
    <>
      {o.type_label} · {o.period_label}
      {isOverdue(o) && <> <span className="chip chip--danger chip--sm">overdue</span></>}
    </>
  );

  // Row move-select: send an item to a month, or spread it evenly. Hidden while
  // "Equal months" is on (every item is spread then).
  const moveSel = (o: PlanObligation, current: string) => equalized ? null : (
    <select className="control control--auto" style={{ fontSize: 11, padding: "1px 4px" }}
      value={current} onChange={e => setChoice(o.id, e.target.value, year)}
      title="Move this item to another month, or spread it evenly">
      <option value="spread">Spread /{monthsLeft}</option>
      {monthKeys.map(k => (
        <option key={k} value={k}>{MONTHS[parseInt(k.slice(5)) - 1].slice(0, 3)}</option>
      ))}
    </select>
  );

  const cards = monthKeys.map((key, idx) => {
    const m = parseInt(key.slice(5));
    const onSick = !!sickFrom && m >= sickFrom;
    const monthNet = onSick ? 0 : planNet;
    const full = fullBy[key] || [];
    const fullTotal = full.reduce((sum, o) => sum + amountOf(o), 0);
    const monthOneTime = oneTimeByMonth[key] || [];
    const billTotal = recurTotal + monthOneTime.reduce((sum, b) => sum + b.amount, 0);
    const prefundThis = isCurYear ? (prefund.byKey[key] || 0) : 0;
    const total = monthNet + fullTotal + spreadShare + billTotal + prefundThis - creditPerMonth;
    const im = incomeMap[key] || { income: null, passive: 0 };
    const income = (im.income != null) ? Number(im.income) : null;
    const passiveThis = Number(im.passive) || 0;
    const activeVal = income != null ? Math.round(income - passiveThis) : "";
    const netCash = income != null ? income - total : null;

    return (
      <div key={key} className="panel">
        <div className="row-split" style={{ marginBottom: 6 }}>
          <strong>{MONTHS[m - 1]} {year}</strong>
          <span className="chip chip--expected">informal</span>
        </div>

        <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
          <span className="t-ok">Expected income{passiveThis > 0 && <span className="hint"> + {chf(passiveThis)} passive</span>}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="t-ok">+</span>
            <input type="number" className="control control--auto" style={{ width: 92, textAlign: "right", fontSize: 12 }}
              min={0} step={100} defaultValue={activeVal} key={`${key}-${activeVal}`}
              title="Active (billable) income for this month — edit inline; passive is added separately"
              onBlur={e => { if (String(e.target.value) !== String(activeVal)) setMonthIncome(key, e.target.value); }} />
          </span>
        </div>

        <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
          {onSick
            ? <><span>Sick leave — <span className="t-ok">KTG pays you</span> <span className="hint">(no GmbH salary from {MONTHS[sickFrom - 1].slice(0, 3)})</span></span><span className="money">{chf(0)}</span></>
            : <><span>Net salary → you <span className="hint">(~{paymentDay}th, gross {chf(planGross)})</span></span><span className="money">{chf(monthNet)}</span></>}
        </div>

        {full.length > 0
          ? full.map(o => (
            <div key={o.id} className="row-split" style={{ padding: "3px 0" }}>
              <span className="hint" style={{ flex: 1, minWidth: 0 }}>{itemLabel(o)}</span>
              <span className="money">{chf(amountOf(o))}</span>
              {moveSel(o, key)}
            </div>))
          : <div className="hint hint--sm" style={{ padding: "3px 0" }}>no full payments placed this month</div>}

        {spreadItems.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 6 }}>
              Spread items (1/{monthsLeft} each{idx === 0 ? " — move with the selects" : ""})
            </div>
            {spreadItems.map(o => (
              <div key={o.id} className="row-split" style={{ padding: "2px 0" }}>
                <span className="hint hint--sm" style={{ flex: 1, minWidth: 0 }}>
                  {itemLabel(o)} <span className="t-muted">(bill {o.expected_bill_date || o.due_date || "—"})</span>
                </span>
                <span className="money">{chf(amountOf(o) / monthsLeft)}</span>
                {idx === 0 ? moveSel(o, "spread") : null}
              </div>))}
            <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
              <span className="hint">Spread subtotal</span>
              <span className="money">{chf(spreadShare)}</span>
            </div>
          </>
        )}

        {(recurBills.length > 0 || monthOneTime.length > 0) && (
          <>
            <div className="section-label" style={{ marginTop: 6 }}>Operating bills</div>
            {recurBills.map((b, i) => (
              <div key={`r${i}`} className="row-split" style={{ padding: "2px 0" }}>
                <span className="hint hint--sm" style={{ flex: 1, minWidth: 0 }}>
                  {b.label} <span className="t-muted">({b.category} · recurring)</span>
                </span>
                <span className="money">{chf(b.amount)}</span>
              </div>))}
            {monthOneTime.map(b => (
              <div key={`o${b.id}`} className="row-split" style={{ padding: "2px 0" }}>
                <span className="hint hint--sm" style={{ flex: 1, minWidth: 0 }}>
                  {b.vendor} <span className="t-muted">({b.category})</span>
                </span>
                <span className="money">{chf(b.amount)}</span>
              </div>))}
            <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
              <span className="hint">Bills subtotal</span>
              <span className="money">{chf(billTotal)}</span>
            </div>
          </>
        )}

        {prefundThis > 0 && (
          <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
            <span className="hint t-ok">Pre-fund {year + 1} → fill to {chf(ceiling)}</span>
            <span className="money t-ok">{chf(prefundThis)}</span>
          </div>
        )}
        {creditPerMonth > 0 && idx === 0 && (
          <div className="hint hint--sm t-ok" style={{ padding: "2px 0" }}>
            − Pre-funded {chf(prefund.total)} in {year - 1} (spread over the year below)
          </div>
        )}
        {creditPerMonth > 0 && (
          <div className="row-split" style={{ padding: "3px 0", borderTop: "1px solid var(--border)" }}>
            <span className="hint t-ok">− Pre-funded in {year - 1}</span>
            <span className="money t-ok">−{chf(creditPerMonth)}</span>
          </div>
        )}

        <div className="row-split" style={{ padding: "5px 0", borderTop: "2px solid var(--border-strong)", marginTop: 2 }}>
          <strong>Leaves / set aside</strong>
          <span className="money money--lg">{chf(total)}</span>
        </div>
        {netCash != null && (
          <div className="row-split" style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
            <span className="hint">Net cash this month <span className="t-muted">(income − set-aside)</span></span>
            <span className={`money ${netCash >= 0 ? "t-ok" : "t-danger"}`}>{netCash < 0 ? "−" : ""}{chf(Math.abs(netCash))}</span>
          </div>
        )}
      </div>
    );
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
      <div className="row-split" style={{ gridColumn: "1/-1" }}>
        <span className="hint">
          {overdueTotal > 0
            ? `⚠ ${chf(overdueTotal)} of overdue items are shared across the months (or move them where you want).`
            : "Every unpaid obligation for the year is placed below."}
        </span>
        <label className="hint" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" style={{ width: "auto", verticalAlign: "middle" }}
            checked={equalized} onChange={e => toggleEqualize(e.target.checked, year)} />
          {" "}Equal months — spread everything evenly
        </label>
        {anyOverride && !equalized && (
          <button className="btn btn--ghost btn--sm" onClick={() => resetPlan(year)}>Reset to automatic</button>
        )}
      </div>

      {cards}

      <div className="hint" style={{ gridColumn: "1/-1" }}>
        Spread items are what the “Future obligations (2027 bills)” envelope above saves for — set the money aside once, not twice.
      </div>
    </div>
  );
}
