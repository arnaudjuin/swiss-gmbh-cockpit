import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2, MONTH_ABBR } from "@/server/db";
import { payrollSettingsRow, rowToSettings, computePayslip } from "@/server/payroll";

// Port of routes/payroll.py::generate_payslip — payslip upsert + opt-in side
// effects (income entry, salary transfer, AHV/UVG/KTG + Quellensteuer
// obligations). PDF rendering not yet ported: pdf_file is kept if present.
export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ year: string; month: string }> }) => {
  const p = await ctx.params;
  const year = Number(p.year), month = Number(p.month);
  if (month < 1 || month > 12) return err(400, "Month must be 1-12");
  const body = await req.json().catch(() => ({}));
  const d = db();
  const row = payrollSettingsRow();
  if (!row) return err(400, "Payroll settings not configured");
  const settings = rowToSettings(row);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  if (periodEnd < settings.employment_start) return err(400, `Period ${year}-${month} is before employment start`);
  const calc = computePayslip(settings);
  const issued = periodEnd;
  const paymentDate = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(settings.payment_day, lastDay)).padStart(2, "0")}`;

  const existing = d.prepare("SELECT id, pdf_file FROM payslips WHERE year=? AND month=?").get(year, month) as any;
  const vals = [issued, paymentDate, calc.gross, calc.emp_ahv, calc.emp_alv, calc.emp_bvg,
    calc.emp_uvg, calc.emp_ktg, calc.emp_source_tax, calc.emp_total_deductions, calc.net_salary,
    calc.employer_ahv, calc.employer_alv, calc.employer_bvg, calc.employer_uvg, calc.employer_ktg,
    calc.employer_fak, calc.employer_total, calc.total_employer_cost];
  let payslipId: number;
  if (existing) {
    d.prepare(`UPDATE payslips SET issued_date=?, payment_date=?, gross=?,
      emp_ahv=?, emp_alv=?, emp_bvg=?, emp_uvg=?, emp_ktg=?, emp_source_tax=?,
      emp_total_deductions=?, net_salary=?,
      employer_ahv=?, employer_alv=?, employer_bvg=?, employer_uvg=?, employer_ktg=?, employer_fak=?,
      employer_total=?, total_employer_cost=?, status='issued', source='generated'
      WHERE year=? AND month=?`).run(...vals, year, month);
    payslipId = existing.id;
  } else {
    const r = d.prepare(`INSERT INTO payslips
      (year, month, issued_date, payment_date, gross,
       emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_ktg, emp_source_tax,
       emp_total_deductions, net_salary,
       employer_ahv, employer_alv, employer_bvg, employer_uvg, employer_ktg, employer_fak,
       employer_total, total_employer_cost, status, pdf_file, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'issued',NULL,'generated')`)
      .run(year, month, ...vals);
    payslipId = Number(r.lastInsertRowid);
  }

  const sideEffects = { income: false, transfer: false, obligations_created: 0 };
  const periodLabel = `${MONTH_ABBR[month]} ${year}`;
  if (body.create_income) {
    const exists = d.prepare("SELECT id FROM income_entries WHERE income_date=? AND source=? AND ABS(amount - ?) < 0.01")
      .get(paymentDate, settings.employer_name, calc.net_salary);
    if (!exists) {
      d.prepare("INSERT INTO income_entries (income_date, source, description, amount, currency, category) VALUES (?,?,?,?,?,?)")
        .run(paymentDate, settings.employer_name, `Net salary — ${periodLabel}`, calc.net_salary, settings.currency ?? "CHF", "Salary");
      sideEffects.income = true;
    }
  }
  if (body.create_transfer) {
    const exists = d.prepare("SELECT id FROM account_transfers WHERE transfer_date=? AND direction='gmbh_to_personal' AND ABS(amount - ?) < 0.01")
      .get(paymentDate, calc.net_salary);
    if (!exists) {
      d.prepare("INSERT INTO account_transfers (transfer_date, direction, amount, currency, description) VALUES (?,?,?,?,?)")
        .run(paymentDate, "gmbh_to_personal", calc.net_salary, settings.currency ?? "CHF", `Net salary payment — ${periodLabel}`);
      sideEffects.transfer = true;
    }
  }
  if (body.create_obligations) {
    const ahvTotal = round2(calc.emp_ahv + calc.emp_alv + calc.employer_ahv + calc.employer_alv);
    const ahvBill = round2(ahvTotal + calc.employer_fak + 0.02 * ahvTotal);
    const qEndMonth = (Math.floor((month - 1) / 3) + 1) * 3;
    const [billY, billM] = qEndMonth < 12 ? [year, qEndMonth + 1] : [year + 1, 1];
    const ahvBillDate = `${billY}-${String(billM).padStart(2, "0")}-15`;
    const plans: [string, string, number, string | null, number | null][] = [
      ["ahv", "AHV/IV/EO + ALV", ahvTotal, ahvBillDate, ahvBill],
      ["uvg", "UVG (AXA)", round2(calc.emp_uvg + calc.employer_uvg), null, null],
      ["ktg", "KTG (daily sickness)", round2(calc.emp_ktg + calc.employer_ktg), null, null],
    ];
    for (const [obType, label, amount, expDate, expAmt] of plans) {
      if (amount <= 0) continue;
      const exists = d.prepare("SELECT id FROM obligations WHERE period_label=? AND notes LIKE ? AND obligation_type=?")
        .get(periodLabel, `%${label}%`, obType);
      if (exists) continue;
      d.prepare(`INSERT INTO obligations (obligation_type, period_label, period_year, amount, currency,
        due_date, status, notes, recurrence, expected_bill_date, expected_bill_amount)
        VALUES (?,?,?,?,?,?,'unpaid',?,'none',?,?)`)
        .run(obType, periodLabel, year, amount, settings.currency ?? "CHF", issued,
          `Payroll obligation: ${label}`, expDate, expAmt);
      sideEffects.obligations_created++;
    }
    if (calc.emp_source_tax > 0) {
      const q = Math.floor((month - 1) / 3) + 1;
      const qLabel = `Q${q} ${year}`;
      const qMonths = [3 * (q - 1) + 1, 3 * (q - 1) + 2, 3 * (q - 1) + 3];
      const qTotal = round2(((d.prepare("SELECT COALESCE(SUM(emp_source_tax),0) t FROM payslips WHERE year=? AND month IN (?,?,?)")
        .get(year, ...qMonths) as any).t) as number);
      const qEndM = qMonths[2];
      const [dueM, dueY] = qEndM < 12 ? [qEndM + 1, year] : [1, year + 1];
      const dueLast = new Date(Date.UTC(dueY, dueM, 0)).getUTCDate();
      const stDue = `${dueY}-${String(dueM).padStart(2, "0")}-${String(dueLast).padStart(2, "0")}`;
      const [stBillM, stBillY] = qEndM <= 9 ? [qEndM + 3, year] : [qEndM - 9, year + 1];
      const stBill = `${stBillY}-${String(stBillM).padStart(2, "0")}-15`;
      const stNote = `Quellensteuer withheld ${qLabel} (issued payslips, tariff ${settings.source_tax_tariff || "A0N"}). ` +
        "Remit to Kantonales Steueramt ZH; ~2% Bezugsprovision stays with the GmbH.";
      const stRow = d.prepare("SELECT id, status FROM obligations WHERE obligation_type='source_tax' AND period_label=?").get(qLabel) as any;
      if (!stRow) {
        d.prepare(`INSERT INTO obligations (obligation_type, period_label, period_year, amount, currency,
          due_date, status, notes, recurrence, expected_bill_date, expected_bill_amount)
          VALUES ('source_tax',?,?,?,?,?,'unpaid',?,'none',?,?)`)
          .run(qLabel, year, qTotal, settings.currency ?? "CHF", stDue, stNote, stBill, round2(qTotal * 0.98));
        sideEffects.obligations_created++;
      } else if (stRow.status === "unpaid") {
        d.prepare("UPDATE obligations SET amount=?, expected_bill_amount=? WHERE id=?")
          .run(qTotal, round2(qTotal * 0.98), stRow.id);
      }
    }
  }
  return json({ id: payslipId, year, month,
    pdf: existing?.pdf_file ?? null, side_effects: sideEffects, net_salary: calc.net_salary });
});
