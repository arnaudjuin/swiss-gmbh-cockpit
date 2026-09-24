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
  const rows: any[] = db().prepare("SELECT * FROM company_docs ORDER BY doc_date DESC").all();
  let out = csvRow(["Date", "Vendor", "Description", "Amount", "Currency", "Category", "Due", "Status"]);
  for (const r of rows)
    out += csvRow([r.doc_date, r.vendor, r.description, pyFloat(r.amount), r.currency,
      r.category, r.due_date || "", r.status]);
  return csvResponse(out, "bills.csv");
});
