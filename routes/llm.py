"""LLM chat routes: status, ask, stream.

Mounted at /api/llm/* by app.py.
- /status: provider info + reachability
- /ask: data (tool-calling) or knowledge (docs) query
- /stream: same but Server-Sent Events for token-by-token UI
"""

import json as jsonlib
import re
import time
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/llm", tags=["llm"])

# Injected from app.py at startup
_ctx = {}

def configure(base_dir: Path, tools, build_tools_prompt):
    """tools: dict from llm_tools.build_tools(). build_tools_prompt: callable."""
    _ctx["BASE_DIR"] = base_dir
    _ctx["TOOLS"] = tools
    _ctx["build_tools_prompt"] = build_tools_prompt


def _build_tools_prompt():
    return _ctx["build_tools_prompt"](_ctx["TOOLS"])


def _tools():
    return _ctx["TOOLS"]


def _base_dir():
    return _ctx["BASE_DIR"]


@router.get("/status")
async def llm_status():
    import llm
    return llm.status()


SCHEMA_DESCRIPTION = """You are a SQL assistant for an Muster Consulting GmbH financial tracker (SQLite database).
Answer the user's question by writing a single SELECT query. Return ONLY the SQL.
- Wrap with NO markdown fences and NO commentary.
- Use lowercase SQL keywords.
- Always SELECT (never INSERT/UPDATE/DELETE/DROP/ALTER).
- Use SQLite functions (substr, strftime, date('now'), etc.).

Schema:

invoices(id, invoice_number, year, month, hours, rate, vat_rate, subtotal, tax, total,
  issued_date, due_date, paid_status TEXT 'paid'|'unpaid', paid_date, notes)
  -- expense reports have hours=0; real billable invoices have hours>0

expenses(id, expense_date, description, amount REAL CHF, category TEXT
  'Meals'|'Transport'|'Accommodation'|'Other', original_amount, original_currency, scan_file)

company_docs(id, doc_date, vendor, description, amount, currency, category, due_date,
  status 'paid'|'unpaid', recurrence 'none'|'monthly'|'quarterly'|'yearly')

obligations(id, obligation_type 'ahv'|'bvg_employee'|'bvg_employer'|'corporate_tax_federal'
  |'corporate_tax_cantonal'|'vat'|'other', period_label, period_year, amount,
  due_date, status, notes, recurrence)

income_entries(id, income_date, source, description, amount, currency, category)

account_transfers(id, transfer_date, direction 'personal_to_gmbh'|'gmbh_to_personal',
  amount, currency, description)

budget_items(id, grp 'personal_fixed'|'business_fixed'|'debt'|'needs'|'wants'
  |'business_variable'|'savings', subcategory, budgeted, balance, last_contributed_month)

budget_ledger(id, budget_item_id, entry_date, amount, description,
  kind 'contribute'|'withdraw'|'adjust')

payslips(id, year, month, gross, emp_total_deductions, net_salary, total_employer_cost,
  status, payment_date)

cash_balance(id=1, balance, as_of, notes)

customers(id, name, address, city, country, email, reference)

Today is """ + str(__import__("datetime").date.today()) + "."


def _load_knowledge_base() -> str:
    """Load PAYROLL_NOTES.md and FEATURES.md so the model can answer 'how is KTG split?' etc."""
    kb_files = ["PAYROLL_NOTES.md", "FEATURES.md", "GUIDE.md", "AI_CHAT.md", "FORMULAS.md", "ACCOUNTING_TASKS.md", "SECURITY.md", "TAB_BANK_STATEMENTS.md"]
    chunks = []
    for fname in kb_files:
        # docs moved into docs/ during the 2026-07 project reorg
        fp = _base_dir() / "docs" / fname
        if fp.exists():
            try:
                content = fp.read_text()
                # Cap each file at 6000 chars to keep prompt reasonable
                if len(content) > 6000:
                    content = content[:6000] + "\n...[truncated]"
                chunks.append(f"# === {fname} ===\n{content}")
            except Exception:
                pass
    return "\n\n".join(chunks)


