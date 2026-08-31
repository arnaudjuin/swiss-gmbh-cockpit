#!/usr/bin/env python3
"""CLI tool to generate invoices for Muster Consulting GmbH."""

import argparse
import calendar
import json
import sys
from datetime import date
from pathlib import Path

from fpdf import FPDF

# ─── Constants ───────────────────────────────────────────────────────────────
RATE = 62.00  # CHF per hour
VAT_RATE = 0.081  # 8.1%
AED_TO_CHF = 0.2178  # 1 AED = 0.2178 CHF
COMPANY = "Muster Consulting GmbH"
SCRIPT_DIR = Path(__file__).parent
STATE_FILE = SCRIPT_DIR / "invoice_state.json"


# ─── State ───────────────────────────────────────────────────────────────────

def get_next_invoice_number():
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text())
        return state.get("last_invoice_number", 17) + 1
    return 18


def save_invoice_number(num):
    STATE_FILE.write_text(json.dumps({"last_invoice_number": num}, indent=2))


# ─── PDF ─────────────────────────────────────────────────────────────────────

class InvoicePDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"{self.page_no()}/{self.pages_count}", align="R")


def draw_bar_icon(pdf, x, y):
    """Draw a small bar-chart icon."""
    pdf.set_fill_color(50, 50, 50)
    bars = [(0, 4, 2.5, 3), (3.5, 2, 2.5, 5), (7, 0.5, 2.5, 6.5), (10.5, 3, 2.5, 4)]
    for dx, dy, w, h in bars:
        pdf.rect(x + dx, y + dy, w, h, "F")


DEFAULT_CUSTOMER = {
    "name": "Acme Technologies",
    "address": "Louis Giroud-Strasse 26/3.OG",
    "city": "4600 Olten",
    "country": "Switzerland",
    "email": "invoices@acme.example",
    "reference": "101119.LOD-SW_GCS-24032",
}


