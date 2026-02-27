"""Tests for hydraulics tools."""
import math
import pytest

from tools.field.hydraulics import pipe_flow_full, pipe_flow_partial, minimum_slope, flow_to_slope


class TestPipeFlowFull:
    def test_basic_flow(self):
        result = pipe_flow_full(12, 0.005)
        assert result["flow_cfs"] > 0
        assert result["velocity_fps"] > 0
        assert result["flow_gpm"] > 0

    def test_larger_pipe_more_flow(self):
        flow_12 = pipe_flow_full(12, 0.005)
        flow_24 = pipe_flow_full(24, 0.005)
        assert flow_24["flow_cfs"] > flow_12["flow_cfs"]

    def test_steeper_slope_more_flow(self):
        flow_flat = pipe_flow_full(12, 0.001)
        flow_steep = pipe_flow_full(12, 0.01)
        assert flow_steep["flow_cfs"] > flow_flat["flow_cfs"]

    def test_rougher_pipe_less_flow(self):
        flow_pvc = pipe_flow_full(12, 0.005, n=0.011)
        flow_cmp = pipe_flow_full(12, 0.005, n=0.024)
        assert flow_pvc["flow_cfs"] > flow_cmp["flow_cfs"]

    def test_returns_expected_keys(self):
        result = pipe_flow_full(8, 0.005)
        for key in ["flow_cfs", "flow_gpm", "velocity_fps", "area_sf", "hydraulic_radius_ft"]:
            assert key in result

    def test_known_value(self):
        # 12" concrete at 0.5% slope: approx 1.66 CFS
        result = pipe_flow_full(12, 0.005, n=0.013)
        assert 1.5 < result["flow_cfs"] < 1.8

    def test_velocity_equals_flow_over_area(self):
        result = pipe_flow_full(10, 0.003)
        computed_v = result["flow_cfs"] / result["area_sf"]
        assert abs(computed_v - result["velocity_fps"]) < 0.001


class TestPipeFlowPartial:
    def test_full_pipe_matches_full_flow(self):
        partial = pipe_flow_partial(12, 0.005, depth_ratio=1.0)
        full = pipe_flow_full(12, 0.005)
        assert abs(partial["partial"]["flow_cfs"] - full["flow_cfs"]) < 0.01

    def test_half_pipe_less_than_full(self):
        result = pipe_flow_partial(12, 0.005, depth_ratio=0.5)
        assert result["partial"]["flow_cfs"] < result["full_pipe"]["flow_cfs"]

    def test_meets_min_velocity_flag(self):
        # Low slope should fail
        result_low = pipe_flow_partial(8, 0.0001, depth_ratio=0.8)
        assert not result_low["meets_min_velocity"]

        # Good slope should pass
        result_ok = pipe_flow_partial(8, 0.01, depth_ratio=0.8)
        assert result_ok["meets_min_velocity"]

    def test_invalid_depth_ratio(self):
        with pytest.raises(ValueError):
            pipe_flow_partial(12, 0.005, depth_ratio=1.5)


class TestMinimumSlope:
    def test_returns_positive_slope(self):
        result = minimum_slope(8, 2.5)
        assert result["minimum_slope_ft_per_ft"] > 0

    def test_larger_pipe_needs_less_slope(self):
        slope_8 = minimum_slope(8, 2.5)
        slope_24 = minimum_slope(24, 2.5)
        assert slope_24["minimum_slope_ft_per_ft"] < slope_8["minimum_slope_ft_per_ft"]

    def test_higher_velocity_needs_more_slope(self):
        slope_2 = minimum_slope(8, 2.0)
        slope_3 = minimum_slope(8, 3.0)
        assert slope_3["minimum_slope_ft_per_ft"] > slope_2["minimum_slope_ft_per_ft"]

    def test_returns_expected_keys(self):
        result = minimum_slope(12)
        for key in ["minimum_slope_ft_per_ft", "minimum_slope_pct", "drop_per_100ft_ft", "drop_per_100ft_in"]:
            assert key in result

    def test_drop_consistent_with_slope(self):
        result = minimum_slope(8, 2.5)
        expected_drop = result["minimum_slope_ft_per_ft"] * 100
        assert abs(expected_drop - result["drop_per_100ft_ft"]) < 0.0001


class TestFlowToSlope:
    def test_returns_positive_slope(self):
        result = flow_to_slope(12, 500)
        assert result["required_slope_ft_per_ft"] > 0

    def test_higher_flow_needs_more_slope(self):
        s1 = flow_to_slope(12, 500)
        s2 = flow_to_slope(12, 1000)
        assert s2["required_slope_ft_per_ft"] > s1["required_slope_ft_per_ft"]
