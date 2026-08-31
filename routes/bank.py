"""Bank statements — uploaded monthly account statements (UBS or other).

Each period can have BOTH:
  - PDF: the official statement (audit / legal record)
  - XML: CAMT.053 (machine-readable, auto-parsed for balances + period)

XML upload auto-fills empty form fields (period, balance, IBAN, currency).
Stored verbatim and included in the accountant_package ZIP.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from db import get_db
from helpers import (
    delete_stored_file, parse_camt053, parse_ubs_csv, hashed_filename,
)

router = APIRouter()


_paths = {}

def configure(bank_dir: Path):
    _paths["BANK_DIR"] = bank_dir


def _row_to_dict(r) -> dict:
    return {
        "id": r["id"],
        "bank": r["bank"],
        "account_label": r["account_label"],
        "iban": r["iban"],
        "period_start": r["period_start"],
        "period_end": r["period_end"],
        "statement_type": r["statement_type"],
        "opening_balance": r["opening_balance"],
        "closing_balance": r["closing_balance"],
        "currency": r["currency"],
        "statement_file_pdf": r["statement_file_pdf"],
        "statement_file_xml": r["statement_file_xml"],
        "has_pdf": r["statement_file_pdf"] is not None,
        "has_xml": r["statement_file_xml"] is not None,
        "notes": r["notes"],
        "created_at": r["created_at"],
    }


async def _save_file(file: UploadFile | None, prefix: str = "bank") -> str | None:
    """Hash-based dedup save — same content → same filename."""
    if not file or not file.filename:
        return None
    raw = await file.read()
    ext = Path(file.filename).suffix.lower()
    fname = hashed_filename(prefix, ext, raw)
    path = _paths["BANK_DIR"] / fname
    if not path.exists():
        path.write_bytes(raw)
    return fname


async def _read_xml_bytes(file: UploadFile | None) -> bytes | None:
    if not file or not file.filename:
        return None
    raw = await file.read()
    # Reset for downstream consumers if any
    file.file.seek(0)
    return raw


@router.get("/bank-statements")
async def list_statements(year: int | None = None):
    sql = "SELECT * FROM bank_statements"
    args = []
    if year:
        sql += " WHERE substr(period_end,1,4)=?"
        args.append(str(year))
    sql += " ORDER BY period_end DESC, id DESC"
    with get_db() as db:
        rows = db.execute(sql, args).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/bank-statements/years")
async def list_years():
    with get_db() as db:
        rows = db.execute(
            "SELECT DISTINCT substr(period_end,1,4) AS y FROM bank_statements ORDER BY y DESC"
        ).fetchall()
    return [r["y"] for r in rows]


@router.get("/bank-statements/latest")
async def latest_statement():
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM bank_statements "
            "ORDER BY period_end DESC, id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return {"present": False}
    d = _row_to_dict(row)
    d["present"] = True
    return d


@router.post("/bank-statements/{id}/analyze")
async def analyze_statement(id: int):
    """Read-only analysis of a stored statement (XML or UBS CSV).
    Returns a list of PROPOSED actions — no DB writes. The caller decides
    which to apply via the existing propose/apply UI mechanism.
    """
    with get_db() as db:
        row = db.execute("SELECT * FROM bank_statements WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Statement not found")
        # Read the most useful structured file we have
        bank_dir = _paths["BANK_DIR"]
        data = None
        source = None
        if row["statement_file_xml"]:
            fp = bank_dir / row["statement_file_xml"]
            if fp.exists():
                raw = fp.read_bytes()
                # Could be XML (CAMT.053) or CSV (UBS native)
                if raw.lstrip()[:1] == b"<":
                    parsed = parse_camt053(raw)
                    source = "CAMT.053 XML"
                    if "error" not in parsed:
                        data = {"header": parsed, "transactions": []}  # XML path has no individual transactions in this parser yet
                else:
                    data = parse_ubs_csv(raw)
                    source = "UBS CSV"
        if not data:
            return {"error": "No machine-readable statement file (XML/CSV) attached"}
        if "error" in data:
            return {"error": data["error"], "source": source}

        # Load currently-known data to detect duplicates / matches
        existing_invoices = {
            r["invoice_number"]: dict(r) for r in db.execute(
                "SELECT id, invoice_number, total, paid_status, paid_date, year, month "
                "FROM invoices ORDER BY invoice_number"
            ).fetchall()
        }
        existing_bill_vendors = set(
            (r["vendor"] or "").lower()
            for r in db.execute("SELECT DISTINCT vendor FROM company_docs").fetchall()
        )
        unpaid_obligations = [dict(r) for r in db.execute(
            "SELECT id, obligation_type, period_label, amount, due_date, notes "
            "FROM obligations WHERE status='unpaid'"
        ).fetchall()]
        # Owner-ledger reconciliation: logged transfers + payslip nets, so
        # owner in/outflows can be matched instead of proposed twice.
        logged_transfers = [dict(r) for r in db.execute(
            "SELECT id, transfer_date, direction, amount, description FROM account_transfers"
        ).fetchall()]
        payslip_nets = [r["net_salary"] for r in db.execute(
            "SELECT DISTINCT net_salary FROM payslips"
        ).fetchall()]

    # Vendor → category map for known recurring patterns
    VENDOR_CATEGORY = {
        "notariat":            ("Professional Services", "Notary fees"),
        "grundbuch":           ("Professional Services", "Land registry"),
        "konkursamt":          ("Professional Services", "Bankruptcy office"),
        "handelsregisteramt":  ("Professional Services", "Handelsregister filing"),
        "kanton zuerich":      ("Professional Services", "Cantonal fees"),
        "kanton zürich":       ("Professional Services", "Cantonal fees"),
        "helvetia":            ("Insurance", "Vehicle insurance"),
        "axa insurance":       ("Payroll Settlement", "AXA UVG/UVGZ/KTG annual premium"),
        "strassenverkehrsamt": ("Other", "Vehicle road tax"),
        "salt mobile":         ("Telecom", "Mobile phone"),
        "swisscom":            ("Telecom", "Mobile/internet"),
        "digitec":             ("Office Supplies", "Electronics"),
        "galaxus":             ("Office Supplies", "Electronics"),
        "ubs":                 ("Bank Fees", "Bank service charge"),
    }

    proposals = []
    salary_total = 0.0
    salary_payments = []

    def _classify_counterparty(desc: str) -> tuple[str, tuple[str, str] | None]:
        """Return (clean vendor name, optional (category, label)) from raw desc."""
        if not desc:
            return ("Unknown", None)
        # UBS uses semicolons inside the description; first chunk is usually the name
        clean = desc.split(";", 1)[0].strip()
        lower = clean.lower()
        for needle, cat in VENDOR_CATEGORY.items():
            if needle in lower:
                return (clean, cat)
        return (clean, None)

    def _emit_proposal(p_type, summary, payload, endpoint, method="POST", fmt="form",
                       confidence="high", notes=""):
        proposals.append({
            "type":       p_type,
            "summary":    summary,
            "payload":    payload,
            "endpoint":   endpoint,
            "method":     method,
            "format":     fmt,
            "confidence": confidence,
            "notes":      notes,
        })

    # ── Owner-ledger reconciliation helpers ─────────────────────────────
    from datetime import datetime as _ledger_dt
    _matched_transfer_ids = set()

    def _find_logged_transfer(amount_abs: float, tx_date: str, direction: str):
        """Logged transfer matching this bank movement (amount ±0.05, date
        ±7 days). Each logged row matches at most one bank transaction."""
        try:
            d = _ledger_dt.strptime((tx_date or "")[:10], "%Y-%m-%d")
        except ValueError:
            return None
        for t in logged_transfers:
            if t["id"] in _matched_transfer_ids or t["direction"] != direction:
                continue
            if abs(float(t["amount"]) - amount_abs) > 0.05:
                continue
            try:
                td = _ledger_dt.strptime(t["transfer_date"][:10], "%Y-%m-%d")
            except ValueError:
                continue
            if abs((d - td).days) <= 7:
                _matched_transfer_ids.add(t["id"])
                return t
        return None

    def _looks_like_net_salary(amount_abs: float) -> bool:
        """Within 10% (min 100) of any issued payslip's net salary."""
        for net in payslip_nets:
            if abs(amount_abs - net) <= max(100, net * 0.10):
                return True
        return False

    # ── Obligation matching (outflows → mark AHV/BVG/VAT/UVG/KTG paid) ──
    OBLIGATION_KEYWORDS = {
        "bvg_employer":          ("axa", "vorsorge", "foundation", "stiftung"),
        "bvg_employee":          ("axa", "vorsorge", "foundation", "stiftung"),
        "vat":                   ("estv", "eidg", "steuerverwaltung", "mwst", "mehrwertsteuer", "vat"),
        "ahv":                   ("ausgleichskasse", "sva", "ahv"),
        "corporate_tax_federal": ("steuerverwaltung", "steueramt"),
        "corporate_tax_cantonal": ("steueramt", "gemeindesteuer", "staatssteuer"),
        "other":                 ("axa",),   # UVG / KTG run through AXA
    }
    matched_obligation_ids = set()

    def _match_obligations(amount_abs: float, text: str) -> list:
        """Unpaid obligations settled by this outflow: exact single match, or a
        same-type/same-due-date group summing to it (AXA bills BVG quarterly =
        three monthly rows)."""
        t = (text or "").lower()
        candidates = [o for o in unpaid_obligations
                      if o["id"] not in matched_obligation_ids
                      and any(k in t for k in OBLIGATION_KEYWORDS.get(o["obligation_type"], ()))]
        for o in candidates:
            if abs(o["amount"] - amount_abs) <= 0.05:
                return [o]
        from collections import defaultdict
        from itertools import combinations
        groups = defaultdict(list)
        for o in candidates:
            groups[(o["obligation_type"], o["due_date"])].append(o)
        for grp in groups.values():
            if len(grp) < 2 or len(grp) > 12:   # combinatorial safety cap
                continue
            # Largest subset first, so a full quarterly group (3 monthly BVG
            # rows) beats an accidental 2-row combination.
            for size in range(len(grp), 1, -1):
                for combo in combinations(grp, size):
                    if abs(sum(g["amount"] for g in combo) - amount_abs) <= 0.05:
                        return list(combo)
        return []

    def _emit_obligation_matches(matched, amount_abs, date, tx_no) -> None:
        for o in matched:
            matched_obligation_ids.add(o["id"])
            what = (o["notes"] or o["obligation_type"]).split("—")[0].strip()[:60]
            part = f" — part of a CHF {amount_abs:,.2f} payment" if len(matched) > 1 else ""
            _emit_proposal(
                "mark_obligation_paid",
                f"Obligation paid: {what} ({o['period_label']}, CHF {o['amount']:,.2f}) "
                f"settled by bank outflow on {date}{part}",
                {"status": "paid"},
                f"/api/obligations/{o['id']}/status", method="PATCH", fmt="json",
                confidence="high",
                notes=f"Matched bank tx no. {tx_no}",
            )

    # Walk every transaction (and its sub-entries) and emit proposals
    for tx in data.get("transactions", []):
        amt = tx["amount"]
        desc1 = tx["description1"]
        desc2 = tx["description2"]
        desc3 = tx["description3"]
        date = tx["trade_date"]
        sub_entries = tx.get("sub_entries", [])

        # ── Incoming credits ──
        if amt > 0:
            vendor, _ = _classify_counterparty(desc1)
            # Shareholder loan from Max
            if "muster" in vendor.lower():
                if _find_logged_transfer(amt, date, "personal_to_gmbh"):
                    continue   # already reconciled in the owner ledger
                _emit_proposal(
                    "add_shareholder_loan",
                    f"Shareholder loan in: CHF {amt:,.2f} from {vendor} on {date}",
                    {"loan_date": date, "amount": amt, "currency": "CHF",
                     "direction": "shareholder_to_gmbh", "is_subordinated": 0,
                     "notes": f"From bank tx no. {tx['transaction_no']}. Rangrücktritt status unknown — please confirm."},
                    "/api/shareholder-loans", confidence="high",
                    notes="Needs Rangrücktritt paperwork for OR 725a/b protection.",
                )
                continue
            # Initial share-capital release (Freigabe Kapital from Muster Consulting)
            if "muster consulting" in vendor.lower() and "freigabe" in (desc3.lower() + desc2.lower()):
                _emit_proposal(
                    "info_only",
                    f"Share capital release: CHF {amt:,.2f} on {date} (no action — this IS the share capital being booked)",
                    {}, "", confidence="high",
                    notes="This is the founding capital appearing as a transaction. No DB action.",
                )
                continue
            # Acme invoice payment — try to identify which invoice
            if "acme" in vendor.lower():
                # UBS embeds the invoice number in description2 (e.g., "30.04.2026 0024")
                ref_text = (desc2 + " " + desc3).lower()
                matched_num = None
                for inv_num in existing_invoices:
                    needle = f"{inv_num:04d}"
                    if needle in ref_text:
                        matched_num = inv_num
                        break
                # Fall back: match by amount
                if not matched_num:
                    for inv_num, inv in existing_invoices.items():
                        if abs(float(inv["total"]) - amt) < 0.05:
                            matched_num = inv_num
                            break
                if matched_num:
                    inv = existing_invoices[matched_num]
                    if inv["paid_status"] == "paid" and inv["paid_date"] == date:
                        continue  # already correctly marked
                    _emit_proposal(
                        "mark_invoice_paid",
                        f"Invoice #{matched_num:04d} (CHF {inv['total']:,.2f}) paid on {date} "
                        f"(current DB status: {inv['paid_status']}, paid_date={inv['paid_date'] or '—'})",
                        {"status": "paid", "paid_date": date},
                        f"/api/invoices/{inv['id']}/status", method="PATCH", fmt="json",
                        confidence="high",
                    )
                else:
                    # Looks like an invoice payment but no matching invoice in DB
                    _emit_proposal(
                        "info_only",
                        f"Incoming Acme payment CHF {amt:,.2f} on {date} — no matching invoice in DB. "
                        f"Ref: '{desc2}'. Likely an expense-report reimbursement (#21, #22, #23) "
                        f"that we'd need to first re-create as invoices, then mark paid. "
                        f"Recommended: add the original expense report invoice via Invoices page, then re-run Analyze.",
                        {}, "", confidence="medium",
                        notes="Two-step: (1) create the missing invoice, (2) mark it paid.",
                    )
                continue
            # Generic incoming — likely a refund or other credit
            vendor_disp, hint = _classify_counterparty(desc1)
            _emit_proposal(
                "info_only",
                f"Other credit: CHF {amt:,.2f} from {vendor_disp} on {date} — '{desc2 or 'no description'}'",
                {}, "", confidence="low",
                notes="Generic credit; review whether it's a refund, transfer, or other income.",
            )
            continue

        # ── Outgoing debits ──
        # Payments to Max: salary-like amounts aggregate silently; anything
        # else is an owner movement — reconcile against the ledger, propose
        # logging it as a transfer when it isn't there yet.
        if "muster" in desc1.lower():
            if _looks_like_net_salary(abs(amt)):
                salary_total += abs(amt)
                salary_payments.append((date, abs(amt), desc2 or "salary"))
                continue
            if _find_logged_transfer(abs(amt), date, "gmbh_to_personal"):
                continue   # already reconciled in the owner ledger
            _emit_proposal(
                "add_transfer",
                f"Owner payment not in the ledger: CHF {abs(amt):,.2f} to you on {date} — log as GmbH → Personal transfer",
                {"transfer_date": date, "direction": "gmbh_to_personal",
                 "amount": abs(amt), "currency": "CHF",
                 "description": f"From bank tx no. {tx['transaction_no']} — {(desc2 or 'purpose unknown, please edit')[:80]}"},
                "/api/transfers", confidence="medium",
                notes="Not salary-sized and not in the owner ledger. If it's a reimbursement or advance, adjust the description after applying.",
            )
            continue
        # Car purchase (special case — vendor pattern + amount)
        if "zeroshtat" in desc1.lower() or "BMW" in (desc2 + desc3):
            _emit_proposal(
                "add_vehicle",
                f"Vehicle purchase: CHF {abs(amt):,.2f} to {desc1.split(';')[0].strip()} on {date} ({desc2 or 'BMW'})",
                {"name": "BMW 330", "vendor": desc1.split(";")[0].strip(),
                 "purchase_date": date, "purchase_price": abs(amt),
                 "notes": f"Bank tx no. {tx['transaction_no']}. {desc2}"},
                "/api/vehicles", confidence="high",
                notes="Privatanteil: 0.9 % × purchase_price = CHF {:.2f}/mo on the Lohnabrechnung. Depreciation: 40 % degressive (default) or 20 % linear.".format(abs(amt) * 0.009),
            )
            continue
        # Settles one (or a group of) unpaid obligations? Propose mark-paid
        # instead of booking a duplicate bill.
        matched = _match_obligations(abs(amt), f"{desc1} {desc2} {desc3}")
        if matched:
            _emit_obligation_matches(matched, abs(amt), date, tx["transaction_no"])
            continue
        # Multi-order with sub-entries → emit each sub-entry as a bill proposal
        if sub_entries:
            for sub in sub_entries:
                sub_vendor, cat = _classify_counterparty(sub["description1"])
                sub_amt = abs(sub["amount"])
                sub_matched = _match_obligations(sub_amt, f"{sub['description1']} {sub.get('description2','')}")
                if sub_matched:
                    _emit_obligation_matches(sub_matched, sub_amt, date, tx["transaction_no"])
                    continue
                if cat:
                    bill_cat, label = cat
                else:
                    bill_cat, label = ("Other", sub_vendor)
                _emit_proposal(
                    "add_bill",
                    f"Bill {sub_vendor}: CHF {sub_amt:,.2f} on {date} ({label})",
                    {"doc_date": date, "vendor": sub_vendor,
                     "description": label,
                     "amount": sub_amt, "currency": "CHF",
                     "category": bill_cat, "status": "paid", "recurrence": "none"},
                    "/api/accounting", confidence="high",
                    notes=f"From multi-order tx no. {tx['transaction_no']}",
                )
            continue
        # Single-vendor debit (standalone)
        vendor, cat = _classify_counterparty(desc1)
        # Bank fees ("Balance closing of service prices")
        if "balance closing" in (desc1 + desc2).lower():
            if abs(amt) < 0.01:
                continue  # silent (CHF 0.00 closing)
            _emit_proposal(
                "add_bill",
                f"Bill UBS bank fee: CHF {abs(amt):,.2f} on {date}",
                {"doc_date": date, "vendor": "UBS",
                 "description": "Service price closing",
                 "amount": abs(amt), "currency": "CHF",
                 "category": "Bank Fees", "status": "paid", "recurrence": "monthly"},
                "/api/accounting", confidence="medium",
            )
            continue
        if cat:
            bill_cat, label = cat
        else:
            bill_cat, label = ("Other", desc2 or vendor)
        _emit_proposal(
            "add_bill",
            f"Bill {vendor}: CHF {abs(amt):,.2f} on {date} ({label})",
            {"doc_date": date, "vendor": vendor, "description": label,
             "amount": abs(amt), "currency": "CHF",
             "category": bill_cat, "status": "paid", "recurrence": "none"},
            "/api/accounting", confidence="medium",
            notes=f"Bank tx no. {tx['transaction_no']}",
        )

    # Aggregate salary summary as one proposal
    if salary_payments:
        lines = "\n".join(
            f"    {d}  CHF {a:>9,.2f}  ({lbl})" for d, a, lbl in salary_payments
        )
        _emit_proposal(
            "info_only",
            f"Salary payments to Max: {len(salary_payments)} transfers totalling CHF {salary_total:,.2f}\n{lines}",
            {}, "", confidence="medium",
            notes=("Fragmented across multiple dates. Doesn't match a clean 9,693.20/mo. "
                   "Reconcile with Treuhand — split could be: net salary + reimbursement + Privatanteil top-up."),
        )

    # Employment start vs share capital date
    capital_date = None
    for tx in data.get("transactions", []):
        if "muster consulting" in tx["description1"].lower() and tx["amount"] > 0:
            capital_date = tx["trade_date"]
            break
    if capital_date:
        with get_db() as db:
            ps = db.execute("SELECT employment_start FROM payroll_settings WHERE id=1").fetchone()
        cur_start = ps["employment_start"] if ps else None
        if cur_start != capital_date:
            _emit_proposal(
                "info_only",
                f"payroll_settings.employment_start mismatch: stored {cur_start}, "
                f"but share capital landed {capital_date}. Operating-start ≠ employment-start "
                f"in general — confirm with Treuhand whether Max's salaried employment "
                f"truly started Feb or later, then edit on the Payroll settings page.",
                {}, "", confidence="medium",
                notes="Don't auto-apply — payroll updates need careful review of all related fields.",
            )

    # Stash header for context
    return {
        "source": source,
        "header": data.get("header", {}),
        "transactions_count": len(data.get("transactions", [])),
        "proposals": proposals,
        "proposals_count": len(proposals),
    }


