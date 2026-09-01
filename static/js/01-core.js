// 01-core.js — helpers, filter persistence, skeletons, empty state, auth, navigation
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
const RATE = 62.00;
const VAT = 0.081;
let chart = null;

// ── Helpers ──

// Display settings (Settings page → server-backed prefs). Applied after
// Prefs.load(); the currency is a LABEL — amounts are never converted.
const AppSettings = { currency: 'CHF', locale: 'de-CH', divTax: { wht: 0.35, fedIncl: 0.70, cantIncl: 0.50 } };

function applyAppSettings() {
  AppSettings.currency = Prefs.get('app.currency', 'CHF');
  AppSettings.locale = Prefs.get('app.locale', 'de-CH');
  const dt = Prefs.get('app.dividendTax', {}) || {};
  AppSettings.divTax = {
    wht: Number.isFinite(+dt.wht_pct) ? +dt.wht_pct / 100 : 0.35,
    fedIncl: Number.isFinite(+dt.fed_inclusion_pct) ? +dt.fed_inclusion_pct / 100 : 0.70,
    cantIncl: Number.isFinite(+dt.cant_inclusion_pct) ? +dt.cant_inclusion_pct / 100 : 0.50,
  };
  const name = Prefs.get('app.companyName', '');
  const el = document.querySelector('.sidebar-header');
  if (el && name) el.textContent = name;
}

function chf(n) {
  // Defensive: a missing field (e.g. API/JS version skew during a deploy)
  // renders as an em dash instead of crashing the whole page render.
  if (n == null || Number.isNaN(Number(n))) return AppSettings.currency + ' —';
  return AppSettings.currency + ' ' + Number(n).toLocaleString(AppSettings.locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function authHeaders() {
  const token = localStorage.getItem('session_token');
  return token ? {'Authorization': 'Bearer ' + token} : {};
}

let _apiInflight = 0;
function _progressStart() {
  _apiInflight++;
  document.getElementById('top-progress')?.classList.add('loading');
}
function _progressEnd() {
  _apiInflight = Math.max(0, _apiInflight - 1);
  if (_apiInflight === 0) document.getElementById('top-progress')?.classList.remove('loading');
}

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : {'Content-Type': 'application/json'}),
    ...authHeaders(),
    ...opts.headers,
  };
  _progressStart();
  try {
    let res;
    try {
      res = await fetch('/api' + path, { ...opts, headers });
    } catch (netErr) {
      throw new Error(`Cannot reach server. Is it running? (${netErr.message})`);
    }
    if (res.status === 401) {
      localStorage.removeItem('session_token');
      showLogin();
      throw new Error('Session expired — please log in again.');
    }
    if (res.status === 404) throw new Error(`Not found: ${path}`);
    if (res.status === 403) throw new Error('Forbidden — you may need to log in again.');
    if (res.status >= 500) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Server error (${res.status}): ${err.detail || 'unexpected failure'}. Check the server logs.`);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({detail: `HTTP ${res.status}`}));
      // Pydantic validation errors come as {detail: [{loc, msg}]}
      if (Array.isArray(err.detail)) {
        const msgs = err.detail.map(e => `${(e.loc || []).slice(-1)[0]}: ${e.msg}`).join(' · ');
        throw new Error(`Validation failed — ${msgs}`);
      }
      throw new Error(err.detail || `Request failed (HTTP ${res.status})`);
    }
    return await res.json();
  } finally {
    _progressEnd();
  }
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function badgeClass() {
  return 'chip';   // categories are neutral chips — color is status only (design rule 11)
}

function pad4(n) { return String(n).padStart(4, '0'); }

// ── Per-page filter persistence ──
function persistFilter(pageKey, inputIds) {
  const stored = JSON.parse(localStorage.getItem(`filters_${pageKey}`) || '{}');
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (stored[id] !== undefined) el.value = stored[id];
    if (!el.dataset.filterBound) {
      el.dataset.filterBound = '1';
      const evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const all = JSON.parse(localStorage.getItem(`filters_${pageKey}`) || '{}');
        all[id] = el.value;
        localStorage.setItem(`filters_${pageKey}`, JSON.stringify(all));
      });
    }
  });
}

// ── Skeleton helpers ──
function skeletonStats(count = 4) {
  return Array(count).fill(0).map(() => `
    <div class="stat">
      <div class="skeleton skeleton-text" style="width:60%"></div>
      <div class="skeleton skeleton-value" style="margin-top:8px"></div>
    </div>`).join('');
}
// ── Value change animation ──
const _valueCache = new Map();
function setValue(elementId, newText) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const old = _valueCache.get(elementId);
  el.textContent = newText;
  if (old !== undefined && old !== newText) {
    el.classList.remove('value-changed');
    void el.offsetWidth;  // restart animation
    el.classList.add('value-changed');
  }
  _valueCache.set(elementId, newText);
}

// ── Empty state ──
function emptyState(icon, title, message, actionLabel, actionFn) {
  const id = 'empty-' + Math.random().toString(36).slice(2);
  if (actionFn) window['__es_' + id] = actionFn;
  return `<div class="panel empty-state">
    <div class="empty-state__icon">${icon}</div>
    <div class="empty-state__title">${title}</div>
    <div class="hint" style="margin-bottom:16px">${message}</div>
    ${actionLabel ? `<button class="btn btn--primary" onclick="window.__es_${id}()">${actionLabel}</button>` : ''}
  </div>`;
}

function computeStatus(status, dueDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'paid') return {label: 'Paid', cls: 'chip chip--ok'};
  if (dueDate && dueDate < today) return {label: 'Overdue', cls: 'chip chip--danger'};
  return {label: 'Unpaid', cls: 'chip chip--warn'};
}

function updateAcctStatusPreview() {
  const status = document.getElementById('acct-status').value;
  const due = document.getElementById('acct-due').value;
  const s = computeStatus(status, due);
  const el = document.getElementById('acct-status-preview');
  if (el) el.innerHTML = `<span class="${s.cls}">${s.label}</span>`;
}

function updateOblStatusPreview() {
  const status = document.getElementById('obl-status').value;
  const due = document.getElementById('obl-due').value;
  const s = computeStatus(status, due);
  const el = document.getElementById('obl-status-preview');
  if (el) el.innerHTML = `<span class="${s.cls}">${s.label}</span>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════

function showLogin() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-sidebar').style.display = 'none';
  document.getElementById('app-main').style.display = 'none';
  document.getElementById('login-password').focus();
}

