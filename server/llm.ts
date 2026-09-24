// LLM provider abstraction — port of llm.py.
// Providers: ollama (default, local), anthropic, openai (any compatible endpoint).
// Same environment variables as the Python backend.
import fs from "fs";
import path from "path";

const env = (k: string, d = "") => process.env[k] ?? d;
export const LLM_PROVIDER = env("LLM_PROVIDER", "ollama").toLowerCase();
const OLLAMA_URL = env("OLLAMA_URL", "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_TEXT_MODEL = env("OLLAMA_TEXT_MODEL", "qwen2.5-coder:7b");
const OLLAMA_VISION_MODEL = env("OLLAMA_VISION_MODEL", "llama3.2-vision:11b");
const ANTHROPIC_TEXT_MODEL = env("ANTHROPIC_TEXT_MODEL", "claude-haiku-4-5-20251001");
const ANTHROPIC_VISION_MODEL = env("ANTHROPIC_VISION_MODEL", "claude-sonnet-4-20250514");
const OPENAI_BASE_URL = env("OPENAI_BASE_URL", "https://api.openai.com/v1");
const OPENAI_TEXT_MODEL = env("OPENAI_TEXT_MODEL", "gpt-4o-mini");

export class LLMError extends Error {}

export interface ChatMessage { role: string; content: string }

const resolveTextModel = () =>
  LLM_PROVIDER === "ollama" ? OLLAMA_TEXT_MODEL
  : LLM_PROVIDER === "anthropic" ? ANTHROPIC_TEXT_MODEL : OPENAI_TEXT_MODEL;
const resolveVisionModel = () =>
  LLM_PROVIDER === "ollama" ? OLLAMA_VISION_MODEL
  : LLM_PROVIDER === "anthropic" ? ANTHROPIC_VISION_MODEL : OPENAI_TEXT_MODEL;
const resolveEndpoint = () =>
  LLM_PROVIDER === "ollama" ? OLLAMA_URL
  : LLM_PROVIDER === "anthropic" ? "https://api.anthropic.com" : OPENAI_BASE_URL;

export async function llmStatus() {
  return {
    provider: LLM_PROVIDER,
    text_model: resolveTextModel(),
    vision_model: resolveVisionModel(),
    endpoint: resolveEndpoint(),
    reachable: await ping(),
  };
}

async function ping(): Promise<boolean> {
  try {
    if (LLM_PROVIDER === "ollama") {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return r.status === 200;
    }
    if (LLM_PROVIDER === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
    if (LLM_PROVIDER === "openai") return !!process.env.OPENAI_API_KEY;
  } catch {
    return false;
  }
  return false;
}

const TIMEOUT = 120000;

// ── Text chat ──
export async function chat(messages: ChatMessage[], system: string | null = null,
  maxTokens = 800, temperature = 0.2): Promise<string> {
  if (LLM_PROVIDER === "ollama") {
    const body = {
      model: OLLAMA_TEXT_MODEL,
      messages: (system ? [{ role: "system", content: system }] : []).concat(messages),
      stream: false,
      options: { temperature, num_predict: maxTokens },
    };
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.status !== 200) throw new LLMError(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: any = await r.json();
    return String(data.message?.content ?? "").trim();
  }
  if (LLM_PROVIDER === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LLMError("ANTHROPIC_API_KEY not set");
    const body: any = { model: ANTHROPIC_TEXT_MODEL, max_tokens: maxTokens, temperature, messages };
    if (system) body.system = system;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    });
    if (r.status !== 200) throw new LLMError(`Anthropic error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: any = await r.json();
    return String(data.content[0].text).trim();
  }
  // openai-compatible
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const body = {
    model: OPENAI_TEXT_MODEL,
    messages: (system ? [{ role: "system", content: system }] : []).concat(messages),
    max_tokens: maxTokens, temperature,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
  });
  if (r.status !== 200) throw new LLMError(`OpenAI error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return String(data.choices[0].message.content).trim();
}

// ── Streaming chat — async generator over text chunks ──
async function* readLines(r: Response): AsyncGenerator<string> {
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer) yield buffer;
}

export async function* chatStream(messages: ChatMessage[], system: string | null = null,
  maxTokens = 800, temperature = 0.3): AsyncGenerator<string> {
  if (LLM_PROVIDER === "ollama") {
    const body = {
      model: OLLAMA_TEXT_MODEL,
      messages: (system ? [{ role: "system", content: system }] : []).concat(messages),
      stream: true,
      options: { temperature, num_predict: maxTokens },
    };
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.status !== 200) throw new LLMError(`Ollama stream error ${r.status}`);
    for await (const line of readLines(r)) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const delta = obj.message?.content ?? "";
        if (delta) yield delta;
        if (obj.done) break;
      } catch { continue; }
    }
    return;
  }
  if (LLM_PROVIDER === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LLMError("ANTHROPIC_API_KEY not set");
    const body: any = { model: ANTHROPIC_TEXT_MODEL, max_tokens: maxTokens, temperature, messages, stream: true };
    if (system) body.system = system;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    });
    if (r.status !== 200) throw new LLMError(`Anthropic stream error ${r.status}`);
    for await (const line of readLines(r)) {
      if (!line.startsWith("data: ")) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.type === "content_block_delta") {
          const text = obj.delta?.text ?? "";
          if (text) yield text;
        }
      } catch { continue; }
    }
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const body = {
    model: OPENAI_TEXT_MODEL,
    messages: (system ? [{ role: "system", content: system }] : []).concat(messages),
    max_tokens: maxTokens, temperature, stream: true,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
  });
  if (r.status !== 200) throw new LLMError(`OpenAI stream error ${r.status}`);
  for await (const line of readLines(r)) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") break;
    try {
      const delta = JSON.parse(payload).choices[0].delta?.content ?? "";
      if (delta) yield delta;
    } catch { continue; }
  }
}

// ── Vision (receipt analysis) ──
export async function vision(imagePath: string, prompt: string, maxTokens = 400): Promise<string> {
  if (LLM_PROVIDER === "ollama") {
    const imageB64 = fs.readFileSync(imagePath).toString("base64");
    const body = {
      model: OLLAMA_VISION_MODEL,
      messages: [{ role: "user", content: prompt, images: [imageB64] }],
      stream: false,
      options: { temperature: 0.0, num_predict: maxTokens },
    };
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
    });
    if (r.status !== 200) throw new LLMError(`Ollama vision error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: any = await r.json();
    return String(data.message?.content ?? "").trim();
  }
  if (LLM_PROVIDER === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LLMError("ANTHROPIC_API_KEY not set");
    const imageB64 = fs.readFileSync(imagePath).toString("base64");
    const mediaType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as
      Record<string, string>)[path.extname(imagePath).toLowerCase()] ?? "image/jpeg";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_VISION_MODEL, max_tokens: maxTokens,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    if (r.status !== 200) throw new LLMError(`Anthropic vision error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: any = await r.json();
    return String(data.content[0].text).trim();
  }
  throw new LLMError("Vision not configured for this provider");
}

// Strip markdown fences and parse JSON.
export function extractJson(text: string): any {
  let t = text.trim();
  if (t.startsWith("```")) t = t.split("\n").slice(1).join("\n").replace(/```[^`]*$/, "").trim();
  if (t.startsWith("json\n")) t = t.slice(5);
  return JSON.parse(t);
}
