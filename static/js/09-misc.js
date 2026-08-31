// 09-misc.js — budget balances, inline toggles, vendor suggest, bulk upload, drag-drop, keyboard, backup, recurring, AI chat, calendar, init
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// ══════════════════════════════════════════════════════════════════════════════
// INLINE BILL STATUS TOGGLE
// ══════════════════════════════════════════════════════════════════════════════

let pendingPayment = null;
let pendingPaymentType = null; // 'bill' | 'obligation'

async function toggleBillStatus(id, currentStatus) {
  const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';

  if (newStatus === 'unpaid') {
    try {
      await api(`/accounting/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: 'unpaid'}) });
      toast('Bill marked unpaid');
      loadAccountingDocs();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }

  // Marking as paid: ask payment source
  const bill = allAccountingDocs.find(b => b.id === id);
  if (!bill) return;
  pendingPayment = bill;
  pendingPaymentType = 'bill';

  document.getElementById('payment-source-info').innerHTML =
    `<strong>${bill.vendor}</strong> · ${bill.currency} ${bill.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}`;

  // Populate reserve picker with current balances
  let suggested = null;   // 'g:<id>'
  try {
    const gmbh = await api('/reserves').catch(() => []);
    const sel = document.getElementById('reserve-picker');
    const searchTerms = [bill.vendor, bill.description, bill.category].filter(Boolean).map(s => s.toLowerCase());
    const KEYWORDS = {'equipment': ['laptop', 'macbook', 'computer', 'hardware', 'office supplies', 'phone', 'airpods', 'galaxus', 'interdiscount'],
                      'obligation': ['steuer', 'tax', 'ahv', 'bvg', 'axa', 'vat', 'treuhand']};
    const gMatch = gmbh.find(r => {
      const name = r.name.toLowerCase();
      const kw = Object.entries(KEYWORDS).find(([k]) => name.includes(k));
      return searchTerms.some(t => name.includes(t) || t.includes(name)
        || (kw && kw[1].some(w => t.includes(w))));
    });
    if (gMatch) suggested = `g:${gMatch.id}`;
    sel.innerHTML = gmbh.filter(r => r.accumulated > 0).map(r =>
      `<option value="g:${r.id}" ${suggested === `g:${r.id}` ? 'selected' : ''}>${r.name} — earmarked ${chf(r.accumulated)}${suggested === `g:${r.id}` ? ' ★ suggested' : ''}</option>`).join('');
  } catch {}

  // Reset dialog state — if we have a suggested reserve, preselect "reserve"
  document.querySelectorAll('input[name="pay-source"]').forEach(r => r.checked = false);
  if (suggested) {
    document.querySelector('input[name="pay-source"][value="reserve"]').checked = true;
    document.getElementById('reserve-picker-wrap').style.display = 'block';
  } else {
    document.querySelector('input[name="pay-source"][value="cash"]').checked = true;
    document.getElementById('reserve-picker-wrap').style.display = 'none';
  }
  document.getElementById('payment-source-dialog').classList.add('show');
}

function selectPaymentSource(source) {
  document.querySelector(`input[name="pay-source"][value="${source}"]`).checked = true;
  document.getElementById('reserve-picker-wrap').style.display = source === 'reserve' ? 'block' : 'none';
}

function closePaymentSource() {
  document.getElementById('payment-source-dialog').classList.remove('show');
  pendingPayment = null;
}

async function confirmPayment() {
  if (!pendingPayment) return;
  const source = document.querySelector('input[name="pay-source"]:checked').value;
  const item = pendingPayment;
  const type = pendingPaymentType;

  try {
    // Mark as paid (bill or obligation)
    const statusUrl = type === 'obligation'
      ? `/obligations/${item.id}/status`
      : `/accounting/${item.id}/status`;
    await api(statusUrl, { method: 'PATCH', body: JSON.stringify({status: 'paid'}) });

    // If paying from reserve, deduct from the selected budget
    if (source === 'reserve') {
      const picked = document.getElementById('reserve-picker').value;
      if (picked) {
        const today = new Date().toISOString().slice(0, 10);
        const amount = item.amount;
        const label = type === 'obligation'
          ? `Paid ${item.type_label || 'obligation'}: ${item.period_label || ''}`.trim()
          : `Paid ${item.vendor}: ${item.description || ''}`.trim();
        const fd = new FormData();
        fd.append('amount', amount);
        fd.append('description', label);
        const res = await fetch(`/api/reserves/${picked.replace(/^g:/, '')}/withdraw`, { method: 'POST', body: fd, headers: authHeaders() });
        if (!res.ok) throw new Error((await res.json()).detail || 'Reserve withdrawal failed');
        toast(`Paid ${chf(amount)} from GmbH reserve`);
      } else {
        toast('Marked paid (no reserve selected)');
      }
    } else {
      toast(type === 'obligation' ? 'Obligation marked paid' : 'Bill marked paid');
    }

    closePaymentSource();
    if (type === 'obligation') loadObligationsPage();
    else loadAccountingDocs();
  } catch (e) { toast(e.message, 'error'); closePaymentSource(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// VENDOR AUTO-SUGGEST & DUPLICATE DETECTION
// ══════════════════════════════════════════════════════════════════════════════

let vendorsCache = [];

async function loadVendorList() {
  try {
    vendorsCache = await api('/accounting/vendors');
    const dl = document.getElementById('vendor-list');
    if (dl) {
      dl.innerHTML = vendorsCache.map(v => `<option value="${v.vendor}">`).join('');
    }
  } catch {}
}

async function onVendorChange() {
  const vendor = document.getElementById('acct-vendor').value.trim();
  if (!vendor) return;
  // Auto-fill category from last known
  const match = vendorsCache.find(v => v.vendor.toLowerCase() === vendor.toLowerCase());
  if (match) {
    if (!document.getElementById('acct-cat').value || document.getElementById('acct-cat').value === 'Other') {
      document.getElementById('acct-cat').value = match.category;
    }
  }
  // Check duplicate
  const amt = parseFloat(document.getElementById('acct-amount').value);
  const docDate = document.getElementById('acct-date').value;
  if (amt && docDate && !document.getElementById('acct-edit-id').value) {
    const month = docDate.slice(0, 7);
    try {
      const res = await api(`/accounting/check-duplicate?vendor=${encodeURIComponent(vendor)}&amount=${amt}&month=${month}`);
      const warn = document.getElementById('acct-duplicate-warn');
      if (res.duplicates.length) {
        const d = res.duplicates[0];
        warn.textContent = `⚠ Possible duplicate: ${d.vendor} · ${chf(d.amount)} on ${d.doc_date}`;
        warn.style.display = 'block';
      } else {
        warn.style.display = 'none';
      }
    } catch {}
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK UPLOAD
// ══════════════════════════════════════════════════════════════════════════════

async function handleBulkUpload(files) {
  if (!files || !files.length) return;
  toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  try {
    const res = await fetch('/api/accounting/bulk-upload', { method: 'POST', body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    toast(`${data.count} draft bill${data.count > 1 ? 's' : ''} created — edit each to fill in details`);
    loadAccountingDocs();
  } catch (e) { toast(e.message, 'error'); }
  document.getElementById('bulk-upload-input').value = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAG-AND-DROP FILE UPLOAD
// ══════════════════════════════════════════════════════════════════════════════

function setupFileDrop() {
  document.querySelectorAll('.file-drop').forEach(zone => {
    if (zone.dataset.bound) return;
    zone.dataset.bound = '1';
    const input = zone.querySelector('input[type="file"]');
    const status = zone.querySelector('.file-status');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', e => zone.classList.remove('dragging'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragging');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    input.addEventListener('change', () => {
      if (input.files.length && status) status.textContent = `Selected: ${input.files[0].name}`;
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MONTH COMPARE & CATEGORY TRENDS (legacy helpers, no longer on a page)
// ══════════════════════════════════════════════════════════════════════════════

function sparkline(values, width = 80, height = 20, color = '#3b82f6') {
  if (!values.length) return '';
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const stepX = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) =>
    `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`
  ).join(' ');
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points}"/>
  </svg>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════════════

const SHORTCUTS = [
  {keys: '/',       desc: 'Focus this page\'s search',  action: () => { const el = document.querySelector('.page.active .page-search__input'); if (el) el.focus(); else toast('No search on this page — try Bills or Invoices'); }},
  {keys: 'g d',     desc: 'Go to Dashboard',           action: () => navigateTo('dashboard')},
  {keys: 'g o',     desc: 'Go to Forecast',            action: () => navigateTo('budget')},
  {keys: 'g r',     desc: 'Go to Budget Balances',     action: () => navigateTo('balances')},
  {keys: 'g b',     desc: 'Go to Bills',               action: () => navigateTo('accounting')},
  {keys: 'g o b',   desc: 'Go to Obligations',         action: () => navigateTo('obligations')},
  {keys: 'g p',     desc: 'Go to Payroll',             action: () => navigateTo('payroll')},
  {keys: 'g i',     desc: 'Go to Invoices',            action: () => navigateTo('invoices')},
  {keys: 'g t',     desc: 'Go to Bank / Owner ledger', action: () => navigateTo('bank')},
  {keys: 'g n',     desc: 'Go to Invoices & Income',   action: () => navigateTo('invoices')},
  {keys: 'g c',     desc: 'Go to Customers',           action: () => navigateTo('customers')},
  {keys: 'g e',     desc: 'Go to Expenses',            action: () => navigateTo('expenses')},
  {keys: 'g x',     desc: 'Go to Reports',             action: () => navigateTo('reports')},
  {keys: 'n i',     desc: 'New Invoice',               action: () => navigateTo('form')},
  {keys: 'n b',     desc: 'New Bill',                  action: () => navigateTo('accounting-form')},
  {keys: 'n e',     desc: 'New Expense',               action: () => navigateTo('expense-form')},
  {keys: 'n o',     desc: 'New Obligation',            action: () => { navigateTo('obligations'); setTimeout(showObligationDialog, 100); }},
  {keys: 'n t',     desc: 'Log Transfer',              action: () => { navigateTo('bank'); setTimeout(() => document.getElementById('transfer-dialog').classList.add('show'), 100); }},
  {keys: 'c c',     desc: 'Update cash balance',       action: () => showCashBalance()},
  {keys: 't',       desc: 'Toggle theme',              action: () => toggleTheme()},
  {keys: 'q',       desc: 'Quick-add (mobile)',        action: () => {
    const token = localStorage.getItem('session_token');
    window.location.href = token ? `/quick?token=${encodeURIComponent(token)}` : '/quick';
  }},
  {keys: 'b',       desc: 'Download backup',           action: () => downloadBackup()},
  {keys: '?',       desc: 'Show shortcuts',            action: () => showShortcuts()},
  {keys: 'Esc',     desc: 'Close modals',              action: () => document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'))},
];

let kbBuffer = '';
let kbTimer = null;
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    SHORTCUTS.find(s => s.keys === 'Esc').action();
    return;
  }
  if (e.key === '/') { e.preventDefault(); SHORTCUTS[0].action(); return; }
  if (e.key === '?') { e.preventDefault(); SHORTCUTS.find(s => s.keys === '?').action(); return; }

  kbBuffer += e.key.toLowerCase();
  clearTimeout(kbTimer);
  kbTimer = setTimeout(() => { kbBuffer = ''; }, 800);

  // Match 2-char sequences
  for (const s of SHORTCUTS) {
    const trimmed = s.keys.replace(/\s/g, '');
    if (trimmed === kbBuffer) {
      e.preventDefault();
      s.action();
      kbBuffer = '';
      break;
    }
  }
});

function showShortcuts(e) {
  if (e) e.preventDefault();
  const content = SHORTCUTS.map(s => {
    const keyHtml = s.keys.split(' ').map(k => `<span class="kbd">${k}</span>`).join(' then ');
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
      <span>${keyHtml}</span><span style="color:var(--text-muted)">${s.desc}</span>
    </div>`;
  }).join('');
  const existing = document.getElementById('shortcuts-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.className = 'modal-overlay show';
  modal.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
    <h3 class="modal__title">Keyboard Shortcuts</h3>${content}
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn--ghost" onclick="document.getElementById('shortcuts-modal').remove()">Close</button>
    </div>
  </div>`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════════════════════════════════════

function downloadBackup(e) {
  if (e) e.preventDefault();
  window.location.href = tokenUrl('/api/backup');
  toast('Preparing backup...');
}

function openQuickAdd(e) {
  if (e) e.preventDefault();
  const token = localStorage.getItem('session_token');
  window.location.href = token ? `/quick?token=${encodeURIComponent(token)}` : '/quick';
}

// ══════════════════════════════════════════════════════════════════════════════
// RECURRING OBLIGATIONS
// ══════════════════════════════════════════════════════════════════════════════

async function generateRecurringObligations() {
  try {
    const res = await api('/obligations/generate-recurring', { method: 'POST' });
    if (res.created) toast(`Created ${res.created} recurring obligation${res.created > 1 ? 's' : ''}`);
    else toast('All recurring obligations up to date');
    loadObligationsPage();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// AI CHAT (local LLM via Ollama or any provider)
// ══════════════════════════════════════════════════════════════════════════════

async function checkAiStatus() {
  const fab = document.getElementById('ai-chat-fab');
  const status = document.getElementById('ai-chat-status');
  const warning = document.getElementById('ai-chat-model-warning');
  try {
    const s = await api('/llm/status');
    fab.style.display = 'flex';
    if (s.reachable) {
      status.textContent = `${s.provider} · ${s.text_model}`;
      status.className = 'ai-chat-status online';
    } else {
      status.textContent = `${s.provider} (not reachable — check ${s.endpoint})`;
      status.className = 'ai-chat-status offline';
    }
    // Detect small local models that struggle with tool-use
    if (warning) {
      const tag = (s.text_model || '').toLowerCase();
      const isLocal = (s.provider || '').toLowerCase() === 'ollama';
      // Parse parameter count from common tag formats: ":7b", ":3b", ":13b", ":32b", ":70b"
      const sizeMatch = tag.match(/[:\-](\d+(?:\.\d+)?)b\b/);
      const sizeB = sizeMatch ? parseFloat(sizeMatch[1]) : null;
      if (isLocal && sizeB !== null && sizeB < 14) {
        warning.innerHTML = `<b>⚠ Small local model (${sizeB}B params)</b> — `
          + `tool-calling on models under ~14B is unreliable: confabulated numbers, `
          + `failed JSON, missed tool selection. For accurate financial answers consider `
          + `<code>qwen2.5-coder:32b</code>, <code>llama3.3:70b</code>, or switch to `
          + `<code>LLM_PROVIDER=anthropic</code> in your environment.`;
        warning.style.display = 'block';
      } else {
        warning.style.display = 'none';
      }
    }
  } catch {}
}

function toggleAiChat() {
  document.getElementById('ai-chat-panel').classList.toggle('open');
}

function aiAsk(text) {
  document.getElementById('ai-chat-text').value = text;
  aiSubmit();
}

function appendAiMessage(role, html) {
  const body = document.getElementById('ai-chat-body');
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  div.innerHTML = html;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

// Conversation memory (kept per session in JS, not persisted)
let aiHistory = [];

function aiClearHistory() {
  aiHistory = [];
  document.getElementById('ai-chat-body').innerHTML = '';
  toast('Conversation cleared');
}

function renderToolDetails(tool, args, result) {
  if (!tool) return '';

  // Special path: propose_action tools render an Apply / Discard card instead
  // of a passive details block. The actual mutation hits an existing PATCH
  // endpoint and only fires when the user clicks Apply.
  if (result && result._proposal) {
    return renderProposalCard(result._proposal);
  }
  if (result && result.error && tool === 'propose_action') {
    return `<div style="margin-top:10px;padding:10px 12px;background:rgba(239,68,68,0.12);border:1px solid var(--danger-fill);border-radius:6px;color:var(--danger-text);font-size:13px">Could not prepare action: ${escapeHtml(result.error)}</div>`;
  }

  const argsStr = args ? Object.entries(args).map(([k,v]) => `${k}=${v}`).join(', ') : '';
  let html = `<details style="margin-top:8px"><summary class="hint hint--sm" style="cursor:pointer">Tool: ${escapeHtml(tool)}(${escapeHtml(argsStr)})</summary>`;
  if (result) {
    if (result.rows && Array.isArray(result.rows) && result.rows.length) {
      const cols = Object.keys(result.rows[0]);
      let table = '<div class="rows"><table><thead><tr>';
      table += cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
      table += '</tr></thead><tbody>';
      for (const r of result.rows.slice(0, 20)) {
        table += '<tr>' + cols.map(c => {
          const v = r[c];
          const fmt = (typeof v === 'number') ? v.toLocaleString('de-CH', {maximumFractionDigits: 2}) : (v ?? '');
          return `<td class="mono">${escapeHtml(fmt)}</td>`;
        }).join('') + '</tr>';
      }
      table += '</tbody></table></div>';
      html += table;
    } else {
      html += `<div class="sql">${escapeHtml(JSON.stringify(result, null, 2).slice(0, 800))}</div>`;
    }
  }
  html += '</details>';
  return html;
}

// In-memory store of pending proposals so the Apply button can find its data.
const _pendingProposals = {};

function renderProposalCard(proposal) {
  const id = 'prop_' + Math.random().toString(36).slice(2, 10);
  _pendingProposals[id] = proposal;
  return `
    <div class="proposal-card" id="${id}">
      <div class="proposal-card__head">
        <span class="proposal-card__badge">PROPOSED CHANGE</span>
        <strong>${escapeHtml(proposal.label)}</strong>
      </div>
      <div class="proposal-card__desc">${escapeHtml(proposal.description)}</div>
      <div class="proposal-card__meta">${escapeHtml(proposal.method)} ${escapeHtml(proposal.endpoint)} · ${escapeHtml(JSON.stringify(proposal.payload))}</div>
      <div class="proposal-card__actions">
        <button class="btn btn--ghost btn--sm" onclick="discardProposal('${id}')">Discard</button>
        <button class="btn btn--primary btn--sm" onclick="applyProposal('${id}')">Apply</button>
      </div>
    </div>`;
}

function discardProposal(id) {
  delete _pendingProposals[id];
  const el = document.getElementById(id);
  if (el) el.outerHTML = '<div class="hint" style="font-style:italic">Discarded — no change made.</div>';
}

async function applyProposal(id) {
  const p = _pendingProposals[id];
  if (!p) return;
  const card = document.getElementById(id);
  if (card) card.querySelector('.proposal-card__actions').innerHTML =
    '<span class="hint">Applying…</span>';

  try {
    // Strip the leading /api so api() builds the right URL
    const endpoint = p.endpoint.replace(/^\/api/, '');
    // Two payload formats: JSON (default, for PATCH/status changes) or
    // form-encoded (for POST endpoints that accept Form fields, e.g. /api/expenses)
    if ((p.format || 'json') === 'form') {
      const fd = new FormData();
      for (const [k, v] of Object.entries(p.payload || {})) {
        if (v !== undefined && v !== null) fd.append(k, v);
      }
      const url = '/api' + endpoint;
      const token = localStorage.getItem('session_token');
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(url, { method: p.method, body: fd, headers });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(()=>'')}`);
    } else {
      await api(endpoint, { method: p.method, body: JSON.stringify(p.payload) });
    }
    delete _pendingProposals[id];
    if (card) card.outerHTML =
      `<div style="margin-top:10px;padding:10px 12px;background:rgba(16,185,129,0.12);border:1px solid var(--ok-fill);border-radius:6px;color:var(--ok-text);font-size:13px">✓ Applied: ${escapeHtml(p.label)}</div>`;
    toast('Change applied');
    // Best-effort re-fetch of relevant lists if their pages are visible
    if (typeof loadInvoices === 'function')   { try { loadInvoices(); }   catch {} }
    if (typeof loadAccountingDocs === 'function') { try { loadAccountingDocs(); } catch {} }
    if (typeof loadObligations === 'function') { try { loadObligations(); } catch {} }
    if (typeof loadExpenses === 'function')   { try { loadExpenses(); }   catch {} }
    if (typeof loadDashboard === 'function')  { try { loadDashboard(); }  catch {} }
  } catch (e) {
    if (card) card.querySelector('.proposal-card__actions').innerHTML =
      `<span style="font-size:12px;color:var(--danger-text)">Failed: ${escapeHtml(e.message)}</span>`;
  }
}

