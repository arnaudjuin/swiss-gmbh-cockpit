"""Receipt analysis (LLM vision) + duplicate detection (file hash).

No FastAPI dependency.
"""

import hashlib
from pathlib import Path


SUPPORTED_EXT = {".jpg", ".jpeg", ".png"}
MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}

RECEIPT_PROMPT = """Analyze this receipt image and extract the information as JSON.
Return ONLY valid JSON with these exact keys:
{
  "date": "YYYY-MM-DD",
  "description": "Vendor/restaurant name - brief item summary",
  "amount": <total amount as a number>,
  "currency": "AED" or "CHF" or "USD" or "EUR" or the 3-letter currency code,
  "category": "Meals" or "Transport" or "Accommodation" or "Other"
}
Rules:
- Use the TOTAL / Grand Total amount (the final amount paid).
- For currency, use the currency shown on the receipt. Default to AED if unclear.
- For the date, use the date printed on the receipt.
- For description, start with the venue name then a dash and a short summary of items.
- Category: food/drinks = Meals, taxi/flight/fuel = Transport, hotel = Accommodation, else Other."""


def analyze_receipt(image_path: Path) -> dict:
    """Send a receipt image to the configured LLM vision model."""
    import llm
    text = llm.vision(image_path, RECEIPT_PROMPT)
    return llm.extract_json(text)


def compute_file_hash(file_path: Path) -> str:
    """SHA-256 hash of a file for duplicate detection."""
    h = hashlib.sha256()
    h.update(file_path.read_bytes())
    return h.hexdigest()


def make_is_duplicate(scan_dir: Path):
    """Return a closure that checks for duplicate scans in the given directory."""
    def is_duplicate_scan(file_hash: str) -> bool:
        for scan_file in scan_dir.iterdir():
            if scan_file.is_file():
                if hashlib.sha256(scan_file.read_bytes()).hexdigest() == file_hash:
                    return True
        return False
    return is_duplicate_scan
