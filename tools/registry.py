"""
Rockmud Tool Registry
Defines all available tools with OpenAI-compatible function schemas for tool calling.
"""

from typing import Any, Callable, Dict, List

# Tool definitions with OpenAI function-calling schema
TOOL_DEFINITIONS = [
    {
        "name": "calculate_material_cost",
        "description": "Calculate material cost for construction. Use for pipe, concrete, rebar. Returns unit cost, total, and waste factor.",
        "parameters": {
            "type": "object",
            "properties": {
                "material_type": {"type": "string", "description": "pipe, concrete, or rebar"},
                "quantity": {"type": "number", "description": "Quantity needed"},
                "size": {"type": "string", "description": "Size: e.g. '4' for 4-inch pipe, '3000_psi' for concrete"},
            },
            "required": ["material_type", "quantity"],
        },
    },
    {
        "name": "calculate_labor_cost",
        "description": "Calculate labor cost. Use for operator, laborer, foreman, electrician, ironworker.",
        "parameters": {
            "type": "object",
            "properties": {
                "labor_type": {"type": "string", "description": "operator, laborer, foreman, electrician, ironworker"},
                "hours": {"type": "number", "description": "Number of hours"},
            },
            "required": ["labor_type", "hours"],
        },
    },
    {
        "name": "calculate_equipment_cost",
        "description": "Calculate equipment rental cost. Use for excavator, auger, compactor.",
        "parameters": {
            "type": "object",
            "properties": {
                "equipment_type": {"type": "string", "description": "excavator, auger, compactor"},
                "days": {"type": "number", "description": "Number of rental days"},
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
                    "items": {"type": "object", "properties": {"type": {"type": "string"}, "quantity": {"type": "number"}, "size": {"type": "string"}}},
                    "description": "List of {type, quantity, size}",
                },
                "labor": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"type": {"type": "string"}, "hours": {"type": "number"}}},
                    "description": "List of {type, hours}",
                },
                "equipment": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"type": {"type": "string"}, "days": {"type": "number"}}},
                    "description": "Optional list of {type, days}",
                },
                "markup": {"type": "number", "description": "Markup as decimal, e.g. 0.15 for 15%"},
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
]


def get_all_tools() -> List[Dict[str, Any]]:
    """Return all tools in OpenAI function format."""
    return [
        {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
        for t in TOOL_DEFINITIONS
    ]


def get_tool_schema(name: str) -> Dict[str, Any]:
    """Get schema for a specific tool by name."""
    for t in TOOL_DEFINITIONS:
        if t["name"] == name:
            return t
    return {}
