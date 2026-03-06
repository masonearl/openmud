"""
openmud Tool Registry — v1.0
OpenAI-compatible function schemas for all openmud tools.
Used for tool calling in the AI chat and as the foundation for the public API schema.

Shared schema source of truth: tools/tool-schemas.json
"""

from pathlib import Path
from typing import Any, Dict, List
import json

API_VERSION = "1.0"

SCHEMA_FILE = Path(__file__).with_name("tool-schemas.json")

with SCHEMA_FILE.open("r", encoding="utf-8") as fh:
    TOOL_DEFINITIONS: List[Dict[str, Any]] = json.load(fh)


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
