// File storage/serving — same documents/ tree the Python backend uses.
import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const DOCS = process.env.DOCS_DIR || path.resolve(process.cwd(), "..", "documents");
export const DIRS = {
  accounting: path.join(DOCS, "accounting"),
  invoices: path.join(DOCS, "invoices"),
  payslips: path.join(DOCS, "payslips"),
  bank: path.join(DOCS, "bank_statements"),
  scans: path.join(DOCS, "expenses", "scans"),
  reports: path.join(DOCS, "expenses", "reports"),
};

const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", heic: "image/heic", xml: "application/xml", csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
};

export function serveFile(dir: string, filename: string | null | undefined): NextResponse {
  if (!filename) return NextResponse.json({ detail: "No file" }, { status: 404 });
  const p = path.join(dir, path.basename(filename));
  if (!fs.existsSync(p)) return NextResponse.json({ detail: "File not found" }, { status: 404 });
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const body = new Uint8Array(fs.readFileSync(p));
  return new NextResponse(body, { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
}

// Content-addressed filename, byte-identical to Python helpers.hashed_filename:
// prefix_<sha1[:10]><ext> — same bytes, same name, so re-uploads dedupe across
// both backends.
export function storeBytes(dir: string, prefix: string, ext: string, data: Buffer): string {
  const clean = (ext || ".bin").toLowerCase();
  const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 10);
  const filename = `${prefix}_${hash}${clean.startsWith(".") ? clean : "." + clean}`;
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, filename);
  if (!fs.existsSync(p)) fs.writeFileSync(p, data);
  return filename;
}

export async function saveUpload(file: File | null, dir: string, prefix: string): Promise<string | null> {
  if (!file || !file.size) return null;
  const data = Buffer.from(await file.arrayBuffer());
  return storeBytes(dir, prefix, path.extname(file.name) || ".bin", data);
}

export function deleteStored(dir: string, filename: string | null | undefined) {
  if (!filename) return;
  const p = path.join(dir, path.basename(filename));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Starlette FileResponse content-disposition: RFC 5987 form when the name
// needs quoting (spaces included), plain quoted form otherwise.
export function contentDisposition(filename: string): string {
  const quoted = encodeURIComponent(filename)
    .replace(/[!*'()]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
  return quoted === filename
    ? `attachment; filename="${filename}"`
    : `attachment; filename*=utf-8''${quoted}`;
}
