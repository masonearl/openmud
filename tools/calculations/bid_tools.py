"""
Bid & Cost Calculation Tools
Markup, unit price building, production rates, change orders, crew day costs.
"""


def markup_bid_price(
    direct_cost: float,
    overhead_pct: float = 12.0,
    profit_pct: float = 10.0,
) -> dict:
    """
    Calculate bid price from direct cost with overhead and profit markup.

    Args:
        direct_cost: Direct project cost (materials + labor + equipment)
        overhead_pct: Overhead percentage applied to direct cost
        profit_pct: Profit percentage applied to overhead-loaded cost

    Returns:
        dict with overhead, profit, bid price, and total markup percentage
    """
    overhead = direct_cost * (overhead_pct / 100)
    loaded_cost = direct_cost + overhead
    profit = loaded_cost * (profit_pct / 100)
    bid_price = loaded_cost + profit
    total_markup_pct = (bid_price / direct_cost - 1) * 100 if direct_cost > 0 else 0

    return {
        "direct_cost": round(direct_cost, 2),
        "overhead_pct": overhead_pct,
        "overhead": round(overhead, 2),
        "overhead_loaded_cost": round(loaded_cost, 2),
        "profit_pct": profit_pct,
        "profit": round(profit, 2),
        "bid_price": round(bid_price, 2),
        "total_markup_on_cost_pct": round(total_markup_pct, 2),
        "margin_on_bid_pct": round((profit / bid_price * 100) if bid_price > 0 else 0, 2),
    }


def unit_price(
    material_per_unit: float,
    labor_per_unit: float,
    equipment_per_unit: float,
    subcontractor_per_unit: float = 0,
    overhead_pct: float = 12.0,
    profit_pct: float = 10.0,
    quantity: float = 1,
    unit: str = "LF",
) -> dict:
    """
    Build a unit bid price from cost components.

    Args:
        material_per_unit: Material cost per unit
        labor_per_unit: Labor cost per unit
        equipment_per_unit: Equipment cost per unit
        subcontractor_per_unit: Subcontractor cost per unit
        overhead_pct: Overhead percentage
        profit_pct: Profit percentage
        quantity: Total quantity for extended total
        unit: Unit of measure (LF, CY, EA, etc.)

    Returns:
        dict with unit price breakdown and extended total
    """
    direct = material_per_unit + labor_per_unit + equipment_per_unit + subcontractor_per_unit
    oh = direct * (overhead_pct / 100)
    loaded = direct + oh
    profit = loaded * (profit_pct / 100)
    unit_bid = loaded + profit
    extended = unit_bid * quantity

    return {
        "unit": unit,
        "material_per_unit": round(material_per_unit, 4),
        "labor_per_unit": round(labor_per_unit, 4),
        "equipment_per_unit": round(equipment_per_unit, 4),
        "subcontractor_per_unit": round(subcontractor_per_unit, 4),
        "direct_cost_per_unit": round(direct, 4),
        "overhead_pct": overhead_pct,
        "overhead_per_unit": round(oh, 4),
        "profit_pct": profit_pct,
        "profit_per_unit": round(profit, 4),
        "unit_bid_price": round(unit_bid, 4),
        "quantity": quantity,
        "extended_total": round(extended, 2),
    }


def change_order_tm(
    labor_items: list,
    equipment_items: list,
    material_cost: float = 0,
    overhead_profit_pct: float = 15.0,
    bond_pct: float = 1.0,
) -> dict:
    """
    Calculate a Time & Materials change order value.

    Args:
        labor_items: List of dicts: [{"description": str, "hours": float, "rate": float}]
        equipment_items: List of dicts: [{"description": str, "hours": float, "rate": float}]
        material_cost: Direct material cost
        overhead_profit_pct: Combined O&P percentage
        bond_pct: Bond premium percentage

    Returns:
        dict with full CO breakdown and total

    Example:
        >>> change_order_tm(
        ...     labor_items=[{"description": "Operator", "hours": 8, "rate": 95}],
        ...     equipment_items=[{"description": "Excavator", "hours": 8, "rate": 120}],
        ...     material_cost=500,
        ... )
    """
    labor_total = sum(item["hours"] * item["rate"] for item in labor_items)
    equip_total = sum(item["hours"] * item["rate"] for item in equipment_items)
    subtotal = labor_total + equip_total + material_cost
    op = subtotal * (overhead_profit_pct / 100)
    subtotal_plus_op = subtotal + op
    bond = subtotal_plus_op * (bond_pct / 100)
    total = subtotal_plus_op + bond

    return {
        "labor_items": [
            {"description": i["description"], "hours": i["hours"],
             "rate": i["rate"], "cost": round(i["hours"] * i["rate"], 2)}
            for i in labor_items
        ],
        "labor_total": round(labor_total, 2),
        "equipment_items": [
            {"description": i["description"], "hours": i["hours"],
             "rate": i["rate"], "cost": round(i["hours"] * i["rate"], 2)}
            for i in equipment_items
        ],
        "equipment_total": round(equip_total, 2),
        "material_cost": round(material_cost, 2),
        "subtotal": round(subtotal, 2),
        "overhead_profit_pct": overhead_profit_pct,
        "overhead_profit": round(op, 2),
        "bond_pct": bond_pct,
        "bond": round(bond, 2),
        "change_order_total": round(total, 2),
    }


