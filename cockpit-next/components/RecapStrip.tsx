"use client";
// The per-page recap strip — a direct port of renderPanelsRecap() from the
// classic frontend (static/js/02-dashboard.js). Same data, same semantics.
import type { Overview, Reserve, Runway, Forecast } from "@/lib/api";
import { chf, daysUntil } from "@/lib/money";
import { Chip, RecapTile } from "./ui";

// All non-dashboard pages still live in the classic frontend during the port.
const CLASSIC = "http://127.0.0.1:8000";

export default function RecapStrip({ ov, reserves, runway, forecast, dividends }: {
  ov: Overview; reserves: Reserve[]; runway: Runway | null; forecast: Forecast | null;
  dividends: { net: number; monthly: number; months: number; gross: number; payout: string } | null;
}) {
  const p = ov.panels;
  const earmarked = reserves.reduce((s, r) => s + r.accumulated, 0);
  const target = reserves.reduce((s, r) => s + r.target_amount, 0);
  const monthly = reserves.reduce((s, r) => s + r.monthly_accrual, 0);
  const o = p.obligations;
  const k = p.kontokorrent;
  const nx = o.next;
  const nxDays = nx ? daysUntil(nx.due_date) : null;
  const low = forecast?.lowest ?? null;

  return (
    <div className="recap-grid">
      {p.bank ? (
        <RecapTile href={`${CLASSIC}/#bank`} label={`🏦 Bank · ${p.bank.bank}`} value={chf(p.bank.closing)}
          chip={<Chip mod={-daysUntil(p.bank.as_of) > 45 ? "warn" : "ok"}>{-daysUntil(p.bank.as_of)}d ago</Chip>}
          hint={`Statement to ${p.bank.as_of}${runway?.runway_months != null ? ` · runway ${runway.runway_months} mo` : ""}`} />
      ) : (
        <RecapTile href={`${CLASSIC}/#bank`} label="🏦 Bank" value="—" hint="Upload your first statement" />
      )}

      <RecapTile href={`${CLASSIC}/#cash`} label="💰 Cash & reserves" value={chf(earmarked)}
        meter={{ pct: target ? (earmarked / target) * 100 : 0, mod: "ok" }}
        hint={`earmarked of ${chf(target)} · +${chf(monthly)}/mo · ${reserves.length} pot${reserves.length === 1 ? "" : "s"}`} />

      <RecapTile href={`${CLASSIC}/#accounting`} label="🧾 Bills" value={chf(p.bills.total)}
        mod={p.bills.overdue_total > 0 ? "danger" : p.bills.total > 0 ? "warn" : null}
        chip={p.bills.overdue_total > 0
          ? <Chip mod="danger">{chf(p.bills.overdue_total)} overdue</Chip>
          : p.bills.count === 0 ? <Chip mod="ok">all paid</Chip> : undefined}
        hint={p.bills.count ? `${p.bills.count} unpaid` : "Nothing open"} />

      <RecapTile href={`${CLASSIC}/#obligations`} label={`📋 Obligations ${o.year}`} value={chf(o.unpaid)}
        mod={o.overdue_total > 0 ? "danger" : "warn"}
        chip={o.overdue_total > 0
          ? <Chip mod="danger">{chf(o.overdue_total)} overdue</Chip>
          : <Chip>{o.paid_count}/{o.count} paid</Chip>}
        meter={{ pct: o.total ? (o.paid / o.total) * 100 : 0, mod: "ok" }}
        hint={nx ? `Next: ${nx.label} ${nx.period} · ${chf(nx.amount)} · ${nxDays === 0 ? "today" : nxDays! < 0 ? `${-nxDays!}d overdue` : `in ${nxDays}d`}` : `still to pay of ${chf(o.total)}`} />

      <RecapTile href={`${CLASSIC}/#payroll`} label="👤 Payroll"
        value={p.payroll.last_net != null ? `${chf(p.payroll.last_net)} net/mo` : "—"}
        chip={p.payroll.months_missing > 0
          ? <Chip mod="warn">{p.payroll.months_missing} payslip{p.payroll.months_missing > 1 ? "s" : ""} missing</Chip>
          : <Chip mod="ok">up to date</Chip>}
        hint={`${p.payroll.payslips_year} payslips this year · employer cost ${chf(p.payroll.cost_year)}${p.payroll.last_period ? ` · last ${p.payroll.last_period}` : ""}`} />

      <RecapTile href={`${CLASSIC}/#invoices`} label="📄 Invoices" value={chf(p.receivables.total)}
        mod={p.receivables.overdue_count > 0 ? "danger" : p.receivables.total > 0 ? "warn" : "ok"}
        chip={p.receivables.overdue_count > 0
          ? <Chip mod="danger">{p.receivables.overdue_count} overdue</Chip>
          : p.receivables.count ? <Chip mod="warn">{p.receivables.count} open</Chip> : <Chip mod="ok">all paid</Chip>}
        hint={`outstanding · ${ov.invoices.count_ytd} issued this year · avg ${chf(ov.invoices.avg_monthly_revenue)}/mo`} />

      <RecapTile href={`${CLASSIC}/#cash`} label="🔁 Kontokorrent" value={chf(Math.abs(k.net))}
        mod={k.net > 0 ? "owner" : k.net < 0 ? "danger" : null}
        chip={k.net > 0 ? <Chip mod="owner">GmbH owes you</Chip> : k.net < 0 ? <Chip mod="danger">you owe GmbH</Chip> : <Chip mod="ok">settled</Chip>}
        hint={`${k.personal_card_open_count} personal-card bills (${chf(k.personal_card_open)}) + ${k.reports_open_count} reports (${chf(k.reports_open)}) pending`} />

      <RecapTile href={`${CLASSIC}/#obligations`} label="🏛 VAT" value={chf(p.vat.open_obligations)}
        mod={p.vat.open_obligations > 0 ? "warn" : null}
        hint={`to remit · collected ${chf(p.vat.collected_year)} on invoices this year`} />

      {dividends && (
        <RecapTile href={`${CLASSIC}/#dividends`} label={`⚡ Dividends FY ${new Date().getFullYear()}`}
          value={dividends.gross > 0 ? chf(dividends.net) : "—"} mod={dividends.gross > 0 ? "owner" : null}
          chip={dividends.gross > 0 ? <Chip mod="owner">{chf(dividends.monthly)}/mo × {dividends.months}</Chip> : <Chip>nothing this year</Chip>}
          hint={dividends.gross > 0 ? `net after tax of ${chf(dividends.gross)} gross · paid ${dividends.payout}` : "set a monthly amount to plan a payout"} />
      )}

      {forecast && low && (
        <RecapTile href={`${CLASSIC}/#budget`} label="📈 Forecast" value={chf(low.cash_end)}
          mod={low.cash_end < 0 ? "danger" : low.cash_end < forecast.payroll_net ? "warn" : "ok"}
          chip={<Chip>low in {low.label}</Chip>}
          hint={`lowest cash · ${chf(forecast.end_cash)} at end of ${forecast.year} · default income ${chf(forecast.income_monthly)}/mo`} />
      )}

      <RecapTile href={`${CLASSIC}/#expenses`} label="🧳 Expenses & trips" value={chf(k.reports_open)}
        chip={k.reports_open_count ? <Chip mod="warn">{k.reports_open_count} to reimburse</Chip> : <Chip mod="ok">none open</Chip>}
        hint="expense reports not yet reimbursed" />
    </div>
  );
}
