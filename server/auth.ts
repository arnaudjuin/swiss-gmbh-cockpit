import crypto from "crypto";
import { db } from "./db";

const PASSWORD = process.env.ADMIN_PASSWORD || "demo";
const TTL = Number(process.env.SESSION_TTL || 86400) * 1000;

// Sessions live in SQLite: production builds may bundle routes separately
// (module state not shared), and this also survives server restarts.
function table() {
  db().prepare("CREATE TABLE IF NOT EXISTS ts_sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)").run();
}

export function login(password: string): string | null {
  if (password !== PASSWORD) return null;
  table();
  const token = crypto.randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO ts_sessions (token, expires) VALUES (?, ?)").run(token, Date.now() + TTL);
  db().prepare("DELETE FROM ts_sessions WHERE expires < ?").run(Date.now());
  return token;
}
export function logout(token: string | null) {
  if (!token) return;
  table();
  db().prepare("DELETE FROM ts_sessions WHERE token=?").run(token);
}
export function validToken(token: string | null): boolean {
  if (!token) return false;
  table();
  const row = db().prepare("SELECT expires FROM ts_sessions WHERE token=?").get(token) as { expires: number } | undefined;
  return !!row && row.expires >= Date.now();
}
