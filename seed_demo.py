"""Seed the app with a coherent, fully fictional demo dataset.

Run once after cloning:

    .venv/bin/python seed_demo.py

Creates the schema, then drives the app's own HTTP API (TestClient) so every
number is produced by the real business logic: payroll settings → generated
payslips (which create the AHV/UVG/KTG/Quellensteuer obligations), invoices,
bills, VAT & corporate-tax obligations, a bank statement, reserves, transfers.
Everything — names, amounts, dates — is invented.
"""

import os
from datetime import date

os.environ.setdefault("ADMIN_PASSWORD", "demo")

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402  (importing app configures db paths)
from db import init_db  # noqa: E402

init_db()

c = TestClient(app)
r = c.post("/api/login", json={"password": os.environ["ADMIN_PASSWORD"]})
r.raise_for_status()
c.cookies.set("session", r.json()["token"])

YEAR = date.today().year
THIS_MONTH = date.today().month


def post(url, **kw):
    r = c.post(url, **kw)
    assert r.status_code < 400, (url, r.status_code, r.text[:200])
    return r.json() if r.text else {}


# ── Payroll: settings, then issue payslips (creates the obligations too) ────
c.put("/api/payroll/settings", json={
    "employer_name": "Muster Consulting GmbH",
    "employee_name": "Max Muster",
    "employee_address": "Musterstrasse 1, 8000 Zürich",
    "employment_start": f"{YEAR}-01-01",
    "canton": "Zurich", "currency": "CHF", "payment_day": 25,
    "gross_monthly": 9500.0,
    "ahv_employee_pct": 5.3, "ahv_employer_pct": 5.3,
    "alv_employee_pct": 1.1, "alv_employer_pct": 1.1,
    "bvg_monthly_employee": 450.0, "bvg_monthly_employer": 650.0,
    "bvg_provider": "Demo Pension Ltd",
    "uvg_employee_monthly": 40.0, "uvg_employer_monthly": 25.0,
    "ktg_monthly_total": 90.0, "ktg_employer_share_pct": 50.0,
    "fak_employer_pct": 1.2,
    "source_tax_monthly": 1150.0, "source_tax_tariff": "A0N",
}).raise_for_status()

for m in range(1, THIS_MONTH + 1):
    post(f"/api/payroll/generate/{YEAR}/{m}",
         json={"create_obligations": True, "create_transfer": True})

# ── Customer + invoices ─────────────────────────────────────────────────────
cust = post("/api/customers", json={
    "name": "ACME Systems AG", "address": "Technikweg 12",
    "city": "8005 Zürich", "country": "Switzerland",
    "email": "billing@acme.example", "reference": "PO-2026-001",
})
hours = [152.0, 148.5, 168.0, 160.5, 171.0, 155.0, 176.5, 162.0]
inv_ids = []
for m in range(1, THIS_MONTH + 1):
    inv = post("/api/invoices", json={
        "year": YEAR, "month": m, "hours": hours[(m - 1) % len(hours)],
        "customer_id": cust["id"],
    })
    inv_ids.append(inv.get("id"))
# all but the latest invoice are paid
for iid in inv_ids[:-1]:
    if iid:
        c.patch(f"/api/invoices/{iid}/status", json={"status": "paid"})

