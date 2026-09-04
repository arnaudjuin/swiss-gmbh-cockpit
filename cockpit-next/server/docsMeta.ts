// Whitelisted markdown docs (order = sidebar display order).
import path from "path";

export const DOCS_MD_DIR = process.env.DOCS_MD_DIR || path.resolve(process.cwd(), "..", "docs");

export const DOCS_META = [
  { name: "MANUAL.md",              title: "User Manual" },
  { name: "GUIDE.md",               title: "Setup & API Reference" },
  { name: "FEATURES.md",            title: "Feature Reference" },
  { name: "TAB_BANK_STATEMENTS.md", title: "Tab · Bank Statements" },
  { name: "FORMULAS.md",            title: "Calculations & Formulas" },
  { name: "AI_CHAT.md",             title: "AI Chat — How It Works" },
  { name: "PAYROLL_NOTES.md",       title: "Swiss Payroll Reference" },
  { name: "ACCOUNTING_TASKS.md",    title: "Accounting Checklist" },
  { name: "SECURITY.md",            title: "Security & Data Protection" },
  { name: "HOSTING.md",             title: "Hosting & Deployment" },
  { name: "TEST_PROCEDURE.md",      title: "Developer Test Procedure" },
];
export const DOC_NAMES = new Set(DOCS_META.map(d => d.name));
