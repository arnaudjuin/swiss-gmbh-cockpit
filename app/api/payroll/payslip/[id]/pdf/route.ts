import { NextRequest } from "next/server";
import { guard, err } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { serveFile, DIRS, contentDisposition } from "@/server/files";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT * FROM payslips WHERE id=?").get(Number(id));
  if (!row) return err(404, "Payslip not found");
  const resp = serveFile(DIRS.payslips, row.pdf_file);
  if (resp.status === 404) return err(404, "PDF not found");
  if (["1", "true", "True"].includes(req.nextUrl.searchParams.get("download") ?? ""))
    resp.headers.set("Content-Disposition", contentDisposition(
      `Payslip ${MONTH_NAME[row.month]} ${row.year}.pdf`));
  return resp;
});
