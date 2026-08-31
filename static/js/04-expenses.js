// 04-expenses.js — PDF preview, expenses, customers, shared delete dialog
// Part of the Muster Consulting SPA. Classic script: everything is global;
// load order is defined in templates/index.html and matters only for the
// init calls at the end of 09-misc.js.
// ══════════════════════════════════════════════════════════════════════════════
// PDF PREVIEW
// ══════════════════════════════════════════════════════════════════════════════

function tokenUrl(url) {
  const token = localStorage.getItem('session_token');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'token=' + encodeURIComponent(token);
}

function previewPdf(url, title) {
  document.getElementById('pdf-modal-title').textContent = title || 'PDF Preview';
  const authedUrl = tokenUrl(url);
  // Build a download URL by appending download=true to the same endpoint.
  const sep = url.includes('?') ? '&' : '?';
  const downloadUrl = tokenUrl(url + sep + 'download=true');
  document.getElementById('pdf-modal-download').href = downloadUrl;
  document.getElementById('pdf-modal-newtab').href = authedUrl;
  document.getElementById('pdf-modal-iframe').src = authedUrl;
  document.getElementById('pdf-modal').classList.add('show');
}

function closePdfModal() {
  document.getElementById('pdf-modal').classList.remove('show');
  document.getElementById('pdf-modal-iframe').src = 'about:blank';
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════════════════════════════

async function loadExpenseYears() {
  try {
    const years = await api('/expenses/years');
    const sel = document.getElementById('expense-year-filter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All</option>' +
      years.map(y => `<option value="${y}"${y===cur?' selected':''}>${y}</option>`).join('');
  } catch {}
}

let allExpenses = [];
let expSortKey = 'expense_date';
let expSortAsc = true;
let selectedExpenseIds = new Set();

async function loadExpenses() {
  try {
    allExpenses = await api('/expenses');
    selectedExpenseIds.clear();
    updateBulkBar();
    persistFilter('expenses', ['expense-year-filter', 'expense-cat-filter', 'expense-search']);
    applyExpenseFilters();
  } catch (e) { toast(e.message, 'error'); }
}

function applyExpenseFilters() {
  const year = document.getElementById('expense-year-filter').value;
  const cat = document.getElementById('expense-cat-filter').value;
  const tripSel = document.getElementById('expense-trip-filter');
  const trip = tripSel ? tripSel.value : '';
  const search = document.getElementById('expense-search').value.toLowerCase().trim();

  let filtered = allExpenses;
  if (year) filtered = filtered.filter(e => e.expense_date.substring(0,4) === year);
  if (cat) filtered = filtered.filter(e => e.category === cat);
  if (trip === '__none__') filtered = filtered.filter(e => !e.trip_id);
  else if (trip) filtered = filtered.filter(e => String(e.trip_id) === trip);
  if (search) filtered = filtered.filter(e => e.description.toLowerCase().includes(search));

  // Sort
  filtered.sort((a, b) => {
    let va = a[expSortKey], vb = b[expSortKey];
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return expSortAsc ? -1 : 1;
    if (va > vb) return expSortAsc ? 1 : -1;
    return 0;
  });

  // Update sort indicators
  ['expense_date','description','category','amount'].forEach(k => {
    const el = document.getElementById('sort-' + k);
    if (el) el.textContent = expSortKey === k ? (expSortAsc ? '\u25B2' : '\u25BC') : '';
  });

  renderExpenses(filtered);
}

function sortExpenses(key) {
  if (expSortKey === key) expSortAsc = !expSortAsc;
  else { expSortKey = key; expSortAsc = true; }
  applyExpenseFilters();
}

function renderExpenses(expenses) {
  const tbody = document.getElementById('expenses-tbody');
  const totalEl = document.getElementById('expense-total');

  if (!expenses.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No expenses found</td></tr>';
    totalEl.textContent = '';
    return;
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const year = document.getElementById('expense-year-filter').value;
  const cat = document.getElementById('expense-cat-filter').value;
  const search = document.getElementById('expense-search').value.trim();
  let label = `${expenses.length} receipt${expenses.length !== 1 ? 's' : ''}`;
  const filters = [];
  if (year) filters.push(year);
  if (cat) filters.push(cat);
  if (search) filters.push(`"${search}"`);
  if (filters.length) label += ` (${filters.join(', ')})`;
  totalEl.textContent = `${label} = ${chf(total)}`;

  tbody.innerHTML = expenses.map(exp => `
    <tr>
      <td><input type="checkbox" class="row-check" data-id="${exp.id}" ${selectedExpenseIds.has(exp.id) ? 'checked' : ''} onchange="toggleExpenseSelect(${exp.id}, this.checked)"></td>
      <td>${exp.expense_date}</td>
      <td>${exp.description}</td>
      <td><span class="${badgeClass(exp.category)}">${exp.category}</span></td>
      <td class="money">${exp.amount.toLocaleString('de-CH', {minimumFractionDigits:2})}</td>
      <td>${exp.has_scan ? (exp.scan_type === 'pdf'
        ? `<button class="btn btn--ghost btn--icon" onclick="previewPdf('/api/expenses/${exp.id}/scan', 'Receipt')" title="View PDF" style="font-size:20px">&#128196;</button>`
        : `<img src="${tokenUrl('/api/expenses/' + exp.id + '/scan')}" class="scan-thumb" onclick="showScan(${exp.id})">`)
        : '-'}</td>
      <td class="text-right">
        <div class="actions">
          <button class="btn btn--ghost btn--icon" onclick="editExpense(${exp.id})" title="Edit">&#9998;</button>
          <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="confirmDelete(${exp.id}, null, 'expense')" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Update select-all state
  const allCheck = document.getElementById('select-all-expenses');
  if (allCheck) allCheck.checked = expenses.length > 0 && expenses.every(e => selectedExpenseIds.has(e.id));
}

// ── Bulk selection ──

function toggleExpenseSelect(id, checked) {
  if (checked) selectedExpenseIds.add(id);
  else selectedExpenseIds.delete(id);
  updateBulkBar();
}

function toggleSelectAll(checkbox) {
  const visible = document.querySelectorAll('#expenses-tbody input.row-check');
  visible.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    if (checkbox.checked) selectedExpenseIds.add(id);
    else selectedExpenseIds.delete(id);
    cb.checked = checkbox.checked;
  });
  updateBulkBar();
}

