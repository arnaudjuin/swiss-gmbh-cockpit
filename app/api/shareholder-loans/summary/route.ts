import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";

export const GET = guard(async () => {
  const rows: any[] = db().prepare(
    `SELECT direction, COALESCE(SUM(amount),0) AS t,
       COALESCE(SUM(CASE WHEN is_subordinated=1 THEN amount ELSE 0 END),0) AS s,
       COALESCE(SUM(CASE WHEN is_repaid=1 THEN amount ELSE 0 END),0) AS r
     FROM shareholder_loans GROUP BY direction`).all();
  const byDir = new Map(rows.map(r => [r.direction, r]));
  const inRow = byDir.get("shareholder_to_gmbh") ?? { t: 0, s: 0, r: 0 };
  const outRow = byDir.get("gmbh_to_shareholder") ?? { t: 0, s: 0, r: 0 };
  return json({
    net_owed_to_shareholder: round2(Number(inRow.t) - Number(outRow.t)),
    total_in: Number(inRow.t),
    total_out: Number(outRow.t),
    subordinated_amount: round2(Number(inRow.s)),  // only inbound can be subordinated
    repaid_total: Number(inRow.r) + Number(outRow.r),
  });
});
