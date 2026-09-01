"use client";
// Settings — display preferences shared by both frontends (server-backed).
// The currency is a display label: amounts are stored as-is, never converted.
import { useEffect, useState } from "react";
import { loadPrefs, pref, setPref } from "@/lib/prefs";
import { setMoneyFormat } from "@/lib/money";

const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];
const LOCALES: [string, string][] = [
  ["de-CH", "1'234.56  (Swiss)"],
  ["de-DE", "1.234,56  (German)"],
  ["en-US", "1,234.56  (US/UK)"],
  ["fr-CH", "1 234.56  (French CH)"],
];

export default function SettingsPage() {
  const [company, setCompany] = useState("");
  const [currency, setCurrency] = useState("CHF");
  const [locale, setLocale] = useState("de-CH");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPrefs().then(p => {
      setCompany(pref(p, "app.companyName", ""));
      setCurrency(pref(p, "app.currency", "CHF"));
      setLocale(pref(p, "app.locale", "de-CH"));
      setLoaded(true);
    });
  }, []);

  if (!loaded) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const preview = `${currency} ${(1234567.89).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await setPref("app.companyName", company.trim() || null);
    await setPref("app.currency", currency);
    await setPref("app.locale", locale);
    setMoneyFormat(currency, locale);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Settings</h1></div>

      <form onSubmit={save} className="panel" style={{ maxWidth: 560, padding: 24 }}>
        <div className="section-label">Display</div>

        <div className="field">
          <label className="field__label" htmlFor="s-company">Company name (sidebar)</label>
          <input id="s-company" className="control" value={company}
                 placeholder="Muster Consulting GmbH"
                 onChange={e => setCompany(e.target.value)} />
        </div>

        <div className="cols-2">
          <div className="field">
            <label className="field__label" htmlFor="s-currency">Currency label</label>
            <select id="s-currency" className="control" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="s-locale">Number format</label>
            <select id="s-locale" className="control" value={locale} onChange={e => setLocale(e.target.value)}>
              {LOCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="hint" style={{ margin: "8px 0 14px" }}>
          Preview: <span className="money" style={{ fontWeight: 600, color: "var(--text)" }}>{preview}</span>
        </div>

        <div className="notice notice--info" style={{ marginBottom: 14 }}>
          The currency is a <b>display label</b> — amounts are stored as entered and never
          converted. Both frontends read these settings (saved to your profile on the server).
          Payroll identity, rates and the invoice rate live in <b>Payroll → Settings</b> in
          the classic frontend.
        </div>

        <div className="form-actions">
          <button className="btn btn--primary" type="submit">Save</button>
          {saved && <span className="chip chip--ok">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
