import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { financeForecast } from "@/server/forecast";

export const GET = guard(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const year = q.get("year"); const income = q.get("income");
  return json(financeForecast(
    year != null ? Number(year) : undefined,
    income != null && income !== "" ? Number(income) : undefined,
    q.get("incomes") ?? undefined));
});
