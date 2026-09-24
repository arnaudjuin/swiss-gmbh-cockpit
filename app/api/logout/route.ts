import { NextRequest } from "next/server";
import { json } from "@/server/http";
import { logout } from "@/server/auth";

export async function POST(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  logout(h.startsWith("Bearer ") ? h.slice(7) : req.cookies.get("session")?.value ?? null);
  return json({ ok: true });
}
