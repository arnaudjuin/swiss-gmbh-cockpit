"""Parse the accounting-task checklist into structured JSON so the in-app
Test Procedure page can render an interactive checklist (Pass / Fail / Skip +
notes per step).

Default source: ACCOUNTING_TASKS.md (accounting workflows for the GmbH owner).
Pass ?source=technical to parse TEST_PROCEDURE.md instead (developer QA).

Mounted at /api/test-procedure.
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["test-procedure"])

_paths = {}

# Per-source cache. Invalidated by file mtime.
_cache: dict = {}   # {filename: {"mtime": ..., "data": [...]}}

_SOURCES = {
    "accounting": "docs/ACCOUNTING_TASKS.md",
    "technical":  "docs/TEST_PROCEDURE.md",
}


def configure(base_dir: Path):
    _paths["BASE_DIR"] = base_dir


# Regexes — tuned to the patterns used in TEST_PROCEDURE.md / ACCOUNTING_TASKS.md.
_RE_SECTION = re.compile(r"^##\s+§(\d+)\s+(.+?)\s*$")
_RE_TC      = re.compile(r"^###\s+((?:TC|AT)-\d+-\d+[a-z]?):?\s+(.+?)\s*$")
_RE_STEP    = re.compile(r"^(\d+)\.\s+(.+?)\s*$")
_RE_META    = re.compile(r"^\*\*([A-Z][\w\- ]+?):\*\*\s+(.+?)\s*$")
_RE_HRULE   = re.compile(r"^-{3,}\s*$")


def _parse_test_procedure(text: str) -> list:
    """Return [{section, tests: [{id, title, priority, type, preconditions, steps: [...]}]}]."""
    sections = []
    cur_section = None
    cur_tc = None
    cur_step = None
    # Track whether we're inside a 'Steps:' block (vs preamble like Priority/Type lines)
    in_steps = False

    def flush_step():
        nonlocal cur_step
        if cur_step is not None:
            # Clean trailing checkbox lines so the step text is just the test action
            cur_tc["steps"].append(cur_step)
            cur_step = None

    def flush_tc():
        nonlocal cur_tc
        flush_step()
        if cur_tc is not None:
            cur_section["tests"].append(cur_tc)
            cur_tc = None

    def flush_section():
        nonlocal cur_section
        flush_tc()
        if cur_section is not None:
            sections.append(cur_section)
            cur_section = None

    lines = text.split("\n")
    for raw in lines:
        line = raw.rstrip()

        # Horizontal rule resets test-case state but keeps the section.
        if _RE_HRULE.match(line):
            flush_tc()
            in_steps = False
            continue

        m = _RE_SECTION.match(line)
        if m:
            flush_section()
            cur_section = {
                "section_num": int(m.group(1)),
                "section":     m.group(2),
                "tests":       [],
            }
            in_steps = False
            continue

        m = _RE_TC.match(line)
        if m and cur_section is not None:
            flush_tc()
            cur_tc = {
                "id":            m.group(1),
                "title":         m.group(2),
                "priority":      "",
                "type":          "",
                "preconditions": "",
                "steps":         [],
            }
            in_steps = False
            continue

        if cur_tc is None:
            continue

        # Metadata lines (Priority, Type, Pre-conditions) before the Steps block
        m = _RE_META.match(line)
        if m and not in_steps and cur_step is None:
            key, val = m.group(1).lower(), m.group(2)
            if "priority" in key:
                cur_tc["priority"] = val.split("·")[0].strip()
                if "type" in val.lower():
                    type_match = re.search(r"\*\*Type:\*\*\s+(.+)", val, re.I)
                    if type_match:
                        cur_tc["type"] = type_match.group(1).strip()
            elif "type" == key.strip():
                cur_tc["type"] = val
            elif "pre-conditions" in key or "preconditions" in key:
                cur_tc["preconditions"] = val
            continue

        # "**Steps:**" marker
        if line.strip().lower().startswith("**steps:**"):
            in_steps = True
            continue

        # Numbered step — also enters step mode if we hadn't seen "**Steps:**"
        m = _RE_STEP.match(line)
        if m:
            flush_step()
            in_steps = True
            cur_step = {
                "num":      int(m.group(1)),
                "text":     m.group(2),
                "expected": "",
                "details":  [],
            }
            continue

        # If we hit content before any explicit step, synthesize step 1.
        # Covers TCs that are just "code block + Expected" without a numbered list.
        stripped = line.strip()
        if cur_step is None and stripped and not stripped.startswith("**"):
            in_steps = True
            cur_step = {
                "num":      1,
                "text":     "Run the test",
                "expected": "",
                "details":  [],
            }
            # Fall through so this line gets captured below

        # Continuation lines for the current step
        if cur_step is not None:
            if not stripped:
                # Blank line — keep it in details for readability
                cur_step["details"].append("")
                continue
            # "- **Expected:** ..."
            if stripped.startswith("- **Expected:**"):
                cur_step["expected"] = stripped[len("- **Expected:**"):].strip()
                continue
            if stripped.startswith("**Expected:**"):
                cur_step["expected"] = stripped[len("**Expected:**"):].strip()
                continue
            # "- [ ] Pass [ ] Fail · Notes: ____" — skip, the UI provides this
            if stripped.startswith("- [ ] Pass") or stripped.startswith("[ ] Pass"):
                continue
            # Anything else (code blocks, tables, bullets): keep raw for context
            cur_step["details"].append(line)

    flush_section()
    # Remove empty sections / tests
    sections = [s for s in sections if s["tests"]]
    for s in sections:
        for t in s["tests"]:
            # Join multi-line details into a single string
            for step in t["steps"]:
                step["details"] = "\n".join(step["details"]).strip()
    return sections


def _load(source: str) -> dict:
    filename = _SOURCES.get(source) or _SOURCES["accounting"]
    fp = _paths["BASE_DIR"] / filename
    if not fp.exists():
        raise HTTPException(404, f"{filename} not found")
    mtime = fp.stat().st_mtime
    entry = _cache.get(filename)
    if not entry or entry["mtime"] != mtime:
        entry = {"mtime": mtime, "data": _parse_test_procedure(fp.read_text())}
        _cache[filename] = entry
    sections = entry["data"]
    total_tests = sum(len(s["tests"]) for s in sections)
    total_steps = sum(len(t["steps"]) for s in sections for t in s["tests"])
    return {
        "source":      source,
        "filename":    filename,
        "sections":    sections,
        "total_tests": total_tests,
        "total_steps": total_steps,
        "mtime":       int(mtime),
    }


@router.get("/test-procedure")
async def get_test_procedure(source: str = Query("accounting", pattern="^(accounting|technical)$")):
    return _load(source)
