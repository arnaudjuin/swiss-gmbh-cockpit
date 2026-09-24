"use client";
// Upload a bank statement — posts multipart FormData to POST /bank-statements
// (field names match app/api/bank-statements/route.ts exactly). When an
// XML / CAMT.053 file is chosen we first POST it to /bank-statements/parse-xml
// (form field "file") to auto-fill the period/balance/IBAN fields, mirroring
// the classic 03-bank.js autoParseXml flow. Parse is preview-only; the real
// row is created on submit (which re-sends the file as file_xml).
import { useState } from "react";
import { api } from "@/lib/api";
import { chf } from "@/lib/money";
import { Modal } from "@/components/Modal";

// Shape returned by parseCamt053 (server/camt.ts) via /bank-statements/parse-xml.
interface ParsedXml {
  period_start?: string; period_end?: string; iban?: string; currency?: string;
  opening_balance?: number; closing_balance?: number; transaction_count?: number;
  error?: string;
}

const STATEMENT_TYPES = [
  ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"],
  ["camt053", "CAMT.053 (XML)"], ["other", "Other"],
] as const;

type Fields = {
  bank: string; account_label: string; iban: string; period_start: string;
  period_end: string; statement_type: string; currency: string;
  opening_balance: string; closing_balance: string; notes: string;
};
const BLANK: Fields = {
  bank: "UBS", account_label: "", iban: "", period_start: "", period_end: "",
  statement_type: "monthly", currency: "CHF", opening_balance: "", closing_balance: "", notes: "",
};

export function BankUpload({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState<Fields>(BLANK);
  const [filePdf, setFilePdf] = useState<File | null>(null);
  const [fileXml, setFileXml] = useState<File | null>(null);
  const [preview, setPreview] = useState<React.ReactNode>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof Fields, v: string) => setF(prev => ({ ...prev, [k]: v }));

  const onXml = async (file: File | null) => {
    setFileXml(file);
    if (!file) { setPreview(null); return; }
    setPreview(<em>Parsing CAMT.053…</em>);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const p = await api<ParsedXml>("/bank-statements/parse-xml", { method: "POST", body: fd });
      if (p.error) { setPreview(<span className="t-danger">{p.error}</span>); return; }
      // Fill only the fields the user hasn't already typed into (setIfEmpty).
      setF(prev => {
        const next = { ...prev };
        const fill = (k: keyof Fields, v: string | number | undefined) => {
          if (!next[k] && v != null && v !== "") next[k] = String(v);
        };
        fill("period_start", p.period_start); fill("period_end", p.period_end);
        fill("iban", p.iban); fill("currency", p.currency);
        fill("opening_balance", p.opening_balance); fill("closing_balance", p.closing_balance);
        return next;
      });
      const parts: string[] = [];
      if (p.period_start && p.period_end) parts.push(`📅 ${p.period_start} → ${p.period_end}`);
      if (p.iban) parts.push(`🏦 ${p.iban}`);
      if (p.currency) parts.push(p.currency);
      if (p.opening_balance != null) parts.push(`open ${chf(p.opening_balance)}`);
      if (p.closing_balance != null) parts.push(`close ${chf(p.closing_balance)}`);
      if (p.transaction_count != null) parts.push(`${p.transaction_count} transactions`);
      setPreview(<span><span className="t-ok">✓ Auto-filled from XML — </span>{parts.join(" · ")}</span>);
    } catch (e) { setPreview(<span className="t-danger">{String((e as Error).message ?? e)}</span>); }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!f.period_start || !f.period_end) { setError("Period start and end are required"); return; }
    setSaving(true); setError("");
    try {
      const fd = new FormData();
      fd.set("bank", f.bank); fd.set("account_label", f.account_label); fd.set("iban", f.iban);
      fd.set("period_start", f.period_start); fd.set("period_end", f.period_end);
      fd.set("statement_type", f.statement_type); fd.set("currency", f.currency);
      fd.set("opening_balance", f.opening_balance); fd.set("closing_balance", f.closing_balance);
      fd.set("notes", f.notes);
      if (filePdf) fd.set("file_pdf", filePdf);
      if (fileXml) fd.set("file_xml", fileXml);
      await api("/bank-statements", { method: "POST", body: fd });
      onSaved();
    } catch (err) { setError(String((err as Error).message ?? err)); setSaving(false); }
  };

  return (
    <Modal title="Upload bank statement" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="cols-2">
          <label className="field"><span className="field__label">Bank</span>
            <input className="control" value={f.bank} onChange={e => set("bank", e.target.value)} required /></label>
          <label className="field"><span className="field__label">Account label</span>
            <input className="control" value={f.account_label} onChange={e => set("account_label", e.target.value)}
              placeholder="e.g. GmbH Main CHF" /></label>
        </div>
        <label className="field"><span className="field__label">IBAN</span>
          <input className="control" value={f.iban} onChange={e => set("iban", e.target.value)} placeholder="CH91…" /></label>
        <div className="cols-2">
          <label className="field"><span className="field__label">Period start</span>
            <input className="control" type="date" value={f.period_start}
              onChange={e => set("period_start", e.target.value)} required /></label>
          <label className="field"><span className="field__label">Period end</span>
            <input className="control" type="date" value={f.period_end}
              onChange={e => set("period_end", e.target.value)} required /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Type</span>
            <select className="control" value={f.statement_type} onChange={e => set("statement_type", e.target.value)}>
              {STATEMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <label className="field"><span className="field__label">Currency</span>
            <input className="control" value={f.currency} onChange={e => set("currency", e.target.value)} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">Opening balance</span>
            <input className="control" type="number" step="0.01" value={f.opening_balance}
              onChange={e => set("opening_balance", e.target.value)} /></label>
          <label className="field"><span className="field__label">Closing balance</span>
            <input className="control" type="number" step="0.01" value={f.closing_balance}
              onChange={e => set("closing_balance", e.target.value)} /></label>
        </div>
        <div className="cols-2">
          <label className="field"><span className="field__label">PDF statement (official)</span>
            <input className="control" type="file" accept=".pdf"
              onChange={e => setFilePdf(e.target.files?.[0] ?? null)} /></label>
          <label className="field">
            <span className="field__label">XML / CAMT.053 <span className="hint">(auto-fills fields)</span></span>
            <input className="control" type="file" accept=".xml,.csv"
              onChange={e => onXml(e.target.files?.[0] ?? null)} /></label>
        </div>
        {preview && <div className="hint" style={{ marginBottom: 8 }}>{preview}</div>}
        <label className="field"><span className="field__label">Notes</span>
          <textarea className="control" rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} /></label>

        {error && <div className="notice notice--danger" style={{ marginTop: 8 }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Upload statement"}</button>
        </div>
      </form>
    </Modal>
  );
}
