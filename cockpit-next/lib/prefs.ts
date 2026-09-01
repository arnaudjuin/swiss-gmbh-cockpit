import { api } from "./api";

// Server-backed preferences — the same store the classic SPA uses, so both
// frontends see identical widget/plan settings.
let cache: Record<string, unknown> | null = null;

export async function loadPrefs(): Promise<Record<string, unknown>> {
  if (!cache) cache = await api<Record<string, unknown>>("/preferences");
  return cache;
}

export async function setPref(path: string, value: unknown): Promise<void> {
  const prefs = await loadPrefs();
  const keys = path.split(".");
  let cur = prefs as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  await api("/preferences", { method: "PUT", body: JSON.stringify(prefs) });
}

export function pref<T>(prefs: Record<string, unknown>, path: string, fallback: T): T {
  let cur: unknown = prefs;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return fallback;
    cur = (cur as Record<string, unknown>)[key];
  }
  return (cur === undefined ? fallback : cur) as T;
}
