// Python csv.writer semantics: ';'-free minimal quoting, CRLF rows, and
// str() formatting for SQLite REAL columns (55.0 stays "55.0").
const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvRow = (cells: (string | number)[]) =>
  cells.map(c => q(typeof c === "number" ? String(c) : c)).join(",") + "\r\n";

// Python str(float) for a REAL column value: integers print with ".0".
export const pyFloat = (v: number | null | undefined): string =>
  v == null ? "" : Number.isInteger(v) ? v.toFixed(1) : String(v);
