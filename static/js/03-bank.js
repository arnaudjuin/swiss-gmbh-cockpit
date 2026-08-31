// 03-bank.js — trips, bank statements, owner-flow, reconciliation, analyzer
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// ── Trips ──────────────────────────────────────────────────────────────────
let allTrips = [];

async function loadTrips(opts = {}) {
  try {
    allTrips = await api('/trips');
    // Populate the form dropdown
    const formSel = document.getElementById('exp-trip');
    if (formSel) {
      const cur = formSel.value;
      formSel.innerHTML = '<option value="">(none)</option>' +
        allTrips.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
      formSel.value = cur;
    }
    // Populate the filter dropdown
    const filterSel = document.getElementById('expense-trip-filter');
    if (filterSel) {
      const cur = filterSel.value;
      filterSel.innerHTML = '<option value="">All</option><option value="__none__">(no trip)</option>' +
        allTrips.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
      filterSel.value = cur;
    }
    // If on the Trips page, render it
    if (!opts.forFilter && !opts.forForm) renderTripsList();
  } catch (e) { if (!opts.silent) console.error('loadTrips failed', e); }
}

function renderTripsList() {
  const tbody = document.getElementById('trips-tbody');
  if (!tbody) return;
  if (!allTrips.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No trips yet</td></tr>';
    return;
  }
  tbody.innerHTML = allTrips.map(t => `
    <tr>
      <td class="mono">#${t.id}</td>
      <td>${escapeHtml(t.name)}${t.purpose ? `<div class="hint hint--sm">${escapeHtml(t.purpose)}</div>` : ''}</td>
      <td>${t.start_date} → ${t.end_date}</td>
      <td>${escapeHtml(t.countries || '')}</td>
      <td class="text-right">${t.expense_count}</td>
      <td class="money">${chf(t.total_chf)}</td>
      <td class="text-right">
        <div class="actions">
          <button class="btn btn--ghost btn--icon" onclick="viewTripExpenses(${t.id})" title="View expenses">&#128269;</button>
          <button class="btn btn--ghost btn--icon" onclick="autoAssignTrip(${t.id})" title="Auto-assign expenses in date range">&#128279;</button>
          <button class="btn btn--ghost btn--icon" onclick="editTrip(${t.id})" title="Edit">&#9998;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteTrip(${t.id}, '${escapeHtml(t.name).replace(/'/g,"\\'")}')" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>`).join('');
}

function viewTripExpenses(id) {
  const t = allTrips.find(x => x.id === id);
  if (!t) return;
  // Use the existing expenses filter pipeline
  navigateTo('expenses');
  setTimeout(() => {
    const filterSel = document.getElementById('expense-trip-filter');
    const yearSel = document.getElementById('expense-year-filter');
    if (filterSel) filterSel.value = String(id);
    if (yearSel) yearSel.value = '';
    applyExpenseFilters();
  }, 50);
}

