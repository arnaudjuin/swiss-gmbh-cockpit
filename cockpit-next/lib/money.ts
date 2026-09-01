export function chf(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "CHF —";
  return "CHF " + Number(n).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

export function vizToken(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
