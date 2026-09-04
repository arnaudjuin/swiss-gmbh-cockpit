import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { listObligations } from "@/server/obligations";

export const GET = guard(async (req: NextRequest) => {
  const y = req.nextUrl.searchParams.get("year");
  return json(listObligations(y ? Number(y) : undefined));
});