def production_rate(
    production_rate_per_day: float,
    total_quantity: float,
    crew_size: int,
    crew_rate_per_hr: float,
    hours_per_day: float = 10,
    equipment_cost_per_day: float = 0,
    unit: str = "LF",
) -> dict:
    """
    Calculate project duration, cost per unit, and total cost from production rate.

    Args:
        production_rate_per_day: Units of work completed per crew day
        total_quantity: Total quantity of work
        crew_size: Number of workers
        crew_rate_per_hr: All-in hourly rate per worker (labor burden included)
        hours_per_day: Work hours per day
        equipment_cost_per_day: Daily equipment cost
        unit: Unit of measure

    Returns:
        dict with duration, cost per unit, and total direct cost
    """
    days = total_quantity / production_rate_per_day if production_rate_per_day > 0 else 0
    crew_cost_per_day = crew_size * crew_rate_per_hr * hours_per_day
    total_day_cost = crew_cost_per_day + equipment_cost_per_day
    cost_per_unit = total_day_cost / production_rate_per_day if production_rate_per_day > 0 else 0
    total_cost = cost_per_unit * total_quantity

    return {
        "unit": unit,
        "production_rate_per_day": production_rate_per_day,
        "total_quantity": total_quantity,
        "duration_days": round(days, 1),
        "crew_size": crew_size,
        "crew_rate_per_hr": crew_rate_per_hr,
        "hours_per_day": hours_per_day,
        "crew_cost_per_day": round(crew_cost_per_day, 2),
        "equipment_cost_per_day": round(equipment_cost_per_day, 2),
        "total_day_cost": round(total_day_cost, 2),
        "cost_per_unit": round(cost_per_unit, 4),
        "total_direct_cost": round(total_cost, 2),
    }


def crew_day_cost(
    labor_items: list,
    equipment_items: list,
    small_tools_consumables: float = 150,
    overhead_burden_pct: float = 25.0,
) -> dict:
    """
    Calculate total daily crew cost including labor, equipment, and overhead burden.

    Args:
        labor_items: List of [{"role": str, "hours": float, "rate": float}]
        equipment_items: List of [{"name": str, "daily_rate": float}]
        small_tools_consumables: Daily allowance for small tools/consumables
        overhead_burden_pct: Overhead percentage applied to subtotal

    Returns:
        dict with full day cost breakdown
    """
    labor_total = sum(i["hours"] * i["rate"] for i in labor_items)
    equip_total = sum(i["daily_rate"] for i in equipment_items)
    subtotal = labor_total + equip_total + small_tools_consumables
    overhead = subtotal * (overhead_burden_pct / 100)
    total = subtotal + overhead

    return {
        "labor_items": [
            {"role": i["role"], "hours": i["hours"],
             "rate": i["rate"], "cost": round(i["hours"] * i["rate"], 2)}
            for i in labor_items
        ],
        "labor_total": round(labor_total, 2),
        "equipment_items": equipment_items,
        "equipment_total": round(equip_total, 2),
        "small_tools_consumables": round(small_tools_consumables, 2),
        "subtotal": round(subtotal, 2),
        "overhead_burden_pct": overhead_burden_pct,
        "overhead": round(overhead, 2),
        "total_day_cost": round(total, 2),
    }
