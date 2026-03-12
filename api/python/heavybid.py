"""
/api/python/heavybid — Local HeavyBid extraction and calculator defaults.

GET /api/python/heavybid?action=calculator_defaults
POST /api/python/heavybid { "action": "snapshot", "source_dir": "/path/to/Heavybid" }
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, ROOT)

from tools.heavybid.importer import build_heavybid_snapshot  # noqa: E402
from tools.estimating.estimating_tools import (  # noqa: E402
    get_heavybid_calculator_defaults,
    get_heavybid_snapshot_summary,
)

API_VERSION = "1.0"


def _cors(h):
    h.send_header("Access-Control-Allow-Origin", "*")
    h.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    h.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key")
    h.send_header("X-API-Version", API_VERSION)


def _check_auth(h):
    master = os.environ.get("OPENMUD_API_KEY")
    if not master:
        return True
    provided = (
        h.headers.get("x-api-key")
        or h.headers.get("Authorization", "").replace("Bearer ", "")
    )
    return provided == master


def _run_action(action: str, source_dir: str | None, write_outputs: bool):
    if action == "calculator_defaults":
        return get_heavybid_calculator_defaults()
    if action == "summary":
        return get_heavybid_snapshot_summary()
    if action == "snapshot":
        return build_heavybid_snapshot(source_dir=source_dir, write_outputs=write_outputs)
    raise ValueError(f"Unsupported HeavyBid action '{action}'")


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        _cors(self)
        self.end_headers()

    def do_GET(self):
        if not _check_auth(self):
            self._json(403, {"error": "Invalid or missing API key."})
            return

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        action = (params.get("action") or ["calculator_defaults"])[0]
        source_dir = (params.get("source_dir") or [None])[0]
        write_outputs = str((params.get("write_outputs") or ["false"])[0]).lower() == "true"
        try:
            result = _run_action(action, source_dir, write_outputs)
            self._json(200, {"action": action, "result": result})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def do_POST(self):
        if not _check_auth(self):
            self._json(403, {"error": "Invalid or missing API key."})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            action = body.get("action", "snapshot")
            source_dir = body.get("source_dir")
            write_outputs = bool(body.get("write_outputs", True))
            result = _run_action(action, source_dir, write_outputs)
            self._json(200, {"action": action, "result": result})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def _json(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        _cors(self)
        self.end_headers()
        self.wfile.write(payload)
