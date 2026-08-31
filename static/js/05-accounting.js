// 05-accounting.js — company accounting (bills), reimburse flow, financial overview
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// COMPANY ACCOUNTING
// ══════════════════════════════════════════════════════════════════════════════

let allAccountingDocs = [];
let acctSortKey = 'doc_date';
let acctSortAsc = false;

async function loadAccountingYears() {
  try {
    const years = await api('/accounting/years');
    const sel = document.getElementById('acct-year-filter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All</option>' +
      years.map(y => `<option value="${y}"${y===cur?' selected':''}>${y}</option>`).join('');
  } catch {}
}

async function loadAccountingDocs() {
  try {
    allAccountingDocs = await api('/accounting');
    persistFilter('accounting', ['acct-year-filter', 'acct-cat-filter', 'acct-search']);
    const q = document.getElementById('acct-search').value;
    if (q && q.trim().length >= 2 && !pageSearchIds('bill')) acctSearchInput(q);
    applyAccountingFilters();
  } catch (e) { toast(e.message, 'error'); }
}

function applyAccountingFilters() {
  const year = document.getElementById('acct-year-filter').value;
  const cat = document.getElementById('acct-cat-filter').value;
  const search = document.getElementById('acct-search').value.toLowerCase().trim();
  const ids = pageSearchIds('bill');

  let filtered = allAccountingDocs;
  if (year) filtered = filtered.filter(d => d.doc_date.substring(0,4) === year);
  if (cat) filtered = filtered.filter(d => d.category === cat);
  if (ids) filtered = filtered.filter(d => ids.has(d.id));
  else if (search) filtered = filtered.filter(d =>   // instant fallback while the server round-trip is pending
    d.vendor.toLowerCase().includes(search) || d.description.toLowerCase().includes(search));

  filtered.sort((a, b) => {
    let va = a[acctSortKey], vb = b[acctSortKey];
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return acctSortAsc ? -1 : 1;
    if (va > vb) return acctSortAsc ? 1 : -1;
    return 0;
  });

  ['doc_date','vendor','description','category','amount','due_date'].forEach(k => {
    const el = document.getElementById('sort-acct-' + k);
    if (el) el.textContent = acctSortKey === k ? (acctSortAsc ? '\u25B2' : '\u25BC') : '';
  });

  renderAccountingDocs(filtered);
}

function acctSearchInput(value) {
  pageSearchInput('bill', value, 'acct-search-chips', applyAccountingFilters);
}

function sortAccounting(key) {
  if (acctSortKey === key) acctSortAsc = !acctSortAsc;
  else { acctSortKey = key; acctSortAsc = true; }
  applyAccountingFilters();
}

function renderAccountingDocs(docs) {
  const tbody = document.getElementById('acct-tbody');
  const totalEl = document.getElementById('acct-total');

  if (!docs.length) {
    const hasFilters = document.getElementById('acct-year-filter').value || document.getElementById('acct-cat-filter').value || document.getElementById('acct-search').value.trim();
    if (hasFilters) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No documents match the current filters</td></tr>';
    } else {
      tbody.innerHTML = `<tr><td colspan="9" style="padding:0;border:none">${emptyState('&#128218;', 'No bills yet', 'Add your first bill — invoices, subscriptions, taxes, anything you pay for the company.', '+ Add Document', () => { clearAccountingForm(); navigateTo('accounting-form'); })}</td></tr>`;
    }
    totalEl.textContent = '';
    return;
  }

  const total = docs.reduce((s, d) => s + d.amount, 0);
  const year = document.getElementById('acct-year-filter').value;
  const cat = document.getElementById('acct-cat-filter').value;
  const search = document.getElementById('acct-search').value.trim();
  let label = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;
  const filters = [];
  if (year) filters.push(year);
  if (cat) filters.push(cat);
  if (search) filters.push(`"${search}"`);
  if (filters.length) label += ` (${filters.join(', ')})`;
  const personalOutstanding = docs.filter(d => d.paid_via === 'personal' && !d.reimbursed_at).reduce((s, d) => s + d.amount, 0);
  totalEl.textContent = `${label} = CHF ${total.toLocaleString('de-CH', {minimumFractionDigits:2})}`
    + (personalOutstanding > 0 ? ` — of which CHF ${personalOutstanding.toLocaleString('de-CH', {minimumFractionDigits:2})} fronted on your personal card, not yet reimbursed` : '');
  const reimburseBtn = document.getElementById('btn-reimburse');
  if (reimburseBtn) {
    reimburseBtn.style.display = personalOutstanding > 0 ? '' : 'none';
    // Unreimbursed travel expense reports also live in this dialog — show the
    // button for them even when no personal-card bill is open.
    if (personalOutstanding <= 0) {
      api('/accounting/personal-card/outstanding')
        .then(o => { if ((o.reports || []).length) reimburseBtn.style.display = ''; })
        .catch(() => {});
    }
  }

  tbody.innerHTML = docs.map(d => `
    <tr>
      <td>${d.doc_date}</td>
      <td><strong>${d.vendor}</strong>${d.paid_via === 'personal'
        ? (d.reimbursed_at
            ? ` <span class="chip chip--ok" title="Paid with your personal card — reimbursed on ${d.reimbursed_at}">&#128179; reimbursed</span>`
            : ' <span class="chip chip--owner" title="Paid with your personal card — GmbH owes you">&#128179; personal</span>')
        : ''}</td>
      <td>${d.description}</td>
      <td><span class="${badgeClass(d.category)}">${d.category}</span></td>
      <td class="money">CHF ${d.amount.toLocaleString('de-CH', {minimumFractionDigits:2})}${d.original_currency ? `<div class="hint hint--sm" title="Booked at ${d.fx_rate} CHF/${d.original_currency}">${d.original_amount.toFixed(2)} ${d.original_currency}</div>` : ''}</td>
      <td>${d.due_date || '-'}</td>
      <td>${(() => { const s = computeStatus(d.status, d.due_date); return `<span class="${s.cls}" onclick="toggleBillStatus(${d.id}, '${d.status}')" style="cursor:pointer" title="Click to toggle">${s.label}</span>`; })()}</td>
      <td>${d.has_file ? (d.file_type === 'pdf'
        ? `<button class="btn btn--ghost btn--icon" onclick="previewPdf('/api/accounting/${d.id}/file', '${d.vendor}')" title="View PDF" style="font-size:20px">&#128196;</button>`
        : `<img src="${tokenUrl('/api/accounting/' + d.id + '/file')}" class="scan-thumb" onclick="previewAccountingImg(${d.id})">`)
        : ''}${d.doc_url ? `<a href="${escapeHtml(d.doc_url)}" target="_blank" rel="noopener" class="btn btn--ghost btn--icon" title="Open document link (${escapeHtml(d.doc_url.slice(0, 60))})">&#128279;</a>` : ''}${!d.has_file && !d.doc_url ? '-' : ''}</td>
      <td class="text-right">
        <div class="actions">
          <button class="btn btn--ghost btn--icon" onclick="editAccountingDoc(${d.id})" title="Edit">&#9998;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="confirmDelete(${d.id}, null, 'accounting')" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Reimburse yourself (personal-card bills → one GmbH→Personal transfer) ──

