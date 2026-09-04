import { db } from "./db";

export function getPrefs(): Record<string, any> {
  const row = db().prepare("SELECT prefs FROM user_preferences WHERE id=1").get() as { prefs?: string } | undefined;
  try { return row?.prefs ? JSON.parse(row.prefs) : {}; } catch { return {}; }
}
export function putPrefs(obj: Record<string, unknown>) {
  const payload = JSON.stringify(obj);
  db().prepare(
    "INSERT INTO user_preferences (id, prefs) VALUES (1, ?) " +
    "ON CONFLICT(id) DO UPDATE SET prefs=excluded.prefs"
  ).run(payload);
}
export function prefPath<T>(path: string, fallback: T): T {
  let cur: any = getPrefs();
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return fallback;
    cur = cur[k];
  }
  return cur === undefined ? fallback : cur;
}
