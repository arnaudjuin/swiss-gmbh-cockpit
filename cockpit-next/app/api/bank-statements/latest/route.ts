import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { statementToDict } from "@/server/bank";

export const GET = guard(async () => {
  const r = db().prepare("SELECT * FROM bank_statements ORDER BY period_end DESC, id DESC LIMIT 1").get();
  if (!r) return json({ present: false });
  return json({ ...statementToDict(r), present: true });
});