async function openReimburseDialog() {
  try {
    const data = await api('/accounting/personal-card/outstanding');
    const reports = data.reports || [];
    if (!data.bills.length && !reports.length) { toast('Nothing outstanding — all personal-card bills and expense reports are reimbursed'); return; }
    document.getElementById('reimburse-date').value = new Date().toISOString().slice(0, 10);
    const row = (kind, id, date, main, amount) => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px">
        <input type="checkbox" class="reimburse-check" data-kind="${kind}" value="${id}" data-amount="${amount}" checked onchange="updateReimburseTotal()" style="width:auto">
        <span class="mono" style="color:var(--text-muted);flex:none">${date}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${main}</span>
        <span class="mono" style="flex:none">${chf(amount)}</span>
      </label>`;
    let html = '';
    if (data.bills.length) {
      html += `<div class="section-label" style="margin:4px 0 2px">Bills paid privately</div>`;
      html += data.bills.map(b => row('bill', b.id, b.doc_date, `<strong>${escapeHtml(b.vendor)}</strong> — ${escapeHtml(b.description)}`, b.amount)).join('');
    }
    if (reports.length) {
      html += `<div class="section-label" style="margin:12px 0 2px">Travel expense reports</div>`;
      html += reports.map(r => row('report', r.id, r.created_at, `<strong>Report #${r.report_number}</strong> — ${escapeHtml(r.period)} · ${r.expense_count} receipt${r.expense_count === 1 ? '' : 's'}`, r.amount)).join('');
    }
    document.getElementById('reimburse-list').innerHTML = html;
    updateReimburseTotal();
    document.getElementById('reimburse-dialog').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

function updateReimburseTotal() {
  const total = [...document.querySelectorAll('.reimburse-check:checked')]
    .reduce((s, el) => s + parseFloat(el.dataset.amount), 0);
  document.getElementById('reimburse-total').textContent = chf(total);
  document.getElementById('reimburse-submit').disabled = total <= 0;
}

async function submitReimburse() {
  const checked = [...document.querySelectorAll('.reimburse-check:checked')];
  const billIds = checked.filter(el => el.dataset.kind !== 'report').map(el => parseInt(el.value, 10));
  const reportIds = checked.filter(el => el.dataset.kind === 'report').map(el => parseInt(el.value, 10));
  if (!billIds.length && !reportIds.length) return;
  try {
    const res = await api('/accounting/personal-card/reimburse', {
      method: 'POST',
      body: JSON.stringify({bill_ids: billIds, report_ids: reportIds, transfer_date: document.getElementById('reimburse-date').value}),
    });
    document.getElementById('reimburse-dialog').classList.remove('show');
    const parts = [];
    if (res.bills_settled) parts.push(`${res.bills_settled} bill(s)`);
    if (res.reports_settled) parts.push(`${res.reports_settled} expense report(s)`);
    toast(`${parts.join(' + ')} settled — transfer of ${chf(res.total)} logged. Now pay yourself that amount from UBS.`);
    _kontokorrentCache = null;   // bank-page Kontokorrent must recompute
    loadAccountingDocs();
  } catch (e) { toast(e.message, 'error'); }
}

function previewAccountingImg(id) {
  document.getElementById('scan-modal-img').src = tokenUrl(`/api/accounting/${id}/file`);
  document.getElementById('scan-modal').classList.add('show');
}

function clearAccountingForm() {
  document.getElementById('acct-edit-id').value = '';
  document.getElementById('accounting-form').reset();
  document.getElementById('acct-currency').value = 'CHF';
  document.getElementById('acct-fx-rate').value = '';
  updateAcctFx();
  document.getElementById('acct-paid-via').value = 'company';
  document.getElementById('acct-form-title').textContent = 'Add Document';
  document.getElementById('acct-submit-btn').textContent = 'Save Document';
  updateAcctStatusPreview();
}

function updateAcctFx() {
  const cur = document.getElementById('acct-currency').value;
  const grp = document.getElementById('acct-fx-group');
  const rateEl = document.getElementById('acct-fx-rate');
  const prev = document.getElementById('acct-fx-preview');
  const isFx = cur !== 'CHF';
  grp.style.display = isFx ? '' : 'none';
  rateEl.required = isFx;
  if (!isFx) { prev.textContent = ''; return; }
  const amt = parseFloat(document.getElementById('acct-amount').value);
  const rate = parseFloat(rateEl.value);
  prev.textContent = (amt > 0 && rate > 0)
    ? `Booked as ${chf(amt * rate)} (${amt.toFixed(2)} ${cur} × ${rate})`
    : `Amount is in ${cur}; the CHF value is booked, original + rate kept for the audit trail.`;
}

async function handleAccountingSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('acct-edit-id').value;

  // Sanity check against the bank before saving a "paid privately" bill:
  // if the GmbH account shows the same debit, it was NOT paid privately.
  const paidVia = document.getElementById('acct-paid-via').value;
  const cur = document.getElementById('acct-currency').value;
  const rawAmt = parseFloat(document.getElementById('acct-amount').value);
  const fxRate = parseFloat(document.getElementById('acct-fx-rate').value);
  const chfAmt = cur === 'CHF' ? rawAmt : rawAmt * fxRate;
  if (paidVia === 'personal' && chfAmt > 0) {
    try {
      const chk = await api(`/accounting/bank-check?amount=${chfAmt.toFixed(2)}&doc_date=${document.getElementById('acct-date').value}&paid_via=personal`);
      if (chk.warning && !confirm(`⚠ ${chk.warning}\n\nSave it as "paid privately" anyway?`)) return;
    } catch (_) { /* bank check is advisory — never block saving */ }
  }

  const fd = new FormData();
  fd.append('doc_date', document.getElementById('acct-date').value);
  fd.append('vendor', document.getElementById('acct-vendor').value);
  fd.append('description', document.getElementById('acct-desc').value);
  fd.append('amount', document.getElementById('acct-amount').value);
  fd.append('currency', document.getElementById('acct-currency').value);
  fd.append('category', document.getElementById('acct-cat').value);
  fd.append('due_date', document.getElementById('acct-due').value);
  fd.append('status', document.getElementById('acct-status').value);
  fd.append('recurrence', document.getElementById('acct-recurrence').value);
  fd.append('paid_via', document.getElementById('acct-paid-via').value);
  fd.append('doc_url', document.getElementById('acct-doc-url').value.trim());
  if (cur !== 'CHF') fd.append('fx_rate', document.getElementById('acct-fx-rate').value);
  const docFile = document.getElementById('acct-file').files[0];
  if (docFile) fd.append('doc', docFile);

  try {
    const res = await fetch(editId ? `/api/accounting/${editId}` : '/api/accounting',
                            { method: editId ? 'PUT' : 'POST', body: fd, headers: authHeaders() });
    if (!res.ok) {
      let msg = `Save failed (${res.status})`;
      try { msg = (await res.json()).detail || msg; } catch (_) {}
      throw new Error(msg);
    }
    toast(editId ? 'Document updated' : 'Document saved');
    clearAccountingForm();
    navigateTo('accounting');
  } catch (e) { toast(e.message, 'error'); }
}

