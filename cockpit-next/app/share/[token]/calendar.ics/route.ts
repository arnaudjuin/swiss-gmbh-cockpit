import { NextRequest, NextResponse } from "next/server";
import { db, todayISO, MONTH_NAME } from "@/server/db";
import { typeLabel } from "@/server/obligations";
import { pub, fmt2 } from "@/server/pub";
import { pyFloat } from "@/server/pycsv";

const esc = (text: string): string => !text ? "" :
  text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function event(uid: string, dt: string, summary: string, description = "",
  categories = "", alarmDays: number | null = 3): string {
  const parts = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${todayISO().replace(/-/g, "")}T000000Z`,
    `DTSTART;VALUE=DATE:${dt}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (description) parts.push(`DESCRIPTION:${esc(description)}`);
  if (categories) parts.push(`CATEGORIES:${esc(categories)}`);
  parts.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT");
  if (alarmDays != null && alarmDays > 0) {
    parts.push("BEGIN:VALARM", `TRIGGER:-P${alarmDays}D`, "ACTION:DISPLAY",
      `DESCRIPTION:${esc(summary)}`, "END:VALARM");
  }
  parts.push("END:VEVENT");
  return parts.join("\r\n");
}

export const GET = pub(async (_req: NextRequest, ctx: any) => {
  const { token } = await ctx.params;
  if (!db().prepare("SELECT * FROM shared_links WHERE token=?").get(token))
    return NextResponse.json({ detail: "Not found" }, { status: 404 });

  const events: string[] = [];
  const today = todayISO();
  const [ty, tm] = today.split("-").map(Number);

  for (const r of db().prepare(
    "SELECT * FROM company_docs WHERE due_date IS NOT NULL AND status='unpaid' ORDER BY due_date").all() as any[]) {
    events.push(event(`cockpit-bill-${r.id}@cockpit`, r.due_date.replace(/-/g, ""),
      `\u{1F4B3} ${r.vendor} — ${r.currency} ${fmt2(r.amount)}`,
      (r.description || "") + `\nCategory: ${r.category}`, "Bills", 3));
  }
  for (const r of db().prepare(
    "SELECT * FROM obligations WHERE due_date IS NOT NULL AND status='unpaid' ORDER BY due_date").all() as any[]) {
    events.push(event(`cockpit-ob-${r.id}@cockpit`, r.due_date.replace(/-/g, ""),
      `\u{1F3DB} ${typeLabel(r.obligation_type)} (${r.period_label}) — CHF ${fmt2(r.amount)}`,
      r.notes || "", "Obligations", 7));
  }
  for (const r of db().prepare(
    "SELECT * FROM invoices WHERE due_date IS NOT NULL AND hours>0 AND paid_status='unpaid'").all() as any[]) {
    events.push(event(`cockpit-inv-${r.id}@cockpit`, r.due_date.replace(/-/g, ""),
      `\u{1F4B0} Invoice #${String(r.invoice_number).padStart(4, "0")} — CHF ${fmt2(r.total)}`,
      `Period: ${MONTH_NAME[r.month]} ${r.year}\nHours: ${pyFloat(r.hours)}`, "Invoices", 3));
  }
  const totalTarget = (db().prepare("SELECT COALESCE(SUM(budgeted),0) as t FROM budget_items").get() as any).t;
  if (totalTarget > 0) {
    let y = ty, m = tm;
    for (let i = 0; i < 12; i++) {
      const ym = `${y}${String(m).padStart(2, "0")}`;
      events.push(event(`cockpit-contrib-${ym}@cockpit`, `${ym}01`,
        `\u{1F4CA} Contribute CHF ${fmt2(totalTarget)} to budget reserves`,
        "Monthly budget contribution day. Open Muster Consulting → Budget Balances → Contribute All.",
        "Budget", 0));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  // Quarterly VAT filing deadlines
  const vat: [string, string][] = [
    [`${ty}-02-28`, `Q4 ${ty - 1}`], [`${ty}-05-31`, `Q1 ${ty}`],
    [`${ty}-08-31`, `Q2 ${ty}`], [`${ty}-11-30`, `Q3 ${ty}`],
    [`${ty + 1}-02-28`, `Q4 ${ty}`],
  ];
  for (const [d, period] of vat) {
    events.push(event(`cockpit-vat-${d}@cockpit`, d.replace(/-/g, ""),
      `\u{1F4CB} VAT filing deadline — ${period}`,
      "Quarterly VAT filing due. Open Muster Consulting → Reports → VAT Tracker.", "VAT", 14));
  }

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "PRODID:-//Muster Consulting GmbH//Finance//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Muster Consulting Finance",
    "X-WR-CALDESC:Dynamic feed: bills, obligations, invoices, budget & VAT reminders",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
  return new NextResponse(ics, { headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": "inline; filename=muster-consulting.ics",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  } });
});
