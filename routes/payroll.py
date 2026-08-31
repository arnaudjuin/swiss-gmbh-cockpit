"""Payroll routes — settings, payslip generation, listing.

Mounted at /api/payroll/* by app.py.
Side effects (income, transfer, obligations) are opt-in per generate request.
"""

import calendar
from datetime import date
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from db import get_db
from helpers import delete_stored_file

router = APIRouter(prefix="/payroll", tags=["payroll"])

# Directories injected from app.py
_paths = {}

def configure(payslip_dir: Path):
    _paths["PAYSLIP_DIR"] = payslip_dir

# Module-level salary constant (mirrored from app.py)
SALARY = 13000.00


def _row_to_settings(r):
    keys = r.keys()
    return {
        "employer_name": r["employer_name"],
        "employee_name": r["employee_name"],
        "employee_address": r["employee_address"] or "",
        "employment_start": r["employment_start"],
        "canton": r["canton"],
        "currency": r["currency"],
        "payment_day": r["payment_day"],
        "gross_monthly": r["gross_monthly"],
        "ahv_employee_pct": r["ahv_employee_pct"],
        "ahv_employer_pct": r["ahv_employer_pct"],
        "alv_employee_pct": r["alv_employee_pct"],
        "alv_employer_pct": r["alv_employer_pct"],
        "bvg_monthly_employee": r["bvg_monthly_employee"],
        "bvg_monthly_employer": r["bvg_monthly_employer"],
        "bvg_provider": r["bvg_provider"] or "",
        "uvg_employee_monthly": r["uvg_employee_monthly"],
        "uvg_employer_monthly": r["uvg_employer_monthly"],
        "ktg_monthly_total": r["ktg_monthly_total"],
        "ktg_employer_share_pct": r["ktg_employer_share_pct"],
        "fak_employer_pct": r["fak_employer_pct"] if "fak_employer_pct" in keys else 1.2,
        "source_tax_monthly": r["source_tax_monthly"] if "source_tax_monthly" in keys else 0,
        "source_tax_tariff": (r["source_tax_tariff"] or "") if "source_tax_tariff" in keys else "",
    }


def _compute_payslip(settings: dict) -> dict:
    """Calculate one monthly payslip from current settings.

    ALV uses plafond: 1.1% up to CHF 148,200/year (CHF 12,350/mo),
    then 0.5% on salary above that (solidarity contribution).
    """
    gross = settings["gross_monthly"]
    alv_plafond_monthly = 148200 / 12  # CHF 12,350
    # Solidarity contribution on income above the plafond was abolished
    # 1 January 2023 — only the standard 1.1 % up to the cap applies now.

    emp_ahv = round(gross * settings["ahv_employee_pct"] / 100, 2)
    capped = min(gross, alv_plafond_monthly)
    surplus = max(0, gross - alv_plafond_monthly)  # kept for traceability, no longer charged
    emp_alv = round(capped * settings["alv_employee_pct"] / 100, 2)
    emp_bvg = settings["bvg_monthly_employee"]
    emp_uvg = settings["uvg_employee_monthly"]
    ktg_total = settings["ktg_monthly_total"]
    ktg_employer_share = settings["ktg_employer_share_pct"] / 100
    emp_ktg = round(ktg_total * (1 - ktg_employer_share), 2)
    employer_ktg = round(ktg_total * ktg_employer_share, 2)

    # SAI (UVGZ supplementary accident) — employer share matches employee by default
    emp_sai = float(settings.get("sai_employee_monthly", 0) or 0)
    sai_employer_share = float(settings.get("sai_employer_share_pct", 50) or 50) / 100
    # If employee share is e.g. 50 %, employer share is also 50 % of the *total* —
    # i.e. employer cost equals employee cost when the split is 50/50.
    sai_total = emp_sai / (1 - sai_employer_share) if sai_employer_share < 1 else emp_sai * 2
    employer_sai = round(sai_total * sai_employer_share, 2) if sai_employer_share < 1 else round(emp_sai, 2)

    emp_source_tax = float(settings.get("source_tax_monthly", 0) or 0)

    emp_total = round(emp_ahv + emp_alv + emp_bvg + emp_uvg + emp_sai + emp_ktg
                      + emp_source_tax, 2)
    net = round(gross - emp_total, 2)

    employer_ahv = round(gross * settings["ahv_employer_pct"] / 100, 2)
    employer_alv = round(capped * settings["alv_employer_pct"] / 100, 2)
    employer_bvg = settings["bvg_monthly_employer"]
    employer_uvg = settings["uvg_employer_monthly"]
    employer_fak = round(gross * float(settings.get("fak_employer_pct", 0) or 0) / 100, 2)

    employer_total = round(employer_ahv + employer_alv + employer_bvg + employer_uvg
                           + employer_sai + employer_ktg + employer_fak, 2)
    total_cost = round(gross + employer_total, 2)

    return {
        "gross": gross,
        "emp_ahv": emp_ahv, "emp_alv": emp_alv, "emp_bvg": emp_bvg,
        "emp_uvg": emp_uvg, "emp_sai": emp_sai, "emp_ktg": emp_ktg,
        "emp_source_tax": emp_source_tax,
        "emp_total_deductions": emp_total,
        "net_salary": net,
        "employer_ahv": employer_ahv, "employer_alv": employer_alv,
        "employer_bvg": employer_bvg, "employer_uvg": employer_uvg,
        "employer_sai": employer_sai,
        "employer_ktg": employer_ktg, "employer_fak": employer_fak,
        "employer_total": employer_total,
        "total_employer_cost": total_cost,
    }


