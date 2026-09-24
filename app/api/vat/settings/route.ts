import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { loadVatSettings } from "@/server/vat";

// GET /api/vat/settings — mirror of get_vat_settings.
export const GET = guard(async () => {
  return json(loadVatSettings(db()));
});

// PUT /api/vat/settings — mirror of update_vat_settings. Partial update: fields
// absent from the body keep their current value, so a stray empty PUT can never
// reset the settings.
export const PUT = guard(async (req: NextRequest) => {
  const raw = await req.json().catch(() => ({}));
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = db();
  const current = loadVatSettings(d);

  const estimateMissing = ("estimate_missing" in body ? body.estimate_missing : current.estimate_missing) ? 1 : 0;
  const estimateRate = Number("estimate_rate" in body ? body.estimate_rate : current.estimate_rate);
  if (!(estimateRate >= 0 && estimateRate <= 100)) return err(400, "estimate_rate must be between 0 and 100");
  const excluded = "excluded_categories" in body ? body.excluded_categories : current.excluded_categories;
  if (!Array.isArray(excluded)) return err(400, "excluded_categories must be a list");
  const flat = Number("flat_quarterly_deduction" in body ? body.flat_quarterly_deduction : current.flat_quarterly_deduction);
  if (flat < 0) return err(400, "flat_quarterly_deduction cannot be negative");

  d.prepare(
    `UPDATE vat_settings SET estimate_missing=?, estimate_rate=?,
       excluded_categories=?, flat_quarterly_deduction=?, updated_at=datetime('now')
       WHERE id=1`
  ).run(estimateMissing, estimateRate, JSON.stringify(excluded), flat);
  return json(loadVatSettings(d));
});
