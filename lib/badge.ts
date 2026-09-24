// 5-family category classification (canonical rev 2) — port of
// static/js/01-core.js::badgeClass. Categories are grouped into five semantic
// families, never one colour per category:
//   vehicle & fuel        → --warn
//   digital & telecom     → --info
//   insurance & protection→ --ok
//   statutory / authorities → --danger
//   everything else       → neutral .chip
export function badgeClass(category?: string): string {
  const c = (category || "").toLowerCase();
  if (/vehicle|fuel|car|petrol|diesel|garage|pneu|maintenance/.test(c)) return "chip chip--warn";
  if (/software|subscription|telecom|phone|internet|saas|mobile|hosting/.test(c)) return "chip chip--info";
  if (/insurance|axa|helvetia|assurance/.test(c)) return "chip chip--ok";
  if (/payroll|tax|vat|mwst|ahv|bvg|social|steuer/.test(c)) return "chip chip--danger";
  return "chip";
}