@router.get("/settings")
async def get_payroll_settings():
    with get_db() as db:
        row = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
    if not row:
        raise HTTPException(404, "No settings found")
    return _row_to_settings(row)


@router.put("/settings")
async def update_payroll_settings(request: Request):
    data = await request.json()
    # Required identity fields — without these the row would violate NOT NULL.
    for field in ("employer_name", "employee_name", "employee_address", "employment_start"):
        if not data.get(field):
            raise HTTPException(400, f"Missing required field: {field}")
    with get_db() as db:
        db.execute("""
            UPDATE payroll_settings SET
              employer_name=?, employee_name=?, employee_address=?, employment_start=?,
              canton=?, currency=?, payment_day=?, gross_monthly=?,
              ahv_employee_pct=?, ahv_employer_pct=?, alv_employee_pct=?, alv_employer_pct=?,
              bvg_monthly_employee=?, bvg_monthly_employer=?, bvg_provider=?,
              uvg_employee_monthly=?, uvg_employer_monthly=?,
              ktg_monthly_total=?, ktg_employer_share_pct=?,
              fak_employer_pct=?, source_tax_monthly=?, source_tax_tariff=?,
              updated_at=datetime('now')
            WHERE id=1
        """, (
            data.get("employer_name"), data.get("employee_name"),
            data.get("employee_address"), data.get("employment_start"),
            data.get("canton", "Zurich"), data.get("currency", "CHF"),
            int(data.get("payment_day", 25)), float(data.get("gross_monthly", 0)),
            float(data.get("ahv_employee_pct", 5.3)), float(data.get("ahv_employer_pct", 5.3)),
            float(data.get("alv_employee_pct", 1.1)), float(data.get("alv_employer_pct", 1.1)),
            float(data.get("bvg_monthly_employee", 0)), float(data.get("bvg_monthly_employer", 0)),
            data.get("bvg_provider", ""),
            float(data.get("uvg_employee_monthly", 0)), float(data.get("uvg_employer_monthly", 0)),
            float(data.get("ktg_monthly_total", 0)), float(data.get("ktg_employer_share_pct", 70)),
            float(data.get("fak_employer_pct", 1.2)),
            float(data.get("source_tax_monthly", 0)),
            data.get("source_tax_tariff", ""),
        ))
    return {"message": "Settings updated"}


