"""
OSHA Trench Safety Reference Tools
29 CFR 1926 Subpart P — sloping, benching, shoring requirements.

DISCLAIMER: This module provides general reference information based on OSHA
29 CFR 1926 Subpart P. All excavation safety decisions must be made by a
competent person on site. Conditions vary — do not use this as a substitute
for on-site evaluation.
"""


OSHA_SLOPES = {
    "A": {"ratio": "3/4:1 (0.75H:1V)", "h_ratio": 0.75, "max_slope_pct": 133},
    "B": {"ratio": "1:1 (1H:1V)", "h_ratio": 1.0, "max_slope_pct": 100},
    "C": {"ratio": "1.5:1 (1.5H:1V)", "h_ratio": 1.5, "max_slope_pct": 67},
}

SOIL_DESCRIPTIONS = {
    "A": (
        "Cohesive soils with unconfined compressive strength ≥ 1.5 tsf "
        "(stiff clay, hardpan). No fissuring, no recent disturbance."
    ),
    "B": (
        "Cohesive or granular with strength 0.5–1.5 tsf. Includes angular "
        "gravel, silty clay, previously disturbed Type A, or fissured soils."
    ),
    "C": (
        "Cohesive soils with strength < 0.5 tsf, submerged soils, granular "
        "soils (sand, gravel), layered systems sloping into excavation, or "
        "soil subject to water infiltration."
    ),
}


def trench_safety(
    depth_ft: float,
    soil_type: str = "B",
    method: str = "slope",
) -> dict:
    """
    Calculate OSHA-required protective system dimensions for a trench.

    Args:
        depth_ft: Trench depth in feet
        soil_type: "A", "B", or "C" per OSHA Appendix B
        method: "slope", "bench", or "shield"

    Returns:
        dict with required dimensions and safety notes
    """
    soil_type = soil_type.upper()
    if soil_type not in OSHA_SLOPES:
        raise ValueError(f"soil_type must be 'A', 'B', or 'C', got '{soil_type}'")
    method = method.lower()

    result = {
        "depth_ft": depth_ft,
        "soil_type": soil_type,
        "soil_description": SOIL_DESCRIPTIONS[soil_type],
        "method": method,
        "protective_system_required": depth_ft > 4,
        "disclaimer": (
            "REFERENCE ONLY. All decisions must be made by a competent "
            "person per OSHA 29 CFR 1926.652."
        ),
    }

    if depth_ft <= 4:
        result["note"] = (
            "Trench ≤ 4 ft: Protective system not required by OSHA, "
            "but competent person must still evaluate hazards."
        )
        return result

    slope_info = OSHA_SLOPES[soil_type]
    h_ratio = slope_info["h_ratio"]

    if method == "slope":
        setback = depth_ft * h_ratio
        top_width_additional = 2 * setback
        result.update({
            "required_slope": slope_info["ratio"],
            "horizontal_setback_each_side_ft": round(setback, 2),
            "additional_top_width_ft": round(top_width_additional, 2),
            "notes": [
                (
                    f"Maximum slope {slope_info['ratio']} — for every 1 ft "
                    f"of depth, trench top must be wider by {h_ratio} ft "
                    "on each side."
                ),
                "Spoil must be placed minimum 2 ft from trench edge.",
                "All surface encumbrances and underground utilities must be addressed before excavation.",
            ],
        })
        if soil_type == "C":
            result["warning"] = (
                "Type C requires 1.5:1 slope — excavation face will be "
                "1.5× the depth on each side. Significant right-of-way "
                "may be needed."
            )

    elif method == "bench":
        if soil_type == "C":
            result["permitted"] = False
            result["note"] = "Benching is NOT permitted in Type C soil per OSHA 1926 Appendix B."
        else:
            result["permitted"] = True
            result.update({
                "initial_vertical_cut_ft": 4.0,
                "bench_slope": slope_info["ratio"],
                "minimum_bench_width_ft": 4.0,
                "notes": [
                    "Initial vertical cut: 4 ft maximum before first bench.",
                    "Each bench minimum 4 ft horizontal width.",
                    "Top of excavation may be sloped or vertical depending on soil type.",
                    "Simple slope (no bench) also permitted to the slope ratio shown.",
                ],
            })

    elif method == "shield":
        result.update({
            "permitted": True,
            "notes": [
                "Trench shields (boxes) permitted in all soil types.",
                "Shield must extend at least 18 inches above the top of unstable soil.",
                "Workers must not be in the shield during movement.",
                "Do not place workers in front of or behind shield during repositioning.",
                "Shield must be designed by a registered PE or meet tabulated data requirements.",
                "Spoil setback: minimum 2 ft from trench edge.",
            ],
        })

    else:
        raise ValueError(f"method must be 'slope', 'bench', or 'shield', got '{method}'")

    return result


def spoil_setback_required() -> dict:
    """Return OSHA spoil setback requirements."""
    return {
        "minimum_setback_ft": 2.0,
        "rule": "OSHA 29 CFR 1926.651(j)(2)",
        "note": "Spoils, equipment, and materials must be kept at least 2 ft from the edge of an excavation.",
    }


def competent_person_checklist() -> list:
    """
    Return a checklist of items a competent person must evaluate per OSHA 1926.651.
    """
    return [
        "Soil classification (visual and manual tests per Appendix A)",
        "Surface encumbrances removed or supported",
        "Underground utilities located and protected",
        "Access and egress within 25 ft of workers for trenches ≤ 4 ft deep; required for deeper",
        "Water accumulation — dewatering if present",
        "Adjacent structures evaluated for stability",
        "Atmosphere testing if >4 ft and hazardous atmosphere suspected",
        "Daily inspection before work and after rain/freeze-thaw events",
        "Spoils placed minimum 2 ft from trench edge",
        "Protective system in place and inspected",
    ]