_KB_CACHE = {"text": None, "loaded_at": 0}


def _get_kb():
    import time
    now = time.time()
    if _KB_CACHE["text"] is None or (now - _KB_CACHE["loaded_at"]) > 60:
        _KB_CACHE["text"] = _load_knowledge_base()
        _KB_CACHE["loaded_at"] = now
    return _KB_CACHE["text"]


def _classify_question(question: str) -> str:
    """Returns 'data' if the question needs DB tool calling, 'knowledge' if it's a how-does-it-work question."""
    q = question.lower()
    knowledge_signals = [
        "how does", "how is", "what is", "what are", "explain",
        "tell me about", "ktg", "bvg", "tariff", "what's the rate",
        "what does", "why ", "how do i ", "where is ",
    ]
    data_signals = [
        "show", "list", "how much", "how many", "total", "sum",
        "balance", "this year", "last year", "ytd", "runway",
        "overdue", "due", "spent", "income",
    ]
    if any(s in q for s in data_signals):
        return "data"
    if any(s in q for s in knowledge_signals):
        return "knowledge"
    return "data"  # default


@router.post("/ask")
async def llm_ask(request: Request):
    """Natural-language query.
    - If question is data-oriented → use TOOL CALLING (safer than raw SQL).
    - If question is knowledge-oriented → answer directly from PAYROLL_NOTES/FEATURES/GUIDE docs.
    - Accepts `messages` array for conversation memory: [{role, content}, ...]
    """
    import llm
    import re

    body = await request.json()
    history = body.get("messages") or []
    question = (body.get("question") or "").strip()
    if not question and history:
        # extract last user message
        for m in reversed(history):
            if m.get("role") == "user":
                question = m.get("content", "").strip()
                break
    if not question:
        raise HTTPException(400, "Empty question")

    today = date.today()
    mode = _classify_question(question)

    # ─── Knowledge mode: answer from docs directly ───
    if mode == "knowledge":
        kb = _get_kb()
        kb_system = (
            f"You are a financial assistant for Muster Consulting GmbH. Today is {today}.\n"
            "Answer the user's question using the reference documentation below. "
            "Be concise (1-3 sentences). If the answer isn't in the docs, say so.\n\n"
            "=== REFERENCE DOCS ===\n" + kb
        )
        try:
            answer = llm.chat(
                messages=history if history else [{"role": "user", "content": question}],
                system=kb_system,
                temperature=0.2,
                max_tokens=300,
            ).strip()
        except llm.LLMError as e:
            raise HTTPException(503, f"LLM unreachable: {e}")
        return {
            "question": question, "mode": "knowledge",
            "tool": None, "args": None, "result": None,
            "answer": answer,
        }

    # ─── Data mode: tool calling ───
    system_prompt = (
        f"You are a financial assistant for Muster Consulting GmbH (Swiss). Today is {today}.\n\n"
        + _build_tools_prompt() + "\n\n"
        "Respond with ONLY a JSON object on a single line:\n"
        '{"tool": "tool_name", "args": {"key": value, ...}}\n\n'
        "Pick the most appropriate tool. Use sensible defaults for omitted optional args. "
        "If the user asks about a year and it's ambiguous, default to the current year."
    )

    # 1. Ask LLM to pick a tool — include conversation history for context
    msgs = history if history else [{"role": "user", "content": question}]
    try:
        raw = llm.chat(
            messages=msgs,
            system=system_prompt,
            temperature=0.0,
            max_tokens=200,
        )
    except llm.LLMError as e:
        raise HTTPException(503, f"LLM unreachable: {e}")

    # 2. Parse JSON from the model's response — handle nested objects via bracket matching
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if raw.startswith("json\n"):
            raw = raw[5:]

    def _extract_json_object(text: str) -> str | None:
        """Find the first balanced {...} block in text."""
        start = text.find("{")
        if start < 0:
            return None
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start:i+1]
        return None

    json_text = _extract_json_object(raw)
    if not json_text:
        return {
            "question": question, "error": "Model did not return valid JSON.",
            "raw": raw[:500], "tool": None, "args": None, "result": None, "answer": None,
        }
    try:
        parsed = jsonlib.loads(json_text)
        tool_name = parsed.get("tool")
        args = parsed.get("args", {}) or {}
    except Exception as e:
        return {
            "question": question, "error": f"JSON parse error: {e}",
            "raw": raw[:500], "tool": None, "args": None, "result": None, "answer": None,
        }

    # 3. Execute the tool
    if tool_name not in _tools():
        return {
            "question": question,
            "error": f"Unknown tool: {tool_name}. Available: {list(_tools().keys())}",
            "tool": tool_name, "args": args, "result": None, "answer": None,
        }

    try:
        # Filter args + coerce types based on parameter description hints
        allowed_params = _tools()[tool_name]["params"]
        filtered_args = {}
        for k, v in args.items():
            if k not in allowed_params:
                continue
            type_hint = allowed_params[k].lower()
            try:
                if v is None or v == "":
                    continue
                if type_hint.startswith("int"):
                    filtered_args[k] = int(v) if not isinstance(v, bool) else v
                elif type_hint.startswith("float"):
                    filtered_args[k] = float(v)
                elif type_hint.startswith("string"):
                    filtered_args[k] = str(v)
                else:
                    filtered_args[k] = v
            except (ValueError, TypeError):
                # If coercion fails, skip the arg rather than crash
                continue
        result = _tools()[tool_name]["fn"](**filtered_args)
    except Exception as e:
        return {
            "question": question,
            "error": f"Tool execution error: {str(e)[:200]}",
            "tool": tool_name, "args": args, "result": None, "answer": None,
        }

    # 4. Ask LLM to format the result in plain English (cap row count to keep prompt small)
    answer = None
    try:
        # Trim row arrays to first 30 entries to keep prompt token count sane
        compact = result
        if isinstance(result, dict):
            compact = {}
            for k, v in result.items():
                if isinstance(v, list) and len(v) > 30:
                    compact[k] = v[:30]
                    compact[f"_{k}_truncated"] = f"{len(v) - 30} more"
                else:
                    compact[k] = v
        result_preview = jsonlib.dumps(compact, default=str)
        if len(result_preview) > 4000:
            result_preview = result_preview[:4000] + "...[truncated]"
        answer = llm.chat(
            messages=[{
                "role": "user",
                "content": (
                    f"Question: {question}\n\n"
                    f"Tool used: {tool_name}({args})\n"
                    f"Tool result:\n{result_preview}\n\n"
                    "Give a concise 1-3 sentence answer in plain English. "
                    "Use CHF formatting like 'CHF 1,234.56'. No markdown."
                ),
            }],
            temperature=0.3,
            max_tokens=200,
        ).strip()
    except llm.LLMError:
        pass

    return {
        "question": question,
        "mode": "data",
        "tool": tool_name,
        "args": args,
        "result": result,
        "answer": answer or "Tool executed.",
    }


