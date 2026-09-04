import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";

const vehicleToDict = (r: any) => ({
  id: r.id, name: r.name, vendor: r.vendor, purchase_date: r.purchase_date,
  purchase_price: r.purchase_price, vat_paid: r.vat_paid,
  purchase_invoice_file: r.purchase_invoice_file, registration_number: r.registration_number,
  fahrzeugausweis_file: r.fahrzeugausweis_file, depreciation_method: r.depreciation_method,
  privatanteil_method: r.privatanteil_method, privatanteil_monthly: r.privatanteil_monthly,
  is_active: !!r.is_active, notes: r.notes, created_at: r.created_at,
});

export const GET = guard(async () => {
  const rows: any[] = db().prepare("SELECT * FROM vehicles WHERE is_active=1 ORDER BY purchase_date DESC").all();
  return json(rows.map(vehicleToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const n = (k: string) => { const v = s(k); return v.trim() === "" ? null : Number(v); };
  const purchasePrice = Number(s("purchase_price"));
  const privatanteilMethod = s("privatanteil_method", "pauschal") || "pauschal";
  let privatanteilMonthly = n("privatanteil_monthly");
  // Auto-compute Privatanteil for pauschal method (0.9 % × purchase_price)
  if (privatanteilMonthly == null && privatanteilMethod === "pauschal")
    privatanteilMonthly = round2(purchasePrice * 0.009);
  const cur = db().prepare(
    `INSERT INTO vehicles
       (name, vendor, purchase_date, purchase_price, vat_paid,
        registration_number, depreciation_method, privatanteil_method,
        privatanteil_monthly, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(s("name"), s("vendor") || null, s("purchase_date"), purchasePrice, n("vat_paid"),
    s("registration_number") || null, s("depreciation_method", "degressive_40") || "degressive_40",
    privatanteilMethod, privatanteilMonthly, s("notes") || null);
  return json({ id: Number(cur.lastInsertRowid), privatanteil_monthly: privatanteilMonthly });
});
