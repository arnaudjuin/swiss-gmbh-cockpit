// 02-dashboard.js — invoices page, customizable dashboard (widgets, prefs, charts)
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// INVOICES
// ══════════════════════════════════════════════════════════════════════════════

async function dismissAnomaly(billId) {
  try {
    await api(`/anomalies/dismiss/${billId}`, { method: 'POST' });
    toast('Anomaly marked reviewed');
    loadDashboard();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleInvoiceStatus(id, currentStatus) {
  const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';
  try {
    await api(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({status: newStatus}) });
    toast(`Invoice marked ${newStatus}`);
    loadInvoices();
  } catch (e) { toast(e.message, 'error'); }
}

function downloadPLReport() {
  const year = document.getElementById('pl-year').value || new Date().getFullYear();
  window.location.href = tokenUrl(`/api/reports/pl/${year}/excel`);
  toast(`Generating P&L for ${year}...`);
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMIZABLE DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

const DASHBOARD_WIDGETS = [
  // Stat cards
  {id: 'income-ytd', type: 'stat', label: 'Total Income', default: true,
   formula: 'Invoices in range (billable only) + manual income entries in range',
   includes: ['Invoice rows where hours > 0 within the dashboard time range', 'income_entries rows within the dashboard time range'],
   excludes: ['Travel-expense reimbursement reports (hours = 0)', 'Account transfers between Personal and GmbH']},
  {id: 'costs-ytd', type: 'stat', label: 'Total Costs', default: true,
   formula: 'Bills + Obligations within the dashboard time range',
   includes: ['company_docs rows within the time range (paid + unpaid)', 'obligations rows within the time range (AHV, BVG, taxes, etc.)'],
   excludes: ['Travel expenses (those are reimbursable, not costs)', 'Payroll']},
  {id: 'profit-ytd', type: 'stat', label: 'Net Profit', default: true,
   formula: 'Total Income − Total Costs (both honor the dashboard time range)',
   includes: ['Same data as Income and Costs widgets'],
   excludes: ['Travel reimbursements', 'Personal↔GmbH transfers', 'Payroll']},
  {id: 'profit-margin', type: 'stat', label: 'Profit Margin %', default: true,
   formula: 'Profit ÷ Income × 100 (within the dashboard time range)',
   includes: ['Same totals as Profit and Income widgets'],
   excludes: ['Same exclusions as Profit and Income widgets']},
  {id: 'avg-monthly-rev', type: 'stat', label: 'Average Monthly Revenue', default: true,
   formula: 'Sum(invoice totals all years) ÷ count of distinct invoiced months',
   includes: ['All invoice rows where hours > 0 across all years'],
   excludes: ['Months with no invoices (denominator only counts invoiced months)', 'Reimbursement reports']},
  {id: 'avg-monthly-hours', type: 'stat', label: 'Average Monthly Hours', default: true,
   formula: 'Sum(hours all years) ÷ count of distinct invoiced months',
   includes: ['Hours field on invoice rows where hours > 0'],
   excludes: ['Reimbursement reports (hours = 0)']},
  {id: 'invoice-count', type: 'stat', label: 'Invoice Count', default: false,
   formula: 'Count of all billable invoices, with this-year subtotal',
   includes: ['Invoice rows where hours > 0'],
   excludes: ['Reimbursement reports']},
  {id: 'total-hours', type: 'stat', label: 'Total Hours Billed', default: false,
   formula: 'Sum of hours across all billable invoices',
   includes: ['Hours field on invoice rows where hours > 0'],
   excludes: ['Reimbursement reports']},
  {id: 'overdue', type: 'stat', label: 'Overdue Amount', default: true,
   formula: 'Sum of unpaid bills + unpaid obligations with due_date < today',
   includes: ['company_docs rows where status = unpaid AND due_date < today', 'obligations rows where status = unpaid AND due_date < today'],
   excludes: ['Items with no due date set', 'Already-paid items']},
  {id: 'upcoming-30d', type: 'stat', label: 'Due Next 30 Days', default: true,
   formula: 'Sum of unpaid bills + obligations with due_date in [today, today+30]',
   includes: ['Unpaid company_docs and obligations due in the next 30 days'],
   excludes: ['Already-overdue items', 'Items due more than 30 days out', 'Paid items']},
  {id: 'net-owed', type: 'stat', label: 'Kontokorrent', default: false,
   formula: 'Σ(personal → GmbH) + unreimbursed personal-card bills + open expense reports − Σ(GmbH → personal, excl. salary & reimbursements)',
   includes: ['account_transfers rows in both directions', 'company_docs paid_via=personal AND reimbursed_at IS NULL', 'expense_reports reimbursed_at IS NULL'],
   excludes: ['Net salary transfers (wages, not debt)', 'Personal-card reimbursement transfers (settle debt that is excluded symmetrically)']},
  {id: 'invoices-paid-pct', type: 'stat', label: '% Invoices Paid', default: false,
   formula: 'Σ(paid invoice totals in range) ÷ Σ(all invoice totals in range) × 100',
   includes: ['Invoice rows where hours > 0 within the dashboard time range'],
   excludes: ['Reimbursement reports']},
  {id: 'net-salary', type: 'stat', label: 'Net Salary (monthly)', default: true,
   formula: 'Gross − employee contributions − source tax (from Payroll Settings)',
   includes: ['payroll_settings.gross_monthly', 'AHV / ALV employee %', 'BVG / UVG / KTG employee monthly amounts', 'source_tax_monthly (you enter this)'],
   excludes: ['Employer-side contributions (those add to GmbH cost, not employee net)', 'Annual bonuses or one-offs']},
  {id: 'upcoming-obligations', type: 'stat', label: 'Next Obligations Due', default: true,
   formula: 'Top 3 unpaid obligations sorted by due_date, filtered to due within 60 days',
   includes: ['obligations rows where status=unpaid AND due_date within [today, today+60d]'],
   excludes: ['Bills (shown separately)', 'Obligations without a due date']},
  // Charts
  {id: 'revenue-chart', type: 'chart', label: 'Income vs Costs by Month', default: true,
   formula: 'Per month of the selected year: income = invoice subtotals (net of VAT) + non-invoice income; costs = bills + issued payslips (employer cost). Same accrual lens as the headline cards and Reports → P&L.',
   includes: ['Invoice subtotals by invoice month', 'income_entries without invoice_id by income_date', 'company_docs by doc_date (excl. Payroll Settlement / Taxes-VAT)', 'payslips total_employer_cost by payment_date'],
   excludes: ['VAT (belongs to the ESTV)', 'Obligations (payment side of costs already counted)', 'Kontokorrent transfers'],
   defaultChartType: 'bar', chartTypes: ['bar', 'line']},
  {id: 'forecast-chart', type: 'chart', label: 'Cash Forecast (this year)', default: true,
   formula: 'Same numbers as the Forecast page: bank balance + expected income − net salary − obligations on payable date − bills, month by month',
   includes: ['Freshest bank balance', 'Income per month as entered on the Forecast page (else the 6-month average)', 'Unpaid obligations payable this year at expected-bill date/amount', 'Unpaid + recurring bills', 'Cash Allocation pots: monthly accruals'],
   excludes: ['Obligations landing next year (funded by the pots)', 'Payroll charges projection (replaced by the pots)'],
   defaultChartType: 'bar', chartTypes: ['bar']},
  {id: 'cost-breakdown', type: 'chart', label: 'Costs by Category', default: true,
   formula: 'Sum of company_docs.amount grouped by category within the dashboard time range, largest first',
   includes: ['company_docs rows in range'],
   excludes: ['Payroll (see Income vs Costs)', 'Obligations'],
   defaultChartType: 'bar', chartTypes: ['bar', 'doughnut']},
  // Lists
  // Page recap tiles — one per panel, each with its own setup (visibility, accent, formula)
  {id: 'recap-bank', type: 'recap', label: '🏦 Bank', default: true,
   formula: 'Closing balance of the latest bank statement + runway (months of cash at current burn)',
   includes: ['bank_statements row with the latest period_end', '/runway: balance ÷ (recurring bills + obligations/12 + payroll − avg invoice)'],
   excludes: ['Manual cash-balance entries older than the latest statement']},
  {id: 'recap-cash', type: 'recap', label: '💰 Cash & reserves', default: true,
   formula: 'Σ reserves.accumulated (earmarked) vs Σ target_amount; monthly accrual = Σ monthly_accrual',
   includes: ['Active reserves (months elapsed × monthly accrual + manual contributions)'],
   excludes: ['Money already paid out of a reserve']},
  {id: 'recap-bills', type: 'recap', label: '🧾 Bills', default: true,
   formula: 'Σ company_docs.amount where status = unpaid; overdue = unpaid AND due_date < today',
   includes: ['All uploaded bills regardless of who paid'],
   excludes: ['Obligations (own tile)']},
  {id: 'recap-obligations', type: 'recap', label: '📋 Obligations', default: true,
   formula: 'Current year: Σ unpaid amount, paid progress, overdue total, next unpaid by due_date',
   includes: ['obligations rows where period_year = this year (AHV, BVG, UVG/KTG, VAT, taxes, source tax, Treuhand)'],
   excludes: ['Next-year obligations', 'Bills']},
  {id: 'recap-payroll', type: 'recap', label: '👤 Payroll', default: true,
   formula: 'Latest issued payslip net; payslips issued this year; Σ total_employer_cost; missing = months elapsed − payslips',
   includes: ['payslips rows for the current year'],
   excludes: ['Payroll settings preview (only issued payslips count)']},
  {id: 'recap-invoices', type: 'recap', label: '📄 Invoices', default: true,
   formula: 'Σ invoices.total where paid_status ≠ paid (receivables); overdue = due_date < today',
   includes: ['Billable invoices (hours > 0)'],
   excludes: ['Expense-reimbursement reports', 'Other income']},
  {id: 'recap-kontokorrent', type: 'recap', label: '🔁 Kontokorrent', default: true,
   formula: 'Σ(personal → GmbH) + unreimbursed personal-card bills + open expense reports − Σ(GmbH → personal excl. salary & reimbursements). Positive = GmbH owes you.',
   includes: ['account_transfers', 'company_docs paid_via = personal AND reimbursed_at IS NULL', 'expense_reports reimbursed_at IS NULL'],
   excludes: ['Net salary transfers (wages)', 'Personal-card reimbursement transfers']},
  {id: 'recap-vat', type: 'recap', label: '🏛 VAT', default: true,
   formula: 'To remit = Σ unpaid VAT obligations; collected = Σ invoices.tax this year',
   includes: ['obligations where obligation_type = vat AND status = unpaid', 'invoices.tax for the current year'],
   excludes: ['Input VAT on bills (Treuhand reclaims it in the return)']},
  {id: 'recap-dividends', type: 'recap', label: '⚡ Dividends', default: true,
   formula: 'This fiscal year: monthly set-aside × contribution months = gross; net = gross × (1 − 0.7·fed − 0.5·cant). Whole plan shown in the hint.',
   includes: ['Dividend planner inputs saved on the Dividends page (Prefs)'],
   excludes: ['The 35% withholding tax (timing only — refunded when declared)']},
  {id: 'recap-forecast', type: 'recap', label: '📈 Forecast', default: true,
   formula: 'Lowest projected cash this year and cash at year end (Forecast page)',
   includes: ['/finance/forecast with the saved expected income'],
   excludes: []},
  {id: 'recap-expenses', type: 'recap', label: '🧳 Expenses & trips', default: true,
   formula: 'Σ expense_reports.total where reimbursed_at IS NULL',
   includes: ['Travel expense reports not yet paid back to you'],
   excludes: ['Personal-card bills (counted under Kontokorrent)']},
  {id: 'recent-invoices', type: 'list', label: 'Recent Invoices', default: true,
   formula: 'Latest 5 invoice rows ordered by year + month desc',
   includes: ['All invoice rows including reimbursements (sorted by latest period)'],
   excludes: []},
  {id: 'recent-bills', type: 'list', label: 'Recent Bills', default: false,
   formula: 'Latest 5 company_docs rows ordered by doc_date desc',
   includes: ['Latest 5 company_docs (any status)'],
   excludes: ['Obligations']},
  {id: 'anomalies', type: 'list', label: 'Anomalies (unusual bill amounts)', default: true,
   formula: 'Bills > 20% (and ≥ CHF 10) above/below their vendor 3-bill+ baseline',
   includes: ['Latest bill per vendor with ≥ 3 historical bills'],
   excludes: ['Vendors with fewer than 3 bills', 'Bills already marked [anomaly-reviewed]']},
];

const WIDGETS_BY_ID = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w]));