async function aiSubmit() {
  const ta = document.getElementById('ai-chat-text');
  const question = ta.value.trim();
  if (!question) return;
  ta.value = '';

  // Add to history & UI
  aiHistory.push({role: 'user', content: question});
  appendAiMessage('user', `<div class="bubble">${escapeHtml(question)}</div>`);
  const placeholder = appendAiMessage('bot', `<div class="bubble"><em>Thinking…</em></div>`);
  const bubble = placeholder.querySelector('.bubble');

  // Try streaming first
  try {
    const token = localStorage.getItem('session_token');
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch('/api/llm/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({messages: aiHistory}),
    });
    if (!res.ok || !res.body) throw new Error('Stream not available');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let meta = null;

    bubble.innerHTML = '<span class="ai-cursor"></span>';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      // Parse SSE chunks
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = chunk.split('\n');
        let event = 'message', dataLine = '';
        for (const ln of lines) {
          if (ln.startsWith('event: ')) event = ln.slice(7).trim();
          else if (ln.startsWith('data: ')) dataLine += ln.slice(6);
        }
        if (!dataLine) continue;
        try {
          const obj = JSON.parse(dataLine);
          if (event === 'meta') {
            meta = obj;
          } else if (event === 'token') {
            answer += obj.text || '';
            bubble.innerHTML = escapeHtml(answer) + '<span class="ai-cursor"></span>';
            placeholder.scrollIntoView({block: 'end', behavior: 'smooth'});
          } else if (event === 'error') {
            bubble.innerHTML = `<strong style="color:var(--danger-text)">Error:</strong> ${escapeHtml(obj.error)}`;
            return;
          } else if (event === 'done') {
            // Final render with tool details
            let html = escapeHtml(answer);
            if (meta && meta.tool) {
              html += renderToolDetails(meta.tool, meta.args, meta.result);
            }
            bubble.innerHTML = html;
            aiHistory.push({role: 'assistant', content: answer});
            // Keep history bounded
            if (aiHistory.length > 12) aiHistory = aiHistory.slice(-12);
            return;
          }
        } catch {}
      }
    }
  } catch (streamErr) {
    // Fall back to non-streaming endpoint
    try {
      const res = await api('/llm/ask', {
        method: 'POST',
        body: JSON.stringify({messages: aiHistory}),
      });
      let html = res.error
        ? `<strong style="color:var(--danger-text)">Error:</strong> ${escapeHtml(res.error)}`
        : escapeHtml(res.answer || 'Done.');
      html += renderToolDetails(res.tool, res.args, res.result);
      bubble.innerHTML = html;
      if (res.answer) aiHistory.push({role: 'assistant', content: res.answer});
    } catch (e) {
      bubble.innerHTML = `<div><strong style="color:var(--danger-text)">Error:</strong> ${escapeHtml(e.message)}</div>`;
    }
  }
}

