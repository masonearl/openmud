"""
/api/python/schedule — Construction schedule builder endpoint.
Calls tools/schedule/schedule_tools.py directly.
"""
import sys
import os
import json
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.schedule.schedule_tools import build_schedule, parse_phases  # noqa: E402


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

            project_name = body.get('project_name', 'Project')
            duration_days = int(body.get('duration_days', 30))
            start_date = body.get('start_date')  # YYYY-MM-DD or None
            phases_input = body.get('phases', '')  # comma-separated string or list

            if isinstance(phases_input, list):
                phases = [p.strip() for p in phases_input if p.strip()]
            else:
                phases = parse_phases(phases_input)

            result = build_schedule(
                project_name=project_name,
                duration_days=duration_days,
                start_date=start_date or None,
                phases=phases or None,
            )
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
