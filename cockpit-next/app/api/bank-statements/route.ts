import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { statementToDict } from "@/server/bank";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = year
    ? db().prepare("SELECT * FROM bank_statements WHERE substr(period_end,1,4)=? ORDER BY period_end DESC, id DESC").all(year)
    : db().prepare("SELECT * FROM bank_statements ORDER BY period_end DESC, id DESC").all();
  return json(rows.map(statementToDict));
});
