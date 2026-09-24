import { db } from "./db";

export function effectiveCash() {
  const row = db().prepare("SELECT * FROM cash_balance WHERE id=1").get() as any;
  let balance = row?.balance ?? 0, as_of = row?.as_of ?? null, source = "manual entry";
  const st = db().prepare(
    "SELECT closing_balance, period_end FROM bank_statements WHERE closing_balance IS NOT NULL ORDER BY period_end DESC LIMIT 1"
  ).get() as any;
  if (st && (!as_of || (st.period_end && st.period_end > as_of))) {
    balance = st.closing_balance; as_of = st.period_end; source = "bank statement";
  }
  return { balance, as_of, source, notes: row?.notes ?? "", updated_at: row?.updated_at ?? null };
}
