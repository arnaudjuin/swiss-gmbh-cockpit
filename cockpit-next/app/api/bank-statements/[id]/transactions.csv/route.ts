import { NextRequest, NextResponse } from "next/server";
import { guard, err } from "@/server/http";
import { listTransactions } from "@/server/bankTx";

// Python csv.writer semantics: quote when needed, CRLF terminators.
const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rowOut = (cells: string[]) => cells.map(q).join(",") + "\r\n";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const data = listTransactions(Number(id));
  if ("notFound" in data) return err(404, "Statement not found");
  if ("error" in data) return err(400, data.error);

  let out = "﻿";
  out += rowOut(["Date", "Value Date", "Amount", "Currency",
    "Counterparty", "Description", "Reference",
    "Transaction No.", "Parent Tx No.", "Balance", "Is Sub-Entry"]);
  const currency = data.currency || "CHF";
  for (const tx of data.transactions) {
    const parentNo = tx.transaction_no || "";
    out += rowOut([tx.date || "", tx.value_date || "", (tx.amount ?? 0).toFixed(2), currency,
      tx.counterparty || "", tx.description || "", tx.reference || "",
      parentNo, "", tx.balance == null ? "" : tx.balance.toFixed(2), "0"]);
    for (const sub of tx.sub_entries ?? []) {
      out += rowOut([tx.date || "", tx.value_date || "", (sub.amount ?? 0).toFixed(2), currency,
        sub.counterparty || "", sub.description || "", "", "", parentNo, "", "1"]);
    }
  }
  const filename = `bank_transactions_${data.period_start || "start"}_to_${data.period_end || "end"}.csv`;
  return new NextResponse(out, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  } });
});