def generate(year: int, month: int, hours: int, invoice_num: int, customer: dict | None = None) -> bytes:
    customer = customer or DEFAULT_CUSTOMER
    month_name = calendar.month_name[month]
    issued = date(year, month, calendar.monthrange(year, month)[1])
    due_m = month + 1 if month < 12 else 1
    due_y = year if month < 12 else year + 1
    due = date(due_y, due_m, calendar.monthrange(due_y, due_m)[1])

    subtotal = hours * RATE
    tax = round(subtotal * VAT_RATE, 2)
    total = round(subtotal + tax, 2)

    pdf = InvoicePDF()
    pdf.set_auto_page_break(False)
    pdf.add_page()

    # ── Company name (top left) ──
    pdf.set_xy(15, 13)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(100, 7, COMPANY)

    # ── Invoice number (top right) ──
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_xy(110, 9)
    pdf.cell(88, 12, f"Invoice: {invoice_num:04d}", align="R")

    # Issued / Due dates
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(90, 90, 90)
    pdf.set_xy(110, 22)
    pdf.cell(88, 5, f"Issued on: {issued}", align="R")
    pdf.set_xy(110, 27)
    pdf.cell(88, 5, f"Due by: {due}", align="R")

    # ── From ──
    y = 40
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(30, 6, "From")
    y += 8

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    from_lines = [
        COMPANY,
        "Max MUSTER",
        "c/o Alpen Treuhand AG",
        "Musterstrasse 1",
        "8000 Zurich",
        "Switzerland",
        "",
        "owner@example.com",
        "+41 79 123 45 67",
        "CHE-123.456.789",
    ]
    for line in from_lines:
        pdf.set_xy(15, y)
        pdf.cell(90, 4.5, line)
        y += 4.5

    # ── To ──
    yt = 40
    pdf.set_xy(115, yt)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(30, 6, "To")
    yt += 8

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    to_lines = [customer["name"]]
    if customer.get("address"):
        to_lines.append(customer["address"])
    if customer.get("city"):
        to_lines.append(customer["city"])
    if customer.get("country"):
        to_lines.append(customer["country"])
    to_lines.append("")
    if customer.get("email"):
        to_lines.append(customer["email"])
    if customer.get("reference"):
        to_lines.append(customer["reference"])
    for line in to_lines:
        pdf.set_xy(115, yt)
        pdf.cell(80, 4.5, line)
        yt += 4.5

    # ── Product table ──
    ty = 100

    # Header background
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(15, ty, 183, 9, "F")

    # Header text
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_text_color(30, 30, 30)
    h = ty + 2
    pdf.set_xy(17, h)
    pdf.cell(60, 5, "Product")
    pdf.set_xy(85, h)
    pdf.cell(30, 5, "Hours", align="C")
    pdf.set_xy(118, h)
    pdf.cell(30, 5, "Unit Price", align="C")
    pdf.set_xy(148, h)
    pdf.cell(20, 5, "Tax", align="C")
    pdf.set_xy(170, h)
    pdf.cell(26, 5, "Total", align="R")

    # Data row
    dy = ty + 14
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(17, dy)
    pdf.cell(60, 5, "Engineering Services")

    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(110, 110, 110)
    pdf.set_xy(17, dy + 6)
    pdf.cell(60, 5, f"{month_name} {year}")

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(30, 30, 30)
    row_mid = dy + 3
    pdf.set_xy(85, row_mid)
    hours_str = f"{hours:g}"
    pdf.cell(30, 5, hours_str, align="C")
    pdf.set_xy(118, row_mid)
    pdf.cell(30, 5, f"CHF {RATE:.2f}", align="C")
    pdf.set_xy(148, row_mid)
    pdf.cell(20, 5, "8.1%", align="C")
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_xy(170, row_mid)
    pdf.cell(26, 5, f"CHF {total:,.2f}", align="R")

    # Separator
    sep_y = dy + 14
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.3)
    pdf.line(15, sep_y, 198, sep_y)

    # ── Invoice Summary ──
    sy = sep_y + 10

    # Summary header background
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(120, sy, 78, 10, "F")

    # Bar chart icon
    draw_bar_icon(pdf, 126, sy + 1.5)

    # Summary title
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(142, sy + 1.5)
    pdf.cell(54, 7, "Invoice Summary", align="C")

    # Summary rows
    sy += 14
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(50, 50, 50)
    for label, amount in [("Subtotal", subtotal), ("Tax", tax)]:
        pdf.set_xy(122, sy)
        pdf.cell(38, 7, label)
        pdf.cell(36, 7, f"CHF {amount:,.2f}", align="R")
        sy += 8
    # Total row - bigger and bold
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(122, sy)
    pdf.cell(38, 8, "Total")
    pdf.cell(36, 8, f"CHF {total:,.2f}", align="R")
    sy += 8

    # ── Terms ──
    pdf.set_xy(15, 237)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(40, 5, "Terms")

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    terms_y = 243
    terms = [
        "Payment Information",
        "Account Name: Muster Consulting GmbH",
        "IBAN: CH93 0076 2011 6238 5295 7",
        "BIC: UBSWCHZH80A",
        "Bank: UBS Switzerland AG",
    ]
    for line in terms:
        pdf.set_xy(15, terms_y)
        pdf.cell(120, 5, line)
        terms_y += 5

    return pdf.output()


# ─── Shared rendering helpers ────────────────────────────────────────────────

