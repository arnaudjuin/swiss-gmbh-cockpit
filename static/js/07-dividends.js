// 07-dividends.js — dividend planner, docs viewer, test procedure
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// DIVIDEND PLANNER — simple "set aside X per month, take it out in June" model
// ══════════════════════════════════════════════════════════════════════════════

// Default bucket starter set — edit on the page (changes persist via Prefs).
const DIV_DEFAULT_BUCKETS = [
  {name: "Down payment", amount: 5000},
  {name: "Wine",         amount: 500},
  {name: "Mariage",      amount: 500},
  {name: "Para",         amount: 500},
  {name: "New Projet",   amount: 300},
  {name: "Bague",        amount: 200},
  {name: "Montre",       amount: 200},
];

const DIV_DEFAULTS = {
  bucketNames:    DIV_DEFAULT_BUCKETS.map(b => b.name),
  // Marginal rates; the dividend is only partially taxable (qualified ≥10%):
  // 70% of it federally, 50% cantonally (ZH) → effective ≈ 0.7·fed + 0.5·cant
  fedRatePct:     12,     // federal marginal at ~CHF 150-200k taxable, single
  cantRatePct:    21.5,   // ZH base × Steuerfuss (canton 98% + city 119%)
  starting:       0,
  // Multi-year plan with per-year amounts:
  //   years[i] = {fiscalYear, startMonth, amounts: [Number, ...]}
  // amounts is aligned 1:1 with bucketNames (same length, same order).
  years:          null,
};

const _MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Sentinel so recalcDividends knows the page has been hydrated at least once.
let _divLoaded = false;

function _divDefaults() {
  const now = new Date();
  const fy = now.getFullYear();
  return {
    bucketNames: DIV_DEFAULT_BUCKETS.map(b => b.name),
    years: [
      {fiscalYear: fy, startMonth: now.getMonth() + 1,
       amounts: DIV_DEFAULT_BUCKETS.map(b => b.amount)},
    ],
  };
}

// In-memory state — kept aligned: amounts[i] in any year matches bucketNames[i].
let _divBucketNames = [];
let _divYears = [];

// In-memory bucket list — kept in sync with the table on every keystroke.
let _divBuckets = [];

function _divGetInputs() {
  const get = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    bucketNames:    [..._divBucketNames],
    years:          _divYears.map(y => ({
      fiscalYear: y.fiscalYear,
      startMonth: y.startMonth,
      amounts:    [...y.amounts],
    })),
    fedRatePct:  get('div-fed-rate',  DIV_DEFAULTS.fedRatePct),
    cantRatePct: get('div-cant-rate', DIV_DEFAULTS.cantRatePct),
    starting:    get('div-starting',  DIV_DEFAULTS.starting),
  };
}

// Headline numbers from the saved plan alone (no DOM) — used by the
// dashboard recap tile; mirrors recalcDividends() arithmetic exactly.
function divSummaryFromPrefs() {
  const saved = (typeof Prefs !== 'undefined' && Prefs.get('dividends', null)) || {};
  const d = _divDefaults();
  const i = {
    years: Array.isArray(saved.years) && saved.years.length ? saved.years : d.years,
    fedRatePct: Number.isFinite(saved.fedRatePct) ? saved.fedRatePct : DIV_DEFAULTS.fedRatePct,
    cantRatePct: Number.isFinite(saved.cantRatePct) ? saved.cantRatePct : DIV_DEFAULTS.cantRatePct,
    starting: Number.isFinite(saved.starting) ? saved.starting : DIV_DEFAULTS.starting,
  };
  const perYear = i.years.map(y => {
    const months = 12 - Math.max(1, Math.min(12, y.startMonth || 1)) + 1;
    const monthly = (y.amounts || []).reduce((s, a) => s + (Number(a) || 0), 0);
    return {fiscalYear: y.fiscalYear, months, monthly, gross: monthly * months};
  }).sort((a, b) => a.fiscalYear - b.fiscalYear);
  const contributions = perYear.reduce((s, p) => s + p.gross, 0);
  const grossPot = Math.max(0, i.starting) + contributions;
  const effRate = _divEffectiveRate(i);
  const netAfterTax = grossPot - grossPot * effRate;
  const thisYear = new Date().getFullYear();
  const current = perYear.find(p => p.fiscalYear === thisYear) || perYear[0] || null;
  const ty = perYear.find(p => p.fiscalYear === thisYear) || null;
  return {
    thisYear: ty ? {fiscalYear: ty.fiscalYear, monthly: ty.monthly, months: ty.months, gross: ty.gross,
                    net: ty.gross - ty.gross * effRate, payout: `Jun ${ty.fiscalYear + 1}`} : null,
    grossPot, netAfterTax, effRate, contributions, starting: i.starting,
    years: perYear, planned: grossPot > 0,
    currentMonthly: current ? current.monthly : 0,
    firstPayout: perYear.length ? `Jun ${perYear[0].fiscalYear + 1}` : null,
    lastPayout: perYear.length ? `Jun ${perYear[perYear.length - 1].fiscalYear + 1}` : null,
  };
}

