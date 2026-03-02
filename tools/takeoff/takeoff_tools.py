"""Takeoff extraction helpers for the web MVP.

V0 scope:
- Accept up to 5 PDF pages.
- Extract text from text-layer PDFs (pypdf).
- Surface candidate measurements and utility count tokens.
"""

from __future__ import annotations

import io
import re
from collections import Counter
from typing import Any, Dict, List

from pypdf import PdfReader

MAX_PAGES_FREE = 5
MAX_PDF_BYTES = 12 * 1024 * 1024

MEASUREMENT_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:ft|feet|in|inch|inches|lf|sf|sy|cy|yd|mm|cm|m|')\b",
    re.IGNORECASE,
)
COUNT_TOKENS = ["MH", "CB", "GV", "HYD", "VALVE", "CLEANOUT", "MANHOLE"]


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _extract_measurements(text: str, limit: int = 20) -> List[str]:
    seen: List[str] = []
    for match in MEASUREMENT_PATTERN.finditer(text):
        value = match.group(0).strip()
        if value not in seen:
            seen.append(value)
        if len(seen) >= limit:
            break
    return seen


def _extract_token_counts(text: str) -> Dict[str, int]:
    upper = text.upper()
    counts: Dict[str, int] = {}
    for token in COUNT_TOKENS:
        hits = re.findall(rf"\b{re.escape(token)}\b", upper)
        if hits:
            counts[token] = len(hits)
    return counts


def extract_takeoff_preview(pdf_bytes: bytes, max_pages: int = MAX_PAGES_FREE) -> Dict[str, Any]:
    if not pdf_bytes:
        raise ValueError("No PDF payload received.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise ValueError("PDF exceeds max size for free preview (12MB).")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    if total_pages > max_pages:
        raise ValueError(f"Free preview supports up to {max_pages} pages.")

    pages: List[Dict[str, Any]] = []
    aggregate_counter: Counter[str] = Counter()
    measurement_total = 0
    text_chars_total = 0

    for idx, page in enumerate(reader.pages):
        raw_text = page.extract_text() or ""
        clean = _clean_text(raw_text)
        measurements = _extract_measurements(clean)
        token_counts = _extract_token_counts(clean)
        aggregate_counter.update(token_counts)

        measurement_total += len(measurements)
        text_chars_total += len(clean)

        pages.append(
            {
                "page_number": idx + 1,
                "text_preview": clean[:700],
                "text_characters": len(clean),
                "measurement_candidates": measurements,
                "token_counts": token_counts,
            }
        )

    return {
        "page_count": total_pages,
        "pages": pages,
        "aggregate": {
            "measurement_candidates": measurement_total,
            "token_counts": dict(aggregate_counter),
            "text_characters": text_chars_total,
        },
        "limits": {
            "max_pages_free": max_pages,
            "max_pdf_mb": MAX_PDF_BYTES // (1024 * 1024),
        },
        "notes": [
            "This MVP extracts text-layer PDFs first.",
            "Scanned plan OCR pass can be added next (Tesseract + pdf2image).",
            "Always validate AI-extracted dimensions before final takeoff."
        ],
    }
