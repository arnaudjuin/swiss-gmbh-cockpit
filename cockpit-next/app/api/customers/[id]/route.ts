import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

const FIELDS = ["id", "name", "address", "city", "country", "email", "reference", "created_at"];
const pick = (r: any) => Object.fromEntries(FIELDS.map(k => [k, r[k] ?? null]));

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM customers WHERE id=?").get(Number(id));
  if (!row) return err(404, "Customer not found");
  return json(pick(row));
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT id FROM customers WHERE id=?").get(Number(id));
  if (!row) return err(404, "Customer not found");
  const b = await req.json();
  db().prepare("UPDATE customers SET name=?, address=?, city=?, country=?, email=?, reference=? WHERE id=?")
    .run(b.name, b.address ?? null, b.city ?? null, b.country ?? null, b.email ?? null, b.reference ?? null, Number(id));
  return json({ message: "Customer updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  db().prepare("DELETE FROM customers WHERE id=?").run(Number(id));
  return json({ message: "Customer deleted" });
});
