"""
Construction Unit Converter
Common unit conversions for heavy civil: volume, area, weight, pressure, length, flow rate, earthwork.
"""

# Conversion factors — all relative to a base unit for each category
# Base units: CY (volume), SF (area), lb (weight), PSI (pressure), ft (length), GPM (flow), BCY (earthwork)

VOLUME = {
    "cy": 1.0,
    "cf": 27.0,
    "ci": 46656.0,
    "gal": 201.974026,
    "liter": 764.554858,
    "m3": 0.764555,
    "barrel": 4.774,
}

AREA = {
    "sf": 1.0,
    "sy": 1.0 / 9.0,
    "si": 144.0,
    "acre": 1.0 / 43560.0,
    "hectare": 1.0 / 107639.0,
    "sm": 1.0 / 10.7639,
}

WEIGHT = {
    "lb": 1.0,
    "ton_short": 1.0 / 2000.0,
    "ton_metric": 1.0 / 2204.623,
    "kg": 1.0 / 2.204623,
    "oz": 16.0,
    "kip": 1.0 / 1000.0,
}

PRESSURE = {
    "psi": 1.0,
    "psf": 144.0,
    "bar": 1.0 / 14.5038,
    "kpa": 1.0 / 0.145038,
    "mpa": 1.0 / 145.038,
    "ft_water": 1.0 / 0.43353,
    "m_water": 1.0 / 1.42233,
    "atm": 1.0 / 14.696,
}

LENGTH = {
    "ft": 1.0,
    "in": 12.0,
    "yd": 1.0 / 3.0,
    "mi": 1.0 / 5280.0,
    "m": 1.0 / 3.28084,
    "km": 1.0 / 3280.84,
    "mm": 304.8,
    "cm": 30.48,
}

FLOW = {
    "gpm": 1.0,
    "cfs": 1.0 / 448.831,
    "lps": 1.0 / 15.8503,
    "mgd": 1.0 / 694444.0,
    "m3_hr": 1.0 / 4.40287,
    "acre_ft_day": 1.0 / 226285.7,
}

EARTHWORK = {
    "bcy": 1.0,          # Bank cubic yards (in-place)
    "lcy_25": 1.25,       # Loose CY with 25% swell
    "lcy_30": 1.30,
    "lcy_40": 1.40,
    "ccy_10": 0.90,       # Compacted CY with 10% shrink
    "ccy_15": 0.85,
    "ccy_20": 0.80,
    "bcf": 27.0,          # Bank cubic feet
}

CATEGORIES = {
    "volume": VOLUME,
    "area": AREA,
    "weight": WEIGHT,
    "pressure": PRESSURE,
    "length": LENGTH,
    "flow": FLOW,
    "earthwork": EARTHWORK,
}


def convert(value: float, from_unit: str, to_unit: str, category: str) -> dict:
    """
    Convert a value between units within a category.

    Args:
        value: Numeric value to convert
        from_unit: Unit key to convert from (e.g. 'cy', 'gpm', 'psi')
        to_unit: Unit key to convert to
        category: 'volume', 'area', 'weight', 'pressure', 'length', 'flow', 'earthwork'

    Returns:
        dict with converted value and metadata

    Example:
        >>> convert(10, 'cy', 'cf', 'volume')
        {'value': 10, 'from_unit': 'cy', 'to_unit': 'cf', 'result': 270.0, ...}
    """
    cat = category.lower()
    if cat not in CATEGORIES:
        raise ValueError(f"Unknown category '{category}'. Choose from: {list(CATEGORIES.keys())}")
    units = CATEGORIES[cat]
    from_unit = from_unit.lower()
    to_unit = to_unit.lower()
    if from_unit not in units:
        raise ValueError(f"Unknown unit '{from_unit}' in category '{category}'. Available: {list(units.keys())}")
    if to_unit not in units:
        raise ValueError(f"Unknown unit '{to_unit}' in category '{category}'. Available: {list(units.keys())}")

    # Convert to base unit, then to target
    value_in_base = value / units[from_unit]
    result = value_in_base * units[to_unit]

    return {
        "value": value,
        "from_unit": from_unit,
        "to_unit": to_unit,
        "category": category,
        "result": round(result, 6),
        "result_rounded": round(result, 4),
    }


def available_units(category: str) -> list:
    """Return list of available unit keys for a category."""
    cat = category.lower()
    if cat not in CATEGORIES:
        raise ValueError(f"Unknown category. Choose from: {list(CATEGORIES.keys())}")
    return list(CATEGORIES[cat].keys())


def bulk_convert(value: float, from_unit: str, category: str) -> dict:
    """Convert a value to all units in a category at once."""
    cat = category.lower()
    units = CATEGORIES.get(cat, {})
    from_key = from_unit.lower()
    if from_key not in units:
        raise ValueError(f"Unknown unit '{from_unit}'")

    value_in_base = value / units[from_key]
    return {
        to_unit: round(value_in_base * factor, 6)
        for to_unit, factor in units.items()
    }
