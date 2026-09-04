import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { dashboardOverview } from "@/server/dashboard";

export const GET = guard(async (req: NextRequest) =>
  json(dashboardOverview(req.nextUrl.searchParams.get("range") ?? "ytd")));
