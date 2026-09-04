import { db, round2 } from "./db";

export function rowToSettings(r: any) {
  return {
    employer_name: r.employer_name, employee_name: r.employee_name,
    employee_address: r.employee_address ?? "", employment_start: r.employment_start,
    canton: r.canton, currency: r.currency, payment_day: r.payment_day,
    gross_monthly: r.gross_monthly,
    ahv_employee_pct: r.ahv_employee_pct, ahv_employer_pct: r.ahv_employer_pct,
    alv_employee_pct: r.alv_employee_pct, alv_employer_pct: r.alv_employer_pct,
    bvg_monthly_employee: r.bvg_monthly_employee, bvg_monthly_employer: r.bvg_monthly_employer,
    bvg_provider: r.bvg_provider ?? "",
    uvg_employee_monthly: r.uvg_employee_monthly, uvg_employer_monthly: r.uvg_employer_monthly,
    ktg_monthly_total: r.ktg_monthly_total, ktg_employer_share_pct: r.ktg_employer_share_pct,
    fak_employer_pct: r.fak_employer_pct ?? 1.2,
    source_tax_monthly: r.source_tax_monthly ?? 0,
    source_tax_tariff: r.source_tax_tariff ?? "",
  };
}

// 1:1 port of routes/payroll.py::_compute_payslip (ALV plafond 148'200/yr).
export function computePayslip(s: ReturnType<typeof rowToSettings>) {
  const gross = s.gross_monthly;
  const plafond = 148200 / 12;
  const emp_ahv = round2(gross * s.ahv_employee_pct / 100);
  const capped = Math.min(gross, plafond);
  const emp_alv = round2(capped * s.alv_employee_pct / 100);
  const emp_bvg = s.bvg_monthly_employee;
  const emp_uvg = s.uvg_employee_monthly;
  const ktgShare = s.ktg_employer_share_pct / 100;
  const emp_ktg = round2(s.ktg_monthly_total * (1 - ktgShare));
  const employer_ktg = round2(s.ktg_monthly_total * ktgShare);
  const emp_sai = 0, employer_sai = 0;   // SAI unused in current settings
  const emp_source_tax = Number(s.source_tax_monthly || 0);
  const emp_total = round2(emp_ahv + emp_alv + emp_bvg + emp_uvg + emp_sai + emp_ktg + emp_source_tax);
  const net = round2(gross - emp_total);
  const employer_ahv = round2(gross * s.ahv_employer_pct / 100);
  const employer_alv = round2(capped * s.alv_employer_pct / 100);
  const employer_fak = round2(gross * Number(s.fak_employer_pct || 0) / 100);
  const employer_total = round2(employer_ahv + employer_alv + s.bvg_monthly_employer
    + s.uvg_employer_monthly + employer_sai + employer_ktg + employer_fak);
  return {
    gross,
    emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_sai, emp_ktg, emp_source_tax,
    emp_total_deductions: emp_total, net_salary: net,
    employer_ahv, employer_alv, employer_bvg: s.bvg_monthly_employer,
    employer_uvg: s.uvg_employer_monthly, employer_sai, employer_ktg, employer_fak,
    employer_total, total_employer_cost: round2(gross + employer_total),
  };
}

export function payrollSettingsRow() {
  return db().prepare("SELECT * FROM payroll_settings WHERE id=1").get() as any;
}