async function editAccountingDoc(id) {
  try {
    const d = await api(`/accounting/${id}`);
    document.getElementById('acct-edit-id').value = id;
    document.getElementById('acct-date').value = d.doc_date;
    document.getElementById('acct-vendor').value = d.vendor;
    document.getElementById('acct-desc').value = d.description;
    if (d.original_currency) {
      document.getElementById('acct-amount').value = d.original_amount;
      document.getElementById('acct-currency').value = d.original_currency;
      document.getElementById('acct-fx-rate').value = d.fx_rate;
    } else {
      document.getElementById('acct-amount').value = d.amount;
      document.getElementById('acct-currency').value = 'CHF';
      document.getElementById('acct-fx-rate').value = '';
    }
    updateAcctFx();
    document.getElementById('acct-due').value = d.due_date || '';
    document.getElementById('acct-status').value = d.status;
    document.getElementById('acct-recurrence').value = d.recurrence || 'none';
    document.getElementById('acct-paid-via').value = d.paid_via || 'company';
    document.getElementById('acct-doc-url').value = d.doc_url || '';
    updateAcctStatusPreview();
    document.getElementById('acct-cat').value = d.category;
    document.getElementById('acct-form-title').textContent = 'Edit Document';
    document.getElementById('acct-submit-btn').textContent = 'Update Document';
    navigateTo('accounting-form');
  } catch (e) { toast(e.message, 'error'); }
}

