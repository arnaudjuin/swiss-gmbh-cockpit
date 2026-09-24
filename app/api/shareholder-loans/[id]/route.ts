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

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const r = db().prepare("SELECT * FROM shareholder_loans WHERE id=?").get(Number(id));
  if (!r) return err(404, "Loan not found");
  return json(loanToDict(r));
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const direction = s("direction", "shareholder_to_gmbh") || "shareholder_to_gmbh";
  if (!VALID_DIRECTIONS.includes(direction))
    return err(400, `direction must be one of ['gmbh_to_shareholder', 'shareholder_to_gmbh']`);
  if (!db().prepare("SELECT 1 FROM shareholder_loans WHERE id=?").get(Number(id))) return err(404, "Loan not found");
  db().prepare(
    `UPDATE shareholder_loans SET
       loan_date=?, amount=?, currency=?, direction=?, is_subordinated=?,
       notes=?, repayment_date=?, is_repaid=?, updated_at=datetime('now') WHERE id=?`
  ).run(s("loan_date"), Number(s("amount")), s("currency", "CHF") || "CHF", direction,
    Number(s("is_subordinated", "0") || 0), s("notes") || null,
    s("repayment_date") || null, Number(s("is_repaid", "0") || 0), Number(id));
  return json({ message: "Loan updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM shareholder_loans WHERE id=?").get(Number(id))) return err(404, "Loan not found");
  db().prepare("DELETE FROM shareholder_loans WHERE id=?").run(Number(id));
  return json({ message: "Loan deleted" });
});
