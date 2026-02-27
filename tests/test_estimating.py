"""Tests for estimating tools."""
import pytest

from tools.estimating.estimating_tools import (
    calculate_material_cost,
    calculate_labor_cost,
    calculate_equipment_cost,
    estimate_project_cost,
)


class TestMaterialCost:
    def test_pipe_cost(self):
        result = calculate_material_cost("pipe", 100, "8")
        assert result["total_cost"] > 0
        assert result["total_with_waste"] > result["total_cost"]

    def test_concrete_cost(self):
        result = calculate_material_cost("concrete", 10)
        assert result["total_cost"] > 0

    def test_unknown_material_returns_error(self):
        result = calculate_material_cost("unobtainium", 100)
        assert "error" in result

    def test_waste_factor_applied(self):
        result = calculate_material_cost("pipe", 100, "8")
        assert result["total_with_waste"] == pytest.approx(result["total_cost"] * 1.1, rel=0.001)


class TestLaborCost:
    def test_operator_cost(self):
        result = calculate_labor_cost("operator", 8)
        assert result["total_cost"] == pytest.approx(85.0 * 8, rel=0.001)

    def test_unknown_labor_type(self):
        result = calculate_labor_cost("astronaut", 8)
        assert "error" in result

    def test_zero_hours(self):
        result = calculate_labor_cost("laborer", 0)
        assert result["total_cost"] == 0.0


class TestEquipmentCost:
    def test_excavator_cost(self):
        result = calculate_equipment_cost("excavator", 5)
        assert result["total_cost"] == pytest.approx(400.0 * 5, rel=0.001)

    def test_unknown_equipment(self):
        result = calculate_equipment_cost("spaceship", 1)
        assert "error" in result


class TestEstimateProjectCost:
    def test_full_estimate(self):
        result = estimate_project_cost(
            materials=[{"type": "pipe", "quantity": 100, "size": "8"}],
            labor=[{"type": "operator", "hours": 8}],
            equipment=[{"type": "excavator", "days": 1}],
            markup=0.15,
        )
        assert result["total"] > 0
        assert result["total"] > result["subtotal"]

    def test_markup_applied(self):
        result_no_markup = estimate_project_cost(
            materials=[{"type": "pipe", "quantity": 100, "size": "8"}],
            labor=[{"type": "laborer", "hours": 8}],
            equipment=[],
            markup=0.0,
        )
        result_markup = estimate_project_cost(
            materials=[{"type": "pipe", "quantity": 100, "size": "8"}],
            labor=[{"type": "laborer", "hours": 8}],
            equipment=[],
            markup=0.15,
        )
        assert result_markup["total"] > result_no_markup["total"]

    def test_returns_breakdown(self):
        result = estimate_project_cost(
            materials=[{"type": "pipe", "quantity": 100, "size": "8"}],
            labor=[{"type": "operator", "hours": 8}],
            equipment=[{"type": "compactor", "days": 2}],
        )
        for key in ["materials", "labor", "equipment", "subtotal", "total"]:
            assert key in result


class TestUnitConverter:
    def test_cy_to_cf(self):
        from tools.calculations.unit_converter import convert
        result = convert(1, "cy", "cf", "volume")
        assert abs(result["result"] - 27.0) < 0.001

    def test_psi_to_psf(self):
        from tools.calculations.unit_converter import convert
        result = convert(1, "psi", "psf", "pressure")
        assert abs(result["result"] - 144.0) < 0.001

    def test_ft_to_in(self):
        from tools.calculations.unit_converter import convert
        result = convert(1, "ft", "in", "length")
        assert abs(result["result"] - 12.0) < 0.001

    def test_invalid_category(self):
        from tools.calculations.unit_converter import convert
        with pytest.raises(ValueError):
            convert(1, "cy", "cf", "magic")

    def test_invalid_unit(self):
        from tools.calculations.unit_converter import convert
        with pytest.raises(ValueError):
            convert(1, "furlongs", "cf", "volume")
