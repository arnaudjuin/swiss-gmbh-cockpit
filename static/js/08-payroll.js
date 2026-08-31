// 08-payroll.js — payroll, reports (VAT/tax), undo toast, navigate-away guard
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// PAYROLL
// ══════════════════════════════════════════════════════════════════════════════

async function loadPayroll() {
  const sel = document.getElementById('payroll-year');
  if (!sel.options.length) {
    const yr = new Date().getFullYear();
    sel.innerHTML = [yr, yr-1, yr-2, yr-3].map(y => `<option value="${y}">${y}</option>`).join('');
  }
  const year = parseInt(sel.value);

  try {
    const [preview, payslips, ytd] = await Promise.all([
      api('/payroll/preview'),
      api(`/payroll/payslips?year=${year}`),
      api(`/payroll/ytd/${year}`),
    ]);

    // Preview card
    renderPayrollPreview(preview);

    // YTD stats
    renderPayrollYTD(year, ytd);

    // Payslips list
    renderPayslipsList(payslips);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Informal cash plan: one mini-payslip card per remaining month. Every
// obligation line has a PLAN CHOICE, persisted in Prefs (server-backed):
//   'YYYY-MM' → full amount lands in that month's card
//   'spread'  → equal share in every remaining month
// Defaults: due-in-window → its cash month; overdue and 2027-landing bills
// → spread. The selects on each row let you move balances around.
let _planCache = null;

function _planPrefPath(year, id) { return `payrollPlan.${year}.${id}`; }

function setPayrollPlanChoice(id, value) {
  if (!_planCache) return;
  Prefs.set(_planPrefPath(_planCache.year, id), value);
  renderPayrollCashPlan(_planCache.preview, _planCache.obligations);
}

function togglePayrollEqualize(on) {
  if (!_planCache) return;
  Prefs.set(`payrollPlan.${_planCache.year}._equalize`, !!on);
  renderPayrollCashPlan(_planCache.preview, _planCache.obligations);
}

function resetPayrollPlan() {
  if (!_planCache) return;
  Prefs.set(`payrollPlan.${_planCache.year}`, {});
  renderPayrollCashPlan(_planCache.preview, _planCache.obligations);
}

function renderPayrollCashPlan(preview, obligations) {
  const el = document.getElementById('payroll-cash-plan');
  if (!el) return;
  const calc = preview?.calculation;
  const s = preview?.settings || {};
  const now = new Date();
  const year = now.getFullYear();
  const startM = now.getMonth() + 1;
  if (!calc || startM > 12) { el.innerHTML = '<p class="hint">No months left this year.</p>'; return; }
  _planCache = {preview, obligations, year};

  const monthsLeft = 12 - startM + 1;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthKeys = [];
  for (let m = startM; m <= 12; m++) monthKeys.push(`${year}-${String(m).padStart(2, '0')}`);

  const cashMonth = (o) => {
    const base = o.expected_bill_date && o.due_date && o.expected_bill_date > o.due_date
      ? o.expected_bill_date : (o.due_date || o.expected_bill_date);
    return base ? base.slice(0, 7) : null;
  };
  const unpaid = (obligations || []).filter(o => o.status === 'unpaid');
  const firstKey = monthKeys[0];
  const isOverdue = (o) => { const m = cashMonth(o); return m && m < firstKey; };

  // "Equal months" mode: EVERYTHING spreads evenly — each card ends at the
  // same total. Reversible: per-item choices are kept, just ignored while on.
  const equalized = !!Prefs.get(`payrollPlan.${year}._equalize`);
  const choiceOf = (o) => {
    if (equalized) return 'spread';
    const stored = Prefs.get(_planPrefPath(year, o.id));
    if (stored === 'spread' || monthKeys.includes(stored)) return stored;
    const cm = cashMonth(o);
    if (cm && monthKeys.includes(cm)) return cm;      // lands in the window
    return 'spread';                                   // overdue or next-year
  };
  const amountOf = (o) => o.expected_bill_amount ?? o.amount;
  const anyOverride = unpaid.some(o => {
    const v = Prefs.get(_planPrefPath(year, o.id));
    return v === 'spread' || monthKeys.includes(v);
  });

  const moveSel = (o, current) => equalized ? '' : `<select class="control control--auto" style="font-size:11px;padding:1px 4px"
      onchange="setPayrollPlanChoice(${o.id}, this.value)" title="Move this item to another month, or spread it evenly">
      <option value="spread"${current === 'spread' ? ' selected' : ''}>Spread /${monthsLeft}</option>
      ${monthKeys.map(k => `<option value="${k}"${current === k ? ' selected' : ''}>${MONTHS[parseInt(k.slice(5)) - 1].slice(0, 3)}</option>`).join('')}
    </select>`;

  const fullBy = {}, spreadItems = [];
  for (const o of unpaid) {
    const c = choiceOf(o);
    if (c === 'spread') spreadItems.push(o);
    else (fullBy[c] = fullBy[c] || []).push(o);
  }
  const spreadShare = spreadItems.reduce((sum, o) => sum + amountOf(o), 0) / monthsLeft;

  const itemLabel = (o) => `${o.type_label} · ${escapeHtml(o.period_label)}${isOverdue(o) ? ' <span class="chip chip--danger chip--sm">overdue</span>' : ''}`;

  const cards = monthKeys.map((key, idx) => {
    const m = parseInt(key.slice(5));
    const full = fullBy[key] || [];
    const fullTotal = full.reduce((sum, o) => sum + amountOf(o), 0);
    const total = calc.net_salary + fullTotal + spreadShare;
    const fullRows = full.map(o => `
      <div class="row-split" style="padding:3px 0">
        <span class="hint" style="flex:1;min-width:0">${itemLabel(o)}</span>
        <span class="money">${chf(amountOf(o))}</span>
        ${moveSel(o, key)}
      </div>`).join('');
    const spreadRows = spreadItems.map(o => `
      <div class="row-split" style="padding:2px 0">
        <span class="hint hint--sm" style="flex:1;min-width:0">${itemLabel(o)} <span class="t-muted">(bill ${o.expected_bill_date || o.due_date || '—'})</span></span>
        <span class="money">${chf(amountOf(o) / monthsLeft)}</span>
        ${idx === 0 ? moveSel(o, 'spread') : ''}
      </div>`).join('');
    return `<div class="panel">
      <div class="row-split" style="margin-bottom:6px">
        <strong>${MONTHS[m-1]} ${year}</strong>
        <span class="chip chip--expected">informal</span>
      </div>
      <div class="row-split" style="padding:3px 0;border-top:1px solid var(--border)">
        <span>Net salary → you <span class="hint">(~${s.payment_day || 25}th, gross ${chf(calc.gross)})</span></span>
        <span class="money">${chf(calc.net_salary)}</span>
      </div>
      ${fullRows || '<div class="hint hint--sm" style="padding:3px 0">no full payments placed this month</div>'}
      ${spreadItems.length ? `
      <div class="section-label" style="margin-top:6px">Spread items (1/${monthsLeft} each${idx === 0 ? ' — move with the selects' : ''})</div>
      ${spreadRows}
      <div class="row-split" style="padding:3px 0;border-top:1px solid var(--border)">
        <span class="hint">Spread subtotal</span>
        <span class="money">${chf(spreadShare)}</span>
      </div>` : ''}
      <div class="row-split" style="padding:5px 0;border-top:2px solid var(--border-strong);margin-top:2px">
        <strong>Leaves / set aside</strong>
        <span class="money money--lg">${chf(total)}</span>
      </div>
    </div>`;
  });

  const overdueTotal = unpaid.filter(isOverdue).reduce((sum, o) => sum + amountOf(o), 0);
  const headHtml = `<div class="row-split" style="grid-column:1/-1">
    <span class="hint">${overdueTotal > 0 ? `⚠ ${chf(overdueTotal)} of overdue items are shared across the months (or move them where you want).` : 'Every unpaid obligation for the year is placed below.'}</span>
    <label class="hint" style="cursor:pointer;white-space:nowrap">
      <input type="checkbox" style="width:auto;vertical-align:middle" ${equalized ? 'checked' : ''}
        onchange="togglePayrollEqualize(this.checked)">
      Equal months — spread everything evenly
    </label>
    ${anyOverride && !equalized ? '<button class="btn btn--ghost btn--sm" onclick="resetPayrollPlan()">Reset to automatic</button>' : ''}
  </div>`;
  const laterNote = `<div class="hint" style="grid-column:1/-1">
    Spread items are what the “Future obligations (2027 bills)” envelope above saves for — set the money aside once, not twice.
  </div>`;
  el.innerHTML = headHtml + cards.join('') + laterNote;
}

function renderPayrollPreview(data) {
  const s = data.settings;
  const c = data.calculation;
  const badge = document.getElementById('payroll-preview-badge');
  badge.textContent = `${s.employee_name} · Gross ${chf(s.gross_monthly)}/mo · Start ${s.employment_start}`;

  const row = (label, val, note, bold, color) => `
    <tr>
      <td style="${bold ? 'font-weight:600' : ''}">${label} ${note ? `<span class="hint hint--sm" style="margin-left:6px">${note}</span>` : ''}</td>
      <td class="money" style="${bold ? 'font-weight:700' : ''};${color ? `color:${color}` : ''}">${chf(val)}</td>
    </tr>`;

  const ktgEmpSharePct = 100 - s.ktg_employer_share_pct;
  const container = document.getElementById('payroll-preview-content');
  const stRow = (c.emp_source_tax > 0)
    ? row(`Source Tax${s.source_tax_tariff ? ' (' + s.source_tax_tariff + ')' : ''}`, c.emp_source_tax, 'Per tariff')
    : '';
  const fakRow = (c.employer_fak > 0)
    ? row('FAK (Family Allowance)', c.employer_fak, `${s.fak_employer_pct}%`)
    : '';
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:12px">
      <div>
        <h4 class="section-label" style="margin-bottom:8px">Employee side</h4>
        <table style="width:100%">
          ${row('Gross salary', c.gross, '', true)}
          ${row('AHV / IV / EO', c.emp_ahv, `Official ${s.ahv_employee_pct}%`)}
          ${row('ALV', c.emp_alv, `Official ${s.alv_employee_pct}% / 0.5% above plafond`)}
          ${row(`BVG (${s.bvg_provider || 'AXA'})`, c.emp_bvg, 'Exact')}
          ${row('UVG (NOA)', c.emp_uvg, 'Exact')}
          ${row(`KTG (${ktgEmpSharePct.toFixed(0)}%)`, c.emp_ktg, 'Exact')}
          ${stRow}
          ${row('Total deductions', c.emp_total_deductions, '', true, 'var(--danger-text)')}
          ${row('Net salary', c.net_salary, '', true, 'var(--ok-text)')}
        </table>
      </div>
      <div>
        <h4 class="section-label" style="margin-bottom:8px">Employer side</h4>
        <table style="width:100%">
          ${row('AHV / IV / EO', c.employer_ahv, `Official ${s.ahv_employer_pct}%`)}
          ${row('ALV', c.employer_alv, `Official ${s.alv_employer_pct}% / 0.5% above plafond`)}
          ${row(`BVG (${s.bvg_provider || 'AXA'})`, c.employer_bvg, 'Exact')}
          ${row('UVG (OA + Supp)', c.employer_uvg, 'Exact')}
          ${row(`KTG (${s.ktg_employer_share_pct.toFixed(0)}%)`, c.employer_ktg, 'Exact')}
          ${fakRow}
          ${row('Total employer contributions', c.employer_total, '', true)}
          ${row('Total employer cost', c.total_employer_cost, '', true, 'var(--primary)')}
        </table>
      </div>
    </div>`;
}

function renderPayrollYTD(year, ytd) {
  const container = document.getElementById('payroll-ytd-stats');
  const t = ytd.totals;
  const cards = [
    {label: `Gross YTD ${year}`, val: t.gross, mod: null},
    {label: 'Net YTD', val: t.net_salary, mod: 'ok'},
    {label: 'Employee deductions', val: t.emp_total_deductions, mod: 'danger'},
    {label: 'Employer contributions', val: t.employer_total, mod: null},
    {label: 'Total employer cost', val: t.total_employer_cost, mod: 'info'},
    {label: 'Payslips issued', val: null, text: `${ytd.count}`, mod: null},
  ];
  container.innerHTML = cards.map(c => `
    <div class="stat${c.mod ? ` stat--${c.mod}` : ''}">
      <div class="stat__label">${c.label}</div>
      <div class="stat__value${c.mod ? ` stat__value--${c.mod}` : ''}">${c.text || chf(c.val)}</div>
    </div>`).join('');
}

function renderPayslipsList(payslips) {
  const tbody = document.getElementById('payslips-tbody');
  document.getElementById('payslips-count').textContent = payslips.length;
  if (!payslips.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:0;border:none">${emptyState('&#128100;', 'No payslips yet', 'Generate your first payslip using current settings.', '+ Generate Payslip', () => openGeneratePayslip())}</td></tr>`;
    return;
  }
  tbody.innerHTML = payslips.map(p => `
    <tr>
      <td><strong>${p.month_name} ${p.year}</strong>${p.source === 'uploaded' ? ' <span class="chip chip--owner" title="Official payslip PDF uploaded from your accountant">accountant</span>' : ''}</td>
      <td>${p.payment_date}</td>
      <td class="money">${chf(p.gross)}</td>
      <td class="money money--danger">${chf(p.emp_total_deductions)}</td>
      <td class="money" style="color:var(--ok-text);font-weight:600">${chf(p.net_salary)}</td>
      <td class="money">${chf(p.total_employer_cost)}</td>
      <td><span class="${p.status === 'paid' ? 'chip chip--ok' : 'chip chip--warn'}" onclick="togglePayslipStatus(${p.id}, '${p.status}')" style="cursor:pointer">${p.status}</span></td>
      <td class="text-right">
        <div class="actions">
          <button class="btn btn--ghost btn--icon" onclick="previewPdf('/api/payroll/payslip/${p.id}/pdf', 'Payslip ${p.month_name} ${p.year}')" title="View PDF">&#128196;</button>
          <a href="${tokenUrl('/api/payroll/payslip/' + p.id + '/pdf?download=true')}" class="btn btn--ghost btn--icon" title="Download">&#128190;</a>
          <button class="btn btn--ghost btn--icon" onclick="regeneratePayslip(${p.year}, ${p.month})" title="${p.source === 'uploaded' ? 'Regenerate — replaces the accountant PDF with a tool-generated one' : 'Regenerate'}">&#8634;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deletePayslip(${p.id})" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>`).join('');
}

function openUploadPayslip() {
  const now = new Date();
  document.getElementById('upl-year').value = document.getElementById('payroll-year').value || now.getFullYear();
  document.getElementById('upl-month').value = now.getMonth() + 1;
  document.getElementById('upload-payslip-dialog').classList.add('show');
}

async function handleUploadPayslip(e) {
  e.preventDefault();
  const file = document.getElementById('upl-file').files[0];
  if (!file) { toast('Please choose a PDF', 'error'); return; }
  const fd = new FormData();
  fd.append('year', document.getElementById('upl-year').value);
  fd.append('month', document.getElementById('upl-month').value);
  fd.append('payment_date', document.getElementById('upl-payment-date').value);
  const gross = document.getElementById('upl-gross').value;
  const net = document.getElementById('upl-net').value;
  if (gross) fd.append('gross', gross);
  if (net) fd.append('net', net);
  fd.append('doc', file);
  try {
    const res = await api('/payroll/payslips/upload', { method: 'POST', body: fd });
    toast(res.replaced ? 'Accountant payslip attached — replaced the generated PDF' : 'Accountant payslip added');
    document.getElementById('upload-payslip-dialog').classList.remove('show');
    e.target.reset();
    loadPayroll();
  } catch (err) { toast(err.message, 'error'); }
}

async function showPayrollSettings() {
  try {
    const s = await api('/payroll/settings');
    document.getElementById('ps-employer').value = s.employer_name;
    document.getElementById('ps-employee').value = s.employee_name;
    document.getElementById('ps-address').value = s.employee_address;
    document.getElementById('ps-start').value = s.employment_start;
    document.getElementById('ps-canton').value = s.canton;
    document.getElementById('ps-pay-day').value = s.payment_day;
    document.getElementById('ps-currency').value = s.currency;
    document.getElementById('ps-gross').value = s.gross_monthly;
    document.getElementById('ps-ahv-e').value = s.ahv_employee_pct;
    document.getElementById('ps-ahv-er').value = s.ahv_employer_pct;
    document.getElementById('ps-alv-e').value = s.alv_employee_pct;
    document.getElementById('ps-alv-er').value = s.alv_employer_pct;
    document.getElementById('ps-bvg-prov').value = s.bvg_provider;
    document.getElementById('ps-bvg-e').value = s.bvg_monthly_employee;
    document.getElementById('ps-bvg-er').value = s.bvg_monthly_employer;
    document.getElementById('ps-uvg-e').value = s.uvg_employee_monthly;
    document.getElementById('ps-uvg-er').value = s.uvg_employer_monthly;
    document.getElementById('ps-ktg').value = s.ktg_monthly_total;
    document.getElementById('ps-ktg-er').value = s.ktg_employer_share_pct;
    document.getElementById('ps-fak').value = s.fak_employer_pct ?? 1.2;
    document.getElementById('ps-st-tariff').value = s.source_tax_tariff || '';
    document.getElementById('ps-st-amount').value = s.source_tax_monthly ?? 0;
    document.getElementById('payroll-settings-dialog').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

async function savePayrollSettings(e) {
  e.preventDefault();
  const body = {
    employer_name: document.getElementById('ps-employer').value,
    employee_name: document.getElementById('ps-employee').value,
    employee_address: document.getElementById('ps-address').value,
    employment_start: document.getElementById('ps-start').value,
    canton: document.getElementById('ps-canton').value,
    payment_day: document.getElementById('ps-pay-day').value,
    currency: document.getElementById('ps-currency').value,
    gross_monthly: document.getElementById('ps-gross').value,
    ahv_employee_pct: document.getElementById('ps-ahv-e').value,
    ahv_employer_pct: document.getElementById('ps-ahv-er').value,
    alv_employee_pct: document.getElementById('ps-alv-e').value,
    alv_employer_pct: document.getElementById('ps-alv-er').value,
    bvg_provider: document.getElementById('ps-bvg-prov').value,
    bvg_monthly_employee: document.getElementById('ps-bvg-e').value,
    bvg_monthly_employer: document.getElementById('ps-bvg-er').value,
    uvg_employee_monthly: document.getElementById('ps-uvg-e').value,
    uvg_employer_monthly: document.getElementById('ps-uvg-er').value,
    ktg_monthly_total: document.getElementById('ps-ktg').value,
    ktg_employer_share_pct: document.getElementById('ps-ktg-er').value,
    fak_employer_pct: document.getElementById('ps-fak').value,
    source_tax_monthly: document.getElementById('ps-st-amount').value,
    source_tax_tariff: document.getElementById('ps-st-tariff').value,
  };
  try {
    await api('/payroll/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('Settings saved');
    document.getElementById('payroll-settings-dialog').classList.remove('show');
    loadPayroll();
  } catch (e) { toast(e.message, 'error'); }
}

function openGeneratePayslip() {
  const now = new Date();
  document.getElementById('gen-year').value = now.getFullYear();
  document.getElementById('gen-month').value = now.getMonth() + 1;
  document.getElementById('payslip-generate-dialog').classList.add('show');
}

async function generatePayslipSubmit(e) {
  e.preventDefault();
  const year = parseInt(document.getElementById('gen-year').value);
  const month = parseInt(document.getElementById('gen-month').value);
  const body = {
    create_income: document.getElementById('gen-opt-income').checked,
    create_transfer: document.getElementById('gen-opt-transfer').checked,
    create_obligations: document.getElementById('gen-opt-obligations').checked,
  };
  try {
    const res = await api(`/payroll/generate/${year}/${month}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    document.getElementById('payslip-generate-dialog').classList.remove('show');
    const parts = ['PDF generated'];
    if (res.side_effects.income) parts.push('income logged');
    if (res.side_effects.transfer) parts.push('transfer logged');
    if (res.side_effects.obligations_created) parts.push(`${res.side_effects.obligations_created} obligations created`);
    toast(`${year}-${String(month).padStart(2,'0')} · ${parts.join(' · ')}`);
    loadPayroll();
  } catch (e) { toast(e.message, 'error'); }
}

async function regeneratePayslip(year, month) {
  // Regenerate recomputes with TODAY'S settings — if those changed since the
  // payslip was issued, this rewrites history. Show the diff and ask first.
  try {
    const [preview, slips] = await Promise.all([
      api('/payroll/preview'),
      api(`/payroll/payslips?year=${year}`),
    ]);
    const current = slips.find(p => p.month === month);
    if (current && preview.calculation) {
      const newNet = preview.calculation.net_salary, newGross = preview.calculation.gross;
      const changes = [];
      if (Math.abs(newGross - current.gross) > 0.01)
        changes.push(`gross ${chf(current.gross)} → ${chf(newGross)}`);
      if (Math.abs(newNet - current.net_salary) > 0.01)
        changes.push(`net ${chf(current.net_salary)} → ${chf(newNet)}`);
      if (current.source === 'uploaded')
        changes.push("the accountant's uploaded PDF will be replaced by a generated one");
      if (changes.length) {
        const ok = confirm(
          `Regenerating ${current.month_name} ${year} with TODAY'S payroll settings will change it:\n\n` +
          changes.map(s => `  • ${s}`).join('\n') +
          `\n\nThe issued payslip will be overwritten. Continue?`);
        if (!ok) return;
      }
    }
    await api(`/payroll/generate/${year}/${month}`, {
      method: 'POST',
      body: JSON.stringify({create_income: false, create_transfer: false, create_obligations: false}),
    });
    toast('Payslip PDF regenerated (side-effects untouched)');
    loadPayroll();
  } catch (e) { toast(e.message, 'error'); }
}

async function deletePayslip(id) {
  if (!confirm('Delete this payslip?')) return;
  try {
    await api(`/payroll/payslip/${id}`, { method: 'DELETE' });
    toast('Payslip deleted');
    loadPayroll();
  } catch (e) { toast(e.message, 'error'); }
}

async function togglePayslipStatus(id, current) {
  const next = current === 'paid' ? 'issued' : 'paid';
  try {
    await api(`/payroll/payslip/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({status: next}),
    });
    toast(`Marked ${next}`);
    loadPayroll();
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS (VAT / Tax / Quarterly)
// ══════════════════════════════════════════════════════════════════════════════

let reportsSelectedQ = null;

async function loadReports() {
  // Apply visibility + order before fetching data so hidden sections aren't loaded.
  applyReportsLayout();
  const active = getReportsConfig();

  // Populate year dropdown
  const sel = document.getElementById('reports-year');
  if (!sel.options.length) {
    const yr = new Date().getFullYear();
    sel.innerHTML = [yr, yr-1, yr-2].map(y => `<option value="${y}">${y}</option>`).join('');
  }
  const year = parseInt(sel.value);

  // Auto-pick current quarter
  if (!reportsSelectedQ) reportsSelectedQ = Math.floor((new Date().getMonth()) / 3) + 1;

  if (active.has('quarterly')) await loadQuarterly(reportsSelectedQ);
  if (active.has('vat'))       await loadVAT(year);
  if (active.has('tax'))       await loadTaxEstimate(year);
  if (active.has('sheets'))    await loadSheetsUrls();
}

async function loadSheetsUrls() {
  const container = document.getElementById('sheets-urls');
  if (!container) return;
  try {
    const shares = await api('/shares');
    const acctShare = shares.find(s => s.section === 'accounting');
    if (!acctShare) {
      container.innerHTML = '<p class="hint">No share link yet — create one on Bills & Documents (Share button).</p>';
      return;
    }
    const base = window.location.origin + '/share/' + acctShare.token + '/sheet';
    const urls = [
      {label: 'Invoices', url: `${base}/invoices.csv`},
      {label: 'Bills', url: `${base}/bills.csv`},
      {label: 'Travel Expenses', url: `${base}/expenses.csv`},
    ];
    container.innerHTML = urls.map(u => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:13px">
        <strong style="min-width:120px">${u.label}</strong>
        <input type="text" value='=IMPORTDATA("${u.url}")' readonly onclick="this.select()"
               style="flex:1;padding:6px 10px;font-family:monospace;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text)">
        <button class="btn btn--ghost btn--sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>toast('Copied'))" title="Copy">&#128203;</button>
      </div>`).join('') +
      `<p class="hint" style="margin-top:8px">Paste any cell into Google Sheets — it pulls the live data and refreshes hourly.</p>`;
  } catch (e) {
    container.innerHTML = '<p class="hint">Could not load.</p>';
  }
}

async function loadQuarterly(q) {
  reportsSelectedQ = q;
  const year = parseInt(document.getElementById('reports-year').value);
  ['q-btn-1','q-btn-2','q-btn-3','q-btn-4'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.toggle('btn--primary', id === `q-btn-${q}`);
    el.classList.toggle('btn--ghost', id !== `q-btn-${q}`);
  });

  try {
    const data = await api(`/reports/quarterly/${year}/${q}`);
    const content = document.getElementById('quarterly-content');
    content.innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px">
        <div class="stat">
          <div class="stat__label">Gross Income</div>
          <div class="stat__value stat__value--ok">${chf(data.gross_income)}</div>
          <div class="stat__hint">Invoices ${chf(data.invoices.total)} + wages ${chf(data.salary.quarterly_total)} (${data.salary.payslip_count ?? '?'} payslips)</div>
        </div>
        <div class="stat">
          <div class="stat__label">AHV Employee (5.3%)</div>
          <div class="stat__value">${chf(data.ahv_estimate.employee_contribution)}</div>
          <div class="stat__hint">${data.ahv_estimate.basis || ''}</div>
        </div>
        <div class="stat">
          <div class="stat__label">AHV Employer (5.3%)</div>
          <div class="stat__value">${chf(data.ahv_estimate.employer_contribution)}</div>
        </div>
        <div class="stat stat--info">
          <div class="stat__label">AHV Total</div>
          <div class="stat__value stat__value--info">${chf(data.ahv_estimate.total)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Bills Paid</div>
          <div class="stat__value">${chf(data.bills_total)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Obligations Due</div>
          <div class="stat__value">${chf(data.obligations_total)}</div>
        </div>
      </div>
      ${data.invoices.items.length ? `
        <div class="table-card" style="margin-bottom:12px">
          <div class="table-header"><h3 style="font-size:13px">Invoices in ${data.period_label}</h3></div>
          <table>
            <thead><tr><th>#</th><th>Month</th><th>Hours</th><th class="text-right">Total</th></tr></thead>
            <tbody>${data.invoices.items.map(i => `<tr>
              <td class="mono">#${pad4(i.invoice_number)}</td>
              <td>${new Date(year, i.month-1).toLocaleString('en', {month:'long'})}</td>
              <td>${i.hours}</td>
              <td class="money">${chf(i.total)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}
      ${data.bills_by_category.length ? `
        <div class="table-card" style="margin-bottom:12px">
          <div class="table-header"><h3 style="font-size:13px">Bills by Category</h3></div>
          <table>
            <thead><tr><th>Category</th><th>Count</th><th class="text-right">Total</th></tr></thead>
            <tbody>${data.bills_by_category.map(c => `<tr>
              <td><span class="${badgeClass(c.category)}">${c.category}</span></td>
              <td>${c.count}</td>
              <td class="money">${chf(c.total)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}
    `;
  } catch (e) { toast(e.message, 'error'); }
}

let _vatYear = null;

async function loadVAT(year) {
  const container = document.getElementById('vat-stats');
  _vatYear = year;
  try {
    const quarters = await Promise.all([1,2,3,4].map(q => api(`/vat/${year}/${q}`)));
    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = quarters.map(v => {
      const overdue = v.vat_due > 0 && v.due_date < today && (!v.obligation || v.obligation.status !== 'paid');
      const ob = v.obligation;
      const readjusted = ob && !!ob.doc_file;   // real assessment uploaded → its amount rules
      let oblHtml;
      if (ob) {
        const drift = !readjusted && Math.abs(ob.amount - v.vat_due) > 0.01 && ob.status !== 'paid';
        oblHtml = `<span class="chip ${ob.status === 'paid' ? 'chip--ok' : 'chip--warn'}" style="cursor:pointer" title="Click to mark ${ob.status === 'paid' ? 'unpaid' : 'paid'}" onclick="toggleVatObligation(${ob.id}, '${ob.status}')">${ob.status}</span>`
          + (readjusted ? ` <a href="#" onclick="previewPdf('/api/obligations/${ob.id}/file', 'VAT ${v.period}');return false" title="Official assessment uploaded — this obligation's amount is authoritative" style="font-size:11px">&#128206; assessment</a>` : '')
          + (drift ? ` <a href="#" onclick="createVatObligation(${v.quarter});return false" title="Figures changed since the obligation was created — click to update it to ${chf(v.vat_due)}" style="font-size:11px">update to ${chf(v.vat_due)}</a>` : '');
      } else if (v.vat_due > 0) {
        oblHtml = `<a href="#" onclick="createVatObligation(${v.quarter});return false" style="font-size:11px">+ create obligation</a>`;
      } else {
        oblHtml = `<span class="hint hint--sm">${v.vat_due < 0 ? 'credit position' : 'nothing due'}</span>`;
      }
      const headline = readjusted ? ob.amount : v.vat_due;
      return `
      <div class="stat${overdue ? ' stat--danger' : ''}">
        <div class="stat__label">${v.period} <span style="float:right;font-weight:400">due ${(ob && ob.due_date) || v.due_date}</span></div>
        <div class="stat__value${headline > 0 ? '' : ' stat__value--ok'}">${chf(headline)}</div>
        ${readjusted && Math.abs(ob.amount - v.vat_due) > 0.01 ? `<div class="hint hint--sm">simulated: ${chf(v.vat_due)}</div>` : ''}
        <div class="hint hint--sm" style="margin-top:4px;line-height:1.6">
          Output ${chf(v.output_vat)}<br>
          − recorded input ${chf(v.input_vat_recorded)}<br>
          − simulated input ${chf(v.input_vat_estimated)}${v.estimated_bills ? ` <span title="estimated from ${v.estimated_bills} bill(s) without a recorded VAT amount">(${v.estimated_bills} bills)</span>` : ''}
          ${v.flat_deduction > 0 ? `<br>− flat allowance ${chf(v.flat_deduction)}` : ''}
        </div>
        <div style="margin-top:6px">${oblHtml}</div>
      </div>`;
    }).join('');
  } catch (e) { container.innerHTML = '<p class="hint">No VAT data available</p>'; }
}

async function createVatObligation(quarter) {
  try {
    const res = await api(`/vat/${_vatYear}/${quarter}/obligation`, { method: 'POST' });
    toast(res.updated ? `VAT obligation updated to ${chf(res.amount)}` : `VAT obligation created: ${chf(res.amount)}`);
    loadVAT(_vatYear);
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleVatObligation(id, currentStatus) {
  const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';
  try {
    await api(`/obligations/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: newStatus}) });
    toast(`VAT obligation marked ${newStatus}`);
    loadVAT(_vatYear);
  } catch (e) { toast(e.message, 'error'); }
}

async function openVatSettings() {
  try {
    const [s, cats] = await Promise.all([api('/vat/settings'), api('/accounting/categories')]);
    document.getElementById('vats-estimate').checked = s.estimate_missing;
    document.getElementById('vats-rate').value = s.estimate_rate;
    document.getElementById('vats-flat').value = s.flat_quarterly_deduction;
    document.getElementById('vats-categories').innerHTML = cats.map(c => `
      <label style="display:inline-flex;align-items:center;gap:5px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="vats-cat" value="${escapeHtml(c)}" ${s.excluded_categories.includes(c) ? 'checked' : ''} style="width:auto"> ${escapeHtml(c)}
      </label>`).join('');
    document.getElementById('vat-settings-dialog').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

async function handleVatSettingsSubmit(e) {
  e.preventDefault();
  const body = {
    estimate_missing: document.getElementById('vats-estimate').checked,
    estimate_rate: parseFloat(document.getElementById('vats-rate').value) || 8.1,
    flat_quarterly_deduction: parseFloat(document.getElementById('vats-flat').value) || 0,
    excluded_categories: [...document.querySelectorAll('.vats-cat:checked')].map(el => el.value),
  };
  try {
    await api('/vat/settings', { method: 'PUT', body: JSON.stringify(body) });
    document.getElementById('vat-settings-dialog').classList.remove('show');
    toast('VAT deduction settings saved');
    if (_vatYear) loadVAT(_vatYear);
  } catch (err) { toast(err.message, 'error'); }
}

async function loadTaxEstimate(year) {
  const el = document.getElementById('tax-content');
  try {
    const data = await api(`/tax/estimate/${year}`);
    el.innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        <div class="stat">
          <div class="stat__label">Profit Before Tax</div>
          <div class="stat__value ${data.profit_before_tax > 0 ? 'stat__value--ok' : 'stat__value--danger'}">${chf(data.profit_before_tax)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Federal (8.5%)</div>
          <div class="stat__value">${chf(data.federal_tax_estimate)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Cantonal (~13%)</div>
          <div class="stat__value">${chf(data.cantonal_tax_estimate)}</div>
        </div>
        <div class="stat stat--danger">
          <div class="stat__label">Total Tax Estimate</div>
          <div class="stat__value stat__value--danger">${chf(data.total_tax_estimate)}</div>
          <div class="stat__hint">Effective ${data.effective_rate_pct}%</div>
        </div>
      </div>
      <p class="hint" style="margin-top:10px">${data.note}</p>
    `;
  } catch (e) { el.innerHTML = '<p class="hint">No profit data yet</p>'; }
}

function downloadAccountantPackage() {
  const year = document.getElementById('reports-year').value || new Date().getFullYear();
  toast(`Preparing accountant package for ${year}...`);
  window.location.href = tokenUrl(`/api/reports/accountant-package/${year}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// UNDO TOAST
// ══════════════════════════════════════════════════════════════════════════════

function toastWithUndo(msg, undoFn, timeout = 5000) {
  const el = document.getElementById('toast');
  const undoId = 'undo-' + Date.now();
  el.innerHTML = `${msg} <button id="${undoId}" style="background:transparent;border:none;color:#fff;text-decoration:underline;cursor:pointer;margin-left:12px;font-weight:600">Undo</button>`;
  el.className = 'toast success show';
  let timer = setTimeout(() => el.classList.remove('show'), timeout);
  const btn = document.getElementById(undoId);
  if (btn) {
    btn.addEventListener('click', async () => {
      clearTimeout(timer);
      el.classList.remove('show');
      try { await undoFn(); toast('Undone'); } catch (e) { toast(e.message, 'error'); }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATE-AWAY CONFIRMATION (for forms with unsaved changes)
// ══════════════════════════════════════════════════════════════════════════════

let formsDirty = new Set();

function markFormDirty(formId) { formsDirty.add(formId); }
function markFormClean(formId) { formsDirty.delete(formId); }

window.addEventListener('beforeunload', e => {
  if (formsDirty.size > 0) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes.';
  }
});

// Wrap navigateTo with check
const _origNavigateTo = navigateTo;
navigateTo = function(page) {
  if (formsDirty.size > 0) {
    if (!confirm('You have unsaved changes. Leave this page?')) return;
    formsDirty.clear();
  }
  _origNavigateTo(page);
};

// Auto-bind to all forms: any input change marks dirty, submit clears
document.addEventListener('input', e => {
  const form = e.target.closest('form');
  if (form && form.id) markFormDirty(form.id);
});
document.addEventListener('submit', e => {
  const form = e.target;
  if (form && form.id) markFormClean(form.id);
});

// ══════════════════════════════════════════════════════════════════════════════
