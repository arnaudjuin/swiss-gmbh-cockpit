// Wrapper for PUBLIC (unauthenticated) route handlers — same error contract
// as guard() but without the auth gate. Used by /share/* and /quick.
import { NextRequest, NextResponse } from "next/server";

export function pub(handler: (req: NextRequest, ctx: any) => Promise<NextResponse> | NextResponse) {
  return async (req: NextRequest, ctx: any) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(req.nextUrl.pathname, e);
      return NextResponse.json({ detail: e instanceof Error ? e.message : "Internal error" }, { status: 500 });
    }
  };
}

// Python renders None as "None" inside f-strings — keep the quirk for parity.
export const pyNone = (v: unknown): string => (v == null ? "None" : String(v));
export const fmt2 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