@router.post("/stream")
async def llm_stream_endpoint(request: Request):
    """Streaming chat — yields tokens as they arrive via Server-Sent Events.
    Used for the formatting/answer step. Tool call is still non-streaming.
    """
    import llm
    from fastapi.responses import StreamingResponse

    body = await request.json()
    history = body.get("messages") or []
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "Empty question")

    today = date.today()
    mode = _classify_question(question)
    msgs = history if history else [{"role": "user", "content": question}]

    if mode == "knowledge":
        system = (
            f"You are a financial assistant for Muster Consulting GmbH. Today is {today}.\n"
            "Use the docs below to answer concisely.\n\n=== DOCS ===\n" + _get_kb()
        )
    else:
        # For data mode, we still need to do non-streaming tool selection first.
        # Then stream the answer formatting. For simplicity, we run the tool first
        # synchronously, then stream the final answer.
        try:
            tool_pick = llm.chat(
                messages=msgs,
                system=(
                    f"You are a financial assistant. Today is {today}.\n"
                    + _build_tools_prompt()
                    + '\n\nRespond with ONLY {"tool": "...", "args": {...}}.'
                ),
                temperature=0.0, max_tokens=200,
            )
        except llm.LLMError as e:
            raise HTTPException(503, f"LLM unreachable: {e}")

        # Parse + execute tool (reuse the same logic — simplified here)
        import re
        def _extract(text):
            start = text.find("{")
            if start < 0: return None
            depth = 0; in_string = False; escape = False
            for i in range(start, len(text)):
                ch = text[i]
                if in_string:
                    if escape: escape = False
                    elif ch == "\\": escape = True
                    elif ch == '"': in_string = False
                else:
                    if ch == '"': in_string = True
                    elif ch == "{": depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0: return text[start:i+1]
            return None

        json_text = _extract(tool_pick)
        if not json_text:
            return StreamingResponse(iter([f"event: error\ndata: {jsonlib.dumps({'error': 'Model did not return JSON'})}\n\n"]),
                                     media_type="text/event-stream")
        try:
            parsed = jsonlib.loads(json_text)
            tool_name = parsed.get("tool")
            args = parsed.get("args", {}) or {}
            allowed = _tools()[tool_name]["params"]
            filt = {}
            for k, v in args.items():
                if k not in allowed: continue
                hint = allowed[k].lower()
                try:
                    if v in (None, ""): continue
                    if hint.startswith("int"): filt[k] = int(v)
                    elif hint.startswith("float"): filt[k] = float(v)
                    elif hint.startswith("string"): filt[k] = str(v)
                    else: filt[k] = v
                except Exception: continue
            result = _tools()[tool_name]["fn"](**filt)
        except Exception as e:
            err = {"error": str(e), "tool_pick": tool_pick}
            return StreamingResponse(iter([f"event: error\ndata: {jsonlib.dumps(err)}\n\n"]),
                                     media_type="text/event-stream")

        # Build prompt for formatting
        compact = result
        if isinstance(result, dict):
            compact = {}
            for k, v in result.items():
                if isinstance(v, list) and len(v) > 30:
                    compact[k] = v[:30]; compact[f"_{k}_truncated"] = f"{len(v) - 30} more"
                else:
                    compact[k] = v
        preview = jsonlib.dumps(compact, default=str)[:4000]
        msgs = [{
            "role": "user",
            "content": f"Question: {question}\nTool used: {tool_name}({args})\nResult:\n{preview}\n\n"
                       "Give a concise 1-3 sentence answer in plain English. Use CHF formatting. No markdown.",
        }]
        system = None

        # First, send the tool meta as an event
        async def gen():
            meta = {"mode": "data", "tool": tool_name, "args": args, "result": result}
            yield f"event: meta\ndata: {jsonlib.dumps(meta, default=str)}\n\n"
            try:
                for chunk in llm.chat_stream(msgs, system=system, max_tokens=200, temperature=0.3):
                    yield f"event: token\ndata: {jsonlib.dumps({'text': chunk})}\n\n"
            except Exception as e:
                yield f"event: error\ndata: {jsonlib.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    # Knowledge mode streaming
    async def gen_knowledge():
        yield f"event: meta\ndata: {jsonlib.dumps({'mode': 'knowledge'})}\n\n"
        try:
            for chunk in llm.chat_stream(msgs, system=system, max_tokens=400, temperature=0.2):
                yield f"event: token\ndata: {jsonlib.dumps({'text': chunk})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {jsonlib.dumps({'error': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"
    return StreamingResponse(gen_knowledge(), media_type="text/event-stream")


