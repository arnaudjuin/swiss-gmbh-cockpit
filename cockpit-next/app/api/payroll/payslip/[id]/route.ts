import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, deleteStored } from "@/server/files";

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row: any = db().prepare("SELECT pdf_file FROM payslips WHERE id=?").get(Number(id));
  if (!row) return err(404, "Not found");
  deleteStored(DIRS.payslips, row.pdf_file);
  db().prepare("DELETE FROM payslips WHERE id=?").run(Number(id));
  return json({ message: "Payslip deleted" });
});
