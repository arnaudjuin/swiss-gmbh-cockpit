"""Serve project markdown documentation behind the auth wall.

Mounted at /api/docs/* by app.py. Available docs are whitelisted so a path-
traversal attempt via ``/api/docs/../../etc/passwd`` resolves to "not in list".
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["docs"])

# Title is what shows up in the sidebar; order matters (display order).
DOCS = [
    {"name": "MANUAL.md",         "title": "User Manual"},
    {"name": "GUIDE.md",          "title": "Setup & API Reference"},
    {"name": "FEATURES.md",       "title": "Feature Reference"},
    {"name": "TAB_BANK_STATEMENTS.md", "title": "Tab · Bank Statements"},
    {"name": "FORMULAS.md",       "title": "Calculations & Formulas"},
    {"name": "AI_CHAT.md",        "title": "AI Chat — How It Works"},
    {"name": "PAYROLL_NOTES.md",   "title": "Swiss Payroll Reference"},
    {"name": "ACCOUNTING_TASKS.md","title": "Accounting Checklist"},
    {"name": "SECURITY.md",        "title": "Security & Data Protection"},
    {"name": "HOSTING.md",         "title": "Hosting & Deployment"},
    {"name": "TEST_PROCEDURE.md",  "title": "Developer Test Procedure"},
]
_NAMES = {d["name"] for d in DOCS}

_paths = {}


def configure(base_dir: Path):
    # All markdown docs moved into docs/ during the 2026-07 project reorg
    _paths["BASE_DIR"] = base_dir / "docs"


@router.get("/docs")
async def list_docs():
    """List available docs with their size + last-modified time."""
    base = _paths["BASE_DIR"]
    out = []
    for d in DOCS:
        fp = base / d["name"]
        if not fp.exists():
            continue
        st = fp.stat()
        out.append({
            "name":       d["name"],
            "title":      d["title"],
            "size_bytes": st.st_size,
            "mtime":      int(st.st_mtime),
        })
    return out


@router.get("/docs/{name}")
async def get_doc(name: str):
    """Return the raw markdown text of a whitelisted doc."""
    if name not in _NAMES:
        raise HTTPException(404, "Doc not found")
    fp = _paths["BASE_DIR"] / name
    if not fp.exists():
        raise HTTPException(404, "Doc not found on disk")
    return {"name": name, "content": fp.read_text()}
