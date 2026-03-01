"""
/api/python/tools — Generic tool executor for openmud chat tool-calling.

POST body:
{
  "tool_name": "estimate_project_cost",
  "arguments": { ... }
}

This keeps tool execution centralized and reusable for both chat and event-driven workflows.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, ROOT)

from tools.estimating.estimating_tools import (  # noqa: E402
    calculate_equipment_cost,
    calculate_labor_cost,
    calculate_material_cost,
    estimate_project_cost,
)

API_VERSION = "1.0"


def _cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
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


def _run_tool(tool_name, args):
    if tool_name == 'calculate_material_cost':
        return calculate_material_cost(
            material_type=args.get('material_type'),
            quantity=float(args.get('quantity', 0)),
            size=args.get('size'),
            region=args.get('region', 'national'),
        )

    if tool_name == 'calculate_labor_cost':
        return calculate_labor_cost(
            labor_type=args.get('labor_type'),
            hours=float(args.get('hours', 0)),
            region=args.get('region', 'national'),
        )

    if tool_name == 'calculate_equipment_cost':
        return calculate_equipment_cost(
            equipment_type=args.get('equipment_type'),
            days=float(args.get('days', 0)),
            region=args.get('region', 'national'),
        )

    if tool_name == 'estimate_project_cost':
        return estimate_project_cost(
            materials=args.get('materials', []),
            labor=args.get('labor', []),
            equipment=args.get('equipment', []),
            markup=float(args.get('markup', 0.15)),
            region=args.get('region', 'national'),
        )

    raise ValueError(f"Unsupported tool '{tool_name}'")


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
            body = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}

            tool_name = body.get('tool_name')
            args = body.get('arguments') or {}
            if not tool_name:
                self._json(400, {'error': 'tool_name is required'})
                return
            if not isinstance(args, dict):
                self._json(400, {'error': 'arguments must be an object'})
                return

            result = _run_tool(tool_name, args)
            self._json(200, {'tool': tool_name, 'result': result})
        except ValueError as exc:
            self._json(400, {'error': str(exc)})
        except Exception as exc:
            self._json(500, {'error': str(exc)})

    def _json(self, status, data):
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        _cors(self)
        self.end_headers()
        self.wfile.write(payload)
