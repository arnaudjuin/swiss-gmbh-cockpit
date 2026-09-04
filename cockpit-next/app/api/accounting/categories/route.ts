import { guard, json } from "@/server/http";

const ACCT_CATEGORIES = [
  "Office Supplies", "Software/Subscriptions", "Professional Services",
  "Insurance", "Payroll Settlement", "Rent", "Telecom", "Legal",
  "Bank Fees", "Taxes / VAT", "Other",
];

export const GET = guard(async () => json(ACCT_CATEGORIES));
