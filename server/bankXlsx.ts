// Port of routes/bank_export.py — multi-sheet Excel export for one bank
// statement (or id 0 = full history), with the same server-side
// classification the UI shows: salary detection against the owner ledger,
// reimbursement matching, personal-card recap, Kontokorrent residual.
import ExcelJS from "exceljs";
import { db, round2 } from "./db";
import { listTransactions } from "./bankTx";
import { rowToSettings, computePayslip } from "./payroll";

const fmtM = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseD = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.slice(0, 10));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};
const DAY = 86400000;

function mergeAllStatements(): { data: any; stmt: any } | { error: string } {
  const stmts: any[] = db().prepare(
    "SELECT * FROM bank_statements WHERE statement_file_xml IS NOT NULL ORDER BY period_start").all();
  if (!stmts.length) return { error: "No machine-readable statements to export" };
  const merged: any[] = [];
  for (const st of stmts) {
    const d = listTransactions(st.id);
    if (!("error" in d) && !("notFound" in d)) merged.push(...(d.transactions ?? []));
  }
  merged.sort((a, b) => ((b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : 0));
  let totalIn = 0, totalOut = 0;
  for (const tx of merged) {
    const rows = tx.sub_entries?.length ? tx.sub_entries : [tx];
    for (const t of rows) {
      const amt = Number(t.amount || 0);
      if (amt > 0) totalIn += amt; else if (amt < 0) totalOut += amt;
    }
  }
  const first = stmts[0], last = stmts[stmts.length - 1];
  return {
    data: {
      period_start: first.period_start, period_end: last.period_end,
      currency: last.currency || "CHF",
      total_in: round2(totalIn), total_out: round2(totalOut), net: round2(totalIn + totalOut),
      transactions: merged,
    },
    stmt: {
      bank: last.bank || "UBS", account_label: last.account_label || "", iban: last.iban || "",
      period_start: first.period_start, period_end: last.period_end,
      opening_balance: first.opening_balance, closing_balance: last.closing_balance,
      notes: `Full history — ${stmts.length} statements combined`,
    },
  };
}

function salaryMonthLabel(dateStr: string): string {
  const t = parseD(dateStr);
  if (t == null) return "Salary";
  const d = new Date(t);
  let m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  if (d.getUTCDate() <= 7) {
    if (m > 1) m -= 1; else { m = 12; y -= 1; }
  }
  return `Salary ${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
}

export async function buildBankXlsx(id: number, quarter: number | null, yearIn: number | null):
  Promise<{ buf: Buffer; filename: string } | { error: string; status: number }> {
  let data: any, stmtD: any;
  if (id === 0) {
    const m = mergeAllStatements();
    if ("error" in m) return { error: m.error, status: 400 };
    data = m.data; stmtD = m.stmt;
  } else {
    const d = listTransactions(id);
    if ("notFound" in d) return { error: "Statement not found", status: 404 };
    if ("error" in d) return { error: d.error, status: 400 };
    data = d;
    const stmt = db().prepare("SELECT * FROM bank_statements WHERE id=?").get(id);
    if (!stmt) return { error: "Statement not found", status: 404 };
    stmtD = stmt;
  }
  let txs: any[] = data.transactions ?? [];
  const allTxs = txs;    // account-side detection uses the FULL statement
  const currency = data.currency || "CHF";
  let year = yearIn;

  // ── Optional quarter filter ──
  let periodLabelSuffix = "";
  let quarterStart: string | null = null, quarterEnd: string | null = null;
  if (quarter && [1, 2, 3, 4].includes(quarter)) {
    if (!year) {
      const ps = data.period_start || "";
      year = /^\d{4}/.test(ps) ? Number(ps.slice(0, 4)) : new Date().getFullYear();
    }
    const qFirst = 3 * (quarter - 1) + 1;
    const lastDay = new Date(Date.UTC(year, qFirst + 2, 0)).getUTCDate();
    quarterStart = `${year}-${String(qFirst).padStart(2, "0")}-01`;
    quarterEnd = `${year}-${String(qFirst + 2).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const inRange = (s: string | null | undefined) => !!s && quarterStart! <= s.slice(0, 10) && s.slice(0, 10) <= quarterEnd!;
    const filtered: any[] = [];
    for (const tx of txs) {
      const keepTx = inRange(tx.date);
      const keptSubs = (tx.sub_entries ?? []).filter((s: any) => inRange(s.date || tx.date));
      if (keepTx || keptSubs.length) {
        const tx2 = { ...tx };
        if (!keepTx) tx2.amount = 0;   // parent out of range, subs survive
        tx2.sub_entries = tx.sub_entries?.length ? keptSubs : [];
        filtered.push(tx2);
      }
    }
    txs = filtered;
    let tIn = 0, tOut = 0;
    for (const tx of txs) {
      const rows = tx.sub_entries?.length ? tx.sub_entries : [tx];
      for (const t of rows) {
        const amt = Number(t.amount || 0);
        if (amt > 0) tIn += amt; else if (amt < 0) tOut += amt;
      }
    }
    data = { ...data, total_in: round2(tIn), total_out: round2(tOut), net: round2(tIn + tOut),
      period_start: quarterStart, period_end: quarterEnd };
    periodLabelSuffix = ` — Q${quarter} ${year}`;
  }

  // ── DB context ──
  const reports: any[] = db().prepare(
    "SELECT id, report_number, year, month, total, expense_count, created_at FROM expense_reports ORDER BY report_number").all();
  const payrollRow: any = db().prepare("SELECT * FROM payroll_settings ORDER BY id DESC LIMIT 1").get();
  const effStart = quarterStart || stmtD.period_start || "0000-01-01";
  const effEnd = quarterEnd || stmtD.period_end || "9999-12-31";
  const personalCardRows: any[] = db().prepare(
    `SELECT doc_date, vendor, description, category, amount, currency, status, doc_file, reimbursed_at
     FROM company_docs WHERE paid_via='personal' AND doc_date >= ? AND doc_date <= ? ORDER BY doc_date`
  ).all(effStart, effEnd);
  const reimbTransfers: any[] = db().prepare(
    `SELECT transfer_date, amount FROM account_transfers
     WHERE direction='gmbh_to_personal' AND description LIKE 'Personal-card reimbursement%'`).all();
  const ownerInTransfers: any[] = db().prepare(
    "SELECT transfer_date, amount FROM account_transfers WHERE direction='personal_to_gmbh'").all();
  const personalCardTotal = round2(personalCardRows
    .filter(pc => !pc.reimbursed_at || pc.reimbursed_at > effEnd)
    .reduce((s, pc) => s + Number(pc.amount || 0), 0));
  const erRows: any[] = db().prepare(
    `SELECT report_number, total, created_at, reimbursed_at FROM expense_reports
     WHERE substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?`).all(effStart, effEnd);
  const expenseReportsTotal = round2(erRows
    .filter(r => !r.reimbursed_at || (r.reimbursed_at !== "legacy" && r.reimbursed_at > effEnd))
    .reduce((s, r) => s + Number(r.total || 0), 0));

  // ── Classification helpers ──
  let monthlyNet = 0, employeeName = "", employerName = "muster consulting", payDay = 25;
  if (payrollRow) {
    const settings = rowToSettings(payrollRow);
    monthlyNet = Number(computePayslip(settings).net_salary || 0);
    employeeName = String(settings.employee_name || "").trim().toLowerCase();
    employerName = String(settings.employer_name || "Muster Consulting").trim().toLowerCase();
    payDay = Number(settings.payment_day || 25);
  }
  const empTokens = employeeName.split(/\s+/).filter(t => t.length >= 4);
  const firstEmpToken = empTokens[0] ?? "";

  const matchesEmployee = (cp: string): boolean => {
    if (!empTokens.length) return false;
    const c = (cp || "").toLowerCase();
    if (firstEmpToken && !c.includes(firstEmpToken)) return false;
    return empTokens.filter(t => c.includes(t)).length >= 2;
  };
  const matchesRelative = (cp: string): boolean => {
    // Shares ≥2 name tokens but lacks the first name → likely a family member.
    if (!empTokens.length || !firstEmpToken) return false;
    const c = (cp || "").toLowerCase();
    if (c.includes(firstEmpToken)) return false;
    return empTokens.filter(t => c.includes(t)).length >= 2;
  };
  const matchesEmployer = (cp: string): boolean =>
    !!employerName && (cp || "").toLowerCase().includes(employerName);

  const PAYROLL_PATS = [
    /\b(salaire|salary|salaer|lohn|gehalt|wage|paie|payroll)/,
    /\b(quellensteuer|source.?tax|withhold|imp[oô]t.{0,8}source)/,
    /\b(ahv|avs|alv|aho|apg|caf|cas)\b/,
    /\b(bvg|lpp|pension|retirement|pr[eé]voyance|pilier|s[aä]ule)/,
    /\b(uvg|laa|suva|krankentag)/,
    /\b(3a|pillar.?3|pilier.?3|s[aä]ule.?3)\b/,
    /\b(vat|tva|mwst|iva)\b/,
  ];
  const isRoutinePayroll = (tx: any): boolean => {
    const hay = `${tx.counterparty || ""} ${tx.description || ""}`.toLowerCase();
    return PAYROLL_PATS.some(p => p.test(hay));
  };

  // Account side from the FULL statement
  const empHits = allTxs.filter(tx => matchesEmployee(tx.counterparty || "")).length;
  const emprHits = allTxs.filter(tx => matchesEmployer(tx.counterparty || "")).length;
  const accountSide = empHits > emprHits ? "gmbh" : "personal";

  // Salary candidates: settings net + per-day GmbH→Personal sums on ledger
  // dates that carry a 'Net salary' transfer (retro-splits stay matchable).
  const salDates: string[] = (db().prepare(
    "SELECT DISTINCT transfer_date FROM account_transfers WHERE description LIKE 'Net salary%'").all() as any[])
    .map(r => r.transfer_date);
  const salaryCandidates: [string | null, number, number][] = [];
  for (const dstr of salDates) {
    const tot = (db().prepare(
      "SELECT COALESCE(SUM(amount),0) t FROM account_transfers WHERE transfer_date=? AND direction='gmbh_to_personal'"
    ).get(dstr) as any).t;
    const sal = (db().prepare(
      "SELECT COALESCE(SUM(amount),0) t FROM account_transfers WHERE transfer_date=? AND direction='gmbh_to_personal' AND description LIKE 'Net salary%'"
    ).get(dstr) as any).t;
    salaryCandidates.push([dstr, round2(Number(tot)), round2(Number(sal))]);
  }
  if (monthlyNet) salaryCandidates.push([null, round2(monthlyNet), round2(monthlyNet)]);

  const salaryCandidateFor = (tx: any): [number, number] | null => {
    const amt = Math.abs(Number(tx.amount || 0));
    const d = parseD(tx.date);
    if (d == null) return null;
    for (const [ledDate, total, sal] of salaryCandidates) {
      if (Math.abs(amt - total) > Math.max(100, total * 0.10)) continue;
      if (ledDate) {
        const ld = parseD(ledDate);
        if (ld != null && Math.abs(d - ld) <= 7 * DAY) return [total, sal];
      } else {
        const dayDiff = Math.abs(new Date(d).getUTCDate() - payDay);
        if (dayDiff <= 7 || dayDiff >= 23) return [total, sal];
      }
    }
    return null;
  };

  // Reimbursement matching (positive inflows, exact amount, after report creation)
  const usedReports = new Set<number>();
  const reimMatches: { tx: any; report: any }[] = [];
  const flatInflows: any[] = [];
  for (const tx of txs) {
    if (Number(tx.amount || 0) > 0 && !(tx.sub_entries?.length)) flatInflows.push(tx);
    for (const sub of tx.sub_entries ?? []) {
      if (Number(sub.amount || 0) > 0)
        flatInflows.push({ ...sub, date: tx.date, transaction_no: tx.transaction_no });
    }
  }
  for (const tx of flatInflows) {
    const txD = parseD(tx.date);
    for (const r of reports) {
      if (usedReports.has(r.id)) continue;
      if (Math.abs(Number(r.total || 0) - Number(tx.amount || 0)) > 0.05) continue;
      const created = parseD((r.created_at || "").slice(0, 10));
      if (created != null && txD != null && created > txD) continue;
      usedReports.add(r.id);
      reimMatches.push({ tx, report: r });
      break;
    }
  }

  const sig = (tx: any) =>
    `${tx.date || ""}|${Number(tx.amount || 0).toFixed(2)}|${String(tx.counterparty || "").toLowerCase().trim()}`;
  const reimLabels = new Map<string, string>();
  for (const m of reimMatches) {
    const r = m.report;
    const period = `${r.year}` + (r.month ? `-${String(r.month).padStart(2, "0")}` : "");
    reimLabels.set(sig(m.tx), `Reimbursement (report #${r.report_number}, ${period}, ${r.expense_count} receipts)`);
  }

  const isPcReimbursement = (tx: any): boolean => {
    const amt = Math.abs(Number(tx.amount || 0));
    const d = parseD(tx.date);
    if (d == null) return false;
    return reimbTransfers.some(t => {
      const td = parseD(t.transfer_date);
      return td != null && Math.abs(Number(t.amount) - amt) <= 0.05 && Math.abs(d - td) <= 10 * DAY;
    });
  };

  const ownerInConsumed = new Set<number>();
  const isOwnerContribution = (tx: any): boolean => {
    if (reimLabels.has(sig(tx))) return false;
    const amt = Number(tx.amount || 0);
    const d = parseD(tx.date);
    if (amt <= 0 || d == null) return false;
    for (let i = 0; i < ownerInTransfers.length; i++) {
      if (ownerInConsumed.has(i)) continue;
      const td = parseD(ownerInTransfers[i].transfer_date);
      if (td != null && Math.abs(Number(ownerInTransfers[i].amount) - amt) <= 0.05 && Math.abs(d - td) <= 10 * DAY) {
        ownerInConsumed.add(i);
        return true;
      }
    }
    return false;
  };

  const salarySigs = new Set<string>(), pcReimbSigs = new Set<string>();
  let nonSalaryPaid = 0, salaryPaid = 0;
  for (const tx of txs) {
    if (matchesEmployee(tx.counterparty || "")) {
      const cand = salaryCandidateFor(tx);
      if (cand) {
        salarySigs.add(sig(tx));
        const amt = Math.abs(Number(tx.amount || 0));
        const part = Math.min(amt, cand[1]);
        salaryPaid += part;
        nonSalaryPaid += amt - part;   // retro-reclassified remainder
      } else if (Number(tx.amount || 0) < 0 && isPcReimbursement(tx)) {
        pcReimbSigs.add(sig(tx));
      } else {
        nonSalaryPaid += Math.abs(Number(tx.amount || 0));
      }
    }
  }

  const reimTotal = reimMatches.reduce((s, m) => s + Number(m.tx.amount || 0), 0);
  const totalIn = Number(data.total_in || 0), totalOut = Number(data.total_out || 0), net = Number(data.net || 0);

  let intraIn = 0;
  if (accountSide === "gmbh") {
    for (const tx of txs) {
      const amt = Number(tx.amount || 0);
      if (amt > 0 && matchesEmployer(tx.counterparty || "") && !matchesEmployee(tx.counterparty || "")) intraIn += amt;
      for (const sub of tx.sub_entries ?? []) {
        const samt = Number(sub.amount || 0);
        if (samt > 0 && matchesEmployer(sub.counterparty || "") && !matchesEmployee(sub.counterparty || "")) intraIn += samt;
      }
    }
  }

  let personalFamilyIn = 0, ownerIn = 0;
  const ownerInSigs = new Set<string>();
  for (const tx of txs) {
    const amt = Number(tx.amount || 0);
    if (amt > 0 && (matchesRelative(tx.counterparty || "") || matchesEmployee(tx.counterparty || ""))) {
      if (isOwnerContribution(tx)) { ownerIn += amt; ownerInSigs.add(sig(tx)); }
      else if (matchesRelative(tx.counterparty || "")) personalFamilyIn += amt;
    }
    for (const sub of tx.sub_entries ?? []) {
      const samt = Number(sub.amount || 0);
      if (samt > 0 && matchesRelative(sub.counterparty || "")) personalFamilyIn += samt;
    }
  }

  let residual: number;
  if (accountSide === "gmbh" && reimTotal > 0) residual = nonSalaryPaid - reimTotal;
  else residual = accountSide === "gmbh" ? -nonSalaryPaid : nonSalaryPaid;
  if (accountSide === "gmbh") {
    residual -= personalCardTotal;
    residual -= expenseReportsTotal;
    residual -= ownerIn;
  }
  const directionText = residual < 0 ? `GmbH owes you CHF ${fmtM(Math.abs(residual))}`
    : residual > 0 ? `You owe GmbH CHF ${fmtM(residual)}` : "Fully settled";

  const classify = (tx: any): string => {
    if (reimLabels.has(sig(tx))) return reimLabels.get(sig(tx))!;
    if (salarySigs.has(sig(tx))) return "Salary";
    if (pcReimbSigs.has(sig(tx))) return "Personal-card reimbursement (settles fronted bills)";
    if (ownerInSigs.has(sig(tx))) return "Owner contribution (logged in ledger)";
    const cp = tx.counterparty || "";
    if (matchesEmployee(cp)) return "Personal transfer (non-salary)";
    if (matchesRelative(cp)) return "Personal / family transfer";
    if (matchesEmployer(cp)) return accountSide === "gmbh" ? "Intra-company transfer" : "From/to employer";
    if (isRoutinePayroll(tx)) return "Payroll / social charges";
    return "";
  };

  // ── Workbook ──
  const wb = new ExcelJS.Workbook();
  const HEADER_FONT = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  const SUB_FONT = { bold: true, size: 10, color: { argb: "FF1F3A5F" } };
  const SUB_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7E1E8" } };
  const ALT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
  const TITLE_FONT = { bold: true, size: 14, color: { argb: "FF1F3A5F" } };
  const CHF_FMT = "#,##0.00;[Red]-#,##0.00";

  // Sheet 1: Summary
  const s1 = wb.addWorksheet("Summary");
  const labelVal = (ws: ExcelJS.Worksheet, r: number, label: string, value: any,
    o: { currency?: boolean; bold?: boolean; color?: string } = {}) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: !!o.bold };
    const c = ws.getCell(r, 2);
    c.value = value;
    if (o.currency) c.numFmt = CHF_FMT;
    if (o.color) c.font = { bold: !!o.bold, color: { argb: "FF" + o.color } };
    else if (o.bold) c.font = { bold: true };
    c.alignment = { horizontal: "right" };
  };
  s1.mergeCells("A1:D1");
  // Python f-string renders a NULL account label as "None" — keep the quirk.
  const pyNone = (v: unknown) => (v == null ? "None" : String(v));
  s1.getCell("A1").value = `Bank statement export — ${pyNone(stmtD.bank)} ${pyNone(stmtD.account_label)}${periodLabelSuffix}`;
  s1.getCell("A1").font = TITLE_FONT;

  let r = 3;
  s1.getCell(r, 1).value = "Period"; s1.getCell(r, 1).font = { bold: true };
  s1.getCell(r, 2).value = `${quarterStart || stmtD.period_start || ""} → ${quarterEnd || stmtD.period_end || ""}`;
  r += 1;
  s1.getCell(r, 1).value = "IBAN"; s1.getCell(r, 1).font = { bold: true };
  if (stmtD.iban) s1.getCell(r, 2).value = stmtD.iban;
  r += 1;
  labelVal(s1, r, "Opening balance", stmtD.opening_balance || 0, { currency: true }); r += 1;
  labelVal(s1, r, "Closing balance", stmtD.closing_balance || 0, { currency: true, bold: true }); r += 1;

  r += 1;
  s1.mergeCells(r, 1, r, 4);
  s1.getCell(r, 1).value = "Cash-flow summary"; s1.getCell(r, 1).font = SUB_FONT; s1.getCell(r, 1).fill = SUB_FILL;
  r += 1;
  labelVal(s1, r, "Total in", totalIn, { currency: true, color: "16A34A" }); r += 1;
  labelVal(s1, r, "  of which customer revenue",
    totalIn - reimTotal - intraIn - personalFamilyIn - ownerIn, { currency: true }); r += 1;
  if (ownerIn > 0) { labelVal(s1, r, "  of which owner contributions (logged in ledger)", ownerIn, { currency: true, color: "9333EA" }); r += 1; }
  labelVal(s1, r, "  of which travel reimbursement (excluded from revenue)", reimTotal, { currency: true, color: "3B82F6" }); r += 1;
  if (intraIn > 0) { labelVal(s1, r, "  of which intra-company transfer (Sperrkonto / capital)", intraIn, { currency: true, color: "808080" }); r += 1; }
  if (personalFamilyIn > 0) { labelVal(s1, r, "  of which personal / family transfer", personalFamilyIn, { currency: true, color: "808080" }); r += 1; }
  labelVal(s1, r, "Total out", totalOut, { currency: true, color: "DC2626" }); r += 1;
  labelVal(s1, r, "Net", net, { currency: true, bold: true }); r += 1;
  if (personalCardRows.length) {
    labelVal(s1, r, "Off-bank: company expenses paid by personal card (see 'Personal card' sheet)",
      -personalCardTotal, { currency: true, color: "9333EA" }); r += 1;
    labelVal(s1, r, "Total costs incl. personal card", totalOut - personalCardTotal, { currency: true, bold: true }); r += 1;
  }

  r += 1;
  s1.mergeCells(r, 1, r, 4);
  s1.getCell(r, 1).value = "Kontokorrent (GmbH ↔ Personal)"; s1.getCell(r, 1).font = SUB_FONT; s1.getCell(r, 1).fill = SUB_FILL;
  r += 1;
  labelVal(s1, r, "Non-salary paid to you", nonSalaryPaid, { currency: true }); r += 1;
  labelVal(s1, r, "Reimbursement receivable (GmbH holds for you)", reimTotal, { currency: true, color: "3B82F6" }); r += 1;
  if (personalCardRows.length) { labelVal(s1, r, "Company expenses you paid with your personal card", personalCardTotal, { currency: true, color: "9333EA" }); r += 1; }
  if (expenseReportsTotal > 0) { labelVal(s1, r, "Travel expense reports you fronted (not yet reimbursed)", expenseReportsTotal, { currency: true, color: "9333EA" }); r += 1; }
  if (ownerIn > 0) { labelVal(s1, r, "Owner contributions from your private accounts", ownerIn, { currency: true, color: "9333EA" }); r += 1; }
  labelVal(s1, r, "Residual balance", Math.abs(residual), { currency: true, bold: true, color: residual < 0 ? "DC2626" : "16A34A" }); r += 1;
  labelVal(s1, r, "Direction", directionText, { bold: true, color: residual < 0 ? "DC2626" : (residual > 0 ? "16A34A" : "808080") }); r += 1;
  labelVal(s1, r, "Salary payments detected", salarySigs.size); r += 1;
  labelVal(s1, r, "Total salary paid", salaryPaid, { currency: true }); r += 1;

  r += 1;
  s1.mergeCells(r, 1, r, 4);
  s1.getCell(r, 1).value = "Reimbursement matches"; s1.getCell(r, 1).font = SUB_FONT; s1.getCell(r, 1).fill = SUB_FILL;
  r += 1;
  ["Bank date", "Amount", "Counterparty", "Matched to report"].forEach((h, i) => {
    const c = s1.getCell(r, i + 1);
    c.value = h; c.font = HEADER_FONT; c.fill = HEADER_FILL;
  });
  r += 1;
  for (const m of reimMatches) {
    const tx = m.tx, rep = m.report;
    const period = `${rep.year}` + (rep.month ? `-${String(rep.month).padStart(2, "0")}` : "");
    s1.getCell(r, 1).value = tx.date || ""; s1.getCell(r, 1).alignment = { horizontal: "left" };
    const c = s1.getCell(r, 2);
    c.value = Number(tx.amount || 0); c.numFmt = CHF_FMT; c.alignment = { horizontal: "right" };
    c.font = { color: { argb: "FF3B82F6" }, bold: true };
    s1.getCell(r, 3).value = tx.counterparty || "";
    s1.getCell(r, 4).value = `#${rep.report_number} (${period}, ${rep.expense_count} receipts)`;
    r += 1;
  }
  ([["A", 52], ["B", 18], ["C", 32], ["D", 40]] as const).forEach(([c, w]) => { s1.getColumn(c).width = w; });

  // Sheet 2: Transactions
  const s2 = wb.addWorksheet("Transactions");
  const txHeaders = ["Date", "Value Date", "Amount", "Currency", "Counterparty",
    "Description", "Transaction No.", "Classification", "Balance"];
  txHeaders.forEach((h, i) => {
    const c = s2.getCell(1, i + 1);
    c.value = h; c.font = HEADER_FONT; c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  s2.views = [{ state: "frozen", ySplit: 1 }];
  s2.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + txHeaders.length)}1` };

  const isNoise = (tx: any): boolean => {
    const amt = Number(tx.amount || 0);
    const desc = (tx.description || "").toLowerCase();
    const cpty = (tx.counterparty || "").toLowerCase();
    return amt === 0 && (desc.includes("balance closing") || cpty.includes("balance closing"));
  };
  const writeTxRow = (row: number, tx: any, isSub: boolean, parentTxNo: string | null) => {
    if (tx.date) s2.getCell(row, 1).value = tx.date;
    s2.getCell(row, 1).alignment = { horizontal: "left" };
    if (tx.value_date) s2.getCell(row, 2).value = tx.value_date;
    s2.getCell(row, 2).alignment = { horizontal: "left" };
    const amt = Number(tx.amount || 0);
    const c = s2.getCell(row, 3);
    c.value = amt; c.numFmt = CHF_FMT;
    if (amt > 0) c.font = { color: { argb: "FF16A34A" }, bold: true };
    else if (amt < 0) c.font = { color: { argb: "FFDC2626" } };
    s2.getCell(row, 4).value = currency; s2.getCell(row, 4).alignment = { horizontal: "center" };
    if (tx.counterparty) s2.getCell(row, 5).value = tx.counterparty;
    const txNo = isSub ? parentTxNo : (tx.transaction_no || "");
    if (txNo) s2.getCell(row, 7).value = txNo;
    const cls = classify(isSub
      ? { date: tx.date, amount: amt, counterparty: tx.counterparty || "", description: tx.description || "" }
      : tx);
    const rawDesc = String(tx.description || "").trim();
    let displayDesc: string;
    if (cls === "Salary") displayDesc = salaryMonthLabel(tx.date || "");
    else if (cls.startsWith("Personal transfer") && rawDesc.toLowerCase().startsWith("salary"))
      displayDesc = `(labeled '${rawDesc}' — not detected as salary)`;
    else displayDesc = rawDesc;
    if (displayDesc) s2.getCell(row, 6).value = displayDesc;
    const cellCls = s2.getCell(row, 8);
    if (cls) cellCls.value = cls;
    if (cls.startsWith("Reimbursement")) cellCls.font = { color: { argb: "FF3B82F6" }, italic: true, bold: true };
    else if (cls === "Salary") cellCls.font = { color: { argb: "FF808080" }, italic: true };
    else if (cls.startsWith("Personal transfer") || cls === "Personal / family transfer")
      cellCls.font = { color: { argb: "FFF59E0B" }, italic: true };
    else if (cls) cellCls.font = { color: { argb: "FF808080" }, italic: true };
    if (tx.balance != null) {
      const b = s2.getCell(row, 9);
      b.value = Number(tx.balance); b.numFmt = CHF_FMT;
    }
    if (isSub || row % 2 === 0) for (let col = 1; col <= 9; col++) s2.getCell(row, col).fill = ALT_FILL;
  };
  let rowIdx = 2;
  for (const tx of txs) {
    if (!tx.sub_entries?.length) {
      if (isNoise(tx)) continue;
      writeTxRow(rowIdx++, tx, false, null);
    } else {
      for (const sub of tx.sub_entries) {
        const effective = { date: tx.date, value_date: tx.value_date, amount: sub.amount,
          counterparty: sub.counterparty, description: sub.description,
          transaction_no: tx.transaction_no, balance: null };
        if (isNoise(effective)) continue;
        writeTxRow(rowIdx++, effective, true, tx.transaction_no);
      }
    }
  }
  Object.entries({ A: 12, B: 12, C: 14, D: 10, E: 34, F: 42, G: 18, H: 46, I: 14 })
    .forEach(([c, w]) => { s2.getColumn(c).width = w; });

  // Sheet 3: Reimbursements
  const s3 = wb.addWorksheet("Reimbursements");
  ["Bank date", "Amount received", "Counterparty", "Report number", "Report year/month", "Receipts", "Report created"]
    .forEach((h, i) => {
      const c = s3.getCell(1, i + 1);
      c.value = h; c.font = HEADER_FONT; c.fill = HEADER_FILL;
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
  s3.views = [{ state: "frozen", ySplit: 1 }];
  reimMatches.forEach((m, i) => {
    const row = i + 2, tx = m.tx, rep = m.report;
    const period = `${rep.year}` + (rep.month ? `-${String(rep.month).padStart(2, "0")}` : "");
    s3.getCell(row, 1).value = tx.date || "";
    const c = s3.getCell(row, 2);
    c.value = Number(tx.amount || 0); c.numFmt = CHF_FMT; c.font = { color: { argb: "FF3B82F6" }, bold: true };
    s3.getCell(row, 3).value = tx.counterparty || "";
    s3.getCell(row, 4).value = `#${rep.report_number}`;
    s3.getCell(row, 5).value = period;
    s3.getCell(row, 6).value = rep.expense_count;
    s3.getCell(row, 7).value = (rep.created_at || "").slice(0, 10);
  });
  if (reimMatches.length) {
    const totalRow = reimMatches.length + 2;
    s3.getCell(totalRow, 1).value = "Total"; s3.getCell(totalRow, 1).font = { bold: true };
    const tc = s3.getCell(totalRow, 2);
    tc.value = reimTotal; tc.numFmt = CHF_FMT; tc.font = { bold: true, color: { argb: "FF3B82F6" } };
  }
  Object.entries({ A: 12, B: 16, C: 30, D: 12, E: 14, F: 10, G: 14 })
    .forEach(([c, w]) => { s3.getColumn(c).width = w; });

  // Sheet 4: Personal card
  const s4 = wb.addWorksheet("Personal card");
  const pcHeaders = ["Date", "Vendor", "Description", "Category", "Amount",
    "Currency", "Status", "Receipt on file", "Reimbursed"];
  pcHeaders.forEach((h, i) => {
    const c = s4.getCell(1, i + 1);
    c.value = h; c.font = HEADER_FONT; c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  s4.views = [{ state: "frozen", ySplit: 1 }];
  s4.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + pcHeaders.length)}1` };
  personalCardRows.forEach((pc, i) => {
    const row = i + 2;
    s4.getCell(row, 1).value = pc.doc_date;
    s4.getCell(row, 2).value = pc.vendor;
    s4.getCell(row, 3).value = pc.description;
    s4.getCell(row, 4).value = pc.category;
    const c = s4.getCell(row, 5);
    c.value = Number(pc.amount || 0); c.numFmt = CHF_FMT; c.font = { color: { argb: "FF9333EA" } };
    s4.getCell(row, 6).value = pc.currency;
    s4.getCell(row, 7).value = pc.status;
    s4.getCell(row, 8).value = pc.doc_file ? "yes" : "no";
    s4.getCell(row, 9).value = pc.reimbursed_at || "outstanding";
    if (pc.reimbursed_at) s4.getCell(row, 9).font = { color: { argb: "FF16A34A" } };
    if (row % 2 === 0) for (let col = 1; col <= pcHeaders.length; col++) s4.getCell(row, col).fill = ALT_FILL;
  });
  if (personalCardRows.length) {
    const totalRow = personalCardRows.length + 2;
    s4.getCell(totalRow, 1).value = "Still owed to you at period end"; s4.getCell(totalRow, 1).font = { bold: true };
    const tc = s4.getCell(totalRow, 5);
    tc.value = personalCardTotal; tc.numFmt = CHF_FMT; tc.font = { bold: true, color: { argb: "FF9333EA" } };
  } else {
    s4.getCell(2, 1).value = "No company expenses paid by personal card in this period.";
  }
  Object.entries({ A: 12, B: 26, C: 42, D: 22, E: 14, F: 10, G: 10, H: 14, I: 14 })
    .forEach(([c, w]) => { s4.getColumn(c).width = w; });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = quarter
    ? `bank_transactions_Q${quarter}_${year}.xlsx`
    : `${id === 0 ? "bank_transactions_ALL_" : "bank_transactions_"}${stmtD.period_start || "start"}_to_${stmtD.period_end || "end"}.xlsx`;
  return { buf, filename };
}
