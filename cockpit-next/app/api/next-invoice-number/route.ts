import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const n = (db().prepare("SELECT MAX(invoice_number) as n FROM invoices").get() as any).n;
  return json({ next: (n || 17) + 1 });
});