// Effective personal tax rate on a gross dividend (qualified holding ≥ 10%):
// 70% of it is taxable federally, 50% cantonally in ZH, each at marginal rate.
// Country parameters — Settings → Localization (defaults: Swiss qualified holding)
const DIV_FED_INCLUSION = () => AppSettings.divTax.fedIncl;
const DIV_CANT_INCLUSION = () => AppSettings.divTax.cantIncl;
const DIV_WHT = () => AppSettings.divTax.wht;
function _divEffectiveRate(i) {
  return DIV_FED_INCLUSION() * (i.fedRatePct / 100)
       + DIV_CANT_INCLUSION() * (i.cantRatePct / 100);
}

function _divFillInputs(saved) {
  const def = _divDefaults();
  const s = {...DIV_DEFAULTS, ...def, ...(saved || {})};

  // ─── Migrate from any older shape to {bucketNames, years[{amounts[]}]}
  let bucketNames, years;

  if (Array.isArray(s.bucketNames) && s.bucketNames.length) {
    // Current shape
    bucketNames = s.bucketNames.map(String);
    years = (Array.isArray(s.years) ? s.years : []).map(y => ({
      fiscalYear: Number(y.fiscalYear) || def.years[0].fiscalYear,
      startMonth: Math.max(1, Math.min(12, Number(y.startMonth) || 1)),
      amounts:    bucketNames.map((_, i) =>
                    Number((y.amounts || [])[i]) || 0),
    }));
  } else if (Array.isArray(s.buckets) && s.buckets.length) {
    // Previous shape: shared {name, amount} buckets + years without amounts
    bucketNames = s.buckets.map(b => String(b.name || ''));
    const sharedAmounts = s.buckets.map(b => Number(b.amount) || 0);
    const yearList = Array.isArray(s.years) && s.years.length
      ? s.years
      : [{fiscalYear: s.fiscalYear || def.years[0].fiscalYear,
          startMonth: s.startMonth || def.years[0].startMonth}];
    years = yearList.map(y => ({
      fiscalYear: Number(y.fiscalYear) || def.years[0].fiscalYear,
      startMonth: Math.max(1, Math.min(12, Number(y.startMonth) || 1)),
      amounts:    [...sharedAmounts],
    }));
  } else {
    // Fresh defaults
    bucketNames = def.bucketNames;
    years = def.years.map(y => ({...y, amounts: [...y.amounts]}));
  }

  // Ensure every year has the right amounts length (pad with zeros)
  for (const y of years) {
    while (y.amounts.length < bucketNames.length) y.amounts.push(0);
    y.amounts.length = bucketNames.length;
  }
  if (years.length === 0) years = def.years.map(y => ({...y, amounts: [...y.amounts]}));

  _divBucketNames = bucketNames;
  _divYears = years;

  _renderYearsTable();
  _renderBucketMatrix();

  // Migration: old saves had a single personalTaxPct applied to full gross.
  // If the new split rates were never saved, start from the ZH defaults —
  // that IS the fix; the old single-rate model was the bug.
  document.getElementById('div-fed-rate').value =
    Number.isFinite(s.fedRatePct) ? s.fedRatePct : DIV_DEFAULTS.fedRatePct;
  document.getElementById('div-cant-rate').value =
    Number.isFinite(s.cantRatePct) ? s.cantRatePct : DIV_DEFAULTS.cantRatePct;
  document.getElementById('div-starting').value = s.starting;
}

function _renderYearsTable() {
  const tbody = document.getElementById('div-years-tbody');
  if (!tbody) return;
  const monthOptions = (selected) => _MONTH_NAMES.map((m, i) =>
    `<option value="${i + 1}" ${i + 1 === selected ? 'selected' : ''}>${m}</option>`).join('');
  tbody.innerHTML = _divYears.map((y, i) => {
    const months = 12 - y.startMonth + 1;
    return `<tr>
      <td><input type="number" min="2000" max="2099" step="1" value="${y.fiscalYear}"
        oninput="updateDivYear(${i}, 'fiscalYear', this.value)"
        style="width:100px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px;font-family:var(--font-mono)"></td>
      <td><select onchange="updateDivYear(${i}, 'startMonth', this.value)"
        style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px">${monthOptions(y.startMonth)}</select></td>
      <td class="money">${months} / 12</td>
      <td style="width:32px;text-align:right"><button type="button"
        onclick="removeDivYear(${i})" title="Remove"
        class="info-btn" style="color:var(--danger-text);opacity:0.6">×</button></td>
    </tr>`;
  }).join('');
  const totalMonths = _divYears.reduce((s, y) => s + (12 - y.startMonth + 1), 0);
  document.getElementById('div-years-total').textContent = String(totalMonths);
}

