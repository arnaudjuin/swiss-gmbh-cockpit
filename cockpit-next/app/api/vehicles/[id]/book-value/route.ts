import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";

export const GET = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const r: any = db().prepare("SELECT * FROM vehicles WHERE id=?").get(Number(id));
  if (!r) return err(404, "Vehicle not found");
  const asOf = req.nextUrl.searchParams.get("as_of") || todayISO();
  const days = Math.round((Date.parse(asOf) - Date.parse(r.purchase_date)) / 86400000);
  const yearsHeld = Math.max(0, days / 365.25);
  const price = Number(r.purchase_price || 0);
  const method = r.depreciation_method || "degressive_40";
  let book: number;
  if (method === "degressive_40") book = price * Math.pow(0.6, yearsHeld);        // 40 % declining balance
  else if (method === "linear_20") book = Math.max(0, price * (1 - 0.20 * yearsHeld)); // 20 %/yr capped
  else book = price;
  return json({
    id: Number(id), purchase_price: price, purchase_date: r.purchase_date,
    as_of: asOf, years_held: Math.round(yearsHeld * 100) / 100,
    depreciation_method: method, book_value: round2(book),
    accumulated_depreciation: round2(price - book),
  });
});
