// Shared bits for expense reports (routes/expenses.py module scope).
export const COMPANY = "Muster Consulting GmbH";
export const AED_TO_CHF = 0.2178;

export function reportFilename(year: number, month: number | null | undefined, rptNum: number): string {
  const n = String(rptNum).padStart(4, "0");
  return month ? `expenses_${year}_${String(month).padStart(2, "0")}_${n}.pdf` : `expenses_${year}_${n}.pdf`;
}
