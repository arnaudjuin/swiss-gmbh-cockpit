import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2 } from "@/server/db";

const vehicleToDict = (r: any) => ({
  id: r.id, name: r.name, vendor: r.vendor, purchase_date: r.purchase_date,
  purchase_price: r.purchase_price, vat_paid: r.vat_paid,
  purchase_invoice_file: r.purchase_invoice_file, registration_number: r.registration_number,
  fahrzeugausweis_file: r.fahrzeugausweis_file, depreciation_method: r.depreciation_method,
  privatanteil_method: r.privatanteil_method, privatanteil_monthly: r.privatanteil_monthly,
  is_active: !!r.is_active, notes: r.notes, created_at: r.created_at,
});

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const r = db().prepare("SELECT * FROM vehicles WHERE id=?").get(Number(id));
  if (!r) return err(404, "Vehicle not found");
  return json(vehicleToDict(r));
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM vehicles WHERE id=?").get(Number(id))) return err(404, "Vehicle not found");
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const n = (k: string) => { const v = s(k); return v.trim() === "" ? null : Number(v); };
  const purchasePrice = Number(s("purchase_price"));
  const privatanteilMethod = s("privatanteil_method", "pauschal") || "pauschal";
  let privatanteilMonthly = n("privatanteil_monthly");
  if (privatanteilMonthly == null && privatanteilMethod === "pauschal")
    privatanteilMonthly = round2(purchasePrice * 0.009);
  db().prepare(
    `UPDATE vehicles SET
       name=?, vendor=?, purchase_date=?, purchase_price=?, vat_paid=?,
       registration_number=?, depreciation_method=?, privatanteil_method=?,
       privatanteil_monthly=?, notes=?, is_active=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(s("name"), s("vendor") || null, s("purchase_date"), purchasePrice, n("vat_paid"),
    s("registration_number") || null, s("depreciation_method", "degressive_40") || "degressive_40",
    privatanteilMethod, privatanteilMonthly, s("notes") || null, n("is_active") ?? 1, Number(id));
  return json({ message: "Vehicle updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM vehicles WHERE id=?").get(Number(id))) return err(404, "Vehicle not found");
  db().prepare("DELETE FROM vehicles WHERE id=?").run(Number(id));
  return json({ message: "Vehicle deleted" });
});
