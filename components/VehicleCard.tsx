"use client";
// Vehicle depreciation + downstream tax effects (corp tax, Privatanteil).
// Port of static/js/08-payroll.js::renderVehicleDepreciation / _vehicleCard /
// _vehicleImpact. Booked vehicles render as-is; with none booked it shows a
// projection whose price/method write the vehicle.* prefs the Forecast engine
// reads — change them here and the forecast P&L follows (via onChange).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { loadPrefs, pref, setPref } from "@/lib/prefs";
import { chf } from "@/lib/money";
import { VehicleForm, type Vehicle } from "@/components/VehicleForm";
import { ConfirmModal } from "@/components/Modal";

const VEHICLE_CORP_RATE = 0.165;   // effective ZH corporate tax (matches the forecast)

function impact(price: number, method: string, yearsHeld: number) {
  const isDeg = method === "degressive_40";
  const bookAt = (y: number) => isDeg ? price * Math.pow(0.6, y) : Math.max(0, price * (1 - 0.20 * y));
  const yInt = Math.floor(Math.max(0, yearsHeld));
  const depThisYear = isDeg ? bookAt(yInt) * 0.40
    : Math.max(0, Math.min(price * 0.20, price - price * 0.20 * yInt));
  const bookNow = bookAt(Math.max(0, yearsHeld));
  const corpSaved = depThisYear * VEHICLE_CORP_RATE;
  const privMo = price * 0.009, privYr = privMo * 12;
  const emplAhv = privYr * 0.064, srcTax = privYr * 0.144, outVat = privYr * 0.081;
  const netGmbh = corpSaved - emplAhv - outVat;
  const schedule = [];
  for (let y = 1; y <= 5; y++) {
    const dep = isDeg ? bookAt(y - 1) * 0.40 : Math.max(0, Math.min(price * 0.20, price - price * 0.20 * (y - 1)));
    schedule.push({ year: y, dep, book: bookAt(y) });
  }
  return { isDeg, bookNow, depThisYear, corpSaved, privMo, privYr, emplAhv, srcTax, outVat, netGmbh, schedule };
}

