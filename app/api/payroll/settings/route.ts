import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { payrollSettingsRow, rowToSettings } from "@/server/payroll";

export const GET = guard(async () => {
  const row = payrollSettingsRow();
  if (!row) return err(404, "No settings found");
  return json(rowToSettings(row));
});

export const PUT = guard(async (req: NextRequest) => {
  const b = await req.json();
  for (const f of ["employer_name", "employee_name", "employee_address", "employment_start"]) {
    if (!b[f]) return err(400, `Missing required field: ${f}`);
  }
  db().prepare(`UPDATE payroll_settings SET
      employer_name=?, employee_name=?, employee_address=?, employment_start=?,
      canton=?, currency=?, payment_day=?, gross_monthly=?,
      ahv_employee_pct=?, ahv_employer_pct=?, alv_employee_pct=?, alv_employer_pct=?,
      bvg_monthly_employee=?, bvg_monthly_employer=?, bvg_provider=?,
      uvg_employee_monthly=?, uvg_employer_monthly=?,
      ktg_monthly_total=?, ktg_employer_share_pct=?,
      fak_employer_pct=?, source_tax_monthly=?, source_tax_tariff=?,
      updated_at=datetime('now') WHERE id=1`).run(
    b.employer_name, b.employee_name, b.employee_address, b.employment_start,
    b.canton ?? "Zurich", b.currency ?? "CHF", Number(b.payment_day ?? 25), Number(b.gross_monthly ?? 0),
    Number(b.ahv_employee_pct ?? 5.3), Number(b.ahv_employer_pct ?? 5.3),
    Number(b.alv_employee_pct ?? 1.1), Number(b.alv_employer_pct ?? 1.1),
    Number(b.bvg_monthly_employee ?? 0), Number(b.bvg_monthly_employer ?? 0), b.bvg_provider ?? "",
    Number(b.uvg_employee_monthly ?? 0), Number(b.uvg_employer_monthly ?? 0),
    Number(b.ktg_monthly_total ?? 0), Number(b.ktg_employer_share_pct ?? 70),
    Number(b.fak_employer_pct ?? 1.2), Number(b.source_tax_monthly ?? 0), b.source_tax_tariff ?? "");
  return json({ message: "Settings updated" });
});
