"""Tests for trench and quantity tools."""
import pytest

from tools.field.trench import trench_volume, thrust_block, asphalt_tonnage, concrete_volume


class TestTrenchVolume:
    def test_basic_volume(self):
        result = trench_volume(100, 3.0, 5.0)
        assert result["excavation_cy"] > 0
        assert result["backfill_cy"] > 0

    def test_longer_trench_more_volume(self):
        v1 = trench_volume(100, 3.0, 5.0)
        v2 = trench_volume(200, 3.0, 5.0)
        assert abs(v2["excavation_cy"] - 2 * v1["excavation_cy"]) < 0.1

    def test_pipe_void_reduces_backfill(self):
        no_pipe = trench_volume(100, 3.0, 5.0, pipe_od_in=0)
        with_pipe = trench_volume(100, 3.0, 5.0, pipe_od_in=12)
        assert with_pipe["backfill_cy"] < no_pipe["backfill_cy"]

    def test_excavation_formula(self):
        # 100 LF × 3 ft wide × 6 ft deep = 1800 CF = 66.67 CY
        result = trench_volume(100, 3.0, 6.0, pipe_od_in=0, bedding_depth_in=0)
        assert abs(result["excavation_cy"] - 66.67) < 0.1

    def test_swell_increases_spoil(self):
        r1 = trench_volume(100, 3.0, 5.0, swell_pct=10)
        r2 = trench_volume(100, 3.0, 5.0, swell_pct=30)
        assert r2["spoil_cy"] > r1["spoil_cy"]

    def test_returns_expected_keys(self):
        result = trench_volume(500, 3.5, 6.0, pipe_od_in=8)
        for key in ["excavation_cy", "backfill_cy", "bedding_cy", "spoil_cy", "spoil_tons_approx"]:
            assert key in result

    def test_backfill_non_negative(self):
        result = trench_volume(100, 3.0, 4.0, pipe_od_in=36, bedding_depth_in=12)
        assert result["backfill_cy"] >= 0


class TestThrustBlock:
    def test_dead_end_higher_than_45_bend(self):
        dead = thrust_block(8, 150, "dead_end")
        bend = thrust_block(8, 150, "45")
        assert dead["thrust_lbf"] > bend["thrust_lbf"]

    def test_90_bend_higher_than_45(self):
        bend90 = thrust_block(8, 150, "90")
        bend45 = thrust_block(8, 150, "45")
        assert bend90["thrust_lbf"] > bend45["thrust_lbf"]

    def test_higher_pressure_more_thrust(self):
        t1 = thrust_block(8, 100, "45")
        t2 = thrust_block(8, 200, "45")
        assert t2["thrust_lbf"] > t1["thrust_lbf"]

    def test_larger_pipe_more_thrust(self):
        t1 = thrust_block(8, 150, "90")
        t2 = thrust_block(16, 150, "90")
        assert t2["thrust_lbf"] > t1["thrust_lbf"]

    def test_bearing_area_inversely_proportional_to_soil(self):
        soft = thrust_block(8, 150, "45", soil_bearing_psf=1500)
        dense = thrust_block(8, 150, "45", soil_bearing_psf=4000)
        assert soft["bearing_area_design_sf"] > dense["bearing_area_design_sf"]

    def test_invalid_fitting(self):
        with pytest.raises(ValueError):
            thrust_block(8, 150, "invalid")

    def test_returns_expected_keys(self):
        result = thrust_block(12, 200, "90")
        for key in ["thrust_lbf", "bearing_area_design_sf", "concrete_volume_cy_18in_thick"]:
            assert key in result


class TestAsphaltTonnage:
    def test_basic_tonnage(self):
        result = asphalt_tonnage(1000, 3)
        assert result["tons_with_waste"] > 0

    def test_more_area_more_tons(self):
        r1 = asphalt_tonnage(1000, 3)
        r2 = asphalt_tonnage(2000, 3)
        assert abs(r2["net_tons"] - 2 * r1["net_tons"]) < 0.01

    def test_waste_factor_increases_tonnage(self):
        r1 = asphalt_tonnage(1000, 3, waste_pct=0)
        r2 = asphalt_tonnage(1000, 3, waste_pct=10)
        assert r2["tons_with_waste"] > r1["tons_with_waste"]

    def test_known_value(self):
        # 1000 SF × 3" thick × 145 lb/CF / 2000 = ~18.125 tons net
        result = asphalt_tonnage(1000, 3, density_lbcf=145, waste_pct=0)
        assert abs(result["net_tons"] - 18.125) < 0.05


class TestConcreteVolume:
    def test_slab_volume(self):
        result = concrete_volume("slab", length_ft=10, width_ft=10, thickness_in=6)
        # 10 × 10 × 0.5 ft = 50 CF = 1.852 CY
        assert abs(result["net_volume_cy"] - 1.852) < 0.01

    def test_wall_volume(self):
        result = concrete_volume("wall", length_ft=20, height_ft=8, thickness_in=12)
        # 20 × 8 × 1 ft = 160 CF = 5.926 CY
        assert abs(result["net_volume_cy"] - 5.926) < 0.01

    def test_cylinder_solid(self):
        result = concrete_volume("cylinder", od_ft=4, id_ft=0, height_ft=4)
        # π/4 × 4² × 4 = 50.27 CF = 1.862 CY
        assert abs(result["net_volume_cy"] - 1.862) < 0.01

    def test_waste_increases_volume(self):
        r0 = concrete_volume("slab", waste_pct=0, length_ft=10, width_ft=10, thickness_in=6)
        r5 = concrete_volume("slab", waste_pct=5, length_ft=10, width_ft=10, thickness_in=6)
        assert r5["volume_with_waste_cy"] > r0["volume_with_waste_cy"]

    def test_invalid_shape(self):
        with pytest.raises(ValueError):
            concrete_volume("pyramid", length_ft=10)
