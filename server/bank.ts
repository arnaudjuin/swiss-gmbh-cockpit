export function statementToDict(r: any) {
  return {
    id: r.id, bank: r.bank, account_label: r.account_label, iban: r.iban,
    period_start: r.period_start, period_end: r.period_end, statement_type: r.statement_type,
    opening_balance: r.opening_balance, closing_balance: r.closing_balance,
    currency: r.currency, statement_file_pdf: r.statement_file_pdf,
    statement_file_xml: r.statement_file_xml,
    has_pdf: r.statement_file_pdf != null, has_xml: r.statement_file_xml != null,
    notes: r.notes, created_at: r.created_at,
  };
}
