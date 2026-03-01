"""
/api/python/registry — expose OpenAI-compatible tool schemas from tools/registry.py.

GET /api/python/registry
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.registry import API_VERSION, get_all_tools  # noqa: E402


def _cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
    h.send_header('X-API-Version', API_VERSION)


def _check_auth(h):
    """Optional API key check. Open if OPENMUD_API_KEY is not set."""
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

    def do_GET(self):
        if not _check_auth(self):
            self._json(403, {'error': 'Invalid or missing API key.'})
            return
        self._json(200, {
            'tools': get_all_tools(),
            'count': len(get_all_tools()),
        })

    def _json(self, status, data):
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        _cors(self)
        self.end_headers()
        self.wfile.write(payload)
