"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Floating "Ask your finances" chat — parity with the classic SPA
// (#ai-chat-fab + #ai-chat-panel in templates/parts/50-dialogs.html). Reuses
// the classic ids/classes, which app.css already styles, so light/dark match.

// ── Types ───────────────────────────────────────────────────────────────────
interface LlmStatus {
  provider: string;
  text_model: string;
  vision_model: string;
  endpoint: string;
  reachable: boolean;
}
interface ToolMeta {
  mode?: string;
  tool?: string | null;
  args?: Record<string, unknown> | null;
  result?: unknown;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  meta?: ToolMeta | null;
  error?: boolean;
}
interface Proposal {
  label: string;
  description: string;
  method: string;
  endpoint: string;
  payload?: Record<string, unknown>;
  format?: "json" | "form";
}

// ── Auth: session_token from localStorage, or ?token= in the URL ─────────────
function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URL(window.location.href).searchParams.get("token");
    if (q) return q;
  } catch { /* ignore */ }
  try { return localStorage.getItem("session_token"); } catch { return null; }
}

const SUGGESTIONS: [string, string][] = [
  ["Runway", "What is my runway?"],
  ["Dashboard", "Show overall dashboard summary"],
  ["Unpaid bills", "List unpaid bills this year"],
  ["Top vendors", "Top 5 vendors I paid this year"],
  ["Reserves", "Show all my reserve balances"],
  ["Travel", "Travel expenses for 2026"],
  ["Obligations", "Unpaid obligations due"],
  ["Payslips", "Payslip totals 2026"],
];

