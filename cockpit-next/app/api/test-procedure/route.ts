import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { loadTestProcedure } from "@/server/testProcedure";

export const GET = guard(async (req: NextRequest) => {
  const source = req.nextUrl.searchParams.get("source") || "accounting";
  if (source !== "accounting" && source !== "technical")
    return err(422, "source must be 'accounting' or 'technical'");
  const data = loadTestProcedure(source);
  if ("notFound" in data) return err(404, data.notFound as string);
  return json(data);
});
