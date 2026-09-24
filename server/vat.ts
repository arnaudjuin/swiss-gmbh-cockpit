// Swiss MWST (VAT) — effective-method quarterly VAT, ported from
// routes/reports.py (_load_vat_settings, _vat_quarter_data, create_vat_obligation).
//
// Two nets per quarter:
//   • vat_due_file — output − recorded input − flat. The number you FILE and BOOK
//     (you can't reclaim VAT you never documented).
//   • vat_due — output − (recorded + simulated + flat). Planning only.
import Database from "better-sqlite3";
import { db, round2 } from "./db";

export interface VatSettings {
  estimate_missing: boolean;
  estimate_rate: number;
  excluded_categories: string[];
  flat_quarterly_deduction: number;
}

// Port of _load_vat_settings: reads the singleton row, falling back to the same
// defaults the Python returns when the row is absent.
export function loadVatSettings(d: Database.Database = db()): VatSettings {
  const row = d.prepare("SELECT * FROM vat_settings WHERE id=1").get() as any;
  if (!row) {
    return {
      estimate_missing: true,
      estimate_rate: 8.1,
      excluded_categories: ["Insurance", "Bank Fees", "Payroll Settlement"],
      flat_quarterly_deduction: 0.0,
    };
  }
  let excluded: string[];
  try {
    excluded = JSON.parse(row.excluded_categories);
  } catch {
    excluded = [];
  }
  return {
    estimate_missing: Boolean(row.estimate_missing),
    estimate_rate: Number(row.estimate_rate),
    excluded_categories: excluded,
    flat_quarterly_deduction: Number(row.flat_quarterly_deduction),
  };
}

export interface VatQuarterData {
  year: number;
  quarter: number;
  period: string;
  output_vat: number;
  input_vat_recorded: number;
  input_vat_estimated: number;
  estimated_bills: number;
  flat_deduction: number;
  input_vat: number;      // backward-compatible: total deductions
  vat_due: number;        // planning: incl. simulated input
  vat_due_file: number;   // file-ready: recorded input + flat only
  due_date: string;
  obligation: { id: number; amount: number; status: string; due_date: string | null; doc_file: string | null } | null;
}

// Port of _vat_quarter_data: effective-method VAT for one quarter.
export function vatQuarterData(
  d: Database.Database, year: number, quarter: number, settings: VatSettings
): VatQuarterData {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;

  const outputVat = (d.prepare(
    "SELECT COALESCE(SUM(tax),0) as t FROM invoices WHERE year=? AND month>=? AND month<=? AND hours>0"
  ).get(year, startMonth, endMonth) as any).t as number;

  // Input VAT explicitly recorded on bills
  const inputRecorded = (d.prepare(
    `SELECT COALESCE(SUM(vat_amount),0) as t FROM company_docs
       WHERE substr(doc_date,1,4)=? AND CAST(substr(doc_date,6,2) AS INTEGER) BETWEEN ? AND ?
       AND vat_amount > 0`
  ).get(String(year), startMonth, endMonth) as any).t as number;

  // Simulated: bills without a recorded VAT amount are assumed to include VAT at
  // estimate_rate (deductible share = amount × r / (100 + r)), except VAT-exempt
  // categories.
  let inputEstimated = 0.0;
  let estimatedBills = 0;
  if (settings.estimate_missing) {
    const excluded = new Set(settings.excluded_categories);
    const r = settings.estimate_rate;
    const rows = d.prepare(
      `SELECT category, COALESCE(SUM(amount),0) as t, COUNT(*) as n FROM company_docs
         WHERE substr(doc_date,1,4)=? AND CAST(substr(doc_date,6,2) AS INTEGER) BETWEEN ? AND ?
         AND (vat_amount IS NULL OR vat_amount = 0) AND amount > 0
         GROUP BY category`
    ).all(String(year), startMonth, endMonth) as any[];
    for (const row of rows) {
      if (excluded.has(row.category)) continue;
      inputEstimated += (row.t as number) * r / (100 + r);
      estimatedBills += row.n as number;
    }
  }
  inputEstimated = round2(inputEstimated);

  const flat = settings.flat_quarterly_deduction;
  const totalDeductions = round2(inputRecorded + inputEstimated + flat);
  const vatDue = round2(outputVat - totalDeductions);
  // File-ready net: recorded input + flat only, NOT the simulated estimate.
  const vatDueFile = round2(outputVat - inputRecorded - flat);

  // Swiss filing rule: declare + pay within 60 days of quarter end.
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const qEnd = new Date(Date.UTC(year, endMonth - 1, lastDay));
  const dueDate = new Date(qEnd.getTime() + 60 * 86400000).toISOString().slice(0, 10);

  const obligation = d.prepare(
    "SELECT id, amount, status, due_date, doc_file FROM obligations WHERE obligation_type='vat' AND period_label=?"
  ).get(`Q${quarter} ${year}`) as any;

  return {
    year,
    quarter,
    period: `Q${quarter} ${year}`,
    output_vat: round2(outputVat),
    input_vat_recorded: round2(inputRecorded),
    input_vat_estimated: inputEstimated,
    estimated_bills: estimatedBills,
    flat_deduction: round2(flat),
    input_vat: totalDeductions,
    vat_due: vatDue,
    vat_due_file: vatDueFile,
    due_date: dueDate,
    obligation: obligation
      ? { id: obligation.id, amount: obligation.amount, status: obligation.status,
          due_date: obligation.due_date, doc_file: obligation.doc_file }
      : null,
  };
}

