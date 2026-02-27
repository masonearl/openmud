# openmud Construction Tools

Python tools for construction estimating, scheduling, proposals, hydraulics, trench takeoff, safety reference, unit conversion, and bid calculations. Accessible through the openmud chat interface and API, or as a standalone library.

## Layout

```
tools/
├── estimating/
│   └── estimating_tools.py     # Material, labor, equipment costs; full project estimates
├── schedule/
│   └── schedule_tools.py       # Phased construction schedule generator
├── proposal/
│   └── proposal_tools.py       # Proposal HTML for PDF export
├── field/
│   ├── hydraulics.py           # Manning's equation, pipe flow, minimum slope
│   ├── trench.py               # Trench volume, backfill, asphalt, concrete, thrust blocks
│   └── safety.py               # OSHA trench safety reference (Subpart P)
├── calculations/
│   ├── unit_converter.py       # Volume, area, weight, pressure, length, flow, earthwork
│   └── bid_tools.py            # Markup, unit price builder, change orders, production rates
├── registry.py                 # OpenAI function-calling schemas for all tools
└── __init__.py                 # Exports all tools
```

## Quick usage

```python
from tools import (
    # Estimating
    calculate_material_cost, estimate_project_cost,
    # Hydraulics
    pipe_flow_full, minimum_slope,
    # Trench & quantities
    trench_volume, thrust_block, asphalt_tonnage,
    # Safety
    trench_safety,
    # Bid math
    markup_bid_price, unit_price, production_rate,
    # Unit conversion
    convert,
)
```

---

## Tool Reference

### Estimating (`tools/estimating/`)

| Function | Description |
|---|---|
| `calculate_material_cost(type, qty, size)` | Pipe, concrete, rebar pricing with waste factor |
| `calculate_labor_cost(type, hours)` | Operator, laborer, foreman, electrician, ironworker |
| `calculate_equipment_cost(type, days)` | Excavator, auger, compactor rental |
| `estimate_project_cost(materials, labor, equipment, markup)` | Full project estimate with markup |

```python
from tools import estimate_project_cost

result = estimate_project_cost(
    materials=[{"type": "pipe", "quantity": 1000, "size": "8"}],
    labor=[{"type": "operator", "hours": 80}, {"type": "laborer", "hours": 160}],
    equipment=[{"type": "excavator", "days": 10}],
    markup=0.15,
)
print(result["total"])  # → 74,800.00
```

---

### Field Hydraulics (`tools/field/hydraulics.py`)

| Function | Description |
|---|---|
| `pipe_flow_full(diameter_in, slope, n)` | Full-pipe Manning's flow and velocity |
| `pipe_flow_partial(diameter_in, slope, depth_ratio, n)` | Partial-flow capacity and velocity |
| `minimum_slope(diameter_in, target_velocity, n)` | Min slope for self-cleaning velocity |
| `flow_to_slope(diameter_in, target_flow_gpm, n)` | Required slope to convey a target flow |

```python
from tools import pipe_flow_full, minimum_slope

# 12" RCP at 0.5% slope
flow = pipe_flow_full(12, 0.005, n=0.013)
print(flow["flow_gpm"])         # → 748.3 GPM
print(flow["velocity_fps"])     # → 7.49 ft/s

# Minimum slope for 8" PVC sewer at 2.5 ft/s
slope = minimum_slope(8, target_velocity_fps=2.5, n=0.012)
print(slope["minimum_slope_pct"])  # → 0.0402%
```

---

### Trench & Quantities (`tools/field/trench.py`)

| Function | Description |
|---|---|
| `trench_volume(length, width, depth, pipe_od, bedding, swell, import_backfill)` | Excavation, backfill, spoil volumes |
| `thrust_block(diameter_in, pressure_psi, fitting, soil_bearing, safety_factor)` | Thrust force and block bearing area |
| `asphalt_tonnage(area_sf, thickness_in, density, waste_pct, price)` | HMA tonnage and cost |
| `concrete_volume(shape, waste_pct, **dims)` | CY for slabs, walls, cylinders |

```python
from tools import trench_volume

vol = trench_volume(
    length_ft=500, width_ft=3.5, depth_ft=6,
    pipe_od_in=8, bedding_depth_in=6,
    swell_pct=25, import_backfill=True
)
print(vol["excavation_cy"])   # → 388.89 CY
print(vol["backfill_cy"])     # → 377.28 CY
print(vol["spoil_cy"])        # → 486.11 CY (with swell)
```

---

### Trench Safety (`tools/field/safety.py`)

```python
from tools import trench_safety

result = trench_safety(depth_ft=10, soil_type="B", method="slope")
print(result["required_slope"])              # → '1:1 (1H:1V)'
print(result["horizontal_setback_each_side_ft"])  # → 10.0 ft
```

**Disclaimer:** Reference only. Always consult a competent person on site per OSHA 29 CFR 1926.652.

---

### Bid Calculations (`tools/calculations/bid_tools.py`)

| Function | Description |
|---|---|
| `markup_bid_price(cost, overhead_pct, profit_pct)` | Bid price from direct cost |
| `unit_price(material, labor, equip, sub, oh, profit, qty, unit)` | Unit price builder |
| `change_order_tm(labor_items, equip_items, material, op_pct, bond_pct)` | T&M change order |
| `production_rate(rate, qty, crew, rate_hr, hours, equip, unit)` | Duration and cost/unit |
| `crew_day_cost(labor_items, equip_items, tools, oh_pct)` | Daily crew cost |

```python
from tools import markup_bid_price, production_rate

# Bid price from $250,000 direct cost
bid = markup_bid_price(250000, overhead_pct=12, profit_pct=10)
print(bid["bid_price"])  # → $308,000.00

# How long to install 5,000 LF of pipe at 250 LF/day?
rate = production_rate(250, 5000, crew_size=5, crew_rate_per_hr=65, hours_per_day=10, equipment_cost_per_day=500)
print(rate["duration_days"])     # → 20.0 days
print(rate["cost_per_unit"])     # → $19.25/LF
```

---

### Unit Converter (`tools/calculations/unit_converter.py`)

```python
from tools import convert, bulk_convert

# Convert cubic yards to cubic feet
convert(10, "cy", "cf", "volume")      # → 270.0 CF

# Convert PSI to feet of water
convert(100, "psi", "ft_water", "pressure")  # → 230.77 ft

# Get all volume conversions at once
bulk_convert(1, "cy", "volume")
# → {"cy": 1, "cf": 27, "gal": 201.97, "liter": 764.55, ...}
```

---

## Contributing

The most valuable contributions to the tool library:
- **Better unit rates** — `estimating/estimating_tools.py` has national ballpark numbers. Regional and trade-specific rates welcome.
- **New tool types** — change order generator, RFI tracker, takeoff calculator
- **More pipe types** — HDPE fittings, restrained joint DIP, CIPP liner data

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to submit.
