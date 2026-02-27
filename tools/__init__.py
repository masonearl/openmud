"""
openmud Construction Tools
Python tools for construction estimating, scheduling, proposals, hydraulics,
trench takeoff, safety reference, unit conversion, and bid calculations.
Accessible through the openmud chat interface and API, or as a standalone library.
"""

# Estimating
from .estimating import (
    calculate_material_cost,
    calculate_labor_cost,
    calculate_equipment_cost,
    estimate_project_cost,
    MATERIAL_PRICING,
    LABOR_RATES,
    EQUIPMENT_RATES,
)

# Schedule & Proposal
from .schedule import build_schedule, parse_phases
from .proposal import render_proposal_html

# Field engineering
from .field.hydraulics import pipe_flow_full, pipe_flow_partial, minimum_slope, flow_to_slope
from .field.trench import trench_volume, thrust_block, asphalt_tonnage, concrete_volume
from .field.safety import trench_safety, competent_person_checklist

# Calculations
from .calculations.unit_converter import convert, bulk_convert, available_units
from .calculations.bid_tools import (
    markup_bid_price,
    unit_price,
    change_order_tm,
    production_rate,
    crew_day_cost,
)

# Registry
from .registry import get_all_tools, get_tool_schema

__all__ = [
    # Estimating
    "calculate_material_cost",
    "calculate_labor_cost",
    "calculate_equipment_cost",
    "estimate_project_cost",
    "MATERIAL_PRICING",
    "LABOR_RATES",
    "EQUIPMENT_RATES",
    # Schedule & Proposal
    "build_schedule",
    "parse_phases",
    "render_proposal_html",
    # Field engineering
    "pipe_flow_full",
    "pipe_flow_partial",
    "minimum_slope",
    "flow_to_slope",
    "trench_volume",
    "thrust_block",
    "asphalt_tonnage",
    "concrete_volume",
    "trench_safety",
    "competent_person_checklist",
    # Calculations
    "convert",
    "bulk_convert",
    "available_units",
    "markup_bid_price",
    "unit_price",
    "change_order_tm",
    "production_rate",
    "crew_day_cost",
    # Registry
    "get_all_tools",
    "get_tool_schema",
]
