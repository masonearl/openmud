"""
Construction Estimating Tools
From masonearl/contech1 - bidding tools live on masonearl.com
https://github.com/masonearl/contech1

Used by the Contech API for material, labor, equipment cost calculations.
Rockmud uses the masonearl.com/api/contech /predict endpoint for ML-based estimates;
these functions support granular cost breakdowns (material, labor, equipment).
"""

# Material pricing (from contech1 tools/estimating_tools.py)
MATERIAL_PRICING = {
    "pipe": {
        "4_inch": {"unit": "linear_foot", "cost": 8.50},
        "6_inch": {"unit": "linear_foot", "cost": 12.00},
        "8_inch": {"unit": "linear_foot", "cost": 18.00},
    },
    "concrete": {
        "3000_psi": {"unit": "cubic_yard", "cost": 166.00},
        "4000_psi": {"unit": "cubic_yard", "cost": 180.00},
    },
    "rebar": {
        "4_rebar": {"unit": "linear_foot", "cost": 1.25},
        "5_rebar": {"unit": "linear_foot", "cost": 1.75},
    },
}

# Labor rates (from HCSS data)
LABOR_RATES = {
    "operator": {"hourly": 85.00},
    "laborer": {"hourly": 35.00},
    "foreman": {"hourly": 55.00},
    "electrician": {"hourly": 65.00},
    "ironworker": {"hourly": 55.00},
}

# Equipment rates
EQUIPMENT_RATES = {
    "excavator": {"daily": 400.00},
    "auger": {"daily": 450.00},
    "compactor": {"daily": 100.00},
}


def calculate_material_cost(material_type: str, quantity: float, size: str = None):
    """Calculate material cost based on pricing data."""
    if material_type.lower() == "pipe":
        if size:
            size_key = f"{size}_inch"
            if size_key in MATERIAL_PRICING["pipe"]:
                unit_cost = MATERIAL_PRICING["pipe"][size_key]["cost"]
                total_cost = quantity * unit_cost
                return {
                    "material": f"{size}-inch pipe",
                    "quantity": quantity,
                    "unit": "linear feet",
                    "unit_cost": unit_cost,
                    "total_cost": round(total_cost, 2),
                    "waste_factor": "10%",
                    "total_with_waste": round(total_cost * 1.1, 2),
                }
    elif material_type.lower() == "concrete":
        psi = size or "3000_psi"
        if psi in MATERIAL_PRICING["concrete"]:
            unit_cost = MATERIAL_PRICING["concrete"][psi]["cost"]
            total_cost = quantity * unit_cost
            return {
                "material": f"Concrete {psi.replace('_', ' ')}",
                "quantity": quantity,
                "unit": "cubic yards",
                "unit_cost": unit_cost,
                "total_cost": round(total_cost, 2),
                "waste_factor": "10%",
                "total_with_waste": round(total_cost * 1.1, 2),
            }
    return {"error": f"Material type '{material_type}' not found in pricing database"}


def calculate_labor_cost(labor_type: str, hours: float):
    """Calculate labor cost based on hourly rates."""
    if labor_type.lower() in LABOR_RATES:
        hourly_rate = LABOR_RATES[labor_type.lower()]["hourly"]
        total_cost = hours * hourly_rate
        return {
            "labor_type": labor_type,
            "hours": hours,
            "hourly_rate": hourly_rate,
            "total_cost": round(total_cost, 2),
        }
    return {"error": f"Labor type '{labor_type}' not found in rates database"}


def calculate_equipment_cost(equipment_type: str, days: float):
    """Calculate equipment rental cost."""
    if equipment_type.lower() in EQUIPMENT_RATES:
        daily_rate = EQUIPMENT_RATES[equipment_type.lower()]["daily"]
        total_cost = days * daily_rate
        return {
            "equipment": equipment_type,
            "days": days,
            "daily_rate": daily_rate,
            "total_cost": round(total_cost, 2),
        }
    return {"error": f"Equipment type '{equipment_type}' not found in rates database"}


def estimate_project_cost(
    materials: list, labor: list, equipment: list = None, markup: float = 0.15
):
    """Create a complete project cost estimate with materials, labor, equipment, and markup."""
    material_total = 0
    labor_total = 0
    equipment_total = 0

    material_breakdown = []
    for mat in materials:
        result = calculate_material_cost(
            mat.get("type"), mat.get("quantity"), mat.get("size")
        )
        if "total_with_waste" in result:
            material_total += result["total_with_waste"]
            material_breakdown.append(result)

    labor_breakdown = []
    for lab in labor:
        result = calculate_labor_cost(lab.get("type"), lab.get("hours"))
        if "total_cost" in result:
            labor_total += result["total_cost"]
            labor_breakdown.append(result)

    equipment_breakdown = []
    if equipment:
        for eq in equipment:
            result = calculate_equipment_cost(eq.get("type"), eq.get("days"))
            if "total_cost" in result:
                equipment_total += result["total_cost"]
                equipment_breakdown.append(result)

    subtotal = material_total + labor_total + equipment_total
    overhead_profit = subtotal * markup
    total = subtotal + overhead_profit

    return {
        "materials": {"breakdown": material_breakdown, "subtotal": round(material_total, 2)},
        "labor": {"breakdown": labor_breakdown, "subtotal": round(labor_total, 2)},
        "equipment": {"breakdown": equipment_breakdown, "subtotal": round(equipment_total, 2)},
        "subtotal": round(subtotal, 2),
        "overhead_profit": round(overhead_profit, 2),
        "markup_percentage": markup * 100,
        "total": round(total, 2),
    }