function updateDivYear(idx, key, value) {
  if (!_divYears[idx]) return;
  if (key === 'fiscalYear') {
    _divYears[idx].fiscalYear = Math.max(2000, Math.min(2099, Number(value) || 0));
  } else if (key === 'startMonth') {
    _divYears[idx].startMonth = Math.max(1, Math.min(12, Number(value) || 1));
  }
  _renderYearsTable();
  _renderBucketMatrix();   // year column header changes
  recalcDividends();
}

function removeDivYear(idx) {
  _divYears.splice(idx, 1);
  if (_divYears.length === 0) {
    _divYears = _divDefaults().years.map(y => ({...y, amounts: [...y.amounts]}));
  }
  _renderYearsTable();
  _renderBucketMatrix();
  recalcDividends();
}

function addDivYear() {
  // New year defaults: year+1 from the last entry, full year contributions,
  // bucket amounts copied from the previous year (or zeros if no years exist).
  const last = _divYears[_divYears.length - 1];
  const nextYear = last ? last.fiscalYear + 1 : new Date().getFullYear();
  const amounts = last
    ? [...last.amounts]
    : _divBucketNames.map(() => 0);
  _divYears.push({fiscalYear: nextYear, startMonth: 1, amounts});
  _renderYearsTable();
  _renderBucketMatrix();
  recalcDividends();
}

function _renderBucketMatrix() {
  const thead = document.getElementById('div-buckets-thead');
  const tbody = document.getElementById('div-buckets-tbody');
  const tfoot = document.getElementById('div-buckets-tfoot');
  if (!thead || !tbody || !tfoot) return;

  // Header — one column per year
  thead.innerHTML = `<tr>
    <th style="text-align:left">Bucket</th>
    ${_divYears.map(y => `<th class="text-right" style="font-family:var(--font-mono);font-size:11px">FY ${y.fiscalYear}</th>`).join('')}
    <th></th>
  </tr>`;

  // Body — one row per bucket
  tbody.innerHTML = _divBucketNames.map((name, bIdx) => `
    <tr>
      <td><input type="text" value="${escapeHtml(name)}"
        oninput="updateDivBucketName(${bIdx}, this.value)"
        style="width:100%;min-width:140px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px"></td>
      ${_divYears.map((y, yIdx) => `
        <td style="width:110px"><input type="number" step="50" min="0" value="${y.amounts[bIdx] || 0}"
          oninput="updateDivBucketAmount(${bIdx}, ${yIdx}, this.value)"
          style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px;text-align:right;font-family:var(--font-mono)"></td>
      `).join('')}
      <td style="width:32px;text-align:right"><button type="button"
        onclick="removeDivBucket(${bIdx})" title="Remove bucket"
        class="info-btn" style="color:var(--danger-text);opacity:0.6">×</button></td>
    </tr>`).join('') || '<tr><td colspan="99" class="empty-cell hint" style="padding:12px">No buckets yet — click "+ Add bucket" to start.</td></tr>';

  // Footer — monthly total per year
  const totalsPerYear = _divYears.map((y) =>
    y.amounts.reduce((s, a) => s + (Number(a) || 0), 0));
  tfoot.innerHTML = `<tr>
    <td style="font-weight:600">Monthly total</td>
    ${totalsPerYear.map(t => `<td class="money" style="font-weight:600">${chf(t)}</td>`).join('')}
    <td></td>
  </tr>`;
}

function updateDivBucketName(bIdx, value) {
  if (bIdx < 0 || bIdx >= _divBucketNames.length) return;
  _divBucketNames[bIdx] = String(value);
  // Don't re-render — would lose focus. Header label is the year, not the bucket
  // name, so name doesn't appear in any header that needs updating.
  recalcDividends();
}

