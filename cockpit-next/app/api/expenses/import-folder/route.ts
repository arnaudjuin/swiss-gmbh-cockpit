import { NextRequest } from "next/server";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { guard, json, err } from "@/server/http";
import { db, round2 } from "@/server/db";
import { DIRS } from "@/server/files";
import { llmStatus, vision, extractJson, LLM_PROVIDER } from "@/server/llm";

const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png"]);
const AED_TO_CHF = 0.2178;
const CURRENCY_TO_CHF: Record<string, number> = { CHF: 1.0, AED: AED_TO_CHF, USD: 0.88, EUR: 0.94 };
const convertToChf = (amount: number, currency: string) =>
  round2(amount * (CURRENCY_TO_CHF[currency.toUpperCase()] ?? AED_TO_CHF));

const RECEIPT_PROMPT = `Analyze this receipt image and extract the information as JSON.
Return ONLY valid JSON with these exact keys:
{
  "date": "YYYY-MM-DD",
  "description": "Vendor/restaurant name - brief item summary",
  "amount": <total amount as a number>,
  "currency": "AED" or "CHF" or "USD" or "EUR" or the 3-letter currency code,
  "category": "Meals" or "Transport" or "Accommodation" or "Other"
}
Rules:
- Use the TOTAL / Grand Total amount (the final amount paid).
- For currency, use the currency shown on the receipt. Default to AED if unclear.
- For the date, use the date printed on the receipt.
- For description, start with the venue name then a dash and a short summary of items.
- Category: food/drinks = Meals, taxi/flight/fuel = Transport, hotel = Accommodation, else Other.`;

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

function isDuplicateScan(fileHash: string): boolean {
  if (!fs.existsSync(DIRS.scans)) return false;
  for (const name of fs.readdirSync(DIRS.scans)) {
    const fp = path.join(DIRS.scans, name);
    if (fs.statSync(fp).isFile() && sha256(fs.readFileSync(fp)) === fileHash) return true;
  }
  return false;
}

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const rawPath = String(body.path ?? "");
  const folder = path.resolve(rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory())
    return err(400, `Folder not found: ${body.path}`);

  const st = await llmStatus();
  if (!st.reachable)
    return err(400, `LLM provider '${LLM_PROVIDER}' not reachable. Check OLLAMA_URL or ANTHROPIC_API_KEY.`);

  const files = fs.readdirSync(folder)
    .filter(n => SUPPORTED_EXT.has(path.extname(n).toLowerCase()) && !n.startsWith("."))
    .sort()
    .map(n => path.join(folder, n));
  if (!files.length) return err(400, "No supported images found (JPG/PNG)");

  const results: any[] = [];
  let duplicates = 0;
  for (const imgPath of files) {
    const name = path.basename(imgPath);
    try {
      const raw = fs.readFileSync(imgPath);
      if (isDuplicateScan(sha256(raw))) {
        duplicates += 1;
        results.push({ file: name, status: "ok", duplicate: true, date: "-",
          description: "Duplicate - skipped", amount: 0, category: "-" });
        continue;
      }
      const extracted = extractJson(await vision(imgPath, RECEIPT_PROMPT));

      const ext = path.extname(imgPath).toLowerCase();
      const scanFilename = `exp_${crypto.randomBytes(5).toString("hex")}${ext}`;
      fs.mkdirSync(DIRS.scans, { recursive: true });
      fs.writeFileSync(path.join(DIRS.scans, scanFilename), raw);

      const expenseDate = extracted.date;
      const description = extracted.description;
      const originalAmount = Number(extracted.amount);
      const currency = String(extracted.currency ?? "AED").toUpperCase();
      const category = extracted.category;
      const amountChf = convertToChf(originalAmount, currency);
      const origAmt = currency !== "CHF" ? originalAmount : null;
      const origCur = currency !== "CHF" ? currency : null;

      const cur = db().prepare(
        `INSERT INTO expenses
           (expense_date, description, amount, category, original_amount, original_currency, scan_file)
         VALUES (?,?,?,?,?,?,?)`
      ).run(expenseDate, description, amountChf, category, origAmt, origCur, scanFilename);

      results.push({ id: Number(cur.lastInsertRowid), file: name, date: expenseDate,
        description, amount: amountChf, category, status: "ok", duplicate: false });
    } catch (e) {
      results.push({ file: name, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const ok = results.filter(r => r.status === "ok" && !r.duplicate).length;
  return json({ imported: ok, total: results.length, duplicates, results });
});