async function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-sidebar').style.display = 'flex';
  document.getElementById('app-main').style.display = 'block';
  setupSidebarResize();
  await Prefs.load();
  applyAppSettings();
  loadDashboard();
}

async function checkAuth() {
  const token = localStorage.getItem('session_token');
  if (!token) { showLogin(); return; }
  try {
    const res = await fetch('/api/auth/check', { headers: authHeaders() });
    if (res.ok) { showApp(); }
    else { localStorage.removeItem('session_token'); showLogin(); }
  } catch { showLogin(); }
}

async function doLogin(e) {
  e.preventDefault();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: pw}),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('session_token', data.token);
      showApp();
    } else {
      errEl.textContent = 'Invalid password';
      errEl.style.display = 'block';
    }
  } catch {
    errEl.textContent = 'Connection error';
    errEl.style.display = 'block';
  }
}

async function doLogout(e) {
  e.preventDefault();
  try { await fetch('/api/logout', { method: 'POST', headers: authHeaders() }); } catch {}
  localStorage.removeItem('session_token');
  showLogin();
}

// ── Mobile sidebar ──

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('show');
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('show');
}

// ── Navigation ──

function navigateTo(page) {
  if (page === 'balances') page = 'cash';   // merged into Cash Allocation
  if (page === 'income') page = 'invoices';   // merged into Invoices & Income
  // The Transfers tab merged into Bank Statements (owner ledger section) —
  // old links, shortcuts and search results land there.
  if (page === 'transfers') page = 'bank';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  applyPanelDisplay(page);
  const link = document.querySelector(`[data-page="${page}"]`);
  if (link) link.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'invoices') { loadInvoices(); loadIncome(); }
  if (page === 'form' && !document.getElementById('edit-id').value) prepareNewForm();
  if (page === 'customers') loadCustomers();
  if (page === 'expenses') { loadExpenseYears(); loadTrips({forFilter:true}); loadExpenses(); loadExpenseReports(); }
  if (page === 'trips') { loadTrips(); }
  if (page === 'bank') { loadBankYears(); loadBankStatements(); loadTransfers(); }
  if (page === 'expense-form' && !document.getElementById('exp-edit-id').value) {
    document.getElementById('exp-form-title').textContent = 'Add Expense';
    document.getElementById('exp-submit-btn').textContent = 'Save Expense';
  }
  if (page === 'budget') { loadBudgetDashboard(); }


  if (page === 'reports') { loadReports(); }
  if (page === 'dividends') { loadDividends(); }
  if (page === 'docs') { loadDocs(); }
  if (page === 'test-procedure') { loadTestProcedure(); }
  if (page === 'payroll') { loadPayroll(); }
  if (page === 'obligations') { loadObligationsPage(); }
  if (page === 'cash') { loadCashPage(); }
  if (page === 'calendar') { loadCalendarPage(); }
  if (page === 'accounting') { loadAccountingYears(); loadAccountingDocs(); loadVendorList(); }
  if (page === 'accounting-form') {
    loadVendorList();
    setupFileDrop();
    if (!document.getElementById('acct-edit-id').value) {
      document.getElementById('acct-form-title').textContent = 'Add Document';
      document.getElementById('acct-submit-btn').textContent = 'Save Document';
    }
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 768) closeSidebar();
}