def _draw_header(pdf, num, issued, due, label="Invoice", customer=None):
    customer = customer or DEFAULT_CUSTOMER

    pdf.set_xy(15, 13)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(100, 7, COMPANY)

    pdf.set_font("Helvetica", "B", 28)
    pdf.set_xy(110, 9)
    pdf.cell(88, 12, f"{label}: {num:04d}", align="R")

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(90, 90, 90)
    pdf.set_xy(110, 22)
    pdf.cell(88, 5, f"Issued on: {issued}", align="R")
    pdf.set_xy(110, 27)
    pdf.cell(88, 5, f"Due by: {due}", align="R")

    # From
    y = 40
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(30, 6, "From")
    y += 8
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    for line in [COMPANY, "Max MUSTER",
                 "c/o Alpen Treuhand AG",
                 "Musterstrasse 1",
                 "8000 Zurich", "Switzerland", "",
                 "owner@example.com", "+41 79 123 45 67", "CHE-123.456.789"]:
        pdf.set_xy(15, y)
        pdf.cell(90, 4.5, line)
        y += 4.5

    # To
    yt = 40
    pdf.set_xy(115, yt)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(30, 6, "To")
    yt += 8
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    to_lines = [customer["name"]]
    if customer.get("address"):
        to_lines.append(customer["address"])
    if customer.get("city"):
        to_lines.append(customer["city"])
    if customer.get("country"):
        to_lines.append(customer["country"])
    to_lines.append("")
    if customer.get("email"):
        to_lines.append(customer["email"])
    if customer.get("reference"):
        to_lines.append(customer["reference"])
    for line in to_lines:
        pdf.set_xy(115, yt)
        pdf.cell(80, 4.5, line)
        yt += 4.5


def _draw_terms(pdf, y):
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(40, 5, "Terms")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    y += 6
    for line in ["Payment Information",
                 "Account Name: Muster Consulting GmbH",
                 "IBAN: CH93 0076 2011 6238 5295 7",
                 "BIC: UBSWCHZH80A",
                 "Bank: UBS Switzerland AG"]:
        pdf.set_xy(15, y)
        pdf.cell(120, 5, line)
        y += 5


# ─── Expense Report PDF ─────────────────────────────────────────────────────

