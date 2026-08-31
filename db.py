"""Database schema, init, and core helpers.

Holds:
- get_db() context manager
- init_db() — schema + migrations + seed data
- next_invoice_number() / next_expense_report_number()
- row_to_dict() for invoices

This module is imported by app.py and any extracted route module.
"""

import calendar
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Module-level constants set by app.py at startup
_db_path = None
_paths = {}


def configure(db_path: Path, pdf_dir: Path, scan_dir: Path, report_dir: Path,
              acct_dir: Path, payslip_dir: Path, bank_dir: Path | None = None):
    """Called once from app.py to inject directory paths."""
    global _db_path
    _db_path = db_path
    _paths.update({
        "PDF_DIR": pdf_dir,
        "SCAN_DIR": scan_dir,
        "REPORT_DIR": report_dir,
        "ACCT_DIR": acct_dir,
        "PAYSLIP_DIR": payslip_dir,
    })
    if bank_dir is not None:
        _paths["BANK_DIR"] = bank_dir


@contextmanager
def get_db():
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    _paths["PDF_DIR"].mkdir(exist_ok=True, parents=True)
    _paths["SCAN_DIR"].mkdir(parents=True, exist_ok=True)
    _paths["REPORT_DIR"].mkdir(parents=True, exist_ok=True)
    _paths["ACCT_DIR"].mkdir(parents=True, exist_ok=True)
    _paths["PAYSLIP_DIR"].mkdir(parents=True, exist_ok=True)
    if "BANK_DIR" in _paths:
        _paths["BANK_DIR"].mkdir(parents=True, exist_ok=True)

    # Restrict DB + document folders to the owner so other Unix users on the
    # same machine can't read your financial data. POSIX-only — best-effort
    # on Windows.
    import os as _os
    try:
        if _db_path.exists():
            _os.chmod(_db_path, 0o600)
        for d in [_paths["PDF_DIR"], _paths["SCAN_DIR"], _paths["REPORT_DIR"],
                  _paths["ACCT_DIR"], _paths["PAYSLIP_DIR"]]:
            _os.chmod(d, 0o700)
    except (OSError, AttributeError):
        pass
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_number INTEGER UNIQUE NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                hours REAL NOT NULL,
                rate REAL NOT NULL,
                vat_rate REAL NOT NULL,
                subtotal REAL NOT NULL,
                tax REAL NOT NULL,
                total REAL NOT NULL,
                issued_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                notes TEXT DEFAULT '',
                paid_status TEXT NOT NULL DEFAULT 'unpaid',
                paid_date TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                expense_date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                original_amount REAL,
                original_currency TEXT,
                scan_file TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS expense_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_number INTEGER NOT NULL,
                year INTEGER NOT NULL,
                total REAL NOT NULL,
                expense_count INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                city TEXT,
                country TEXT,
                email TEXT,
                reference TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS obligations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                obligation_type TEXT NOT NULL,
                period_label TEXT NOT NULL,
                period_year INTEGER NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                due_date TEXT,
                status TEXT NOT NULL DEFAULT 'unpaid',
                notes TEXT,
                doc_file TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS account_transfers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transfer_date TEXT NOT NULL,
                direction TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                description TEXT,
                doc_file TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS income_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                income_date TEXT NOT NULL,
                source TEXT NOT NULL,
                description TEXT,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                category TEXT NOT NULL DEFAULT 'Other',
                doc_file TEXT,
                invoice_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migration: add invoice_id column if missing (existing DBs)
        try:
            db.execute("SELECT invoice_id FROM income_entries LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE income_entries ADD COLUMN invoice_id INTEGER")
        # Enforce at most one income row per invoice (partial unique index)
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_income_entries_invoice "
            "ON income_entries(invoice_id) WHERE invoice_id IS NOT NULL"
        )
        # Two-way self-heal on every startup so the invoice↔income link can
        # never drift out of sync (e.g. someone deletes the auto-row by hand,
        # or an old paid invoice predates the link feature):
        #
        # 1) Add missing income rows for invoices currently `paid` (hours > 0)
        #    that have no linked row.
        # 2) Delete orphaned income rows whose `invoice_id` no longer points to
        #    a billable paid invoice (either invoice deleted or status flipped
        #    back to `unpaid`).
        missing = db.execute("""
            SELECT i.id, i.invoice_number, i.year, i.month, i.total, i.paid_date
              FROM invoices i
             WHERE i.paid_status = 'paid'
               AND i.hours > 0
               AND NOT EXISTS (SELECT 1 FROM income_entries e WHERE e.invoice_id = i.id)
        """).fetchall()
        for inv in missing:
            paid_date = inv["paid_date"] or f"{inv['year']:04d}-{inv['month']:02d}-25"
            db.execute(
                "INSERT INTO income_entries (income_date, source, description, amount, currency, category, invoice_id) "
                "VALUES (?, ?, ?, ?, 'CHF', 'Invoice Payment', ?)",
                (paid_date, f"Invoice #{inv['invoice_number']:04d}",
                 f"Auto-linked to invoice #{inv['invoice_number']:04d}",
                 inv["total"], inv["id"]),
            )
        # Orphans: income row linked to invoice that's missing OR no longer paid
        db.execute("""
            DELETE FROM income_entries
             WHERE invoice_id IS NOT NULL
               AND invoice_id NOT IN (
                   SELECT id FROM invoices WHERE paid_status = 'paid' AND hours > 0
               )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS cash_balance (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                balance REAL NOT NULL DEFAULT 0,
                as_of TEXT NOT NULL DEFAULT (date('now')),
                notes TEXT DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        if not db.execute("SELECT id FROM cash_balance WHERE id=1").fetchone():
            db.execute("INSERT INTO cash_balance (id, balance, as_of) VALUES (1, 0, date('now'))")

        db.execute("""
            CREATE TABLE IF NOT EXISTS payroll_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                employer_name TEXT NOT NULL,
                employee_name TEXT NOT NULL,
                employee_address TEXT,
                employment_start TEXT NOT NULL,
                canton TEXT NOT NULL DEFAULT 'Zurich',
                currency TEXT NOT NULL DEFAULT 'CHF',
                payment_day INTEGER NOT NULL DEFAULT 25,
                gross_monthly REAL NOT NULL,
                ahv_employee_pct REAL NOT NULL,
                ahv_employer_pct REAL NOT NULL,
                alv_employee_pct REAL NOT NULL,
                alv_employer_pct REAL NOT NULL,
                bvg_monthly_employee REAL NOT NULL,
                bvg_monthly_employer REAL NOT NULL,
                bvg_provider TEXT,
                uvg_employee_monthly REAL NOT NULL,
                uvg_employer_monthly REAL NOT NULL,
                ktg_monthly_total REAL NOT NULL,
                ktg_employer_share_pct REAL NOT NULL DEFAULT 70,
                fak_employer_pct REAL NOT NULL DEFAULT 1.2,
                source_tax_monthly REAL NOT NULL DEFAULT 0,
                source_tax_tariff TEXT DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migration for existing DBs
        try:
            db.execute("SELECT fak_employer_pct FROM payroll_settings LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE payroll_settings ADD COLUMN fak_employer_pct REAL NOT NULL DEFAULT 1.2")
            db.execute("ALTER TABLE payroll_settings ADD COLUMN source_tax_monthly REAL NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE payroll_settings ADD COLUMN source_tax_tariff TEXT DEFAULT ''")
        db.execute("""
            CREATE TABLE IF NOT EXISTS payslips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                issued_date TEXT NOT NULL,
                payment_date TEXT NOT NULL,
                gross REAL NOT NULL,
                emp_ahv REAL NOT NULL,
                emp_alv REAL NOT NULL,
                emp_bvg REAL NOT NULL,
                emp_uvg REAL NOT NULL,
                emp_ktg REAL NOT NULL,
                emp_source_tax REAL NOT NULL DEFAULT 0,
                emp_total_deductions REAL NOT NULL,
                net_salary REAL NOT NULL,
                employer_ahv REAL NOT NULL,
                employer_alv REAL NOT NULL,
                employer_bvg REAL NOT NULL,
                employer_uvg REAL NOT NULL,
                employer_ktg REAL NOT NULL,
                employer_fak REAL NOT NULL DEFAULT 0,
                employer_total REAL NOT NULL,
                total_employer_cost REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'issued',
                pdf_file TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(year, month)
            )
        """)
        # Migration
        try:
            db.execute("SELECT emp_source_tax FROM payslips LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE payslips ADD COLUMN emp_source_tax REAL NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE payslips ADD COLUMN employer_fak REAL NOT NULL DEFAULT 0")
        db.execute("""
            CREATE TABLE IF NOT EXISTS budget_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grp TEXT NOT NULL,
                subcategory TEXT NOT NULL,
                budgeted REAL NOT NULL DEFAULT 0,
                balance REAL NOT NULL DEFAULT 0,
                last_contributed_month TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        try:
            db.execute("SELECT balance FROM budget_items LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE budget_items ADD COLUMN balance REAL NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE budget_items ADD COLUMN last_contributed_month TEXT")
        db.execute("""
            CREATE TABLE IF NOT EXISTS budget_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_item_id INTEGER NOT NULL,
                entry_date TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                kind TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (budget_item_id) REFERENCES budget_items(id)
            )
        """)
        # UNIQUE index so save_budget_config can UPSERT by (grp, subcategory)
        # instead of wiping budget_items (which would orphan all ledger history).
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_items_grp_sub "
            "ON budget_items(grp, subcategory)"
        )
        db.execute("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY,
                prefs TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        if not db.execute("SELECT id FROM user_preferences WHERE id=1").fetchone():
            db.execute("INSERT INTO user_preferences (id, prefs) VALUES (1, '{}')")
        db.execute("""
            CREATE TABLE IF NOT EXISTS shared_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                section TEXT NOT NULL,
                year INTEGER NOT NULL,
                label TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS company_docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_date TEXT NOT NULL,
                vendor TEXT NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                category TEXT NOT NULL,
                due_date TEXT,
                status TEXT NOT NULL DEFAULT 'unpaid',
                doc_file TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Add notes column if missing (migration for existing DBs)
        try:
            db.execute("SELECT notes FROM invoices LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE invoices ADD COLUMN notes TEXT DEFAULT ''")

        # Add original_amount/original_currency columns if missing
        try:
            db.execute("SELECT original_amount FROM expenses LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE expenses ADD COLUMN original_amount REAL")
            db.execute("ALTER TABLE expenses ADD COLUMN original_currency TEXT")

        # Add month column to expense_reports if missing
        try:
            db.execute("SELECT month FROM expense_reports LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE expense_reports ADD COLUMN month INTEGER")

        # Add SAI (UVGZ supplementary accident) columns to payroll_settings if missing
        try:
            db.execute("SELECT sai_employee_monthly FROM payroll_settings LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE payroll_settings ADD COLUMN "
                       "sai_employee_monthly REAL NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE payroll_settings ADD COLUMN "
                       "sai_employer_share_pct REAL NOT NULL DEFAULT 50")

        # Create reserves table if missing (monthly accruals toward future cash-outs)
        db.execute('''
            CREATE TABLE IF NOT EXISTS reserves (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                purpose TEXT,
                target_amount REAL NOT NULL,
                target_date TEXT,
                monthly_accrual REAL NOT NULL DEFAULT 0,
                accrual_start TEXT,
                accumulated_manual REAL NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')

        # Create trips table + add trip_id to expenses (groups expenses by business trip)
        db.execute('''
            CREATE TABLE IF NOT EXISTS trips (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                purpose TEXT,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                countries TEXT,
                notes TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')
        try:
            db.execute("SELECT trip_id FROM expenses LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE expenses ADD COLUMN trip_id INTEGER REFERENCES trips(id)")

        # Bank statements (UBS / other) — uploaded monthly statements with
        # opening/closing balance, used for reconciliation and Treuhand handover.
        # Each period can have BOTH a PDF (official) and an XML (CAMT.053) file.
        db.execute('''
            CREATE TABLE IF NOT EXISTS bank_statements (
                id INTEGER PRIMARY KEY,
                bank TEXT NOT NULL DEFAULT 'UBS',
                account_label TEXT,
                iban TEXT,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                statement_type TEXT NOT NULL DEFAULT 'monthly',
                opening_balance REAL,
                closing_balance REAL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                statement_file_pdf TEXT,
                statement_file_xml TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')
        # Migration for installs that pre-date the two-file split
        try:
            db.execute("SELECT statement_file_pdf FROM bank_statements LIMIT 1")
        except sqlite3.OperationalError:
            # Old schema had a single `statement_file` column — rename it to *_pdf
            db.execute("ALTER TABLE bank_statements RENAME COLUMN statement_file TO statement_file_pdf")
        try:
            db.execute("SELECT statement_file_xml FROM bank_statements LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE bank_statements ADD COLUMN statement_file_xml TEXT")

        # Shareholder loans (Rangrücktritt tracking — OR 725a/b compliance)
        db.execute('''
            CREATE TABLE IF NOT EXISTS shareholder_loans (
                id INTEGER PRIMARY KEY,
                loan_date TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CHF',
                direction TEXT NOT NULL,
                is_subordinated INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                document_file TEXT,
                repayment_date TEXT,
                is_repaid INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')

        # Vehicles (cars / equipment owned by the GmbH — for depreciation + Privatanteil)
        db.execute('''
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                vendor TEXT,
                purchase_date TEXT NOT NULL,
                purchase_price REAL NOT NULL,
                vat_paid REAL,
                purchase_invoice_file TEXT,
                registration_number TEXT,
                fahrzeugausweis_file TEXT,
                depreciation_method TEXT DEFAULT 'degressive_40',
                privatanteil_method TEXT DEFAULT 'pauschal',
                privatanteil_monthly REAL,
                is_active INTEGER NOT NULL DEFAULT 1,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')

        # Bank transactions (parsed from CAMT.053 or UBS CSV; used for reconciliation)
        db.execute('''
            CREATE TABLE IF NOT EXISTS bank_transactions (
                id INTEGER PRIMARY KEY,
                statement_id INTEGER REFERENCES bank_statements(id),
                trade_date TEXT NOT NULL,
                booking_date TEXT,
                value_date TEXT,
                amount REAL NOT NULL,
                balance_after REAL,
                transaction_no TEXT,
                description1 TEXT,
                description2 TEXT,
                description3 TEXT,
                counterparty TEXT,
                reference TEXT,
                matched_invoice_id INTEGER REFERENCES invoices(id),
                matched_bill_id INTEGER REFERENCES company_docs(id),
                matched_obligation_id INTEGER REFERENCES obligations(id),
                auto_categorized TEXT,
                is_reviewed INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')

        # Add due_date/status columns to company_docs if missing
        try:
            db.execute("SELECT due_date FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN due_date TEXT")
            db.execute("ALTER TABLE company_docs ADD COLUMN status TEXT NOT NULL DEFAULT 'unpaid'")

        # Add recurrence columns to company_docs if missing
        try:
            db.execute("SELECT recurrence FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN recurrence TEXT DEFAULT 'none'")
            db.execute("ALTER TABLE company_docs ADD COLUMN parent_doc_id INTEGER")

        # Add recurrence to obligations
        try:
            db.execute("SELECT recurrence FROM obligations LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE obligations ADD COLUMN recurrence TEXT DEFAULT 'none'")
            db.execute("ALTER TABLE obligations ADD COLUMN parent_obligation_id INTEGER")

        # Add status/paid_date to invoices (guards are separate: the base
        # schema gained paid_status later, so a fresh DB passes the first
        # probe but still lacks paid_date)
        try:
            db.execute("SELECT paid_status FROM invoices LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE invoices ADD COLUMN paid_status TEXT NOT NULL DEFAULT 'unpaid'")
        try:
            db.execute("SELECT paid_date FROM invoices LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE invoices ADD COLUMN paid_date TEXT")

        # Add VAT tracking columns
        try:
            db.execute("SELECT vat_amount FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN vat_amount REAL DEFAULT 0")
            db.execute("ALTER TABLE company_docs ADD COLUMN vat_rate REAL DEFAULT 0")

        # Track how a bill was paid: company account or the owner's personal card
        # (personal-card payments feed the Kontokorrent — GmbH owes the owner)
        try:
            db.execute("SELECT paid_via FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN paid_via TEXT NOT NULL DEFAULT 'company'")

        # When a personal-card bill has been reimbursed to the owner, stamp it
        # so the Kontokorrent stops counting it and it can't be paid twice
        try:
            db.execute("SELECT reimbursed_at FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN reimbursed_at TEXT")

        # External link to the bill's document (Google Drive / Dropbox / any
        # URL), independent of the locally-uploaded file
        try:
            db.execute("SELECT doc_url FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN doc_url TEXT")

        # Foreign-currency bills: `amount` is ALWAYS the CHF book value;
        # the original figure + the rate used are kept for the audit trail.
        try:
            db.execute("SELECT fx_rate FROM company_docs LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE company_docs ADD COLUMN original_amount REAL")
            db.execute("ALTER TABLE company_docs ADD COLUMN original_currency TEXT")
            db.execute("ALTER TABLE company_docs ADD COLUMN fx_rate REAL")

        # Movement history for GmbH reserves (contribute / withdraw): the
        # audit trail behind accumulated_manual adjustments (e.g. paying a
        # laptop bill straight from the Equipment reserve).
        db.execute("""
            CREATE TABLE IF NOT EXISTS reserve_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reserve_id INTEGER NOT NULL,
                entry_date TEXT NOT NULL,
                kind TEXT NOT NULL,              -- contribute | withdraw
                amount REAL NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # When the REAL invoice for an obligation is expected to arrive, and
        # at what amount (bills often differ from the accrual: AHV akonto adds
        # FAK + admin costs, AXA re-rates after salary changes, ...)
        try:
            db.execute("SELECT expected_bill_date FROM obligations LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE obligations ADD COLUMN expected_bill_date TEXT")
            db.execute("ALTER TABLE obligations ADD COLUMN expected_bill_amount REAL")

        # Expense reports are travel costs the owner fronted privately — they
        # sit in the Kontokorrent until the GmbH reimburses them, same as
        # personal-card bills. Pre-existing reports were settled by hand
        # (manual ledger transfers), so they're stamped 'legacy' to avoid
        # double-counting; new reports start outstanding.
        try:
            db.execute("SELECT reimbursed_at FROM expense_reports LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE expense_reports ADD COLUMN reimbursed_at TEXT")
            db.execute("UPDATE expense_reports SET reimbursed_at='legacy'")

        # Payslips can be generated by the tool or uploaded from the accountant
        try:
            db.execute("SELECT source FROM payslips LIMIT 1")
        except sqlite3.OperationalError:
            db.execute("ALTER TABLE payslips ADD COLUMN source TEXT NOT NULL DEFAULT 'generated'")

        # VAT deduction simulation settings (effective method, quarterly filing).
        # estimate_missing: derive input VAT from bills that lack an explicit
        # vat_amount; excluded_categories: JSON list of VAT-exempt categories;
        # flat_quarterly_deduction: extra simulated input VAT per quarter.
        db.execute('''
            CREATE TABLE IF NOT EXISTS vat_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                estimate_missing INTEGER NOT NULL DEFAULT 1,
                estimate_rate REAL NOT NULL DEFAULT 8.1,
                excluded_categories TEXT NOT NULL DEFAULT '["Insurance","Bank Fees","Payroll Settlement","Taxes / VAT"]',
                flat_quarterly_deduction REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ''')
        if not db.execute("SELECT id FROM vat_settings WHERE id=1").fetchone():
            db.execute("INSERT INTO vat_settings (id) VALUES (1)")
        # One-time upgrade: rows created before the "Taxes / VAT" category
        # existed get it added to the exempt list (a VAT payment contains no
        # deductible input VAT). Only touches the untouched old default, so a
        # user who deliberately customizes the list afterwards is respected.
        _old_default = '["Insurance","Bank Fees","Payroll Settlement"]'
        db.execute(
            "UPDATE vat_settings SET excluded_categories=? WHERE id=1 AND excluded_categories=?",
            ('["Insurance","Bank Fees","Payroll Settlement","Taxes / VAT"]', _old_default),
        )

        # Seed default payroll settings
        if not db.execute("SELECT id FROM payroll_settings WHERE id=1").fetchone():
            db.execute("""
                INSERT INTO payroll_settings
                (id, employer_name, employee_name, employee_address, employment_start,
                 canton, currency, payment_day, gross_monthly,
                 ahv_employee_pct, ahv_employer_pct, alv_employee_pct, alv_employer_pct,
                 bvg_monthly_employee, bvg_monthly_employer, bvg_provider,
                 uvg_employee_monthly, uvg_employer_monthly,
                 ktg_monthly_total, ktg_employer_share_pct)
                VALUES (1, 'Muster Consulting GmbH', 'Max Muster',
                        'c/o Alpen Treuhand AG, Musterstrasse 1, 8000 Zurich',
                        '2026-04-01', 'Zurich', 'CHF', 25, 13000.00,
                        5.3, 5.3, 1.1, 1.1,
                        522.60, 783.90, 'AXA',
                        120.00, 150.00,
                        290.04, 70.0)
            """)

        # (Accountant fee is tracked as a 'Treuhand' OBLIGATION, not a seeded
        # bill — the real invoice becomes a bill when it arrives. The old seed
        # here also crashed on a missing `date` import when it ever re-ran.)

        # Seed default customer
        if not db.execute("SELECT id FROM customers LIMIT 1").fetchone():
            db.execute(
                "INSERT INTO customers (name, address, city, country, email, reference) VALUES (?,?,?,?,?,?)",
                ("Acme Technologies", "Louis Giroud-Strasse 26/3.OG", "4600 Olten",
                 "Switzerland", "invoices@acme.example", "101119.LOD-SW_GCS-24032"),
            )

        # ─── Self-heal: budget_ledger orphans ────────────────────────────
        # Ledger rows whose budget_item_id no longer exists (item was deleted
        # via the legacy wipe-and-re-insert flow).
        db.execute("""
            DELETE FROM budget_ledger
             WHERE budget_item_id NOT IN (SELECT id FROM budget_items)
        """)

        # ─── Self-heal: recurring bill / obligation parent chains ────────
        # If a parent was deleted, promote the oldest orphan child to NULL
        # parent_doc_id and point its siblings at it. Same for obligations.
        _heal_recurring_chain(db, table="company_docs",
                              parent_col="parent_doc_id", date_col="doc_date")
        _heal_recurring_chain(db, table="obligations",
                              parent_col="parent_obligation_id", date_col="due_date")


def _heal_recurring_chain(db, table: str, parent_col: str, date_col: str) -> None:
    """Promote orphaned recurring children to a new parent within their group.

    Orphans = rows where `parent_col` is non-NULL but no row in `table` has
    that id. We can't reconstruct the original parent's metadata, so we pick
    the oldest orphan per (deleted) parent_id and promote it: set its
    parent_col=NULL, then update its siblings to point at it.
    """
    groups = db.execute(f"""
        SELECT c1.{parent_col} AS old_parent_id, MIN(c1.{date_col}) AS oldest
          FROM {table} c1
         WHERE c1.{parent_col} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM {table} c2 WHERE c2.id = c1.{parent_col})
         GROUP BY c1.{parent_col}
    """).fetchall()
    for g in groups:
        old_pid = g["old_parent_id"]
        oldest = db.execute(
            f"SELECT id FROM {table} WHERE {parent_col} = ? "
            f"ORDER BY {date_col} LIMIT 1",
            (old_pid,),
        ).fetchone()
        if not oldest:
            continue
        new_parent_id = oldest["id"]
        # Point siblings at the promoted row
        db.execute(
            f"UPDATE {table} SET {parent_col} = ? "
            f"WHERE {parent_col} = ? AND id != ?",
            (new_parent_id, old_pid, new_parent_id),
        )
        # Promote the new parent itself (NULL parent_col)
        db.execute(
            f"UPDATE {table} SET {parent_col} = NULL WHERE id = ?",
            (new_parent_id,),
        )


def next_invoice_number():
    with get_db() as db:
        row = db.execute("SELECT MAX(invoice_number) as n FROM invoices").fetchone()
        last = row["n"] if row["n"] else 17
        return last + 1


def next_expense_report_number():
    with get_db() as db:
        row = db.execute("SELECT MAX(report_number) as n FROM expense_reports").fetchone()
        last = row["n"] if row["n"] else 0
        return last + 1


def row_to_dict(row):
    return {
        "id": row["id"],
        "invoice_number": row["invoice_number"],
        "year": row["year"],
        "month": row["month"],
        "month_name": calendar.month_name[row["month"]],
        "hours": row["hours"],
        "rate": row["rate"],
        "subtotal": row["subtotal"],
        "tax": row["tax"],
        "total": row["total"],
        "issued_date": row["issued_date"],
        "due_date": row["due_date"],
        "notes": row["notes"] or "",
        "paid_status": row["paid_status"] if "paid_status" in row.keys() else "unpaid",
        "paid_date": row["paid_date"] if "paid_date" in row.keys() else None,
        "created_at": row["created_at"],
    }