// Cmd+K / Ctrl+K to open chat
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    toggleAiChat();
    setTimeout(() => document.getElementById('ai-chat-text').focus(), 250);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR (obligations / bills / payroll — real vs expected)
// ══════════════════════════════════════════════════════════════════════════════

let calYear = null, calMonth = null;   // 1-based month
let calEvents = [];

function loadCalendarPage() {
  if (calYear === null) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth() + 1;
  }
  fetchCalendar();
}

function calShift(n) {
  calMonth += n;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  if (calMonth < 1) { calMonth = 12; calYear--; }
  fetchCalendar();
}

function calToday() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth() + 1;
  fetchCalendar();
}

async function fetchCalendar() {
  const lastDay = new Date(calYear, calMonth, 0).getDate();
  const mm = String(calMonth).padStart(2, '0');
  const start = `${calYear}-${mm}-01`;
  const end = `${calYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
  document.getElementById('cal-month-title').textContent =
    new Date(calYear, calMonth - 1, 1).toLocaleDateString('en-CH', {month: 'long', year: 'numeric'});
  try {
    const data = await api(`/calendar?start=${start}&end=${end}`);
    calEvents = data.events;
    renderCalendar();
  } catch (e) { toast(e.message, 'error'); }
}

function calVisibleEvents() {
  return calEvents.filter(ev => {
    const box = document.getElementById('cal-f-' + ev.kind);
    return !box || box.checked;
  });
}

function calEventChip(ev, compact) {
  const overdue = ev.status === 'unpaid' && ev.date < new Date().toISOString().slice(0, 10);
  const cls = `cal-ev ${ev.kind} ${ev.real ? 'real' : 'expected'}${overdue ? ' overdue' : ''}${ev.status === 'paid' || ev.status === 'issued' ? ' done' : ''}`;
  const tip = `${ev.title} — ${chf(ev.amount)} (${ev.real ? 'document uploaded' : 'expected'}, ${ev.status})`;
  const click = ev.doc_url
    ? `previewPdf(tokenUrl('${ev.doc_url}'), '${escapeHtml(ev.title).replace(/'/g, "\\'")}')`
    : `navigateTo('${ev.page}')`;
  const label = compact ? '' : `<span class="cal-ev-title">${escapeHtml(ev.title)}</span><span class="cal-ev-amt">${chf(ev.amount)}</span>`;
  return `<div class="${cls}" title="${escapeHtml(tip)}" onclick="${click}">${label}</div>`;
}

