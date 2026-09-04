import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { guard, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, contentDisposition } from "@/server/files";
import { csvRow, pyFloat } from "@/server/pycsv";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { year: yearS } = await ctx.params;
  const year = Number(yearS);
  const rows: any[] = db().prepare(
    "SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date").all(String(year));
  if (!rows.length) return err(404, `No documents for ${year}`);

  const zip = new JSZip();
  let csv = csvRow(["Date", "Vendor", "Description", "Amount CHF", "Original amount", "Original currency", "FX rate", "Category",
    "Paid via", "Reimbursed", "Filename", "Document link"]);
  const safeName = (r: any) => {
    const ext = path.extname(r.doc_file);
    const safeVendor = String(r.vendor).replace(/\//g, "-").replace(/\\/g, "-").slice(0, 30);
    return `${r.doc_date}_${safeVendor}_${pyFloat(r.amount)}${ext}`;
  };
  for (const r of rows) {
    const paidVia = r.paid_via ?? "company";
    const reimbursed = r.reimbursed_at || "";
    csv += csvRow([
      r.doc_date, r.vendor, r.description, pyFloat(r.amount),
      r.original_amount != null ? pyFloat(r.original_amount) : "",
      r.original_currency || "", r.fx_rate != null ? String(r.fx_rate) : "", r.category,
      paidVia === "personal" ? "private account/card" : "company account",
      paidVia === "personal" ? (reimbursed || "OUTSTANDING") : "",
      r.doc_file ? safeName(r) : "",
      r.doc_url || "",
    ]);
  }
  zip.file(`summary_${year}.csv`, csv, { createFolders: false });
  for (const r of rows) {
    if (!r.doc_file) continue;
    const fp = path.join(DIRS.accounting, r.doc_file);
    if (fs.existsSync(fp)) zip.file(safeName(r), fs.readFileSync(fp), { createFolders: false });
  }

  const buf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(path.join(DIRS.accounting, `accounting_${year}.zip`), buf);
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(`Muster Consulting Accounting ${year}.zip`),
  } });
});
