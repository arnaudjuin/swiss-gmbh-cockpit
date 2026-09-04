// SQLite access for the TypeScript backend. Opens the SAME database file the
// FastAPI backend uses (repo root by default), so the two backends are
// interchangeable during the port. Schema creation still lives in db.py /
// seed_demo.py until the M4 milestone (see PORTING.md).
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "..", "invoices.db");

const gdb = globalThis as unknown as { __cockpitDb?: Database.Database };
export function db(): Database.Database {
  let _db = gdb.__cockpitDb ?? null;
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    gdb.__cockpitDb = _db;
  }
  return _db;
}

export type Row = Record<string, unknown>;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAME = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
