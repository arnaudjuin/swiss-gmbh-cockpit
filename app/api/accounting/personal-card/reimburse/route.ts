import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";

// Python-style list repr for error messages: [3, 4]
const rep = (a: (number | string)[]) => `[${a.join(", ")}]`;

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const billIds: unknown[] = body.bill_ids || [];
  const reportIds: unknown[] = body.report_ids || [];
  const transferDate: string = body.transfer_date || todayISO();
  if (!billIds.length && !reportIds.length) return err(400, "Select at least one bill or expense report");
  if (!billIds.every(b => Number.isInteger(b)) || !reportIds.every(r => Number.isInteger(r)))
    return err(400, "bill_ids / report_ids must be lists of ids");
  const bids = billIds as number[], rids = reportIds as number[];
  const ph = bids.map(() => "?").join(",") || "NULL";
  const rows: any[] = bids.length ? db().prepare(
    `SELECT id, vendor, amount, currency, reimbursed_at, paid_via FROM company_docs WHERE id IN (${ph})`).all(...bids) : [];
  if (rows.length !== new Set(bids).size) return err(404, "One or more bills not found");
  const rph = rids.map(() => "?").join(",") || "NULL";
  const reps: any[] = rids.length ? db().prepare(
    `SELECT id, report_number, total, reimbursed_at FROM expense_reports WHERE id IN (${rph})`).all(...rids) : [];
  if (reps.length !== new Set(rids).size) return err(404, "One or more expense reports not found");
  const done = reps.filter(r => r.reimbursed_at).map(r => r.report_number);
  if (done.length) return err(400, `Expense report(s) #${rep(done)} already reimbursed`);
  const bad = rows.filter(r => r.paid_via !== "personal" || r.reimbursed_at).map(r => r.id);
  if (bad.length) return err(400,
    `Bills ${rep(bad)} are not outstanding personal-card bills (wrong payment method or already reimbursed)`);
  const nonChf = rows.filter(r => (r.currency || "CHF") !== "CHF").map(r => r.id);
  if (nonChf.length) return err(400, `Bills ${rep(nonChf)} are not in CHF — reimburse those individually`);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0) + reps.reduce((s, r) => s + Number(r.total || 0), 0));
  const parts: string[] = [];
  if (rows.length) {
    const vendors = [...new Set(rows.map(r => r.vendor as string))].sort().slice(0, 4).join(", ");
    parts.push(`${rows.length} bill(s): ${vendors}`);
  }
  if (reps.length) parts.push("expense report(s) " + reps.map(r => `#${r.report_number}`).join(", "));
  // Keep the 'Personal-card reimbursement' prefix: the Kontokorrent and the
  // bank classifier key off it to avoid double-counting the settlement.
  const cur = db().prepare(
    "INSERT INTO account_transfers (transfer_date, direction, amount, currency, description) VALUES (?,?,?,?,?)"
  ).run(transferDate, "gmbh_to_personal", total, "CHF",
    "Personal-card reimbursement — " + parts.join(" + "));
  if (bids.length) db().prepare(`UPDATE company_docs SET reimbursed_at=? WHERE id IN (${ph})`).run(transferDate, ...bids);
  if (rids.length) db().prepare(`UPDATE expense_reports SET reimbursed_at=? WHERE id IN (${rph})`).run(transferDate, ...rids);
  return json({ transfer_id: Number(cur.lastInsertRowid), total,
    bills_settled: rows.length, reports_settled: reps.length });
});
