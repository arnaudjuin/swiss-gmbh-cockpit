import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { guard } from "@/server/http";
import { db, DB_PATH, todayISO } from "@/server/db";
import { DIRS, contentDisposition } from "@/server/files";

const DOCS_DIR = path.resolve(DIRS.accounting, "..");
const BASE_DIR = path.resolve(DOCS_DIR, "..");

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) yield* walk(fp);
    else if (st.isFile()) yield fp;
  }
}

export const GET = guard(async () => {
  // ZIP the database + all documents. The archive itself lands in
  // documents/backups/ (skipped while zipping to avoid nesting).
  const backupsDir = path.join(DOCS_DIR, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  // Checkpoint WAL so the copied DB file is complete on its own.
  try { db().pragma("wal_checkpoint(TRUNCATE)"); } catch {}

  const zip = new JSZip();
  if (fs.existsSync(DB_PATH)) zip.file("invoices.db", fs.readFileSync(DB_PATH), { createFolders: false });
  for (const fp of walk(DOCS_DIR)) {
    if (fp.startsWith(backupsDir + path.sep)) continue;
    zip.file(path.relative(BASE_DIR, fp), fs.readFileSync(fp), { createFolders: false });
  }
  const buf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Retention: keep the newest 3 backups (a 300 MB daily zip fills a disk fast).
  const existing = fs.readdirSync(backupsDir).filter(n => /_backup_.*\.zip$/.test(n)).sort();
  for (const old of existing.slice(0, Math.max(0, existing.length - 2))) {
    try { fs.unlinkSync(path.join(backupsDir, old)); } catch {}
  }
  const backupName = `cockpit_backup_${todayISO()}.zip`;
  fs.writeFileSync(path.join(backupsDir, backupName), buf);
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(backupName),
  } });
});