async function scanQrBill(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  toast('Scanning QR-bill...');
  try {
    const res = await fetch('/api/qr-bill/scan', {
      method: 'POST', body: fd, headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'QR scan failed');
    }
    const data = await res.json();
    if (!data.is_swiss_qr_bill) {
      toast('QR found but not a Swiss QR-bill', 'error');
      return;
    }
    // Auto-fill the form
    if (data.creditor && data.creditor.name) {
      document.getElementById('acct-vendor').value = data.creditor.name;
      onVendorChange();  // trigger duplicate check + suggested category
    }
    if (data.amount) document.getElementById('acct-amount').value = data.amount;
    if (data.currency) document.getElementById('acct-currency').value = data.currency;
    if (data.additional_info) document.getElementById('acct-desc').value = data.additional_info;
    // Default due date to 30 days out
    const due = new Date(); due.setDate(due.getDate() + 30);
    document.getElementById('acct-due').value = due.toISOString().slice(0, 10);
    toast(`QR-bill: ${data.creditor.name} · ${data.currency} ${data.amount}`);
  } catch (e) { toast(e.message, 'error'); }
  document.getElementById('qr-bill-input').value = '';
}

async function generateRecurringBills() {
  try {
    const res = await api('/accounting/generate-recurring', { method: 'POST' });
    if (res.created) toast(`Created ${res.created} recurring bill${res.created > 1 ? 's' : ''}`);
    else toast('All recurring bills up to date', 'success');
    loadAccountingDocs();
  } catch (e) { toast(e.message, 'error'); }
}

