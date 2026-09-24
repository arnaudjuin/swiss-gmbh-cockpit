import { db } from "./db";
import { prefPath } from "./prefs";

// Payable date: money leaves when the bill arrives, not when the period ends.
export const PAYABLE_SQL = "MAX(due_date, COALESCE(expected_bill_date, due_date))";

export const BASE_OBLIGATION_TYPES: Record<string, string> = {
  ahv: "AHV/AVS (1st pillar)",
  bvg_employee: "BVG Employee (2nd pillar)",
  bvg_employer: "BVG Employer (2nd pillar)",
  corporate_tax_federal: "Corporate Tax (Federal)",
  corporate_tax_cantonal: "Corporate Tax (Cantonal)",
  vat: "VAT",
  uvg: "UVG (Accident — AXA)",
  ktg: "KTG (Sick pay — AXA)",
  source_tax: "Source Tax (Quellensteuer)",
  accounting: "Treuhand",
  other: "Other",
};

export function obligationTypes(): Record<string, string> {
  const overrides = prefPath<Record<string, string>>("app.obligationLabels", {}) || {};
  const merged = { ...BASE_OBLIGATION_TYPES };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in merged && String(v).trim()) merged[k] = String(v).trim();
  }
  return merged;
}
export const typeLabel = (t: string) => obligationTypes()[t] ?? t;

export function payableDate(r: { due_date?: string | null; expected_bill_date?: string | null }): string | null {
  const due = r.due_date ?? null, exp = r.expected_bill_date ?? null;
  if (!due) return exp;
  return exp && exp > due ? exp : due;
}

export function serializeObligation(r: any) {
  return {
    id: r.id, obligation_type: r.obligation_type,
    type_label: typeLabel(r.obligation_type),
    period_label: r.period_label, period_year: r.period_year,
    amount: r.amount, currency: r.currency, due_date: r.due_date,
    status: r.status, notes: r.notes ?? "",
    expected_bill_date: r.expected_bill_date ?? null,
    expected_bill_amount: r.expected_bill_amount ?? null,
    payable_date: payableDate(r),
    doc_file: r.doc_file ?? null,
    has_file: r.doc_file != null,
  };
}

export function listObligations(year?: number) {
  const rows = year
    ? db().prepare("SELECT * FROM obligations WHERE period_year=? ORDER BY due_date, obligation_type").all(year)
    : db().prepare("SELECT * FROM obligations ORDER BY period_year DESC, due_date, obligation_type").all();
  return rows.map(serializeObligation);
}
