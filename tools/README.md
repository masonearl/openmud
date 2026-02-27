# openmud Construction Tools

Python tools for construction estimating, scheduling, and proposals. Accessible through the openmud chat interface and API.

## Layout

```
tools/
├── estimating/     # Material, labor, equipment costs and full estimates
│   ├── __init__.py
│   └── estimating_tools.py
├── schedule/      # Construction schedules with phases and dates
│   ├── __init__.py
│   └── schedule_tools.py
├── proposal/      # Proposal HTML for PDF export
│   ├── __init__.py
│   └── proposal_tools.py
├── registry.py    # OpenAI-compatible tool schemas
└── README.md
```

## Tools

| Tool | Description |
|------|--------------|
| `calculate_material_cost` | Pipe, concrete, rebar pricing with waste factor |
| `calculate_labor_cost` | Operator, laborer, foreman, electrician, ironworker rates |
| `calculate_equipment_cost` | Excavator, auger, compactor rental costs |
| `estimate_project_cost` | Full project estimate with materials, labor, equipment, markup |
| `build_schedule` | Construction schedule with phases and dates |
| `render_proposal_html` | Proposal HTML for PDF export |

## Usage

```python
from tools import (
    calculate_material_cost,
    calculate_labor_cost,
    estimate_project_cost,
    build_schedule,
    render_proposal_html,
)

# Material cost
result = calculate_material_cost("pipe", 1000, "8")
# → {'material': '8-inch pipe', 'total_with_waste': 19800, ...}

# Full estimate
result = estimate_project_cost(
    materials=[{"type": "pipe", "quantity": 1000, "size": "8"}],
    labor=[{"type": "operator", "hours": 40}],
    equipment=[{"type": "excavator", "days": 5}],
    markup=0.15,
)

# Schedule
schedule = build_schedule("Main St Waterline", 14, phases=["Mobilization", "Trenching", "Pipe", "Backfill", "Restoration"])
```

## API Integration

The `registry` module provides OpenAI-compatible function schemas for tool calling:

```python
from tools.registry import get_all_tools, get_tool_schema

tools = get_all_tools()  # For OpenAI API tools parameter
schema = get_tool_schema("calculate_material_cost")
```

## Data Sources

- **Material pricing**: HCSS, contech1
- **Labor rates**: HCSS Labor.csv
- **Equipment**: Project documents, rental rates