@router.get("/preview")
async def payroll_preview():
    """Return the computed payslip for current settings (not persisted)."""
    with get_db() as db:
        row = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
    if not row:
        raise HTTPException(404, "No settings found")
    settings = _row_to_settings(row)
    return {"settings": settings, "calculation": _compute_payslip(settings)}


def _payslip_row_to_dict(r):
    keys = r.keys()
    return {
        "id": r["id"], "year": r["year"], "month": r["month"],
        "month_name": calendar.month_name[r["month"]],
        "issued_date": r["issued_date"], "payment_date": r["payment_date"],
        "gross": r["gross"],
        "emp_ahv": r["emp_ahv"], "emp_alv": r["emp_alv"], "emp_bvg": r["emp_bvg"],
        "emp_uvg": r["emp_uvg"], "emp_ktg": r["emp_ktg"],
        "emp_source_tax": r["emp_source_tax"] if "emp_source_tax" in keys else 0,
        "emp_total_deductions": r["emp_total_deductions"],
        "net_salary": r["net_salary"],
        "employer_ahv": r["employer_ahv"], "employer_alv": r["employer_alv"],
        "employer_bvg": r["employer_bvg"], "employer_uvg": r["employer_uvg"],
        "employer_ktg": r["employer_ktg"],
        "employer_fak": r["employer_fak"] if "employer_fak" in keys else 0,
        "employer_total": r["employer_total"],
        "total_employer_cost": r["total_employer_cost"],
        "status": r["status"], "notes": r["notes"] or "",
        "source": r["source"] if "source" in keys else "generated",
        "has_pdf": r["pdf_file"] is not None,
    }


