import fs from "fs";
import path from "path";
import { guard, json } from "@/server/http";
import { DOCS_META, DOCS_MD_DIR } from "@/server/docsMeta";

export const GET = guard(async () => {
  const out = [];
  for (const d of DOCS_META) {
    const fp = path.join(DOCS_MD_DIR, d.name);
    if (!fs.existsSync(fp)) continue;
    const st = fs.statSync(fp);
    out.push({ name: d.name, title: d.title, size_bytes: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
  }
  return json(out);
});
