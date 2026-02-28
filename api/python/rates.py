"""
/api/python/rates — Query regional rate tables.

GET  /api/python/rates          → list all available regions
GET  /api/python/rates?region=utah    → full rate table for a region
POST /api/python/rates          → { "region": "utah" } → same as GET with query param
"""
import sys
import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.estimating.estimating_tools import get_regions, get_rates  # noqa: E402


API_VERSION = "1.0"


def _cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
    h.send_header('X-API-Version', API_VERSION)


class handler(BaseHTTPRequestHandler):

    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        _cors(self)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        region = (params.get('region') or [None])[0]

        if region:
            data = get_rates(region)
            self._json(200, {"region": region, "rates": data})
        else:
            self._json(200, {"regions": get_regions()})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            region = body.get('region')

            if region:
                data = get_rates(region)
                self._json(200, {"region": region, "rates": data})
            else:
                self._json(200, {"regions": get_regions()})

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
