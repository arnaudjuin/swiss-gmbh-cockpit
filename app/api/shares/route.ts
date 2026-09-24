import { NextRequest } from "next/server";
import crypto from "crypto";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare("SELECT * FROM shared_links ORDER BY created_at DESC").all();
  return json(rows.map(r => ({
    id: r.id, token: r.token, section: r.section, year: r.year,
    label: r.label, created_at: r.created_at,
  })));
});

export const POST = guard(async (req: NextRequest) => {
  const data = await req.json();
  if (data.section !== "accounting" && data.section !== "expenses")
    return err(400, "Section must be 'accounting' or 'expenses'");
  const token = crypto.randomBytes(16).toString("base64url");
  const label = data.label || `${String(data.section).charAt(0).toUpperCase()}${String(data.section).slice(1)} ${data.year}`;
  db().prepare("INSERT INTO shared_links (token, section, year, label) VALUES (?,?,?,?)")
    .run(token, data.section, data.year, label);
  return json({ token, url: `/share/${token}` });
});
