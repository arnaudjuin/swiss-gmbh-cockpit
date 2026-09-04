import { guard, json, err } from "@/server/http";
import { payrollSettingsRow, rowToSettings, computePayslip } from "@/server/payroll";

export const GET = guard(async () => {
  const row = payrollSettingsRow();
  if (!row || !row.gross_monthly) return err(404, "No payroll settings");
  const settings = rowToSettings(row);
  return json({ settings, calculation: computePayslip(settings) });
});
