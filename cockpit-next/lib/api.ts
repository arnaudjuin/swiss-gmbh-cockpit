// Typed fetch client for the FastAPI backend. Same auth contract as the
// classic SPA: Bearer token from localStorage, 401 → back to /login.

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : null;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("session_token");
    window.location.href = "/login";
    throw new ApiError(401, "Not authenticated");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep statusText */ }
    throw new ApiError(res.status, String(detail));
  }
  return (res.headers.get("content-type") || "").includes("json") ? res.json() : (undefined as T);
}

// ── The slices of the API the dashboard consumes ────────────────────────────
export interface Overview {
  year: number;
  range: { key: string; label: string; start: string; end: string };
  income: { total_ytd: number; invoiced_net_ytd: number; other_ytd: number; cash_received_ytd: number };
  costs: { total_ytd: number; bills_ytd: number; payroll_ytd: number; by_category: { category: string; total: number }[] };
  profit: { ytd: number; margin_pct: number };
  invoices: { count_ytd: number; avg_monthly_revenue: number; avg_monthly_hours: number };
  upcoming: { overdue_total: number; due_30d: number };
  transfers: { net_owed_to_personal: number };
  monthly_pl: { label: string; year: number; month: number; income: number; costs: number; profit: number }[];
  recent_invoices: { id: number; invoice_number: number; month_name: string; year: number; hours: number; total: number; paid_status: string; due_date: string }[];
  panels: {
    receivables: { count: number; total: number; overdue_count: number };
    bills: { count: number; total: number; overdue_total: number };
    obligations: { year: number; count: number; paid_count: number; total: number; paid: number; unpaid: number; overdue_total: number; next: { label: string; period: string; amount: number; due_date: string } | null };
    payroll: { payslips_year: number; cost_year: number; last_period: string | null; last_net: number | null; months_missing: number };
    vat: { collected_year: number; open_obligations: number };
    kontokorrent: { net: number; personal_card_open: number; personal_card_open_count: number; reports_open: number; reports_open_count: number };
    reserves: { count: number; target: number };
    bank: { bank: string; as_of: string; closing: number; currency: string } | null;
  };
}

export interface Bill {
  id: number; doc_date: string; vendor: string; description: string;
  amount: number; currency: string; category: string; due_date: string | null;
  status: "paid" | "unpaid"; paid_via: "company" | "personal";
  reimbursed_at: string | null; original_amount: number | null;
  original_currency: string | null; has_file: boolean; file_type: string | null;
}

export interface Invoice {
  id: number; invoice_number: number; year: number; month: number; month_name: string;
  hours: number; rate: number; subtotal: number; tax: number; total: number;
  issued_date: string; due_date: string; notes: string | null;
  paid_status: "paid" | "unpaid" | null; paid_date: string | null;
}

export interface Payslip {
  id: number; year: number; month: number; month_name: string;
  issued_date: string; payment_date: string; gross: number;
  emp_total_deductions: number; net_salary: number; total_employer_cost: number;
  status: string; has_pdf: boolean;
}

export interface PayrollPreview {
  settings: { employer_name: string; employee_name: string; gross_monthly: number; payment_day: number; employment_start: string };
  calculation: { gross: number; emp_ahv: number; emp_alv: number; emp_bvg: number; emp_uvg: number; emp_ktg: number;
    emp_source_tax: number; emp_total_deductions: number; net_salary: number;
    employer_ahv: number; employer_alv: number; employer_bvg: number; employer_uvg: number; employer_ktg: number;
    employer_fak: number; employer_total: number; total_employer_cost: number };
}

export interface BankStatement {
  id: number; bank: string; account_label: string; iban: string;
  period_start: string; period_end: string; opening_balance: number;
  closing_balance: number; currency: string; has_pdf: boolean; has_xml: boolean;
}

export interface CashBalance { balance: number | null; as_of: string | null; source: string }

export interface CalendarEvent {
  date: string; kind: "obligation" | "bill" | "payroll"; title: string;
  amount: number; status: string; real: boolean; projected: boolean; doc_url: string | null;
}

export interface Customer { id: number; name: string; address: string; city: string; country: string; email: string | null; reference: string | null }

export interface SearchResult { type: string; id: number; title: string; subtitle: string; page: string }
export interface SearchResponse { results: SearchResult[]; parsed: { kind: string; label: string }[] | null }

export interface Reserve { id: number; name: string; purpose: string; target_amount: number; target_date: string | null; monthly_accrual: number; accumulated: number; remaining: number; progress_pct: number }
export interface Runway { runway_months: number | null; monthly_burn: number; description: string }
export interface ForecastMonth {
  key: string; label: string; income: number; income_override: boolean;
  payroll_net: number; obligations: number; bills: number; reserves: number;
  out: number; net: number; cash_end: number;
  items: { label: string; amount: number; date: string; kind: string }[];
}
export interface Forecast {
  opening: number; bank_balance: number; as_of: string; source: string;
  income_monthly: number; income_source: string; avg_income: number; payroll_net: number;
  pots: { name: string; monthly_accrual: number }[];
  pots_fund_after: string | null; carried_from: string | null;
  year: number; end_cash: number; horizon_months: number;
  lowest: { label: string; cash_end: number } | null;
  months: ForecastMonth[];
}

export interface Obligation {
  id: number; obligation_type: string; period_label: string; period_year: number;
  amount: number; currency: string; due_date: string | null; status: "paid" | "unpaid";
  notes: string; expected_bill_date: string | null; expected_bill_amount: number | null;
  payable_date: string | null;
}
