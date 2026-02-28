"""
/api/python/estimate — Project cost estimator endpoint.
Calls tools/estimating/estimating_tools.py directly.

Accepts region parameter for geographic rate selection.
"""
import sys
import os
import json
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.estimating.estimating_tools import estimate_project_cost, get_regions  # noqa: E402

API_VERSION = "1.0"


def _cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
    h.send_header('X-API-Version', API_VERSION)
    h.send_header('X-Powered-By', 'openmud')


def _check_auth(h):
    """Optional API key check. Open if OPENMUD_API_KEY not set."""
    master = os.environ.get('OPENMUD_API_KEY')
    if not master:
        return True
    provided = (
        h.headers.get('x-api-key') or
        h.headers.get('Authorization', '').replace('Bearer ', '')
    )
    return provided == master


class handler(BaseHTTPRequestHandler):

    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        _cors(self)
        self.end_headers()

    def do_POST(self):
        if not _check_auth(self):
            self._json(403, {'error': 'Invalid or missing API key.'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))

            result = estimate_project_cost(
                materials=body.get('materials', []),
                labor=body.get('labor', []),
                equipment=body.get('equipment', []),
                markup=float(body.get('markup', 0.15)),
                region=body.get('region', 'national'),
            )
            # Surface available regions so the UI can build a selector
            result['available_regions'] = get_regions()
            self._json(200, result)

        except Exception as exc:
            self._json(500, {'error': str(exc)})

    def _json(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        _cors(self)
        self.end_headers()
        self.wfile.write(body)