def _latin1_safe(s: str) -> str:
    """Sanitize a string for latin-1 PDF rendering (default fpdf Helvetica)."""
    if not isinstance(s, str):
        return s
    replacements = {
        "—": "-",   # em dash
        "–": "-",   # en dash
        "‘": "'", "’": "'",  # smart single quotes
        "“": '"', "”": '"',  # smart double quotes
        "•": "*",   # bullet
        "…": "...", # ellipsis
        "·": ".",   # middle dot
        " ": " ",   # non-breaking space
        "→": "->",  # right arrow
        "←": "<-",
        "↔": "<->",
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def generate_expense_report(year: int, expenses: list, invoice_num: int,
                             customer: dict | None = None, month: int | None = None) -> bytes:
    """Generate a travel expense invoice (yearly or monthly) with receipt scans.

    expenses: list of dicts with keys date, description, category, amount (CHF),
              optional original_amount, original_currency, and scan_path.
    month: if provided, the report label/heading reflects the specific month
           (e.g. "June 2026") instead of just the year.
    """
    MONTH_NAMES = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"]
    period_label = f"{MONTH_NAMES[month-1]} {year}" if month else f"{year}"
    # Sanitize all string fields for latin-1 PDF rendering
    expenses = [
        {**e, "description": _latin1_safe(e.get("description") or ""),
              "category": _latin1_safe(e.get("category") or ""),
              "original_currency": _latin1_safe(e.get("original_currency") or "") or None}
        for e in expenses
    ]
    customer = customer or DEFAULT_CUSTOMER
    today = date.today()
    issued = today
    due_m = today.month + 1 if today.month < 12 else 1
    due_y = today.year if today.month < 12 else today.year + 1
    due = date(due_y, due_m, calendar.monthrange(due_y, due_m)[1])

    total_chf = round(sum(e["amount"] for e in expenses), 2)
    count = len(expenses)
    sorted_exp = sorted(expenses, key=lambda e: e["date"])
    has_originals = any(e.get("original_currency") for e in expenses)

    pdf = InvoicePDF()
    pdf.set_auto_page_break(False)
    pdf.add_page()
    PAGE_BOTTOM = 260

    # ── Page 1: Invoice ──
    _draw_header(pdf, invoice_num, issued, due, label="Invoice", customer=customer)

    # Product table header
    ty = 105
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(15, ty, 183, 9, "F")
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_text_color(30, 30, 30)
    h = ty + 2
    pdf.set_xy(17, h)
    pdf.cell(90, 5, "Product")
    pdf.set_xy(148, h)
    pdf.cell(20, 5, "Tax", align="C")
    pdf.set_xy(170, h)
    pdf.cell(26, 5, "Total", align="R")

    # Product row
    dy = ty + 14
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(17, dy)
    pdf.cell(90, 5, "Travel Expenses")
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(110, 110, 110)
    pdf.set_xy(17, dy + 6)
    pdf.cell(90, 5, f"Total exp. for {period_label} ({count} receipts)")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(148, dy + 3)
    pdf.cell(20, 5, "0%", align="C")
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_xy(170, dy + 3)
    pdf.cell(26, 5, f"CHF {total_chf:,.2f}", align="R")

    # Separator
    sep_y = dy + 16
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.3)
    pdf.line(15, sep_y, 198, sep_y)

    # Invoice Summary
    sy = sep_y + 10
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(120, sy, 78, 10, "F")
    draw_bar_icon(pdf, 126, sy + 1.5)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(142, sy + 1.5)
    pdf.cell(54, 7, "Invoice Summary", align="C")

    sy += 14
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(50, 50, 50)
    pdf.set_xy(122, sy)
    pdf.cell(38, 7, "Subtotal")
    pdf.cell(36, 7, f"CHF {total_chf:,.2f}", align="R")
    sy += 8
    pdf.set_xy(122, sy)
    pdf.cell(38, 7, "Tax (0%)")
    pdf.cell(36, 7, "CHF 0.00", align="R")
    sy += 8
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(122, sy)
    pdf.cell(38, 8, "Total")
    pdf.cell(36, 8, f"CHF {total_chf:,.2f}", align="R")


    # Exchange rate note (only if there are non-CHF expenses)
    if has_originals:
        currencies = set(e.get("original_currency") for e in expenses if e.get("original_currency"))
        rate_parts = []
        rates = {"AED": AED_TO_CHF, "USD": 0.88, "EUR": 0.94}
        for cur in sorted(currencies):
            if cur in rates:
                rate_parts.append(f"1 {cur} = {rates[cur]} CHF")
        if rate_parts:
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(130, 130, 130)
            pdf.set_xy(15, 228)
            pdf.cell(120, 5, "Exchange rates: " + ", ".join(rate_parts))

    # Terms
    _draw_terms(pdf, 237)

    # ── Page 2+: Detailed breakdown ──
    ROW_H = 6.5

    def detail_header(y):
        pdf.set_fill_color(215, 225, 232)
        pdf.rect(15, y, 183, 9, "F")
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(30, 30, 30)
        h = y + 2.5
        pdf.set_xy(17, h)
        pdf.cell(8, 4, "Ref")
        pdf.set_xy(26, h)
        pdf.cell(18, 4, "Date")
        pdf.set_xy(45, h)
        pdf.cell(55, 4, "Description")
        pdf.set_xy(103, h)
        pdf.cell(22, 4, "Category")
        pdf.set_xy(128, h)
        pdf.cell(33, 4, "Original", align="R")
        pdf.set_xy(165, h)
        pdf.cell(31, 4, "CHF", align="R")
        return y + 11

    # Collect conversion rates used
    currencies_used = set(e.get("original_currency") for e in expenses if e.get("original_currency"))
    rates_map = {"AED": AED_TO_CHF, "USD": 0.88, "EUR": 0.94}

    pdf.add_page()
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(15, 13)
    pdf.cell(100, 7, "Expense Details")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.set_xy(15, 21)
    pdf.cell(100, 5, f"Invoice {invoice_num:04d} - Travel Expenses {period_label}")

    # Conversion rates note below title
    start_y = 28
    if currencies_used:
        rate_parts = [f"1 {c} = {rates_map[c]} CHF" for c in sorted(currencies_used) if c in rates_map]
        if rate_parts:
            pdf.set_font("Helvetica", "I", 8)
            pdf.set_text_color(130, 130, 130)
            pdf.set_xy(15, start_y)
            pdf.cell(180, 4, "Conversion rates: " + "  |  ".join(rate_parts))
            start_y += 6

    ty = detail_header(start_y + 2)

    for idx, exp in enumerate(sorted_exp, 1):
        if ty + ROW_H > PAGE_BOTTOM:
            pdf.add_page()
            ty = detail_header(15)

        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(100, 100, 100)
        pdf.set_xy(17, ty)
        pdf.cell(8, 5, str(idx))

        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(26, ty)
        pdf.cell(18, 5, exp["date"])
        pdf.set_xy(45, ty)
        desc = exp["description"]
        if len(desc) > 35:
            desc = desc[:32] + "..."
        pdf.cell(55, 5, desc)
        pdf.set_xy(103, ty)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(22, 5, exp["category"])

        # Original amount column
        orig_amt = exp.get("original_amount")
        orig_cur = exp.get("original_currency")
        pdf.set_font("Helvetica", "", 7.5)
        pdf.set_xy(128, ty)
        if orig_amt and orig_cur:
            pdf.set_text_color(80, 80, 80)
            pdf.cell(33, 5, f"{orig_cur} {orig_amt:,.2f}", align="R")
        else:
            pdf.cell(33, 5, "", align="R")

        # CHF amount (always)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(165, ty)
        pdf.cell(31, 5, f"{exp['amount']:,.2f}", align="R")
        ty += ROW_H

    # Detail total
    ty += 2
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.3)
    pdf.line(15, ty, 198, ty)
    ty += 4
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(130, ty)
    pdf.cell(32, 6, f"Total ({count})")
    pdf.cell(34, 6, f"CHF {total_chf:,.2f}", align="R")

    # ── Receipt scan pages ──
    # For multi-page PDF scans (e.g. Uber receipt + Rechnung merged into one PDF),
    # emit one report page PER source page so nothing is dropped. Each page keeps
    # the same reference header so the reader can see which expense it belongs to.
    for idx, exp in enumerate(sorted_exp, 1):
        scan_path = exp.get("scan_path")
        if not scan_path or not Path(scan_path).exists():
            continue

        chf_amt = exp["amount"]
        orig_amt = exp.get("original_amount")
        orig_cur = exp.get("original_currency")

        # Materialize source pages as PNGs
        source_pages = []
        temp_files = []
        try:
            if str(scan_path).lower().endswith(".pdf"):
                import fitz  # PyMuPDF
                doc = fitz.open(scan_path)
                for page_idx in range(doc.page_count):
                    pix = doc[page_idx].get_pixmap(dpi=200)
                    tmp = str(Path(scan_path).with_suffix(f".tmp_p{page_idx}.png"))
                    pix.save(tmp)
                    source_pages.append(tmp)
                    temp_files.append(tmp)
                doc.close()
            else:
                source_pages.append(scan_path)
        except Exception:
            source_pages = []

        # Emit one report page per source-scan page
        total_pages = len(source_pages) or 1
        for page_no, img_file in enumerate(source_pages or [None], start=1):
            pdf.add_page()

            # Reference header (repeat on every page so context is preserved)
            pdf.set_fill_color(215, 225, 232)
            pdf.rect(15, 12, 183, 12, "F")
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(30, 30, 30)
            pdf.set_xy(17, 14)
            ref_label = f"Ref {idx}"
            if total_pages > 1:
                ref_label += f" ({page_no}/{total_pages})"
            pdf.cell(30, 8, ref_label)
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(50, 50, 50)
            pdf.set_xy(35, 14)
            pdf.cell(100, 8, f"{exp['date']}  |  {exp['description']}")
            if orig_amt and orig_cur:
                pdf.set_font("Helvetica", "", 8)
                pdf.set_text_color(120, 120, 120)
                pdf.set_xy(125, 14)
                pdf.cell(30, 8, f"{orig_cur} {orig_amt:,.2f}", align="R")
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(30, 30, 30)
            pdf.set_xy(158, 14)
            pdf.cell(38, 8, f"CHF {chf_amt:,.2f}", align="R")

            # Scan image - fit within page bounds
            max_w, max_h = 180, 245
            if img_file:
                try:
                    from PIL import Image as PILImage
                    with PILImage.open(img_file) as im:
                        iw, ih = im.size
                    ratio = min(max_w / iw, max_h / ih)
                    w = iw * ratio
                    h = ih * ratio
                    img_x = 15 + (max_w - w) / 2
                    pdf.image(img_file, x=img_x, y=30, w=w, h=h)
                except Exception:
                    pdf.set_font("Helvetica", "I", 9)
                    pdf.set_text_color(150, 150, 150)
                    pdf.set_xy(15, 140)
                    pdf.cell(180, 10, "Scan page could not be loaded", align="C")
            else:
                pdf.set_font("Helvetica", "I", 9)
                pdf.set_text_color(150, 150, 150)
                pdf.set_xy(15, 140)
                pdf.cell(180, 10, "Scan could not be loaded", align="C")

        # Clean up temp files
        for tmp in temp_files:
            if Path(tmp).exists():
                Path(tmp).unlink()

    return pdf.output()


