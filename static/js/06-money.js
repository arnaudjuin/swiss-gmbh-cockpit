// 06-money.js — obligations, income, transfers, shared links, search, dark mode, cash/runway, bank CSV, reserve forecast
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// OBLIGATIONS (AHV / BVG / Corporate Tax)
// ══════════════════════════════════════════════════════════════════════════════

const OBL_TYPE_LABELS = {
  ahv: 'AHV/AVS',
  bvg_employee: 'BVG Employee',
  bvg_employer: 'BVG Employer',
  corporate_tax_federal: 'Tax Federal',
  corporate_tax_cantonal: 'Tax Cantonal',
  vat: 'VAT',
  other: 'Other',
};

const OBL_TYPE_COLORS = {
  ahv: '#6366f1', bvg_employee: '#0ea5e9', bvg_employer: '#0284c7',
  corporate_tax_federal: '#ef4444', corporate_tax_cantonal: '#f97316',
  vat: '#8b5cf6', uvg: '#0d9488', ktg: '#ca8a04', source_tax: '#db2777', accounting: '#4f46e5', other: '#64748b',
};

let allObligations = [];

async function loadObligationsPage() {
  try {
    const [summary, all] = await Promise.all([
      api('/obligations/summary'),
      api('/obligations'),
    ]);
    allObligations = all;
    persistFilter('obligations', ['obl-year-filter', 'obl-type-filter', 'obl-status-filter']);

    // Derived views — everything computed from the full list so the page
    // has ONE source of truth: unpaid + due date decide the section.
    const pd = o => o.payable_date || pd(o);   // when the money leaves (see PAYABLE_SQL)
    const todayIso = new Date().toISOString().slice(0, 10);
    const in60Iso = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const yearNow = new Date().getFullYear();
    const unpaid = all.filter(o => o.status === 'unpaid');
    const overdueItems = unpaid.filter(o => pd(o) && pd(o) < todayIso)
                               .sort((a, b) => pd(a).localeCompare(pd(b)));
    const upcomingItems = unpaid.filter(o => pd(o) && pd(o) >= todayIso && pd(o) <= in60Iso)
                                .sort((a, b) => pd(a).localeCompare(pd(b)));
    const laterItems = unpaid.filter(o => pd(o) && pd(o) > in60Iso && o.period_year === yearNow);
    const paidYtd = all.filter(o => o.status === 'paid' && o.period_year === yearNow)
                       .reduce((s, o) => s + o.amount, 0);
    const remaining = unpaid.filter(o => o.period_year === yearNow).reduce((s, o) => s + o.amount, 0);
    const projectedPart = unpaid.filter(o => o.period_year === yearNow && /PROJECTED|PLACEHOLDER/i.test(o.notes || ''))
                                .reduce((s, o) => s + o.amount, 0);

    // Summary cards
    document.getElementById('obl-overdue').textContent = chf(overdueItems.reduce((s, o) => s + o.amount, 0));
    document.getElementById('obl-upcoming').textContent = chf(upcomingItems.reduce((s, o) => s + o.amount, 0));
    document.getElementById('obl-paid').textContent = chf(paidYtd);
    document.getElementById('obl-remaining').textContent = chf(remaining);
    document.getElementById('obl-remaining-hint').textContent =
      projectedPart > 0 ? `of which ${chf(projectedPart)} projected` : '';

    // Grouped due-date cards: one card per payment day, items + subtotal +
    // a single "Pay all" (cash) — the per-item Pay keeps the reserve dialog.
    const isProjected = o => /PROJECTED|PLACEHOLDER/i.test(o.notes || '');
    const dayMs = 86400000;
    const groupCards = (items, danger) => {
      const byDate = {};
      for (const o of items) (byDate[pd(o)] = byDate[pd(o)] || []).push(o);
      return Object.entries(byDate).map(([due, list]) => {
        const total = list.reduce((s, o) => s + o.amount, 0);
        const days = Math.round((new Date(due) - new Date(todayIso)) / dayMs);
        const when = danger
          ? `<span class="chip chip--danger">${-days}d late</span>`
          : `<span class="chip">${days === 0 ? 'today' : `in ${days}d`}</span>`;
        const rows = list.map(o => `
          <div class="row-split" style="padding:5px 0;border-top:1px solid var(--border)">
            <span style="flex:1;min-width:0">
              <span class="cal-dot" style="background:${OBL_TYPE_COLORS[o.obligation_type] || '#64748b'}"></span>
              ${o.type_label} <span class="hint">· ${escapeHtml(o.period_label)}</span>
              ${isProjected(o) ? '<span class="chip chip--expected chip--sm">projected</span>' : ''}
              ${o.expected_bill_date ? `<span class="hint hint--sm" title="expected invoice">· bill ~${o.expected_bill_date}${o.expected_bill_amount != null && Math.abs(o.expected_bill_amount - o.amount) > 0.05 ? ` (${chf(o.expected_bill_amount)})` : ''}</span>` : ''}
            </span>
            <span class="money">${chf(o.amount)}</span>
            <button class="btn btn--ghost btn--sm" onclick="markObligationPaid(${o.id})" title="Pay this one (cash or reserve)">Pay</button>
          </div>`).join('');
        return `<div class="panel" style="margin-bottom:8px${danger ? ';border-left:3px solid var(--danger-fill)' : ''}">
          <div class="row-split" style="margin-bottom:2px">
            <strong class="date">${due}</strong> ${when}
            <span style="flex:1"></span>
            <span class="money money--lg">${chf(total)}</span>
            ${list.length > 1 ? `<button class="btn btn--ok btn--sm" onclick="payObligationGroup([${list.map(o => o.id)}])">Pay all (${list.length})</button>` : ''}
          </div>
          ${rows}
        </div>`;
      }).join('');
    };

    const odSection = document.getElementById('obl-overdue-section');
    document.getElementById('obl-od-count').textContent = overdueItems.length;
    odSection.style.display = overdueItems.length ? '' : 'none';
    document.getElementById('obl-overdue-list').innerHTML = groupCards(overdueItems, true);

    const upList = document.getElementById('obl-upcoming-list');
    document.getElementById('obl-up-count').textContent = upcomingItems.length;
    upList.innerHTML = upcomingItems.length ? groupCards(upcomingItems, false)
      : '<p class="hint">Nothing due in the next 60 days</p>';
    document.getElementById('obl-later-hint').textContent = laterItems.length
      ? `Later this year: ${chf(laterItems.reduce((s, o) => s + o.amount, 0))} across ${laterItems.length} obligation${laterItems.length === 1 ? '' : 's'} — see the table below.`
      : '';

    // By type
    const byTypeEl = document.getElementById('obl-by-type');
    if (!summary.by_type.length) {
      byTypeEl.innerHTML = '<p class="hint">No data for this year yet</p>';
    } else {
      byTypeEl.innerHTML = summary.by_type.map(t => {
        const color = OBL_TYPE_COLORS[t.obligation_type] || '#64748b';
        const paid = t.total_ytd - t.unpaid;
        const pct = t.total_ytd > 0 ? Math.round(paid / t.total_ytd * 100) : 0;
        return `<div class="chart-card" style="padding:12px 16px;margin-bottom:8px;border-left:3px solid ${color}">
          <div class="row-split">
            <div><strong>${t.type_label}</strong> <span class="hint">(${summary.year})</span></div>
            <div style="text-align:right">
              <div class="mono">${chf(paid)} / ${chf(t.total_ytd)} paid</div>
              ${t.unpaid > 0 ? `<div class="hint hint--sm t-warn">Unpaid: ${chf(t.unpaid)}</div>` : ''}
            </div>
          </div>
          <div class="meter" style="margin-top:6px"><div class="meter__bar${pct === 100 ? ' meter__bar--ok' : ''}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('');
    }

    // Year filter
    const years = [...new Set(all.map(o => o.period_year))].sort((a,b)=>b-a);
    const yearSel = document.getElementById('obl-year-filter');
    const cur = yearSel.value;
    yearSel.innerHTML = '<option value="">All</option>' + years.map(y => `<option value="${y}"${y==cur?' selected':''}>${y}</option>`).join('');

    // Type filter
    const typeSel = document.getElementById('obl-type-filter');
    typeSel.innerHTML = '<option value="">All</option>' +
      Object.entries(OBL_TYPE_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('');

    renderObligationsList();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadObligationsList() {
  const year = document.getElementById('obl-year-filter').value;
  try {
    allObligations = await api(year ? `/obligations?year=${year}` : '/obligations');
    renderObligationsList();
  } catch (e) { toast(e.message, 'error'); }
}

function renderObligationsList() {
  const type = document.getElementById('obl-type-filter').value;
  const status = document.getElementById('obl-status-filter').value;
  let items = allObligations;
  if (type) items = items.filter(o => o.obligation_type === type);
  if (status) items = items.filter(o => o.status === status);

  const tbody = document.getElementById('obligations-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No obligations found</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(o => {
    const s = computeStatus(o.status, o.due_date);
    // "Payroll obligation: UVG (AXA)" → "UVG (AXA)"; first clause of any note
    const noteLabel = o.obligation_type === 'other' && o.notes
      ? escapeHtml(o.notes.replace(/^Payroll obligation:\s*/, '').split(/[—.;]/)[0].trim().slice(0, 40))
      : '';
    return `<tr>
      <td><strong>${o.type_label}</strong>${noteLabel ? `<div class="hint hint--sm">${noteLabel}</div>` : ''}</td>
      <td>${o.period_label}</td>
      <td>${o.due_date || '-'}</td>
      <td class="money">${o.currency} ${o.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}</td>
      <td>${o.expected_bill_date
            ? `<span class="date">${o.expected_bill_date}</span>${o.expected_bill_amount != null && Math.abs(o.expected_bill_amount - o.amount) > 0.05 ? `<div class="hint hint--sm" title="The real invoice differs from the accrual (e.g. SVA adds FAK + admin costs)">~${chf(o.expected_bill_amount)}</div>` : ''}`
            : '<span class="t-muted">—</span>'}</td>
      <td><span class="${s.cls}">${s.label}</span></td>
      <td>${o.has_file ? `<a href="${tokenUrl('/api/obligations/' + o.id + '/file')}" target="_blank" class="btn btn--ghost btn--icon">&#128196;</a>` : '-'}</td>
      <td class="text-right">
        <div class="actions">
          ${o.status === 'unpaid'
            ? `<button class="btn btn--ok btn--sm" onclick="markObligationPaid(${o.id})">Pay</button>`
            : `<button class="btn btn--ghost btn--sm" onclick="markObligationUnpaid(${o.id})">Undo</button>`}
          <button class="btn btn--ghost btn--icon" onclick="editObligation(${o.id})" title="Edit">&#9998;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteObligation(${o.id})">&#128465;</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function showObligationDialog() {
  document.getElementById('obl-edit-id').value = '';
  document.getElementById('obl-dialog-title').textContent = 'Add Obligation';
  document.querySelector('#obligation-dialog form').reset();
  document.getElementById('obl-year').value = new Date().getFullYear();
  document.getElementById('obl-currency').value = 'CHF';
  document.getElementById('obligation-dialog').classList.add('show');
  updateOblStatusPreview();
}

async function editObligation(id) {
  try {
    const o = await api(`/obligations/${id}`);
    document.getElementById('obl-edit-id').value = id;
    document.getElementById('obl-dialog-title').textContent = 'Edit Obligation';
    document.getElementById('obl-type').value = o.obligation_type;
    document.getElementById('obl-period').value = o.period_label;
    document.getElementById('obl-year').value = o.period_year;
    document.getElementById('obl-amount').value = o.amount;
    document.getElementById('obl-currency').value = o.currency;
    document.getElementById('obl-due').value = o.due_date || '';
    document.getElementById('obl-status').value = o.status;
    document.getElementById('obl-notes').value = o.notes || '';
    document.getElementById('obl-exp-date').value = o.expected_bill_date || '';
    document.getElementById('obl-exp-amount').value = o.expected_bill_amount ?? '';
    document.getElementById('obl-recurrence').value = o.recurrence || 'none';
    document.getElementById('obligation-dialog').classList.add('show');
    updateOblStatusPreview();
  } catch (e) { toast(e.message, 'error'); }
}

async function handleObligationSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('obl-edit-id').value;
  const fd = new FormData();
  fd.append('obligation_type', document.getElementById('obl-type').value);
  fd.append('period_label', document.getElementById('obl-period').value);
  fd.append('period_year', document.getElementById('obl-year').value);
  fd.append('amount', document.getElementById('obl-amount').value);
  fd.append('currency', document.getElementById('obl-currency').value);
  fd.append('due_date', document.getElementById('obl-due').value);
  fd.append('status', document.getElementById('obl-status').value);
  fd.append('notes', document.getElementById('obl-notes').value);
  fd.append('expected_bill_date', document.getElementById('obl-exp-date').value);
  const expAmt = document.getElementById('obl-exp-amount').value;
  if (expAmt !== '') fd.append('expected_bill_amount', expAmt);
  fd.append('recurrence', document.getElementById('obl-recurrence').value);
  const file = document.getElementById('obl-file').files[0];
  if (file) fd.append('doc', file);
  try {
    const url = editId ? `/api/obligations/${editId}` : '/api/obligations';
    const method = editId ? 'PUT' : 'POST';
    await fetch(url, { method, body: fd, headers: authHeaders() });
    toast(editId ? 'Obligation updated' : 'Obligation added');
    document.getElementById('obligation-dialog').classList.remove('show');
    loadObligationsPage();
  } catch (e) { toast(e.message, 'error'); }
}

async function payObligationGroup(ids) {
  if (!confirm(`Mark ${ids.length} obligations as paid (from cash)?\nUse the per-item Pay button instead if one should come out of a budget reserve.`)) return;
  try {
    for (const id of ids) {
      await api(`/obligations/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: 'paid'}) });
    }
    toast(`${ids.length} obligations marked paid`);
    loadObligationsPage();
  } catch (e) { toast(e.message, 'error'); }
}

async function markObligationPaid(id) {
  // Find the obligation (check allObligations cache)
  const ob = (allObligations || []).find(o => o.id === id);
  if (!ob) {
    // Fallback: just mark paid without dialog
    try {
      await api(`/obligations/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: 'paid'}) });
      toast('Marked paid');
      loadObligationsPage();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }

  // Open payment source dialog
  pendingPayment = ob;
  pendingPaymentType = 'obligation';
  document.getElementById('payment-source-info').innerHTML =
    `<strong>${ob.type_label}</strong> — ${ob.period_label} · ${ob.currency} ${ob.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}`;

  // Populate reserve picker + auto-suggest based on obligation type
  let suggested = null;   // 'g:<id>'
  try {
    const gmbh = await api('/reserves').catch(() => []);
    const sel = document.getElementById('reserve-picker');
    // Map obligation type to likely reserve/fund names
    const typeKeywords = {
      ahv: ['ahv', 'avs', 'pension'],
      bvg_employee: ['bvg', 'pension'],
      bvg_employer: ['bvg', 'pension'],
      corporate_tax_federal: ['gewinnsteuer', 'tax', 'impôt', 'impot'],
      corporate_tax_cantonal: ['gewinnsteuer', 'kapitalsteuer', 'tax', 'impôt', 'impot'],
      vat: ['vat', 'tva', 'mwst'],
      uvg: ['uvg', 'axa', 'unfall', 'accident', 'payroll settlement'],
      ktg: ['ktg', 'axa', 'krankentag', 'payroll settlement'],
      source_tax: ['quellensteuer', 'source tax', 'steuer'],
      accounting: ['treuhand', 'treuhand', 'accounting'],
    };
    const keywords = typeKeywords[ob.obligation_type] || [ob.obligation_type];
    const gMatch = gmbh.find(r => keywords.some(k => r.name.toLowerCase().includes(k)))
      || gmbh.find(r => r.name.toLowerCase().includes('obligation'));
    if (gMatch) suggested = `g:${gMatch.id}`;
    sel.innerHTML = gmbh.filter(r => r.accumulated > 0).map(r =>
      `<option value="g:${r.id}" ${suggested === `g:${r.id}` ? 'selected' : ''}>${r.name} — earmarked ${chf(r.accumulated)}${suggested === `g:${r.id}` ? ' ★ suggested' : ''}</option>`).join('');
  } catch {}

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

async function markObligationUnpaid(id) {
  try {
    await api(`/obligations/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: 'unpaid'}) });
    loadObligationsPage();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteObligation(id) {
  if (!confirm('Delete this obligation?')) return;
  try {
    await api(`/obligations/${id}`, { method: 'DELETE' });
    toast('Deleted');
    loadObligationsPage();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// INCOME
// ══════════════════════════════════════════════════════════════════════════════

async function loadIncome() {
  try {
    const all = await api('/income');
    // Paid invoices auto-link here and are already visible in the invoice
    // table above — this section shows only the rest.
    const items = all.filter(i => !i.invoice_id);
    const tbody = document.getElementById('income-tbody');
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nothing beyond invoices yet — refunds, credit notes or interest would appear here.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(i => `
      <tr>
        <td>${i.income_date}</td>
        <td><strong>${i.source}</strong></td>
        <td>${i.description || '-'}</td>
        <td><span class="chip">${i.category}</span></td>
        <td class="money">${i.currency} ${i.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}</td>
        <td>${i.has_file ? `<a href="${tokenUrl('/api/income/' + i.id + '/file')}" target="_blank" class="btn btn--ghost btn--icon">&#128196;</a>` : '-'}</td>
        <td class="text-right">
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteIncome(${i.id})" title="Delete">&#128465;</button>
        </td>
      </tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function handleIncomeSubmit(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('income_date', document.getElementById('inc-date').value);
  fd.append('source', document.getElementById('inc-source').value);
  fd.append('description', document.getElementById('inc-desc').value);
  fd.append('amount', document.getElementById('inc-amount').value);
  fd.append('currency', document.getElementById('inc-currency').value);
  fd.append('category', document.getElementById('inc-category').value);
  const file = document.getElementById('inc-file').files[0];
  if (file) fd.append('doc', file);
  try {
    await fetch('/api/income', { method: 'POST', body: fd, headers: authHeaders() });
    toast('Income logged');
    document.getElementById('income-dialog').classList.remove('show');
    document.querySelector('#income-dialog form').reset();
    loadIncome();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteIncome(id) {
  if (!confirm('Delete this income entry?')) return;
  try {
    await api(`/income/${id}`, { method: 'DELETE' });
    toast('Deleted');
    loadIncome();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSFERS (Personal ↔ GmbH)
// ══════════════════════════════════════════════════════════════════════════════

function exportTransfersCsv() {
  // Hidden anchor trick keeps the page state intact (toast not lost, list still rendered)
  const a = document.createElement('a');
  a.href = tokenUrl('/api/transfers/export.csv');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('Downloading transfers.csv');
}

async function loadTransfers() {
  try {
    const [items, balance] = await Promise.all([api('/transfers'), api('/transfers/balance')]);

    // Single headline: who owes whom, one number, no sign gymnastics
    const net = balance.net_owed_to_personal;
    const posEl = document.getElementById('kk-position');
    if (posEl) {
      if (Math.abs(net) < 0.005) {
        posEl.innerHTML = '<span class="t-muted">Settled — nobody owes anybody</span>';
      } else {
        posEl.innerHTML = net > 0
          ? `GmbH owes you <span class="headline-panel__value--ok">${chf(net)}</span>`
          : `You owe the GmbH <span class="headline-panel__value--danger">${chf(-net)}</span>`;
      }
    }
    const bd = document.getElementById('kk-breakdown');
    if (bd) {
      const ownerOut = balance.gmbh_to_personal - (balance.salary_transfers_excluded || 0)
                       - (balance.reimbursement_transfers_excluded || 0);
      const parts = [
        `you put in ${chf(balance.personal_to_gmbh)}`,
        `repaid to you ${chf(ownerOut)}`,
      ];
      if ((balance.personal_card_expenses || 0) > 0)
        parts.push(`fronted bills awaiting reimbursement ${chf(balance.personal_card_expenses)}`);
      bd.textContent = parts.join(' · ') + ' — salaries excluded (wages, not debt)';
    }

    const tbody = document.getElementById('transfers-tbody');
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:0;border:none">${emptyState('&#8644;', 'No transfers yet', 'Log money flowing between your personal account and the GmbH.', '+ Log Transfer', () => document.getElementById('transfer-dialog').classList.add('show'))}</td></tr>`;
      return;
    }
    // Auto-logged rows (salary, personal-card settlements) are noise for the
    // ledger — tuck them behind a toggle; owner-relevant rows stay prominent.
    const isAuto = t => /^(Net salary|Personal-card reimbursement)/.test(t.description || '');
    const main = items.filter(t => !isAuto(t));
    const auto = items.filter(isAuto);
    const autoTotal = auto.reduce((s, t) => s + t.amount, 0);
    // Running Kontokorrent per row (owner rows only): + = GmbH owes you.
    // Computed oldest→newest, displayed in the table's newest-first order.
    const balances = {};
    let run = 0;
    [...main].sort((a, b) => (a.transfer_date + a.id).localeCompare(b.transfer_date + b.id))
      .forEach(t => { run += t.direction === 'personal_to_gmbh' ? t.amount : -t.amount; balances[t.id] = run; });
    const row = (t, attrs = '') => {
      const arrow = t.direction === 'personal_to_gmbh'
        ? '<span style="color:var(--primary)">Personal &rarr; GmbH</span>'
        : '<span style="color:var(--warn-text)">GmbH &rarr; Personal</span>';
      const bal = balances[t.id];
      const balCell = bal === undefined
        ? '<td class="money" style="color:var(--text-muted)">—</td>'
        : `<td class="money" style="color:${bal >= 0 ? 'var(--ok-text)' : 'var(--danger-text)'}" title="${bal >= 0 ? 'GmbH owes you' : 'You owe the GmbH'} after this movement">${bal > 0 ? '+' : ''}${chf(bal)}</td>`;
      return `<tr ${attrs}>
        <td>${t.transfer_date}</td>
        <td>${arrow}</td>
        <td>${t.description || '-'}</td>
        <td class="money">${t.currency} ${t.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}</td>
        ${balCell}
        <td>${t.has_file ? `<a href="${tokenUrl('/api/transfers/' + t.id + '/file')}" target="_blank" class="btn btn--ghost btn--icon">&#128196;</a>` : '-'}</td>
        <td class="text-right">
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteTransfer(${t.id})" title="Delete">&#128465;</button>
        </td>
      </tr>`;
    };
    let html = main.map(t => row(t)).join('');
    if (!main.length) html = `<tr><td colspan="7" class="hint" style="text-align:center;padding:14px">No owner transfers yet — dividends, capital contributions and manual movements will appear here.</td></tr>`;
    if (auto.length) {
      html += `<tr style="cursor:pointer;background:var(--bg)" onclick="document.querySelectorAll('.xfer-auto-row').forEach(r => r.style.display = r.style.display === 'none' ? '' : 'none')">
        <td colspan="7" class="hint">&#9662; ${auto.length} auto-logged (salary &amp; reimbursements) — ${chf(autoTotal)} — click to show/hide</td>
      </tr>`;
      html += auto.map(t => row(t, 'class="xfer-auto-row" style="display:none;opacity:0.65"')).join('');
    }
    tbody.innerHTML = html;
  } catch (e) { toast(e.message, 'error'); }
}

async function handleTransferSubmit(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('transfer_date', document.getElementById('xfer-date').value);
  fd.append('direction', document.getElementById('xfer-direction').value);
  fd.append('amount', document.getElementById('xfer-amount').value);
  fd.append('currency', document.getElementById('xfer-currency').value);
  fd.append('description', document.getElementById('xfer-desc').value);
  const file = document.getElementById('xfer-file').files[0];
  if (file) fd.append('doc', file);
  try {
    await fetch('/api/transfers', { method: 'POST', body: fd, headers: authHeaders() });
    toast('Transfer logged');
    document.getElementById('transfer-dialog').classList.remove('show');
    document.querySelector('#transfer-dialog form').reset();
    loadTransfers();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteTransfer(id) {
  if (!confirm('Delete this transfer?')) return;
  try {
    await api(`/transfers/${id}`, { method: 'DELETE' });
    toast('Deleted');
    loadTransfers();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED LINKS
// ══════════════════════════════════════════════════════════════════════════════

let shareSection = 'accounting';

async function showShareModal(section) {
  shareSection = section;
  const yearSel = document.getElementById('share-year');
  try {
    const years = await api(section === 'accounting' ? '/accounting/years' : '/expenses/years');
    yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  } catch {}
  await loadShareLinks();
  document.getElementById('share-modal').classList.add('show');
}

async function loadShareLinks() {
  try {
    const links = await api('/shares');
    const filtered = links.filter(l => l.section === shareSection);
    const container = document.getElementById('share-links-list');
    if (!filtered.length) {
      container.innerHTML = '<p class="hint">No shared links yet.</p>';
      return;
    }
    container.innerHTML = filtered.map(l => {
      const url = window.location.origin + '/share/' + l.token;
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="flex:1"><strong>${l.label}</strong></span>
        <input type="text" value="${url}" readonly onclick="this.select()" style="width:220px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">
        <button class="btn btn--ghost btn--sm" onclick="copyShareLink('${url}')" title="Copy">&#128203;</button>
        <button class="btn btn--ghost btn--sm btn--icon-danger" onclick="deleteShareLink(${l.id})" title="Delete">&#128465;</button>
      </div>`;
    }).join('');
  } catch {}
}

async function createShareLink() {
  const year = parseInt(document.getElementById('share-year').value);
  if (!year) { toast('Select a year', 'error'); return; }
  try {
    const res = await api('/shares', {
      method: 'POST',
      body: JSON.stringify({ section: shareSection, year }),
    });
    const url = window.location.origin + res.url;
    toast('Share link created');
    await loadShareLinks();
  } catch (e) { toast(e.message, 'error'); }
}

function copyShareLink(url) {
  navigator.clipboard.writeText(url).then(() => toast('Link copied'));
}

async function deleteShareLink(id) {
  try {
    await api(`/shares/${id}`, { method: 'DELETE' });
    toast('Link removed');
    await loadShareLinks();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE SEARCH — one segmented search bar per list page (Bills, Invoices).
// Uses the /search query language server-side (text, "phrase", amounts,
// dates, paid/unpaid/overdue) but locked to ONE entity type, and returns the
// matching ids so the page filters its own table — nothing cross-page.
// ══════════════════════════════════════════════════════════════════════════════

const _pageSearch = {};   // type → {timer, ids: Set|null, q}

function pageSearchChips(chipsId, parsed) {
  const el = document.getElementById(chipsId);
  if (!el) return;
  const mod = {amount: 'chip--ok', date: 'chip--info', status: 'chip--warn', type: 'chip--owner'};
  el.innerHTML = (parsed || []).filter(c => c.kind !== 'type').map(c =>
    `<span class="chip chip--sm ${mod[c.kind] || ''}">${escapeHtml(c.label)}</span>`).join('');
}

// Debounced: resolves to a Set of ids (or null = no query) then calls onDone().
function pageSearchInput(type, value, chipsId, onDone) {
  const st = _pageSearch[type] || (_pageSearch[type] = {timer: null, ids: null, q: ''});
  clearTimeout(st.timer);
  st.q = (value || '').trim();
  if (st.q.length < 2) { st.ids = null; pageSearchChips(chipsId, []); onDone(); return; }
  st.timer = setTimeout(async () => {
    try {
      const data = await api(`/search?q=${encodeURIComponent('type:' + type + ' ' + st.q)}&limit=1000`);
      st.ids = new Set((data.results || []).filter(r => r.type === type).map(r => r.id));
      pageSearchChips(chipsId, data.parsed || []);
    } catch { st.ids = null; }
    onDone();
  }, 250);
}
function pageSearchIds(type) { const st = _pageSearch[type]; return st ? st.ids : null; }

// Esc clears the focused page search
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const el = document.activeElement;
  if (el && el.classList && el.classList.contains('page-search__input') && el.value) {
    el.value = ''; el.dispatchEvent(new Event('input')); e.preventDefault();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════════════════════════════════════════

function toggleTheme(e) {
  if (e) e.preventDefault();
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  applyChartTheme();
  // Charts paint token colours at build time — rebuild the ones on screen.
  const dash = document.getElementById('page-dashboard');
  if (dash && dash.classList.contains('active') && typeof loadDashboard === 'function') loadDashboard();
}
// Apply saved theme on load
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}

// ── Sidebar resize ──
function setSidebarWidth(px) {
  const w = Math.max(180, Math.min(480, px));
  document.querySelector('.sidebar').style.width = w + 'px';
  document.querySelector('.main').style.marginLeft = w + 'px';
  return w;
}
function setupSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  if (!handle || handle.dataset.bound) return;
  handle.dataset.bound = '1';

  // Apply saved width
  const saved = parseInt(localStorage.getItem('sidebar_width') || '240', 10);
  setSidebarWidth(saved);

  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = setSidebarWidth(e.clientX);
    localStorage.setItem('sidebar_width', String(w));
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Trigger chart resize to fit new layout
    if (window.Chart) Object.values(Chart.instances || {}).forEach(c => c.resize());
  });
  // Double-click to reset
  handle.addEventListener('dblclick', () => {
    setSidebarWidth(240);
    localStorage.setItem('sidebar_width', '240');
    if (window.Chart) Object.values(Chart.instances || {}).forEach(c => c.resize());
    toast('Sidebar reset');
  });
}

// Apply Chart.js global defaults (re-applied when theme toggles)
function applyChartTheme() {
  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--text-muted').trim();
  const grid = css.getPropertyValue('--viz-grid').trim();
  const text = css.getPropertyValue('--text').trim();

  Chart.defaults.color = muted;
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.animation = {
    duration: 800,
    easing: 'easeInOutQuart',
    delay: (ctx) => ctx.type === 'data' && ctx.mode === 'default'
      ? Math.min(ctx.dataIndex * 30, 300) : 0,  // staggered entry
  };
  Chart.defaults.animations = {
    colors: { type: 'color', duration: 400, easing: 'linear' },
    numbers: { type: 'number', duration: 800, easing: 'easeInOutQuart' },
  };
  Chart.defaults.transitions = {
    active: { animation: { duration: 250 } },
    resize: { animation: { duration: 0 } },
    show: { animations: {
      x: { from: 0, type: 'number' },
      y: { from: 0, type: 'number' },
    } },
    hide: { animations: {
      x: { to: 0, type: 'number' },
      y: { to: 0, type: 'number' },
    } },
  };
  Chart.defaults.plugins.tooltip = {
    ...(Chart.defaults.plugins.tooltip || {}),
    backgroundColor: isDark ? '#0f172a' : '#0f172a',
    titleColor: '#f1f5f9',
    bodyColor: '#e2e8f0',
    borderColor: grid, borderWidth: 1,
    padding: 10, cornerRadius: 6,
  };
  Chart.defaults.plugins.legend = {
    ...(Chart.defaults.plugins.legend || {}),
    labels: { color: text },
  };
  // Refresh existing charts
  Object.values(Chart.instances || {}).forEach(c => c.update('none'));
}

// Initial apply (after Chart.js loads)
if (window.Chart) applyChartTheme();
else window.addEventListener('load', applyChartTheme);

// ══════════════════════════════════════════════════════════════════════════════
// CASH BALANCE & RUNWAY
// ══════════════════════════════════════════════════════════════════════════════

async function showCashBalance() {
  try {
    const data = await api('/cash-balance');
    document.getElementById('cash-balance-input').value = data.balance;
    document.getElementById('cash-asof-input').value = data.as_of;
    document.getElementById('cash-notes-input').value = data.notes || '';
    document.getElementById('cash-balance-dialog').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

async function saveCashBalance(e) {
  e.preventDefault();
  const body = {
    balance: document.getElementById('cash-balance-input').value,
    as_of: document.getElementById('cash-asof-input').value,
    notes: document.getElementById('cash-notes-input').value,
  };
  try {
    await api('/cash-balance', { method: 'PUT', body: JSON.stringify(body) });
    toast('Cash balance updated');
    document.getElementById('cash-balance-dialog').classList.remove('show');
    loadBudgetDashboard();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// BANK CSV IMPORT
// ══════════════════════════════════════════════════════════════════════════════

function openBankCsv() {
  document.getElementById('bank-csv-results').innerHTML = '';
  document.getElementById('bank-csv-file').value = '';
  document.getElementById('bank-csv-dialog').classList.add('show');
}

async function parseBankCsv() {
  const file = document.getElementById('bank-csv-file').files[0];
  if (!file) { toast('Choose a file first', 'error'); return; }
  try {
    const text = await file.text();
    const rows = parseCsvText(text);
    if (!rows.length) { toast('No rows parsed', 'error'); return; }

    const res = await api('/bank/csv-match', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    renderBankMatches(res.rows);
  } catch (e) { toast(e.message, 'error'); }
}

function parseCsvText(text) {
  // Simple CSV parser: first line = headers, comma separated
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase());
  const findCol = (names) => headers.findIndex(h => names.some(n => h.includes(n)));
  const dateIdx = findCol(['date', 'buchungsdatum', 'valuta']);
  const descIdx = findCol(['description', 'beschreibung', 'text', 'transaction', 'libellé']);
  const amtIdx = findCol(['amount', 'betrag', 'montant']);
  if (dateIdx < 0 || amtIdx < 0) {
    toast('CSV must have Date and Amount columns', 'error');
    return [];
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(/[,;]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const amountStr = cells[amtIdx].replace(/['\s]/g, '').replace(',', '.');
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) continue;
    rows.push({
      date: cells[dateIdx],
      description: (descIdx >= 0 ? cells[descIdx] : '') || '',
      amount,
    });
  }
  return rows;
}

function renderBankMatches(rows) {
  const container = document.getElementById('bank-csv-results');
  if (!rows.length) { container.innerHTML = '<p style="color:var(--text-muted)">No rows</p>'; return; }
  container.innerHTML = `<table style="width:100%;font-size:12px">
    <thead><tr>
      <th>Date</th><th>Description</th><th class="text-right">Amount</th><th>Match</th><th></th>
    </tr></thead>
    <tbody>${rows.map((r, idx) => {
      const m = r.suggested;
      const flowClass = r.csv_row.amount < 0 ? 'color:var(--danger-text)' : 'color:var(--ok-text)';
      const matchLabel = m
        ? `${m.type}: ${m.label} (${chf(m.amount)})`
        : (r.csv_row.amount > 0 ? 'No match — log as income' : 'No match');
      const btn = m
        ? `<button class="btn btn--ok btn--sm" onclick="applyBankMatch(${idx}, '${m.type}', ${m.id})">Apply</button>`
        : (r.csv_row.amount > 0
            ? `<button class="btn btn--primary btn--sm" onclick="applyBankMatch(${idx}, 'income', null)">Log Income</button>`
            : '—');
      return `<tr data-idx="${idx}">
        <td>${r.csv_row.date}</td>
        <td>${r.csv_row.description}</td>
        <td class="money" style="${flowClass}">${chf(r.csv_row.amount)}</td>
        <td>${matchLabel}</td>
        <td>${btn}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  window._bankCsvRows = rows;
}

async function applyBankMatch(idx, type, id) {
  const row = window._bankCsvRows[idx];
  try {
    await api('/bank/apply-match', {
      method: 'POST',
      body: JSON.stringify({ type, id, csv_row: row.csv_row }),
    });
    toast('Match applied');
    // Grey-out the row
    const tr = document.querySelector(`#bank-csv-results tr[data-idx="${idx}"]`);
    if (tr) { tr.style.opacity = '0.4'; tr.querySelector('button')?.remove(); }
  } catch (e) { toast(e.message, 'error'); }
}


// ══════════════════════════════════════════════════════════════════════════════
