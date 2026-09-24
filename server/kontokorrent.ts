import { db, round2 } from "./db";

// Port of routes/money.py::kontokorrent_balance — one formula, used everywhere.
export function kontokorrentBalance() {
  const d = db();
  const rows = d.prepare("SELECT direction, SUM(amount) AS total FROM account_transfers GROUP BY direction").all() as any[];
  const one = (sql: string) => (d.prepare(sql).get() as any) ?? {};
  const salary = one("SELECT COALESCE(SUM(amount),0) AS t FROM account_transfers WHERE direction='gmbh_to_personal' AND description LIKE 'Net salary%'");
  const reimb = one("SELECT COALESCE(SUM(amount),0) AS t FROM account_transfers WHERE direction='gmbh_to_personal' AND description LIKE 'Personal-card reimbursement%'");
  const pc = one("SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS n FROM company_docs WHERE paid_via='personal' AND reimbursed_at IS NULL");
  const er = one("SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS n FROM expense_reports WHERE reimbursed_at IS NULL");
  let toGmbh = 0, toPersonal = 0;
  for (const r of rows) {
    if (r.direction === "personal_to_gmbh") toGmbh = r.total;
    else if (r.direction === "gmbh_to_personal") toPersonal = r.total;
  }
  return {
    expense_reports_outstanding: er.t ?? 0, expense_reports_open_count: er.n ?? 0,
    personal_card_open_count: pc.n ?? 0,
    personal_to_gmbh: toGmbh, gmbh_to_personal: toPersonal,
    salary_transfers_excluded: salary.t ?? 0, reimbursement_transfers_excluded: reimb.t ?? 0,
    personal_card_expenses: pc.t ?? 0,
    net_owed_to_personal: round2(toGmbh + (pc.t ?? 0) + (er.t ?? 0) - (toPersonal - (salary.t ?? 0) - (reimb.t ?? 0))),
  };
}