export type VatObligationResult =
  | { ok: true; id: number; updated: boolean; amount: number }
  | { ok: false; status: number; detail: string };

// Port of create_vat_obligation: create (or refresh) the quarterly VAT
// obligation. Books the file-ready net (recorded input only). Refuses to touch
// a paid or assessment-backed obligation. Returns a discriminated result so the
// route can mirror FastAPI's HTTPException status + message.
export function createVatObligation(d: Database.Database, year: number, quarter: number): VatObligationResult {
  const settings = loadVatSettings(d);
  const data = vatQuarterData(d, year, quarter, settings);
  const amount = data.vat_due_file;   // book the file-ready net (recorded input only)
  if (amount <= 0) {
    return { ok: false, status: 400,
      detail: `No VAT due for Q${quarter} ${year} (net position: ${amount.toFixed(2)})` };
  }
  const label = `Q${quarter} ${year}`;
  const notes = `VAT ${label} — output ${data.output_vat.toFixed(2)}, deductions ` +
    `${data.input_vat.toFixed(2)} (recorded ${data.input_vat_recorded.toFixed(2)}, ` +
    `estimated ${data.input_vat_estimated.toFixed(2)}, flat ${data.flat_deduction.toFixed(2)})`;
  const existing = data.obligation;
  if (existing) {
    if (existing.status === "paid") {
      return { ok: false, status: 400, detail: `VAT obligation for ${label} is already paid` };
    }
    if (existing.doc_file) {
      return { ok: false, status: 400,
        detail: `VAT obligation for ${label} was readjusted from an uploaded assessment — ` +
          "its amount is authoritative. Edit it on the Obligations page if needed." };
    }
    d.prepare("UPDATE obligations SET amount=?, due_date=?, notes=? WHERE id=?")
      .run(amount, data.due_date, notes, existing.id);
    return { ok: true, id: existing.id, updated: true, amount };
  }
  const info = d.prepare(
    `INSERT INTO obligations
       (obligation_type, period_label, period_year, amount, currency,
        due_date, status, notes, recurrence)
       VALUES ('vat', ?, ?, ?, 'CHF', ?, 'unpaid', ?, 'none')`
  ).run(label, year, amount, data.due_date, notes);
  return { ok: true, id: Number(info.lastInsertRowid), updated: false, amount };
}
