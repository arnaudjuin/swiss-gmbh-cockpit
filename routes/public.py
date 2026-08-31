"""Quick-add mobile receipt page + Google Sheets CSV exports.

Mounted at root (no prefix) by app.py because routes are /quick and /share/*.
"""

import calendar
import csv
import io
from datetime import date

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, Response

from db import get_db

router = APIRouter(tags=["public"])

# Active sessions ref (passed by app.py for token check)
_ctx = {}

def configure(active_sessions):
    _ctx["sessions"] = active_sessions


@router.get("/quick", response_class=HTMLResponse)
async def quick_add_page(request: Request):
    """Simplified mobile page for snapping receipts. Requires session token."""
    token = request.cookies.get("session") or request.query_params.get("token")
    if not token or token not in _ctx["sessions"]:
        return HTMLResponse("""
            <!DOCTYPE html><html><head><title>Login required</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body{font-family:-apple-system,sans-serif;padding:40px;text-align:center}</style>
            </head><body>
            <h2>Login required</h2>
            <p>Open the main app first, then return here.</p>
            <a href="/">Go to app</a>
            </body></html>
        """, status_code=401)

    html = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>Quick Add</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#0f172a;padding:16px;min-height:100vh}
h1{font-size:20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
h1 a{color:#64748b;text-decoration:none;font-size:14px}
.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
label{display:block;font-size:13px;font-weight:600;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em}
input,select{width:100%;padding:14px;font-size:17px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;-webkit-appearance:none}
input:focus,select:focus{outline:none;border-color:#3b82f6}
.row{margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tabs{display:flex;gap:8px;margin-bottom:16px;background:#e2e8f0;padding:4px;border-radius:8px}
.tab{flex:1;text-align:center;padding:10px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;color:#64748b}
.tab.active{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(0,0,0,0.05)}
.photo-btn{display:block;width:100%;padding:40px;border:2px dashed #cbd5e1;border-radius:8px;text-align:center;color:#64748b;font-size:15px;cursor:pointer;background:#f8fafc;position:relative}
.photo-btn input{position:absolute;inset:0;opacity:0}
.photo-btn.has-file{border-color:#10b981;background:#ecfdf5;color:#065f46}
.submit{display:block;width:100%;padding:16px;background:#3b82f6;color:#fff;border:0;border-radius:8px;font-size:17px;font-weight:600;margin-top:8px;cursor:pointer}
.submit:active{background:#2563eb}
.toast{position:fixed;bottom:20px;left:16px;right:16px;padding:14px;border-radius:8px;color:#fff;font-weight:500;text-align:center;transform:translateY(100px);opacity:0;transition:all 0.3s;z-index:1000}
.toast.show{transform:translateY(0);opacity:1}
.toast.ok{background:#10b981}.toast.err{background:#ef4444}
</style></head><body>
<h1>📸 Quick Add <a href="/">← Full app</a></h1>

<div class="tabs">
  <div class="tab active" data-mode="expense">Travel expense</div>
  <div class="tab" data-mode="bill">Company bill</div>
</div>

<form id="f">
  <div class="card">
    <div class="row">
      <label>Date</label>
      <input type="date" id="date" required>
    </div>
    <div class="row">
      <label>Amount (CHF)</label>
      <input type="number" id="amount" step="0.01" min="0" required inputmode="decimal">
    </div>
    <div class="row" id="vendor-row" style="display:none">
      <label>Vendor</label>
      <input type="text" id="vendor" placeholder="e.g. Swisscom">
    </div>
    <div class="row">
      <label>Description</label>
      <input type="text" id="description" required>
    </div>
    <div class="grid">
      <div>
        <label>Category</label>
        <select id="category" required></select>
      </div>
      <div id="currency-wrap" style="display:none">
        <label>Currency</label>
        <select id="currency"><option>CHF</option><option>EUR</option><option>USD</option></select>
      </div>
    </div>
  </div>

  <div class="card">
    <label>Photo / PDF</label>
    <label class="photo-btn" id="photo-btn">
      <span id="photo-label">Tap to snap or select</span>
      <input type="file" id="file" accept="image/*,.pdf" capture="environment">
    </label>
  </div>

  <button type="submit" class="submit">Save</button>
</form>

<div id="toast" class="toast"></div>

<script>
const token = new URL(location.href).searchParams.get('token') || localStorage.getItem('session_token');
const EXPENSE_CATS = ['Meals','Transport','Accommodation','Other'];
const BILL_CATS = ['Office Supplies','Software/Subscriptions','Professional Services','Insurance','Rent','Telecom','Legal','Bank Fees','Other'];
let mode = 'expense';

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  const cats = m === 'bill' ? BILL_CATS : EXPENSE_CATS;
  document.getElementById('category').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
  document.getElementById('vendor-row').style.display = m === 'bill' ? 'block' : 'none';
  document.getElementById('currency-wrap').style.display = m === 'bill' ? 'block' : 'none';
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
setMode('expense');
document.getElementById('date').valueAsDate = new Date();

document.getElementById('file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) {
    document.getElementById('photo-btn').classList.add('has-file');
    document.getElementById('photo-label').textContent = '✓ ' + f.name;
  }
});

function toast(msg, ok=true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (ok ? 'ok' : 'err') + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData();
  const file = document.getElementById('file').files[0];
  if (mode === 'expense') {
    fd.append('expense_date', document.getElementById('date').value);
    fd.append('description', document.getElementById('description').value);
    fd.append('amount', document.getElementById('amount').value);
    fd.append('category', document.getElementById('category').value);
    if (file) fd.append('scan', file);
  } else {
    fd.append('doc_date', document.getElementById('date').value);
    fd.append('vendor', document.getElementById('vendor').value);
    fd.append('description', document.getElementById('description').value);
    fd.append('amount', document.getElementById('amount').value);
    fd.append('currency', document.getElementById('currency').value);
    fd.append('category', document.getElementById('category').value);
    fd.append('status', 'unpaid');
    if (file) fd.append('doc', file);
  }
  try {
    const res = await fetch(mode === 'expense' ? '/api/expenses' : '/api/accounting', {
      method: 'POST', body: fd,
      headers: token ? {'Authorization': 'Bearer ' + token} : {},
    });
    if (!res.ok) throw new Error('Save failed');
    toast('Saved ✓');
    document.getElementById('f').reset();
    document.getElementById('date').valueAsDate = new Date();
    document.getElementById('photo-btn').classList.remove('has-file');
    document.getElementById('photo-label').textContent = 'Tap to snap or select';
  } catch (err) { toast(err.message, false); }
});
</script>
</body></html>"""
    return HTMLResponse(html)


def _csv_response(rows: list, headers: list, filename: str):
    import csv, io
    from fastapi.responses import Response
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    for r in rows:
        w.writerow(r)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"inline; filename={filename}",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",  # Allow Google Sheets IMPORTDATA
        },
    )


@router.get("/share/{token}/sheet/invoices.csv")
async def sheet_invoices(token: str):
    with get_db() as db:
        if not db.execute("SELECT id FROM shared_links WHERE token=?", (token,)).fetchone():
            raise HTTPException(404, "Not found")
        rows = db.execute(
            "SELECT * FROM invoices WHERE hours>0 ORDER BY year DESC, month DESC"
        ).fetchall()
    data = [[
        f"{r['invoice_number']:04d}", r["year"], calendar.month_name[r["month"]],
        r["hours"], r["subtotal"], r["tax"], r["total"],
        r["issued_date"], r["due_date"],
        r["paid_status"] if "paid_status" in r.keys() else "",
    ] for r in rows]
    return _csv_response(
        data,
        ["Invoice #", "Year", "Month", "Hours", "Subtotal", "VAT", "Total", "Issued", "Due", "Status"],
        "invoices.csv",
    )


@router.get("/share/{token}/sheet/bills.csv")
async def sheet_bills(token: str):
    with get_db() as db:
        if not db.execute("SELECT id FROM shared_links WHERE token=?", (token,)).fetchone():
            raise HTTPException(404, "Not found")
        rows = db.execute("SELECT * FROM company_docs ORDER BY doc_date DESC").fetchall()
    data = [[
        r["doc_date"], r["vendor"], r["description"],
        r["amount"], r["currency"], r["category"],
        r["due_date"] or "", r["status"],
    ] for r in rows]
    return _csv_response(
        data,
        ["Date", "Vendor", "Description", "Amount", "Currency", "Category", "Due", "Status"],
        "bills.csv",
    )


@router.get("/share/{token}/sheet/expenses.csv")
async def sheet_expenses(token: str):
    with get_db() as db:
        if not db.execute("SELECT id FROM shared_links WHERE token=?", (token,)).fetchone():
            raise HTTPException(404, "Not found")
        rows = db.execute("SELECT * FROM expenses ORDER BY expense_date DESC").fetchall()
    data = [[
        r["expense_date"], r["description"], r["category"],
        r["amount"],
        r["original_amount"] or "", r["original_currency"] or "",
    ] for r in rows]
    return _csv_response(
        data,
        ["Date", "Description", "Category", "Amount (CHF)", "Original", "Original Currency"],
        "expenses.csv",
    )


