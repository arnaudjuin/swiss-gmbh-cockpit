import { NextRequest } from "next/server";
import { guard, err } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { serveFile, DIRS, contentDisposition } from "@/server/files";
import { COMPANY } from "@/server/expenseReports";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT invoice_number, year, month FROM invoices WHERE id = ?").get(Number(id));
  if (!row) return err(404, "Invoice not found");
  const resp = serveFile(DIRS.invoices, `invoice_${String(row.invoice_number).padStart(4, "0")}.pdf`);
  if (resp.status === 404) return err(404, "PDF not found");
  if (["1", "true", "True"].includes(req.nextUrl.searchParams.get("download") ?? ""))
    resp.headers.set("Content-Disposition", contentDisposition(
      `Invoice ${MONTH_NAME[row.month]} ${row.year} ${COMPANY} 101119.LOD-SW_GCS-24032.pdf`));
  return resp;
});
