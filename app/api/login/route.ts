import { NextRequest } from "next/server";
import { json, err } from "@/server/http";
import { login } from "@/server/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = login(String(body.password ?? ""));
  if (!token) return err(401, "Invalid password");
  return json({ ok: true, token });
}
