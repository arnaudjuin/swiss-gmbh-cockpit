import { NextRequest } from "next/server";
import { json, err } from "./http";
import { db, round2, todayISO } from "./db";

function monthsElapsed(startIso: string | null): number {
  if (!startIso) return 0;
  const [y, m] = startIso.split("-").map(Number);
  const now = new Date();
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) + 1);
}

export async function reserveMove(req: NextRequest, id: string, kind: "contribute" | "withdraw") {
  const f = await req.formData();
  const amount = Number(f.get("amount"));
  if (!(amount > 0)) return err(400, "Amount must be positive");
  const d = db();
  if (!d.prepare("SELECT 1 FROM reserves WHERE id=?").get(id)) return err(404, "Reserve not found");
  d.prepare("UPDATE reserves SET accumulated_manual = COALESCE(accumulated_manual,0) + ?, updated_at = datetime('now') WHERE id=?")
    .run(kind === "contribute" ? amount : -amount, id);
  d.prepare("INSERT INTO reserve_ledger (reserve_id, entry_date, kind, amount, description) VALUES (?,?,?,?,?)")
    .run(id, todayISO(), kind, amount, String(f.get("description") ?? "") || null);
  const r = d.prepare("SELECT * FROM reserves WHERE id=?").get(id) as any;
  const accrued = round2(monthsElapsed(r.accrual_start) * (r.monthly_accrual || 0) + (r.accumulated_manual || 0));
  const target = r.target_amount || 0;
  return json({ id: r.id, name: r.name, purpose: r.purpose, target_amount: target,
    target_date: r.target_date, monthly_accrual: r.monthly_accrual, accrual_start: r.accrual_start,
    accumulated_manual: r.accumulated_manual, accumulated: accrued,
    remaining: round2(Math.max(0, target - accrued)),
    progress_pct: Math.min(target ? Math.round(1000 * accrued / target) / 10 : 0, 100),
    is_active: !!r.is_active });
}
