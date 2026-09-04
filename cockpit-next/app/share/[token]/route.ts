import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { pub, pyNone, fmt2 } from "@/server/pub";

const html = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

export const GET = pub(async (_req: NextRequest, ctx: any) => {
  const { token } = await ctx.params;
  const link: any = db().prepare("SELECT * FROM shared_links WHERE token=?").get(token);
  if (!link) return html("<h1>Link not found or expired</h1>", 404);

  const { section, year, label } = link;
  let rows: any[], total: number, tableRows = "";
  if (section === "accounting") {
    rows = db().prepare("SELECT * FROM company_docs WHERE substr(doc_date,1,4)=? ORDER BY doc_date").all(String(year));
    total = rows.reduce((s, r) => s + r.amount, 0);
    for (const r of rows) {
      const fileLink = r.doc_file != null ? `<a href="/share/${token}/file/accounting/${r.id}">View</a>` : "-";
      tableRows += `<tr>
                <td>${r.doc_date}</td>
                <td><strong>${r.vendor}</strong></td>
                <td>${pyNone(r.description)}</td>
                <td>${pyNone(r.category)}</td>
                <td style="text-align:right;font-family:monospace">${r.currency} ${fmt2(r.amount)}</td>
                <td>${fileLink}</td>
            </tr>`;
    }
  } else {
    rows = db().prepare("SELECT * FROM expenses WHERE substr(expense_date,1,4)=? ORDER BY expense_date").all(String(year));
    total = rows.reduce((s, r) => s + r.amount, 0);
    for (const r of rows) {
      const fileLink = r.scan_file != null ? `<a href="/share/${token}/file/expenses/${r.id}">View</a>` : "-";
      tableRows += `<tr>
                <td>${r.expense_date}</td>
                <td>${pyNone(r.description)}</td>
                <td>${pyNone(r.category)}</td>
                <td style="text-align:right;font-family:monospace">CHF ${fmt2(r.amount)}</td>
                <td>${fileLink}</td>
            </tr>`;
    }
  }

  const headers = section === "accounting"
    ? `<th>Date</th><th>Vendor</th><th>Description</th><th>Category</th><th style='text-align:right'>Amount</th><th>File</th>`
    : `<th>Date</th><th>Description</th><th>Category</th><th style='text-align:right'>Amount (CHF)</th><th>File</th>`;
  const zipLink = section === "accounting"
    ? `<a href="/share/${token}/zip" style="display:inline-block;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">Download ZIP</a>`
    : "";

  const page = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${label} - Muster Consulting GmbH</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f1f5f9; color: #0f172a; }
.container { max-width: 960px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 4px; }
.subtitle { color: #64748b; font-size: 14px; margin-bottom: 20px; }
.card { background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
td { padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
tr:last-child td { border-bottom: none; }
tr:hover { background: #f8fafc; }
a { color: #3b82f6; text-decoration: none; }
a:hover { text-decoration: underline; }
.summary { display: flex; justify-content: space-between; align-items: center; padding: 16px; margin-bottom: 16px; }
.total { font-size: 18px; font-weight: 700; }
.readonly-banner { background: #fef3c7; color: #92400e; padding: 10px 16px; border-radius: 6px; font-size: 13px; text-align: center; margin-bottom: 16px; }
@media (max-width: 768px) { .card { overflow-x: auto; } table { min-width: 500px; } }
</style>
</head><body>
<div class="container">
<div class="readonly-banner">&#128274; Read-only view &middot; You can view and download files but not modify any data.</div>
<h1>${label}</h1>
<p class="subtitle">Muster Consulting GmbH &middot; ${rows.length} document${rows.length !== 1 ? "s" : ""}</p>
<div class="summary">
<span class="total">Total: CHF ${fmt2(total)}</span>
${zipLink}
</div>
<div class="card">
<table><thead><tr>${headers}</tr></thead><tbody>${tableRows}</tbody></table>
</div>
<p style="margin-top:20px;color:#94a3b8;font-size:12px">Shared by Muster Consulting GmbH</p>
</div></body></html>`;
  return html(page);
});
