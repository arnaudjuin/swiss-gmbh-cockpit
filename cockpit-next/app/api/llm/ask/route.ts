import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { chat, LLMError, ChatMessage } from "@/server/llm";
import { TOOLS } from "@/server/llmTools";
import { classifyQuestion, extractJsonObject, stripFences, coerceArgs,
  compactResult, dataSystemPrompt, knowledgeSystemPrompt, lastUserQuestion } from "@/server/llmChat";

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const history: ChatMessage[] = body.messages || [];
  const question = lastUserQuestion(history, String(body.question ?? "").trim());
  if (!question) return err(400, "Empty question");

  const mode = classifyQuestion(question);
  const msgs = history.length ? history : [{ role: "user", content: question }];

  // ── Knowledge mode: answer from docs directly ──
  if (mode === "knowledge") {
    let answer: string;
    try {
      answer = (await chat(msgs, knowledgeSystemPrompt(), 300, 0.2)).trim();
    } catch (e) {
      if (e instanceof LLMError) return err(503, `LLM unreachable: ${e.message}`);
      throw e;
    }
    return json({ question, mode: "knowledge", tool: null, args: null, result: null, answer });
  }

  // ── Data mode: tool calling ──
  let raw: string;
  try {
    raw = await chat(msgs, dataSystemPrompt(), 200, 0.0);
  } catch (e) {
    if (e instanceof LLMError) return err(503, `LLM unreachable: ${e.message}`);
    throw e;
  }
  raw = stripFences(raw);
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return json({ question, error: "Model did not return valid JSON.",
      raw: raw.slice(0, 500), tool: null, args: null, result: null, answer: null });
  }
  let toolName: string, args: Record<string, any>;
  try {
    const parsed = JSON.parse(jsonText);
    toolName = parsed.tool;
    args = parsed.args || {};
  } catch (e) {
    return json({ question, error: `JSON parse error: ${e instanceof Error ? e.message : e}`,
      raw: raw.slice(0, 500), tool: null, args: null, result: null, answer: null });
  }
  if (!(toolName in TOOLS)) {
    return json({ question,
      error: `Unknown tool: ${toolName}. Available: ${JSON.stringify(Object.keys(TOOLS)).replace(/","/g, "', '").replace(/\["/, "['").replace(/"\]/, "']")}`,
      tool: toolName, args, result: null, answer: null });
  }

  let result: any;
  try {
    result = TOOLS[toolName].fn(coerceArgs(toolName, args));
  } catch (e) {
    return json({ question,
      error: `Tool execution error: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`,
      tool: toolName, args, result: null, answer: null });
  }

  // Ask the LLM to phrase the result in plain English.
  let answer: string | null = null;
  try {
    let preview = JSON.stringify(compactResult(result));
    if (preview.length > 4000) preview = preview.slice(0, 4000) + "...[truncated]";
    answer = (await chat([{
      role: "user",
      content: `Question: ${question}\n\n` +
        `Tool used: ${toolName}(${JSON.stringify(args)})\n` +
        `Tool result:\n${preview}\n\n` +
        "Give a concise 1-3 sentence answer in plain English. " +
        "Use CHF formatting like 'CHF 1,234.56'. No markdown.",
    }], null, 200, 0.3)).trim();
  } catch (e) {
    if (!(e instanceof LLMError)) throw e;
  }

  return json({ question, mode: "data", tool: toolName, args, result,
    answer: answer || "Tool executed." });
});
