import { prefPath } from "./prefs";

// Mirror of generate_invoice.BIZ_DEFAULTS + routes/invoicing._biz().
export const BIZ_DEFAULTS = {
  company: "Muster Consulting GmbH",
  rate: 62.0,
  vat_rate: 0.081,
  from_lines: ["Max MUSTER", "c/o Alpen Treuhand AG", "Musterstrasse 1",
    "8000 Zurich", "Switzerland", "", "owner@example.com",
    "+41 79 123 45 67", "CHE-123.456.789"],
  account_name: "Muster Consulting GmbH",
  iban: "CH93 0076 2011 6238 5295 7",
  bic: "UBSWCHZH80A",
  bank: "UBS Switzerland AG",
};

export type Biz = typeof BIZ_DEFAULTS;

export function bizSettings(): Biz {
  const stored = prefPath<Record<string, unknown>>("app.business", {}) || {};
  const biz: Biz = { ...BIZ_DEFAULTS, from_lines: [...BIZ_DEFAULTS.from_lines] };
  for (const k of Object.keys(BIZ_DEFAULTS) as (keyof Biz)[]) {
    const v = stored[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (k === "from_lines") {
      biz.from_lines = typeof v === "string"
        ? v.split("\n").map(l => l.trim()).filter(Boolean)
        : (v as string[]);
    } else if (k === "rate" || k === "vat_rate") {
      const n = Number(v); if (Number.isFinite(n)) (biz as any)[k] = n;
    } else (biz as any)[k] = String(v);
  }
  return biz;
}

export const DEFAULT_CUSTOMER = {
  name: "Acme Technologies", address: "Louis Giroud-Strasse 26/3.OG",
  city: "4600 Olten", country: "Switzerland", email: null as string | null,
  reference: null as string | null,
};
