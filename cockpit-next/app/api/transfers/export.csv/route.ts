import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/server/http";
import { db } from "@/server/db";

// Python csv.writer semantics: quote when needed, CRLF terminators.
const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rowOut = (cells: string[]) => cells.map(q).join(",") + "\r\n";

const txType = (r: any): string => {
  const d = r.description || "";
  if (d.startsWith("Net salary")) return "salary (wages — not Kontokorrent)";
  if (d.startsWith("Personal-card reimbursement")) return "personal-card reimbursement (settles fronted bills)";
  return "owner transfer (Kontokorrent)";
};

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  let sql = "SELECT transfer_date, direction, amount, currency, description FROM account_transfers";
  const args: string[] = [];
  if (year != null) { sql += " WHERE substr(transfer_date,1,4)=?"; args.push(year); }
  sql += " ORDER BY transfer_date";
  const rows: any[] = db().prepare(sql).all(...args);

  let out = rowOut(["Date", "Direction", "Type", "Amount", "Currency", "Description", "Net effect"]);
  for (const r of rows) {
    const sign = r.direction === "personal_to_gmbh" ? "+" : "−";
    out += rowOut([r.transfer_date, r.direction, txType(r), r.amount.toFixed(2),
      r.currency, r.description || "", `${sign}${r.amount.toFixed(2)}`]);
  }
  // Trailing summary — Kontokorrent semantics: salary is compensation and
  // personal-card reimbursements settle bills tracked on the bills side.
  const ownerRows = rows.filter(r => txType(r).startsWith("owner"));
  const toGmbh = ownerRows.filter(r => r.direction === "personal_to_gmbh").reduce((s, r) => s + r.amount, 0);
  const toPersonal = ownerRows.filter(r => r.direction === "gmbh_to_personal").reduce((s, r) => s + r.amount, 0);
  const salaryTotal = rows.filter(r => txType(r).startsWith("salary")).reduce((s, r) => s + r.amount, 0);
  const reimbTotal = rows.filter(r => txType(r).startsWith("personal-card")).reduce((s, r) => s + r.amount, 0);
  out += "\r\n";
  out += rowOut(["TOTAL owner Personal → GmbH", "", "", toGmbh.toFixed(2), "CHF", "", ""]);
  out += rowOut(["TOTAL owner GmbH → Personal", "", "", toPersonal.toFixed(2), "CHF", "", ""]);
  out += rowOut(["NET owed to Personal (Kontokorrent, excl. salary/reimbursements)", "", "", (toGmbh - toPersonal).toFixed(2), "CHF", "", ""]);
  out += rowOut(["Info: salary payments (wages)", "", "", salaryTotal.toFixed(2), "CHF", "", ""]);
  out += rowOut(["Info: personal-card reimbursements", "", "", reimbTotal.toFixed(2), "CHF", "", ""]);

  return new NextResponse(out, { headers: {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="transfers_${year || "all"}.csv"`,
  } });
});
