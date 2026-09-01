// Display settings (Settings page). Currency is a label — no conversion.
let _currency = "CHF";
let _locale = "de-CH";
export function setMoneyFormat(currency: string, locale: string) {
  if (currency) _currency = currency;
  if (locale) _locale = locale;
}

export function chfWhole(n: number | string): string {
  return `${_currency} ` + Number(n).toLocaleString(_locale, { maximumFractionDigits: 0 });
}

export function chf(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return `${_currency} —`;
  return `${_currency} ` + Number(n).toLocaleString(_locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

export function vizToken(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
