"""
/api/python/proposal — Proposal HTML generator endpoint.
Calls tools/proposal/proposal_tools.py directly.
"""
import sys
import os
import json
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.proposal.proposal_tools import render_proposal_html  # noqa: E402


def _cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', 'Content-Type')


class handler(BaseHTTPRequestHandler):

    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        _cors(self)
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))

            html = render_proposal_html(
                client=body.get('client', ''),
                scope=body.get('scope', ''),
                total=float(body.get('total', 0)),
                duration=body.get('duration') or None,
                assumptions=body.get('assumptions') or None,
                exclusions=body.get('exclusions') or None,
            )
            self._json(200, {'html': html})

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
