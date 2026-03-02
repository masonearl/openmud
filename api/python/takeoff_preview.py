"""
/api/python/takeoff_preview — OCR/takeoff preview endpoint.

POST body:
{
  "pdf_base64": "<base64 string or data URL>",
  "max_pages": 5
}
"""

import base64
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, ROOT)

from tools.takeoff.takeoff_tools import extract_takeoff_preview  # noqa: E402

API_VERSION = "1.0"


def _cors(h):
    h.send_header("Access-Control-Allow-Origin", "*")
    h.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    h.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key")
    h.send_header("X-API-Version", API_VERSION)
    h.send_header("X-Powered-By", "openmud")


def _check_auth(h):
    master = os.environ.get("OPENMUD_API_KEY")
    if not master:
        return True
    provided = h.headers.get("x-api-key") or h.headers.get("Authorization", "").replace("Bearer ", "")
    return provided == master


def _decode_pdf_base64(payload: str) -> bytes:
    if not payload:
        raise ValueError("pdf_base64 is required.")
    value = payload.strip()
    if value.startswith("data:"):
        match = re.match(r"^data:application/pdf;base64,(.+)$", value, re.IGNORECASE | re.DOTALL)
        if not match:
            raise ValueError("Invalid data URL. Expected application/pdf base64 payload.")
        value = match.group(1)
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid base64 PDF payload.") from exc


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        _cors(self)
        self.end_headers()

    def do_POST(self):
        if not _check_auth(self):
            self._json(403, {"error": "Invalid or missing API key."})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            pdf_bytes = _decode_pdf_base64(body.get("pdf_base64", ""))
            max_pages = int(body.get("max_pages", 5))
            if max_pages < 1 or max_pages > 5:
                max_pages = 5

            result = extract_takeoff_preview(pdf_bytes, max_pages=max_pages)
            self._json(200, result)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _json(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        _cors(self)
        self.end_headers()
        self.wfile.write(payload)
