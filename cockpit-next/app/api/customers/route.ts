import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () =>
  json(db().prepare("SELECT * FROM customers ORDER BY name").all()));

export const POST = guard(async (req: NextRequest) => {
  const b = await req.json();
  const r = db().prepare(
    "INSERT INTO customers (name, address, city, country, email, reference) VALUES (?,?,?,?,?,?)"
  ).run(b.name, b.address ?? "", b.city ?? "", b.country ?? "", b.email ?? null, b.reference ?? null);
  return json({ id: Number(r.lastInsertRowid) });
});