function updateDivBucketAmount(bIdx, yIdx, value) {
  if (!_divYears[yIdx] || bIdx < 0 || bIdx >= _divBucketNames.length) return;
  _divYears[yIdx].amounts[bIdx] = Number(value) || 0;
  // Only update the footer + downstream — keep focus by not re-rendering tbody
  const totalsPerYear = _divYears.map((y) =>
    y.amounts.reduce((s, a) => s + (Number(a) || 0), 0));
  const tfoot = document.getElementById('div-buckets-tfoot');
  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <td style="font-weight:600">Monthly total</td>
      ${totalsPerYear.map(t => `<td class="money" style="font-weight:600">${chf(t)}</td>`).join('')}
      <td></td>
    </tr>`;
  }
  recalcDividends();
}

function removeDivBucket(bIdx) {
  _divBucketNames.splice(bIdx, 1);
  for (const y of _divYears) y.amounts.splice(bIdx, 1);
  _renderBucketMatrix();
  recalcDividends();
}

function addDivBucket() {
  _divBucketNames.push('New bucket');
  for (const y of _divYears) y.amounts.push(0);
  _renderBucketMatrix();
  recalcDividends();
}

async function loadDividends() {
  _divFillInputs(Prefs.get('dividends', null));
  _divLoaded = true;
  recalcDividends();
}

function _divPersistDebounced() {
  Prefs.set('dividends', _divGetInputs());
}

function _contributionMonthsInFiscalYear(startMonthInYear) {
  // Months you contribute within the fiscal year. Jan = 12, Apr = 9, Dec = 1.
  // Capped at 12 by definition since a fiscal year has 12 months.
  const m = Math.max(1, Math.min(12, startMonthInYear || 1));
  return 12 - m + 1;
}

function recalcDividends() {
  if (!_divLoaded) return;
  const i = _divGetInputs();
  _divPersistDebounced();

  // Per-year stats
  const perYear = i.years.map((y) => {
    const months  = _contributionMonthsInFiscalYear(y.startMonth);
    const monthly = y.amounts.reduce((s, a) => s + (Number(a) || 0), 0);
    return {fiscalYear: y.fiscalYear, months, monthly, gross: monthly * months};
  });

  const totalMonths = perYear.reduce((s, p) => s + p.months, 0);
  const contributions = perYear.reduce((s, p) => s + p.gross, 0);
  const grossPot = Math.max(0, i.starting) + contributions;
  // For the contribution label — a representative monthly figure when single-year,
  // else mark it as varying.
  const monthlyTotalDisplay = perYear.length === 1
    ? perYear[0].monthly
    : null;

  // Eyebrow summary
  const ySorted = [...i.years].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const yearRange = ySorted.length
    ? (ySorted.length === 1
        ? `FY ${ySorted[0].fiscalYear}, paid out around June ${ySorted[0].fiscalYear + 1}`
        : `FY ${ySorted[0].fiscalYear} → FY ${ySorted[ySorted.length - 1].fiscalYear}, paid in tranches at each June AGM`)
    : 'Add a fiscal year to start planning';

  // Distribution math — partial taxation (qualified holding ≥ 10%):
  // income tax = gross × (0.70 × federal marginal + 0.50 × cantonal marginal);
  // the 35% WHT is a timing effect only (refunded once declared).
  const effRate = _divEffectiveRate(i);
  const wht = grossPot * DIV_WHT();                         // withheld, refundable
  const netToShareholder = grossPot - wht;             // hits personal account
  const personalTax = grossPot * effRate;
  const netAfterTax = grossPot - personalTax;          // WHT refund credited
  const effEl = document.getElementById('div-eff-rate');
  if (effEl) effEl.textContent = `≈ ${(effRate * 100).toFixed(1)}%`;
  const taxLbl = document.getElementById('div-tax-label');
  if (taxLbl) taxLbl.textContent =
    `(70% × ${i.fedRatePct}% fed + 50% × ${i.cantRatePct}% ZH ≈ ${(effRate * 100).toFixed(1)}% of gross)`;

  const set = (id, v) => document.getElementById(id).textContent = v;

  // Hero number
  set('div-summary-eyebrow', yearRange);
  set('div-net-final', grossPot > 0 ? chf(netAfterTax) : 'CHF 0.00');
  document.getElementById('div-net-sub').textContent =
    grossPot > 0
      ? `net into your personal account once all dividends distribute (after WHT credit + income tax)`
      : 'set a monthly amount > 0 to see your projection';

  // Build-up table — total contribution months across all years
  const yearCount = i.years.length;
  set('div-months-out',
    yearCount > 0
      ? `${totalMonths} months (${yearCount} year${yearCount === 1 ? '' : 's'} × up to 12)`
      : '—');
  set('div-start-out',    chf(i.starting));
  set('div-contrib-total', chf(contributions));
  document.getElementById('div-contrib-label').textContent =
    totalMonths > 0 && monthlyTotalDisplay !== null
      ? `(${chf(monthlyTotalDisplay)} × ${totalMonths})`
      : (totalMonths > 0 ? `(varies by year — see matrix)` : '');
  set('div-gross-pot',    chf(grossPot));

  // Distribution table
  set('div-proposed-out',     chf(grossPot));
  set('div-wht',             `−${chf(wht)}`);
  set('div-net-shareholder',  chf(netToShareholder));
  set('div-personal-tax-amt',`−${chf(personalTax)}`);
  set('div-net-after-tax',    chf(netAfterTax));

  // Per-year breakdown — gross + WHT + personal tax + net + cumulative
  const peryearTbody = document.getElementById('div-peryear-tbody');
  const peryearTfoot = document.getElementById('div-peryear-tfoot');
  if (peryearTbody && peryearTfoot) {
    const sortedPerYear = [...perYear].sort((a, b) => a.fiscalYear - b.fiscalYear);
    if (!sortedPerYear.length || grossPot <= 0) {
      peryearTbody.innerHTML = '<tr><td colspan="7" class="empty-cell hint" style="padding:12px">Add a fiscal year + monthly amount to see the per-year breakdown.</td></tr>';
      peryearTfoot.innerHTML = '';
    } else {
      // The "starting pot" is unallocated across years — show it as a separate
      // virtual row before the year breakdown, so the cumulative column still
      // reconciles to the grand-total net at the bottom.
      const taxRate = effRate;
      let cumulative = 0;
      let rowsHtml = '';
      const startingNet = i.starting * (1 - taxRate);
      if (i.starting > 0) {
        cumulative = startingNet;
        rowsHtml += `<tr style="background:rgba(0,0,0,0.02)">
          <td><em>Starting pot</em></td>
          <td class="money">—</td>
          <td class="money">${chf(i.starting)}</td>
          <td class="money money--danger">−${chf(i.starting * DIV_WHT())}</td>
          <td class="money money--danger">−${chf(i.starting * taxRate)}</td>
          <td class="money" style="color:var(--ok-text);font-weight:600">${chf(startingNet)}</td>
          <td class="money">${chf(cumulative)}</td>
        </tr>`;
      }
      for (const y of sortedPerYear) {
        const wht = y.gross * DIV_WHT();
        const tax = y.gross * taxRate;
        const net = y.gross - tax;
        cumulative += net;
        rowsHtml += `<tr>
          <td><strong>FY ${y.fiscalYear}</strong> <span class="hint hint--sm">→ paid ~Jun ${y.fiscalYear + 1}</span></td>
          <td class="money">${y.months}</td>
          <td class="money">${chf(y.gross)}</td>
          <td class="money money--danger">−${chf(wht)}</td>
          <td class="money money--danger">−${chf(tax)}</td>
          <td class="money" style="color:var(--ok-text);font-weight:600">${chf(net)}</td>
          <td class="money"><strong>${chf(cumulative)}</strong></td>
        </tr>`;
      }
      peryearTbody.innerHTML = rowsHtml;
      // Footer = totals
      peryearTfoot.innerHTML = `<tr style="border-top:2px solid var(--border);font-weight:600;background:rgba(0,0,0,0.02)">
        <td>Total across all years</td>
        <td class="money">${totalMonths}</td>
        <td class="money">${chf(grossPot)}</td>
        <td class="money money--danger">−${chf(wht)}</td>
        <td class="money money--danger">−${chf(personalTax)}</td>
        <td class="money money--ok">${chf(netAfterTax)}</td>
        <td class="money money--ok">${chf(cumulative)}</td>
      </tr>`;
    }
  }

  // Bucket × Year matrix — net amount per bucket per year.
  const matrixThead = document.getElementById('div-matrix-thead');
  const matrixTbody = document.getElementById('div-matrix-tbody');
  const matrixTfoot = document.getElementById('div-matrix-tfoot');
  if (matrixThead && matrixTbody && matrixTfoot) {
    const sortedYears = [...perYear]
      .map((p, idx) => ({...p, originalIdx: idx}))
      .sort((a, b) => a.fiscalYear - b.fiscalYear);
    if (!sortedYears.length || !i.bucketNames.length || grossPot <= 0) {
      matrixThead.innerHTML = '';
      matrixTbody.innerHTML = '<tr><td class="empty-cell hint" style="padding:12px">Add at least one bucket + fiscal year with amounts.</td></tr>';
      matrixTfoot.innerHTML = '';
    } else {
      const taxFactor = 1 - effRate;
      // Header: Bucket | FY 2026 | FY 2027 | … | Total
      matrixThead.innerHTML = `<tr>
        <th style="text-align:left">Bucket</th>
        ${sortedYears.map(y => `<th class="text-right">FY ${y.fiscalYear}<div style="font-weight:400;color:var(--text-muted);font-size:10px">${y.months} mo</div></th>`).join('')}
        <th class="text-right" style="border-left:2px solid var(--border)">Total</th>
      </tr>`;
      // Body: one row per bucket
      const colTotals = sortedYears.map(() => 0);
      let grandTotal = 0;
      matrixTbody.innerHTML = i.bucketNames.map((name, bIdx) => {
        let rowTotal = 0;
        const cells = sortedYears.map((y, sIdx) => {
          const monthly = Number(i.years[y.originalIdx].amounts[bIdx]) || 0;
          const grossCell = monthly * y.months;
          const netCell = grossCell * taxFactor;
          colTotals[sIdx] += netCell;
          rowTotal += netCell;
          return `<td class="money"${netCell > 0 ? '' : ' style="color:var(--text-muted)"'}>${netCell > 0 ? chf(netCell) : '—'}</td>`;
        }).join('');
        grandTotal += rowTotal;
        return `<tr>
          <td><strong>${escapeHtml(name || '—')}</strong></td>
          ${cells}
          <td class="money" style="border-left:2px solid var(--border);color:var(--ok-text);font-weight:600">${chf(rowTotal)}</td>
        </tr>`;
      }).join('');
      // Footer: per-year totals + grand total
      matrixTfoot.innerHTML = `<tr style="border-top:2px solid var(--border);font-weight:600;background:rgba(0,0,0,0.02)">
        <td>Year total (net)</td>
        ${colTotals.map(v => `<td class="money money--ok">${chf(v)}</td>`).join('')}
        <td class="money" style="border-left:2px solid var(--border);color:var(--ok-text)">${chf(grandTotal)}</td>
      </tr>`;
    }
  }

  // Per-bucket allocation — sum each bucket across ALL years.
  // bucket.gross = Σ (year.amounts[bucketIdx] × year.months)
  const allocTbody = document.getElementById('div-alloc-tbody');
  if (allocTbody) {
    if (grossPot <= 0) {
      allocTbody.innerHTML = '<tr><td colspan="3" class="empty-cell hint" style="padding:12px">Add bucket amounts to see the allocation.</td></tr>';
    } else {
      const taxFactor = 1 - effRate;
      allocTbody.innerHTML = i.bucketNames.map((name, bIdx) => {
        const gross = i.years.reduce((s, y, yIdx) =>
          s + (Number(y.amounts[bIdx]) || 0) * perYear[yIdx].months, 0);
        const net = gross * taxFactor;
        return `<tr>
          <td><strong>${escapeHtml(name || '—')}</strong></td>
          <td class="money">${chf(gross)}</td>
          <td class="money money--ok">${chf(net)}</td>
        </tr>`;
      }).join('');
    }
  }

  // Warnings — sanity hints
  const warnEl = document.getElementById('div-warnings');
  const warnings = [];
  const thisYear = new Date().getFullYear();
  const closedYears = i.years.map(y => y.fiscalYear).filter(fy => fy < thisYear);
  if (closedYears.length > 0 && grossPot > 0) {
    warnings.push(`<div style="padding:10px 12px;background:rgba(59,130,246,0.10);border:1px solid var(--primary);border-radius:6px;color:var(--primary);font-size:13px">ℹ Closed fiscal year(s) included: ${closedYears.join(', ')}. Those slices are historical projections — actual figures should match what Treuhand recorded for the respective GVs.</div>`);
  }
  if (grossPot > 0 && warnings.length === 0) {
    warnings.push(`<div class="notice notice--ok">✓ Plan saved. Treuhand still needs to confirm the actual distributable profit at each GV time.</div>`);
  }
  warnEl.innerHTML = warnings.join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCS
// ══════════════════════════════════════════════════════════════════════════════

let _docsList = [];

async function loadDocs() {
  try {
    _docsList = await api('/docs');
  } catch (e) {
    document.getElementById('docs-list').innerHTML = `<div style="padding:12px;color:var(--danger-text)">Failed to load doc list: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const listEl = document.getElementById('docs-list');
  listEl.innerHTML = _docsList.map((d, i) => `
    <a href="#" class="doc-link" data-doc="${escapeHtml(d.name)}" onclick="event.preventDefault(); selectDoc('${escapeHtml(d.name)}')">
      <strong>${escapeHtml(d.title)}</strong>
      <div class="hint hint--sm" style="margin-top:2px">${escapeHtml(d.name)} · ${(d.size_bytes/1024).toFixed(1)} KB</div>
    </a>`).join('');

  // Auto-open the first doc (or last-viewed)
  const lastViewed = Prefs.get('docs.lastViewed');
  const initial = (_docsList.find(d => d.name === lastViewed) || _docsList[0]);
  if (initial) selectDoc(initial.name);
}