async function autoAssignTrip(id) {
  if (!confirm('Auto-assign any unassigned expense whose date falls inside this trip?')) return;
  try {
    const res = await fetch(`/api/trips/${id}/auto-assign`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    toast(`${data.assigned} expense${data.assigned !== 1 ? 's' : ''} assigned`);
    await loadTrips();
    if (typeof loadExpenses === 'function') loadExpenses();
  } catch (e) { toast(e.message, 'error'); }
}

function openTripModal(trip) {
  if (!document.getElementById('trip-modal')) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="trip-modal" class="modal-overlay" onclick="if(event.target===this)closeTripModal()">
        <div class="modal">
          <div class="row-split" style="margin-bottom:12px">
            <h3 id="trip-modal-title" style="margin:0">Add trip</h3>
            <button class="btn btn--ghost btn--sm" onclick="closeTripModal()">Close</button>
          </div>
          <form id="trip-form" onsubmit="submitTripForm(event)">
            <input type="hidden" id="trip-id">
            <div class="form-grid">
              <div class="field form-grid--full">
                <label class="field__label">Name *</label>
                <input class="control" type="text" id="trip-name" required placeholder="e.g. Oman & UAE — June 2026">
              </div>
              <div class="field form-grid--full">
                <label class="field__label">Purpose</label>
                <input class="control" type="text" id="trip-purpose" placeholder="Why was this trip business-related?">
              </div>
              <div class="field">
                <label class="field__label">Start date *</label>
                <input class="control" type="date" id="trip-start" required>
              </div>
              <div class="field">
                <label class="field__label">End date *</label>
                <input class="control" type="date" id="trip-end" required>
              </div>
              <div class="field form-grid--full">
                <label class="field__label">Countries</label>
                <input class="control" type="text" id="trip-countries" placeholder="comma-separated, e.g. Oman, UAE">
              </div>
              <div class="field form-grid--full">
                <label class="field__label">Notes</label>
                <textarea class="control" id="trip-notes" rows="3" placeholder="Anything else worth remembering."></textarea>
              </div>
            </div>
            <div class="form-actions" style="margin-top:14px">
              <button type="submit" class="btn btn--primary">Save</button>
              <button type="button" class="btn btn--ghost" onclick="closeTripModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }
  document.getElementById('trip-modal-title').textContent = trip ? 'Edit trip' : 'Add trip';
  document.getElementById('trip-id').value = trip ? trip.id : '';
  document.getElementById('trip-name').value = trip ? trip.name : '';
  document.getElementById('trip-purpose').value = trip ? (trip.purpose || '') : '';
  document.getElementById('trip-start').value = trip ? trip.start_date : '';
  document.getElementById('trip-end').value = trip ? trip.end_date : '';
  document.getElementById('trip-countries').value = trip ? (trip.countries || '') : '';
  document.getElementById('trip-notes').value = trip ? (trip.notes || '') : '';
  document.getElementById('trip-modal').classList.add('show');
}

function closeTripModal() {
  const m = document.getElementById('trip-modal');
  if (m) m.classList.remove('show');
}

function editTrip(id) {
  const t = allTrips.find(x => x.id === id);
  if (t) openTripModal(t);
}

async function deleteTrip(id, name) {
  if (!confirm(`Delete trip "${name}"? Expenses will be detached but kept.`)) return;
  try {
    await fetch(`/api/trips/${id}`, { method: 'DELETE', headers: authHeaders() });
    toast('Trip deleted');
    await loadTrips();
    if (typeof loadExpenses === 'function') loadExpenses();
  } catch (e) { toast(e.message, 'error'); }
}

async function submitTripForm(ev) {
  ev.preventDefault();
  const id = document.getElementById('trip-id').value;
  const fd = new FormData();
  fd.append('name', document.getElementById('trip-name').value);
  fd.append('purpose', document.getElementById('trip-purpose').value);
  fd.append('start_date', document.getElementById('trip-start').value);
  fd.append('end_date', document.getElementById('trip-end').value);
  fd.append('countries', document.getElementById('trip-countries').value);
  fd.append('notes', document.getElementById('trip-notes').value);
  if (id) fd.append('is_active', 1);
  try {
    const url = id ? `/api/trips/${id}` : '/api/trips';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    toast(id ? 'Trip updated' : 'Trip added');
    closeTripModal();
    await loadTrips();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Bank Statements ────────────────────────────────────────────────────────
let allBankStatements = [];

async function loadBankYears() {
  try {
    const years = await api('/bank-statements/years');
    const sel = document.getElementById('bank-year-filter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All years</option>' +
      years.map(y => `<option value="${y}">${y}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (e) { console.error('loadBankYears failed', e); }
}

async function loadBankStatements() {
  try {
    const sel = document.getElementById('bank-year-filter');
    const year = sel ? sel.value : '';
    const url = year ? `/bank-statements?year=${year}` : '/bank-statements';
    allBankStatements = await api(url);
    renderBankStatements();
    // Kontokorrent runs after the initial render so the table shows immediately;
    // the card fills in above once transactions come back.
    _bankRenderKontokorrent();
  } catch (e) { toast(e.message, 'error'); }
}

// Cross-statement Kontokorrent (GmbH ↔ Personal running balance across ALL
// uploaded statements). Fetches each statement's transactions once, computes
// the non-salary flow per _bankFlowWithCounterpart, sums the total.
let _kontokorrentCache = null;   // {statementIdsHash: string, total, perStmt}
async function _bankRenderKontokorrent() {
  const container = document.getElementById('bank-kontokorrent');
  if (!container) return;
  const withXml = (allBankStatements || []).filter(s => s.has_xml);
  if (!withXml.length) { container.innerHTML = ''; return; }
  // Company expenses fronted on the owner's personal card and NOT yet
  // reimbursed — part of the Kontokorrent even though they never appear in
  // any bank statement. (Reimbursed ones settled via a logged transfer.)
  let personalCardTotal = 0;
  let reportsFrontedTotal = 0;
  let ownerInTransfers = [];
  try {
    const bills = await api('/accounting');
    personalCardTotal = bills.filter(b => b.paid_via === 'personal' && !b.reimbursed_at)
                             .reduce((s, b) => s + b.amount, 0);
    // Travel expense reports fronted privately and not yet reimbursed count
    // as Kontokorrent debt too (same as /transfers/balance).
    try {
      const out = await api('/accounting/personal-card/outstanding');
      reportsFrontedTotal = (out.reports || []).reduce((s, r) => s + r.amount, 0);
    } catch (e) {}
    // Logged Personal → GmbH transfers: bank credits matching them are owner
    // money-in (GmbH owes it back), not customer revenue.
    ownerInTransfers = (await api('/transfers')).filter(t => t.direction === 'personal_to_gmbh');
  } catch (e) { /* accounting unavailable — show bank-only balance */ }
  const ownerInHash = ownerInTransfers.reduce((s, t) => s + t.amount, 0).toFixed(2);
  const idsHash = withXml.map(s => s.id).sort((a, b) => a - b).join(',')
    + '|pc:' + personalCardTotal.toFixed(2) + '|oi:' + ownerInHash;
  // Fetch fresh: if the set of statements changed, invalidate.
  if (!_kontokorrentCache || _kontokorrentCache.idsHash !== idsHash) {
    container.innerHTML = `<div class="table-card hint" style="padding:10px 14px">Computing running Kontokorrent balance across ${withXml.length} statement${withXml.length === 1 ? '' : 's'}…</div>`;
    try {
      const payroll = await _bankGetPayrollMeta();
      // Fetch expense reports once (they're global, not per-statement)
      const expenseReports = await api('/expenses/reports').catch(() => []);
      const perStmt = [];
      for (const s of withXml) {
        const cached = _bankDetailData[s.id];
        let d;
        if (cached && cached.transactions) d = cached;
        else {
          d = await api(`/bank-statements/${s.id}/transactions`).catch(() => null);
        }
        if (!d || !d.transactions) continue;
        const aw = _bankFlowWithCounterpart(d.transactions, payroll);
        // Reimbursement pass-through interpretation:
        //   Acme pays GmbH → GmbH holds cash that BELONGS TO Max → GmbH owes Max reim.total
        //   Non-salary payments from GmbH to Max → SETTLE part of that debt
        //   Residual owed to Max (positive value) = reim.total − |non-salary paid|
        //
        // In the Kontokorrent sign convention where NEGATIVE = "GmbH owes Max":
        //   - When reimbursement exists on the GmbH account, the non-salary transfer
        //     is a settlement, not a new debt → net balance = |non-salary| − reim.total
        //   - Without reimbursement, keep the historical convention (bank sign is
        //     naturally negative on the GmbH side; already reads as "GmbH owes")
        const reim = _bankReconcileReimbursements(d.transactions, expenseReports);
        let netBalance;
        if (aw.accountSide === 'gmbh' && reim.total > 0) {
          netBalance = Math.abs(aw.nonSalarySum) - reim.total;
        } else {
          netBalance = aw.nonSalarySum;
        }
        perStmt.push({
          statement: s,
          transactions: d.transactions,
          nonSalary: aw.nonSalarySum,
          reimbursement: reim.total,
          reimSigs: new Set((reim.matches || []).map(m => `${(m.outflow.date || '').slice(0,10)}|${m.outflow.amount}`)),
          netBalance,
          intraCompany: aw.intraCompanySum,
          salary: aw.salarySum,
          count: aw.count,
          accountSide: aw.accountSide,
        });
      }
      // Owner contributions: bank credits matching logged Personal → GmbH
      // transfers (amount ±0.05, date ±10 d), matched once each.
      const consumed = new Set();
      let ownerInMatched = 0;
      for (const s of perStmt) {
        for (const tx of s.transactions || []) {
          const amt = parseFloat(tx.amount || 0);
          if (amt <= 0) continue;
          // A credit already matched to an expense report is the client's
          // reimbursement — never double-count it as an owner contribution.
          if (s.reimSigs && s.reimSigs.has(`${(tx.date || '').slice(0,10)}|${tx.amount}`)) continue;
          const txd = new Date((tx.date || '').slice(0, 10));
          for (let i = 0; i < ownerInTransfers.length; i++) {
            if (consumed.has(i)) continue;
            const t = ownerInTransfers[i];
            if (Math.abs(t.amount - amt) <= 0.05
                && Math.abs((txd - new Date(t.transfer_date)) / 86400000) <= 10) {
              consumed.add(i); ownerInMatched += amt; break;
            }
          }
        }
      }
      // Personal-card expenses + owner contributions: NEGATIVE in this sign
      // convention (GmbH owes Max)
      const total = perStmt.reduce((s, x) => s + x.netBalance, 0) - personalCardTotal - ownerInMatched - reportsFrontedTotal;
      const totalReim = perStmt.reduce((s, x) => s + x.reimbursement, 0);
      _kontokorrentCache = {idsHash, total, totalReim, perStmt, personalCardTotal, ownerInMatched, reportsFrontedTotal};
    } catch (e) {
      container.innerHTML = `<div class="table-card" style="padding:10px 14px;color:var(--danger-text);font-size:12px">Kontokorrent computation failed: ${escapeHtml(e.message || e)}</div>`;
      return;
    }
  }
  const {total, perStmt, personalCardTotal: pcTotal = 0, ownerInMatched: oiTotal = 0, reportsFrontedTotal: rfTotal = 0} = _kontokorrentCache;
  if (!perStmt.length) {
    container.innerHTML = '<div class="hint">No machine-readable bank statements to verify against yet.</div>';
    return;
  }
  // The ledger headline above is THE number; this line only verifies it
  // against what the bank statements imply (bank convention: negative =
  // GmbH owes the owner → flip sign to compare).
  const bankOwed = -total;
  let ledgerOwed = null;
  try { ledgerOwed = (await api('/transfers/balance')).net_owed_to_personal; } catch (e) {}
  const matches = ledgerOwed !== null && Math.abs(bankOwed - ledgerOwed) < 0.01;
  // Reconciliation waterfall in "what the GmbH owes you" terms (+ = owes you
  // more). Every row is plain language; the total equals the headline.
  const multi = perStmt.length > 1;
  const wRow = (label, val, opts = {}) => `<tr style="border-top:1px solid var(--border)">
    <td style="padding:4px 8px;${opts.indent ? 'padding-left:20px;' : ''}${opts.muted ? 'color:var(--text-muted);' : ''}">${label}</td>
    <td class="money" style="padding:4px 8px;${opts.bold ? 'font-weight:700;' : ''}${val > 0 ? 'color:var(--ok-text)' : val < 0 ? 'color:var(--danger-text)' : 'color:var(--text-muted)'}">${val === 0 ? chf(0) : (val > 0 ? '+' : '−') + chf(Math.abs(val))}</td>
  </tr>`;
  let wRows = '';
  let salaryExcluded = 0;
  for (const x of perStmt) {
    salaryExcluded += Math.abs(x.salary || 0);
    const period = `${escapeHtml(x.statement.period_start)} → ${escapeHtml(x.statement.period_end)}`;
    if (multi) wRows += `<tr><td colspan="2" style="padding:6px 8px 2px;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.04em">Statement ${period}</td></tr>`;
    if (x.reimbursement > 0) {
      wRows += wRow('Travel reimbursements the GmbH collected on your behalf', x.reimbursement, {indent: multi});
      wRows += wRow('Non-salary payments back to you', -Math.abs(x.nonSalary), {indent: multi});
    } else {
      wRows += wRow('Net owner flow in this statement', -x.netBalance, {indent: multi});
    }
  }
  if (oiTotal > 0) wRows += wRow('Contributions you paid in from private accounts (matched to ledger)', oiTotal);
  if (pcTotal > 0) wRows += wRow('Bills you fronted privately, awaiting reimbursement (not in any statement)', pcTotal);
  if (rfTotal > 0) wRows += wRow('Travel expense reports you fronted, awaiting reimbursement', rfTotal);
  const detailsHtml = `<details style="font-size:11px;display:inline-block;margin-left:10px">
    <summary style="cursor:pointer;color:var(--primary)">how it's calculated</summary>
    <table style="font-size:11.5px;margin-top:6px;min-width:420px;max-width:640px">
      <thead><tr style="color:var(--text-muted)">
        <th style="text-align:left;padding:3px 8px">Component (+ = GmbH owes you more)</th>
        <th style="text-align:right;padding:3px 8px">Effect</th>
      </tr></thead>
      <tbody>
        ${wRows}
        <tr style="border-top:2px solid var(--border)">
          <td style="padding:5px 8px;font-weight:700">= GmbH owes you (per bank data)</td>
          <td class="money" style="padding:5px 8px;font-weight:700;color:${bankOwed >= 0 ? 'var(--ok-text)' : 'var(--danger-text)'}">${chf(bankOwed)}</td>
        </tr>
        ${matches
          ? `<tr><td colspan="2" style="padding:3px 8px;color:var(--ok-text)">&#10003; equals the ledger headline above</td></tr>`
          : (ledgerOwed !== null
              ? wRow('Ledger says', ledgerOwed, {bold: true}) + wRow('Unexplained difference', ledgerOwed - bankOwed, {bold: true})
              : '')}
        ${salaryExcluded > 0 ? `<tr><td colspan="2" style="padding:3px 8px;color:var(--text-muted)">Salary payments of ${chf(salaryExcluded)} are excluded throughout — wages, not Kontokorrent.</td></tr>` : ''}
      </tbody>
    </table>
  </details>`;
  if (matches) {
    container.innerHTML = `<div class="headline-panel__verify headline-panel__verify--ok">
      &#10003; Verified against ${perStmt.length} bank statement${perStmt.length === 1 ? '' : 's'} — ledger and bank data agree.${detailsHtml}</div>`;
  } else if (ledgerOwed !== null) {
    const diff = ledgerOwed - bankOwed;
    container.innerHTML = `<div class="headline-panel__verify headline-panel__verify--warn">
      &#9888; Bank statements imply ${bankOwed >= 0 ? 'GmbH owes you ' + chf(bankOwed) : 'you owe ' + chf(-bankOwed)} —
      difference of ${chf(Math.abs(diff))} vs the ledger. Likely an unlogged movement (run Analyze on the latest statement) or a payment not yet on a statement.${detailsHtml}</div>`;
  } else {
    container.innerHTML = '';
  }
}

function renderBankStatements() {
  const tbody = document.getElementById('bank-tbody');
  const summary = document.getElementById('bank-summary');
  if (!tbody) return;
  if (!allBankStatements.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No bank statements yet — upload your first UBS statement to get started</td></tr>';
    if (summary) summary.innerHTML = '';
    return;
  }
  // Summary line: most recent closing balance
  const latest = allBankStatements[0];
  if (summary && latest && latest.closing_balance !== null) {
    summary.innerHTML = `<div class="table-card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:baseline">
      <div><b>Latest balance (${latest.period_end}):</b> <span class="mono" style="font-size:16px;font-weight:600">${latest.currency === 'CHF' ? chf(latest.closing_balance) : latest.currency + ' ' + latest.closing_balance.toLocaleString('de-CH', {minimumFractionDigits: 2})}</span></div>
      <div class="hint">${escapeHtml(latest.bank)} · ${escapeHtml(latest.account_label || '')}</div>
    </div>`;
  }
  tbody.innerHTML = allBankStatements.map(s => {
    const expandable = s.has_xml; // only XML/CSV gives parseable transactions
    const cursor = expandable ? 'cursor:pointer' : '';
    return `
    <tr id="bank-row-${s.id}" ${expandable ? `onclick="toggleBankRow(${s.id})"` : ''} style="${cursor}">
      <td class="hint" style="text-align:center" id="bank-chevron-${s.id}">${expandable ? '▶' : ''}</td>
      <td><span class="mono">${s.period_start}</span> → <span class="mono">${s.period_end}</span></td>
      <td>${escapeHtml(s.bank)}</td>
      <td>${escapeHtml(s.account_label || '')}${s.iban ? `<div style="font-size:10px;color:var(--text-muted)" class="mono">${escapeHtml(s.iban)}</div>` : ''}</td>
      <td class="money">${s.opening_balance !== null ? chf(s.opening_balance) : '—'}</td>
      <td class="money"><b>${s.closing_balance !== null ? chf(s.closing_balance) : '—'}</b></td>
      <td class="hint hint--sm">${escapeHtml(s.notes || '')}</td>
      <td class="text-right" onclick="event.stopPropagation()">
        <div class="actions">
          ${(s.has_xml || s.has_pdf) ? `<button class="btn btn--ghost btn--icon" onclick="analyzeBankStatement(${s.id})" title="Analyze — propose data corrections from this statement">&#128269;</button>` : ''}
          ${s.has_pdf ? `<a href="${tokenUrl(`/api/bank-statements/${s.id}/file?format=pdf`)}" target="_blank" class="btn btn--ghost btn--icon" title="Open PDF">&#128196;</a>` : '<span class="hint hint--sm" style="padding:0 4px" title="No PDF">PDF—</span>'}
          ${s.has_xml ? `<a href="${tokenUrl(`/api/bank-statements/${s.id}/file?format=xml`)}" target="_blank" class="btn btn--ghost btn--icon" title="Open XML / CAMT.053 / CSV" style="font-weight:600;font-size:10px">XML</a>` : '<span class="hint hint--sm" style="padding:0 4px" title="No XML">XML—</span>'}
          <button class="btn btn--ghost btn--icon" onclick="editBankStatement(${s.id})" title="Edit">&#9998;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteBankStatement(${s.id}, '${escapeHtml(s.period_start)} → ${escapeHtml(s.period_end)}')" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openBankModal(s) {
  if (!document.getElementById('bank-modal')) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="bank-modal" class="modal-overlay" onclick="if(event.target===this)closeBankModal()">
        <div class="modal">
          <div class="row-split" style="margin-bottom:12px">
            <h3 id="bank-modal-title" style="margin:0">Upload bank statement</h3>
            <button class="btn btn--ghost btn--sm" onclick="closeBankModal()">Close</button>
          </div>
          <form id="bank-form" onsubmit="submitBankForm(event)">
            <input type="hidden" id="bank-id">
            <div class="form-grid">
              <div class="field">
                <label class="field__label">Bank</label>
                <input class="control" type="text" id="bank-name" value="UBS" required>
              </div>
              <div class="field">
                <label class="field__label">Account label</label>
                <input class="control" type="text" id="bank-account" placeholder="e.g. GmbH Main CHF">
              </div>
              <div class="field form-grid--full">
                <label class="field__label">IBAN</label>
                <input class="control" type="text" id="bank-iban" placeholder="CH00...">
              </div>
              <div class="field">
                <label class="field__label">Period start *</label>
                <input class="control" type="date" id="bank-period-start" required>
              </div>
              <div class="field">
                <label class="field__label">Period end *</label>
                <input class="control" type="date" id="bank-period-end" required>
              </div>
              <div class="field">
                <label class="field__label">Type</label>
                <select class="control" id="bank-type">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="camt053">CAMT.053 (XML)</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label">Currency</label>
                <input class="control" type="text" id="bank-currency" value="CHF">
              </div>
              <div class="field">
                <label class="field__label">Opening balance</label>
                <input class="control" type="number" id="bank-opening" step="0.01">
              </div>
              <div class="field">
                <label class="field__label">Closing balance</label>
                <input class="control" type="number" id="bank-closing" step="0.01">
              </div>
              <div class="field">
                <label class="field__label">PDF statement (official)</label>
                <input type="file" id="bank-file-pdf" accept=".pdf">
              </div>
              <div class="field">
                <label>XML / CAMT.053 <span class="hint hint--sm">(auto-fills fields)</span></label>
                <input type="file" id="bank-file-xml" accept=".xml" onchange="autoParseXml(this)">
              </div>
              <div id="bank-xml-preview" class="hint hint--sm" style="grid-column:1/-1"></div>
              <div class="field form-grid--full">
                <label class="field__label">Notes</label>
                <textarea class="control" id="bank-notes" rows="2"></textarea>
              </div>
            </div>
            <div class="form-actions" style="margin-top:14px">
              <button type="submit" class="btn btn--primary">Save</button>
              <button type="button" class="btn btn--ghost" onclick="closeBankModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }
  document.getElementById('bank-modal-title').textContent = s ? 'Edit bank statement' : 'Upload bank statement';
  document.getElementById('bank-id').value = s ? s.id : '';
  document.getElementById('bank-name').value = s ? s.bank : 'UBS';
  document.getElementById('bank-account').value = s ? (s.account_label || '') : '';
  document.getElementById('bank-iban').value = s ? (s.iban || '') : '';
  document.getElementById('bank-period-start').value = s ? s.period_start : '';
  document.getElementById('bank-period-end').value = s ? s.period_end : '';
  document.getElementById('bank-type').value = s ? s.statement_type : 'monthly';
  document.getElementById('bank-currency').value = s ? s.currency : 'CHF';
  document.getElementById('bank-opening').value = s && s.opening_balance !== null ? s.opening_balance : '';
  document.getElementById('bank-closing').value = s && s.closing_balance !== null ? s.closing_balance : '';
  document.getElementById('bank-notes').value = s ? (s.notes || '') : '';
  const fp = document.getElementById('bank-file-pdf');
  const fx = document.getElementById('bank-file-xml');
  if (fp) fp.value = '';
  if (fx) fx.value = '';
  const prev = document.getElementById('bank-xml-preview');
  if (prev) prev.innerHTML = '';
  document.getElementById('bank-modal').classList.add('show');
}

async function autoParseXml(input) {
  const f = input.files[0];
  const prev = document.getElementById('bank-xml-preview');
  if (!f) { if (prev) prev.innerHTML = ''; return; }
  if (prev) prev.innerHTML = '<em>Parsing CAMT.053…</em>';
  const fd = new FormData();
  fd.append('file', f);
  try {
    const res = await fetch('/api/bank-statements/parse-xml',
      { method: 'POST', body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const p = await res.json();
    if (p.error) {
      if (prev) prev.innerHTML = `<span style="color:var(--danger-text)">${escapeHtml(p.error)}</span>`;
      return;
    }
    // Auto-fill empty fields
    const setIfEmpty = (id, value) => {
      const el = document.getElementById(id);
      if (el && !el.value && value !== undefined && value !== null && value !== '') {
        el.value = value;
      }
    };
    setIfEmpty('bank-period-start', p.period_start);
    setIfEmpty('bank-period-end', p.period_end);
    setIfEmpty('bank-iban', p.iban);
    setIfEmpty('bank-currency', p.currency);
    if (p.opening_balance !== undefined && p.opening_balance !== null) {
      setIfEmpty('bank-opening', p.opening_balance);
    }
    if (p.closing_balance !== undefined && p.closing_balance !== null) {
      setIfEmpty('bank-closing', p.closing_balance);
    }
    if (prev) {
      const parts = [];
      if (p.period_start && p.period_end) parts.push(`📅 ${p.period_start} → ${p.period_end}`);
      if (p.iban) parts.push(`🏦 ${p.iban}`);
      if (p.currency) parts.push(`${p.currency}`);
      if (p.opening_balance !== undefined) parts.push(`open ${chf(p.opening_balance)}`);
      if (p.closing_balance !== undefined) parts.push(`close ${chf(p.closing_balance)}`);
      if (p.transaction_count !== undefined) parts.push(`${p.transaction_count} transactions`);
      prev.innerHTML = '<span style="color:var(--ok-text)">✓ Auto-filled from XML — </span>' + escapeHtml(parts.join(' · '));
    }
  } catch (e) {
    if (prev) prev.innerHTML = `<span style="color:var(--danger-text)">${escapeHtml(e.message)}</span>`;
  }
}

function closeBankModal() {
  const m = document.getElementById('bank-modal');
  if (m) m.classList.remove('show');
}

function editBankStatement(id) {
  const s = allBankStatements.find(x => x.id === id);
  if (s) openBankModal(s);
}

async function deleteBankStatement(id, label) {
  if (!confirm(`Delete bank statement for ${label}?`)) return;
  try {
    await fetch(`/api/bank-statements/${id}`, { method: 'DELETE', headers: authHeaders() });
    toast('Statement deleted');
    await loadBankYears();
    await loadBankStatements();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Bank statement: inline expandable transaction details ────────────────
// Click a row → fetch its transactions → insert a detail row below it.
// Click again to collapse.

const _bankDetailFilters = {}; // {statementId: 'all'|'in'|'out'}
const _bankDetailData = {};    // {statementId: parsed transactions response}

async function toggleBankRow(id) {
  const existing = document.getElementById(`bank-detail-${id}`);
  const chev = document.getElementById(`bank-chevron-${id}`);
  if (existing) {
    existing.remove();
    if (chev) chev.textContent = '▶';
    return;
  }
  if (chev) chev.textContent = '▼';
  // Insert a placeholder row right after the clicked row
  const mainRow = document.getElementById(`bank-row-${id}`);
  if (!mainRow) return;
  const colspan = mainRow.children.length;
  const tr = document.createElement('tr');
  tr.id = `bank-detail-${id}`;
  tr.innerHTML = `<td colspan="${colspan}" style="padding:0;background:rgba(0,0,0,0.02)">
    <div id="bank-detail-body-${id}" style="padding:14px 20px">
      <div class="hint">Loading transactions…</div>
    </div></td>`;
  mainRow.parentNode.insertBefore(tr, mainRow.nextSibling);
  try {
    const [d, payroll, obligations, expenseReports] = await Promise.all([
      api(`/bank-statements/${id}/transactions`),
      _bankGetPayrollMeta(),
      api('/obligations').catch(() => []),
      api('/expenses/reports').catch(() => []),
    ]);
    if (d.error) {
      document.getElementById(`bank-detail-body-${id}`).innerHTML =
        `<div style="color:var(--danger-text);font-size:12px">${escapeHtml(d.error)}</div>`;
      return;
    }
    _bankDetailData[id] = d;
    _bankDetailData[id].payrollMeta = payroll;
    _bankDetailData[id].obligations = obligations || [];
    _bankDetailData[id].expenseReports = expenseReports || [];
    _bankDetailFilters[id] = _bankDetailFilters[id] || 'all';
    renderBankDetail(id);
  } catch (e) {
    document.getElementById(`bank-detail-body-${id}`).innerHTML =
      `<div style="color:var(--danger-text);font-size:12px">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function filterBankDetail(id, mode) {
  _bankDetailFilters[id] = mode;
  renderBankDetail(id);
}

// "Who owes what" — counterparty summary helpers
const _bankCounterpartyHide = {}; // id → bool (default true = hide routine)

function _bankIsRoutinePayroll(t) {
  // Skip salary, source tax, social charges, pension — anything that
  // makes a regular paycheck-style movement we don't want in "who owes what".
  const hay = `${t.counterparty || ''} ${t.description || ''}`.toLowerCase();
  // No trailing \b → match German compounds (Lohnzahlung, Gehaltsabrechnung, Pensionskasse)
  return /\b(salaire|salary|salaer|lohn|gehalt|wage|paie|payroll)/.test(hay)
      || /\b(quellensteuer|source.?tax|withhold|imp[oô]t.{0,8}source)/.test(hay)
      || /\b(ahv|avs|alv|aho|apg|caf|cas)\b/.test(hay)
      || /\b(bvg|lpp|pension|retirement|pr[eé]voyance|pilier|s[aä]ule|2e?\.?\s?(pilier|pillar|s[aä]ule))/.test(hay)
      || /\b(uvg|laa|suva|krankentag)/.test(hay)
      || /\b(3a|pillar.?3|pilier.?3|s[aä]ule.?3)\b/.test(hay)
      || /\b(vat|tva|mwst|iva)\b/.test(hay);
}

// ── Muster Consulting ↔ personal account flow ───────────────────────────────────
// One headline number: net money moved with Muster Consulting, minus the expected
// salary for the period (configured net salary × pay periods in the statement).
let _payrollPreviewCache = null;
async function _bankGetPayrollMeta() {
  if (_payrollPreviewCache !== null) return _payrollPreviewCache;
  try {
    const p = await api('/payroll/preview');
    const settings = p?.settings || {};
    // Salary candidates: current net + per-day sums of GmbH→Personal
    // transfers on 'Net salary' days. After a retroactive salary change the
    // ledger splits an old payment (new net + Kontokorrent repayment) while
    // the bank line keeps the original amount — the day-sum matches it.
    let candidates = [];
    try {
      const transfers = await api('/transfers');
      const salDates = new Set(transfers.filter(t => (t.description || '').startsWith('Net salary')).map(t => t.transfer_date));
      const byDate = {};
      for (const t of transfers) {
        if (t.direction === 'gmbh_to_personal' && salDates.has(t.transfer_date)) {
          const e = byDate[t.transfer_date] || (byDate[t.transfer_date] = {total: 0, salary: 0});
          e.total += t.amount;
          if ((t.description || '').startsWith('Net salary')) e.salary += t.amount;
        }
      }
      // Day-sum candidates carry their ledger DATE: a bank line may match
      // only within ±7 days of it (amount ±10%) — that separates a salary
      // chunk paid a few days late from an unrelated withdrawal weeks away.
      candidates = Object.entries(byDate)
        .map(([date, e]) => ({date, total: Math.round(e.total * 100) / 100, salary: Math.round(e.salary * 100) / 100}));
    } catch (e) {}
    _payrollPreviewCache = {
      monthlyNet: p?.calculation?.net_salary || 0,
      salaryCandidates: candidates,
      employeeName: (settings.employee_name || '').trim(),
      employerName: (settings.employer_name || '').trim(),
      payDay: Number(settings.payment_day) || 25,
    };
  } catch { _payrollPreviewCache = {monthlyNet: 0, salaryCandidates: [], employeeName: '', employerName: '', payDay: 25}; }
  return _payrollPreviewCache;
}
function _bankPayPeriodsInStatement(startStr, endStr, payDay = 25) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T23:59:59');
  if (isNaN(start) || isNaN(end)) return 0;
  let count = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const day = Math.min(payDay, new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate());
    const candidate = new Date(cur.getFullYear(), cur.getMonth(), day);
    if (candidate >= start && candidate <= end) count++;
    cur.setMonth(cur.getMonth() + 1);
  }
  return count;
}

// Persistent ignore-list: transactions the user has explicitly excluded
// from the Muster Consulting flow calc (e.g. founding capital injection).
function _bankIgnoreSig(t) {
  return `${t.date || ''}|${(t.amount || 0).toFixed(2)}|${(t.counterparty || '').toLowerCase().trim()}`;
}
function _bankGetIgnoreSet() {
  return new Set(Prefs.get('bankFlowIgnored', []));
}
function _bankToggleIgnore(date, amount, counterparty, statementId) {
  const set = _bankGetIgnoreSet();
  const sig = _bankIgnoreSig({date, amount: Number(amount), counterparty});
  if (set.has(sig)) set.delete(sig); else set.add(sig);
  Prefs.set('bankFlowIgnored', [...set]);
  renderBankDetail(statementId);
}

// Detect the "other side" of the GmbH ↔ Personal relationship by looking
// at which counterparty matches the employee name OR "Muster Consulting".
// Whichever has activity wins. If both, we use both (handles odd accounts).
function _bankFlowWithCounterpart(transactions, payroll) {
  const monthlyNet = payroll?.monthlyNet || 0;
  const employee   = (payroll?.employeeName || '').toLowerCase().trim();
  const employer   = (payroll?.employerName || 'Muster Consulting').toLowerCase().trim();
  const payDay     = payroll?.payDay || 25;
  const flat = [];
  for (const t of transactions || []) {
    flat.push(t);
    if (t.sub_entries) for (const s of t.sub_entries) flat.push(s);
  }
  // Build the set of "other side" name patterns. The account holder is
  // implicit (the counterparty rows won't reference themselves under their
  // own name). So whichever pattern hits = the other side.
  const empTokens = employee.split(/\s+/).filter(t => t.length >= 4);
  const firstToken = empTokens[0] || '';  // distinctive first-name token
  const matchesEmployee = (cp) => {
    if (!employee) return false;
    const c = (cp || '').toLowerCase();
    if (empTokens.length < 2) return c.includes(employee);
    // Require the first-name token to appear (filters out relatives who
    // share only the surname), AND at least 2 tokens to match overall.
    if (firstToken && !c.includes(firstToken)) return false;
    return empTokens.filter(t => c.includes(t)).length >= 2;
  };
  const matchesEmployer = (cp) => {
    if (!employer) return false;
    return (cp || '').toLowerCase().includes(employer);
  };
  // First pass: detect which side the account is on (more employee-name
  // hits → this is the GmbH account; more employer-name hits → personal).
  const empHitsAll  = flat.filter(t => matchesEmployee(t.counterparty));
  const emprHitsAll = flat.filter(t => matchesEmployer(t.counterparty));
  const sideFromCounterparties = empHitsAll.length > emprHitsAll.length ? 'gmbh' : 'personal';

  // Once we know the side, "other side" = OPPOSITE counterparty only.
  // GmbH account → personal-name entries (you receiving salary etc).
  // Personal account → employer-name entries (Muster Consulting paying you).
  // Same-side entries (e.g. Muster Consulting → Muster Consulting on the GmbH account)
  // are intra-company transfers (Sperrkonto → operating, savings → checking)
  // and shouldn't pollute the personal-flow calc.
  const isOtherSide = (t) => {
    const cp = t.counterparty || '';
    return sideFromCounterparties === 'gmbh'
      ? matchesEmployee(cp)
      : matchesEmployer(cp);
  };
  const intraCompanyHits = flat.filter(t => {
    const cp = t.counterparty || '';
    if (sideFromCounterparties === 'gmbh') return matchesEmployer(cp) && !matchesEmployee(cp);
    return matchesEmployee(cp) && !matchesEmployer(cp);
  });

  const ignored     = _bankGetIgnoreSet();
  const allMatched  = flat.filter(isOtherSide);
  const ignoredHits = allMatched.filter(t => ignored.has(_bankIgnoreSig(t)));
  const matched     = allMatched.filter(t => !ignored.has(_bankIgnoreSig(t)));

  // Salary-like = magnitude within ±10% of monthly net, payment date near
  // the configured payday (±5 days). Direction-agnostic so it works on
  // BOTH the personal account (salary comes IN, positive) AND the GmbH
  // account (salary goes OUT, negative).
  const salaryCandidates = [...(payroll?.salaryCandidates || [])];
  if (monthlyNet) salaryCandidates.push({date: null, total: monthlyNet, salary: monthlyNet});
  // Returns the matched candidate (with its salary portion) or null. A line
  // can be PART salary, part Kontokorrent repayment after a retro change.
  const salaryCandidateFor = (t) => {
    const amt = Math.abs(t.amount || 0);
    const tDate = new Date((t.date || '').slice(0, 10));
    return salaryCandidates.find(c => {
      if (Math.abs(amt - c.total) > Math.max(100, c.total * 0.10)) return false;
      if (!c.date) return true;   // settings-net: payday window checked by the caller
      return Math.abs((tDate - new Date(c.date)) / 86400000) <= 7;
    }) || null;
  };
  const looksLikeSalary = (t) => {
    if (!salaryCandidates.length) return false;
    if (!salaryCandidateFor(t)) return false;
    if (!t.date) return false;
    const d = new Date(t.date + 'T00:00:00');
    if (isNaN(d)) return false;
    const dayDiff = Math.abs(d.getDate() - payDay);
    return dayDiff <= 7 || dayDiff >= 23;   // near payday in either direction
  };
  const salaryHits = matched.filter(looksLikeSalary);
  const nonSalary  = matched.filter(t => !looksLikeSalary(t));

  const sum          = matched.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  // Split partial-salary lines: only the ledger's salary portion counts as
  // wages; the remainder (retro-reclassified overpayment) is owner flow.
  let salarySum = 0, salaryRemainder = 0;
  for (const t of salaryHits) {
    const cand = salaryCandidateFor(t);
    const amt = Math.abs(Number(t.amount) || 0);
    const part = cand ? Math.min(amt, cand.salary) : amt;
    salarySum += Math.sign(Number(t.amount) || 0) * part;
    salaryRemainder += (amt - part) * Math.sign(Number(t.amount) || 0);
  }
  const nonSalarySum = nonSalary.reduce((s, t) => s + (Number(t.amount) || 0), 0) + salaryRemainder;
  const ignoredSum   = ignoredHits.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const accountSide = sideFromCounterparties;
  const otherSideLabel = accountSide === 'gmbh'
    ? (payroll?.employeeName || 'employee personal account')
    : (payroll?.employerName || 'Muster Consulting GmbH');
  const intraCompanySum = intraCompanyHits.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  return {
    transactions: matched, sum, count: matched.length,
    salaryHits, salarySum, salaryCount: salaryHits.length,
    nonSalary, nonSalarySum, nonSalaryCount: nonSalary.length,
    ignoredHits, ignoredSum, ignoredCount: ignoredHits.length,
    allCount: allMatched.length,
    accountSide, otherSideLabel,
    intraCompanyHits, intraCompanySum, intraCompanyCount: intraCompanyHits.length,
  };
}

// One-click "mark paid" from the reconciliation view. Skips the reserve
// picker (bank already confirmed the payment) and refreshes both the
// obligations cache and the currently-open bank detail so the UI reflects it.
async function markObligationPaidFromBank(obligationId, statementId) {
  try {
    await api(`/obligations/${obligationId}/status`, {method: 'PATCH', body: JSON.stringify({status: 'paid'})});
    toast('Obligation marked paid');
    // Refresh the obligations cached in the currently-open bank detail
    const d = _bankDetailData[statementId];
    if (d) {
      d.obligations = await api('/obligations').catch(() => d.obligations);
      renderBankDetail(statementId);
    }
    // Also refresh the main obligations page cache if the user visits it
    try { allObligations = await api('/obligations'); } catch {}
  } catch (e) { toast(e.message || 'Failed to mark paid', 'error'); }
}

// CSV export of the reconciliation report for a single statement.
function exportBankReconciliationCsv(statementId) {
  const d = _bankDetailData[statementId];
  if (!d) return;
  const stmt = (allBankStatements || []).find(s => s.id === statementId) || {};
  const rec = _bankReconcileObligations(d.transactions, d.obligations || [], stmt.period_start, stmt.period_end);
  const rows = [
    ['Section', 'Obligation type', 'Period', 'Amount (CHF)', 'Due date', 'Paid date', 'Bank counterparty', 'Bank description', 'Match confidence', 'Days gap', 'Obligation status'],
  ];
  for (const m of rec.matches) {
    rows.push(['Matched',
      m.obligation.type_label || m.obligation.obligation_type,
      m.obligation.period_label || '',
      m.obligation.amount.toFixed(2),
      m.obligation.due_date || '',
      m.outflow.date || '',
      m.outflow.counterparty || '',
      (m.outflow.description || '').replace(/\s+/g, ' ').trim(),
      m.cptyMatch ? 'high (counterparty match)' : 'medium (amount+date only)',
      m.daysDiff != null ? Math.round(m.daysDiff).toString() : '',
      m.obligation.status || '',
    ]);
  }
  for (const o of rec.unpaid) {
    rows.push(['Unpaid due in period',
      o.type_label || o.obligation_type,
      o.period_label || '',
      o.amount.toFixed(2),
      o.due_date || '',
      '', '', '', '', '', o.status || 'unpaid',
    ]);
  }
  for (const t of rec.untracked) {
    rows.push(['Untracked outflow',
      '', '', t.amount.toFixed(2), '', t.date || '',
      t.counterparty || '',
      (t.description || '').replace(/\s+/g, ' ').trim(),
      '', '', '',
    ]);
  }
  const dups = _bankFindPossibleDuplicates(d.transactions);
  for (const c of dups) {
    rows.push([c.isRegularMonthly ? 'Recurring (likely subscription)' : 'Possible duplicate',
      '', '', (c.amount).toFixed(2), '', c.dates.join(' | '),
      c.counterparty || '',
      `${c.count} × ${Math.abs(c.amount).toFixed(2)} · total ${c.total.toFixed(2)}` + (c.medianGap != null ? ` · ~${Math.round(c.medianGap)}d apart` : ''),
      '', '', '',
    ]);
  }
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map(r => r.map(esc).join(',')).join('\n');
  const period = `${stmt.period_start || 'unknown'}_to_${stmt.period_end || 'unknown'}`;
  const filename = `reconciliation_${period}.csv`;
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length - 1} row${rows.length === 2 ? '' : 's'} to ${filename}`);
}

// Rich transaction CSV export:
//   - Skips parent aggregators ("multi e-banking order" rows whose real
//     counterparty info lives in sub-entries)
//   - Adds a Classification column: Salary / Reimbursement (#N) / Personal
//     transfer / Intra-company / (blank)
//   - Prepends a Kontokorrent-style summary block at the top so the recipient
//     sees the running balance + totals before the line-item data
function exportBankTransactionsRichCsv(statementId) {
  const d = _bankDetailData[statementId];
  if (!d || !d.transactions) return;
  const stmt = (allBankStatements || []).find(s => s.id === statementId) || {};
  const payroll = d.payrollMeta || {monthlyNet: 0, employeeName: '', employerName: 'Muster Consulting', payDay: 25};
  const aw = _bankFlowWithCounterpart(d.transactions, payroll);
  const reim = _bankReconcileReimbursements(d.transactions, d.expenseReports || []);

  // Kontokorrent residual (same math as the card): |non-salary paid| − reim.total
  let netBalance;
  if (aw.accountSide === 'gmbh' && reim.total > 0) {
    netBalance = Math.abs(aw.nonSalarySum) - reim.total;
  } else {
    netBalance = aw.nonSalarySum;
  }
  const owerDirection = netBalance < 0
    ? `GmbH owes you CHF ${Math.abs(netBalance).toFixed(2)}`
    : netBalance > 0
      ? `You owe GmbH CHF ${netBalance.toFixed(2)}`
      : 'Fully settled';

  // Build a set of transactions classified as Reimbursement + their labels.
  // Store in a Map keyed by (date|amount|counterparty) so we can look up per
  // row during CSV rendering.
  const sig = (tx) => `${tx.date || ''}|${(tx.amount || 0).toFixed(2)}|${(tx.counterparty || '').toLowerCase().trim()}`;
  const reimByRow = new Map();
  for (const m of reim.matches) {
    reimByRow.set(sig(m.outflow), `Reimbursement (report #${m.report.report_number}, ${m.report.year}${m.report.month ? '-'+String(m.report.month).padStart(2,'0') : ''}, ${m.report.expense_count} receipts)`);
  }
  const salaryByRow = new Set(aw.salaryHits.map(sig));
  const employeeNameLc = (payroll.employeeName || '').toLowerCase();
  const employerNameLc = (payroll.employerName || 'Muster Consulting').toLowerCase();
  const empTokens = employeeNameLc.split(/\s+/).filter(t => t.length >= 4);
  const firstEmpToken = empTokens[0] || '';
  const isEmployee = (cp) => {
    if (!empTokens.length) return false;
    const c = (cp || '').toLowerCase();
    if (firstEmpToken && !c.includes(firstEmpToken)) return false;
    return empTokens.filter(t => c.includes(t)).length >= 2;
  };
  const isEmployer = (cp) => employerNameLc && (cp || '').toLowerCase().includes(employerNameLc);

  const classify = (tx) => {
    if (reimByRow.has(sig(tx))) return reimByRow.get(sig(tx));
    if (salaryByRow.has(sig(tx))) return 'Salary';
    if (isEmployee(tx.counterparty)) return 'Personal transfer (non-salary)';
    if (isEmployer(tx.counterparty)) return aw.accountSide === 'gmbh' ? 'Intra-company transfer' : 'From/to employer';
    if (_bankIsRoutinePayroll(tx)) return 'Payroll / social charges';
    return '';
  };

  // Flatten: skip parent aggregators (those with sub_entries), emit each sub
  // in place with its own real counterparty.
  const rows = [];
  const currency = d.currency || 'CHF';
  for (const tx of d.transactions) {
    const hasSubs = tx.sub_entries && tx.sub_entries.length > 0;
    if (!hasSubs) {
      rows.push([
        tx.date || '',
        tx.value_date || '',
        (tx.amount || 0).toFixed(2),
        currency,
        tx.counterparty || '',
        (tx.description || '').replace(/\s+/g, ' ').trim(),
        tx.reference || '',
        tx.transaction_no || '',
        classify(tx),
        tx.balance != null ? tx.balance.toFixed(2) : '',
      ]);
    } else {
      // Emit only the sub-entries (skip the parent aggregator)
      for (const sub of tx.sub_entries) {
        rows.push([
          tx.date || '',
          tx.value_date || '',
          (sub.amount || 0).toFixed(2),
          currency,
          sub.counterparty || '',
          (sub.description || '').replace(/\s+/g, ' ').trim(),
          '',
          tx.transaction_no || '',              // link back to parent tx no.
          classify({date: tx.date, amount: sub.amount, counterparty: sub.counterparty, description: sub.description}),
          '',
        ]);
      }
    }
  }

  // Build final CSV: summary block on top, then a divider, then transactions
  const summaryLines = [
    ['Bank statement export'],
    ['Period', `${stmt.period_start || ''} → ${stmt.period_end || ''}`],
    ['Bank', stmt.bank || ''],
    ['Account', stmt.account_label || ''],
    ['IBAN', stmt.iban || ''],
    ['Opening balance', (stmt.opening_balance != null ? stmt.opening_balance.toFixed(2) : '')],
    ['Closing balance', (stmt.closing_balance != null ? stmt.closing_balance.toFixed(2) : '')],
    [],
    ['── Cash flow summary ──'],
    ['Total in', (d.total_in || 0).toFixed(2)],
    ['  of which customer revenue', ((d.total_in || 0) - reim.total).toFixed(2)],
    ['  of which travel reimbursement (excluded from revenue)', reim.total.toFixed(2)],
    ['Total out', (d.total_out || 0).toFixed(2)],
    ['Net', (d.net || 0).toFixed(2)],
    [],
    ['── Kontokorrent (GmbH ↔ Personal) ──'],
    ['Non-salary paid to you', Math.abs(aw.nonSalarySum).toFixed(2)],
    ['Reimbursement receivable (GmbH holds for you)', reim.total.toFixed(2)],
    ['Residual balance', Math.abs(netBalance).toFixed(2)],
    ['Direction', owerDirection],
    ['Salary payments detected', String(aw.salaryCount)],
    ['Total salary paid', Math.abs(aw.salarySum).toFixed(2)],
    [],
    ['── Reimbursement matches ──'],
    ['Bank date', 'Amount', 'Counterparty', 'Matched to report'],
    ...reim.matches.map(m => [
      m.outflow.date || '',
      (m.outflow.amount || 0).toFixed(2),
      m.outflow.counterparty || '',
      `#${m.report.report_number} (${m.report.year}${m.report.month ? '-'+String(m.report.month).padStart(2,'0') : ''}, ${m.report.expense_count} receipts)`,
    ]),
    [],
    ['── Transactions (parent aggregators skipped, sub-entries expanded in place) ──'],
    ['Date','Value Date','Amount','Currency','Counterparty','Description','Reference','Transaction No.','Classification','Balance'],
  ];

  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const bom = '﻿';
  const summaryCsv = summaryLines.map(r => r.map(esc).join(',')).join('\n');
  const txCsv = rows.map(r => r.map(esc).join(',')).join('\n');
  const csv = bom + summaryCsv + '\n' + txCsv + '\n';

  const filename = `bank_transactions_${stmt.period_start || 'start'}_to_${stmt.period_end || 'end'}.csv`;
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'} + Kontokorrent summary`);
}

// ── Obligations reconciliation ─────────────────────────────────────────────
// Expected counterparty keywords per obligation type. When the counterparty
// hints at the type, the match is high-confidence; otherwise we're stricter
// on date proximity to reduce coincidental amount collisions (e.g. AHV vs
// AXA insurance both happening to be CHF 2,252.60).
const _OBLIGATION_KEYWORDS = {
  ahv:                    ['ahv', 'avs', 'ausgleichskasse', 'sva', 'compensation', 'caisse'],
  bvg_employee:           ['bvg', 'lpp', 'pension', 'axa', 'swisscanto', 'zurich', 'allianz', 'pensionskasse', 'sammelstiftung'],
  bvg_employer:           ['bvg', 'lpp', 'pension', 'axa', 'swisscanto', 'zurich', 'allianz', 'pensionskasse', 'sammelstiftung'],
  corporate_tax_federal:  ['estv', 'eidg', 'eidgen', 'bundessteuer', 'steuerverwaltung', 'impôt féd'],
  corporate_tax_cantonal: ['kanton', 'steueramt', 'steuerverwaltung', 'canton', 'impôt cantonal'],
  vat:                    ['estv', 'eidg', 'mwst', 'vat', 'tva', 'iva', 'steuerverwaltung'],
};

function _bankObligationCptyMatch(o, tx) {
  const cp = (tx.counterparty || '').toLowerCase() + ' ' + (tx.description || '').toLowerCase();
  const keys = _OBLIGATION_KEYWORDS[o.obligation_type] || [];
  return keys.some(k => cp.includes(k));
}

// Detect possible duplicate charges: ≥2 transactions with the same
// counterparty + same absolute amount, all same direction, within a
// rolling 60-day window. Legitimate recurring subscriptions look like
// this — that's why it's a soft warning, not an error.
function _bankFindPossibleDuplicates(transactions, minAmount = 20, windowDays = 60) {
  const flat = [];
  for (const t of transactions || []) {
    const hasSubs = t.sub_entries && t.sub_entries.length > 0;
    if (!hasSubs) flat.push(t);
    if (hasSubs) for (const s of t.sub_entries) flat.push(s);
  }
  // Normalize counterparty for grouping
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const groups = new Map();
  for (const t of flat) {
    if (!t.counterparty) continue;
    if (Math.abs(t.amount || 0) < minAmount) continue;
    // Key = normalized counterparty + rounded absolute amount
    const key = `${normalize(t.counterparty)}|${Math.abs(t.amount).toFixed(2)}|${(t.amount || 0) > 0 ? 'in' : 'out'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const clusters = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    // Rolling-window scan: only keep the cluster if any 2 entries are within
    // windowDays of each other. (Spacing further apart usually = recurring
    // subscription with monthly cadence, which we don't want to flag.)
    let anyClose = false;
    for (let i = 1; i < list.length; i++) {
      const d1 = new Date(list[i - 1].date + 'T00:00:00');
      const d2 = new Date(list[i].date + 'T00:00:00');
      const gap = Math.abs(d2 - d1) / 86400000;
      if (gap <= windowDays && gap >= 0) { anyClose = true; break; }
    }
    if (!anyClose) continue;
    const total = list.reduce((s, t) => s + (t.amount || 0), 0);
    const [normCpty] = key.split('|');
    // Median gap between charges — helps distinguish "monthly regular" from
    // "unexpected double charge".
    const gaps = [];
    for (let i = 1; i < list.length; i++) {
      const d1 = new Date(list[i - 1].date + 'T00:00:00');
      const d2 = new Date(list[i].date + 'T00:00:00');
      gaps.push(Math.abs(d2 - d1) / 86400000);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    // Regular = median gap between 25 and 35 days (monthly). Irregular = suspect.
    const isRegularMonthly = medianGap != null && medianGap >= 25 && medianGap <= 35;
    clusters.push({
      counterparty: list[0].counterparty,   // display original casing
      normCpty,
      amount: list[0].amount,
      count: list.length,
      dates: list.map(t => t.date),
      total,
      medianGap,
      isRegularMonthly,
      transactions: list,
    });
  }
  // Sort: suspicious (irregular) first, then by count desc, then by |amount| desc.
  clusters.sort((a, b) => {
    if (a.isRegularMonthly !== b.isRegularMonthly) return a.isRegularMonthly ? 1 : -1;
    if (b.count !== a.count) return b.count - a.count;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });
  return clusters;
}

// Match incoming bank transactions against generated expense reports.
// A reimbursement = an inflow whose amount equals a report total (within CHF
// 0.05) AND arrives after the report was generated. These are pure passthrough
// money and must NOT be counted as revenue — they refund earlier out-of-pocket
// spending that was already booked as travel expenses.
function _bankReconcileReimbursements(transactions, expenseReports) {
  const parseD = (s) => s ? new Date(s + 'T00:00:00') : null;
  const inflows = [];
  for (const t of transactions || []) {
    const hasSubs = t.sub_entries && t.sub_entries.length > 0;
    if (!hasSubs && (t.amount || 0) > 0) inflows.push(t);
    if (hasSubs) for (const s of t.sub_entries) if ((s.amount || 0) > 0) inflows.push(s);
  }
  const usedReports = new Set();
  const matches = [];
  for (const tx of inflows) {
    const txDate = parseD(tx.date);
    for (const r of expenseReports || []) {
      if (usedReports.has(r.id)) continue;
      if (Math.abs((r.total || 0) - (tx.amount || 0)) > 0.05) continue;
      const created = parseD((r.created_at || '').slice(0, 10));
      // Only match if the report was generated BEFORE (or same day as) the
      // bank inflow — you can't be reimbursed for a report that doesn't yet
      // exist.
      if (created && txDate && created > txDate) continue;
      usedReports.add(r.id);
      matches.push({outflow: tx, report: r});
      break;
    }
  }
  const total = matches.reduce((s, m) => s + (m.outflow.amount || 0), 0);
  return {matches, total, count: matches.length};
}

function _bankReconcileObligations(transactions, obligations, periodStart, periodEnd) {
  const parseDate = (s) => s ? new Date(s + 'T00:00:00') : null;
  const daysBetween = (a, b) => Math.abs((a - b) / 86400000);

  // Flatten transactions + sub-entries into candidate outflows (negative only).
  // For batch payments (parent with sub_entries), only the sub-entries carry
  // the real counterparty info — skip the aggregate parent to avoid
  // double-counting in untracked / matching.
  const outflows = [];
  for (const t of transactions || []) {
    const hasSubs = t.sub_entries && t.sub_entries.length > 0;
    if (!hasSubs && (t.amount || 0) < 0) outflows.push(t);
    if (hasSubs) {
      for (const s of t.sub_entries) if ((s.amount || 0) < 0) outflows.push(s);
    }
  }

  const start = parseDate(periodStart);
  const end   = parseDate(periodEnd);

  // Try to match each obligation to an outflow.
  // Match criteria: amount within ±CHF 5 or ±1% (whichever is larger),
  // date within ±30 days of due_date. Prefer closest-date match.
  const used = new Set();      // outflow indices claimed by a match
  // Build all candidate (obligation, outflow) pairs with scores, then assign
  // greedily by highest score. This avoids the loop-order problem where a
  // weak-cpty obligation grabs an outflow that would fit a stronger one.
  const candidates = [];
  for (const o of obligations || []) {
    const tolerance = Math.max(5, Math.abs(o.amount) * 0.01);
    const dueDate = parseDate(o.due_date);
    outflows.forEach((tx, idx) => {
      if (Math.abs(Math.abs(tx.amount) - Math.abs(o.amount)) > tolerance) return;
      const txDate = parseDate(tx.date);
      const cptyMatch = _bankObligationCptyMatch(o, tx);
      let dateDiff = null;
      if (dueDate && txDate) {
        dateDiff = daysBetween(dueDate, txDate);
        if (dateDiff > 30) return;
      }
      // Without counterparty hint, require very close date (≤7d).
      if (!cptyMatch && (dateDiff === null || dateDiff > 7)) return;
      // Score: counterparty match dominates (~100), date proximity refines.
      const score = (cptyMatch ? 100 : 0) - 2 * (dateDiff ?? 0);
      candidates.push({o, tx, txIdx: idx, dateDiff, cptyMatch, score});
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const matches = [];
  const unpaid  = [];
  const claimedObs = new Set();
  for (const c of candidates) {
    if (used.has(c.txIdx) || claimedObs.has(c.o.id)) continue;
    used.add(c.txIdx);
    claimedObs.add(c.o.id);
    matches.push({obligation: c.o, outflow: c.tx, daysDiff: c.dateDiff, cptyMatch: c.cptyMatch});
  }
  for (const o of obligations || []) {
    if (claimedObs.has(o.id)) continue;
    const due = parseDate(o.due_date);
    if (due && start && end && due >= start && due <= end) unpaid.push(o);
  }

  // Untracked = outflow with |amount| >= 500, not already matched, not routine
  // payroll/tax pattern, and not to the employee (already handled elsewhere).
  const untracked = outflows.filter((tx, idx) => {
    if (used.has(idx)) return false;
    if (Math.abs(tx.amount) < 500) return false;
    if (_bankIsRoutinePayroll(tx)) return false;
    return true;
  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8);

  return {matches, unpaid, untracked};
}

function renderBankDetail(id) {
  const d = _bankDetailData[id];
  if (!d) return;
  const mode = _bankDetailFilters[id] || 'all';
  let rows = d.transactions;
  if (mode === 'in')  rows = rows.filter(t => t.amount > 0);
  if (mode === 'out') rows = rows.filter(t => t.amount < 0);
  const btnStyle = (active) =>
    `padding:4px 10px;border:1px solid var(--border);border-radius:4px;font-size:11px;cursor:pointer;` +
    (active ? 'background:#1f3a5f;color:#fff;font-weight:600' : 'background:white;color:var(--text)');
  const body = document.getElementById(`bank-detail-body-${id}`);
  if (!body) return;
  // Find the matching statement to read the period for salary calc.
  const stmt = (allBankStatements || []).find(s => s.id === id) || {};
  const payroll = d.payrollMeta || {monthlyNet: 0, employeeName: '', employerName: 'Muster Consulting', payDay: 25};
  const monthlyNet = payroll.monthlyNet;
  const aw = _bankFlowWithCounterpart(d.transactions, payroll);
  // Subtract only salary payments we actually detected — not "expected" ones.
  const netExSalary = aw.nonSalarySum;
  const netColor = netExSalary > 0 ? '#16a34a' : netExSalary < 0 ? '#dc2626' : 'var(--text-muted)';
  const expectedPayPeriods = _bankPayPeriodsInStatement(stmt.period_start, stmt.period_end, payroll.payDay);
  const missingSalaryCount = Math.max(0, expectedPayPeriods - aw.salaryCount);
  body.innerHTML = `
    <div class="row-split" style="margin-bottom:10px;gap:14px;flex-wrap:wrap">
      <div style="display:flex;gap:14px;font-size:12px">
        <div>Source: <b>${escapeHtml(d.source)}</b></div>
        <div>Opening: <span class="mono">${chf(d.opening || 0)}</span></div>
        <div>Closing: <span class="mono"><b>${chf(d.closing || 0)}</b></span></div>
        ${(() => {
          const reim = _bankReconcileReimbursements(d.transactions, d.expenseReports || []);
          const adjustedIn = (d.total_in || 0) - reim.total;
          const reimNote = reim.count > 0
            ? ` <span style="color:var(--text-muted);font-size:10px" title="Of which ${chf(reim.total)} is travel-expense reimbursement (not revenue)">(rev ${chf(adjustedIn)} + reimb ${chf(reim.total)})</span>`
            : '';
          return `
            <div style="color:#16a34a">In: <span class="mono">+${chf(d.total_in)}</span>${reimNote}</div>
            <div style="color:#dc2626">Out: <span class="mono">${chf(d.total_out)}</span></div>
            <div>Net: <span class="mono"><b>${chf(d.net)}</b></span></div>
          `;
        })()}
        <div style="color:var(--text-muted)">${d.count} transactions</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <button onclick="filterBankDetail(${id}, 'all')" style="${btnStyle(mode==='all')}">All</button>
        <button onclick="filterBankDetail(${id}, 'in')"  style="${btnStyle(mode==='in')}">In only</button>
        <button onclick="filterBankDetail(${id}, 'out')" style="${btnStyle(mode==='out')}">Out only</button>
        <a href="${tokenUrl(`/api/bank-statements/${id}/export.xlsx`).replace(/&/g, '&amp;')}"
           download="bank_transactions_${escapeHtml(stmt.period_start || '')}_to_${escapeHtml(stmt.period_end || '')}.xlsx"
           style="padding:4px 10px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:white;color:var(--text);cursor:pointer;text-decoration:none;margin-left:6px"
           title="Download Excel workbook — 3 sheets (Summary / Transactions / Reimbursements), classification per row, Kontokorrent recap">
          &#11015; Excel (full)
        </a>
        ${(() => {
          const year = (stmt.period_end || stmt.period_start || '').slice(0, 4) || new Date().getFullYear();
          // HTML-encode &s in href so the browser doesn't try to parse them as
          // (incomplete) entity references. Using &amp; keeps the URL intact.
          return `${[1, 2, 3, 4].map(q => {
            const url = tokenUrl(`/api/bank-statements/${id}/export.xlsx?quarter=${q}&year=${year}`).replace(/&/g, '&amp;');
            return `<a href="${url}" download="bank_transactions_Q${q}_${year}.xlsx"
               style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:white;color:var(--text);cursor:pointer;text-decoration:none;margin-left:2px"
               title="Excel workbook filtered to Q${q} ${year} — Summary + Transactions + Reimbursements for the quarter">Q${q}</a>`;
          }).join('')}`;
        })()}
        <button onclick="exportBankTransactionsRichCsv(${id})"
           style="padding:4px 10px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:white;color:var(--text);cursor:pointer;margin-left:4px"
           title="Download plain CSV instead (all rows in one file)">
          CSV
        </button>
      </div>
    </div>

    <!-- GmbH ↔ Personal flow: one headline number, ex-salary, auto-detects side -->
    <div style="background:white;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:14px">
      ${(() => {
        // Direction-in-words framing. All numbers rendered as positive absolute
        // values; the direction ("GmbH paid you" vs "you sent GmbH") is stated
        // in text so the reader never has to interpret a +/− sign.
        const totalAbs = Math.abs(aw.sum);
        const salaryAbs = Math.abs(aw.salarySum);
        const nonSalaryAbs = Math.abs(netExSalary);
        // Reimbursement receivable: money the GmbH received on Max's behalf
        // from third-party clients (Acme etc.) that refunds prior out-of-pocket
        // travel spend. It's implicitly owed back to Max, so non-salary
        // transfers from GmbH → Max are settlement of this debt, not new
        // dividend/loan money. Net the two to show the true residual position.
        const reim = _bankReconcileReimbursements(d.transactions, d.expenseReports || []);
        const reimTotal = reim.total;
        const settled = Math.min(reimTotal, nonSalaryAbs);   // pass-through
        const residualUnclassified = Math.max(0, nonSalaryAbs - reimTotal);
        const residualOwedToMax = Math.max(0, reimTotal - nonSalaryAbs);
        const netBalance = reimTotal - nonSalaryAbs;   // + = GmbH still owes; − = extra to Max
        const hasReim = reim.count > 0;
        // Direction of the total flow (based on sum sign on THIS account):
        // GmbH account: negative sum = GmbH → Max (paying out)
        // Personal account: positive sum = GmbH → Max (receiving)
        const totalGoingToMax = aw.accountSide === 'gmbh' ? aw.sum < 0 : aw.sum > 0;
        const nonSalaryGoingToMax = aw.accountSide === 'gmbh' ? netExSalary < 0 : netExSalary > 0;
        const nameShort = aw.accountSide === 'gmbh' ? 'Max' : 'the GmbH';
        const otherSideFull = escapeHtml(aw.otherSideLabel);
        // Directional labels
        const totalArrow = totalGoingToMax
          ? (aw.accountSide === 'gmbh' ? `GmbH → you` : `GmbH → you`)
          : (aw.accountSide === 'gmbh' ? `you → GmbH` : `you → GmbH`);
        const nonSalaryArrow = nonSalaryGoingToMax
          ? `GmbH → you`
          : `you → GmbH`;
        // Headline value: use the *net* balance after reimbursement offset,
        // if reimbursements exist. Otherwise fall back to raw non-salary.
        const headlineAbs = hasReim ? Math.abs(netBalance) : nonSalaryAbs;
        const headlineArrow = hasReim
          ? (netBalance > 0.005
              ? 'GmbH still owes you'                    // reimb > non-salary paid
              : netBalance < -0.005
                ? 'GmbH paid you beyond reimbursement'    // paid more than reimb
                : 'Fully settled')
          : nonSalaryArrow;
        const headlineMod = hasReim
          ? (Math.abs(netBalance) < 0.005 ? 'ok' : 'warn')
          : (nonSalaryGoingToMax ? 'warn' : '');
        const meaning = hasReim
          ? (Math.abs(netBalance) < 0.005
              ? 'Non-salary transfers exactly match the reimbursement GmbH received on your behalf — no shareholder loan needed.'
              : netBalance > 0.005
                ? `Acme reimbursed GmbH ${chf(reimTotal)} for your travel. Only ${chf(nonSalaryAbs)} has been passed back → residual ${chf(Math.abs(netBalance))} still owed to you.`
                : `Non-salary payments exceed reimbursement by ${chf(Math.abs(netBalance))} → this excess is a real dividend advance / shareholder loan.`)
          : (nonSalaryAbs < 0.005
              ? 'Salary explained everything. Nothing extra to classify.'
              : nonSalaryGoingToMax
                ? 'Likely a dividend advance, expense reimbursement, or shareholder loan — needs classification.'
                : 'Likely a capital injection or shareholder-loan repayment — needs classification.');
        return `
      <div style="padding:10px 14px;background:rgba(0,0,0,0.04);font-size:12px">
        <b>Beyond your regular paycheck</b>
        <span style="color:var(--text-muted);margin-left:8px">money that moved between this account and ${nameShort}, excluding detected salary</span>
      </div>
      ${aw.allCount === 0
        ? `<div class="hint" style="padding:14px">No movements with ${otherSideFull} in this statement.</div>`
        : `<div style="padding:14px">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px">
              <div class="headline-panel__value${headlineMod ? ` headline-panel__value--${headlineMod}` : ''}">${chf(headlineAbs)}</div>
              <div style="font-size:14px;color:var(--text-muted);font-weight:500">${headlineArrow}</div>
            </div>
            <div class="hint hint--sm" style="margin-bottom:14px">${meaning}</div>
            <table style="width:100%;font-size:12px;margin:0;border-top:1px solid var(--border)">
              <tbody>
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 0"><b>Salary paid</b>
                    <div class="hint hint--sm" style="margin-top:1px">${aw.salaryCount} payment${aw.salaryCount === 1 ? '' : 's'} detected · ≈${chf(monthlyNet)} on day ${payroll.payDay} ±7d</div>
                  </td>
                  <td class="money" style="padding:8px 0;color:var(--text-muted)">${chf(salaryAbs)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 0"><b>Non-salary paid to you</b>
                    <div style="font-size:11px;color:${nonSalaryGoingToMax ? 'var(--warn-text)' : 'var(--primary)'};margin-top:1px">${nonSalaryArrow}</div>
                  </td>
                  <td class="money" style="padding:8px 0">${chf(nonSalaryAbs)}</td>
                </tr>
                ${hasReim ? `
                <tr style="border-bottom:1px solid var(--border);background:rgba(59,130,246,0.05)">
                  <td style="padding:8px 0"><b>− Reimbursement receivable</b>
                    <div class="hint hint--sm" style="margin-top:1px">GmbH received ${chf(reimTotal)} from Acme on your behalf (report${reim.count === 1 ? '' : 's'} #${reim.matches.map(m => m.report.report_number).join(', #')})</div>
                  </td>
                  <td class="money" style="padding:8px 0;color:var(--primary)">−${chf(reimTotal)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border);font-weight:600">
                  <td style="padding:8px 0">= Residual balance
                    <div class="hint hint--sm" style="font-weight:400;margin-top:1px">${netBalance > 0 ? 'GmbH still owes you' : netBalance < 0 ? 'You received beyond the reimbursement (dividend/loan?)' : 'Fully settled'}</div>
                  </td>
                  <td class="money${headlineMod ? ` money--${headlineMod === 'warn' ? 'warn' : 'ok'}` : ''}" style="padding:8px 0">${netBalance > 0 ? '' : netBalance < 0 ? '−' : ''}${chf(Math.abs(netBalance))}</td>
                </tr>` : ''}
                <tr style="font-weight:600;background:rgba(0,0,0,0.02)">
                  <td style="padding:8px 0">Total movement with ${nameShort}
                    <span style="color:var(--text-muted);font-weight:400">${totalArrow} · ${aw.count} tx${aw.ignoredCount > 0 ? ` · ${aw.ignoredCount} ignored` : ''}</span>
                  </td>
                  <td class="money" style="padding:8px 0">${chf(totalAbs)}</td>
                </tr>
              </tbody>
            </table>
            ${missingSalaryCount > 0 && monthlyNet > 0 ? `<div class="notice notice--info" style="margin-top:10px">
              ℹ <b>${missingSalaryCount} of ${expectedPayPeriods} expected payday${expectedPayPeriods === 1 ? '' : 's'} had no salary payment</b> in this account. Either salary lands elsewhere, payroll hadn't started yet, or the payment amount fell outside ±10% of ${chf(monthlyNet)}.
            </div>` : ''}
            ${aw.intraCompanyCount > 0 ? `<div class="hint hint--sm" style="margin-top:10px;padding:8px 10px;background:rgba(0,0,0,0.04);border:1px solid var(--border);border-radius:4px">
              <b>${aw.intraCompanyCount} intra-company transfer${aw.intraCompanyCount === 1 ? '' : 's'} auto-excluded</b> (${chf(Math.abs(aw.intraCompanySum))}) — counterparty &ldquo;${escapeHtml(payroll?.employerName || 'Muster Consulting')}&rdquo; on the GmbH's own account is a founding capital deposit / Sperrkonto release / inter-account move, not personal flow.
            </div>` : ''}
            ${aw.ignoredCount > 0 ? `<div class="hint hint--sm" style="margin-top:8px">
              ${aw.ignoredCount} transaction${aw.ignoredCount === 1 ? '' : 's'} ignored (${chf(Math.abs(aw.ignoredSum))}) — use Restore below to re-include.
            </div>` : ''}
            <details class="hint hint--sm" style="margin-top:12px" open>
              <summary style="cursor:pointer">Show the ${aw.allCount} transaction${aw.allCount === 1 ? '' : 's'} with ${escapeHtml(aw.otherSideLabel)}${aw.ignoredCount > 0 ? ` (incl. ${aw.ignoredCount} ignored)` : ''}</summary>
              <table style="width:100%;font-size:11px;margin-top:6px">
                <thead><tr style="color:var(--text-muted)">
                  <th style="text-align:left;padding:4px 8px">Date</th>
                  <th style="text-align:left;padding:4px 8px">Description</th>
                  <th style="text-align:right;padding:4px 8px">Classified as</th>
                  <th style="text-align:right;padding:4px 8px">Amount</th>
                  <th style="text-align:right;padding:4px 8px"></th>
                </tr></thead>
                <tbody>${[...aw.transactions, ...aw.ignoredHits].map(t => {
                  const isSal = aw.salaryHits.includes(t);
                  const isIgnored = aw.ignoredHits.includes(t);
                  const classifyLabel = isIgnored ? 'ignored' : (isSal ? 'salary' : 'non-salary');
                  const classifyColor = isIgnored ? 'var(--text-muted)' : (isSal ? 'var(--text-muted)' : 'var(--primary)');
                  const escCp = escapeHtml(t.counterparty || '').replace(/'/g, "\\'");
                  return `<tr style="border-top:1px solid var(--border);${isIgnored ? 'opacity:0.55' : ''}">
                    <td class="mono" style="padding:4px 8px">${escapeHtml(t.date || '')}</td>
                    <td style="padding:4px 8px">${escapeHtml(t.description || '')}</td>
                    <td class="text-right" style="padding:4px 8px;color:${classifyColor};font-style:italic">${classifyLabel}</td>
                    <td class="money" style="padding:4px 8px;color:${t.amount >= 0 ? '#16a34a' : '#dc2626'}">${t.amount > 0 ? '+' : ''}${chf(t.amount)}</td>
                    <td class="text-right" style="padding:4px 8px">
                      <button onclick="_bankToggleIgnore('${t.date || ''}', ${t.amount || 0}, '${escCp}', ${id})"
                              title="${isIgnored ? 'Include this transaction in the calculation' : 'Exclude this transaction from the calculation (e.g. capital injection)'}"
                              style="padding:2px 8px;border:1px solid var(--border);border-radius:3px;font-size:10px;cursor:pointer;background:${isIgnored ? '#1f3a5f' : 'white'};color:${isIgnored ? '#fff' : 'var(--text)'}">
                        ${isIgnored ? 'Restore' : 'Ignore'}
                      </button>
                    </td>
                  </tr>`;
                }).join('')}</tbody>
              </table>
            </details>
            ${monthlyNet === 0 ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(245,158,11,0.10);border:1px solid var(--warn-fill);border-radius:4px;font-size:11px">⚠ No payroll preview available — can't tell salary apart from other Muster Consulting flow. <a href="#" onclick="navigateTo('payroll');showPayrollSettings();return false">Set up payroll →</a></div>` : ''}
          </div>`
      }`;
      })()}
    </div>

    ${(() => {
      const reim = _bankReconcileReimbursements(d.transactions, d.expenseReports || []);
      if (!reim.count) return '';
      return `<div style="background:white;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:14px">
        <div style="padding:10px 14px;background:rgba(0,0,0,0.04);font-size:12px">
          <b>Travel-expense reimbursements</b>
          <span style="color:var(--text-muted);margin-left:8px">
            inflows that refund earlier out-of-pocket travel — not revenue, net-zero P&amp;L impact
          </span>
        </div>
        <div style="padding:12px 14px">
          <div class="hint" style="margin-bottom:6px">
            ${reim.count} inflow${reim.count === 1 ? '' : 's'} matched to previously-generated expense reports · total ${chf(reim.total)} received back
          </div>
          <table style="width:100%;font-size:12px;margin:0">
            <thead><tr class="hint hint--sm">
              <th style="text-align:left;padding:4px 6px">Bank inflow</th>
              <th style="text-align:left;padding:4px 6px">Counterparty</th>
              <th style="text-align:left;padding:4px 6px">Matched to</th>
              <th style="text-align:right;padding:4px 6px">Amount</th>
              <th style="text-align:left;padding:4px 6px">Report created</th>
            </tr></thead>
            <tbody>${reim.matches.map(m => {
              const rep = m.report;
              const period = rep.month
                ? `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][rep.month]} ${rep.year}`
                : `${rep.year}`;
              return `<tr style="border-top:1px solid var(--border)">
                <td class="mono" style="padding:4px 6px">${escapeHtml(m.outflow.date || '')}</td>
                <td style="padding:4px 6px">${escapeHtml((m.outflow.counterparty || '').slice(0, 30))}</td>
                <td style="padding:4px 6px">
                  <a href="#" onclick="navigateTo('expenses');return false" style="color:var(--primary);text-decoration:none">
                    Expense report #${rep.report_number}
                  </a>
                  <span class="hint hint--sm"> · ${period} · ${rep.expense_count} receipt${rep.expense_count === 1 ? '' : 's'}</span>
                </td>
                <td class="money" style="padding:4px 6px;color:var(--primary);font-weight:600">${chf(m.outflow.amount)}</td>
                <td class="mono" style="padding:4px 6px;color:var(--text-muted)">${escapeHtml((rep.created_at || '').slice(0, 10))}</td>
              </tr>`;
            }).join('')}</tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border);background:rgba(0,0,0,0.02);font-weight:600">
                <td colspan="3" style="padding:6px">Total reimbursement received (excluded from revenue)</td>
                <td class="money" style="padding:6px;color:var(--primary)">${chf(reim.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div class="hint hint--sm" style="margin-top:8px;font-style:italic">
            These payments must be booked against the shareholder-loan / travel-expense account, not as customer revenue. Adjusted revenue for this statement = In (${chf(d.total_in)}) − reimbursements (${chf(reim.total)}) = ${chf((d.total_in || 0) - reim.total)}.
          </div>
        </div>
      </div>`;
    })()}

    ${(() => {
      const rec = _bankReconcileObligations(d.transactions, d.obligations || [], stmt.period_start, stmt.period_end);
      const dups = _bankFindPossibleDuplicates(d.transactions);
      if (!rec.matches.length && !rec.unpaid.length && !rec.untracked.length && !dups.length) return '';
      const dot = (color) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>`;
      const obLink = (o) => `<a href="#" onclick="navigateTo('obligations');return false" style="color:var(--primary);text-decoration:none">${escapeHtml(o.type_label || o.obligation_type)}${o.period_label ? ' · ' + escapeHtml(o.period_label) : ''}</a>`;
      const dupsSuspect = dups.filter(c => !c.isRegularMonthly);
      return `<div style="background:white;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:14px">
        <div style="padding:10px 14px;background:rgba(0,0,0,0.04);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <b>Obligations reconciliation</b>
            <span style="color:var(--text-muted);margin-left:8px">${rec.matches.length} matched · ${rec.unpaid.length} unpaid due in period · ${rec.untracked.length} untracked large outflow${rec.untracked.length === 1 ? '' : 's'}${dupsSuspect.length > 0 ? ` · ${dupsSuspect.length} possible duplicate${dupsSuspect.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          <button onclick="exportBankReconciliationCsv(${id})" style="padding:4px 10px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:white;color:var(--text);cursor:pointer" title="Download CSV — hand to Treuhand for the annual close">
            &#11015; CSV
          </button>
        </div>
        <div style="padding:12px 14px">
          ${rec.matches.length ? `<table style="width:100%;font-size:12px;margin:0 0 12px">
            <thead><tr class="hint hint--sm">
              <th style="text-align:left;padding:4px 6px">Obligation</th>
              <th style="text-align:right;padding:4px 6px">Amount</th>
              <th style="text-align:right;padding:4px 6px">Due</th>
              <th style="text-align:right;padding:4px 6px">Paid</th>
              <th style="text-align:left;padding:4px 6px">To (bank)</th>
              <th style="text-align:right;padding:4px 6px">Status</th>
            </tr></thead>
            <tbody>${rec.matches.map(m => {
              const gap = m.daysDiff != null ? `${Math.round(m.daysDiff)}d` : '—';
              const isPaid = m.obligation.status === 'paid';
              const statusCell = isPaid
                ? `<span style="color:#16a34a;font-size:10px">PAID <span style="color:var(--text-muted)">${gap}</span></span>`
                : `<button onclick="markObligationPaidFromBank(${m.obligation.id}, ${id})" title="Mark this obligation as paid using the ${m.outflow.date} bank movement" style="padding:2px 8px;border:1px solid var(--warn-fill);border-radius:3px;font-size:10px;cursor:pointer;background:rgba(245,158,11,0.10);color:var(--warn-text);font-weight:600">Mark paid</button> <span style="color:var(--text-muted);font-size:10px">${gap}</span>`;
              return `<tr style="border-top:1px solid var(--border)">
                <td style="padding:4px 6px">${dot('#16a34a')}${obLink(m.obligation)}</td>
                <td class="money" style="padding:4px 6px">${chf(m.obligation.amount)}</td>
                <td class="money" style="padding:4px 6px;color:var(--text-muted)">${escapeHtml(m.obligation.due_date || '—')}</td>
                <td class="money" style="padding:4px 6px">${escapeHtml(m.outflow.date || '—')}</td>
                <td style="padding:4px 6px;color:var(--text-muted)">${escapeHtml((m.outflow.counterparty || m.outflow.description || '').slice(0, 40))}</td>
                <td class="text-right" style="padding:4px 6px">${statusCell}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>` : ''}
          ${rec.unpaid.length ? `<div style="margin-bottom:12px">
            <div class="hint hint--sm" style="margin-bottom:4px">${dot('#dc2626')}<b>Unpaid obligations due in this period</b> — no matching outflow found:</div>
            <table style="width:100%;font-size:12px;margin:0">
              <tbody>${rec.unpaid.map(o => `<tr style="border-top:1px solid var(--border)">
                <td style="padding:4px 6px">${obLink(o)}</td>
                <td class="money" style="padding:4px 6px;color:#dc2626">${chf(o.amount)}</td>
                <td class="money" style="padding:4px 6px;color:var(--text-muted)">due ${escapeHtml(o.due_date || '')}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
          ${rec.untracked.length ? `<div${dups.length ? ' style="margin-bottom:12px"' : ''}>
            <div class="hint hint--sm" style="margin-bottom:4px">${dot('#f59e0b')}<b>Untracked large outflows</b> — worth reviewing (not tied to a tracked obligation):</div>
            <table style="width:100%;font-size:12px;margin:0">
              <tbody>${rec.untracked.map(t => `<tr style="border-top:1px solid var(--border)">
                <td class="mono" style="padding:4px 6px">${escapeHtml(t.date || '')}</td>
                <td style="padding:4px 6px">${escapeHtml((t.counterparty || '').slice(0, 40)) || '<span style="color:var(--text-muted)">—</span>'}</td>
                <td class="hint hint--sm" style="padding:4px 6px">${escapeHtml((t.description || '').slice(0, 60))}</td>
                <td class="money" style="padding:4px 6px;color:#dc2626">${chf(t.amount)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
          ${dups.length ? `<div>
            <div class="hint hint--sm" style="margin-bottom:4px">${dot('#f59e0b')}<b>Possible duplicates</b> — same counterparty + amount charged more than once. Regular-monthly ones are probably subscriptions (safe); irregular gaps deserve a look:</div>
            <table style="width:100%;font-size:12px;margin:0">
              <tbody>${dups.map(c => {
                const dateList = c.dates.join(', ');
                const gapLabel = c.medianGap != null
                  ? (c.isRegularMonthly
                      ? `~${Math.round(c.medianGap)}d apart (looks monthly)`
                      : `${Math.round(c.medianGap)}d apart · irregular`)
                  : '';
                const badgeColor = c.isRegularMonthly ? 'var(--text-muted)' : '#f59e0b';
                const badgeText  = c.isRegularMonthly ? 'recurring?' : 'suspicious';
                return `<tr style="border-top:1px solid var(--border)">
                  <td style="padding:4px 6px"><b>${escapeHtml((c.counterparty || '').slice(0, 40))}</b>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escapeHtml(dateList)}</div>
                  </td>
                  <td class="money" style="padding:4px 6px;color:${c.amount >= 0 ? '#16a34a' : '#dc2626'}">${c.count} × ${chf(Math.abs(c.amount))}</td>
                  <td class="money" style="padding:4px 6px;color:${c.total >= 0 ? '#16a34a' : '#dc2626'}">${c.total > 0 ? '+' : ''}${chf(c.total)}</td>
                  <td class="text-right" style="padding:4px 6px">
                    <span style="font-size:10px;color:${badgeColor};font-weight:600">${badgeText}</span>
                    <div style="font-size:10px;color:var(--text-muted)">${escapeHtml(gapLabel)}</div>
                  </td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>` : ''}
        </div>
      </div>`;
    })()}

    <div style="background:white;border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <table style="width:100%;font-size:12px;margin:0">
        <thead>
          <tr style="background:rgba(0,0,0,0.04)">
            <th style="text-align:left;padding:8px 12px">Date</th>
            <th style="text-align:left;padding:8px 12px">Counterparty</th>
            <th style="text-align:left;padding:8px 12px">Description</th>
            <th style="text-align:right;padding:8px 12px">Amount</th>
            <th style="text-align:right;padding:8px 12px">Balance</th>
            <th style="text-align:left;padding:8px 12px">Tx no.</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(t => {
            const colorAmt = t.amount > 0 ? '#16a34a' : t.amount < 0 ? '#dc2626' : 'var(--text-muted)';
            const sign = t.amount > 0 ? '+' : '';
            let html = `<tr style="border-top:1px solid var(--border)">
              <td class="mono" style="padding:6px 12px">${escapeHtml(t.date)}</td>
              <td style="padding:6px 12px">${escapeHtml(t.counterparty || '')}</td>
              <td style="color:var(--text-muted);padding:6px 12px">${escapeHtml(t.description || '')}</td>
              <td class="money" style="color:${colorAmt};font-weight:600;padding:6px 12px">${sign}${chf(t.amount)}</td>
              <td class="money" style="padding:6px 12px">${t.balance !== null && t.balance !== undefined ? chf(t.balance) : ''}</td>
              <td style="font-size:10px;color:var(--text-muted);font-family:monospace;padding:6px 12px">${escapeHtml((t.transaction_no || '').slice(0, 16))}</td>
            </tr>`;
            if (t.sub_entries && t.sub_entries.length) {
              for (const s of t.sub_entries) {
                const sc = s.amount > 0 ? '#16a34a' : '#dc2626';
                const ss = s.amount > 0 ? '+' : '';
                html += `<tr style="background:rgba(0,0,0,0.025);border-top:1px solid var(--border)">
                  <td style="padding:4px 12px"></td>
                  <td style="padding-left:30px;padding-top:4px;padding-bottom:4px;font-size:11px"><span style="color:var(--text-muted)">└─</span> ${escapeHtml(s.counterparty || '')}</td>
                  <td class="hint hint--sm" style="padding:4px 12px">${escapeHtml(s.description || '')}</td>
                  <td class="money" style="color:${sc};font-size:11px;padding:4px 12px">${ss}${chf(s.amount)}</td>
                  <td style="padding:4px 12px"></td>
                  <td style="padding:4px 12px"></td>
                </tr>`;
              }
            }
            return html;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Bank statement analyzer (proposal review modal) ────────────────────────
async function analyzeBankStatement(id) {
  // Lazy-create the modal
  if (!document.getElementById('analyze-modal')) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="analyze-modal" class="modal-overlay" onclick="if(event.target===this)closeAnalyzeModal()">
        <div class="modal" style="max-width:1100px;max-height:90vh;display:flex;flex-direction:column">
          <div class="row-split" style="margin-bottom:12px">
            <div>
              <h3 style="margin:0">Review proposals</h3>
              <div id="analyze-source" class="hint hint--sm"></div>
            </div>
            <button class="btn btn--ghost btn--sm" onclick="closeAnalyzeModal()">Close</button>
          </div>
          <div id="analyze-toolbar" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <label style="font-size:12px"><input type="checkbox" id="analyze-toggle-all" onchange="toggleAllProposals(this.checked)"> Select all</label>
            <span id="analyze-count" class="hint"></span>
            <span style="flex:1"></span>
            <button class="btn btn--primary" id="analyze-apply-btn" onclick="applySelectedProposals()" disabled>Apply selected</button>
          </div>
          <div id="analyze-body" style="overflow-y:auto;flex:1;padding:8px 0"></div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }
  const modal = document.getElementById('analyze-modal');
  const body = document.getElementById('analyze-body');
  const source = document.getElementById('analyze-source');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Analyzing…</div>';
  source.textContent = '';
  modal.classList.add('show');
  try {
    const res = await fetch(`/api/bank-statements/${id}/analyze`, {
      method: 'POST', headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.error) {
      body.innerHTML = `<div style="padding:20px;color:var(--danger-text)">${escapeHtml(data.error)}</div>`;
      return;
    }
    source.textContent = `Source: ${data.source || '?'} · ${data.transactions_count} transactions parsed · ${data.proposals_count} proposals`;
    renderProposalList(data.proposals || []);
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;color:var(--danger-text)">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function closeAnalyzeModal() {
  const m = document.getElementById('analyze-modal');
  if (m) m.classList.remove('show');
}

let _analyzeProposals = [];

function renderProposalList(proposals) {
  _analyzeProposals = proposals;
  const body = document.getElementById('analyze-body');
  if (!proposals.length) {
    body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">No proposals — statement matches the DB already.</div>';
    return;
  }
  const TYPE_BADGE = {
    'add_bill':                  {label: 'Add bill',       color: '#3b82f6'},
    'add_vehicle':               {label: 'Add vehicle',    color: '#8b5cf6'},
    'add_shareholder_loan':      {label: 'Shareholder loan', color: '#06b6d4'},
    'mark_invoice_paid':         {label: 'Mark paid',      color: '#16a34a'},
    'add_invoice_reimbursement': {label: 'Add income',     color: '#f59e0b'},
    'update_employment_start':   {label: 'Update payroll', color: '#a16207'},
    'info_only':                 {label: 'Info only',      color: '#64748b'},
  };
  const CONF_DOT = {
    'high':   {color: '#16a34a', label: 'high confidence'},
    'medium': {color: '#f59e0b', label: 'medium confidence — review'},
    'low':    {color: '#dc2626', label: 'low confidence — verify'},
  };
  body.innerHTML = proposals.map((p, i) => {
    const badge = TYPE_BADGE[p.type] || {label: p.type, color: '#64748b'};
    const conf = CONF_DOT[p.confidence] || CONF_DOT.medium;
    const actionable = p.type !== 'info_only' && p.endpoint;
    // Default-check: high-confidence actionable proposals
    const defaultChecked = actionable && p.confidence === 'high';
    return `
      <div class="proposal-row" id="prop-row-${i}" style="display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--border)">
        <div style="width:30px;padding-top:2px">
          ${actionable ? `<input type="checkbox" class="proposal-cb" data-idx="${i}" ${defaultChecked ? 'checked' : ''} onchange="updateApplyCount()">` : `<span title="No action — info only" style="color:var(--text-muted)">—</span>`}
        </div>
        <div style="width:140px;flex-shrink:0">
          <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${badge.color};color:#fff;font-size:10px;font-weight:600">${badge.label}</span>
          <div style="margin-top:4px;font-size:10px;color:${conf.color}" title="${escapeHtml(conf.label)}">● ${p.confidence}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;line-height:1.4;white-space:pre-wrap">${escapeHtml(p.summary)}</div>
          ${p.notes ? `<div class="hint hint--sm" style="margin-top:4px;font-style:italic">💡 ${escapeHtml(p.notes)}</div>` : ''}
          ${p.endpoint ? `<div style="margin-top:3px;font-size:10px;color:var(--text-muted);font-family:monospace">${escapeHtml(p.method || 'POST')} ${escapeHtml(p.endpoint)}</div>` : ''}
        </div>
        <div id="prop-status-${i}" class="hint hint--sm" style="width:120px;text-align:right"></div>
      </div>`;
  }).join('');
  updateApplyCount();
}

function toggleAllProposals(checked) {
  document.querySelectorAll('.proposal-cb').forEach(cb => { cb.checked = checked; });
  updateApplyCount();
}

function updateApplyCount() {
  const checked = document.querySelectorAll('.proposal-cb:checked').length;
  const total = document.querySelectorAll('.proposal-cb').length;
  const btn = document.getElementById('analyze-apply-btn');
  const count = document.getElementById('analyze-count');
  if (btn) { btn.disabled = checked === 0; btn.textContent = `Apply selected (${checked})`; }
  if (count) count.textContent = `${checked} of ${total} actionable proposals selected`;
}

async function applySelectedProposals() {
  const checkboxes = Array.from(document.querySelectorAll('.proposal-cb:checked'));
  if (!checkboxes.length) return;
  const btn = document.getElementById('analyze-apply-btn');
  btn.disabled = true;
  btn.textContent = `Applying… 0 / ${checkboxes.length}`;
  let success = 0, failed = 0;
  for (let i = 0; i < checkboxes.length; i++) {
    const idx = parseInt(checkboxes[i].dataset.idx, 10);
    const p = _analyzeProposals[idx];
    const statusEl = document.getElementById(`prop-status-${idx}`);
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">Applying…</span>';
    try {
      const url = p.endpoint;
      const method = p.method || 'POST';
      const fmt = p.format || 'form';
      const token = localStorage.getItem('session_token');
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      let body;
      if (fmt === 'form') {
        const fd = new FormData();
        for (const [k, v] of Object.entries(p.payload || {})) {
          if (v !== undefined && v !== null) fd.append(k, v);
        }
        body = fd;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(p.payload || {});
      }
      const res = await fetch(url, { method, body, headers });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 80)}`);
      success++;
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--ok-text)">✓ Applied</span>';
      checkboxes[i].disabled = true;
      checkboxes[i].checked = false;
    } catch (e) {
      failed++;
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger-text)" title="${escapeHtml(e.message)}">✗ Failed</span>`;
    }
    btn.textContent = `Applying… ${i + 1} / ${checkboxes.length}`;
  }
  btn.textContent = `Done — ${success} applied, ${failed} failed`;
  btn.disabled = false;
  toast(`Applied ${success}, failed ${failed}`, failed > 0 ? 'error' : undefined);
  // Refresh affected pages
  if (typeof loadBankStatements === 'function') { try { loadBankStatements(); } catch {} }
  if (typeof loadInvoices === 'function')       { try { loadInvoices(); }       catch {} }
  if (typeof loadAccountingDocs === 'function') { try { loadAccountingDocs(); } catch {} }
  if (typeof loadDashboard === 'function')      { try { loadDashboard(); }      catch {} }
}

async function submitBankForm(ev) {
  ev.preventDefault();
  const id = document.getElementById('bank-id').value;
  const fd = new FormData();
  fd.append('bank',           document.getElementById('bank-name').value);
  fd.append('account_label',  document.getElementById('bank-account').value);
  fd.append('iban',           document.getElementById('bank-iban').value);
  fd.append('period_start',   document.getElementById('bank-period-start').value);
  fd.append('period_end',     document.getElementById('bank-period-end').value);
  fd.append('statement_type', document.getElementById('bank-type').value);
  fd.append('currency',       document.getElementById('bank-currency').value);
  const opening = document.getElementById('bank-opening').value;
  const closing = document.getElementById('bank-closing').value;
  if (opening !== '') fd.append('opening_balance', opening);
  if (closing !== '') fd.append('closing_balance', closing);
  fd.append('notes',          document.getElementById('bank-notes').value);
  const fp = document.getElementById('bank-file-pdf').files[0];
  if (fp) fd.append('file_pdf', fp);
  const fx = document.getElementById('bank-file-xml').files[0];
  if (fx) fd.append('file_xml', fx);
  try {
    const url = id ? `/api/bank-statements/${id}` : '/api/bank-statements';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    toast(id ? 'Statement updated' : 'Statement saved');
    closeBankModal();
    await loadBankYears();
    await loadBankStatements();
  } catch (e) { toast(e.message, 'error'); }
}

async function submitReserveForm(ev) {
  ev.preventDefault();
  const id = document.getElementById('reserve-id').value;
  const fd = new FormData();
  fd.append('name', document.getElementById('reserve-name').value);
  fd.append('purpose', document.getElementById('reserve-purpose').value);
  fd.append('target_amount', document.getElementById('reserve-target').value);
  fd.append('target_date', document.getElementById('reserve-target-date').value);
  fd.append('monthly_accrual', document.getElementById('reserve-monthly').value || 0);
  fd.append('accrual_start', document.getElementById('reserve-start').value);
  fd.append('accumulated_manual', document.getElementById('reserve-manual').value || 0);
  if (id) fd.append('is_active', 1);
  try {
    const url = id ? `/api/reserves/${id}` : '/api/reserves';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    toast(id ? 'Reserve updated' : 'Reserve added');
    closeReserveModal();
    reloadReserves();
  } catch (e) { toast(e.message, 'error'); }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function loadDashboard() {
  try {
    // Populate P&L year dropdown
    const plSel = document.getElementById('pl-year');
    if (plSel && !plSel.options.length) {
      const yr = new Date().getFullYear();
      plSel.innerHTML = [yr, yr-1, yr-2].map(y => `<option value="${y}">${y}</option>`).join('');
    }

    // Skeleton placeholders
    const statsContainer = document.getElementById('dashboard-stats');
    if (!statsContainer.children.length) statsContainer.innerHTML = skeletonStats(6);

    // Sync the range selector with the saved preference, then fetch with it
    const savedRange = Prefs.get('dashboard.range', 'ytd');
    const rangeSel = document.getElementById('dashboard-range');
    if (rangeSel && rangeSel.value !== savedRange) rangeSel.value = savedRange;

    const ov = await api(`/dashboard/overview?range=${encodeURIComponent(savedRange)}`);
    const active = getDashboardConfig();

    // Pull payroll preview in parallel only if the salary widget is on (saves a call otherwise)
    let payroll = null;
    if (active.has('net-salary')) {
      try { payroll = await api('/payroll/preview'); } catch { payroll = null; }
    }

    // Upcoming obligations — only if the widget is on
    let upcomingObs = null;
    if (active.has('upcoming-obligations')) {
      try {
        const up = await api('/upcoming-payments?days=60');
        upcomingObs = (up.items || []).filter(i => i.kind === 'obligation').slice(0, 3);
      } catch { upcomingObs = null; }
    }

    // Latest bank balance widget — silent if no statements uploaded yet
    try { renderBankWidget(await api('/bank-statements/latest')); } catch (e) {}

    // Reserves widget — silent if no reserves configured (also feeds the recap)
    let reserves = [];
    try { reserves = await api('/reserves'); renderReservesWidget(reserves); } catch (e) {}
    let runway = null;
    const anyRecap = DASHBOARD_WIDGETS.some(w => w.type === 'recap' && active.has(w.id));
    if (active.has('recap-bank')) { try { runway = await api('/runway'); } catch (e) {} }

    // Forecast (shared with the Forecast page) — feeds the chart + recap tile
    let forecast = null;
    if (active.has('forecast-chart') || active.has('recap-forecast')) {
      try { forecast = await api(forecastQuery()); } catch (e) {}
    }

    // Banner showing what range is currently active
    const banner = document.getElementById('dashboard-range-banner');
    if (banner && ov.range) {
      banner.textContent = `Showing: ${ov.range.label}  ·  ${ov.range.start} → ${ov.range.end}`;
    }

    // ─── STAT CARDS ───
    const statsEl = document.getElementById('dashboard-stats');
    const renderStat = (id, label, value, defaultMod, sub) => {
      // Per-widget override beats the default. 'none' means no accent at all.
      const stored = getWidgetSetting(id, 'color');
      let mod;
      if (stored === 'none') mod = null;
      else if (stored && stored in COLOR_BY_KEY) mod = COLOR_BY_KEY[stored];
      else mod = defaultMod;
      const span = getStatSize(id);
      const cls = ['stat'];
      if (mod) cls.push(`stat--${mod}`);
      if (span === 2) cls.push('stat--wide');
      if (span === 3) cls.push('stat--full');
      return `
        <div class="${cls.join(' ')}">
          <div class="stat__head"><span class="stat__label">${label}</span><button class="info-btn" onclick="event.stopPropagation(); showWidgetSettings('${id}')" title="Settings & info" aria-label="Settings">&#9432;</button></div>
          <div class="stat__value${mod ? ` stat__value--${mod}` : ''}">${value}</div>
          ${sub ? `<div class="stat__hint">${sub}</div>` : ''}
        </div>`;
    };

    const invPaidPct = ov.income.invoices_ytd > 0
      ? Math.round(ov.income.invoices_paid_ytd / ov.income.invoices_ytd * 100)
      : 0;

    const stats = {
      'income-ytd':        () => renderStat('income-ytd', 'Total Income', chf(ov.income.total_ytd), 'ok',
                                  `Invoiced ${chf(ov.income.invoiced_net_ytd)} net of VAT${ov.income.other_ytd > 0 ? ` + other ${chf(ov.income.other_ytd)}` : ''} · cash received ${chf(ov.income.cash_received_ytd)}`),
      'costs-ytd':         () => renderStat('costs-ytd', 'Total Costs', chf(ov.costs.total_ytd), 'danger',
                                  `Bills ${chf(ov.costs.bills_ytd)} + Payroll ${chf(ov.costs.payroll_ytd)} — accrual, matches Reports → P&L`),
      'profit-ytd':        () => renderStat('profit-ytd', 'Net Profit', chf(ov.profit.ytd),
                                  ov.profit.ytd >= 0 ? 'ok' : 'danger'),
      'profit-margin':     () => renderStat('profit-margin', 'Profit Margin', `${ov.profit.margin_pct}%`, 'info'),
      'avg-monthly-rev':   () => renderStat('avg-monthly-rev', 'Avg Monthly Revenue', chf(ov.invoices.avg_monthly_revenue), null,
                                  `Across ${ov.monthly_series.length} invoiced months`),
      'avg-monthly-hours': () => renderStat('avg-monthly-hours', 'Avg Monthly Hours', ov.invoices.avg_monthly_hours.toFixed(1), null,
                                  `Across ${ov.monthly_series.length} invoiced months`),
      'invoice-count':     () => renderStat('invoice-count', 'Invoices', ov.invoices.count_total, null, `${ov.invoices.count_ytd} this year`),
      'total-hours':       () => renderStat('total-hours', 'Total Hours', ov.invoices.total_hours, null, `${ov.invoices.hours_ytd} this year`),
      'overdue':           () => renderStat('overdue', 'Overdue', chf(ov.upcoming.overdue_total), ov.upcoming.overdue_total > 0 ? 'danger' : null),
      'upcoming-30d':      () => renderStat('upcoming-30d', 'Due Next 30 Days', chf(ov.upcoming.due_30d), 'warn'),
      'net-owed':          () => {
        const kn = ov.transfers.net_owed_to_personal || 0;
        return renderStat('net-owed', 'Kontokorrent', chf(Math.abs(kn)), kn > 0 ? 'owner' : (kn < 0 ? 'danger' : null),
          kn > 0 ? 'GmbH owes you' : kn < 0 ? 'You owe the GmbH' : 'Settled');
      },
      'invoices-paid-pct': () => renderStat('invoices-paid-pct', '% Invoices Paid', invPaidPct + '%',
                                  invPaidPct >= 80 ? 'ok' : 'warn',
                                  `${chf(ov.income.invoices_paid_ytd)} of ${chf(ov.income.invoices_ytd)}`),
      'net-salary':        () => {
        if (!payroll || !payroll.calculation) {
          return renderStat('net-salary', 'Net Salary (monthly)', '—', null,
            '<a href="#" onclick="navigateTo(\'payroll\');showPayrollSettings();return false" style="color:var(--primary)">Set up payroll →</a>');
        }
        const c = payroll.calculation;
        return renderStat('net-salary', 'Net Salary (monthly)', chf(c.net_salary), 'info',
          `Gross ${chf(c.gross)} − contrib ${chf(c.emp_total_deductions)} − tax ${chf(c.emp_source_tax)}` +
          ` · <a href="#" onclick="navigateTo(\'payroll\');showPayrollSettings();return false" style="color:var(--primary)">Edit</a>`);
      },
      'upcoming-obligations': () => {
        if (!upcomingObs || upcomingObs.length === 0) {
          return renderStat('upcoming-obligations', 'Next Obligations Due', '—', null,
            '<a href="#" onclick="navigateTo(\'obligations\');return false" style="color:var(--primary)">Add obligation →</a>');
        }
        const today = new Date(); today.setHours(0,0,0,0);
        const daysUntil = (dStr) => {
          const d = new Date(dStr + 'T00:00:00');
          return Math.round((d - today) / 86400000);
        };
        const total = upcomingObs.reduce((s, o) => s + (o.amount || 0), 0);
        const anyOverdue = upcomingObs.some(o => o.overdue);
        const headColor = anyOverdue ? 'danger' : 'warn';
        const subLines = upcomingObs.map(o => {
          const days = daysUntil(o.due_date);
          const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`;
          const color = days < 0 ? 'var(--danger-text)' : (days <= 7 ? 'var(--warn-text)' : 'var(--text-muted)');
          const short = (o.title || '').length > 20 ? (o.title.slice(0, 18) + '…') : (o.title || '');
          return `<span style="display:block"><a href="#" onclick="navigateTo('obligations');return false" style="color:var(--text);text-decoration:none">${escapeHtml(short)}</a> <span style="color:var(--text-muted)">· ${chf(o.amount)}</span> <span style="color:${color};font-weight:600">${label}</span></span>`;
        }).join('');
        return renderStat('upcoming-obligations', `Next ${upcomingObs.length} Obligations Due`, chf(total), headColor, subLines);
      },
    };
    const order = getDashboardOrder();
    const orderIndex = id => { const i = order.indexOf(id); return i < 0 ? 9999 : i; };
    statsEl.innerHTML = DASHBOARD_WIDGETS
      .filter(w => w.type === 'stat' && active.has(w.id))
      .sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
      .map(w => stats[w.id]().replace('<div class="', `<div draggable="true" data-widget-id="${w.id}" class="`)).join('');
    enableDashboardDrag();

    // ─── PANEL RECAP ───
    const panelsEl = document.getElementById('dashboard-panels');
    if (anyRecap) renderPanelsRecap(ov, {reserves, runway, active, forecast});
    else if (panelsEl) panelsEl.innerHTML = '';

    // ─── CHARTS ───
    const chartsEl = document.getElementById('dashboard-charts');
    chartsEl.innerHTML = '';

    if (active.has('revenue-chart')) {
      const h = CHART_SIZE_BY_KEY[getChartSize('revenue-chart')] + 'px';
      const plYear = (ov.monthly_pl && ov.monthly_pl.length) ? ov.monthly_pl[0].year : ov.year;
      const card = makeChartCard('revenue-chart', `Income vs Costs · ${plYear}`, 'revenueChart', h, chartSeriesLegend());
      chartsEl.appendChild(card);
      setTimeout(() => {
        const ctx = document.getElementById('revenueChart').getContext('2d');
        if (chart) chart.destroy();
        const t = getChartType('revenue-chart');
        chart = new Chart(ctx, buildSeriesChartConfig(t, ov.monthly_pl || []));
      }, 0);
    }

    if (active.has('forecast-chart') && forecast && forecast.months.length) {
      const h = CHART_SIZE_BY_KEY[getChartSize('forecast-chart')] + 'px';
      const card = makeChartCard('forecast-chart', `Cash forecast · ${forecast.year}`, 'forecastChart', h, forecastLegend());
      chartsEl.appendChild(card);
      setTimeout(() => {
        const ctx = document.getElementById('forecastChart').getContext('2d');
        if (window._dashForecastChart) window._dashForecastChart.destroy();
        window._dashForecastChart = new Chart(ctx, buildForecastChartConfig(forecast.months));
      }, 0);
    }

    if (active.has('cost-breakdown') && ov.costs.by_category.length) {
      const h = CHART_SIZE_BY_KEY[getChartSize('cost-breakdown')] + 'px';
      const card = makeChartCard('cost-breakdown', `Costs by Category · ${ov.range ? ov.range.label : 'YTD'}`, 'costChart', h);
      chartsEl.appendChild(card);
      setTimeout(() => {
        const ctx = document.getElementById('costChart').getContext('2d');
        if (costChart) costChart.destroy();
        const t = getChartType('cost-breakdown');
        const showLegend = getChartShowLegend('cost-breakdown', true);
        costChart = new Chart(ctx, buildCategoryChartConfig(t, ov.costs.by_category, showLegend));
      }, 0);
    }

    // ─── LISTS ───
    const listsEl = document.getElementById('dashboard-lists');
    listsEl.innerHTML = '';

    if (active.has('recent-invoices')) {
      const limit = getListRowCount('recent-invoices', 5);
      const visible = ov.recent_invoices.slice(0, limit);
      const rows = visible.length
        ? visible.map(inv => {
            const s = computeStatus(inv.paid_status, inv.due_date);
            return `<tr>
              <td class="mono">#${pad4(inv.invoice_number)}</td>
              <td>${inv.month_name} ${inv.year}</td>
              <td>${inv.hours}</td>
              <td class="money">${chf(inv.total)}</td>
              <td><span class="${s.cls}">${s.label}</span></td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="5" class="empty-cell">No invoices yet</td></tr>';
      const card = document.createElement('div');
      card.className = 'table-card';
      card.dataset.width = getCardWidth('recent-invoices');
      card.innerHTML = `
        <div class="table-header"><h3>Recent Invoices</h3>
          <button class="info-btn" onclick="showWidgetSettings('recent-invoices')" title="Settings & info" aria-label="Settings">&#9432;</button>
        </div>
        <table>
          <thead><tr><th>#</th><th>Period</th><th>Hours</th><th class="text-right">Total</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      listsEl.appendChild(card);
    }

    if (active.has('anomalies')) {
      try {
        const an = await api('/anomalies');
        if (an.items.length) {
          const card = document.createElement('div');
          card.className = 'table-card';
          card.dataset.width = getCardWidth('anomalies');
          const limit = getListRowCount('anomalies', 8);
          const rows = an.items.slice(0, limit).map(a => `
            <tr>
              <td><strong>${a.vendor}</strong><div class="hint hint--sm">${a.message}</div></td>
              <td class="money" style="color:${a.severity === 'high' ? 'var(--danger-text)' : 'var(--warn-text)'}">${chf(a.current_amount)}<div class="hint hint--sm">vs avg ${chf(a.expected_mean)}</div></td>
              <td class="text-right">
                <button class="btn btn--ghost btn--sm" onclick="dismissAnomaly(${a.bill_id})" title="Mark as reviewed">✓</button>
                <button class="btn btn--ghost btn--icon" onclick="editAccountingDoc(${a.bill_id})" title="Open bill">&#9998;</button>
              </td>
            </tr>`).join('');
          card.innerHTML = `
            <div class="table-header">
              <h3>&#9888; Anomalies — bills that deviate from usual amount</h3>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="hint">${an.count} flagged</span>
                <button class="info-btn" onclick="showWidgetSettings('anomalies')" title="Settings & info" aria-label="Settings">&#9432;</button>
              </div>
            </div>
            <table>
              <thead><tr><th>Vendor / Detail</th><th class="text-right">Current vs Avg</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`;
          listsEl.appendChild(card);
        }
      } catch {}
    }

    if (active.has('recent-bills')) {
      const limit = getListRowCount('recent-bills', 5);
      const visible = ov.recent_bills.slice(0, limit);
      const rows = visible.length
        ? visible.map(b => {
            const s = computeStatus(b.status, b.due_date);
            return `<tr>
              <td>${b.doc_date}</td>
              <td><strong>${b.vendor}</strong></td>
              <td>${b.category}</td>
              <td class="money">${b.currency} ${b.amount.toLocaleString('de-CH',{minimumFractionDigits:2})}</td>
              <td><span class="${s.cls}">${s.label}</span></td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="5" class="empty-cell">No bills yet</td></tr>';
      const card = document.createElement('div');
      card.className = 'table-card';
      card.dataset.width = getCardWidth('recent-bills');
      card.innerHTML = `
        <div class="table-header"><h3>Recent Bills</h3>
          <button class="info-btn" onclick="showWidgetSettings('recent-bills')" title="Settings & info" aria-label="Settings">&#9432;</button>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      listsEl.appendChild(card);
    }
  } catch (e) { toast(e.message, 'error'); }
}

let allInvoices = [];

function invSearchInput(value) {
  pageSearchInput('invoice', value, 'inv-search-chips', renderInvoices);
}

async function loadInvoices() {
  try {
    allInvoices = await api('/invoices');
    persistFilter('invoices', ['inv-search']);
    const q = (document.getElementById('inv-search') || {}).value;
    if (q && q.trim().length >= 2 && !pageSearchIds('invoice')) invSearchInput(q);
    renderInvoices();
  } catch (e) { toast(e.message, 'error'); }
}

function renderInvoices() {
  try {
    const tbody = document.getElementById('invoices-tbody');
    if (!allInvoices.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding:0;border:none">${emptyState('&#9776;', 'No invoices yet', 'Create your first invoice for a client.', '+ New Invoice', () => navigateTo('form'))}</td></tr>`;
      return;
    }
    const ids = pageSearchIds('invoice');
    const invoices = ids ? allInvoices.filter(i => ids.has(i.id)) : allInvoices;
    if (!invoices.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">No invoices match this search</td></tr>`;
      return;
    }
    tbody.innerHTML = invoices.map(inv => `
      <tr>
        <td class="mono">#${pad4(inv.invoice_number)}</td>
        <td>${inv.month_name} ${inv.year}</td>
        <td class="text-right">${inv.hours}</td>
        <td class="money">${chf(inv.subtotal)}</td>
        <td class="money">${chf(inv.tax)}</td>
        <td class="money"><strong>${chf(inv.total)}</strong></td>
        <td class="text-right">${inv.due_date}</td>
        <td>${(() => { const s = computeStatus(inv.paid_status, inv.due_date); return `<span class="${s.cls}" onclick="toggleInvoiceStatus(${inv.id}, '${inv.paid_status}')" style="cursor:pointer" title="Click to toggle">${s.label}</span>`; })()}</td>
        <td class="hint" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${inv.notes || ''}">${inv.notes || '-'}</td>
        <td class="text-right">
          <div class="actions">
            <button class="btn btn--ghost btn--icon" onclick="previewPdf('/api/invoices/${inv.id}/pdf', 'Invoice #${pad4(inv.invoice_number)}')" title="Preview PDF">&#128196;</button>
            <a href="${tokenUrl('/api/invoices/' + inv.id + '/pdf?download=true')}" class="btn btn--ghost btn--icon" title="Download">&#128190;</a>
            <button class="btn btn--ghost btn--icon" onclick="editInvoice(${inv.id})" title="Edit">&#9998;</button>
            <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="confirmDelete(${inv.id}, ${inv.invoice_number}, 'invoice')" title="Delete">&#128465;</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// Invoice form
async function prepareNewForm() {
  document.getElementById('form-title').textContent = 'New Invoice';
  document.getElementById('form-submit-btn').textContent = 'Generate Invoice';
  await loadCustomerDropdown();
  try {
    const {next} = await api('/next-invoice-number');
    document.getElementById('f-invnum').value = next;
  } catch {}
}

function clearForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('invoice-form').reset();
  document.getElementById('f-invnum').disabled = false;
  document.getElementById('f-notes').value = '';
  updatePreview();
}

function updatePreview() {
  const hours = parseFloat(document.getElementById('f-hours').value) || 0;
  const sub = hours * RATE;
  const tax = Math.round(sub * VAT * 100) / 100;
  document.getElementById('prev-subtotal').textContent = chf(sub);
  document.getElementById('prev-tax').textContent = chf(tax);
  document.getElementById('prev-total').textContent = chf(Math.round((sub + tax) * 100) / 100);
}

async function handleSubmit(e) {
  e.preventDefault();
  const [year, month] = document.getElementById('f-month').value.split('-').map(Number);
  const hours = parseFloat(document.getElementById('f-hours').value);
  const notes = document.getElementById('f-notes').value.trim();
  const editId = document.getElementById('edit-id').value;
  try {
    const custId = parseInt(document.getElementById('f-customer').value) || null;
    if (editId) {
      await api(`/invoices/${editId}`, { method: 'PUT', body: JSON.stringify({year, month, hours, customer_id: custId, notes}) });
      toast('Invoice updated');
    } else {
      const invNum = parseInt(document.getElementById('f-invnum').value) || null;
      await api('/invoices', { method: 'POST', body: JSON.stringify({year, month, hours, invoice_number: invNum, customer_id: custId, notes}) });
      toast('Invoice created');
    }
    clearForm();
    navigateTo('invoices');
  } catch (e) { toast(e.message, 'error'); }
}

async function editInvoice(id) {
  try {
    const inv = await api(`/invoices/${id}`);
    document.getElementById('edit-id').value = id;
    document.getElementById('f-month').value = `${inv.year}-${String(inv.month).padStart(2,'0')}`;
    document.getElementById('f-hours').value = inv.hours;
    document.getElementById('f-invnum').value = inv.invoice_number;
    document.getElementById('f-invnum').disabled = true;
    document.getElementById('f-notes').value = inv.notes || '';
    document.getElementById('form-title').textContent = `Edit Invoice #${pad4(inv.invoice_number)}`;
    document.getElementById('form-submit-btn').textContent = 'Update Invoice';
    updatePreview();
    navigateTo('form');
  } catch (e) { toast(e.message, 'error'); }
}

function cancelEdit() {
  clearForm();
  navigateTo('invoices');
}

