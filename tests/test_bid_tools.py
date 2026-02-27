"""Tests for bid and cost calculation tools."""
import pytest

from tools.calculations.bid_tools import (
    markup_bid_price,
    unit_price,
    change_order_tm,
    production_rate,
    crew_day_cost,
)


class TestMarkupBidPrice:
    def test_bid_greater_than_cost(self):
        result = markup_bid_price(100000)
        assert result["bid_price"] > result["direct_cost"]

    def test_zero_markup_equals_cost(self):
        result = markup_bid_price(100000, overhead_pct=0, profit_pct=0)
        assert result["bid_price"] == 100000.0

    def test_known_value(self):
        # $100k cost, 12% OH, 10% profit
        # OH = $12k, loaded = $112k, profit = $11.2k, bid = $123.2k
        result = markup_bid_price(100000, overhead_pct=12, profit_pct=10)
        assert abs(result["bid_price"] - 123200) < 1

    def test_returns_expected_keys(self):
        result = markup_bid_price(50000)
        for key in ["direct_cost", "overhead", "profit", "bid_price", "total_markup_on_cost_pct"]:
            assert key in result

    def test_total_markup_consistent(self):
        result = markup_bid_price(100000, overhead_pct=12, profit_pct=10)
        expected_markup = (result["bid_price"] / result["direct_cost"] - 1) * 100
        assert abs(result["total_markup_on_cost_pct"] - expected_markup) < 0.01


class TestUnitPrice:
    def test_unit_price_covers_all_costs(self):
        result = unit_price(10, 15, 5, overhead_pct=0, profit_pct=0)
        assert abs(result["unit_bid_price"] - 30) < 0.01

    def test_with_markup(self):
        result = unit_price(10, 10, 10, overhead_pct=10, profit_pct=10)
        assert result["unit_bid_price"] > 30

    def test_extended_total(self):
        result = unit_price(10, 10, 10, overhead_pct=0, profit_pct=0, quantity=100)
        assert abs(result["extended_total"] - 3000) < 0.01

    def test_subcontractor_included(self):
        without_sub = unit_price(10, 10, 10, subcontractor_per_unit=0, overhead_pct=0, profit_pct=0)
        with_sub = unit_price(10, 10, 10, subcontractor_per_unit=5, overhead_pct=0, profit_pct=0)
        assert with_sub["unit_bid_price"] > without_sub["unit_bid_price"]


class TestChangeOrderTM:
    def test_total_greater_than_subtotal(self):
        result = change_order_tm(
            labor_items=[{"description": "Operator", "hours": 8, "rate": 95}],
            equipment_items=[{"description": "Excavator", "hours": 8, "rate": 120}],
            material_cost=500,
        )
        assert result["change_order_total"] > result["subtotal"]

    def test_zero_markup(self):
        result = change_order_tm(
            labor_items=[{"description": "Laborer", "hours": 8, "rate": 50}],
            equipment_items=[],
            material_cost=0,
            overhead_profit_pct=0,
            bond_pct=0,
        )
        assert abs(result["change_order_total"] - 400) < 0.01

    def test_labor_total_correct(self):
        result = change_order_tm(
            labor_items=[
                {"description": "Op", "hours": 4, "rate": 100},
                {"description": "Lab", "hours": 8, "rate": 50},
            ],
            equipment_items=[],
            material_cost=0,
            overhead_profit_pct=0,
            bond_pct=0,
        )
        assert abs(result["labor_total"] - 800) < 0.01


class TestProductionRate:
    def test_duration_calculation(self):
        result = production_rate(
            production_rate_per_day=250,
            total_quantity=5000,
            crew_size=5,
            crew_rate_per_hr=65,
            hours_per_day=10,
        )
        assert abs(result["duration_days"] - 20.0) < 0.01

    def test_cost_per_unit(self):
        # 5 workers × $60/hr × 10 hrs = $3000/day + $500 equip = $3500
        # at 250 LF/day: $14/LF
        result = production_rate(250, 5000, 5, 60, 10, 500)
        assert abs(result["cost_per_unit"] - 14.0) < 0.01

    def test_total_cost_consistent(self):
        result = production_rate(250, 1000, 5, 65, 10, 0)
        expected = result["cost_per_unit"] * 1000
        assert abs(result["total_direct_cost"] - expected) < 1


class TestCrewDayCost:
    def test_total_includes_overhead(self):
        result = crew_day_cost(
            labor_items=[{"role": "Op", "hours": 10, "rate": 85}],
            equipment_items=[{"name": "Excavator", "daily_rate": 400}],
            small_tools_consumables=150,
            overhead_burden_pct=25,
        )
        assert result["total_day_cost"] > result["subtotal"]

    def test_zero_overhead(self):
        result = crew_day_cost(
            labor_items=[{"role": "Op", "hours": 8, "rate": 100}],
            equipment_items=[],
            small_tools_consumables=0,
            overhead_burden_pct=0,
        )
        assert abs(result["total_day_cost"] - 800) < 0.01
