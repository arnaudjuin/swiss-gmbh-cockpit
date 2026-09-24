export function billToDict(r: any) {
  return {
    id: r.id, doc_date: r.doc_date, vendor: r.vendor, description: r.description,
    amount: r.amount, currency: r.currency, category: r.category,
    due_date: r.due_date, status: r.status, recurrence: r.recurrence,
    parent_doc_id: r.parent_doc_id, paid_via: r.paid_via ?? "company",
    reimbursed_at: r.reimbursed_at ?? null, doc_url: r.doc_url ?? null,
    original_amount: r.original_amount ?? null, original_currency: r.original_currency ?? null,
    fx_rate: r.fx_rate ?? null, doc_file: r.doc_file ?? null,
    has_file: r.doc_file != null,
    file_type: r.doc_file ? String(r.doc_file).split(".").pop() : null,
  };
}

// Port of routes/accounting._book_amount — CHF book value + original figure.
export function bookAmount(amount: number, currency: string, fxRate: number | null):
  { chf: number; originalAmount: number | null; originalCurrency: string | null; fxRate: number | null } | { error: string } {
  const cur = (currency || "CHF").toUpperCase();
  if (cur === "CHF") return { chf: Math.round(amount * 100) / 100, originalAmount: null, originalCurrency: null, fxRate: null };
  if (!fxRate || fxRate <= 0) return { error: `fx_rate (CHF per 1 ${cur}) is required for a ${cur} bill` };
  return { chf: Math.round(amount * fxRate * 100) / 100,
    originalAmount: Math.round(amount * 100) / 100, originalCurrency: cur, fxRate };
}

export function cleanDocUrl(url: string): string {
  const u = url.trim();
  return /^https?:\/\//.test(u) ? u : "";
}
