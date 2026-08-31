"""Pure utility helpers — no FastAPI app dependency, no DB.

Date math, file save/delete/serve, currency conversion.
"""

import calendar
from datetime import date
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse


def compute_dates(year: int, month: int):
    """Return (issued_date, due_date) for an invoice. Due = end of next month."""
    issued = date(year, month, calendar.monthrange(year, month)[1])
    due_m = month + 1 if month < 12 else 1
    due_y = year if month < 12 else year + 1
    due = date(due_y, due_m, calendar.monthrange(due_y, due_m)[1])
    return issued, due


def add_months(d: date, n: int) -> date:
    """Add n months to a date, clamping to the last valid day."""
    total = d.month - 1 + n
    y = d.year + total // 12
    m = total % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def end_of_month(year: int, month: int) -> date:
    """Return the last day of the given year/month."""
    return date(year, month, calendar.monthrange(year, month)[1])


def _heic_bytes_to_jpg(data: bytes) -> bytes:
    """Convert HEIC bytes to JPG bytes (so browsers can preview).
    Returns the original bytes if pillow_heif is unavailable."""
    try:
        import io
        import pillow_heif
        from PIL import Image
        pillow_heif.register_heif_opener()
        img = Image.open(io.BytesIO(data))
        # Drop alpha if present, then write JPEG at q=85
        if img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue()
    except Exception:
        return data


def normalize_image_bytes(filename: str, data: bytes) -> tuple[str, bytes]:
    """Given a filename + bytes, return possibly-converted (new_ext, new_bytes).
    HEIC → JPG; everything else passes through unchanged."""
    ext = Path(filename).suffix.lower()
    if ext in (".heic", ".heif"):
        return ".jpg", _heic_bytes_to_jpg(data)
    return ext, data


def parse_camt053(xml_bytes: bytes) -> dict:
    """Parse a CAMT.053 XML statement and return key fields.

    Returns:
        dict with: iban, currency, period_start, period_end, opening_balance,
        closing_balance, transaction_count, error (if applicable).
    """
    import xml.etree.ElementTree as ET
    result = {}
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        return {"error": f"Invalid XML: {e}"}

    # Detect namespace from the root tag
    ns = ""
    if "}" in root.tag:
        ns = root.tag.split("}")[0] + "}"

    # The statement element — namespace agnostic via local-name search
    def _find_all(parent, local):
        return [el for el in parent.iter() if el.tag.split("}")[-1] == local]

    stmts = _find_all(root, "Stmt")
    if not stmts:
        return {"error": "No <Stmt> element found — not a valid CAMT.053?"}
    stmt = stmts[0]

    # IBAN
    for el in _find_all(stmt, "IBAN"):
        result["iban"] = (el.text or "").strip()
        break

    # Currency (account-level)
    for el in stmt.findall(f"{ns}Acct/{ns}Ccy"):
        result["currency"] = (el.text or "").strip()
        break
    if "currency" not in result:
        for el in _find_all(stmt, "Ccy"):
            result["currency"] = (el.text or "").strip()
            break

    # Period (FrToDt)
    fr_to = stmt.find(f"{ns}FrToDt") if ns else None
    if fr_to is not None:
        for child in fr_to:
            tag = child.tag.split("}")[-1]
            if tag in ("FrDtTm", "FrDt") and child.text:
                result["period_start"] = child.text[:10]
            elif tag in ("ToDtTm", "ToDt") and child.text:
                result["period_end"] = child.text[:10]

    # Balances (OPBD = opening, CLBD = closing). There can be several.
    for bal in stmt.findall(f"{ns}Bal"):
        code = None
        for el in bal.iter():
            if el.tag.split("}")[-1] == "Cd" and el.text in ("OPBD", "CLBD", "OPAV", "CLAV"):
                code = el.text
                break
        if not code:
            continue
        amt_el = bal.find(f"{ns}Amt")
        cdt_dbt_el = bal.find(f"{ns}CdtDbtInd")
        if amt_el is None or amt_el.text is None:
            continue
        try:
            amount = float(amt_el.text)
        except ValueError:
            continue
        if cdt_dbt_el is not None and cdt_dbt_el.text == "DBIT":
            amount = -amount
        if code in ("OPBD", "OPAV") and "opening_balance" not in result:
            result["opening_balance"] = round(amount, 2)
        elif code in ("CLBD", "CLAV"):
            result["closing_balance"] = round(amount, 2)  # CLBD overrides CLAV

    # Transaction count
    ntries = stmt.findall(f"{ns}Ntry")
    result["transaction_count"] = len(ntries)

    return result


