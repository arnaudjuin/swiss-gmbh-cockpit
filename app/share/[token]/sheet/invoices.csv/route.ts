import { NextRequest, NextResponse } from "next/server";
import { db, MONTH_NAME } from "@/server/db";
import { csvRow, pyFloat } from "@/server/pycsv";
import { pub } from "@/server/pub";

const csvResponse = (content: string, filename: string) =>
  new NextResponse(content, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `inline; filename=${filename}`,
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",   // Google Sheets IMPORTDATA
  } });

const linkExists = (token: string) =>
  !!db().prepare("SELECT id FROM shared_links WHERE token=?").get(token);

export const GET = pub(async (_req: NextRequest, ctx: any) => {
  const { token } = await ctx.params;
  if (!linkExists(token)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const rows: any[] = db().prepare("SELECT * FROM invoices WHERE hours>0 ORDER BY year DESC, month DESC").all();
  let out = csvRow(["Invoice #", "Year", "Month", "Hours", "Subtotal", "VAT", "Total", "Issued", "Due", "Status"]);
  for (const r of rows)
    out += csvRow([String(r.invoice_number).padStart(4, "0"), r.year, MONTH_NAME[r.month],
      pyFloat(r.hours), pyFloat(r.subtotal), pyFloat(r.tax), pyFloat(r.total),
      r.issued_date, r.due_date, r.paid_status ?? ""]);
  return csvResponse(out, "invoices.csv");
});
