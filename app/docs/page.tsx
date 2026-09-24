"use client";
// Docs — reads the same markdown knowledge base the classic viewer, the
// checklist parser and the AI chat use (/docs list + /docs/:name content).
// A sidebar of titles + a rendered content pane. Dependency-free markdown
// renderer (no `marked` in package.json), styled via the shared
// `.markdown-body` rules in app.css so it reads like the classic viewer.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DocMeta { name: string; title: string; size_bytes: number; mtime: number }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline formatting: escape text, then apply code / bold / italic / strike /
// links. Code spans are pulled out first so their contents never pick up
// bold/italic markers.
function inline(src: string): string {
  const codes: string[] = [];
  let s = esc(src).replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^A-Za-z0-9_])_([^_]+?)_(?![A-Za-z0-9_])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, txt: string, url: string) => `<a href="${url}" target="_blank" rel="noreferrer">${txt}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[+i]}</code>`);
}

const isListLine = (l: string) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
const cellAlign = (spec: string): string => {
  const l = spec.startsWith(":"), r = spec.endsWith(":");
  if (l && r) return ' style="text-align:center"';
  if (r) return ' style="text-align:right"';
  return "";
};

// Build a nested <ul>/<ol> from a flat list of items using an indent stack.
function buildList(items: { indent: number; ordered: boolean; text: string }[]): string {
  let out = "";
  const stack: { indent: number; ordered: boolean }[] = [];
  for (const it of items) {
    if (stack.length === 0) {
      stack.push({ indent: it.indent, ordered: it.ordered });
      out += (it.ordered ? "<ol>" : "<ul>") + `<li>${inline(it.text)}`;
    } else {
      const top = stack[stack.length - 1];
      if (it.indent > top.indent) {
        stack.push({ indent: it.indent, ordered: it.ordered });
        out += (it.ordered ? "<ol>" : "<ul>") + `<li>${inline(it.text)}`;
      } else if (it.indent === top.indent) {
        out += `</li><li>${inline(it.text)}`;
      } else {
        while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
          out += "</li>" + (stack.pop()!.ordered ? "</ol>" : "</ul>");
        }
        out += `</li><li>${inline(it.text)}`;
      }
    }
  }
  while (stack.length) out += "</li>" + (stack.pop()!.ordered ? "</ol>" : "</ul>");
  return out;
}

// Block-level markdown → HTML for our own trusted docs. Handles headings
// (h1–h6), fenced code, GFM pipe tables, ordered + nested unordered lists,
// blockquotes, horizontal rules, and paragraphs.
function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").replace(/\t/g, "    ").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const marker = fence[1];
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        buf.push(esc(lines[i]));
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2].replace(/\s+#+\s*$/, ""))}</h${lvl}>`);
      i++; continue;
    }

    // Blockquote (consecutive `>` lines, rendered recursively)
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // GFM pipe table (header row + `---|---` separator)
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(lines[i + 1])) {
      const splitRow = (r: string) =>
        r.replace(/^\s*\|?/, "").replace(/\|?\s*$/, "").split("|").map(c => c.trim());
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]);
      i += 2;
      let html = "<table><thead><tr>";
      headers.forEach((c, k) => { html += `<th${cellAlign(aligns[k] ?? "")}>${inline(c)}</th>`; });
      html += "</tr></thead><tbody>";
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = splitRow(lines[i]);
        html += "<tr>";
        headers.forEach((_, k) => { html += `<td${cellAlign(aligns[k] ?? "")}>${inline(cells[k] ?? "")}</td>`; });
        html += "</tr>";
        i++;
      }
      out.push(html + "</tbody></table>");
      continue;
    }

    // List (ordered / unordered, with nesting + continuation lines)
    if (isListLine(line)) {
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s*$/.test(l)) {
          let j = i + 1;
          while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          if (j < lines.length && isListLine(lines[j])) { i = j; continue; }
          break;
        }
        const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
          i++; continue;
        }
        // continuation line indented under the previous item
        if (/^\s+\S/.test(l) && items.length) {
          items[items.length - 1].text += " " + l.trim();
          i++; continue;
        }
        break;
      }
      out.push(buildList(items));
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) { i++; continue; }

    // Paragraph — gather until a blank line or the start of another block
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" &&
           !/^\s*(```|~~~)/.test(lines[i]) &&
           !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) &&
           !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
           !isListLine(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

export default function DocsPage() {
  const [list, setList] = useState<DocMeta[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<DocMeta[]>("/docs").then(d => { setList(d); if (d.length) setSel(d[0].name); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    if (!sel) return;
    api<{ content: string }>(`/docs/${encodeURIComponent(sel)}`).then(d => setContent(d.content)).catch(() => setContent(""));
  }, [sel]);

  if (error) return <div className="notice notice--danger" style={{ margin: 24 }}>{error}</div>;
  if (!list) return <div className="hint" style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="page active">
      <div className="page-header"><h1 className="page-title">Docs</h1></div>
      {list.length === 0 ? (
        <div className="empty-state"><div className="empty-state__icon">📄</div>
          <div className="empty-state__title">No docs</div>
          <p className="hint">No documentation files were found on disk.</p></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, alignItems: "start" }}>
          <div className="table-card" style={{ padding: 8 }}>
            {list.map(d => (
              <button key={d.name} onClick={() => setSel(d.name)}
                className={`btn btn--ghost btn--sm${sel === d.name ? " btn--outline" : ""}`}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }}>
                {d.title}
              </button>
            ))}
          </div>
          <div className="panel" style={{ padding: "16px 22px", minWidth: 0 }}>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          </div>
        </div>
      )}
    </div>
  );
}