def parse_ubs_csv(csv_bytes: bytes) -> dict:
    """Parse a UBS Business Current Account CSV export.

    UBS native format (not CAMT.053): semicolon-separated, UTF-8 BOM,
    8 header lines + blank + transaction header + rows.
    Multi-row support: rows with no Trade date but an Individual amount
    are sub-entries of the previous main row (multi-orders).

    Returns:
        dict with header (account, iban, period, balances) + transactions list.
    """
    import csv as _csv
    import io as _io

    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = csv_bytes.decode("latin-1")
        except Exception as e:
            return {"error": f"Cannot decode CSV: {e}"}

    result = {"header": {}, "transactions": []}
    lines = text.splitlines()

    # Locate the data header row
    data_header_idx = None
    for i, line in enumerate(lines):
        if line.lstrip().startswith("Trade date"):
            data_header_idx = i
            break
        if ";" in line:
            parts = [p.strip() for p in line.split(";")]
            # Strip empty trailing fields
            parts = [p for p in parts if p]
            if len(parts) >= 2:
                key = parts[0].rstrip(":").strip()
                val = parts[1]
                if key and val:
                    result["header"][key] = val

    if data_header_idx is None:
        return {"error": "No 'Trade date' header row found — not a UBS transaction CSV?"}

    reader = _csv.DictReader(
        _io.StringIO("\n".join(lines[data_header_idx:])),
        delimiter=";",
    )

    def _to_float(s):
        if not s or not str(s).strip():
            return None
        try:
            return float(str(s).replace("'", "").replace(",", "."))
        except ValueError:
            return None

    current_tx = None
    for row in reader:
        trade_date = (row.get("Trade date") or "").strip()
        individual_amount = _to_float(row.get("Individual amount"))

        # Sub-entry of the previous multi-order
        if not trade_date and individual_amount is not None and current_tx:
            current_tx.setdefault("sub_entries", []).append({
                "amount": individual_amount,
                "description1": (row.get("Description1") or "").strip(),
                "description2": (row.get("Description2") or "").strip(),
                "description3": (row.get("Description3") or "").strip(),
            })
            continue

        # Skip empty or balance-only rows we can't anchor
        if not trade_date:
            continue

        debit = _to_float(row.get("Debit"))
        credit = _to_float(row.get("Credit"))
        if debit is not None and debit != 0:
            amount = -abs(debit)
        elif credit is not None:
            amount = abs(credit)
        else:
            amount = 0.0

        current_tx = {
            "trade_date":   trade_date,
            "booking_date": (row.get("Booking date") or "").strip(),
            "value_date":   (row.get("Value date") or "").strip(),
            "currency":     (row.get("Currency") or "CHF").strip(),
            "amount":       amount,
            "balance":      _to_float(row.get("Balance")),
            "transaction_no": (row.get("Transaction no.") or "").strip(),
            "description1": (row.get("Description1") or "").strip(),
            "description2": (row.get("Description2") or "").strip(),
            "description3": (row.get("Description3") or "").strip(),
            "sub_entries":  [],
        }
        result["transactions"].append(current_tx)

    return result


def hashed_filename(prefix: str, ext: str, data: bytes) -> str:
    """Content-addressed filename: prefix_<sha1[:10]>.<ext>.
    Same bytes → same filename, so re-uploading the same receipt dedupes."""
    import hashlib
    return f"{prefix}_{hashlib.sha1(data).hexdigest()[:10]}{ext}"


async def save_upload(file: UploadFile, directory: Path, prefix: str) -> str | None:
    """Save an uploaded file with a content-hash filename. Returns the stored filename
    or None. Re-uploading the same content reuses the existing file (dedup).
    HEIC/HEIF uploads are converted to JPG on the way in so browser previews work."""
    if not file or not file.filename:
        return None
    raw = await file.read()
    ext, data = normalize_image_bytes(file.filename, raw)
    filename = hashed_filename(prefix, ext, data)
    path = directory / filename
    if not path.exists():
        path.write_bytes(data)
    return filename


def delete_stored_file(directory: Path, filename: str | None) -> None:
    """Unlink a stored file if it exists."""
    if not filename:
        return
    p = directory / filename
    if p.exists():
        p.unlink()


def serve_stored_file(directory: Path, filename: str | None) -> FileResponse:
    """Serve a stored file or raise 404."""
    if not filename:
        raise HTTPException(404, "No file")
    p = directory / filename
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(p)


# ─── Currency conversion ─────────────────────────────────────────────────────

AED_TO_CHF = 0.2178  # 1 AED = 0.2178 CHF (mirror of generate_invoice.AED_TO_CHF)

CURRENCY_TO_CHF = {
    "CHF": 1.0,
    "AED": AED_TO_CHF,
    "USD": 0.88,
    "EUR": 0.94,
}


def convert_to_chf(amount: float, currency: str) -> float:
    """Convert an amount to CHF. Returns the amount unchanged if already CHF."""
    rate = CURRENCY_TO_CHF.get(currency.upper(), AED_TO_CHF)
    return round(amount * rate, 2)
