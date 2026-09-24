import { NextRequest, NextResponse } from "next/server";
import { validToken } from "@/server/auth";
import { pub } from "@/server/pub";
import { QUICK_LOGIN_HTML, QUICK_HTML } from "@/server/quickPage";

const html = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

export const GET = pub(async (req: NextRequest) => {
  const token = req.cookies.get("session")?.value || req.nextUrl.searchParams.get("token");
  if (!token || !validToken(token)) return html(QUICK_LOGIN_HTML, 401);
  return html(QUICK_HTML);
});