// Default per-widget colors so newly-added stat cards have a sensible accent.
const STAT_DEFAULT_COLORS = {
  'income-ytd': 'green', 'costs-ytd': 'red', 'profit-ytd': 'auto',
  'profit-margin': 'blue', 'overdue': 'red-if-positive', 'upcoming-30d': 'amber',
  'net-owed': 'blue-if-positive', 'invoices-paid-pct': 'auto',
};

const COLOR_PALETTE = [
  {key: 'none',  label: 'None',   mod: null},
  {key: 'blue',  label: 'Blue',   mod: 'info'},
  {key: 'green', label: 'Green',  mod: 'ok'},
  {key: 'amber', label: 'Amber',  mod: 'warn'},
  {key: 'red',   label: 'Red',    mod: 'danger'},
  {key: 'purple',label: 'Purple', mod: 'owner'},
];

const COLOR_BY_KEY = Object.fromEntries(COLOR_PALETTE.map(c => [c.key, c.mod]));

const ROW_COUNT_OPTIONS = [3, 5, 8, 12];

// Per-widget size axes
const STAT_SIZE_OPTIONS = [
  {key: 1, label: 'Normal'},
  {key: 2, label: 'Wide'},
  {key: 3, label: 'Full'},
];
const CHART_SIZE_OPTIONS = [
  {key: 'compact', label: 'Compact', px: 220},
  {key: 'medium',  label: 'Medium',  px: 320},
  {key: 'tall',    label: 'Tall',    px: 460},
];
const CHART_SIZE_BY_KEY = Object.fromEntries(CHART_SIZE_OPTIONS.map(s => [s.key, s.px]));
const CHART_DEFAULT_SIZE = {'revenue-chart': 'medium', 'forecast-chart': 'medium', 'cost-breakdown': 'compact'};

const WIDTH_OPTIONS = [
  {key: 'half', label: 'Half'},
  {key: 'full', label: 'Full'},
];

// ─── Prefs: server-backed user preferences with localStorage cache ──────────
const Prefs = (() => {
  const KEY = 'user_prefs_v1';
  let cache = {};
  let saveTimer = null;
  let pendingSave = false;

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  }

  async function load() {
    // Start from local cache for instant UI; refresh from server in background
    cache = readLocal();
    try {
      const remote = await api('/preferences');
      if (remote && typeof remote === 'object') {
        // Server is the source of truth — overwrite local
        cache = remote;
        writeLocal();
      }
    } catch {} // offline-tolerant: keep local
    // One-time migration from legacy localStorage keys
    const legacyWidgets = localStorage.getItem('dashboard_widgets');
    const legacyOrder = localStorage.getItem('dashboard_order');
    if ((legacyWidgets || legacyOrder) && !cache.dashboard) {
      cache.dashboard = cache.dashboard || {};
      try { if (legacyWidgets) cache.dashboard.widgets = JSON.parse(legacyWidgets); } catch {}
      try { if (legacyOrder) cache.dashboard.order = JSON.parse(legacyOrder); } catch {}
      saveSoon();
      localStorage.removeItem('dashboard_widgets');
      localStorage.removeItem('dashboard_order');
    }
    // Migrate the older flat chartTypes shape into per-widget settings.
    const oldChartTypes = cache.dashboard && cache.dashboard.chartTypes;
    if (oldChartTypes && !cache.dashboard.widgetSettings) {
      cache.dashboard.widgetSettings = {};
      for (const [id, t] of Object.entries(oldChartTypes)) {
        cache.dashboard.widgetSettings[id] = { chartType: t };
      }
      delete cache.dashboard.chartTypes;
      saveSoon();
    }
  }

  function get(path, fallback) {
    const parts = path.split('.');
    let v = cache;
    for (const p of parts) { if (v == null) return fallback; v = v[p]; }
    return v === undefined ? fallback : v;
  }

  function set(path, value) {
    const parts = path.split('.');
    let v = cache;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof v[parts[i]] !== 'object' || v[parts[i]] === null) v[parts[i]] = {};
      v = v[parts[i]];
    }
    v[parts[parts.length - 1]] = value;
    writeLocal();
    saveSoon();
  }

  function saveSoon() {
    pendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }

  async function flush() {
    if (!pendingSave) return;
    pendingSave = false;
    try {
      await api('/preferences', { method: 'PUT', body: JSON.stringify(cache) });
    } catch (e) {
      // Re-queue: we'll try again on next save or visibility change
      pendingSave = true;
      console.warn('Prefs save failed, will retry', e);
    }
  }

  // Save when tab becomes hidden so unsaved changes are flushed
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pendingSave) flush();
  });

  return { load, get, set, flush };
})();