function renderCalendar() {
  const events = calVisibleEvents();
  const byDate = {};
  events.forEach(ev => { (byDate[ev.date] = byDate[ev.date] || []).push(ev); });

  // Month grid, Monday first
  const first = new Date(calYear, calMonth - 1, 1);
  const lastDay = new Date(calYear, calMonth, 0).getDate();
  const lead = (first.getDay() + 6) % 7;              // days shown from previous month
  const todayIso = new Date().toISOString().slice(0, 10);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-day other-month"></div>');
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEvents = byDate[iso] || [];
    const chips = dayEvents.map(ev => calEventChip(ev)).join('');
    const dayTotal = dayEvents.length > 1
      ? `<div class="cal-day-total" title="Total for ${iso}">= ${chf(dayEvents.reduce((s, e) => s + e.amount, 0))}</div>`
      : '';
    cells.push(
      `<div class="cal-day${iso === todayIso ? ' today' : ''}">` +
      `<div class="cal-day-num">${d}</div>${chips}${dayTotal}</div>`
    );
  }
  while (cells.length % 7 !== 0) cells.push('<div class="cal-day other-month"></div>');
  document.getElementById('cal-grid').innerHTML = cells.join('');

  // List below the grid
  document.getElementById('cal-count').textContent = events.length;
  const monthTotal = events.reduce((s, e) => s + e.amount, 0);
  const due = events.filter(e => e.status === 'unpaid' || e.status === 'expected')
                    .reduce((s, e) => s + e.amount, 0);
  document.getElementById('cal-month-total').textContent =
    events.length ? `Month total: ${chf(monthTotal)}` : '';
  document.getElementById('cal-total-due').textContent =
    due > 0 ? `Month total: ${chf(monthTotal)} · still due: ${chf(due)}` : (events.length ? `Month total: ${chf(monthTotal)}` : '');
  const rows = events.map(ev => {
    const overdue = ev.status === 'unpaid' && ev.date < todayIso;
    const statusBadge = ev.real
      ? `<span class="chip ${ev.status === 'paid' || ev.status === 'issued' ? 'chip--ok' : (overdue ? 'chip--danger' : 'chip--warn')}">${ev.status}${overdue ? ' · overdue' : ''}</span>`
      : `<span class="chip chip--expected">expected</span>`;
    const doc = ev.doc_url
      ? `<a href="#" onclick="previewPdf(tokenUrl('${ev.doc_url}'), '${escapeHtml(ev.title).replace(/'/g, "\\'")}');return false">&#128196; view</a>`
      : `<span style="color:var(--text-muted)">—</span>`;
    return `<tr>
      <td style="white-space:nowrap">${ev.date}</td>
      <td><span class="cal-dot" style="background:var(--cal-${ev.kind})"></span> ${escapeHtml(ev.title)}</td>
      <td class="text-right">${chf(ev.amount)}</td>
      <td>${statusBadge}</td>
      <td>${doc}</td>
    </tr>`;
  });
  document.getElementById('cal-list-tbody').innerHTML =
    rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">Nothing due this month</td></tr>';
}

// ── Init ──
checkAuth();
checkAiStatus();
