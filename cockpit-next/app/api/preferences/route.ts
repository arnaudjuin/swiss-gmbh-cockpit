import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { getPrefs, putPrefs } from "@/server/prefs";

export const GET = guard(async () => json(getPrefs()));
export const PUT = guard(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "Preferences must be a JSON object");
  putPrefs(body);
  return json({ ok: true });
});