// ── Proposal card: Apply / Discard (fires the real endpoint on Apply) ────────
function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [state, setState] = useState<"idle" | "applying" | "applied" | "discarded" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  if (state === "discarded")
    return <div className="hint" style={{ fontStyle: "italic" }}>Discarded — no change made.</div>;
  if (state === "applied")
    return <div className="notice notice--ok" style={{ marginTop: 10 }}>✓ Applied: {proposal.label}</div>;

  const apply = async () => {
    setState("applying");
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let res: Response;
      if ((proposal.format || "json") === "form") {
        const fd = new FormData();
        for (const [k, v] of Object.entries(proposal.payload || {}))
          if (v !== undefined && v !== null) fd.append(k, String(v));
        res = await fetch(proposal.endpoint, { method: proposal.method, body: fd, headers });
      } else {
        headers["Content-Type"] = "application/json";
        res = await fetch(proposal.endpoint, {
          method: proposal.method, headers, body: JSON.stringify(proposal.payload ?? {}),
        });
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      setState("applied");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  return (
    <div className="proposal-card">
      <div className="proposal-card__head">
        <span className="proposal-card__badge">PROPOSED CHANGE</span>
        <strong>{proposal.label}</strong>
      </div>
      <div className="proposal-card__desc">{proposal.description}</div>
      <div className="proposal-card__meta">
        {proposal.method} {proposal.endpoint} · {JSON.stringify(proposal.payload ?? {})}
      </div>
      <div className="proposal-card__actions">
        {state === "error" && (
          <span style={{ fontSize: 12, color: "var(--danger-text)" }}>Failed: {errMsg}</span>
        )}
        <button className="btn btn--ghost btn--sm" onClick={() => setState("discarded")}
          disabled={state === "applying"}>Discard</button>
        <button className="btn btn--primary btn--sm" onClick={apply} disabled={state === "applying"}>
          {state === "applying" ? "Applying…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

// ── Tool result details (collapsible table / JSON), mirrors the classic ──────
function ToolDetails({ meta }: { meta: ToolMeta }) {
  if (!meta.tool) return null;
  const result = meta.result as any;
  if (result && result._proposal) return <ProposalCard proposal={result._proposal as Proposal} />;

  const argsStr = meta.args
    ? Object.entries(meta.args).map(([k, v]) => `${k}=${v}`).join(", ")
    : "";
  const rows: Record<string, unknown>[] | undefined =
    result && Array.isArray(result.rows) ? result.rows : undefined;
  const cols = rows && rows.length ? Object.keys(rows[0]) : [];

  return (
    <details style={{ marginTop: 8 }}>
      <summary className="hint hint--sm" style={{ cursor: "pointer" }}>
        Tool: {meta.tool}({argsStr})
      </summary>
      {rows && rows.length ? (
        <div className="rows">
          <table>
            <thead>
              <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const v = r[c];
                    const fmt = typeof v === "number"
                      ? v.toLocaleString("de-CH", { maximumFractionDigits: 2 })
                      : (v ?? "");
                    return <td key={c} className="mono">{String(fmt)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : result ? (
        <div className="sql">{JSON.stringify(result, null, 2).slice(0, 800)}</div>
      ) : null}
    </details>
  );
}

// ── Widget ───────────────────────────────────────────────────────────────────
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMsg[]>(messages);
  messagesRef.current = messages;

  const reachable = !!status?.reachable;
  const disabled = statusChecked && !reachable;

  // Small-local-model warning (unreliable tool-calling under ~14B), like classic.
  const warning = (() => {
    if (!status) return null;
    const tag = (status.text_model || "").toLowerCase();
    const isLocal = (status.provider || "").toLowerCase() === "ollama";
    const m = tag.match(/[:\-](\d+(?:\.\d+)?)b\b/);
    const sizeB = m ? parseFloat(m[1]) : null;
    if (isLocal && sizeB !== null && sizeB < 14) return sizeB;
    return null;
  })();

  const updateLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const copy = prev.slice();
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }, []);

  // Status on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch("/api/llm/status", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (alive && res.ok) setStatus(await res.json());
      } catch { /* leave null */ }
      finally { if (alive) setStatusChecked(true); }
    })();
    return () => { alive = false; };
  }, []);

  // Auto-scroll to newest message.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      if (next) setTimeout(() => taRef.current?.focus(), 250);
      return next;
    });
  }, []);

  // Cmd/Ctrl+K toggles the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); toggle(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const clearHistory = () => setMessages([]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || streaming || disabled) return;
    setInput("");

    // Conversation history (bounded), plus the new user turn.
    const history = messagesRef.current
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: question });
    const bounded = history.slice(-12);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);

    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = JSON.stringify({ question, messages: bounded });

    try {
      const res = await fetch("/api/llm/stream", { method: "POST", headers, body: payload });
      if (!res.ok || !res.body) throw new Error("Stream not available");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let meta: ToolMeta | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "message", dataLine = "";
          for (const ln of chunk.split("\n")) {
            if (ln.startsWith("event: ")) event = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) dataLine += ln.slice(6);
          }
          if (!dataLine) continue;
          let obj: any;
          try { obj = JSON.parse(dataLine); } catch { continue; }
          if (event === "meta") {
            meta = obj as ToolMeta;
          } else if (event === "token") {
            answer += obj.text || "";
            updateLast((m) => ({ ...m, content: answer }));
          } else if (event === "error") {
            updateLast((m) => ({ ...m, content: `Error: ${obj.error}`, error: true }));
            setStreaming(false);
            return;
          } else if (event === "done") {
            updateLast((m) => ({ ...m, content: answer, meta }));
            setStreaming(false);
            return;
          }
        }
      }
      // Stream ended without an explicit done event.
      updateLast((m) => ({ ...m, content: answer, meta }));
      setStreaming(false);
    } catch {
      // Fall back to the non-streaming endpoint.
      try {
        const res = await fetch("/api/llm/ask", { method: "POST", headers, body: payload });
        const data: any = await res.json();
        if (data.error) {
          updateLast((m) => ({ ...m, content: `Error: ${data.error}`, error: true }));
        } else {
          updateLast((m) => ({
            ...m,
            content: data.answer || "Done.",
            meta: data.tool ? { tool: data.tool, args: data.args, result: data.result } : null,
          }));
        }
      } catch (e) {
        updateLast((m) => ({
          ...m,
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
          error: true,
        }));
      }
      setStreaming(false);
    }
  }

  const statusText = !statusChecked
    ? "checking…"
    : !status
      ? "unavailable"
      : status.reachable
        ? `${status.provider} · ${status.text_model}`
        : `${status.provider} (not reachable — check ${status.endpoint})`;
  const statusClass = reachable ? "online" : statusChecked ? "offline" : "";

  return (
    <>
      <button id="ai-chat-fab" onClick={toggle} title="Ask AI (Cmd+K)"
        style={{ display: "flex" }}>&#128172;</button>

      <div id="ai-chat-panel" className={open ? "open" : ""}>
        <div className="ai-chat-header">
          <div>
            <h3>Ask your finances</h3>
            <div className={`ai-chat-status ${statusClass}`}>{statusText}</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn btn--ghost btn--icon" onClick={clearHistory}
              title="Clear conversation">&#8634;</button>
            <button className="btn btn--ghost btn--icon" onClick={toggle} title="Close">&times;</button>
          </div>
        </div>

        {warning !== null && (
          <div style={{
            padding: "8px 12px", fontSize: 11, lineHeight: 1.4,
            background: "var(--warn-bg)", borderBottom: "1px solid var(--warn-border)",
            color: "var(--warn-text)",
          }}>
            <b>⚠ Small local model ({warning}B params)</b> — tool-calling under ~14B is unreliable.
            Consider a larger model or <code>LLM_PROVIDER=anthropic</code>.
          </div>
        )}

        <div className="ai-chat-body" id="ai-chat-body" ref={bodyRef}>
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role === "user" ? "user" : "bot"}`}>
              <div className="bubble">
                {m.content
                  ? <span>{m.content}{streaming && i === messages.length - 1 && m.role === "assistant" && !m.error
                      ? <span className="ai-cursor" /> : null}</span>
                  : (m.role === "assistant"
                      ? (streaming && i === messages.length - 1
                          ? <span className="ai-cursor" />
                          : <em>Thinking…</em>)
                      : null)}
                {m.meta ? <ToolDetails meta={m.meta} /> : null}
              </div>
            </div>
          ))}
        </div>

        <div className="ai-suggestions">
          {SUGGESTIONS.map(([label, q]) => (
            <span key={label} className="ai-suggestion" onClick={() => send(q)}>{label}</span>
          ))}
        </div>

        <div className="ai-chat-input">
          <textarea
            ref={taRef}
            id="ai-chat-text"
            value={input}
            placeholder={disabled ? "AI is unavailable" : "Ask anything about your finances..."}
            disabled={disabled || streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button onClick={() => send()} disabled={disabled || streaming}>Ask</button>
        </div>
      </div>
    </>
  );
}
