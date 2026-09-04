import { NextRequest, NextResponse } from "next/server";
import { validToken } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (status: number, detail: string) => NextResponse.json({ detail }, { status });

// Same auth contract as FastAPI: Bearer header, session cookie, or ?token=.
export function requireAuth(req: NextRequest): NextResponse | null {
  const h = req.headers.get("authorization") || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7) : null;
  const cookie = req.cookies.get("session")?.value ?? null;
  const query = req.nextUrl.searchParams.get("token");
  if (validToken(bearer) || validToken(cookie) || validToken(query)) return null;
  return err(401, "Not authenticated");
}

export function guard(handler: (req: NextRequest, ctx: any) => Promise<NextResponse> | NextResponse) {
  return async (req: NextRequest, ctx: any) => {
    const unauthorized = requireAuth(req);
    if (unauthorized) return unauthorized;
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(req.nextUrl.pathname, e);
      return err(500, e instanceof Error ? e.message : "Internal error");
    }
  };
}
