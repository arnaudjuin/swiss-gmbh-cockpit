import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { search } from "@/server/search";

export const GET = guard(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(1000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 10)));
  return json(search(q, limit));
});