function exportAccountingZip() {
  const year = document.getElementById('acct-year-filter').value;
  if (!year) { toast('Select a year first', 'error'); return; }
  window.location.href = tokenUrl(`/api/accounting/export/${year}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// FINANCIAL OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

// Forecast page — one source of truth: /finance/forecast (cash lens).
let overviewChart = null;
function forecastQuery() {
  const inc = Prefs.get('forecast.income', null);
  const year = Prefs.get('forecast.year', new Date().getFullYear());
  const byMonth = Prefs.get('forecast.incomeByMonth', {}) || {};
  const incomes = Object.entries(byMonth).filter(([, v]) => v !== null && v !== '' && Number.isFinite(Number(v)))
    .map(([k, v]) => `${k}:${Number(v)}`).join(',');
  return `/finance/forecast?year=${encodeURIComponent(year)}`
    + (inc != null && inc !== '' ? `&income=${encodeURIComponent(inc)}` : '')
    + (incomes ? `&incomes=${encodeURIComponent(incomes)}` : '');
}
// Per-month revenue entered in the table (blank = fall back to the default).
function setForecastMonthIncome(key, v) {
  const byMonth = Object.assign({}, Prefs.get('forecast.incomeByMonth', {}) || {});
  const n = parseFloat(v);
  if (v === '' || !Number.isFinite(n)) delete byMonth[key]; else byMonth[key] = n;
  Prefs.set('forecast.incomeByMonth', byMonth);
  loadBudgetDashboard();
}
function clearForecastMonthIncomes() { Prefs.set('forecast.incomeByMonth', {}); loadBudgetDashboard(); }
function setForecastIncome(v) {
  const n = parseFloat(v);
  Prefs.set('forecast.income', Number.isFinite(n) && n >= 0 ? n : null);
  loadBudgetDashboard();
}
function setForecastYear(v) { Prefs.set('forecast.year', parseInt(v, 10) || new Date().getFullYear()); loadBudgetDashboard(); }

async function loadBudgetDashboard() {
  try {
    const fc = await api(forecastQuery());
    const incEl = document.getElementById('fc-income');
    if (incEl && document.activeElement !== incEl) incEl.value = Math.round(fc.income_monthly);
    const yEl = document.getElementById('fc-year');
    if (yEl) {
      const y0 = new Date().getFullYear();
      if (!yEl.options.length) yEl.innerHTML = [y0, y0 + 1, y0 + 2].map(y => `<option value="${y}">${y}</option>`).join('');
      yEl.value = String(fc.year);
    }

    const low = fc.lowest || {cash_end: fc.opening, label: '—'};
    const lowMod = low.cash_end < 0 ? 'danger' : (low.cash_end < fc.payroll_net ? 'warn' : 'ok');
    const stat = (label, value, mod, hint) => `
      <div class="stat${mod ? ` stat--${mod}` : ''}">
        <div class="stat__head"><span class="stat__label">${label}</span></div>
        <div class="stat__value${mod ? ` stat__value--${mod}` : ''}">${value}</div>
        ${hint ? `<div class="stat__hint">${hint}</div>` : ''}
      </div>`;
    document.getElementById('fc-stats').innerHTML =
      stat(fc.carried_from ? `Cash at start of ${fc.year}` : 'Cash today', chf(fc.opening), 'info',
           fc.carried_from ? `projected · carried from ${fc.carried_from} (bank ${chf(fc.bank_balance)} as of ${fc.as_of})` : `${fc.source} · as of ${fc.as_of}`) +
      stat('Lowest point', chf(low.cash_end), lowMod, `in ${low.label}${low.cash_end < 0 ? ' — needs income or a shareholder loan' : ''}`) +
      stat(`Cash end of ${fc.year}`, chf(fc.end_cash), fc.end_cash >= fc.opening ? 'ok' : 'warn',
           `income ${chf(fc.income_monthly)}/mo (${fc.income_source})`) +
      stat('Monthly outflow', chf(fc.months.length ? fc.months.reduce((s, m) => s + m.out, 0) / fc.months.length : 0), null,
           `avg · net salary ${chf(fc.payroll_net)} + obligations + bills + pots ${chf((fc.pots || []).reduce((t, p) => t + p.monthly_accrual, 0))}/mo`);

    document.getElementById('fc-legend').innerHTML = forecastLegend();
    const ctx = document.getElementById('fc-chart').getContext('2d');
    if (overviewChart) overviewChart.destroy();
    overviewChart = new Chart(ctx, buildForecastChartConfig(fc.months));

    document.getElementById('fc-tbody').innerHTML = fc.months.map(m => {
      const due = m.items.slice().sort((a, b) => b.amount - a.amount).slice(0, 3)
        .map(i => `${escapeHtml(i.label)} ${chf(i.amount)}`).join(' · ');
      const extra = m.items.length > 3 ? ` <span class="hint">+${m.items.length - 3} more</span>` : '';
      const incomeCell = `<input type="number" class="control forecast__cell${m.income_override ? ' forecast__cell--set' : ''}" min="0" step="100"
          value="${Math.round(m.income)}" title="${m.income_override ? 'Entered for this month — clear to use the default' : 'Default expected income — type to override this month'}"
          onchange="setForecastMonthIncome('${m.key}', this.value)">`;
      return `<tr>
        <td>${m.label}</td>
        <td class="money">${incomeCell}</td>
        <td class="money">${chf(m.payroll_net)}</td>
        <td class="money">${chf(m.obligations)}</td>
        <td class="money">${chf(m.bills)}</td>
        <td class="money">${chf(m.reserves)}</td>
        <td class="money ${m.net < 0 ? 't-danger' : 't-ok'}">${chf(m.net)}</td>
        <td class="money ${m.cash_end < 0 ? 't-danger' : ''}"><strong>${chf(m.cash_end)}</strong></td>
        <td class="hint">${due || '—'}${extra}</td>
      </tr>`;
    }).join('');

    document.getElementById('fc-assumptions').innerHTML =
      `<b>How this is built.</b> Starts from the freshest bank balance. Each month: income (the amount you typed in the row, else ${fc.income_source})
       − net salary − obligations payable this year on the date their bill is expected − unpaid and recurring bills
       − the Cash Allocation pots (${(fc.pots || []).map(p => `${escapeHtml(p.name)} ${chf(p.monthly_accrual)}/mo`).join(', ') || 'none'}).
       ${fc.pots_fund_after ? `Obligation bills landing after ${fc.pots_fund_after} are paid out of those pots, so they are not charged again.` : ''}
       VAT collected on invoices is inside the income figure and remitted via the VAT obligations.
       <a href="#" onclick="event.preventDefault();clearForecastMonthIncomes()">Clear all monthly entries</a>.`;
  } catch (e) { toast(e.message, 'error'); }
}

// Budget config
let budgetConfigData = [];

async function showBudgetConfig() {
  try {
    const cfg = await api('/budget/config');
    budgetConfigData = cfg.items.length ? cfg.items : [];

    // If empty, seed defaults
    if (!budgetConfigData.length) {
      const defaults = {
        personal_fixed: [["Rent",0],["Health Insurance",0],["Phone",0],["Internet",0],["Utilities",0]],
        business_fixed: [["Registered Agent",0],["Accounting",0],["Software",0],["Insurance",0]],
        debt: [],
        needs: [["Groceries",0],["Household",0],["Health",0],["Transportation",0]],
        wants: [["Restaurant",0],["Coffee",0],["Entertainment",0],["Shopping",0],["Leisure",0]],
        business_variable: [["Office Expenses",0],["Legal",0],["Business Travel",0]],
        savings: [["Emergency Fund",0],["Investments",0]],
      };
      for (const [grp, items] of Object.entries(defaults)) {
        for (const [sub, amt] of items) {
          budgetConfigData.push({grp, subcategory: sub, budgeted: amt});
        }
      }
    }

    renderBudgetConfig();
    document.getElementById('budget-config-modal').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

function renderBudgetConfig() {
  const groups = {};
  const groupLabels = {
    personal_fixed: 'Personal Fixed', business_fixed: 'Business Fixed',
    debt: 'Debt', needs: 'Needs', wants: 'Wants',
    business_variable: 'Business Variable', savings: 'Savings',
  };
  for (const [key, label] of Object.entries(groupLabels)) {
    groups[key] = budgetConfigData.filter(i => i.grp === key);
  }

  const container = document.getElementById('budget-config-groups');
  container.innerHTML = Object.entries(groups).map(([key, items]) => {
    const color = GROUP_COLORS[key] || '#64748b';
    const rows = items.map((it, i) => {
      const idx = budgetConfigData.indexOf(it);
      return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <input type="text" value="${it.subcategory}" onchange="budgetConfigData[${idx}].subcategory=this.value"
          style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px">
        <input type="number" value="${it.budgeted}" step="10" min="0" onchange="budgetConfigData[${idx}].budgeted=parseFloat(this.value)||0"
          style="width:100px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;text-align:right">
        <button class="btn btn--ghost btn--sm btn--icon-danger" onclick="budgetConfigData.splice(${idx},1);renderBudgetConfig()">&#128465;</button>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:10px;height:10px;border-radius:50%;background:${color}"></div>
        <strong style="font-size:14px">${groupLabels[key]}</strong>
        <button class="btn btn--ghost btn--sm" onclick="addBudgetItem('${key}')" style="margin-left:auto">+ Add</button>
      </div>
      ${rows || '<div class="hint" style="padding:4px 0">No items</div>'}
    </div>`;
  }).join('');
}

function addBudgetItem(grp) {
  budgetConfigData.push({grp, subcategory: '', budgeted: 0});
  renderBudgetConfig();
}

async function saveBudgetConfig() {
  const items = budgetConfigData.filter(i => i.subcategory.trim());
  try {
    await api('/budget/config', { method: 'POST', body: JSON.stringify({items}) });
    toast('Budget saved');
    document.getElementById('budget-config-modal').classList.remove('show');
    loadBudgetDashboard();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
