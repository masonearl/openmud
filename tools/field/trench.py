"""
Trench & Excavation Calculation Tools
Volume takeoff, backfill quantities, spoil haul, pipe bedding, and thrust blocks.
"""
import math
from typing import Optional


def trench_volume(
    length_ft: float,
    width_ft: float,
    depth_ft: float,
    pipe_od_in: float = 0,
    bedding_depth_in: float = 6,
    swell_pct: float = 25,
    import_backfill: bool = True,
) -> dict:
    """
    Calculate trench excavation, backfill, and spoil volumes.

    Args:
        length_ft: Trench length in linear feet
        width_ft: Trench width in feet (bottom)
        depth_ft: Trench depth in feet
        pipe_od_in: Pipe outside diameter in inches (for void deduction)
        bedding_depth_in: Bedding depth below pipe centerline in inches
        swell_pct: Soil volume increase when excavated (%, typical: 25)
        import_backfill: True if using import material for backfill

    Returns:
        dict with excavation_cy, backfill_cy, bedding_cy, spoil_cy
    """
    excav_cf = length_ft * width_ft * depth_ft
    excav_cy = excav_cf / 27

    # Pipe void (cylindrical)
    pipe_od_ft = pipe_od_in / 12
    pipe_void_cf = math.pi * (pipe_od_ft / 2) ** 2 * length_ft
    pipe_void_cy = pipe_void_cf / 27

    # Bedding volume (rectangular, full trench width)
    bedding_ft = bedding_depth_in / 12
    bedding_cf = length_ft * width_ft * bedding_ft
    bedding_cy = bedding_cf / 27
    bedding_tons = bedding_cy * 1.35  # approx for crushed rock

    # Net backfill needed (after pipe and bedding placed)
    backfill_cy = max(0, excav_cy - pipe_void_cy - bedding_cy)

    # Spoil to haul (native material with swell)
    swell = swell_pct / 100
    if import_backfill:
        # All native goes to spoil
        spoil_cy = excav_cy * (1 + swell)
    else:
        # Only pipe void + bedding volume goes to spoil (excess native)
        spoil_cy = (pipe_void_cy + bedding_cy) * (1 + swell)

    spoil_tons = spoil_cy * 1.4  # approximate

    return {
        "length_ft": length_ft,
        "width_ft": width_ft,
        "depth_ft": depth_ft,
        "pipe_od_in": pipe_od_in,
        "excavation_cf": round(excav_cf, 1),
        "excavation_cy": round(excav_cy, 2),
        "pipe_void_cy": round(pipe_void_cy, 3),
        "bedding_cy": round(bedding_cy, 2),
        "bedding_tons": round(bedding_tons, 2),
        "backfill_cy": round(backfill_cy, 2),
        "spoil_cy": round(spoil_cy, 2),
        "spoil_tons_approx": round(spoil_tons, 1),
        "swell_pct": swell_pct,
        "import_backfill": import_backfill,
    }


def thrust_block(
    pipe_diameter_in: float,
    test_pressure_psi: float,
    fitting_type: str = "90",
    soil_bearing_psf: float = 2000,
    safety_factor: float = 1.5,
) -> dict:
    """
    Calculate thrust force and concrete thrust block bearing area.

    Args:
        pipe_diameter_in: Pipe inside diameter in inches
        test_pressure_psi: Design/test pressure in PSI
        fitting_type: "90", "45", "22.5", "11.25", "tee", or "dead_end"
        soil_bearing_psf: Allowable soil bearing pressure in PSF
        safety_factor: Safety factor for bearing area (default 1.5)

    Returns:
        dict with thrust_lbf, bearing_area_sf, block dimensions
    """
    D_ft = pipe_diameter_in / 12
    A_pipe = math.pi * (D_ft / 2) ** 2  # pipe cross-sectional area in SF
    P_psf = test_pressure_psi * 144      # convert PSI to PSF

    fitting_type = str(fitting_type).lower()
    if fitting_type in ("dead_end", "dead", "cap"):
        thrust = P_psf * A_pipe
        label = "Dead end / cap"
        angle = 180
    elif fitting_type == "tee":
        thrust = P_psf * A_pipe
        label = "Tee (branch)"
        angle = 90
    else:
        try:
            angle_deg = float(fitting_type)
        except ValueError:
            raise ValueError(f"Unknown fitting type: {fitting_type}. Use '90', '45', '22.5', '11.25', 'tee', or 'dead_end'")
        thrust = 2 * P_psf * A_pipe * math.sin(math.radians(angle_deg / 2))
        label = f"{angle_deg}° bend"
        angle = angle_deg

    bearing_area_min = thrust / soil_bearing_psf
    bearing_area_design = bearing_area_min * safety_factor
    block_side = math.sqrt(bearing_area_design)
    block_vol_cy = (bearing_area_design * 1.5) / 27  # assume 18" thick

    return {
        "pipe_diameter_in": pipe_diameter_in,
        "pressure_psi": test_pressure_psi,
        "fitting": label,
        "angle_deg": angle,
        "pipe_area_sf": round(A_pipe, 4),
        "thrust_lbf": round(thrust, 0),
        "thrust_kips": round(thrust / 1000, 2),
        "soil_bearing_psf": soil_bearing_psf,
        "bearing_area_min_sf": round(bearing_area_min, 3),
        "bearing_area_design_sf": round(bearing_area_design, 3),
        "safety_factor": safety_factor,
        "approx_square_block_ft": round(block_side, 2),
        "concrete_volume_cy_18in_thick": round(block_vol_cy, 3),
    }


