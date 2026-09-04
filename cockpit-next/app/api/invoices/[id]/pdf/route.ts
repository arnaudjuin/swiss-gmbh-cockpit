import { NextRequest } from "next/server";
import { requireAuth } from "@/server/http";
import { db } from "@/server/db";
import { serveFile, DIRS } from "@/server/files";

// Serves the stored PDF (generation itself is still Python-side).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const row = db().prepare("SELECT invoice_number FROM invoices WHERE id=?").get(id) as any;
  if (!row) return serveFile(DIRS.invoices, null);
  return serveFile(DIRS.invoices, `invoice_${String(row.invoice_number).padStart(4, "0")}.pdf`);
}
