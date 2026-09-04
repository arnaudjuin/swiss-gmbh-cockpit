import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { guard, json, err } from "@/server/http";
import { DOC_NAMES, DOCS_MD_DIR } from "@/server/docsMeta";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { name } = await ctx.params;
  // Whitelist doubles as path-traversal protection.
  if (!DOC_NAMES.has(name)) return err(404, "Doc not found");
  const fp = path.join(DOCS_MD_DIR, name);
  if (!fs.existsSync(fp)) return err(404, "Doc not found on disk");
  return json({ name, content: fs.readFileSync(fp, "utf-8") });
});