# ── Bills (vendors invented) ────────────────────────────────────────────────
BILLS = [
    # (month, vendor, description, amount, category, paid_via, status, recurrence)
    (1, "CloudPeak Hosting", "App hosting — annual plan", 290.00, "Software/Subscriptions", "company", "paid", "yearly"),
    (2, "Swiss Telecom Demo AG", "Business mobile subscription", 55.00, "Telecom", "company", "paid", "monthly"),
    (2, "Helvetia Demo Insurance", "Business liability policy", 480.00, "Insurance", "company", "paid", "yearly"),
    (3, "Bureau Basics AG", "Standing desk + monitor arm", 620.00, "Office Supplies", "company", "paid", "none"),
    (3, "Fuel Station Demo", "Fuel — client visit", 84.50, "Vehicle", "personal", "paid", "none"),
    (4, "JetBrains Demo", "IDE subscription", 17.90, "Software/Subscriptions", "company", "paid", "monthly"),
    (4, "Demo Bank", "Account service fee Q1", 15.00, "Bank Fees", "company", "paid", "none"),
    (5, "Fuel Station Demo", "Fuel — client visit", 92.30, "Vehicle", "personal", "paid", "none"),
    (5, "Restaurant zur Demo", "Team lunch with client", 145.00, "Other", "personal", "paid", "none"),
    (6, "Swiss Telecom Demo AG", "Home fiber (business share)", 44.00, "Telecom", "company", "paid", "monthly"),
    (7, "Demo Bank", "Account service fee Q2", 15.00, "Bank Fees", "company", "paid", "none"),
    (7, "Garage Muster AG", "Company car service", 380.00, "Vehicle", "company", "paid", "none"),
    (8, "PrintShop Demo", "Business cards + letterhead", 96.00, "Office Supplies", "company", "unpaid", "none"),
]
for m, vendor, desc, amount, cat, via, status, rec in BILLS:
    post("/api/accounting", data={
        "doc_date": f"{YEAR}-{m:02d}-12", "vendor": vendor, "description": desc,
        "amount": amount, "currency": "CHF", "category": cat,
        "due_date": f"{YEAR}-{m:02d}-28" if status == "unpaid" else "",
        "status": status, "recurrence": rec, "paid_via": via,
    })

# ── Obligations beyond payroll: VAT + corporate tax + accountant ────────────
post("/api/obligations", data={
    "obligation_type": "vat", "period_label": f"Q2 {YEAR}", "period_year": YEAR,
    "amount": 2950.00, "due_date": f"{YEAR}-08-30",
    "expected_bill_date": f"{YEAR}-08-30", "expected_bill_amount": 2950.00,
    "notes": "First VAT return (effective method)",
})
post("/api/obligations", data={
    "obligation_type": "corporate_tax_federal", "period_label": f"FY {YEAR}",
    "period_year": YEAR, "amount": 1800.00, "due_date": f"{YEAR + 1}-03-31",
    "expected_bill_date": f"{YEAR + 1}-02-15", "expected_bill_amount": 1800.00,
})
post("/api/obligations", data={
    "obligation_type": "accounting", "period_label": f"FY {YEAR}",
    "period_year": YEAR, "amount": 5500.00, "due_date": f"{YEAR + 1}-03-31",
    "expected_bill_date": f"{YEAR + 1}-01-15", "expected_bill_amount": 5500.00,
    "notes": "Year-end closing + tax return (fiduciary)",
})

# ── Bank statement (freshest cash source) ───────────────────────────────────
post("/api/bank-statements", data={
    "period_start": f"{YEAR}-08-01", "period_end": f"{YEAR}-08-28",
    "bank": "Demo Bank", "account_label": "Business Current Account CHF",
    "iban": "CH93 0076 2011 6238 5295 7", "statement_type": "monthly",
    "opening_balance": 18400.00, "closing_balance": 23456.78,
})

# ── Reserves (Cash Allocation pots) ─────────────────────────────────────────
post("/api/reserves", data={
    "name": f"Future obligations ({YEAR + 1} bills)",
    "purpose": "Everything landing after December in one pot: AHV settlement, "
               "fiduciary, corporate tax, VAT.",
    "target_amount": 24000.00, "target_date": f"{YEAR + 1}-03-31",
    "monthly_accrual": 2000.00, "accrual_start": f"{YEAR}-09-01",
})
post("/api/reserves", data={
    "name": "Equipment & Laptops",
    "purpose": "Next laptop and peripherals, saved up monthly.",
    "target_amount": 3000.00, "target_date": f"{YEAR + 1}-08-31",
    "monthly_accrual": 250.00, "accrual_start": f"{YEAR}-09-01",
})

# ── A little extra colour ───────────────────────────────────────────────────
post("/api/income", data={
    "income_date": f"{YEAR}-06-30", "source": "Demo Bank",
    "description": "Interest on business account", "amount": 12.50,
    "category": "Interest",
})
post("/api/transfers", data={
    "transfer_date": f"{YEAR}-03-05", "direction": "personal_to_gmbh",
    "amount": 2000.00, "description": "Owner top-up during setup (Kontokorrent)",
})

print("Demo data seeded. Start the app:  .venv/bin/python app.py  →  http://127.0.0.1:8000  (password: demo)")
