"use client";
// Settings — display preferences shared by both frontends (server-backed).
// The currency is a display label: amounts are stored as-is, never converted.
import { useEffect, useState } from "react";
import { loadPrefs, pref, setPref } from "@/lib/prefs";
import { api } from "@/lib/api";
import { setMoneyFormat } from "@/lib/money";

const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];
const LOCALES: [string, string][] = [
  ["de-CH", "1'234.56  (Swiss)"],
  ["de-DE", "1.234,56  (German)"],
  ["en-US", "1,234.56  (US/UK)"],
  ["fr-CH", "1 234.56  (French CH)"],
  ["custom", "Custom locale…"],
];
function localeValid(l: string) { try { (0).toLocaleString(l); return true; } catch { return false; } }

interface Biz {
  company: string; rate: string; vat_rate_pct: string; from_lines: string;
  account_name: string; iban: string; bic: string; bank: string;
}
const EMPTY_BIZ: Biz = { company: "", rate: "", vat_rate_pct: "", from_lines: "",
  account_name: "", iban: "", bic: "", bank: "" };

export default function SettingsPage() {
  const [company, setCompany] = useState("");
  const [currency, setCurrency] = useState("CHF");
  const [locale, setLocale] = useState("de-CH");
  const [biz, setBiz] = useState<Biz>(EMPTY_BIZ);
  const [customLocale, setCustomLocale] = useState("");
  const [divWht, setDivWht] = useState(""); const [divFed, setDivFed] = useState(""); const [divCant, setDivCant] = useState("");
  const [obBase, setObBase] = useState<Record<string, string>>({});
  const [obLabels, setObLabels] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPrefs().then(p => {
      setCompany(pref(p, "app.companyName", ""));
      setCurrency(pref(p, "app.currency", "CHF"));
      setLocale(pref(p, "app.locale", "de-CH"));
      const b = pref<Record<string, unknown>>(p, "app.business", {}) || {};
      setBiz({
        company: String(b.company ?? ""),
        rate: b.rate != null ? String(b.rate) : "",
        vat_rate_pct: b.vat_rate != null ? String(Number(b.vat_rate) * 100) : "",
        from_lines: Array.isArray(b.from_lines) ? b.from_lines.join("\n") : String(b.from_lines ?? ""),
        account_name: String(b.account_name ?? ""),
        iban: String(b.iban ?? ""), bic: String(b.bic ?? ""), bank: String(b.bank ?? ""),
      });
      const dt = pref<Record<string, unknown>>(p, "app.dividendTax", {}) || {};
      setDivWht(dt.wht_pct != null ? String(dt.wht_pct) : "");
      setDivFed(dt.fed_inclusion_pct != null ? String(dt.fed_inclusion_pct) : "");
      setDivCant(dt.cant_inclusion_pct != null ? String(dt.cant_inclusion_pct) : "");
      setObLabels(pref<Record<string, string>>(p, "app.obligationLabels", {}) || {});
      const loc = pref(p, "app.locale", "de-CH");
      if (!LOCALES.some(([v]) => v === loc)) setCustomLocale(loc);
      setLoaded(true);
    });
    api<Record<string, string>>("/obligations/types/base").then(setObBase).catch(() => {});
  }, []);

  if (!loaded) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  const effLocale = (customLocale || (locale === "custom" ? "de-CH" : locale));
  const safeLocale = localeValid(effLocale) ? effLocale : "de-CH";
  const preview = `${currency} ${(1234567.89).toLocaleString(safeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await setPref("app.companyName", company.trim() || null);
    await setPref("app.currency", currency);
    await setPref("app.locale", safeLocale);
    await setPref("app.dividendTax", {
      wht_pct: divWht === "" ? null : parseFloat(divWht),
      fed_inclusion_pct: divFed === "" ? null : parseFloat(divFed),
      cant_inclusion_pct: divCant === "" ? null : parseFloat(divCant),
    });
    await setPref("app.obligationLabels",
      Object.fromEntries(Object.entries(obLabels).filter(([, v]) => v && v.trim())));
    await setPref("app.business", {
      company: biz.company.trim() || null,
      rate: biz.rate === "" ? null : parseFloat(biz.rate),
      vat_rate: biz.vat_rate_pct === "" ? null : parseFloat(biz.vat_rate_pct) / 100,
      from_lines: biz.from_lines.trim() || null,
      account_name: biz.account_name.trim() || null,
      iban: biz.iban.trim() || null, bic: biz.bic.trim() || null, bank: biz.bank.trim() || null,
    });
    setMoneyFormat(currency, safeLocale);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  const bset = (k: keyof Biz) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBiz({ ...biz, [k]: e.target.value });

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
            <select id="s-locale" className="control"
                    value={customLocale ? "custom" : locale}
                    onChange={e => { setLocale(e.target.value); if (e.target.value !== "custom") setCustomLocale(""); }}>
              {LOCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {(customLocale || locale === "custom") && (
              <input className="control" style={{ marginTop: 6 }} placeholder="BCP-47 tag, e.g. nl-NL"
                     value={customLocale} onChange={e => setCustomLocale(e.target.value)} />
            )}
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

        <div className="section-label" style={{ marginTop: 20 }}>Business — invoicing</div>
        <p className="hint">Used when generating invoice PDFs and computing invoice amounts.
          Blank fields fall back to the shipped defaults.</p>

        <div className="cols-2">
          <div className="field">
            <label className="field__label" htmlFor="b-rate">Hourly rate</label>
            <input id="b-rate" className="control" type="number" min={0} step="0.5"
                   placeholder="62.00" value={biz.rate} onChange={bset("rate")} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="b-vat">VAT rate %</label>
            <input id="b-vat" className="control" type="number" min={0} max={30} step="0.1"
                   placeholder="8.1" value={biz.vat_rate_pct} onChange={bset("vat_rate_pct")} />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="b-company">Company (invoice header)</label>
          <input id="b-company" className="control" placeholder="Muster Consulting GmbH"
                 value={biz.company} onChange={bset("company")} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="b-from">&quot;From&quot; block (one line per row: owner, address, email, phone, UID)</label>
          <textarea id="b-from" className="control" rows={5}
                    placeholder={"Max Muster\nMusterstrasse 1\n8000 Zürich\nowner@example.com\nCHE-123.456.789"}
                    value={biz.from_lines} onChange={bset("from_lines")} />
        </div>
        <div className="cols-2">
          <div className="field">
            <label className="field__label" htmlFor="b-acct">Account name</label>
            <input id="b-acct" className="control" placeholder="Muster Consulting GmbH"
                   value={biz.account_name} onChange={bset("account_name")} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="b-bank">Bank</label>
            <input id="b-bank" className="control" placeholder="UBS Switzerland AG"
                   value={biz.bank} onChange={bset("bank")} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="b-iban">IBAN</label>
            <input id="b-iban" className="control" placeholder="CH.."
                   value={biz.iban} onChange={bset("iban")} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="b-bic">BIC</label>
            <input id="b-bic" className="control" placeholder="UBSWCHZH80A"
                   value={biz.bic} onChange={bset("bic")} />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 20 }}>Localization</div>
        <p className="hint">Country parameters. Blank = the shipped Swiss defaults. The payroll deduction
          structure and UI language stay Swiss/English for now — see ARCHITECTURE.md → Localization boundary.</p>

        <div className="cols-2">
          <div className="field">
            <label className="field__label" htmlFor="d-wht">Dividend withholding tax %</label>
            <input id="d-wht" className="control" type="number" min={0} max={60} step="0.1"
                   placeholder="35" value={divWht} onChange={e => setDivWht(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="d-fed">Federal inclusion % (qualified holding)</label>
            <input id="d-fed" className="control" type="number" min={0} max={100} step="1"
                   placeholder="70" value={divFed} onChange={e => setDivFed(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="d-cant">Cantonal/state inclusion %</label>
            <input id="d-cant" className="control" type="number" min={0} max={100} step="1"
                   placeholder="50" value={divCant} onChange={e => setDivCant(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="field__label">Obligation type labels</label>
          <p className="hint">Rename any type (e.g. &quot;AHV/AVS&quot; → &quot;Social security&quot;) — used across
            every page, both frontends. Blank = default.</p>
          {Object.entries(obBase).map(([key, base]) => (
            <div key={key} className="row-split" style={{ gap: 10, padding: "3px 0" }}>
              <span className="hint mono" style={{ minWidth: 170 }}>{key}</span>
              <input className="control" style={{ flex: 1 }} placeholder={base}
                     value={obLabels[key] ?? ""}
                     onChange={e => setObLabels({ ...obLabels, [key]: e.target.value })} />
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button className="btn btn--primary" type="submit">Save</button>
          {saved && <span className="chip chip--ok">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
