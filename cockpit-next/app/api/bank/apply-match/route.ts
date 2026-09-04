import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const targetId = body.id;
  switch (body.type) {
    case "bill":
      db().prepare("UPDATE company_docs SET status='paid' WHERE id=?").run(targetId);
      return json({ message: "Bill marked paid" });
    case "obligation":
      db().prepare("UPDATE obligations SET status='paid' WHERE id=?").run(targetId);
      return json({ message: "Obligation marked paid" });
    case "invoice":
      db().prepare("UPDATE invoices SET paid_status='paid', paid_date=? WHERE id=?").run(todayISO(), targetId);
      return json({ message: "Invoice marked paid" });
    case "income": {
      const row = body.csv_row || {};
      db().prepare(
        `INSERT INTO income_entries (income_date, source, description, amount, currency, category)
         VALUES (?,?,?,?,?,?)`
      ).run(row.date, row.description ?? "Bank", row.description ?? "",
        Math.abs(Number(row.amount ?? 0)), "CHF", "Bank Deposit");
      return json({ message: "Income logged" });
    }
    default:
      return err(400, "Unknown match type");
  }
});
