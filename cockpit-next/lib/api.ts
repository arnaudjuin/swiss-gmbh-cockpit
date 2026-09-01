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

export interface Reserve { id: number; name: string; purpose: string; target_amount: number; target_date: string | null; monthly_accrual: number; accumulated: number; remaining: number; progress_pct: number }
export interface Runway { runway_months: number | null; monthly_burn: number; description: string }
export interface Forecast {
  opening: number; bank_balance: number; as_of: string; source: string;
  income_monthly: number; income_source: string; payroll_net: number;
  year: number; end_cash: number; horizon_months: number;
  lowest: { label: string; cash_end: number } | null;
  months: { key: string; label: string; income: number; out: number; cash_end: number }[];
}