@router.get("/bank-statements/{id}/transactions")
async def list_transactions(id: int):
    """Parse the stored CSV/XML and return individual transactions (read-only).
    No DB writes — the bank_transactions table is reserved for future persisted
    reconciliation, this endpoint is purely a live view of the file content.
    """
    with get_db() as db:
        row = db.execute("SELECT * FROM bank_statements WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Statement not found")
    bank_dir = _paths["BANK_DIR"]
    txns = []
    source = None
    header_period = {"period_start": row["period_start"], "period_end": row["period_end"]}
    if row["statement_file_xml"]:
        fp = bank_dir / row["statement_file_xml"]
        if fp.exists():
            raw = fp.read_bytes()
            if raw.lstrip()[:1] == b"<":
                source = "CAMT.053 XML"
                # CAMT.053 entry-level parsing — minimal extraction
                import xml.etree.ElementTree as ET
                try:
                    tree = ET.fromstring(raw)
                    def _local(t): return t.split("}")[-1] if "}" in t else t
                    ntries = [el for el in tree.iter() if _local(el.tag) == "Ntry"]
                    for ntry in ntries:
                        amt_el = next((el for el in ntry if _local(el.tag) == "Amt"), None)
                        cdt_el = next((el for el in ntry if _local(el.tag) == "CdtDbtInd"), None)
                        bookg = next((el for el in ntry if _local(el.tag) == "BookgDt"), None)
                        valdt = next((el for el in ntry if _local(el.tag) == "ValDt"), None)
                        amt_val = float(amt_el.text) if amt_el is not None and amt_el.text else 0
                        if cdt_el is not None and cdt_el.text == "DBIT":
                            amt_val = -amt_val
                        bookg_dt = next((c.text for c in (bookg or []) if _local(c.tag) in ("Dt","DtTm") and c.text), "")
                        valdt_dt = next((c.text for c in (valdt or []) if _local(c.tag) in ("Dt","DtTm") and c.text), "")
                        # Counterparty (look for any Nm under RltdPties)
                        cparty = ""
                        for el in ntry.iter():
                            if _local(el.tag) == "Nm" and el.text:
                                cparty = el.text; break
                        # Reference
                        ref = ""
                        for el in ntry.iter():
                            if _local(el.tag) == "Ref" and el.text:
                                ref = el.text; break
                        txns.append({
                            "date":           (bookg_dt or "")[:10],
                            "value_date":     (valdt_dt or "")[:10],
                            "amount":         round(amt_val, 2),
                            "counterparty":   cparty,
                            "description":    "",
                            "transaction_no": "",
                            "reference":      ref,
                            "balance":        None,
                        })
                except ET.ParseError:
                    pass
            else:
                source = "UBS CSV"
                parsed = parse_ubs_csv(raw)

                # UBS packs the useful detail into a semicolon-separated field
                # like "Reason for payment: Salary 05/26; Account no. IBAN: ...; Costs: ..."
                # Prefer "Reason for payment:" (free-form payer note).
                # Falls back to the QR-bill reference number ("Reference no. QRR:")
                # or the invoice tag on incoming credits ("Reference: …").
                def _extract_reason(*descriptions):
                    qrr_fallback = ""
                    ref_fallback = ""
                    for text in descriptions:
                        for seg in (text or "").split(";"):
                            seg = seg.strip()
                            low = seg.lower()
                            if low.startswith("reason for payment:"):
                                return seg.split(":", 1)[1].strip()
                            if low.startswith("reference no. qrr:") and not qrr_fallback:
                                num = seg.split(":", 1)[1].strip()
                                qrr_fallback = f"QR-ref {num}"
                            elif low.startswith("reference:") and not ref_fallback:
                                ref_fallback = seg.split(":", 1)[1].strip()
                    return qrr_fallback or ref_fallback

                def _build_desc(label, reason):
                    # Prefer the real "Reason for payment" over the generic
                    # UBS label ("multi e-banking order", "e-banking payment
                    # order", "credit", etc.). If no reason found, fall back
                    # to the label so we still have something to show.
                    label = (label or "").strip()
                    reason = (reason or "").strip()
                    return reason if reason else label

                for tx in parsed.get("transactions", []):
                    cparty = (tx.get("description1") or "").split(";", 1)[0].strip()
                    tx_label = (tx.get("description2") or tx.get("description1") or "").split(";")[0].strip()
                    tx_reason = _extract_reason(tx.get("description3"), tx.get("description2"))
                    tx_desc = _build_desc(tx_label, tx_reason)
                    if tx.get("sub_entries"):
                        # Multi-order: emit the umbrella + sub-entries
                        subs = []
                        for sub in tx["sub_entries"]:
                            sub_label = (sub.get("description3") or sub.get("description2") or "").split(";")[0].strip()
                            sub_reason = _extract_reason(sub.get("description3"), sub.get("description2"))
                            subs.append({
                                "amount":        sub["amount"],
                                "counterparty":  (sub["description1"] or "").split(";", 1)[0].strip(),
                                "description":   _build_desc(sub_label, sub_reason),
                            })
                        txns.append({
                            "date":           tx["trade_date"],
                            "value_date":     tx.get("value_date") or tx["trade_date"],
                            "amount":         tx["amount"],
                            "counterparty":   cparty or "(multi-order)",
                            "description":    tx_desc,
                            "transaction_no": tx.get("transaction_no", ""),
                            "reference":      "",
                            "balance":        tx.get("balance"),
                            "sub_entries":    subs,
                        })
                    else:
                        txns.append({
                            "date":           tx["trade_date"],
                            "value_date":     tx.get("value_date") or tx["trade_date"],
                            "amount":         tx["amount"],
                            "counterparty":   cparty,
                            "description":    tx_desc,
                            "transaction_no": tx.get("transaction_no", ""),
                            "reference":      "",
                            "balance":        tx.get("balance"),
                        })

    if not txns:
        return {"error": "No machine-readable statement file (XML/CSV) attached, or it could not be parsed",
                "transactions": []}

    # Totals
    total_in  = round(sum(t["amount"] for t in txns if t["amount"] > 0), 2)
    total_out = round(sum(t["amount"] for t in txns if t["amount"] < 0), 2)
    return {
        "source":       source,
        "period_start": row["period_start"],
        "period_end":   row["period_end"],
        "opening":      row["opening_balance"],
        "closing":      row["closing_balance"],
        "currency":     row["currency"] or "CHF",
        "count":        len(txns),
        "total_in":     total_in,
        "total_out":    total_out,
        "net":          round(total_in + total_out, 2),
        "transactions": txns,
    }