async function selectDoc(name) {
  Prefs.set('docs.lastViewed', name);
  document.querySelectorAll('.doc-link').forEach(a => {
    a.classList.toggle('active', a.dataset.doc === name);
  });
  const contentEl = document.getElementById('docs-content');
  contentEl.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const r = await api('/docs/' + encodeURIComponent(name));
    if (typeof marked === 'undefined') {
      // CDN unavailable — degrade gracefully to plain text
      contentEl.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:13px">${escapeHtml(r.content)}</pre>`;
      return;
    }
    contentEl.innerHTML = `<div class="markdown-body">${marked.parse(r.content)}</div>`;
  } catch (e) {
    contentEl.innerHTML = `<div style="color:var(--danger-text)">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST PROCEDURE (interactive)
// ══════════════════════════════════════════════════════════════════════════════

let _tpData = null;
let _tpFilter = 'all';   // all | pending | fail
let _tpSource = 'accounting';  // accounting | technical — set from Prefs on load
const _STATUSES = ['pass', 'fail', 'skip', ''];   // '' = untested

function _tpKey(tcId, stepNum)   { return `${tcId}::${stepNum}`; }
// Results are scoped per source so the same checkbox state doesn't bleed between
// the accounting checklist and the developer QA procedure.
function _tpResults()            { return Prefs.get(`tests.results.${_tpSource}`, {}) || {}; }
function _tpStatusOf(tcId, step) { return (_tpResults()[_tpKey(tcId, step)] || {}).status || ''; }
function _tpNotesOf(tcId, step)  { return (_tpResults()[_tpKey(tcId, step)] || {}).notes || ''; }

function _tpSaveResult(tcId, step, status, notes) {
  const all = _tpResults();
  const key = _tpKey(tcId, step);
  if (status === '' && !notes) {
    delete all[key];
  } else {
    all[key] = {status, notes, ts: Date.now()};
  }
  Prefs.set(`tests.results.${_tpSource}`, all);
}

async function loadTestProcedure() {
  _tpSource = Prefs.get('tests.source', 'accounting');
  const srcSel = document.getElementById('tp-source');
  if (srcSel) srcSel.value = _tpSource;

  const content = document.getElementById('test-procedure-content');
  content.innerHTML = '<div style="padding:16px;color:var(--text-muted)">Loading checklist…</div>';
  try {
    _tpData = await api('/test-procedure?source=' + encodeURIComponent(_tpSource));
  } catch (e) {
    content.innerHTML = `<div style="padding:16px;color:var(--danger-text)">Failed to load: ${escapeHtml(e.message)}</div>`;
    return;
  }
  setTestFilter(_tpFilter, true);
  renderTestProcedure();
}

function setTestSource(src) {
  _tpSource = src;
  Prefs.set('tests.source', src);
  loadTestProcedure();
}

function renderTestProcedure() {
  const content = document.getElementById('test-procedure-content');
  if (!_tpData) return;
  const results = _tpResults();

  let html = '';
  for (const section of _tpData.sections) {
    let sectionHtml = '';
    let sectionTestCount = 0;
    for (const tc of section.tests) {
      // Compute counts for this TC
      let tcPass = 0, tcFail = 0, tcSkip = 0;
      for (const step of tc.steps) {
        const s = (results[_tpKey(tc.id, step.num)] || {}).status;
        if (s === 'pass') tcPass++;
        else if (s === 'fail') tcFail++;
        else if (s === 'skip') tcSkip++;
      }
      const tcStatus = tcFail > 0 ? 'fail'
                     : tcPass === tc.steps.length && tc.steps.length > 0 ? 'pass'
                     : tcSkip > 0 && (tcPass + tcSkip === tc.steps.length) ? 'skip'
                     : 'pending';

      // Apply filter
      if (_tpFilter === 'pending' && tcStatus !== 'pending') continue;
      if (_tpFilter === 'fail'    && tcStatus !== 'fail')    continue;
      sectionTestCount++;

      const stepsHtml = tc.steps.map(step => _renderStep(tc.id, step, results)).join('');
      const meta = [];
      if (tc.priority) meta.push(`<span class="tc-priority tc-priority--${escapeHtml(tc.priority.toLowerCase())}">${escapeHtml(tc.priority)}</span>`);
      if (tc.type)     meta.push(`<span class="tc-type">${escapeHtml(tc.type)}</span>`);

      sectionHtml += `
        <details class="tc-card" id="tc-${escapeHtml(tc.id)}" data-status="${tcStatus}">
          <summary class="tc-summary">
            <span class="tc-status tc-status--${tcStatus}"></span>
            <span class="tc-id">${escapeHtml(tc.id)}</span>
            <span class="tc-title">${escapeHtml(tc.title)}</span>
            ${meta.join(' ')}
            <span class="tc-progress">${tcPass}/${tc.steps.length}</span>
          </summary>
          ${tc.preconditions ? `<div class="tc-preconds"><strong>Pre-conditions:</strong> ${escapeHtml(tc.preconditions)}</div>` : ''}
          <div class="tc-steps">${stepsHtml}</div>
        </details>`;
    }
    if (sectionTestCount === 0) continue;
    html += `<h2 class="tp-section">§${section.section_num} ${escapeHtml(section.section)}</h2>${sectionHtml}`;
  }
  content.innerHTML = html || '<div style="padding:24px;color:var(--text-muted);text-align:center">No test cases match the current filter.</div>';
  updateTestProgress();
}

function _renderStep(tcId, step, results) {
  const key = _tpKey(tcId, step.num);
  const status = (results[key] || {}).status || '';
  const notes = (results[key] || {}).notes || '';
  // Details: render markdown via marked if present, else nothing
  let details = '';
  if (step.details) {
    if (typeof marked !== 'undefined') {
      details = `<div class="tp-step-details markdown-body">${marked.parse(step.details)}</div>`;
    } else {
      details = `<pre class="tp-step-details" style="white-space:pre-wrap">${escapeHtml(step.details)}</pre>`;
    }
  }
  const expected = step.expected
    ? `<div class="tp-step-expected"><strong>Expected:</strong> ${escapeHtml(step.expected)}</div>`
    : '';
  return `
    <div class="tp-step" data-status="${status}">
      <div class="tp-step-num">${step.num}</div>
      <div class="tp-step-body">
        <div class="tp-step-text">${escapeHtml(step.text)}</div>
        ${details}
        ${expected}
        <div class="tp-step-controls">
          <button type="button" class="tp-btn tp-btn--pass ${status === 'pass' ? 'active' : ''}"
            onclick="setStepStatus('${escapeHtml(tcId)}', ${step.num}, 'pass')">✓ Pass</button>
          <button type="button" class="tp-btn tp-btn--fail ${status === 'fail' ? 'active' : ''}"
            onclick="setStepStatus('${escapeHtml(tcId)}', ${step.num}, 'fail')">✗ Fail</button>
          <button type="button" class="tp-btn tp-btn--skip ${status === 'skip' ? 'active' : ''}"
            onclick="setStepStatus('${escapeHtml(tcId)}', ${step.num}, 'skip')">Skip</button>
          <button type="button" class="tp-btn tp-btn--reset ${!status ? 'active' : ''}"
            onclick="setStepStatus('${escapeHtml(tcId)}', ${step.num}, '')">Reset</button>
          <input type="text" class="tp-notes" placeholder="Notes (optional)"
            value="${escapeHtml(notes)}"
            oninput="setStepNotes('${escapeHtml(tcId)}', ${step.num}, this.value)">
        </div>
      </div>
    </div>`;
}

function setStepStatus(tcId, stepNum, status) {
  const notes = _tpNotesOf(tcId, stepNum);
  _tpSaveResult(tcId, stepNum, status, notes);
  // Targeted DOM update + progress refresh — avoid full re-render so the open
  // details/scroll position stays put.
  const stepEl = document.querySelector(`#tc-${CSS.escape(tcId)} .tp-step:nth-child(${stepNum})`);
  if (stepEl) {
    stepEl.dataset.status = status;
    stepEl.querySelectorAll('.tp-btn').forEach(b => b.classList.remove('active'));
    const map = {pass: 'pass', fail: 'fail', skip: 'skip', '': 'reset'};
    const cls = `tp-btn--${map[status]}`;
    const btn = stepEl.querySelector(`.${cls}`);
    if (btn) btn.classList.add('active');
  }
  _updateTcProgress(tcId);
  updateTestProgress();
}