def asphalt_tonnage(
    area_sf: float,
    thickness_in: float,
    density_lbcf: float = 145,
    waste_pct: float = 5,
    price_per_ton: float = 90,
) -> dict:
    """
    Calculate asphalt (HMA) tonnage and cost for pavement or trench restoration.

    Args:
        area_sf: Surface area in square feet
        thickness_in: Compacted thickness in inches
        density_lbcf: Mix density in lb/CF (default 145 for dense-graded HMA)
        waste_pct: Waste factor percentage
        price_per_ton: Material price per ton

    Returns:
        dict with tonnage and cost
    """
    thickness_ft = thickness_in / 12
    volume_cf = area_sf * thickness_ft
    weight_lbs = volume_cf * density_lbcf
    tons_net = weight_lbs / 2000
    tons_with_waste = tons_net * (1 + waste_pct / 100)
    cost = tons_with_waste * price_per_ton

    return {
        "area_sf": area_sf,
        "thickness_in": thickness_in,
        "density_lbcf": density_lbcf,
        "volume_cf": round(volume_cf, 1),
        "net_tons": round(tons_net, 2),
        "waste_pct": waste_pct,
        "tons_with_waste": round(tons_with_waste, 2),
        "price_per_ton": price_per_ton,
        "material_cost": round(cost, 2),
    }


def concrete_volume(
    shape: str,
    waste_pct: float = 5,
    **dimensions,
) -> dict:
    """
    Calculate concrete volume in cubic yards.

    Args:
        shape: "slab", "wall", or "cylinder"
        waste_pct: Waste factor percentage
        **dimensions: Shape-specific dimensions:
            slab: length_ft, width_ft, thickness_in
            wall: length_ft, height_ft, thickness_in
            cylinder: od_ft, id_ft (0 for solid), height_ft

    Returns:
        dict with volume_cy, volume_with_waste_cy, cost estimate
    """
    shape = shape.lower()
    concrete_prices = {3000: 166, 4000: 180, 5000: 195}
    psi = dimensions.get("psi", 4000)
    price_per_cy = concrete_prices.get(psi, 180)

    if shape == "slab":
        l = dimensions["length_ft"]
        w = dimensions["width_ft"]
        t = dimensions.get("thickness_in", 6) / 12
        volume_cf = l * w * t
    elif shape == "wall":
        l = dimensions["length_ft"]
        h = dimensions["height_ft"]
        t = dimensions.get("thickness_in", 12) / 12
        volume_cf = l * h * t
    elif shape in ("cylinder", "manhole", "vault"):
        od = dimensions["od_ft"]
        id_ = dimensions.get("id_ft", 0)
        h = dimensions["height_ft"]
        area = math.pi / 4 * (od ** 2 - id_ ** 2)
        volume_cf = area * h
    else:
        raise ValueError(f"Unknown shape '{shape}'. Use 'slab', 'wall', or 'cylinder'.")

    vol_cy = volume_cf / 27
    vol_with_waste = vol_cy * (1 + waste_pct / 100)
    cost = vol_with_waste * price_per_cy

    return {
        "shape": shape,
        "dimensions": {k: v for k, v in dimensions.items() if k != "psi"},
        "net_volume_cy": round(vol_cy, 3),
        "waste_pct": waste_pct,
        "volume_with_waste_cy": round(vol_with_waste, 3),
        "concrete_psi": psi,
        "price_per_cy": price_per_cy,
        "material_cost": round(cost, 2),
        "truck_loads_10cy": round(vol_with_waste / 10, 1),
    }