@router.get("/bank-statements/{id}/transactions.csv")
async def export_transactions_csv(id: int):
    """Clean, normalized CSV export of the parsed transactions.

    UTF-8 with BOM (Excel-friendly), comma-separated, ISO dates,
    one row per transaction (multi-order sub-entries flattened into
    their own rows with a Parent Tx No. column linking them).
    """
    import csv as _csv
    import io as _io
    from fastapi.responses import StreamingResponse

    # Reuse the same parsed structure as the JSON endpoint
    data = await list_transactions(id)
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(400, data["error"])

    buf = _io.StringIO()
    buf.write("﻿")  # UTF-8 BOM so Excel auto-detects UTF-8
    w = _csv.writer(buf)
    w.writerow([
        "Date", "Value Date", "Amount", "Currency",
        "Counterparty", "Description", "Reference",
        "Transaction No.", "Parent Tx No.", "Balance", "Is Sub-Entry",
    ])
    currency = data.get("currency") or "CHF"
    for tx in data.get("transactions", []):
        parent_no = tx.get("transaction_no") or ""
        # Main row
        w.writerow([
            tx.get("date", ""),
            tx.get("value_date", ""),
            f"{tx.get('amount', 0):.2f}",
            currency,
            tx.get("counterparty", ""),
            tx.get("description", ""),
            tx.get("reference", ""),
            parent_no,
            "",                                    # parent column blank on main row
            "" if tx.get("balance") is None else f"{tx['balance']:.2f}",
            "0",
        ])
        # Each sub-entry as its own row
        for sub in tx.get("sub_entries", []) or []:
            w.writerow([
                tx.get("date", ""),
                tx.get("value_date", ""),
                f"{sub.get('amount', 0):.2f}",
                currency,
                sub.get("counterparty", ""),
                sub.get("description", ""),
                "",                                # sub reference rarely populated
                "",                                # sub has no own tx no.
                parent_no,                         # link back to parent
                "",                                # balance only on parent
                "1",
            ])

    csv_text = buf.getvalue()
    filename = f"bank_transactions_{data.get('period_start','start')}_to_{data.get('period_end','end')}.csv"
    return StreamingResponse(
        _io.BytesIO(csv_text.encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )



@router.post("/bank-statements/parse-xml")
async def preview_xml(file: UploadFile = File(...)):
    """Parse a CAMT.053 XML and return what we extracted, without saving.
    Used by the UI to preview parsed values before the user clicks save."""
    if not file or not file.filename:
        raise HTTPException(400, "No file uploaded")
    raw = await file.read()
    parsed = parse_camt053(raw)
    return parsed


@router.get("/bank-statements/{id}")
async def get_statement(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM bank_statements WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Statement not found")
    return _row_to_dict(row)


@router.get("/bank-statements/{id}/file")
async def get_statement_file(id: int, format: str = "pdf"):
    """Serve either the PDF or XML for this statement. Defaults to PDF."""
    col = "statement_file_pdf" if format.lower() == "pdf" else "statement_file_xml"
    with get_db() as db:
        row = db.execute(
            f"SELECT {col} AS f FROM bank_statements WHERE id=?", (id,),
        ).fetchone()
    if not row or not row["f"]:
        raise HTTPException(404, f"No {format.upper()} for this statement")
    fp = _paths["BANK_DIR"] / row["f"]
    if not fp.exists():
        raise HTTPException(404, "File missing from disk")
    return FileResponse(fp)


@router.post("/bank-statements")
async def create_statement(
    period_start: str | None = Form(None),
    period_end: str | None = Form(None),
    bank: str = Form("UBS"),
    account_label: str = Form(""),
    iban: str = Form(""),
    statement_type: str = Form("monthly"),
    opening_balance: float | None = Form(None),
    closing_balance: float | None = Form(None),
    currency: str = Form("CHF"),
    notes: str = Form(""),
    file_pdf: UploadFile = File(None),
    file_xml: UploadFile = File(None),
):
    # The "xml" slot accepts CAMT.053 XML *or* any other structured export
    # (UBS native CSV, etc.). Only try to auto-parse when it actually looks
    # like XML; otherwise just store the file.
    parsed = {}
    xml_name = None
    if file_xml and file_xml.filename:
        raw_data = await file_xml.read()
        looks_like_xml = raw_data.lstrip()[:1] in (b"<", b"\xef")  # '<' or BOM
        if looks_like_xml:
            parsed = parse_camt053(raw_data)
            if "error" in parsed:
                # If it looked like XML but failed parsing, treat as opaque file
                parsed = {}
        ext = Path(file_xml.filename).suffix.lower() or ".bin"
        xml_name = hashed_filename("bank", ext, raw_data)
        xml_path = _paths["BANK_DIR"] / xml_name
        if not xml_path.exists():
            xml_path.write_bytes(raw_data)

    # Save PDF if provided
    pdf_name = await _save_file(file_pdf, "bank") if file_pdf and file_pdf.filename else None

    # Resolve fields: explicit user input wins, then XML parsed values, then default
    period_start = period_start or parsed.get("period_start")
    period_end = period_end or parsed.get("period_end")
    if not period_start or not period_end:
        raise HTTPException(400, "period_start and period_end are required "
                                 "(either filled in or auto-detected from XML)")
    if opening_balance is None and "opening_balance" in parsed:
        opening_balance = parsed["opening_balance"]
    if closing_balance is None and "closing_balance" in parsed:
        closing_balance = parsed["closing_balance"]
    if not iban and parsed.get("iban"):
        iban = parsed["iban"]
    if (not currency or currency == "CHF") and parsed.get("currency"):
        currency = parsed["currency"]

    with get_db() as db:
        cur = db.execute(
            """INSERT INTO bank_statements
               (bank, account_label, iban, period_start, period_end, statement_type,
                opening_balance, closing_balance, currency,
                statement_file_pdf, statement_file_xml, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (bank, account_label or None, iban or None, period_start, period_end,
             statement_type, opening_balance, closing_balance, currency,
             pdf_name, xml_name, notes or None),
        )
    return {
        "id": cur.lastrowid,
        "parsed_from_xml": parsed if parsed else None,
    }


@router.put("/bank-statements/{id}")
async def update_statement(
    id: int,
    period_start: str = Form(...),
    period_end: str = Form(...),
    bank: str = Form("UBS"),
    account_label: str = Form(""),
    iban: str = Form(""),
    statement_type: str = Form("monthly"),
    opening_balance: float | None = Form(None),
    closing_balance: float | None = Form(None),
    currency: str = Form("CHF"),
    notes: str = Form(""),
    file_pdf: UploadFile = File(None),
    file_xml: UploadFile = File(None),
):
    with get_db() as db:
        row = db.execute("SELECT * FROM bank_statements WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Statement not found")
        pdf_name = row["statement_file_pdf"]
        xml_name = row["statement_file_xml"]

        async def _maybe_replace(file: UploadFile | None, current: str | None) -> str | None:
            if not file or not file.filename:
                return current
            raw = await file.read()
            ext = Path(file.filename).suffix.lower()
            new_name = hashed_filename("bank", ext, raw)
            new_path = _paths["BANK_DIR"] / new_name
            if not new_path.exists():
                new_path.write_bytes(raw)
            if current and current != new_name:
                # Only unlink old if not referenced by any other statement
                still_used = db.execute(
                    "SELECT 1 FROM bank_statements WHERE "
                    "(statement_file_pdf=? OR statement_file_xml=?) AND id!=? LIMIT 1",
                    (current, current, id),
                ).fetchone()
                if not still_used:
                    delete_stored_file(_paths["BANK_DIR"], current)
            return new_name

        pdf_name = await _maybe_replace(file_pdf, pdf_name)
        xml_name = await _maybe_replace(file_xml, xml_name)

        db.execute(
            """UPDATE bank_statements SET
               bank=?, account_label=?, iban=?, period_start=?, period_end=?,
               statement_type=?, opening_balance=?, closing_balance=?, currency=?,
               statement_file_pdf=?, statement_file_xml=?, notes=?,
               updated_at=datetime('now')
               WHERE id=?""",
            (bank, account_label or None, iban or None, period_start, period_end,
             statement_type, opening_balance, closing_balance, currency,
             pdf_name, xml_name, notes or None, id),
        )
    return {"message": "Statement updated"}


@router.delete("/bank-statements/{id}")
async def delete_statement(id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM bank_statements WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Statement not found")
        files_to_check = [row["statement_file_pdf"], row["statement_file_xml"]]
        db.execute("DELETE FROM bank_statements WHERE id=?", (id,))
        for f in files_to_check:
            if not f:
                continue
            still_used = db.execute(
                "SELECT 1 FROM bank_statements WHERE "
                "statement_file_pdf=? OR statement_file_xml=? LIMIT 1",
                (f, f),
            ).fetchone()
            if not still_used:
                delete_stored_file(_paths["BANK_DIR"], f)
    return {"message": "Statement deleted"}