function setStepNotes(tcId, stepNum, notes) {
  const status = _tpStatusOf(tcId, stepNum);
  _tpSaveResult(tcId, stepNum, status, notes);
}

function _updateTcProgress(tcId) {
  const card = document.querySelector(`#tc-${CSS.escape(tcId)}`);
  if (!card) return;
  const tc = _tpData.sections.flatMap(s => s.tests).find(t => t.id === tcId);
  if (!tc) return;
  let pass = 0, fail = 0, skip = 0;
  for (const step of tc.steps) {
    const s = _tpStatusOf(tc.id, step.num);
    if (s === 'pass') pass++;
    else if (s === 'fail') fail++;
    else if (s === 'skip') skip++;
  }
  const status = fail > 0 ? 'fail'
               : pass === tc.steps.length && tc.steps.length > 0 ? 'pass'
               : skip > 0 && (pass + skip === tc.steps.length) ? 'skip'
               : 'pending';
  card.dataset.status = status;
  const dot = card.querySelector('.tc-status');
  if (dot) dot.className = `tc-status tc-status--${status}`;
  const prog = card.querySelector('.tc-progress');
  if (prog) prog.textContent = `${pass}/${tc.steps.length}`;
}

function updateTestProgress() {
  if (!_tpData) return;
  const results = _tpResults();
  let pass = 0, fail = 0, skip = 0, total = 0;
  for (const s of _tpData.sections) {
    for (const tc of s.tests) {
      for (const step of tc.steps) {
        total++;
        const status = (results[_tpKey(tc.id, step.num)] || {}).status;
        if (status === 'pass') pass++;
        else if (status === 'fail') fail++;
        else if (status === 'skip') skip++;
      }
    }
  }
  const pctP = total ? pass / total * 100 : 0;
  const pctF = total ? fail / total * 100 : 0;
  const pctS = total ? skip / total * 100 : 0;
  document.getElementById('test-progress-fill-pass').style.width = pctP.toFixed(1) + '%';
  const ff = document.getElementById('test-progress-fill-fail');
  ff.style.width = pctF.toFixed(1) + '%';
  ff.style.left  = pctP.toFixed(1) + '%';
  const fs = document.getElementById('test-progress-fill-skip');
  fs.style.width = pctS.toFixed(1) + '%';
  fs.style.left  = (pctP + pctF).toFixed(1) + '%';
  document.getElementById('test-progress-text').textContent =
    `${pass} pass · ${fail} fail · ${skip} skip · ${total - pass - fail - skip} pending · ${total} steps total`;
}

function setTestFilter(f, skipReRender) {
  _tpFilter = f;
  for (const id of ['all', 'pending', 'fail']) {
    const btn = document.getElementById('tf-' + id);
    if (btn) btn.classList.toggle('active', id === f);
  }
  if (!skipReRender) renderTestProcedure();
}

function exportTestResults() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    source:     _tpSource,
    filename:   _tpData && _tpData.filename,
    results:    _tpResults(),
  }, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${_tpSource}-checklist-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Results exported');
}

function resetTestResults() {
  const label = _tpSource === 'technical' ? 'developer test procedure' : 'accounting checklist';
  if (!confirm(`Clear ALL marked statuses and notes in the ${label}? This cannot be undone.`)) return;
  Prefs.set(`tests.results.${_tpSource}`, {});
  renderTestProcedure();
  toast('Results cleared');
}

// ══════════════════════════════════════════════════════════════════════════════