@router.get("/payslips")
async def list_payslips(year: int | None = None):
    with get_db() as db:
        if year:
            rows = db.execute(
                "SELECT * FROM payslips WHERE year=? ORDER BY month",
                (year,),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM payslips ORDER BY year DESC, month DESC").fetchall()
    return [_payslip_row_to_dict(r) for r in rows]


@router.get("/ytd/{year}")
async def payroll_ytd(year: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM payslips WHERE year=? ORDER BY month",
            (year,),
        ).fetchall()
    fields = ["gross", "emp_ahv", "emp_alv", "emp_bvg", "emp_uvg", "emp_ktg",
              "emp_source_tax",
              "emp_total_deductions", "net_salary",
              "employer_ahv", "employer_alv", "employer_bvg", "employer_uvg", "employer_ktg",
              "employer_fak",
              "employer_total", "total_employer_cost"]
    totals = {}
    for f in fields:
        try:
            totals[f] = round(sum(r[f] for r in rows), 2)
        except (IndexError, KeyError):
            totals[f] = 0
    return {
        "year": year,
        "count": len(rows),
        "months": [r["month"] for r in rows],
        "totals": totals,
    }


@router.post("/generate/{year}/{month}")
async def generate_payslip(year: int, month: int, request: Request):
    # Parse options
    body = {}
    try:
        if request.headers.get("content-length"):
            body = await request.json()
    except Exception:
        body = {}
    opt_income = body.get("create_income", False)
    opt_transfer = body.get("create_transfer", False)
    opt_obligations = body.get("create_obligations", False)

    if month < 1 or month > 12:
        raise HTTPException(400, "Month must be 1-12")

    with get_db() as db:
        settings_row = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
    if not settings_row:
        raise HTTPException(400, "Payroll settings not configured")
    settings = _row_to_settings(settings_row)

    # Check employment start
    start = date.fromisoformat(settings["employment_start"])
    period_end = date(year, month, calendar.monthrange(year, month)[1])
    if period_end < start:
        raise HTTPException(400, f"Period {year}-{month:02d} is before employment start {start}")

    calc = _compute_payslip(settings)
    issued = period_end.isoformat()
    last_day = calendar.monthrange(year, month)[1]
    pay_day = min(settings["payment_day"], last_day)
    payment_date = date(year, month, pay_day).isoformat()

    # Generate PDF
    from generate_invoice import generate_payslip as render_payslip

    # Compute YTD up to and including this month
    with get_db() as db:
        existing_rows = db.execute(
            "SELECT * FROM payslips WHERE year=? AND month<? ORDER BY month",
            (year, month),
        ).fetchall()
    ytd_fields = ["gross", "emp_ahv", "emp_alv", "emp_bvg", "emp_uvg", "emp_ktg",
                  "emp_source_tax",
                  "emp_total_deductions", "net_salary",
                  "employer_ahv", "employer_alv", "employer_bvg", "employer_uvg", "employer_ktg",
                  "employer_fak",
                  "employer_total", "total_employer_cost"]
    ytd_before = {}
    for f in ytd_fields:
        try:
            ytd_before[f] = sum(r[f] for r in existing_rows)
        except (IndexError, KeyError):
            ytd_before[f] = 0
    ytd_including = {f: round(ytd_before[f] + calc[f if f in calc else f], 2) for f in ytd_fields}
    # Ensure all keys present
    for k in ytd_fields:
        if k not in ytd_including:
            ytd_including[k] = round(ytd_before[k] + (calc.get(k, 0)), 2)

    pdf_bytes = render_payslip(
        year=year, month=month,
        issued_date=issued, payment_date=payment_date,
        settings=settings, calc=calc, ytd=ytd_including,
    )

    pdf_name = f"payslip_{year}_{month:02d}.pdf"
    (_paths["PAYSLIP_DIR"] / pdf_name).write_bytes(pdf_bytes)

    # Upsert payslip
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM payslips WHERE year=? AND month=?",
            (year, month),
        ).fetchone()
        params = (
            year, month, issued, payment_date, calc["gross"],
            calc["emp_ahv"], calc["emp_alv"], calc["emp_bvg"],
            calc["emp_uvg"], calc["emp_ktg"], calc.get("emp_source_tax", 0),
            calc["emp_total_deductions"], calc["net_salary"],
            calc["employer_ahv"], calc["employer_alv"], calc["employer_bvg"],
            calc["employer_uvg"], calc["employer_ktg"], calc.get("employer_fak", 0),
            calc["employer_total"], calc["total_employer_cost"],
            "issued", pdf_name,
        )
        if existing:
            db.execute("""
                UPDATE payslips SET
                  issued_date=?, payment_date=?, gross=?,
                  emp_ahv=?, emp_alv=?, emp_bvg=?, emp_uvg=?, emp_ktg=?, emp_source_tax=?,
                  emp_total_deductions=?, net_salary=?,
                  employer_ahv=?, employer_alv=?, employer_bvg=?,
                  employer_uvg=?, employer_ktg=?, employer_fak=?,
                  employer_total=?, total_employer_cost=?,
                  status=?, pdf_file=?, source='generated'
                WHERE year=? AND month=?
            """, params[2:] + (year, month))
            payslip_id = existing["id"]
        else:
            cur = db.execute("""
                INSERT INTO payslips
                (year, month, issued_date, payment_date, gross,
                 emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_ktg, emp_source_tax,
                 emp_total_deductions, net_salary,
                 employer_ahv, employer_alv, employer_bvg, employer_uvg, employer_ktg, employer_fak,
                 employer_total, total_employer_cost,
                 status, pdf_file, source)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'generated')
            """, params)
            payslip_id = cur.lastrowid

    # Side effects (opt-in)
    side_effects = {"income": False, "transfer": False, "obligations_created": 0}
    month_name = calendar.month_name[month]
    # Unified period format across obligation types: months "Apr 2026",
    # quarters "Q2 2026", years "FY 2026".
    period_label = f"{calendar.month_abbr[month]} {year}"

    with get_db() as db:
        # Income entry
        if opt_income:
            exists = db.execute(
                "SELECT id FROM income_entries WHERE income_date=? AND source=? AND ABS(amount - ?) < 0.01",
                (payment_date, settings["employer_name"], calc["net_salary"]),
            ).fetchone()
            if not exists:
                db.execute(
                    """INSERT INTO income_entries
                       (income_date, source, description, amount, currency, category)
                       VALUES (?,?,?,?,?,?)""",
                    (payment_date, settings["employer_name"],
                     f"Net salary — {period_label}", calc["net_salary"],
                     settings.get("currency", "CHF"), "Salary"),
                )
                side_effects["income"] = True

        # Transfer GmbH -> Personal
        if opt_transfer:
            exists = db.execute(
                """SELECT id FROM account_transfers
                   WHERE transfer_date=? AND direction='gmbh_to_personal'
                   AND ABS(amount - ?) < 0.01""",
                (payment_date, calc["net_salary"]),
            ).fetchone()
            if not exists:
                db.execute(
                    """INSERT INTO account_transfers
                       (transfer_date, direction, amount, currency, description)
                       VALUES (?,?,?,?,?)""",
                    (payment_date, "gmbh_to_personal", calc["net_salary"],
                     settings.get("currency", "CHF"),
                     f"Net salary payment — {period_label}"),
                )
                side_effects["transfer"] = True

        # Obligations (GmbH owes authorities/providers)
        if opt_obligations:
            ob_due = issued  # end of period
            # BVG is intentionally NOT created per month: AXA bills it quarterly
            # (contract 2/547440), tracked by a recurring quarterly obligation
            # (bvg_employer, period "Qx YYYY") instead. Monthly rows up to
            # June 2026 predate this and add up to the Q2 invoice.
            ahv_total = round(calc["emp_ahv"] + calc["emp_alv"] + calc["employer_ahv"] + calc["employer_alv"], 2)
            # The SVA akonto bill adds FAK + ~2% admin costs on top of AHV/ALV,
            # and arrives quarterly (~15th of the month after quarter end).
            ahv_bill = round(ahv_total + calc.get("employer_fak", 0) + 0.02 * ahv_total, 2)
            q_end_month = ((month - 1) // 3 + 1) * 3
            bill_y, bill_m = (year, q_end_month + 1) if q_end_month < 12 else (year + 1, 1)
            ahv_bill_date = f"{bill_y}-{bill_m:02d}-15"
            obligation_plans = [
                ("ahv", "AHV/IV/EO + ALV", ahv_total, ahv_bill_date, ahv_bill),
                ("uvg", "UVG (AXA)",
                 round(calc["emp_uvg"] + calc["employer_uvg"], 2), None, None),
                ("ktg", "KTG (daily sickness)",
                 round(calc["emp_ktg"] + calc["employer_ktg"], 2), None, None),
            ]
            for ob_type, label, amount, exp_date, exp_amt in obligation_plans:
                if amount <= 0:
                    continue
                exists = db.execute(
                    """SELECT id FROM obligations
                       WHERE period_label=? AND notes LIKE ? AND obligation_type=?""",
                    (period_label, f"%{label}%", ob_type),
                ).fetchone()
                if exists:
                    continue
                db.execute(
                    """INSERT INTO obligations
                       (obligation_type, period_label, period_year, amount, currency,
                        due_date, status, notes, recurrence, expected_bill_date, expected_bill_amount)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (ob_type, period_label, year, amount,
                     settings.get("currency", "CHF"), ob_due,
                     "unpaid", f"Payroll obligation: {label}", "none", exp_date, exp_amt),
                )
                side_effects["obligations_created"] += 1

            # Quellensteuer remittance: quarterly row, amount = sum of the
            # quarter's issued payslips' withheld source tax. Upserted on every
            # payslip generation so retro changes restate it automatically.
            if calc.get("emp_source_tax", 0) > 0:
                q = (month - 1) // 3 + 1
                q_label = f"Q{q} {year}"
                q_months = (3 * (q - 1) + 1, 3 * (q - 1) + 2, 3 * (q - 1) + 3)
                q_total = db.execute(
                    "SELECT COALESCE(SUM(emp_source_tax),0) t FROM payslips WHERE year=? AND month IN (?,?,?)",
                    (year, *q_months),
                ).fetchone()["t"]
                q_total = round(float(q_total), 2)
                q_end_m = q_months[-1]
                import calendar as _cal
                due_m, due_y = (q_end_m + 1, year) if q_end_m < 12 else (1, year + 1)
                st_due = f"{due_y}-{due_m:02d}-{_cal.monthrange(due_y, due_m)[1]:02d}"
                bill_m, bill_y = (q_end_m + 3, year) if q_end_m <= 9 else (q_end_m - 9, year + 1)
                st_bill = f"{bill_y}-{bill_m:02d}-15"
                st_note = (f"Quellensteuer withheld {q_label} (issued payslips, tariff "
                           f"{settings.get('source_tax_tariff') or 'A0N'}). Remit to Kantonales Steueramt ZH; "
                           "~2% Bezugsprovision stays with the GmbH.")
                st_row = db.execute(
                    "SELECT id, status FROM obligations WHERE obligation_type='source_tax' AND period_label=?",
                    (q_label,),
                ).fetchone()
                if st_row is None:
                    db.execute(
                        """INSERT INTO obligations (obligation_type, period_label, period_year, amount, currency,
                           due_date, status, notes, recurrence, expected_bill_date, expected_bill_amount)
                           VALUES ('source_tax',?,?,?,?,?,'unpaid',?,'none',?,?)""",
                        (q_label, year, q_total, settings.get("currency", "CHF"), st_due,
                         st_note, st_bill, round(q_total * 0.98, 2)),
                    )
                    side_effects["obligations_created"] += 1
                elif st_row["status"] == "unpaid":
                    db.execute(
                        "UPDATE obligations SET amount=?, expected_bill_amount=? WHERE id=?",
                        (q_total, round(q_total * 0.98, 2), st_row["id"]),
                    )

    return {
        "id": payslip_id, "year": year, "month": month,
        "pdf": pdf_name, "side_effects": side_effects,
        "net_salary": calc["net_salary"],
    }


@router.post("/payslips/upload")
async def upload_payslip(
    year: int = Form(...),
    month: int = Form(...),
    payment_date: str = Form(""),
    gross: float | None = Form(None),
    net: float | None = Form(None),
    doc: UploadFile = File(...),
):
    """Store a payslip PDF issued by the accountant.

    If a payslip already exists for (year, month), the uploaded PDF replaces
    the generated one (numbers are kept unless gross/net overrides are given).
    Otherwise a new payslip row is created: the contribution breakdown is
    estimated from the payroll settings, and gross/net overrides — the two
    numbers you can read straight off the accountant's slip — take precedence.
    """
    if month < 1 or month > 12:
        raise HTTPException(400, "Month must be 1-12")
    if not doc.filename or not doc.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file")
    if gross is not None and net is not None and net > gross:
        raise HTTPException(400, "Net cannot exceed gross")

    pdf_name = f"payslip_{year}_{month:02d}_accountant.pdf"
    (_paths["PAYSLIP_DIR"] / pdf_name).write_bytes(await doc.read())

    with get_db() as db:
        existing = db.execute(
            "SELECT * FROM payslips WHERE year=? AND month=?", (year, month)
        ).fetchone()

        if existing:
            new_gross = gross if gross is not None else existing["gross"]
            new_net = net if net is not None else existing["net_salary"]
            new_deductions = (round(new_gross - new_net, 2)
                              if (gross is not None or net is not None)
                              else existing["emp_total_deductions"])
            db.execute(
                """UPDATE payslips SET gross=?, net_salary=?, emp_total_deductions=?,
                   payment_date=COALESCE(NULLIF(?, ''), payment_date),
                   pdf_file=?, source='uploaded',
                   notes=TRIM(COALESCE(notes,'') || ' Accountant payslip uploaded.')
                   WHERE id=?""",
                (new_gross, new_net, new_deductions, payment_date, pdf_name, existing["id"]),
            )
            return {"id": existing["id"], "replaced": True, "source": "uploaded"}

        # New month — estimate the breakdown from settings, honor overrides
        settings_row = db.execute("SELECT * FROM payroll_settings WHERE id=1").fetchone()
        if not settings_row:
            raise HTTPException(400, "Payroll settings not configured")
        settings = _row_to_settings(settings_row)
        calc = _compute_payslip(settings)

        new_gross = gross if gross is not None else calc["gross"]
        new_net = net if net is not None else calc["net_salary"]
        new_deductions = (round(new_gross - new_net, 2)
                          if (gross is not None or net is not None)
                          else calc["emp_total_deductions"])
        last_day = calendar.monthrange(year, month)[1]
        issued = date(year, month, last_day).isoformat()
        if not payment_date:
            payment_date = date(year, month, min(settings["payment_day"], last_day)).isoformat()

        cur = db.execute("""
            INSERT INTO payslips
            (year, month, issued_date, payment_date, gross,
             emp_ahv, emp_alv, emp_bvg, emp_uvg, emp_ktg, emp_source_tax,
             emp_total_deductions, net_salary,
             employer_ahv, employer_alv, employer_bvg, employer_uvg, employer_ktg, employer_fak,
             employer_total, total_employer_cost,
             status, pdf_file, source, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            year, month, issued, payment_date, new_gross,
            calc["emp_ahv"], calc["emp_alv"], calc["emp_bvg"],
            calc["emp_uvg"], calc["emp_ktg"], calc.get("emp_source_tax", 0),
            new_deductions, new_net,
            calc["employer_ahv"], calc["employer_alv"], calc["employer_bvg"],
            calc["employer_uvg"], calc["employer_ktg"], calc.get("employer_fak", 0),
            calc["employer_total"], calc["total_employer_cost"],
            "issued", pdf_name, "uploaded",
            "Accountant payslip uploaded — contribution breakdown estimated from settings.",
        ))
        return {"id": cur.lastrowid, "replaced": False, "source": "uploaded"}


@router.get("/payslip/{id}/pdf")
async def download_payslip_pdf(id: int, download: bool = False):
    with get_db() as db:
        row = db.execute("SELECT * FROM payslips WHERE id=?", (id,)).fetchone()
    if not row:
        raise HTTPException(404, "Payslip not found")
    pdf_path = _paths["PAYSLIP_DIR"] / row["pdf_file"] if row["pdf_file"] else None
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(404, "PDF not found")
    if download:
        fname = f"Payslip {calendar.month_name[row['month']]} {row['year']}.pdf"
        return FileResponse(pdf_path, filename=fname, media_type="application/pdf")
    return FileResponse(pdf_path, media_type="application/pdf")


@router.delete("/payslip/{id}")
async def delete_payslip(id: int):
    with get_db() as db:
        row = db.execute("SELECT pdf_file FROM payslips WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        delete_stored_file(_paths["PAYSLIP_DIR"], row["pdf_file"])
        db.execute("DELETE FROM payslips WHERE id=?", (id,))
    return {"message": "Payslip deleted"}


@router.patch("/payslip/{id}/status")
async def update_payslip_status(id: int, request: Request):
    body = await request.json()
    status = body.get("status")
    if status not in ("issued", "paid"):
        raise HTTPException(400, "Invalid status")
    with get_db() as db:
        db.execute("UPDATE payslips SET status=? WHERE id=?", (status, id))
    return {"message": f"Set to {status}"}


