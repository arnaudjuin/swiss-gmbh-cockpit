import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { billToDict } from "@/server/bills";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = year
    ? db().prepare("SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date DESC").all(year)
    : db().prepare("SELECT * FROM company_docs ORDER BY doc_date DESC").all();
  return json(rows.map(billToDict));
});
