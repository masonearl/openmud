"""
Pipe Hydraulics Tools
Manning's equation, flow capacity, minimum slope, and velocity calculations
for gravity-flow storm drain, sanitary sewer, and culverts.
"""
import math
from typing import Optional

# Manning's n values for common pipe materials
MANNINGS_N = {
    "concrete": 0.013,
    "rcp": 0.013,
    "pvc": 0.012,
    "hdpe": 0.011,
    "ductile_iron": 0.015,
    "dip": 0.015,
    "corrugated_metal": 0.024,
    "cmp": 0.024,
    "vitrified_clay": 0.013,
    "vcp": 0.013,
    "cast_iron": 0.013,
}


def pipe_flow_full(diameter_in: float, slope: float, n: float = 0.013) -> dict:
    """
    Calculate full-pipe flow capacity and velocity using Manning's equation.

    Args:
        diameter_in: Pipe diameter in inches
        slope: Pipe slope in ft/ft (e.g. 0.005 for 0.5%)
        n: Manning's roughness coefficient (default 0.013 for concrete/RCP)

    Returns:
        dict with flow_cfs, flow_gpm, velocity_fps, area_sf, hydraulic_radius_ft
    """
    D = diameter_in / 12  # diameter in feet
    r = D / 2
    A = math.pi * r * r  # cross-sectional area
    P = math.pi * D       # wetted perimeter
    R = A / P             # hydraulic radius = D/4

    Q = (1.0 / n) * A * math.pow(R, 2.0/3.0) * math.pow(slope, 0.5)
    V = Q / A

    return {
        "pipe_diameter_in": diameter_in,
        "slope_ft_per_ft": slope,
        "slope_pct": round(slope * 100, 4),
        "mannings_n": n,
        "flow_cfs": round(Q, 4),
        "flow_gpm": round(Q * 448.831, 1),
        "flow_mgd": round(Q * 0.646317, 4),
        "velocity_fps": round(V, 3),
        "area_sf": round(A, 5),
        "hydraulic_radius_ft": round(R, 5),
    }


def pipe_flow_partial(diameter_in: float, slope: float, depth_ratio: float = 0.8,
                       n: float = 0.013) -> dict:
    """
    Calculate partial-flow pipe capacity using Manning's equation.

    Args:
        diameter_in: Pipe diameter in inches
        slope: Pipe slope in ft/ft
        depth_ratio: Flow depth as fraction of diameter (d/D), 0.0–1.0
        n: Manning's roughness coefficient

    Returns:
        dict with partial and full flow/velocity for comparison
    """
    if not 0.01 <= depth_ratio <= 1.0:
        raise ValueError("depth_ratio must be between 0.01 and 1.0")

    D = diameter_in / 12
    r = D / 2

    # Full pipe
    A_full = math.pi * r * r
    R_full = D / 4
    Q_full = (1.0 / n) * A_full * math.pow(R_full, 2.0/3.0) * math.pow(slope, 0.5)
    V_full = Q_full / A_full

    # Partial flow using central angle
    theta = 2 * math.acos(1 - 2 * depth_ratio)
    A_p = (r * r / 2) * (theta - math.sin(theta))
    P_p = r * theta
    R_p = A_p / P_p if P_p > 0 else 0

    Q_p = (1.0 / n) * A_p * math.pow(R_p, 2.0/3.0) * math.pow(slope, 0.5)
    V_p = Q_p / A_p if A_p > 0 else 0

    depth_ft = depth_ratio * D

    return {
        "pipe_diameter_in": diameter_in,
        "slope_ft_per_ft": slope,
        "depth_ratio": depth_ratio,
        "flow_depth_ft": round(depth_ft, 3),
        "flow_depth_in": round(depth_ft * 12, 2),
        "partial": {
            "flow_cfs": round(Q_p, 4),
            "flow_gpm": round(Q_p * 448.831, 1),
            "velocity_fps": round(V_p, 3),
            "area_sf": round(A_p, 5),
        },
        "full_pipe": {
            "flow_cfs": round(Q_full, 4),
            "flow_gpm": round(Q_full * 448.831, 1),
            "velocity_fps": round(V_full, 3),
        },
        "meets_min_velocity": V_p >= 2.0,
        "meets_recommended_velocity": V_p >= 2.5,
    }


def minimum_slope(diameter_in: float, target_velocity_fps: float = 2.5,
                   n: float = 0.011) -> dict:
    """
    Calculate minimum pipe slope to achieve a target self-cleaning velocity.
    Based on Manning's equation solved for slope: S = (V * n / R^(2/3))^2

    Args:
        diameter_in: Pipe diameter in inches
        target_velocity_fps: Target velocity in ft/s (default 2.5 ft/s recommended)
        n: Manning's roughness coefficient

    Returns:
        dict with minimum slope and equivalent drop values
    """
    D = diameter_in / 12
    R = D / 4  # hydraulic radius for full pipe

    # S = (V * n / R^(2/3))^2
    min_slope = math.pow((target_velocity_fps * n) / math.pow(R, 2.0/3.0), 2)
    drop_per_100ft = min_slope * 100
    drop_per_100ft_in = drop_per_100ft * 12

    return {
        "pipe_diameter_in": diameter_in,
        "target_velocity_fps": target_velocity_fps,
        "mannings_n": n,
        "minimum_slope_ft_per_ft": round(min_slope, 6),
        "minimum_slope_pct": round(min_slope * 100, 4),
        "drop_per_100ft_ft": round(drop_per_100ft, 4),
        "drop_per_100ft_in": round(drop_per_100ft_in, 3),
        "standard": "ASCE MOP 36 / 10 States Standards",
    }


def flow_to_slope(diameter_in: float, target_flow_gpm: float,
                   n: float = 0.013, depth_ratio: float = 1.0) -> dict:
    """
    Solve for slope needed to convey a target flow at given depth.

    Args:
        diameter_in: Pipe diameter in inches
        target_flow_gpm: Required flow in GPM
        n: Manning's n
        depth_ratio: d/D depth ratio (default 1.0 = full)

    Returns:
        dict with required slope and resulting velocity
    """
    target_cfs = target_flow_gpm / 448.831
    D = diameter_in / 12
    r = D / 2

    if depth_ratio >= 1.0:
        A = math.pi * r * r
        R = D / 4
    else:
        theta = 2 * math.acos(1 - 2 * depth_ratio)
        A = (r * r / 2) * (theta - math.sin(theta))
        P = r * theta
        R = A / P

    # Q = (1/n) * A * R^(2/3) * S^(1/2)  →  S = (Q * n / (A * R^(2/3)))^2
    required_slope = math.pow((target_cfs * n) / (A * math.pow(R, 2.0/3.0)), 2)
    velocity = target_cfs / A

    return {
        "pipe_diameter_in": diameter_in,
        "target_flow_gpm": target_flow_gpm,
        "target_flow_cfs": round(target_cfs, 4),
        "required_slope_ft_per_ft": round(required_slope, 6),
        "required_slope_pct": round(required_slope * 100, 4),
        "resulting_velocity_fps": round(velocity, 3),
        "depth_ratio": depth_ratio,
    }
