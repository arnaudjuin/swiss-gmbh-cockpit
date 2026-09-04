import { NextRequest, NextResponse } from "next/server";
import { guard, err } from "@/server/http";
import { todayISO } from "@/server/db";
import { chat, chatStream, LLMError, ChatMessage } from "@/server/llm";
import { TOOLS, buildToolsPrompt } from "@/server/llmTools";
import { classifyQuestion, extractJsonObject, coerceArgs, compactResult,
  getKb, knowledgeSystemPrompt } from "@/server/llmChat";

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function sseResponse(gen: AsyncGenerator<string>): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await gen.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
  });
  return new NextResponse(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  } });
}

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const history: ChatMessage[] = body.messages || [];
  const question = String(body.question ?? "").trim();
  if (!question) return err(400, "Empty question");

  const today = todayISO();
  const mode = classifyQuestion(question);
  let msgs = history.length ? history : [{ role: "user", content: question }];

  if (mode === "knowledge") {
    const system = knowledgeSystemPrompt().replace(
      /Answer the user's question[\s\S]*?=== REFERENCE DOCS ===/,
      "Use the docs below to answer concisely.\n\n=== DOCS ===");
    void system;
    const kbSystem = `You are a financial assistant for Muster Consulting GmbH. Today is ${today}.\n` +
      "Use the docs below to answer concisely.\n\n=== DOCS ===\n" + getKb();
    async function* genKnowledge() {
      yield sse("meta", { mode: "knowledge" });
      try {
        for await (const chunk of chatStream(msgs, kbSystem, 400, 0.2)) {
          yield sse("token", { text: chunk });
        }
      } catch (e) {
        yield sse("error", { error: e instanceof Error ? e.message : String(e) });
      }
      yield "event: done\ndata: {}\n\n";
    }
    return sseResponse(genKnowledge());
  }

  // Data mode: pick + run the tool synchronously, then stream the phrasing.
  let toolPick: string;
  try {
    toolPick = await chat(msgs,
      `You are a financial assistant. Today is ${today}.\n` + buildToolsPrompt() +
      '\n\nRespond with ONLY {"tool": "...", "args": {...}}.',
      200, 0.0);
  } catch (e) {
    if (e instanceof LLMError) return err(503, `LLM unreachable: ${e.message}`);
    throw e;
  }

  const jsonText = extractJsonObject(toolPick);
  if (!jsonText) {
    return new NextResponse(sse("error", { error: "Model did not return JSON" }),
      { headers: { "Content-Type": "text/event-stream" } });
  }
  let toolName = "", args: Record<string, any> = {}, result: any;
  try {
    const parsed = JSON.parse(jsonText);
    toolName = parsed.tool;
    args = parsed.args || {};
    result = TOOLS[toolName].fn(coerceArgs(toolName, args));
  } catch (e) {
    return new NextResponse(
      sse("error", { error: e instanceof Error ? e.message : String(e), tool_pick: toolPick }),
      { headers: { "Content-Type": "text/event-stream" } });
  }

  const preview = JSON.stringify(compactResult(result)).slice(0, 4000);
  msgs = [{
    role: "user",
    content: `Question: ${question}\nTool used: ${toolName}(${JSON.stringify(args)})\nResult:\n${preview}\n\n` +
      "Give a concise 1-3 sentence answer in plain English. Use CHF formatting. No markdown.",
  }];

  async function* gen() {
    yield sse("meta", { mode: "data", tool: toolName, args, result });
    try {
      for await (const chunk of chatStream(msgs, null, 200, 0.3)) {
        yield sse("token", { text: chunk });
      }
    } catch (e) {
      yield sse("error", { error: e instanceof Error ? e.message : String(e) });
    }
    yield "event: done\ndata: {}\n\n";
  }
  return sseResponse(gen());
});