# ─── Payslip PDF ────────────────────────────────────────────────────────────

def generate_payslip(year: int, month: int, issued_date: str, payment_date: str,
                     settings: dict, calc: dict, ytd: dict) -> bytes:
    """Generate a Swiss monthly salary slip PDF."""
    pdf = InvoicePDF()
    pdf.set_auto_page_break(False)
    pdf.add_page()

    month_name = calendar.month_name[month]

    # ── Header ──
    pdf.set_xy(15, 13)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(100, 7, settings["employer_name"])

    pdf.set_font("Helvetica", "B", 22)
    pdf.set_xy(110, 10)
    pdf.cell(88, 10, f"Salary Slip", align="R")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.set_xy(110, 21)
    pdf.cell(88, 5, f"{month_name} {year}", align="R")
    pdf.set_xy(110, 26)
    pdf.cell(88, 5, f"Payment date: {payment_date}", align="R")

    # ── Employer / Employee blocks ──
    y = 40
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(30, 6, "Employer")
    pdf.set_xy(115, y)
    pdf.cell(30, 6, "Employee")
    y += 8

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 50)
    employer_lines = [settings["employer_name"], "c/o Alpen Treuhand AG",
                      "Musterstrasse 1", "8000 Zurich", "Switzerland"]
    employee_lines = [settings["employee_name"]]
    if settings.get("employee_address"):
        addr_parts = settings["employee_address"].split(",")
        employee_lines.extend([p.strip() for p in addr_parts])

    for i in range(max(len(employer_lines), len(employee_lines))):
        if i < len(employer_lines):
            pdf.set_xy(15, y)
            pdf.cell(90, 4.5, employer_lines[i])
        if i < len(employee_lines):
            pdf.set_xy(115, y)
            pdf.cell(80, 4.5, employee_lines[i])
        y += 4.5

    # ── Period ──
    y = 72
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(15, y, 183, 8, "F")
    pdf.set_font("Helvetica", "B", 9.5)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(17, y + 2)
    pdf.cell(100, 5, f"Pay period: {month_name} {year}  ({year}-{month:02d}-01 to {issued_date})")
    pdf.set_xy(150, y + 2)
    pdf.cell(46, 5, f"Canton: {settings['canton']}", align="R")

    # ── Table: Earnings ──
    cur = settings.get("currency", "CHF")

    def section_header(y, title):
        pdf.set_fill_color(240, 244, 248)
        pdf.rect(15, y, 183, 7, "F")
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(17, y + 1.5)
        pdf.cell(180, 4, title)
        return y + 9

    def line(y, label, amount, note="", bold=False, color=None):
        pdf.set_font("Helvetica", "B" if bold else "", 9)
        c = color if color else (30, 30, 30)
        pdf.set_text_color(*c)
        pdf.set_xy(17, y)
        pdf.cell(90, 5, label)
        if note:
            pdf.set_font("Helvetica", "I", 8)
            pdf.set_text_color(130, 130, 130)
            pdf.set_xy(107, y)
            pdf.cell(50, 5, note)
        pdf.set_font("Helvetica", "B" if bold else "", 9)
        pdf.set_text_color(*c)
        pdf.set_xy(160, y)
        pdf.cell(36, 5, f"{cur} {amount:,.2f}", align="R")
        return y + 6

    ty = 88
    ty = section_header(ty, "Earnings")
    ty = line(ty, "Gross salary", calc["gross"], bold=True)
    ty += 3

    # Employee deductions
    ty = section_header(ty, "Employee deductions")
    ahv_rate = settings["ahv_employee_pct"]
    alv_rate = settings["alv_employee_pct"]
    ktg_emp_share = 100 - settings["ktg_employer_share_pct"]
    ty = line(ty, "AHV / IV / EO", calc["emp_ahv"], f"Official {ahv_rate}%")
    ty = line(ty, "ALV (unemployment)", calc["emp_alv"], f"Official {alv_rate}% / 0.5% above plafond")
    ty = line(ty, f"BVG - 2nd pillar ({settings.get('bvg_provider') or 'AXA'})",
              calc["emp_bvg"], "Exact")
    ty = line(ty, "UVG - Non-occupational accident (AXA)", calc["emp_uvg"], "Exact")
    ty = line(ty, f"KTG - Daily sickness ({ktg_emp_share:.0f}%)", calc["emp_ktg"], "Exact")
    if calc.get("emp_source_tax", 0) > 0:
        tariff = settings.get("source_tax_tariff", "")
        ty = line(ty, f"Source Tax (Quellensteuer){' - ' + tariff if tariff else ''}",
                  calc["emp_source_tax"], "Per tariff")
    # Separator + total
    pdf.set_draw_color(200, 200, 200); pdf.set_line_width(0.3)
    pdf.line(17, ty, 196, ty); ty += 2
    ty = line(ty, "Total deductions", calc["emp_total_deductions"], bold=True, color=(180, 40, 40))
    ty += 3

    # Net
    pdf.set_fill_color(215, 232, 218)
    pdf.rect(15, ty, 183, 10, "F")
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(20, 70, 40)
    pdf.set_xy(17, ty + 2.5)
    pdf.cell(100, 5, "Net salary")
    pdf.set_xy(150, ty + 2.5)
    pdf.cell(46, 5, f"{cur} {calc['net_salary']:,.2f}", align="R")
    ty += 14

    # Employer contributions
    ty = section_header(ty, "Employer contributions (not deducted from net)")
    ahv_er = settings["ahv_employer_pct"]
    alv_er = settings["alv_employer_pct"]
    ktg_er = settings["ktg_employer_share_pct"]
    fak_pct = settings.get("fak_employer_pct", 0)
    ty = line(ty, "AHV / IV / EO", calc["employer_ahv"], f"Official {ahv_er}%")
    ty = line(ty, "ALV (unemployment)", calc["employer_alv"], f"Official {alv_er}% / 0.5% above plafond")
    ty = line(ty, f"BVG - 2nd pillar ({settings.get('bvg_provider') or 'AXA'})",
              calc["employer_bvg"], "Exact")
    ty = line(ty, "UVG - Occupational + Supplementary (AXA)", calc["employer_uvg"], "Exact")
    ty = line(ty, f"KTG - Daily sickness ({ktg_er:.0f}%)", calc["employer_ktg"], "Exact")
    if calc.get("employer_fak", 0) > 0:
        ty = line(ty, "FAK (Family Allowance Fund)", calc["employer_fak"],
                  f"Zurich ~{fak_pct}%")
    pdf.line(17, ty, 196, ty); ty += 2
    ty = line(ty, "Total employer contributions", calc["employer_total"], bold=True)
    ty += 3

    # Total employer cost
    pdf.set_fill_color(215, 225, 232)
    pdf.rect(15, ty, 183, 10, "F")
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(17, ty + 2.5)
    pdf.cell(100, 5, "Total employer cost (gross + employer contributions)")
    pdf.set_xy(150, ty + 2.5)
    pdf.cell(46, 5, f"{cur} {calc['total_employer_cost']:,.2f}", align="R")
    ty += 14

    # YTD
    if ytd and ytd.get("gross", 0) > 0:
        ty = section_header(ty, f"Year-to-date totals ({year})")
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(60, 60, 60)
        cols = [
            ("Gross", ytd["gross"]),
            ("Net", ytd["net_salary"]),
            ("Employee deductions", ytd["emp_total_deductions"]),
            ("Employer contributions", ytd["employer_total"]),
            ("Total employer cost", ytd["total_employer_cost"]),
        ]
        for label, val in cols:
            pdf.set_xy(17, ty)
            pdf.cell(90, 4.5, label)
            pdf.set_xy(160, ty)
            pdf.cell(36, 4.5, f"{cur} {val:,.2f}", align="R")
            ty += 5.5

    # Footer note
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.set_text_color(140, 140, 140)
    pdf.set_xy(15, 278)
    pdf.cell(183, 4, "Exact = contractual values from BVG/KTG provider. Est. = estimated Swiss standard rates.", align="C")
    pdf.set_xy(15, 282)
    pdf.cell(183, 4, f"Issued on {issued_date} · {settings['employer_name']} · Canton of {settings['canton']}", align="C")

    return pdf.output()


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate invoice PDF for Muster Consulting GmbH"
    )
    parser.add_argument(
        "--month", required=True,
        help="Invoice month in YYYY-MM format (e.g. 2026-03)",
    )
    parser.add_argument(
        "--hours", required=True, type=float,
        help="Number of hours worked",
    )
    parser.add_argument(
        "--invoice-number", type=int,
        help="Invoice number (auto-increments from 0017 if omitted)",
    )
    parser.add_argument(
        "-o", "--output",
        help="Output file path (auto-generated if omitted)",
    )
    args = parser.parse_args()

    # Parse month
    try:
        parts = args.month.split("-")
        year, month = int(parts[0]), int(parts[1])
        if not 1 <= month <= 12:
            raise ValueError
    except (ValueError, IndexError):
        print(f"Error: Invalid month '{args.month}'. Use YYYY-MM format.", file=sys.stderr)
        sys.exit(1)

    inv_num = args.invoice_number if args.invoice_number else get_next_invoice_number()

    pdf_bytes = generate(year, month, args.hours, inv_num)

    if args.output:
        out_path = Path(args.output)
    else:
        month_name = calendar.month_name[month]
        out_path = SCRIPT_DIR / f"Invoice {month_name} {year} {COMPANY} 101119.LOD-SW_GCS-24032.pdf"

    out_path.write_bytes(pdf_bytes)
    save_invoice_number(inv_num)

    subtotal = args.hours * RATE
    tax = round(subtotal * VAT_RATE, 2)
    total = round(subtotal + tax, 2)

    print(f"Invoice #{inv_num:04d} generated: {out_path.name}")
    print(f"  {args.hours}h x CHF {RATE:.2f} = CHF {subtotal:,.2f}")
    print(f"  VAT 8.1%: CHF {tax:,.2f}")
    print(f"  Total: CHF {total:,.2f}")


if __name__ == "__main__":
    main()