function clearSelection() {
  selectedExpenseIds.clear();
  document.getElementById('select-all-expenses').checked = false;
  updateBulkBar();
  applyExpenseFilters();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const count = selectedExpenseIds.size;
  document.getElementById('bulk-count').textContent = count;
  if (count > 0) bar.classList.add('show');
  else bar.classList.remove('show');
}

async function bulkRecategorize() {
  const cat = document.getElementById('bulk-category').value;
  if (!cat) { toast('Select a category', 'error'); return; }
  if (!selectedExpenseIds.size) return;

  try {
    await api('/expenses/bulk/recategorize', {
      method: 'POST',
      body: JSON.stringify({ids: [...selectedExpenseIds], category: cat}),
    });
    toast(`${selectedExpenseIds.size} expenses re-categorized to ${cat}`);
    selectedExpenseIds.clear();
    document.getElementById('bulk-category').value = '';
    updateBulkBar();
    loadExpenses();
  } catch (e) { toast(e.message, 'error'); }
}

function bulkDelete() {
  if (!selectedExpenseIds.size) return;
  document.getElementById('bulk-delete-msg').textContent =
    `Delete ${selectedExpenseIds.size} selected expense${selectedExpenseIds.size > 1 ? 's' : ''}? This cannot be undone.`;
  document.getElementById('bulk-delete-modal').classList.add('show');
}

