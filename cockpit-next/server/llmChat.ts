// Shared /api/llm logic — port of routes/llm.py: question classification,
// knowledge base, tool-pick JSON extraction, arg coercion, result trimming.
import fs from "fs";
import path from "path";
import { todayISO } from "./db";
import { DOCS_MD_DIR } from "./docsMeta";
import { TOOLS, buildToolsPrompt } from "./llmTools";
import type { ChatMessage } from "./llm";

const KB_FILES = ["PAYROLL_NOTES.md", "FEATURES.md", "GUIDE.md", "AI_CHAT.md",
  "FORMULAS.md", "ACCOUNTING_TASKS.md", "SECURITY.md", "TAB_BANK_STATEMENTS.md"];

let kbCache: { text: string | null; loadedAt: number } = { text: null, loadedAt: 0 };

export function getKb(): string {
  const now = Date.now() / 1000;
  if (kbCache.text == null || now - kbCache.loadedAt > 60) {
    const chunks: string[] = [];
    for (const fname of KB_FILES) {
      const fp = path.join(DOCS_MD_DIR, fname);
      if (!fs.existsSync(fp)) continue;
      try {
        let content = fs.readFileSync(fp, "utf-8");
        if (content.length > 6000) content = content.slice(0, 6000) + "\n...[truncated]";
        chunks.push(`# === ${fname} ===\n${content}`);
      } catch { /* skip */ }
    }
    kbCache = { text: chunks.join("\n\n"), loadedAt: now };
  }
  return kbCache.text!;
}

const KNOWLEDGE_SIGNALS = ["how does", "how is", "what is", "what are", "explain",
  "tell me about", "ktg", "bvg", "tariff", "what's the rate",
  "what does", "why ", "how do i ", "where is "];
const DATA_SIGNALS = ["show", "list", "how much", "how many", "total", "sum",
  "balance", "this year", "last year", "ytd", "runway",
  "overdue", "due", "spent", "income"];

export function classifyQuestion(question: string): "data" | "knowledge" {
  const q = question.toLowerCase();
  if (DATA_SIGNALS.some(s => q.includes(s))) return "data";
  if (KNOWLEDGE_SIGNALS.some(s => q.includes(s))) return "knowledge";
  return "data";
}

// Find the first balanced {...} block in text (string-aware).
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function stripFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.split("\n").slice(1).join("\n");
    const idx = t.lastIndexOf("```");
    if (idx >= 0) t = t.slice(0, idx);
    t = t.trim();
    if (t.startsWith("json\n")) t = t.slice(5);
  }
  return t;
}

// Filter args to the tool's declared params + coerce by type-hint prefix.
export function coerceArgs(toolName: string, args: Record<string, any>): Record<string, any> {
  const allowed = TOOLS[toolName].params;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!(k in allowed)) continue;
    const hint = allowed[k].toLowerCase();
    if (v == null || v === "") continue;
    try {
      if (hint.startsWith("int")) {
        if (typeof v === "boolean") { out[k] = v; continue; }
        const n = typeof v === "number" ? Math.trunc(v) : parseInt(String(v), 10);
        if (!Number.isFinite(n)) continue;
        out[k] = n;
      } else if (hint.startsWith("float")) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        out[k] = n;
      } else if (hint.startsWith("string")) {
        out[k] = String(v);
      } else {
        out[k] = v;
      }
    } catch { continue; }
  }
  return out;
}

// Trim long row arrays so the formatting prompt stays small.
export function compactResult(result: any): any {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return result;
  const compact: Record<string, any> = {};
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v) && v.length > 30) {
      compact[k] = v.slice(0, 30);
      compact[`_${k}_truncated`] = `${v.length - 30} more`;
    } else {
      compact[k] = v;
    }
  }
  return compact;
}

export function dataSystemPrompt(): string {
  return `You are a financial assistant for Muster Consulting GmbH (Swiss). Today is ${todayISO()}.\n\n` +
    buildToolsPrompt() + "\n\n" +
    "Respond with ONLY a JSON object on a single line:\n" +
    '{"tool": "tool_name", "args": {"key": value, ...}}\n\n' +
    "Pick the most appropriate tool. Use sensible defaults for omitted optional args. " +
    "If the user asks about a year and it's ambiguous, default to the current year.";
}

export function knowledgeSystemPrompt(): string {
  return `You are a financial assistant for Muster Consulting GmbH. Today is ${todayISO()}.\n` +
    "Answer the user's question using the reference documentation below. " +
    "Be concise (1-3 sentences). If the answer isn't in the docs, say so.\n\n" +
    "=== REFERENCE DOCS ===\n" + getKb();
}

export function lastUserQuestion(history: ChatMessage[], question: string): string {
  if (question) return question;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return String(history[i].content ?? "").trim();
  }
  return "";
}
