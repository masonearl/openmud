"""
openmud Tool Registry — v1.0
OpenAI-compatible function schemas for all openmud tools.
Used for tool calling in the AI chat and as the foundation for the public API schema.

Available regions: national, utah, mountain_west, texas, california, northeast
"""

from typing import Any, Dict, List

API_VERSION = "1.0"

REGION_ENUM = [
    "national", "utah", "mountain_west",
    "texas", "california", "northeast",
]

REGION_DESCRIPTION = (
    "Geographic region for rate lookup. "
    "Available: national (default), utah, mountain_west, texas, california, northeast. "
    "Rates reflect local market conditions including prevailing wage where applicable."
)

# Tool definitions with OpenAI function-calling schema
TOOL_DEFINITIONS = [
    {
        "name": "calculate_material_cost",
        "description": (
            "Calculate material cost for construction. Use for pipe (pvc_c900_8, dip_8, rcp_18, etc.), "
            "concrete (3000_psi, 4000_psi), aggregate (crushed_rock_34, base_course), "
            "or rebar. Returns unit cost, total, and waste factor. Supports regional rates."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "material_type": {
                    "type": "string",
                    "description": "Material category: pipe, concrete, aggregate, asphalt, or rebar",
                },
                "quantity": {"type": "number", "description": "Quantity in appropriate unit (LF, CY, ton)"},
                "size": {
                    "type": "string",
                    "description": "Size/grade key. Pipe: '8' for 8-inch. Concrete: '4000_psi'. Rebar: '5_rebar'.",
                },
                "region": {"type": "string", "description": REGION_DESCRIPTION, "enum": REGION_ENUM},
            },
            "required": ["material_type", "quantity"],
        },
    },
    {
        "name": "calculate_labor_cost",
        "description": (
            "Calculate labor cost by type, hours, and region. "
            "Labor types: operator, laborer, foreman, superintendent, pipe_layer, "
            "grade_checker, traffic_control, ironworker, electrician, plumber."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "labor_type": {
                    "type": "string",
                    "description": (
                        "Labor classification: operator, laborer, foreman, "
                        "superintendent, pipe_layer, grade_checker, "
                        "traffic_control, ironworker, electrician, plumber"
                    ),
                },
                "hours": {"type": "number", "description": "Number of hours"},
                "region": {"type": "string", "description": REGION_DESCRIPTION, "enum": REGION_ENUM},
            },
            "required": ["labor_type", "hours"],
        },
    },
    {
        "name": "calculate_equipment_cost",
        "description": (
            "Calculate equipment rental cost by type, days, and region. "
            "Types: excavator, excavator_20t, excavator_30t, excavator_mini, backhoe, dozer_d6, "
            "motor_grader, wheel_loader, dump_truck, water_truck, compactor, jumping_jack, "
            "plate_compactor, roller_sheepsfoot, dewatering_pump, generator, trench_box, auger."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "equipment_type": {
                    "type": "string",
                    "description": "Equipment type key (e.g. excavator_20t, dump_truck, jumping_jack)",
                },
                "days": {"type": "number", "description": "Number of rental days"},
                "region": {"type": "string", "description": REGION_DESCRIPTION, "enum": REGION_ENUM},
            },
            "required": ["equipment_type", "days"],
        },
    },
    {
        "name": "estimate_project_cost",
        "description": "Full project cost estimate with materials, labor, equipment, and markup.",
        "parameters": {
            "type": "object",
            "properties": {
                "materials": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "quantity": {"type": "number"},
                            "size": {"type": "string"},
                        },
                    },
                    "description": "List of {type, quantity, size}",
                },
                "labor": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "hours": {"type": "number"},
                        },
                    },
                    "description": "List of {type, hours}",
                },
                "equipment": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "days": {"type": "number"},
                        },
                    },
                    "description": "Optional list of {type, days}",
                },
                "markup": {"type": "number", "description": "Markup as decimal, e.g. 0.15 for 15%"},
                "region": {"type": "string", "description": REGION_DESCRIPTION, "enum": REGION_ENUM},
            },
            "required": ["materials", "labor"],
        },
    },
    {
        "name": "build_schedule",
        "description": "Build a construction schedule with phases and dates.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_name": {"type": "string"},
                "start_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "duration_days": {"type": "number"},
                "phases": {"type": "array", "items": {"type": "string"}, "description": "Phase names"},
            },
            "required": ["project_name", "duration_days"],
        },
    },
    {
        "name": "render_proposal_html",
        "description": "Generate proposal HTML for PDF export.",
        "parameters": {
            "type": "object",
            "properties": {
                "client": {"type": "string"},
                "scope": {"type": "string"},
                "total": {"type": "number"},
                "duration": {"type": "number"},
                "assumptions": {"type": "string"},
                "exclusions": {"type": "string"},
            },
            "required": ["client", "scope", "total"],
        },
    },
    {
        "name": "create_calendar_event",
        "description": (
            "Normalize calendar event data for Apple/Google calendar add flow. "
            "Use when user asks to add an event to calendar or uses /addevent. "
            "For timed events, provide ISO datetimes in start/end."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "start": {
                    "type": "string",
                    "description": "Start datetime in ISO 8601 (e.g. 2026-03-03T06:30:00-07:00), or date for all-day",
                },
                "end": {
                    "type": "string",
                    "description": "End datetime in ISO 8601. Optional if duration_minutes is provided.",
                },
                "duration_minutes": {
                    "type": "number",
                    "description": "Optional event duration in minutes when end is omitted",
                },
                "timezone": {
                    "type": "string",
                    "description": "IANA timezone like America/Denver",
                },
                "location": {"type": "string"},
                "description": {"type": "string"},
                "all_day": {"type": "boolean", "description": "Set true for all-day events"},
            },
            "required": ["title", "start"],
        },
    },
    {
        "name": "search_email",
        "description": (
            "Search connected inbox accounts (Gmail/Outlook). "
            "Use for requests like find emails, search inbox, or check recent messages."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "General keyword query"},
                "from": {"type": "string", "description": "Optional sender filter"},
                "subject": {"type": "string", "description": "Optional subject filter"},
                "since": {"type": "string", "description": "Optional date filter"},
                "limit": {"type": "number", "description": "Max messages to return (1-20)"},
                "provider": {
                    "type": "string",
                    "enum": ["gmail", "microsoft", "apple_imap"],
                    "description": "Optional provider hint",
                },
            },
        },
    },
    {
        "name": "send_email",
        "description": (
            "Send an email through a connected inbox account (Gmail/Outlook). "
            "Use after confirming recipients, subject, and body."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "to": {
                    "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
                    "description": "Recipient email or array of emails",
                },
                "cc": {
                    "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
                },
                "bcc": {
                    "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
                },
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "provider": {
                    "type": "string",
                    "enum": ["gmail", "microsoft", "apple_imap"],
                    "description": "Optional provider hint",
                },
            },
            "required": ["to", "subject", "body"],
        },
    },
]


def get_all_tools() -> List[Dict[str, Any]]:
    """Return all tools in OpenAI function format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in TOOL_DEFINITIONS
    ]


def get_tool_schema(name: str) -> Dict[str, Any]:
    """Get schema for a specific tool by name."""
    for t in TOOL_DEFINITIONS:
        if t["name"] == name:
            return t
    return {}