async function executeBulkDelete() {
  document.getElementById('bulk-delete-modal').classList.remove('show');
  try {
    await api('/expenses/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ids: [...selectedExpenseIds]}),
    });
    toast(`${selectedExpenseIds.size} expenses deleted`);
    selectedExpenseIds.clear();
    updateBulkBar();
    loadExpenses();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadExpenseReports() {
  try {
    const reports = await api('/expenses/reports');
    const tbody = document.getElementById('reports-tbody');
    if (!reports.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No reports generated yet</td></tr>';
      return;
    }
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    tbody.innerHTML = reports.map(r => {
      const period = r.month ? `${MONTH_NAMES[r.month - 1]} ${r.year}` : `${r.year}`;
      const monthQ = r.month ? `&month=${r.month}` : '';
      const previewUrl = `/api/expenses/report/${r.year}/pdf${r.month ? `?month=${r.month}` : ''}`;
      const downloadUrl = tokenUrl(`/api/expenses/report/${r.year}/pdf?download=true${monthQ}`);
      const excelUrl = r.month
        ? tokenUrl(`/api/expenses/report/${r.year}/excel?month=${r.month}`)
        : tokenUrl(`/api/expenses/report/${r.year}/excel`);
      return `
      <tr>
        <td class="mono">#${pad4(r.report_number)}</td>
        <td>${period}</td>
        <td>${r.expense_count}</td>
        <td class="money">${chf(r.total_chf)}</td>
        <td class="text-right">${r.created_at.split(' ')[0]}</td>
        <td class="text-right">
          <div class="actions">
            <button class="btn btn--ghost btn--icon" onclick="previewPdf('${previewUrl}', 'Expenses ${period}')" title="Preview PDF">&#128196;</button>
            <a href="${downloadUrl}" class="btn btn--ghost btn--icon" title="Download PDF" download>&#11015;</a>
            <a href="${excelUrl}" class="btn btn--ghost btn--icon" title="Download Excel" download>&#128190;</a>
            <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="confirmDelete(${r.id}, ${r.report_number}, 'report')" title="Delete">&#128465;</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) { console.error('loadExpenseReports failed', e); }
}

// Expense form

function clearExpenseForm() {
  document.getElementById('exp-edit-id').value = '';
  document.getElementById('expense-form').reset();
  document.getElementById('exp-form-title').textContent = 'Add Expense';
  document.getElementById('exp-submit-btn').textContent = 'Save Expense';
}

async function handleExpenseSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('exp-edit-id').value;
  const fd = new FormData();
  fd.append('expense_date', document.getElementById('exp-date').value);
  fd.append('description', document.getElementById('exp-desc').value);
  fd.append('amount', document.getElementById('exp-amount').value);
  fd.append('category', document.getElementById('exp-cat').value);
  const tripSel = document.getElementById('exp-trip');
  const tripId = tripSel ? tripSel.value : '';
  const scanFile = document.getElementById('exp-scan').files[0];
  if (scanFile) fd.append('scan', scanFile);

  try {
    let expenseId = editId;
    if (editId) {
      await fetch(`/api/expenses/${editId}`, { method: 'PUT', body: fd, headers: authHeaders() });
      toast('Expense updated');
    } else {
      const res = await fetch('/api/expenses', { method: 'POST', body: fd, headers: authHeaders() });
      const data = await res.json();
      expenseId = data.id;
      toast('Expense saved');
    }
    // Trip assignment is a separate call (the expense schema accepts trip via
    // a dedicated endpoint so we don't have to rewire every PUT/POST form)
    if (expenseId) {
      const tripFd = new FormData();
      if (tripId) tripFd.append('trip_id', tripId);
      await fetch(`/api/expenses/${expenseId}/assign-trip`, { method: 'POST', body: tripFd, headers: authHeaders() });
    }
    clearExpenseForm();
    navigateTo('expenses');
  } catch (e) { toast(e.message, 'error'); }
}

async function editExpense(id) {
  try {
    const exp = await api(`/expenses/${id}`);
    // Refresh trip dropdown so it has the current list before we set value
    try { await loadTrips({forForm:true}); } catch {}
    document.getElementById('exp-edit-id').value = id;
    document.getElementById('exp-date').value = exp.expense_date;
    document.getElementById('exp-desc').value = exp.description;
    document.getElementById('exp-amount').value = exp.amount;
    document.getElementById('exp-cat').value = exp.category;
    // Look up trip from the list response (trip_id is on /expenses but not /expenses/:id)
    const all = allExpenses || [];
    const row = all.find(e => e.id === id);
    const tripSel = document.getElementById('exp-trip');
    if (tripSel) tripSel.value = (row && row.trip_id) ? String(row.trip_id) : '';
    document.getElementById('exp-form-title').textContent = 'Edit Expense';
    document.getElementById('exp-submit-btn').textContent = 'Update Expense';
    navigateTo('expense-form');
  } catch (e) { toast(e.message, 'error'); }
}

function showScan(id) {
  document.getElementById('scan-modal-img').src = tokenUrl(`/api/expenses/${id}/scan`);
  document.getElementById('scan-modal').classList.add('show');
}

function downloadExcel() {
  const year = document.getElementById('expense-year-filter').value;
  if (!year) { toast('Select a year first', 'error'); return; }
  const monthSel = document.getElementById('report-month-picker');
  const month = monthSel ? monthSel.value : '';
  const q = month ? `?month=${month}` : '';
  window.location.href = tokenUrl(`/api/expenses/report/${year}/excel${q}`);
}

async function generateReport() {
  const year = document.getElementById('expense-year-filter').value;
  if (!year) { toast('Select a year first', 'error'); return; }
  const monthSel = document.getElementById('report-month-picker');
  const month = monthSel ? monthSel.value : '';
  const monthQ = month ? `?month=${month}` : '';
  const period = month ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]} ${year}` : year;
  try {
    const r = await api(`/expenses/report/${year}${monthQ}`, { method: 'POST' });
    toast(`Report #${pad4(r.report_number)} (${period}) generated - ${chf(r.total)}`);
    await loadExpenseReports();
    // Trigger download via hidden anchor so the page stays put and pending
    // requests aren't cancelled by a top-level navigation.
    const dlQ = month ? `?download=true&month=${month}` : '?download=true';
    const a = document.createElement('a');
    a.href = tokenUrl(`/api/expenses/report/${year}/pdf${dlQ}`);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ══════════════════════════════════════════════════════════════════════════════

async function loadCustomers() {
  try {
    const custs = await api('/customers');
    const tbody = document.getElementById('customers-tbody');
    if (!custs.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:0;border:none">${emptyState('&#9673;', 'No customers yet', 'Add a customer to start invoicing.', '+ Add Customer', () => { clearCustomerForm(); document.getElementById('cust-dialog').classList.add('show'); })}</td></tr>`;
      return;
    }
    tbody.innerHTML = custs.map(c => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${[c.address, c.city, c.country].filter(Boolean).join(', ')}</td>
        <td>${c.email || '-'}</td>
        <td class="mono" style="font-size:12px">${c.reference || '-'}</td>
        <td class="text-right">
          <div class="actions">
            <button class="btn btn--ghost btn--icon" onclick="editCustomer(${c.id})" title="Edit">&#9998;</button>
            <button class="btn btn--ghost btn--icon btn--icon-danger" onclick="confirmDelete(${c.id}, null, 'customer', '${c.name.replace(/'/g, "\\'")}')" title="Delete">&#128465;</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function loadCustomerDropdown() {
  try {
    const custs = await api('/customers');
    const sel = document.getElementById('f-customer');
    sel.innerHTML = custs.map(c =>
      `<option value="${c.id}">${c.name}</option>`
    ).join('');
  } catch {}
}

function clearCustomerForm() {
  document.getElementById('cust-edit-id').value = '';
  document.getElementById('customer-form').reset();
  document.getElementById('cust-country').value = 'Switzerland';
  document.getElementById('cust-dialog-title').textContent = 'Add Customer';
  document.getElementById('cust-submit-btn').textContent = 'Save';
}

async function handleCustomerSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('cust-edit-id').value;
  const data = {
    name: document.getElementById('cust-name').value,
    address: document.getElementById('cust-address').value,
    city: document.getElementById('cust-city').value,
    country: document.getElementById('cust-country').value,
    email: document.getElementById('cust-email').value,
    reference: document.getElementById('cust-ref').value,
  };
  try {
    if (editId) {
      await api(`/customers/${editId}`, { method: 'PUT', body: JSON.stringify(data) });
      toast('Customer updated');
    } else {
      await api('/customers', { method: 'POST', body: JSON.stringify(data) });
      toast('Customer created');
    }
    document.getElementById('cust-dialog').classList.remove('show');
    loadCustomers();
    loadCustomerDropdown();
  } catch (e) { toast(e.message, 'error'); }
}

async function editCustomer(id) {
  try {
    const c = await api(`/customers/${id}`);
    document.getElementById('cust-edit-id').value = id;
    document.getElementById('cust-name').value = c.name;
    document.getElementById('cust-address').value = c.address || '';
    document.getElementById('cust-city').value = c.city || '';
    document.getElementById('cust-country').value = c.country || '';
    document.getElementById('cust-email').value = c.email || '';
    document.getElementById('cust-ref').value = c.reference || '';
    document.getElementById('cust-dialog-title').textContent = 'Edit Customer';
    document.getElementById('cust-submit-btn').textContent = 'Update';
    document.getElementById('cust-dialog').classList.add('show');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Folder Import ──

function showImportModal() {
  document.getElementById('import-progress').style.display = 'none';
  document.getElementById('import-results').style.display = 'none';
  document.getElementById('import-start-btn').disabled = false;
  document.getElementById('import-start-btn').textContent = 'Scan & Import';
  document.getElementById('import-modal').classList.add('show');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.remove('show');
}

async function startImport() {
  const folderPath = document.getElementById('import-path').value.trim();
  if (!folderPath) { toast('Enter a folder path', 'error'); return; }

  const btn = document.getElementById('import-start-btn');
  btn.disabled = true;
  btn.textContent = 'Importing...';
  document.getElementById('import-progress').style.display = 'block';
  document.getElementById('import-results').style.display = 'none';
  document.getElementById('import-status').textContent = 'Analyzing receipts with AI vision...';

  try {
    const res = await api('/expenses/import-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    });

    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-results').style.display = 'block';

    const tbody = document.getElementById('import-results-tbody');
    tbody.innerHTML = res.results.map(r => `
      <tr>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.file}">${r.file}</td>
        <td>${r.status === 'ok' ? r.date : '-'}</td>
        <td>${r.status === 'ok' ? r.description : `<span style="color:var(--danger-text)">${r.error || 'Failed'}</span>`}</td>
        <td class="text-right">${r.status === 'ok' ? r.amount.toFixed(2) : '-'}</td>
        <td>${r.status === 'ok'
          ? (r.duplicate ? '<span style="color:var(--warn-text)">DUP</span>' : '<span style="color:var(--ok-text)">OK</span>')
          : '<span style="color:var(--danger-text)">ERR</span>'}</td>
      </tr>
    `).join('');

    const dupes = res.duplicates || 0;
    btn.textContent = `Done (${res.imported}/${res.total}${dupes ? ', ' + dupes + ' skipped' : ''})`;
    toast(`Imported ${res.imported} of ${res.total} receipts${dupes ? ` (${dupes} duplicates skipped)` : ''}`);
    loadExpenses();
    loadExpenseYears();
  } catch (e) {
    document.getElementById('import-progress').style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Scan & Import';
    toast(e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED DELETE (modal-based)
// ══════════════════════════════════════════════════════════════════════════════

let deleteTarget = { id: null, type: null };

function confirmDelete(id, num, type, name) {
  deleteTarget = { id, type };
  let label;
  if (type === 'invoice') label = `invoice #${pad4(num)}`;
  else if (type === 'report') label = `expense report #${pad4(num)}`;
  else if (type === 'customer') label = `customer "${name}"`;
  else if (type === 'accounting') label = 'this document';
  else label = 'this expense';
  document.getElementById('delete-msg').textContent = `Delete ${label}? This cannot be undone.`;
  document.getElementById('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.remove('show');
  deleteTarget = { id: null, type: null };
}

document.getElementById('delete-confirm-btn').addEventListener('click', async () => {
  if (!deleteTarget.id) return;
  const { id, type } = deleteTarget;
  try {
    let endpoint;
    if (type === 'invoice') endpoint = `/invoices/${id}`;
    else if (type === 'report') endpoint = `/expenses/reports/${id}`;
    else if (type === 'customer') endpoint = `/customers/${id}`;
    else if (type === 'accounting') endpoint = `/accounting/${id}`;
    else endpoint = `/expenses/${id}`;
    await api(endpoint, { method: 'DELETE' });
    toast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted`);
    closeDeleteModal();
    if (type === 'invoice') { loadInvoices(); loadDashboard(); }
    else if (type === 'report') { loadExpenseReports(); }
    else if (type === 'customer') { loadCustomers(); loadCustomerDropdown(); }
    else if (type === 'accounting') { loadAccountingDocs(); }
    else { loadExpenses(); }
  } catch (e) { toast(e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════════════════════
