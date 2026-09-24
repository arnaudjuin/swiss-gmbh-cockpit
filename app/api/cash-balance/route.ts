import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { effectiveCash } from "@/server/cash";

export const GET = guard(async () => json(effectiveCash()));

export const PUT = guard(async (req: NextRequest) => {
  const b = await req.json();
  db().prepare("UPDATE cash_balance SET balance=?, as_of=?, notes=?, updated_at=datetime('now') WHERE id=1")
    .run(Number(b.balance ?? 0), b.as_of ?? new Date().toISOString().slice(0, 10), b.notes ?? "");
  return json({ message: "Cash balance updated" });
});