function getDashboardConfig() {
  const stored = Prefs.get('dashboard.widgets');
  if (Array.isArray(stored)) {
    // Widgets shipped after the user last saved their layout are shown once
    // with their default visibility — a saved layout must not silently hide
    // new dashboard features. `dashboard.seen` records what the user has judged.
    const seen = new Set(Prefs.get('dashboard.seen', stored));
    const active = new Set(stored);
    DASHBOARD_WIDGETS.forEach(w => { if (w.default && !seen.has(w.id)) active.add(w.id); });
    return active;
  }
  // Mobile defaults = fewer, focused widgets
  const isMobile = window.innerWidth < 640;
  if (isMobile) {
    return new Set(['income-ytd', 'costs-ytd', 'profit-ytd', 'overdue', 'upcoming-30d', 'revenue-chart']);
  }
  return new Set(DASHBOARD_WIDGETS.filter(w => w.default).map(w => w.id));
}

function getDashboardOrder() {
  const stored = Prefs.get('dashboard.order');
  if (Array.isArray(stored)) return stored;
  return DASHBOARD_WIDGETS.map(w => w.id);
}

function saveDashboardOrder(order) {
  Prefs.set('dashboard.order', order);
}

function setDashboardRange(rangeKey) {
  Prefs.set('dashboard.range', rangeKey);
  loadDashboard();
}

// ─── Per-widget settings (color, chart type, legend, row count, ...) ───────

function getWidgetSetting(widgetId, key, fallback) {
  const v = Prefs.get(`dashboard.widgetSettings.${widgetId}.${key}`);
  return v === undefined ? fallback : v;
}

function setWidgetSetting(widgetId, key, value) {
  Prefs.set(`dashboard.widgetSettings.${widgetId}.${key}`, value);
  // Re-render dashboard so the change is visible immediately.
  loadDashboard();
}

function resetWidgetSettings(widgetId) {
  const all = Prefs.get('dashboard.widgetSettings', {});
  if (all && all[widgetId]) {
    delete all[widgetId];
    Prefs.set('dashboard.widgetSettings', all);
  }
  loadDashboard();
}

function getChartType(widgetId) {
  const w = WIDGETS_BY_ID[widgetId];
  if (!w || w.type !== 'chart') return null;
  const stored = getWidgetSetting(widgetId, 'chartType');
  if (stored && w.chartTypes.includes(stored)) return stored;
  return w.defaultChartType;
}

function getListRowCount(widgetId, fallback = 5) {
  const v = getWidgetSetting(widgetId, 'rowCount', fallback);
  return ROW_COUNT_OPTIONS.includes(v) ? v : fallback;
}

function getChartShowLegend(widgetId, fallback) {
  const v = getWidgetSetting(widgetId, 'showLegend');
  return v === undefined ? fallback : !!v;
}

function getStatSize(widgetId) {
  const v = getWidgetSetting(widgetId, 'size', 1);
  return [1, 2, 3].includes(v) ? v : 1;
}

function getChartSize(widgetId) {
  const v = getWidgetSetting(widgetId, 'size', CHART_DEFAULT_SIZE[widgetId] || 'medium');
  return v in CHART_SIZE_BY_KEY ? v : (CHART_DEFAULT_SIZE[widgetId] || 'medium');
}

function getCardWidth(widgetId) {
  const v = getWidgetSetting(widgetId, 'width', 'full');
  return (v === 'half' || v === 'full') ? v : 'full';
}

