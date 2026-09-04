import { NextRequest } from "next/server";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { statementToDict } from "@/server/bank";
import { DIRS, storeBytes } from "@/server/files";
import { decodeBytes, parseCamt053 } from "@/server/camt";

export const GET = guard(async (req: NextRequest) => {
  const year = req.nextUrl.searchParams.get("year");
  const rows = year
    ? db().prepare("SELECT * FROM bank_statements WHERE substr(period_end,1,4)=? ORDER BY period_end DESC, id DESC").all(year)
    : db().prepare("SELECT * FROM bank_statements ORDER BY period_end DESC, id DESC").all();
  return json(rows.map(statementToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const n = (k: string) => { const v = s(k); return v.trim() === "" ? null : Number(v); };

  // The "xml" slot accepts CAMT.053 XML *or* any other structured export
  // (UBS native CSV, etc.). Only auto-parse when it actually looks like XML.
  let parsed: Record<string, any> = {};
  let xmlName: string | null = null;
  const fileXml = form.get("file_xml") as File | null;
  if (fileXml && fileXml.name) {
    const raw = Buffer.from(await fileXml.arrayBuffer());
    let i = 0;
    while (i < raw.length && [0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x0b].includes(raw[i])) i++;
    if (raw[i] === 0x3c || raw[i] === 0xef) {
      parsed = parseCamt053(decodeBytes(raw));
      if ("error" in parsed) parsed = {};
    }
    xmlName = storeBytes(DIRS.bank, "bank", path.extname(fileXml.name).toLowerCase() || ".bin", raw);
  }
  const filePdf = form.get("file_pdf") as File | null;
  const pdfName = filePdf && filePdf.name
    ? storeBytes(DIRS.bank, "bank", path.extname(filePdf.name).toLowerCase() || ".bin",
        Buffer.from(await filePdf.arrayBuffer()))
    : null;

  // Explicit user input wins, then XML parsed values, then defaults.
  const period_start = s("period_start") || parsed.period_start;
  const period_end = s("period_end") || parsed.period_end;
  if (!period_start || !period_end)
    return err(400, "period_start and period_end are required (either filled in or auto-detected from XML)");
  let opening = n("opening_balance"); if (opening == null && "opening_balance" in parsed) opening = parsed.opening_balance;
  let closing = n("closing_balance"); if (closing == null && "closing_balance" in parsed) closing = parsed.closing_balance;
  let iban = s("iban"); if (!iban && parsed.iban) iban = parsed.iban;
  let currency = s("currency", "CHF") || "CHF";
  if ((!currency || currency === "CHF") && parsed.currency) currency = parsed.currency;

  const cur = db().prepare(
    `INSERT INTO bank_statements
       (bank, account_label, iban, period_start, period_end, statement_type,
        opening_balance, closing_balance, currency,
        statement_file_pdf, statement_file_xml, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(s("bank", "UBS"), s("account_label") || null, iban || null, period_start, period_end,
    s("statement_type", "monthly"), opening, closing, currency, pdfName, xmlName, s("notes") || null);
  return json({ id: Number(cur.lastInsertRowid), parsed_from_xml: Object.keys(parsed).length ? parsed : null });
});