function Card({ price, method, yearsHeld, header, sub, projected }: {
  price: number; method: string; yearsHeld: number; header: string; sub?: string; projected: boolean;
}) {
  const k = impact(price, method, yearsHeld);
  const methodLabel = k.isDeg ? "40% degressive" : "20% straight-line";
  return (
    <div className="panel" style={{ padding: "12px 16px", marginBottom: 14 }}>
      <div className="row-split" style={{ marginBottom: 10 }}>
        <div><strong>{header}</strong> {sub && <span className="hint">{sub}</span>}</div>
        <span className={`chip ${projected ? "chip--expected" : "chip--ok"} chip--sm`}>{projected ? "projection" : "booked"}</span>
      </div>
      <div className="stats-grid">
        <div className="stat"><div className="stat__label">Purchase price</div><div className="stat__value money">{chf(price)}</div><div className="stat__hint">{methodLabel}</div></div>
        <div className="stat"><div className="stat__label">Book value now</div><div className="stat__value money">{chf(k.bookNow)}</div></div>
        <div className="stat stat--ok"><div className="stat__label">Depreciation this year</div><div className="stat__value stat__value--ok money">{chf(k.depThisYear)}</div></div>
        <div className="stat stat--ok"><div className="stat__label">Corp-tax saved (16.5%)</div><div className="stat__value stat__value--ok money">{chf(k.corpSaved)}</div></div>
      </div>
      <div className="section-label" style={{ marginTop: 14 }}>Privatanteil (private-use benefit) — 0.9%/mo</div>
      <div className="table-card" style={{ marginTop: 6 }}>
        <table className="table table--compact"><tbody>
          <tr><td>Privatanteil / month</td><td className="money">{chf(k.privMo)}</td></tr>
          <tr><td>Privatanteil / year <span className="hint">added to Lohnausweis</span></td><td className="money">{chf(k.privYr)}</td></tr>
          <tr><td>Employer AHV/ALV on it (~6.4%) <span className="hint">GmbH cost</span></td><td className="money t-danger">{chf(k.emplAhv)}</td></tr>
          <tr><td>Source tax on it (~14.4%) <span className="hint">withheld from you</span></td><td className="money t-danger">{chf(k.srcTax)}</td></tr>
          <tr><td>Output VAT on it (8.1%) <span className="hint">GmbH owes ESTV</span></td><td className="money t-danger">{chf(k.outVat)}</td></tr>
        </tbody></table>
      </div>
      <div className="row-split" style={{ padding: "8px 0", borderTop: "1px solid var(--border)", marginTop: 8 }}>
        <strong>Net GmbH effect this year <span className="hint">tax saved − employer AHV − VAT</span></strong>
        <span className={`money ${k.netGmbh >= 0 ? "t-ok" : "t-danger"}`}>{k.netGmbh < 0 ? "−" : ""}{chf(Math.abs(k.netGmbh))}</span>
      </div>
      <div className="section-label" style={{ marginTop: 14 }}>5-year depreciation schedule</div>
      <div className="table-card" style={{ marginTop: 6 }}>
        <table className="table table--compact table--zebra">
          <thead><tr><th>Year</th><th className="money">Depreciation</th><th className="money">Book value end</th></tr></thead>
          <tbody>{k.schedule.map(s => (
            <tr key={s.year}><td>Year {s.year}</td><td className="money">{chf(s.dep)}</td><td className="money">{chf(s.book)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

export function VehicleCard({ onChange }: { onChange?: () => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [price, setPrice] = useState(20500);
  const [method, setMethod] = useState("degressive_40");

  useEffect(() => {
    api<Vehicle[]>("/vehicles").then(setVehicles).catch(() => setVehicles([]));
    loadPrefs().then(p => {
      setPrice(Number(pref<number | string>(p, "vehicle.projPrice", 20500)) || 20500);
      setMethod(String(pref<string>(p, "vehicle.projMethod", "degressive_40")) || "degressive_40");
    });
  }, []);

  const update = useCallback(async (field: "price" | "method", raw: string) => {
    if (field === "price") { const n = Math.max(0, Number(raw) || 0); setPrice(n); await setPref("vehicle.projPrice", n); }
    else { setMethod(raw); await setPref("vehicle.projMethod", raw); }
    onChange?.();
  }, [onChange]);

  const [form, setForm] = useState<Vehicle | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Vehicle | null>(null);
  const reloadAll = useCallback(() => {
    api<Vehicle[]>("/vehicles").then(setVehicles).catch(() => setVehicles([]));
    onChange?.();
  }, [onChange]);
  const remove = async (v: Vehicle) => {
    try { await api(`/vehicles/${v.id}`, { method: "DELETE" }); reloadAll(); } catch { /* ignore */ }
  };

  if (!vehicles) return null;

  const body = vehicles.length ? (
    <>{vehicles.map((v, i) => {
      const held = v.purchase_date ? Math.max(0, (Date.now() - new Date(v.purchase_date).getTime()) / (365.25 * 864e5)) : 0;
      return (
        <div key={i}>
          <Card price={Number(v.purchase_price) || 0} method={v.depreciation_method || "degressive_40"}
            yearsHeld={held} header={v.name || "Vehicle"} sub={v.purchase_date ? `bought ${v.purchase_date}` : undefined} projected={false} />
          <div className="row-split" style={{ marginTop: -8, marginBottom: 14 }}>
            <span />
            <span style={{ whiteSpace: "nowrap" }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setForm(v)}>✎ Edit</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setToDelete(v)}>🗑 Delete</button>
            </span>
          </div>
        </div>
      );
    })}</>
  ) : (
    <div>
      <div className="notice notice--warn" style={{ marginBottom: 12 }}>
        No vehicle is booked yet — this is a <strong>projection</strong>, pending the fiduciary&apos;s sign-off
        (depreciation method, purchase price/date, Privatanteil acceptance, VAT basis). Nothing here is in the accounts.
      </div>
      <div className="row-split" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <label className="field" style={{ maxWidth: 200 }}>
          <span className="field__label">Purchase price (CHF)</span>
          <input className="control" type="number" min={0} step={500} value={price}
            onChange={e => update("price", e.target.value)} />
        </label>
        <label className="field" style={{ maxWidth: 220 }}>
          <span className="field__label">Depreciation method</span>
          <select className="control" value={method} onChange={e => update("method", e.target.value)}>
            <option value="degressive_40">40% degressive</option>
            <option value="linear_20">20% straight-line</option>
          </select>
        </label>
        <button className="btn btn--primary" style={{ alignSelf: "flex-end" }}
          onClick={() => setForm({ name: "Company car", purchase_price: price, depreciation_method: method })}>
          Book this car
        </button>
      </div>
      <Card price={price} method={method} yearsHeld={0} header="Planned company car" sub="estimate — year 1" projected />
      <p className="hint" style={{ marginTop: 4 }}>
        This depreciation feeds the <strong>Forecast</strong> — it lowers expected profit and the corporate-tax
        estimate. Change the price or method above and the forecast follows, or <strong>Book this car</strong> to
        make it a real asset.
      </p>
    </div>
  );

  return (
    <>
      {body}
      {form !== undefined && (
        <VehicleForm vehicle={form} onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); reloadAll(); }} />
      )}
      {toDelete && (
        <ConfirmModal title="Delete vehicle"
          message={<>Delete <strong>{toDelete.name}</strong>? Its depreciation will stop feeding the forecast.</>}
          onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </>
  );
}
