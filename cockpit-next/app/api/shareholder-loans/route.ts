import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

const loanToDict = (r: any) => ({
  id: r.id, loan_date: r.loan_date, amount: r.amount, currency: r.currency,
  direction: r.direction, is_subordinated: !!r.is_subordinated, notes: r.notes,
  document_file: r.document_file, repayment_date: r.repayment_date,
  is_repaid: !!r.is_repaid, created_at: r.created_at,
});
const VALID_DIRECTIONS = ["gmbh_to_shareholder", "shareholder_to_gmbh"];

export const GET = guard(async () => {
  const rows: any[] = db().prepare("SELECT * FROM shareholder_loans ORDER BY loan_date DESC, id DESC").all();
  return json(rows.map(loanToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const direction = s("direction", "shareholder_to_gmbh") || "shareholder_to_gmbh";
  if (!VALID_DIRECTIONS.includes(direction))
    return err(400, `direction must be one of ['gmbh_to_shareholder', 'shareholder_to_gmbh']`);
  const amount = Number(s("amount"));
  if (!(amount > 0)) return err(400, "amount must be positive");
  const cur = db().prepare(
    `INSERT INTO shareholder_loans
       (loan_date, amount, currency, direction, is_subordinated, notes, repayment_date, is_repaid)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(s("loan_date"), amount, s("currency", "CHF") || "CHF", direction,
    Number(s("is_subordinated", "0") || 0), s("notes") || null,
    s("repayment_date") || null, Number(s("is_repaid", "0") || 0));
  return json({ id: Number(cur.lastInsertRowid) });
});