document.querySelectorAll('.sidebar nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    if (page === 'form') clearForm();
    if (page === 'expense-form') clearExpenseForm();
    if (page === 'accounting-form') clearAccountingForm();
    navigateTo(page);
  });
});

// ══════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
// PANEL DISPLAY — every page section tagged data-panel="key" data-panel-label
// can be shown/hidden per user (Prefs `panels.<page>`). A "Display" button is
// injected into the page header when a page has two or more such sections.
// ══════════════════════════════════════════════════════════════════════════════

function _pagePanels(page) {
  const root = document.getElementById('page-' + page);
  return root ? Array.from(root.querySelectorAll('[data-panel]')) : [];
}

function applyPanelDisplay(page) {
  const panels = _pagePanels(page);
  if (!panels.length) return;
  const prefs = Prefs.get('panels.' + page, {}) || {};
  panels.forEach(el => el.classList.toggle('panel-hidden', prefs[el.dataset.panel] === false));
  if (panels.length >= 2) {
    const group = document.querySelector('#page-' + page + ' .page-header .btn-group');
    if (group && !group.querySelector('.panel-display-btn')) {
      const b = document.createElement('button');
      b.className = 'btn btn--ghost btn--sm panel-display-btn';
      b.title = 'Choose which sections this page shows';
      b.innerHTML = '&#9881; Display';
      b.onclick = () => showPanelDisplay(page);
      group.insertBefore(b, group.firstChild);
    }
  }
}

function showPanelDisplay(page) {
  const panels = _pagePanels(page);
  const prefs = Prefs.get('panels.' + page, {}) || {};
  const title = (document.querySelector('#page-' + page + ' .page-title') || {}).textContent || page;
  const rows = panels.map(el => {
    const key = el.dataset.panel, label = el.dataset.panelLabel || key;
    const on = prefs[key] !== false;
    return `<div class="settings-row">
      <label>${escapeHtml(label)}</label>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''}
        onchange="setPanelVisible('${page}', '${key}', this.checked)"><span></span></label>
    </div>`;
  }).join('');
  document.getElementById('widget-info-body').innerHTML = `
    <h3 class="modal__title">Display — ${escapeHtml(title.trim())}</h3>
    <p class="hint">Switch off the sections you don't need on this page. Saved to your profile; the data is untouched.</p>
    <div class="settings-section">${rows}</div>
    <div class="row-split" style="margin-top:12px"><span></span>
      <button class="btn btn--ghost btn--sm" onclick="resetPanelDisplay('${page}')">Show everything</button></div>`;
  document.getElementById('widget-info-modal').classList.add('show');
}

function setPanelVisible(page, key, visible) {
  const prefs = Object.assign({}, Prefs.get('panels.' + page, {}) || {});
  if (visible) delete prefs[key]; else prefs[key] = false;
  Prefs.set('panels.' + page, prefs);
  applyPanelDisplay(page);
}

function resetPanelDisplay(page) {
  Prefs.set('panels.' + page, {});
  applyPanelDisplay(page);
  showPanelDisplay(page);
}