function showWidgetSettings(widgetId) {
  const w = WIDGETS_BY_ID[widgetId];
  if (!w) return;
  const visible = getDashboardConfig().has(w.id);

  // Build the appearance section based on widget type
  let appearance = '';
  if (w.type === 'stat') {
    const curColor = getWidgetSetting(w.id, 'color', '');
    const curSize = getStatSize(w.id);
    appearance = `
      <div class="settings-row">
        <label>Width</label>
        <div class="seg-control">
          ${STAT_SIZE_OPTIONS.map(s => `
            <button type="button" class="${s.key === curSize ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'size', ${s.key})">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Accent color</label>
        <div class="color-swatches">
          ${COLOR_PALETTE.map(c => `
            <button type="button" class="color-swatch ${curColor === c.key ? 'active' : ''}" title="${c.label}"
              style="${c.mod ? `background:var(--${c.mod}-fill)` : 'background:transparent;border:1px dashed var(--border)'}"
              onclick="setWidgetSetting('${w.id}', 'color', '${c.key}')"></button>`).join('')}
        </div>
      </div>`;
  } else if (w.type === 'chart') {
    const curType = getChartType(w.id);
    const curSize = getChartSize(w.id);
    const curWidth = getCardWidth(w.id);
    const showLegend = getChartShowLegend(w.id, w.id === 'cost-breakdown');
    appearance = `
      <div class="settings-row">
        <label>Width</label>
        <div class="seg-control">
          ${WIDTH_OPTIONS.map(s => `
            <button type="button" class="${s.key === curWidth ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'width', '${s.key}')">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Height</label>
        <div class="seg-control">
          ${CHART_SIZE_OPTIONS.map(s => `
            <button type="button" class="${s.key === curSize ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'size', '${s.key}')">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Chart type</label>
        <div class="seg-control">
          ${w.chartTypes.map(t => `
            <button type="button" class="${t === curType ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'chartType', '${t}')">${CHART_TYPE_LABELS[t] || t}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Show legend</label>
        <label class="switch"><input type="checkbox" ${showLegend ? 'checked' : ''}
          onchange="setWidgetSetting('${w.id}', 'showLegend', this.checked)"><span></span></label>
      </div>`;
  } else if (w.type === 'recap') {
    const curColor = getWidgetSetting(w.id, 'color', '');
    appearance = `
      <div class="settings-row">
        <label>Accent</label>
        <div class="color-swatches">
          <button type="button" class="color-swatch ${curColor === '' ? 'active' : ''}" title="Automatic (by status)"
            style="background:transparent;border:1px dashed var(--border)" onclick="setWidgetSetting('${w.id}', 'color', '')">A</button>
          ${COLOR_PALETTE.map(c => `
            <button type="button" class="color-swatch ${curColor === c.key ? 'active' : ''}" title="${c.label}"
              style="${c.mod ? `background:var(--${c.mod}-fill)` : 'background:transparent;border:1px dashed var(--border)'}"
              onclick="setWidgetSetting('${w.id}', 'color', '${c.key}')"></button>`).join('')}
        </div>
      </div>`;
  } else if (w.type === 'list') {
    const curRows = getListRowCount(w.id, w.id === 'anomalies' ? 8 : 5);
    const curWidth = getCardWidth(w.id);
    appearance = `
      <div class="settings-row">
        <label>Width</label>
        <div class="seg-control">
          ${WIDTH_OPTIONS.map(s => `
            <button type="button" class="${s.key === curWidth ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'width', '${s.key}')">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Rows shown</label>
        <div class="seg-control">
          ${ROW_COUNT_OPTIONS.map(n => `
            <button type="button" class="${n === curRows ? 'active' : ''}"
              onclick="setWidgetSetting('${w.id}', 'rowCount', ${n})">${n}</button>`).join('')}
        </div>
      </div>`;
  }

  const body = document.getElementById('widget-info-body');
  body.innerHTML = `
    <h3 style="margin-top:0;margin-bottom:14px">${w.label}</h3>

    <div class="settings-section">
      <div class="settings-row">
        <label>Visible on dashboard</label>
        <label class="switch"><input type="checkbox" ${visible ? 'checked' : ''}
          onchange="toggleWidgetVisibility('${w.id}', this.checked)"><span></span></label>
      </div>
      ${appearance}
    </div>

    <details class="settings-info">
      <summary>What's in this number?</summary>
      <div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:6px;font-family:var(--font-mono);font-size:13px">${w.formula || '—'}</div>
      ${w.includes && w.includes.length ? `
        <div style="margin-top:14px"><strong style="color:var(--ok-text)">Includes</strong>
        <ul style="margin:6px 0 0 0;padding-left:20px;font-size:13px">${w.includes.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      ${w.excludes && w.excludes.length ? `
        <div style="margin-top:14px"><strong style="color:var(--danger-text)">Excludes</strong>
        <ul style="margin:6px 0 0 0;padding-left:20px;font-size:13px">${w.excludes.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
    </details>

    <div style="margin-top:18px;text-align:right">
      <button class="btn btn--ghost btn--sm" onclick="resetWidgetSettings('${w.id}')">Reset to defaults</button>
    </div>
  `;
  document.getElementById('widget-info-modal').classList.add('show');
}

function toggleWidgetVisibility(widgetId, visible) {
  const active = getDashboardConfig();
  if (visible) active.add(widgetId); else active.delete(widgetId);
  Prefs.set('dashboard.widgets', Array.from(active));
  Prefs.set('dashboard.seen', DASHBOARD_WIDGETS.map(w => w.id));
  loadDashboard();
}

// Backwards-compat alias (callers still use this name)
const showWidgetInfo = showWidgetSettings;

// ──────────────────────────────────────────────────────────────────────────
// REPORTS PAGE CUSTOMIZATION (visibility + order + info per section)
// ──────────────────────────────────────────────────────────────────────────

const REPORTS_WIDGETS = [
  {id: 'quarterly', label: 'Quarterly Summary', default: true,
   formula: 'AHV/BVG/UVG/KTG totals + filing checklist for the chosen quarter',
   includes: ['payroll_settings (rates)', 'payslips for the quarter', 'obligations due in the quarter'],
   excludes: ['Travel expense reports', 'Manual income entries']},
  {id: 'vat', label: 'VAT Tracker', default: true,
   formula: 'Output VAT (8.1% of invoice subtotals) − Input VAT (recoverable from bills)',
   includes: ['Billable invoices for the year (hours > 0)', 'company_docs flagged with VAT'],
   excludes: ['Reimbursement reports', 'Obligations']},
  {id: 'tax', label: 'Corporate Tax Estimate', default: true,
   formula: 'YTD profit × (federal 8.5% + cantonal ~13%); rough Zurich baseline',
   includes: ['Income YTD (invoices + manual income)', 'Costs YTD (bills + obligations)'],
   excludes: ['Travel reimbursements (in/out cancel)', 'Personal↔GmbH transfers']},
  {id: 'sheets', label: 'Google Sheets sync', default: true,
   formula: 'Live IMPORTDATA URLs — generated from your share-link tokens',
   includes: ['Active shared_links rows for the accounting section'],
   excludes: ['Anything not behind a share link']},
  {id: 'accountant-package', label: 'Accountant Package', default: true,
   formula: 'Full-year ZIP of invoices PDFs + bill files + expense report + summaries',
   includes: ['All invoices (billable + reimbursement) for the year', 'All company_docs for the year',
              'All obligations for the year', 'Travel expense report PDF if generated'],
   excludes: ['Payroll PDFs (those go in their own section)']},
];

const REPORTS_BY_ID = Object.fromEntries(REPORTS_WIDGETS.map(w => [w.id, w]));

function getReportsConfig() {
  const stored = Prefs.get('reports.widgets');
  if (Array.isArray(stored)) return new Set(stored);
  return new Set(REPORTS_WIDGETS.filter(w => w.default).map(w => w.id));
}

function getReportsOrder() {
  const stored = Prefs.get('reports.order');
  if (Array.isArray(stored)) return stored;
  return REPORTS_WIDGETS.map(w => w.id);
}

function applyReportsLayout() {
  const container = document.getElementById('reports-widgets');
  if (!container) return;
  const active = getReportsConfig();
  const order = getReportsOrder();
  const cards = Array.from(container.querySelectorAll('[data-report-widget]'));

  // Visibility
  cards.forEach(el => {
    el.style.display = active.has(el.dataset.reportWidget) ? '' : 'none';
  });

  // Order — re-attach in saved order
  order.forEach(id => {
    const el = cards.find(c => c.dataset.reportWidget === id);
    if (el) container.appendChild(el);  // appendChild moves the node
  });

  enableReportsDrag();
}

function enableReportsDrag() {
  const container = document.getElementById('reports-widgets');
  if (!container) return;
  let dragged = null;
  container.querySelectorAll('[data-report-widget]').forEach(el => {
    const header = el.querySelector('.report-widget-header');
    if (!header) return;
    header.style.cursor = 'move';
    el.draggable = true;
    el.addEventListener('dragstart', e => {
      // Only drag if the header initiated it (avoid hijacking inner controls)
      if (!e.target.closest('.report-widget-header')) { e.preventDefault(); return; }
      dragged = el;
      el.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragged = null;
    });
    el.addEventListener('dragover', e => {
      if (!dragged || dragged === el) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragged || dragged === el) return;
      const cards = Array.from(container.querySelectorAll('[data-report-widget]'));
      const draggedIdx = cards.indexOf(dragged);
      const targetIdx = cards.indexOf(el);
      if (draggedIdx < targetIdx) container.insertBefore(dragged, el.nextSibling);
      else container.insertBefore(dragged, el);
      const newOrder = Array.from(container.querySelectorAll('[data-report-widget]'))
        .map(e => e.dataset.reportWidget);
      Prefs.set('reports.order', newOrder);
      toast('Layout saved');
    });
  });
}

function showReportsConfig() {
  const active = getReportsConfig();
  const c = document.getElementById('reports-config-widgets');
  c.innerHTML = REPORTS_WIDGETS.map(w => `
    <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;font-size:14px">
      <input type="checkbox" data-report="${w.id}" ${active.has(w.id) ? 'checked' : ''}>
      <span style="flex:1">${w.label}</span>
      <button type="button" class="info-btn" onclick="event.preventDefault(); showReportSettings('${w.id}')" title="Settings & info" aria-label="Settings">&#9432;</button>
    </label>
  `).join('');
  document.getElementById('reports-config-modal').classList.add('show');
}

function saveReportsConfig() {
  const checked = Array.from(document.querySelectorAll('#reports-config-widgets input:checked'))
    .map(cb => cb.dataset.report);
  Prefs.set('reports.widgets', checked);
  document.getElementById('reports-config-modal').classList.remove('show');
  toast('Reports updated');
  applyReportsLayout();
}

function showReportSettings(widgetId) {
  const w = REPORTS_BY_ID[widgetId];
  if (!w) return;
  const visible = getReportsConfig().has(widgetId);
  const body = document.getElementById('widget-info-body');
  body.innerHTML = `
    <h3 style="margin-top:0;margin-bottom:14px">${w.label}</h3>

    <div class="settings-section">
      <div class="settings-row">
        <label>Visible on Reports page</label>
        <label class="switch"><input type="checkbox" ${visible ? 'checked' : ''}
          onchange="toggleReportVisibility('${widgetId}', this.checked)"><span></span></label>
      </div>
    </div>

    <details class="settings-info" open>
      <summary>What's in this section?</summary>
      <div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:6px;font-family:var(--font-mono);font-size:13px">${w.formula}</div>
      <div style="margin-top:14px"><strong style="color:var(--ok-text)">Includes</strong>
      <ul style="margin:6px 0 0 0;padding-left:20px;font-size:13px">${w.includes.map(s => `<li>${s}</li>`).join('')}</ul></div>
      <div style="margin-top:14px"><strong style="color:var(--danger-text)">Excludes</strong>
      <ul style="margin:6px 0 0 0;padding-left:20px;font-size:13px">${w.excludes.map(s => `<li>${s}</li>`).join('')}</ul></div>
    </details>

    <div style="margin-top:18px;text-align:right">
      <button class="btn btn--ghost btn--sm" onclick="resetReportSettings('${widgetId}')">Reset to defaults</button>
    </div>
  `;
  document.getElementById('widget-info-modal').classList.add('show');
}

function toggleReportVisibility(widgetId, visible) {
  const active = getReportsConfig();
  if (visible) active.add(widgetId); else active.delete(widgetId);
  Prefs.set('reports.widgets', Array.from(active));
  applyReportsLayout();
}

function resetReportSettings(widgetId) {
  // Re-enable + remove from custom order
  const active = getReportsConfig();
  active.add(widgetId);
  Prefs.set('reports.widgets', Array.from(active));
  Prefs.set('reports.order', REPORTS_WIDGETS.map(w => w.id));
  applyReportsLayout();
}

function showDashboardConfig() {
  const active = getDashboardConfig();
  const container = document.getElementById('dashboard-config-widgets');
  const groups = {stat: 'Cards', recap: 'Page recap tiles', chart: 'Charts', list: 'Lists'};
  container.innerHTML = Object.entries(groups).map(([type, label]) => `
    <div style="margin-bottom:16px">
      <div class="section-label" style="margin-bottom:8px">${label}</div>
      ${DASHBOARD_WIDGETS.filter(w => w.type === type).map(w => `
        <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;font-size:14px">
          <input type="checkbox" data-widget="${w.id}" ${active.has(w.id) ? 'checked' : ''}>
          <span style="flex:1">${w.label}</span>
          <button type="button" class="info-btn" onclick="event.preventDefault(); showWidgetInfo('${w.id}')" title="What's in this number?" aria-label="Info">&#9432;</button>
        </label>
      `).join('')}
    </div>
  `).join('');
  document.getElementById('dashboard-config-modal').classList.add('show');
}

function enableDashboardDrag() {
  const grid = document.getElementById('dashboard-stats');
  if (!grid) return;
  let dragged = null;
  grid.querySelectorAll('[data-widget-id]').forEach(el => {
    el.style.cursor = 'move';
    el.addEventListener('dragstart', e => {
      dragged = el;
      el.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragged = null;
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragged || dragged === el) return;
      const children = Array.from(grid.children);
      const draggedIdx = children.indexOf(dragged);
      const targetIdx = children.indexOf(el);
      if (draggedIdx < targetIdx) grid.insertBefore(dragged, el.nextSibling);
      else grid.insertBefore(dragged, el);
      const newOrder = Array.from(grid.querySelectorAll('[data-widget-id]')).map(e => e.dataset.widgetId);
      // Merge with existing order so non-stat widgets keep their position
      const existing = getDashboardOrder().filter(id => !newOrder.includes(id));
      saveDashboardOrder([...newOrder, ...existing]);
      toast('Layout saved');
    });
  });
}

function saveDashboardConfig() {
  const checked = Array.from(document.querySelectorAll('#dashboard-config-widgets input:checked'))
    .map(cb => cb.dataset.widget);
  Prefs.set('dashboard.widgets', checked);
  Prefs.set('dashboard.seen', DASHBOARD_WIDGETS.map(w => w.id));
  document.getElementById('dashboard-config-modal').classList.remove('show');
  toast('Dashboard updated');
  loadDashboard();
}

let costChart = null;

// ─── Chart helpers (tokens, legend, builders) ───────────────────────────────

const CHART_TYPE_LABELS = {bar: 'Bar', line: 'Line', area: 'Area', doughnut: 'Doughnut', pie: 'Pie'};

// Read a design token at render time so charts follow the active theme.
function vizToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function vizFmt(v) {
  return 'CHF ' + Number(v || 0).toLocaleString('de-CH', {minimumFractionDigits: 0, maximumFractionDigits: 0});
}
function vizAxis() {
  return {
    grid: { color: vizToken('--viz-grid'), drawBorder: false },
    ticks: { color: vizToken('--text-muted'), font: { size: 11 } },
  };
}
function chartLegendHtml(items) {
  // items: [{label, color, line?}] — text wears text tokens; the swatch carries identity.
  return `<div class="chart-legend">${items.map(i =>
    `<span><span class="chart-legend__sw${i.line ? ' chart-legend__sw--line' : ''}" style="background:${i.color}"></span>${escapeHtml(i.label)}</span>`).join('')}</div>`;
}

function makeChartCard(widgetId, title, canvasId, height, legendHtml = '') {
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.dataset.width = getCardWidth(widgetId);
  const heightStyle = height ? ` style="height:${height}"` : '';
  card.innerHTML = `
    <div class="chart-card__head">
      <h3>${title}</h3>
      <div class="row-split">${legendHtml}
        <button class="info-btn" onclick="showWidgetSettings('${widgetId}')" title="Settings & info" aria-label="Settings">&#9432;</button>
      </div>
    </div>
    <div class="chart-wrap"${heightStyle}><canvas id="${canvasId}"></canvas></div>`;
  return card;
}

// Income vs Costs per month (one axis, two series, profit as a dashed ink line).
function buildSeriesChartConfig(chartType, series) {
  const labels = series.map(m => m.label);
  const income = series.map(m => m.income);
  const costs = series.map(m => m.costs);
  const profit = series.map(m => m.profit);
  const cIn = vizToken('--viz-income'), cOut = vizToken('--viz-costs'), ink = vizToken('--text');
  const isLine = chartType === 'line';
  const mk = (label, data, color) => isLine
    ? { type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
        pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: vizToken('--card'), pointBorderWidth: 2, tension: 0.25 }
    : { type: 'bar', label, data, backgroundColor: color, borderRadius: {topLeft: 4, topRight: 4},
        borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 };
  const datasets = [mk('Income', income, cIn), mk('Costs', costs, cOut), {
    type: 'line', label: 'Profit', data: profit, borderColor: ink, borderDash: [4, 4], borderWidth: 1.5,
    pointRadius: 2, pointHoverRadius: 5, pointBackgroundColor: ink, tension: 0, order: -1,
  }];
  return {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${chf(c.parsed.y)}` } },
      },
      scales: {
        x: { ...vizAxis(), grid: { display: false } },
        y: { ...vizAxis(), ticks: { ...vizAxis().ticks, callback: v => vizFmt(v) }, beginAtZero: true },
      },
    },
  };
}
function chartSeriesLegend() {
  return chartLegendHtml([
    {label: 'Income', color: vizToken('--viz-income')},
    {label: 'Costs', color: vizToken('--viz-costs')},
    {label: 'Profit', color: vizToken('--text'), line: true},
  ]);
}

// Forecast: income vs outflow bars + cash-at-end line (same CHF axis).
function buildForecastChartConfig(months) {
  const cIn = vizToken('--viz-income'), cOut = vizToken('--viz-costs'), ink = vizToken('--text');
  return {
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { type: 'bar', label: 'Income', data: months.map(m => m.income), backgroundColor: cIn,
          borderRadius: {topLeft: 4, topRight: 4}, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 },
        { type: 'bar', label: 'Outflow', data: months.map(m => m.out), backgroundColor: cOut,
          borderRadius: {topLeft: 4, topRight: 4}, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 },
        { type: 'line', label: 'Cash at end', data: months.map(m => m.cash_end), borderColor: ink, borderWidth: 2,
          pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: vizToken('--card'), pointBorderWidth: 2, tension: 0.2, order: -1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${chf(c.parsed.y)}` } } },
      scales: {
        x: { ...vizAxis(), grid: { display: false } },
        y: { ...vizAxis(), ticks: { ...vizAxis().ticks, callback: v => vizFmt(v) } },
      },
    },
  };
}
function forecastLegend() {
  return chartLegendHtml([
    {label: 'Income', color: vizToken('--viz-income')},
    {label: 'Outflow', color: vizToken('--viz-costs')},
    {label: 'Cash at end', color: vizToken('--text'), line: true},
  ]);
}

// Costs by category — magnitude comparison: ranked horizontal bars, one hue.
// Doughnut variant keeps the validated categorical order; 7th+ fold to Other.
function buildCategoryChartConfig(chartType, byCategory, showLegend = true) {
  const MAX = 6;
  let rows = byCategory.slice();
  if (rows.length > MAX) {
    const rest = rows.slice(MAX - 1).reduce((s, r) => s + r.total, 0);
    rows = rows.slice(0, MAX - 1).concat([{category: 'Other', total: rest}]);
  }
  const labels = rows.map(c => c.category);
  const data = rows.map(c => c.total);
  const money = v => chf(v);
  if (chartType === 'bar') {
    return {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: vizToken('--viz-costs'),
        borderRadius: {topRight: 4, bottomRight: 4}, borderSkipped: 'left', categoryPercentage: 0.7, barPercentage: 0.9 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${money(c.parsed.x)}` } } },
        scales: {
          x: { ...vizAxis(), ticks: { ...vizAxis().ticks, callback: v => vizFmt(v), maxRotation: 0, maxTicksLimit: 5 }, beginAtZero: true },
          y: { ...vizAxis(), grid: { display: false } },
        },
      },
    };
  }
  const palette = [1, 2, 3, 4, 5, 6].map(i => vizToken(`--viz-${i}`));
  return {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: palette.slice(0, rows.length),
      borderColor: vizToken('--card'), borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: showLegend ? { position: 'right', labels: { color: vizToken('--text-muted'), boxWidth: 10, boxHeight: 10, usePointStyle: false } } : { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${money(c.parsed)}` } },
      },
    },
  };
}

// ─── Panel recap: one tile per page ─────────────────────────────────────────
function renderPanelsRecap(ov, extra = {}) {
  const el = document.getElementById('dashboard-panels');
  if (!el) return;
  const p = ov.panels || {};
  const reserves = extra.reserves || [];
  const runway = extra.runway || null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = d => Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
  const n = v => Number(v || 0);
  const active = extra.active || getDashboardConfig();
  const tile = ({id, page, label, value, mod, hint, chip, meter}) => {
    if (!active.has(id)) return '';
    const stored = getWidgetSetting(id, 'color', '');
    if (stored === 'none') mod = null;
    else if (stored && stored in COLOR_BY_KEY) mod = COLOR_BY_KEY[stored];
    return `
    <a href="#" class="recap" data-widget-id="${id}" onclick="event.preventDefault();navigateTo('${page}')">
      <div class="recap__head"><span class="recap__label">${label}</span><span class="row-split">${chip || ''}<button class="info-btn info-btn--sm" onclick="event.preventDefault();event.stopPropagation();showWidgetSettings('${id}')" title="Settings & info" aria-label="Settings">&#9432;</button></span></div>
      <div class="recap__value${mod ? ` recap__value--${mod}` : ''}">${value}</div>
      ${meter != null ? `<div class="meter"><div class="meter__bar${meter.mod ? ` meter__bar--${meter.mod}` : ''}" style="width:${Math.min(100, Math.max(0, meter.pct))}%"></div></div>` : ''}
      ${hint ? `<div class="recap__hint">${hint}</div>` : ''}
    </a>`;
  };
  const tiles = [];

  // Bank
  if (p.bank) {
    const age = days(p.bank.as_of) * -1;
    const stale = age > 45;
    tiles.push(tile({id: 'recap-bank', page: 'bank', label: `🏦 Bank · ${escapeHtml(p.bank.bank)}`, value: chf(p.bank.closing),
      chip: stale ? `<span class="chip chip--warn chip--sm">${age}d old</span>` : `<span class="chip chip--ok chip--sm">${age}d ago</span>`,
      hint: `Statement to ${p.bank.as_of}${runway && runway.runway_months != null ? ` · runway ${runway.runway_months} mo` : ''}`}));
  } else {
    tiles.push(tile({id: 'recap-bank', page: 'bank', label: '🏦 Bank', value: '—', hint: 'Upload your first statement'}));
  }

  // Cash & reserves
  const earmarked = reserves.reduce((s, r) => s + n(r.accumulated), 0);
  const target = reserves.reduce((s, r) => s + n(r.target_amount), 0);
  const monthly = reserves.reduce((s, r) => s + n(r.monthly_accrual), 0);
  tiles.push(tile({id: 'recap-cash', page: 'cash', label: '💰 Cash & reserves', value: chf(earmarked),
    meter: {pct: target ? earmarked / target * 100 : 0, mod: 'ok'},
    hint: `earmarked of ${chf(target)} · +${chf(monthly)}/mo · ${reserves.length} pot${reserves.length === 1 ? '' : 's'}`}));

  // Bills
  const b = p.bills || {};
  tiles.push(tile({id: 'recap-bills', page: 'accounting', label: '🧾 Bills', value: chf(b.total), mod: n(b.overdue_total) > 0 ? 'danger' : (n(b.total) > 0 ? 'warn' : null),
    chip: n(b.overdue_total) > 0 ? `<span class="chip chip--danger chip--sm">${chf(b.overdue_total)} overdue</span>` : (n(b.count) === 0 ? `<span class="chip chip--ok chip--sm">all paid</span>` : ''),
    hint: n(b.count) ? `${b.count} unpaid` : `Nothing open · ${ov.recent_bills.length ? 'last: ' + escapeHtml(ov.recent_bills[0].vendor) : ''}`}));

  // Obligations
  const o = p.obligations || {};
  const paidPct = n(o.total) ? n(o.paid) / n(o.total) * 100 : 0;
  const nx = o.next;
  const nxDays = nx ? days(nx.due_date) : null;
  tiles.push(tile({id: 'recap-obligations', page: 'obligations', label: `📋 Obligations ${o.year || ''}`, value: chf(o.unpaid), mod: n(o.overdue_total) > 0 ? 'danger' : 'warn',
    chip: n(o.overdue_total) > 0 ? `<span class="chip chip--danger chip--sm">${chf(o.overdue_total)} overdue</span>` : `<span class="chip chip--sm">${o.paid_count}/${o.count} paid</span>`,
    meter: {pct: paidPct, mod: 'ok'},
    hint: nx ? `Next: ${escapeHtml(nx.label)} ${escapeHtml(nx.period)} · ${chf(nx.amount)} · ${nxDays === 0 ? 'today' : nxDays < 0 ? Math.abs(nxDays) + 'd overdue' : 'in ' + nxDays + 'd'}` : `still to pay of ${chf(o.total)}`}));

  // Payroll
  const pr = p.payroll || {};
  tiles.push(tile({id: 'recap-payroll', page: 'payroll', label: '👤 Payroll', value: pr.last_net != null ? chf(pr.last_net) + '<span class="recap__hint" style="display:inline"> net/mo</span>' : '—',
    chip: pr.months_missing > 0 ? `<span class="chip chip--warn chip--sm">${pr.months_missing} payslip${pr.months_missing > 1 ? 's' : ''} missing</span>` : `<span class="chip chip--ok chip--sm">up to date</span>`,
    hint: `${pr.payslips_year} payslips this year · employer cost ${chf(pr.cost_year)}${pr.last_period ? ' · last ' + escapeHtml(pr.last_period) : ''}`}));

  // Invoices / receivables
  const r = p.receivables || {};
  tiles.push(tile({id: 'recap-invoices', page: 'invoices', label: '📄 Invoices', value: chf(r.total), mod: n(r.overdue_count) > 0 ? 'danger' : (n(r.total) > 0 ? 'warn' : 'ok'),
    chip: n(r.overdue_count) > 0 ? `<span class="chip chip--danger chip--sm">${r.overdue_count} overdue</span>` : (n(r.count) ? `<span class="chip chip--warn chip--sm">${r.count} open</span>` : `<span class="chip chip--ok chip--sm">all paid</span>`),
    hint: `outstanding · ${ov.invoices.count_ytd} issued this year · avg ${chf(ov.invoices.avg_monthly_revenue)}/mo`}));

  // Kontokorrent
  const k = p.kontokorrent || {};
  const kn = n(k.net);
  tiles.push(tile({id: 'recap-kontokorrent', page: 'cash', label: '🔁 Kontokorrent', value: chf(Math.abs(kn)), mod: kn > 0 ? 'owner' : (kn < 0 ? 'danger' : null),
    chip: kn > 0 ? `<span class="chip chip--owner chip--sm">GmbH owes you</span>` : kn < 0 ? `<span class="chip chip--danger chip--sm">you owe GmbH</span>` : `<span class="chip chip--ok chip--sm">settled</span>`,
    hint: `${k.personal_card_open_count || 0} personal-card bills (${chf(k.personal_card_open)}) + ${k.reports_open_count || 0} reports (${chf(k.reports_open)}) pending`}));

  // VAT
  const v = p.vat || {};
  tiles.push(tile({id: 'recap-vat', page: 'obligations', label: '🏛 VAT', value: chf(v.open_obligations), mod: n(v.open_obligations) > 0 ? 'warn' : null,
    hint: `to remit · collected ${chf(v.collected_year)} on invoices this year`}));

  // Dividends (client-side planner, persisted in Prefs)
  if (typeof divSummaryFromPrefs === 'function') {
    const d = divSummaryFromPrefs();
    const ty = d.thisYear;
    const span = d.years.length > 1 ? `${d.firstPayout} → ${d.lastPayout}` : (d.firstPayout || '—');
    tiles.push(tile({id: 'recap-dividends', page: 'dividends', label: `⚡ Dividends FY ${new Date().getFullYear()}`,
      value: ty && ty.gross > 0 ? chf(ty.net) : '—', mod: ty && ty.gross > 0 ? 'owner' : null,
      chip: ty && ty.gross > 0 ? `<span class="chip chip--owner chip--sm">${chf(ty.monthly)}/mo × ${ty.months}</span>` : `<span class="chip chip--sm">nothing this year</span>`,
      hint: ty && ty.gross > 0
        ? `net after tax (≈${(d.effRate * 100).toFixed(1)}%) of ${chf(ty.gross)} gross · paid ${ty.payout}${d.years.length > 1 ? ` · whole plan ${chf(d.netAfterTax)} net, ${span}` : ''}`
        : (d.planned ? `plan covers ${span} · ${chf(d.netAfterTax)} net in total` : 'set a monthly amount to plan a payout')}));
  }

  // Forecast
  if (extra.forecast) {
    const f = extra.forecast; const low = f.lowest || {cash_end: f.opening, label: '—'};
    tiles.push(tile({id: 'recap-forecast', page: 'budget', label: '📈 Forecast', value: chf(low.cash_end),
      mod: low.cash_end < 0 ? 'danger' : (low.cash_end < f.payroll_net ? 'warn' : 'ok'),
      chip: `<span class="chip chip--sm">low in ${escapeHtml(low.label)}</span>`,
      hint: `lowest cash · ${chf(f.end_cash)} at end of ${f.year} · default income ${chf(f.income_monthly)}/mo`}));
  }

  // Expenses
  tiles.push(tile({id: 'recap-expenses', page: 'expenses', label: '🧳 Expenses & trips', value: chf(k.reports_open),
    chip: n(k.reports_open_count) ? `<span class="chip chip--warn chip--sm">${k.reports_open_count} to reimburse</span>` : `<span class="chip chip--ok chip--sm">none open</span>`,
    hint: 'expense reports not yet reimbursed'}));

  el.innerHTML = tiles.some(Boolean) ? `<div class="recap-grid">${tiles.join('')}</div>` : '';
}

function renderBankWidget(latest) {
  const el = document.getElementById('dashboard-bank');
  if (!el) return;
  if (!latest || !latest.present) {
    el.innerHTML = `<div class="table-card" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:baseline">
      <div class="hint">No bank statement uploaded yet</div>
      <a href="#" onclick="event.preventDefault();navigateTo('bank')" style="font-size:12px">Upload your first statement →</a>
    </div>`;
    return;
  }
  const periodEnd = new Date(latest.period_end);
  const ageDays = Math.round((Date.now() - periodEnd.getTime()) / 86400000);
  const stale = ageDays > 45;
  el.innerHTML = `
    <div class="table-card" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:baseline;gap:14px">
      <div>
        <div class="hint">Latest bank balance — ${escapeHtml(latest.bank)} ${escapeHtml(latest.account_label || '')}</div>
        <div style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(latest.currency)} ${chf(latest.closing_balance)}</div>
        <div class="hint hint--sm${stale ? ' t-danger' : ''}">As of ${latest.period_end}${stale ? ` · <b>${ageDays} days old — upload latest statement</b>` : ` · ${ageDays} days ago`}</div>
      </div>
      <a href="#" onclick="event.preventDefault();navigateTo('bank')" class="btn btn--outline btn--sm">All statements →</a>
    </div>`;
}

// ── Cash allocation: the real bank balance, split into what's spoken for.
// Every envelope is virtual — the money stays on the UBS account; this view
// just stops earmarked cash from looking spendable.
async function renderCashAllocation(reserves, containerId = 'cash-allocation-panel') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const [cb, st, obs] = await Promise.all([
    api('/cash-balance').catch(() => null),
    api('/bank-statements/latest').catch(() => null),
    api('/obligations').catch(() => []),
  ]);
  let bal = null, asOf = null, source = '';
  if (cb && cb.balance != null) { bal = cb.balance; asOf = cb.as_of; source = 'manual entry'; }
  if (st && st.present && (!asOf || (st.period_end && st.period_end > asOf))) {
    bal = st.closing_balance; asOf = st.period_end; source = 'bank statement';
  }
  if (bal == null) { el.innerHTML = ''; return; }

  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const dueSoon = (obs || []).filter(o => o.status === 'unpaid' && (o.payable_date || o.due_date) && (o.payable_date || o.due_date) <= in30);
  const due30 = dueSoon.reduce((s, o) => s + o.amount, 0);
  const due30Count = dueSoon.length;
  const earmarked = (reserves || []).reduce((s, r) => s + r.accumulated, 0);
  const free = bal - earmarked - due30;
  const staleDays = asOf ? Math.round((Date.now() - new Date(asOf)) / 86400000) : null;

  const row = (label, val, opts = {}) => `
    <div class="row-split" style="padding:3px 0${opts.top ? ';border-top:1px solid var(--border)' : ''}">
      <span class="${opts.muted ? 'hint' : ''}">${label}</span>
      <span class="money${opts.cls || ''}">${val < 0 || opts.minus ? '−' : ''}${chf(Math.abs(val))}</span>
    </div>`;
  el.innerHTML = `<div class="panel">
    <div class="row-split" style="margin-bottom:4px">
      <strong>Cash allocation</strong>
      <span class="hint hint--sm">${source} · as of ${asOf}${staleDays > 21 ? ` · <span class="t-warn">${staleDays} days old — update it</span>` : ''}</span>
    </div>
    ${row('Bank balance', bal)}
    ${row(`− Earmarked in reserves (${(reserves || []).length} pots)`, earmarked, {minus: true, muted: true})}
    ${row(`− Obligations due next 30 days (${due30Count})`, due30, {minus: true, muted: true})}
    <div class="row-split" style="padding:5px 0;border-top:2px solid var(--border-strong);margin-top:2px">
      <strong>${free >= 0 ? 'Free cash' : 'Over-allocated'}</strong>
      <span class="money money--lg ${free >= 0 ? 'money--ok' : 'money--danger'}">${free < 0 ? '−' : ''}${chf(Math.abs(free))}</span>
    </div>
    ${free < 0 ? `<div class="notice notice--danger" style="margin-top:6px">The envelopes + near-term obligations exceed the bank balance by ${chf(-free)} — the plan needs incoming revenue or smaller earmarks.</div>`
               : `<div class="hint hint--sm" style="margin-top:4px">Only this number is safe to spend on anything new (laptops → contribute it to the Equipment reserve first, so it stays earmarked).</div>`}
  </div>`;
}

async function loadCashPage() {
  try {
    const [reserves, preview, obligations] = await Promise.all([
      api('/reserves'),
      api('/payroll/preview').catch(() => null),
      api('/obligations').catch(() => []),
    ]);
    renderCashAllocation(reserves, 'cash-allocation-panel');
    if (preview) renderPayrollCashPlan(preview, obligations);
    const pots = document.getElementById('cash-pots');
    pots.innerHTML = reserves.map(r => `
      <div class="panel" style="margin-bottom:8px">
        <div class="row-split">
          <div style="flex:1;min-width:0">
            <strong>${escapeHtml(r.name)}</strong>
            ${r.monthly_accrual > 0 ? `<span class="chip chip--info chip--sm">+${chf(r.monthly_accrual)}/mo auto</span>` : ''}
            <div class="hint hint--sm">${escapeHtml(r.purpose || '')}</div>
          </div>
          <div style="text-align:right">
            <div class="money money--lg">${chf(r.accumulated)}</div>
            <div class="hint hint--sm">of ${chf(r.target_amount)} target</div>
          </div>
        </div>
        <div class="meter" style="margin:6px 0"><div class="meter__bar${r.progress_pct >= 100 ? ' meter__bar--ok' : ''}" style="width:${Math.min(r.progress_pct, 100)}%"></div></div>
        <div class="row-split">
          <span class="hint hint--sm">Movements adjust the earmark only — the cash stays at UBS.</span>
          <span style="display:flex;gap:6px;align-items:center">
            <input type="number" class="control control--auto" id="pot-amt-${r.id}" placeholder="CHF" step="0.05" min="0" style="width:90px;font-size:12px;padding:3px 6px">
            <button class="btn btn--ok btn--sm" onclick="movePot(${r.id}, 'contribute')">Add</button>
            <button class="btn btn--outline btn--sm" onclick="movePot(${r.id}, 'withdraw')">Take</button>
          </span>
        </div>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function movePot(id, kind) {
  const inp = document.getElementById(`pot-amt-${id}`);
  const amount = parseFloat(inp.value);
  if (!amount || amount <= 0) { toast('Enter an amount first', 'error'); return; }
  const fd = new FormData();
  fd.append('amount', amount);
  fd.append('description', kind === 'contribute' ? 'Manual contribution (Cash Allocation page)' : 'Manual withdrawal (Cash Allocation page)');
  try {
    const res = await fetch(`/api/reserves/${id}/${kind}`, { method: 'POST', body: fd, headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    toast(kind === 'contribute' ? `${chf(amount)} earmarked` : `${chf(amount)} released`);
    loadCashPage();
  } catch (e) { toast(e.message, 'error'); }
}

function renderReservesWidget(reserves) {
  const el = document.getElementById('dashboard-reserves');
  if (!el) return;
  const targetTotal = (reserves || []).reduce((s, r) => s + r.target_amount, 0);
  const accumTotal  = (reserves || []).reduce((s, r) => s + r.accumulated, 0);
  const monthlyTotal = (reserves || []).reduce((s, r) => s + r.monthly_accrual, 0);
  const rows = !reserves || !reserves.length
    ? `<div class="hint" style="padding:14px">No reserves configured. Click <b>+ Add</b> to start tracking a sinking fund.</div>`
    : reserves.map(r => {
        const pct = Math.min(100, r.progress_pct || 0);
        const due = r.target_date ? new Date(r.target_date) : null;
        const dueLabel = due ? due.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'}) : '—';
        const overdue = due && due < new Date() && r.remaining > 0.5;
        return `
          <div style="padding:10px 14px;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
              <div style="font-weight:600">${escapeHtml(r.name)}</div>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="hint">
                  target ${chf(r.target_amount)} · due ${dueLabel}${overdue?' <span style="color:#dc2626;font-weight:600">overdue</span>':''}
                </div>
                <button class="btn btn--ghost btn--icon" onclick="editReserve(${r.id})" title="Edit">&#9998;</button>
                <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="deleteReserve(${r.id}, '${escapeHtml(r.name).replace(/'/g,"\\'")}')" title="Delete">&#128465;</button>
              </div>
            </div>
            ${r.purpose ? `<div class="hint hint--sm" style="margin:2px 0 6px">${escapeHtml(r.purpose)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:10px">
              <div class="meter" style="flex:1">
                <div class="meter__bar${overdue ? ' meter__bar--danger' : (pct >= 95 ? ' meter__bar--ok' : '')}" style="width:${pct}%"></div>
              </div>
              <div style="font-size:12px;font-variant-numeric:tabular-nums;min-width:160px;text-align:right">
                <span style="font-weight:600">${chf(r.accumulated)}</span>
                <span style="color:var(--text-muted)"> / ${chf(r.target_amount)}</span>
                <span style="color:var(--text-muted)"> · +${chf(r.monthly_accrual)}/mo</span>
              </div>
            </div>
          </div>`;
      }).join('');
  el.innerHTML = `
    <div class="table-card" style="padding:0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px;border-bottom:1px solid var(--border)">
        <h3 style="margin:0;font-size:14px">Reserves / Sinking Funds</h3>
        <div style="display:flex;align-items:center;gap:14px">
          <div class="hint">
            accrued <span style="font-weight:600;color:var(--text)">${chf(accumTotal)}</span>
            of ${chf(targetTotal)} · monthly accrual <span style="font-weight:600;color:var(--text)">${chf(monthlyTotal)}</span>
          </div>
          <button class="btn btn--primary btn--sm" onclick="openReserveModal()">+ Add</button>
        </div>
      </div>
      ${rows}
    </div>`;
}

async function reloadReserves() {
  try {
    const reserves = await api('/reserves');
    renderReservesWidget(reserves);
    renderCashAllocation(reserves);
  } catch (e) {}
}

function openReserveModal(reserve) {
  // Lazily create the modal in the DOM if missing
  if (!document.getElementById('reserve-modal')) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="reserve-modal" class="modal-overlay" onclick="if(event.target===this)closeReserveModal()">
        <div class="modal">
          <div class="row-split" style="margin-bottom:12px">
            <h3 id="reserve-modal-title" style="margin:0">Add reserve</h3>
            <button class="btn btn--ghost btn--sm" onclick="closeReserveModal()">Close</button>
          </div>
          <form id="reserve-form" onsubmit="submitReserveForm(event)">
            <input type="hidden" id="reserve-id">
            <div class="form-grid">
              <div class="field form-grid--full">
                <label class="field__label">Name *</label>
                <input class="control" type="text" id="reserve-name" required placeholder="e.g. Gewinnsteuer FY2027">
              </div>
              <div class="field form-grid--full">
                <label class="field__label">Purpose</label>
                <input class="control" type="text" id="reserve-purpose" placeholder="What is this saving for?">
              </div>
              <div class="field">
                <label class="field__label">Target amount (CHF) *</label>
                <input class="control" type="number" id="reserve-target" step="0.01" min="0" required>
              </div>
              <div class="field">
                <label class="field__label">Target date</label>
                <input class="control" type="date" id="reserve-target-date">
              </div>
              <div class="field">
                <label class="field__label">Monthly accrual (CHF)</label>
                <input class="control" type="number" id="reserve-monthly" step="0.01" min="0" value="0">
              </div>
              <div class="field">
                <label class="field__label">Accrual start</label>
                <input class="control" type="date" id="reserve-start">
              </div>
              <div class="field form-grid--full">
                <label class="field__label">Manual adjustment (CHF) — one-shot prior contribution / cash already paid in</label>
                <input class="control" type="number" id="reserve-manual" step="0.01" value="0">
              </div>
            </div>
            <div class="form-actions" style="margin-top:14px">
              <button type="submit" class="btn btn--primary">Save</button>
              <button type="button" class="btn btn--ghost" onclick="closeReserveModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }
  document.getElementById('reserve-modal-title').textContent = reserve ? 'Edit reserve' : 'Add reserve';
  document.getElementById('reserve-id').value = reserve ? reserve.id : '';
  document.getElementById('reserve-name').value = reserve ? reserve.name : '';
  document.getElementById('reserve-purpose').value = reserve ? (reserve.purpose || '') : '';
  document.getElementById('reserve-target').value = reserve ? reserve.target_amount : '';
  document.getElementById('reserve-target-date').value = reserve && reserve.target_date ? reserve.target_date.slice(0, 10) : '';
  document.getElementById('reserve-monthly').value = reserve ? reserve.monthly_accrual : 0;
  document.getElementById('reserve-start').value = reserve && reserve.accrual_start ? reserve.accrual_start.slice(0, 10) : '';
  document.getElementById('reserve-manual').value = reserve ? reserve.accumulated_manual : 0;
  document.getElementById('reserve-modal').classList.add('show');
}

function closeReserveModal() {
  const m = document.getElementById('reserve-modal');
  if (m) m.classList.remove('show');
}

async function editReserve(id) {
  try {
    const all = await api('/reserves');
    const r = all.find(x => x.id === id);
    if (r) openReserveModal(r);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteReserve(id, name) {
  if (!confirm(`Delete reserve "${name}"?`)) return;
  try {
    await fetch(`/api/reserves/${id}`, { method: 'DELETE', headers: authHeaders() });
    toast('Reserve deleted');
    reloadReserves();
  } catch (e) { toast(e.message, 'error'); }
}

