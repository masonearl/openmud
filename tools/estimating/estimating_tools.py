"""
openmud Estimating Tools
Regional rate tables for material, labor, and equipment costs.

Rate table structure is designed to support:
- Multiple geographic regions with independent rate sets
- Future scraping / external data loading via load_rates_from_json()
- Prevailing wage vs. open shop differentiation
- Overtime multipliers, benefits burden, and escalation factors

Rates are all-in (wages + benefits burden where noted).
Updated: 2025 Q1 — contribute better regional data at github.com/masonearl/openmud
"""

from copy import deepcopy
import json
import re
from pathlib import Path

# ─── Region Definitions ────────────────────────────────────────────────────────
# Each region is a self-contained rate table. Keys are lowercase slugs.
# Add new regions by adding a new dict here or via load_rates_from_json().

RATE_TABLES = {

    # ── National average — open shop ──────────────────────────────────────────
    "national": {
        "label": "National Average (Open Shop)",
        "description": (
            "National averages for open-shop heavy civil and underground utility work. "
            "Labor rates are all-in (wages + typical benefits burden ~30%). "
            "Use as baseline when regional data is unavailable."
        ),
        "wage_type": "open_shop",
        "source": "openmud estimating database — community contributed",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 75.00,  "overtime": 112.50, "title": "Heavy Equipment Operator"},
            "laborer":          {"hourly": 38.00,  "overtime": 57.00,  "title": "Laborer"},
            "foreman":          {"hourly": 62.00,  "overtime": 93.00,  "title": "Foreman"},
            "superintendent":   {"hourly": 95.00,  "overtime": 142.50, "title": "Superintendent"},
            "pipe_layer":       {"hourly": 52.00,  "overtime": 78.00,  "title": "Pipe Layer"},
            "grade_checker":    {"hourly": 60.00,  "overtime": 90.00,  "title": "Survey / Grade Checker"},
            "traffic_control":  {"hourly": 28.00,  "overtime": 42.00,  "title": "Traffic Control Flagger"},
            "ironworker":       {"hourly": 58.00,  "overtime": 87.00,  "title": "Ironworker"},
            "electrician":      {"hourly": 70.00,  "overtime": 105.00, "title": "Electrician"},
            "plumber":          {"hourly": 68.00,  "overtime": 102.00, "title": "Plumber"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_4":   {"unit": "LF",  "cost": 8.50,  "description": "4\" PVC C900 water"},
                "pvc_c900_6":   {"unit": "LF",  "cost": 13.00, "description": "6\" PVC C900 water"},
                "pvc_c900_8":   {"unit": "LF",  "cost": 19.00, "description": "8\" PVC C900 water"},
                "pvc_c900_10":  {"unit": "LF",  "cost": 27.00, "description": "10\" PVC C900 water"},
                "pvc_c900_12":  {"unit": "LF",  "cost": 38.00, "description": "12\" PVC C900 water"},
                "pvc_sdr35_4":  {"unit": "LF",  "cost": 5.50,  "description": "4\" PVC SDR 35 sewer"},
                "pvc_sdr35_6":  {"unit": "LF",  "cost": 8.00,  "description": "6\" PVC SDR 35 sewer"},
                "pvc_sdr35_8":  {"unit": "LF",  "cost": 11.00, "description": "8\" PVC SDR 35 sewer"},
                "pvc_sdr35_12": {"unit": "LF",  "cost": 18.00, "description": "12\" PVC SDR 35 sewer"},
                "dip_4":        {"unit": "LF",  "cost": 22.00, "description": "4\" Ductile Iron"},
                "dip_6":        {"unit": "LF",  "cost": 32.00, "description": "6\" Ductile Iron"},
                "dip_8":        {"unit": "LF",  "cost": 42.00, "description": "8\" Ductile Iron"},
                "dip_12":       {"unit": "LF",  "cost": 62.00, "description": "12\" Ductile Iron"},
                "hdpe_4":       {"unit": "LF",  "cost": 9.00,  "description": "4\" HDPE DR11"},
                "hdpe_6":       {"unit": "LF",  "cost": 15.00, "description": "6\" HDPE DR11"},
                "hdpe_8":       {"unit": "LF",  "cost": 22.00, "description": "8\" HDPE DR11"},
                "rcp_12":       {"unit": "LF",  "cost": 35.00, "description": "12\" RCP Class III"},
                "rcp_18":       {"unit": "LF",  "cost": 65.00, "description": "18\" RCP Class III"},
                "rcp_24":       {"unit": "LF",  "cost": 95.00, "description": "24\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 18.00, "description": "3/4\" Crushed Rock (pipe bedding)"},
                "base_course":     {"unit": "ton", "cost": 16.00, "description": "1.5\" Road Base / Base Course"},
                "screened_sand":   {"unit": "ton", "cost": 14.00, "description": "Screened Sand"},
                "pit_run":         {"unit": "ton", "cost": 10.00, "description": "Pit Run / Import Fill"},
                "rip_rap":         {"unit": "ton", "cost": 28.00, "description": "Rip Rap (erosion control)"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 165.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 180.00, "description": "4,000 PSI Ready Mix"},
                "5000_psi": {"unit": "CY", "cost": 195.00, "description": "5,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 90.00, "description": "HMA Dense Graded (trench patch/paving)"},
                "hma_sma":   {"unit": "ton", "cost": 105.00, "description": "Stone Matrix Asphalt (SMA)"},
            },
            "reinforcement": {
                "rebar_4":   {"unit": "LF", "cost": 1.25, "description": "#4 Rebar (1/2\")"},
                "rebar_5":   {"unit": "LF", "cost": 1.75, "description": "#5 Rebar (5/8\")"},
                "rebar_6":   {"unit": "LF", "cost": 2.40, "description": "#6 Rebar (3/4\")"},
                "wire_mesh": {"unit": "SY", "cost": 4.50, "description": "6x6 Welded Wire Mesh"},
            },
        },
        "equipment": {
            "excavator_20t":    {"daily": 450.00,  "hourly": 65.00,  "description": "20-Ton Excavator"},
            "excavator_30t":    {"daily": 650.00,  "hourly": 90.00,  "description": "30-Ton Excavator"},
            "excavator_mini":   {"daily": 225.00,  "hourly": 35.00,  "description": "Mini Excavator (< 5 ton)"},
            "backhoe":          {"daily": 350.00,  "hourly": 50.00,  "description": "Backhoe / Loader"},
            "dozer_d6":         {"daily": 550.00,  "hourly": 78.00,  "description": "Dozer D6 Class"},
            "motor_grader":     {"daily": 600.00,  "hourly": 85.00,  "description": "Motor Grader"},
            "wheel_loader":     {"daily": 450.00,  "hourly": 65.00,  "description": "Wheel Loader"},
            "dump_truck":       {"daily": 350.00,  "hourly": 55.00,  "description": "Tandem Dump Truck"},
            "water_truck":      {"daily": 300.00,  "hourly": 45.00,  "description": "Water Truck"},
            "lowboy":           {"daily": 250.00,  "hourly": 38.00,  "description": "Lowboy / Equipment Trailer"},
            "roller_sheepsfoot": {"daily": 350.00, "hourly": 50.00, "description": "Sheepsfoot Roller"},
            "plate_compactor":  {"daily": 75.00,   "hourly": 12.00,  "description": "Plate Compactor"},
            "jumping_jack":     {"daily": 100.00,  "hourly": 15.00,  "description": "Jumping Jack Tamper"},
            "dewatering_pump":  {"daily": 150.00,  "hourly": 22.00,  "description": "Dewatering Pump"},
            "generator":        {"daily": 85.00,   "hourly": 12.00,  "description": "Generator"},
            "laser_level":      {"daily": 75.00,   "hourly": 10.00,  "description": "Laser Level / Transit"},
            "trench_box":       {"daily": 120.00,  "hourly": 18.00,  "description": "Trench Box / Shield"},
            "compactor":        {"daily": 100.00,  "hourly": 15.00,  "description": "Compactor (generic)"},
            "auger":            {"daily": 450.00,  "hourly": 65.00,  "description": "Auger / Boring Machine"},
            "excavator":        {"daily": 450.00,  "hourly": 65.00,  "description": "Excavator (generic)"},
        },
    },

    # ── Utah — Wasatch Front, open shop ───────────────────────────────────────
    "utah": {
        "label": "Utah — Wasatch Front (Open Shop)",
        "description": (
            "Open-shop rates for the Wasatch Front (Salt Lake, Utah, Davis, Weber counties). "
            "Rates reflect local market conditions as of 2025. Prevailing wage applies on UDOT "
            "and many municipal projects — use 'utah_prevailing' for those."
        ),
        "wage_type": "open_shop",
        "source": "openmud estimating database — Utah open shop",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 72.00,  "overtime": 108.00, "title": "Heavy Equipment Operator"},
            "laborer":          {"hourly": 32.00,  "overtime": 48.00,  "title": "Laborer"},
            "foreman":          {"hourly": 58.00,  "overtime": 87.00,  "title": "Foreman"},
            "superintendent":   {"hourly": 88.00,  "overtime": 132.00, "title": "Superintendent"},
            "pipe_layer":       {"hourly": 48.00,  "overtime": 72.00,  "title": "Pipe Layer"},
            "grade_checker":    {"hourly": 55.00,  "overtime": 82.50,  "title": "Survey / Grade Checker"},
            "traffic_control":  {"hourly": 25.00,  "overtime": 37.50,  "title": "Traffic Control Flagger"},
            "ironworker":       {"hourly": 55.00,  "overtime": 82.50,  "title": "Ironworker"},
            "electrician":      {"hourly": 65.00,  "overtime": 97.50,  "title": "Electrician"},
            "plumber":          {"hourly": 62.00,  "overtime": 93.00,  "title": "Plumber"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_4":   {"unit": "LF",  "cost": 8.00,  "description": "4\" PVC C900 water"},
                "pvc_c900_6":   {"unit": "LF",  "cost": 12.00, "description": "6\" PVC C900 water"},
                "pvc_c900_8":   {"unit": "LF",  "cost": 18.00, "description": "8\" PVC C900 water"},
                "pvc_c900_10":  {"unit": "LF",  "cost": 26.00, "description": "10\" PVC C900 water"},
                "pvc_c900_12":  {"unit": "LF",  "cost": 37.00, "description": "12\" PVC C900 water"},
                "pvc_sdr35_8":  {"unit": "LF",  "cost": 10.50, "description": "8\" PVC SDR 35 sewer"},
                "pvc_sdr35_12": {"unit": "LF",  "cost": 17.00, "description": "12\" PVC SDR 35 sewer"},
                "dip_8":        {"unit": "LF",  "cost": 40.00, "description": "8\" Ductile Iron"},
                "dip_12":       {"unit": "LF",  "cost": 60.00, "description": "12\" Ductile Iron"},
                "rcp_12":       {"unit": "LF",  "cost": 33.00, "description": "12\" RCP Class III"},
                "rcp_18":       {"unit": "LF",  "cost": 62.00, "description": "18\" RCP Class III"},
                "rcp_24":       {"unit": "LF",  "cost": 92.00, "description": "24\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 16.00, "description": "3/4\" Crushed Rock"},
                "base_course":     {"unit": "ton", "cost": 14.00, "description": "1.5\" Road Base"},
                "screened_sand":   {"unit": "ton", "cost": 12.00, "description": "Screened Sand"},
                "pit_run":         {"unit": "ton", "cost": 8.00,  "description": "Pit Run / Import Fill"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 160.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 175.00, "description": "4,000 PSI Ready Mix"},
                "5000_psi": {"unit": "CY", "cost": 190.00, "description": "5,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 85.00, "description": "HMA Dense Graded"},
            },
            "reinforcement": {
                "rebar_4": {"unit": "LF", "cost": 1.20, "description": "#4 Rebar"},
                "rebar_5": {"unit": "LF", "cost": 1.70, "description": "#5 Rebar"},
            },
        },
        "equipment": {
            "excavator_20t":    {"daily": 430.00,  "hourly": 62.00,  "description": "20-Ton Excavator"},
            "excavator_30t":    {"daily": 620.00,  "hourly": 88.00,  "description": "30-Ton Excavator"},
            "excavator_mini":   {"daily": 210.00,  "hourly": 32.00,  "description": "Mini Excavator"},
            "backhoe":          {"daily": 330.00,  "hourly": 48.00,  "description": "Backhoe / Loader"},
            "dozer_d6":         {"daily": 520.00,  "hourly": 75.00,  "description": "Dozer D6 Class"},
            "dump_truck":       {"daily": 320.00,  "hourly": 50.00,  "description": "Tandem Dump Truck"},
            "water_truck":      {"daily": 275.00,  "hourly": 42.00,  "description": "Water Truck"},
            "roller_sheepsfoot": {"daily": 320.00, "hourly": 46.00, "description": "Sheepsfoot Roller"},
            "plate_compactor":  {"daily": 70.00,   "hourly": 11.00,  "description": "Plate Compactor"},
            "jumping_jack":     {"daily": 95.00,   "hourly": 14.00,  "description": "Jumping Jack Tamper"},
            "dewatering_pump":  {"daily": 140.00,  "hourly": 20.00,  "description": "Dewatering Pump"},
            "trench_box":       {"daily": 110.00,  "hourly": 16.00,  "description": "Trench Box / Shield"},
            "compactor":        {"daily": 95.00,   "hourly": 14.00,  "description": "Compactor (generic)"},
            "auger":            {"daily": 430.00,  "hourly": 62.00,  "description": "Auger / Boring Machine"},
            "excavator":        {"daily": 430.00,  "hourly": 62.00,  "description": "Excavator (generic)"},
        },
    },

    # ── Mountain West — CO, NV, AZ, NM, open shop ────────────────────────────
    "mountain_west": {
        "label": "Mountain West (Open Shop)",
        "description": (
            "Open-shop rates for Colorado, Nevada, Arizona, and New Mexico. "
            "Significant variation exists within this region — Denver/Las Vegas "
            "metros run 10-15% above these averages."
        ),
        "wage_type": "open_shop",
        "source": "openmud estimating database — Mountain West",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 80.00,  "overtime": 120.00, "title": "Heavy Equipment Operator"},
            "laborer":          {"hourly": 40.00,  "overtime": 60.00,  "title": "Laborer"},
            "foreman":          {"hourly": 68.00,  "overtime": 102.00, "title": "Foreman"},
            "superintendent":   {"hourly": 100.00, "overtime": 150.00, "title": "Superintendent"},
            "pipe_layer":       {"hourly": 55.00,  "overtime": 82.50,  "title": "Pipe Layer"},
            "grade_checker":    {"hourly": 62.00,  "overtime": 93.00,  "title": "Survey / Grade Checker"},
            "traffic_control":  {"hourly": 30.00,  "overtime": 45.00,  "title": "Traffic Control Flagger"},
            "ironworker":       {"hourly": 62.00,  "overtime": 93.00,  "title": "Ironworker"},
            "electrician":      {"hourly": 75.00,  "overtime": 112.50, "title": "Electrician"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_8":  {"unit": "LF", "cost": 19.50, "description": "8\" PVC C900 water"},
                "pvc_c900_12": {"unit": "LF", "cost": 39.00, "description": "12\" PVC C900 water"},
                "dip_8":       {"unit": "LF", "cost": 43.00, "description": "8\" Ductile Iron"},
                "rcp_18":      {"unit": "LF", "cost": 68.00, "description": "18\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 20.00, "description": "3/4\" Crushed Rock"},
                "base_course":     {"unit": "ton", "cost": 17.00, "description": "1.5\" Road Base"},
                "pit_run":         {"unit": "ton", "cost": 11.00, "description": "Import Fill"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 170.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 185.00, "description": "4,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 95.00, "description": "HMA Dense Graded"},
            },
            "reinforcement": {
                "rebar_4": {"unit": "LF", "cost": 1.30, "description": "#4 Rebar"},
                "rebar_5": {"unit": "LF", "cost": 1.80, "description": "#5 Rebar"},
            },
        },
        "equipment": {
            "excavator_20t":  {"daily": 460.00, "hourly": 66.00, "description": "20-Ton Excavator"},
            "dozer_d6":       {"daily": 570.00, "hourly": 80.00, "description": "Dozer D6 Class"},
            "dump_truck":     {"daily": 360.00, "hourly": 56.00, "description": "Tandem Dump Truck"},
            "compactor":      {"daily": 105.00, "hourly": 16.00, "description": "Compactor"},
            "excavator":      {"daily": 460.00, "hourly": 66.00, "description": "Excavator (generic)"},
            "auger":          {"daily": 460.00, "hourly": 66.00, "description": "Auger / Boring Machine"},
        },
    },

    # ── Texas — open shop, Houston/Dallas metro ───────────────────────────────
    "texas": {
        "label": "Texas (Open Shop, Houston/Dallas)",
        "description": (
            "Open-shop rates for Texas major metros (Houston, Dallas-Fort Worth). "
            "Labor is competitive and lower than most regions. Rural Texas "
            "runs 5-10% lower. No state income tax — take-home is higher."
        ),
        "wage_type": "open_shop",
        "source": "openmud estimating database — Texas",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 68.00,  "overtime": 102.00, "title": "Heavy Equipment Operator"},
            "laborer":          {"hourly": 30.00,  "overtime": 45.00,  "title": "Laborer"},
            "foreman":          {"hourly": 55.00,  "overtime": 82.50,  "title": "Foreman"},
            "superintendent":   {"hourly": 85.00,  "overtime": 127.50, "title": "Superintendent"},
            "pipe_layer":       {"hourly": 45.00,  "overtime": 67.50,  "title": "Pipe Layer"},
            "grade_checker":    {"hourly": 52.00,  "overtime": 78.00,  "title": "Survey / Grade Checker"},
            "traffic_control":  {"hourly": 24.00,  "overtime": 36.00,  "title": "Traffic Control Flagger"},
            "ironworker":       {"hourly": 52.00,  "overtime": 78.00,  "title": "Ironworker"},
            "electrician":      {"hourly": 62.00,  "overtime": 93.00,  "title": "Electrician"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_8":  {"unit": "LF", "cost": 18.50, "description": "8\" PVC C900 water"},
                "pvc_c900_12": {"unit": "LF", "cost": 37.00, "description": "12\" PVC C900 water"},
                "dip_8":       {"unit": "LF", "cost": 41.00, "description": "8\" Ductile Iron"},
                "rcp_18":      {"unit": "LF", "cost": 64.00, "description": "18\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 17.00, "description": "3/4\" Crushed Rock"},
                "base_course":     {"unit": "ton", "cost": 15.00, "description": "Road Base"},
                "pit_run":         {"unit": "ton", "cost": 9.00,  "description": "Import Fill"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 158.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 172.00, "description": "4,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 88.00, "description": "HMA Dense Graded"},
            },
            "reinforcement": {
                "rebar_4": {"unit": "LF", "cost": 1.20, "description": "#4 Rebar"},
                "rebar_5": {"unit": "LF", "cost": 1.65, "description": "#5 Rebar"},
            },
        },
        "equipment": {
            "excavator_20t": {"daily": 420.00, "hourly": 60.00, "description": "20-Ton Excavator"},
            "dozer_d6":      {"daily": 510.00, "hourly": 73.00, "description": "Dozer D6 Class"},
            "dump_truck":    {"daily": 320.00, "hourly": 50.00, "description": "Tandem Dump Truck"},
            "compactor":     {"daily": 95.00,  "hourly": 14.00, "description": "Compactor"},
            "excavator":     {"daily": 420.00, "hourly": 60.00, "description": "Excavator (generic)"},
            "auger":         {"daily": 420.00, "hourly": 60.00, "description": "Auger / Boring Machine"},
        },
    },

    # ── California — prevailing wage, Southern CA / Bay Area ──────────────────
    "california": {
        "label": "California (Prevailing Wage)",
        "description": (
            "California prevailing wage rates for public works projects. "
            "Private work rates are 15-25% lower. Rates vary significantly by "
            "county — LA/Bay Area run highest. Includes fringe benefits. "
            "Always verify with DIR wage determinations for the specific county."
        ),
        "wage_type": "prevailing_wage",
        "source": "openmud estimating database — California prevailing wage (DIR)",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 125.00, "overtime": 187.50, "title": "Operating Engineer"},
            "laborer":          {"hourly": 98.00,  "overtime": 147.00, "title": "Laborer"},
            "foreman":          {"hourly": 138.00, "overtime": 207.00, "title": "Foreman"},
            "superintendent":   {"hourly": 155.00, "overtime": 232.50, "title": "General Foreman / Super"},
            "pipe_layer":       {"hourly": 105.00, "overtime": 157.50, "title": "Pipe Layer (IUOE)"},
            "grade_checker":    {"hourly": 112.00, "overtime": 168.00, "title": "Grade Checker (IUOE)"},
            "traffic_control":  {"hourly": 75.00,  "overtime": 112.50, "title": "Flagger (Laborer union)"},
            "ironworker":       {"hourly": 118.00, "overtime": 177.00, "title": "Ironworker"},
            "electrician":      {"hourly": 135.00, "overtime": 202.50, "title": "IBEW Electrician"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_8":  {"unit": "LF", "cost": 21.00, "description": "8\" PVC C900 water"},
                "pvc_c900_12": {"unit": "LF", "cost": 43.00, "description": "12\" PVC C900 water"},
                "dip_8":       {"unit": "LF", "cost": 46.00, "description": "8\" Ductile Iron"},
                "rcp_18":      {"unit": "LF", "cost": 72.00, "description": "18\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 28.00, "description": "3/4\" Crushed Rock"},
                "base_course":     {"unit": "ton", "cost": 24.00, "description": "Class 2 Base"},
                "pit_run":         {"unit": "ton", "cost": 16.00, "description": "Import Borrow"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 180.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 198.00, "description": "4,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 105.00, "description": "HMA Type A"},
            },
            "reinforcement": {
                "rebar_4": {"unit": "LF", "cost": 1.40, "description": "#4 Rebar"},
                "rebar_5": {"unit": "LF", "cost": 1.95, "description": "#5 Rebar"},
            },
        },
        "equipment": {
            "excavator_20t": {"daily": 510.00, "hourly": 73.00, "description": "20-Ton Excavator"},
            "dozer_d6":      {"daily": 620.00, "hourly": 88.00, "description": "Dozer D6 Class"},
            "dump_truck":    {"daily": 400.00, "hourly": 62.00, "description": "Tandem Dump Truck"},
            "compactor":     {"daily": 115.00, "hourly": 17.00, "description": "Compactor"},
            "excavator":     {"daily": 510.00, "hourly": 73.00, "description": "Excavator (generic)"},
            "auger":         {"daily": 510.00, "hourly": 73.00, "description": "Auger / Boring Machine"},
        },
    },

    # ── Northeast — union, NYC / Boston / NJ ──────────────────────────────────
    "northeast": {
        "label": "Northeast (Union, NYC/Boston/NJ)",
        "description": (
            "Union prevailing wage rates for New York City, New Jersey, and Boston metro. "
            "Among the highest construction labor costs in the country. "
            "Rates include benefits (annuity, health, training funds). "
            "Verify with specific local union agreements — rate varies by local."
        ),
        "wage_type": "union_prevailing",
        "source": "openmud estimating database — Northeast union",
        "last_updated": "2025-Q1",
        "labor": {
            "operator":         {"hourly": 148.00, "overtime": 222.00, "title": "Operating Engineer (Local 14/825)"},
            "laborer":          {"hourly": 118.00, "overtime": 177.00, "title": "Laborer (LIUNA)"},
            "foreman":          {"hourly": 165.00, "overtime": 247.50, "title": "Foreman"},
            "superintendent":   {"hourly": 185.00, "overtime": 277.50, "title": "General Foreman"},
            "pipe_layer":       {"hourly": 130.00, "overtime": 195.00, "title": "Pipe Layer"},
            "grade_checker":    {"hourly": 140.00, "overtime": 210.00, "title": "Grade Checker"},
            "traffic_control":  {"hourly": 95.00,  "overtime": 142.50, "title": "Flagger"},
            "ironworker":       {"hourly": 145.00, "overtime": 217.50, "title": "Ironworker (Local 361)"},
            "electrician":      {"hourly": 155.00, "overtime": 232.50, "title": "IBEW Electrician (Local 3)"},
        },
        "materials": {
            "pipe": {
                "pvc_c900_8":  {"unit": "LF", "cost": 22.00, "description": "8\" PVC C900 water"},
                "pvc_c900_12": {"unit": "LF", "cost": 44.00, "description": "12\" PVC C900 water"},
                "dip_8":       {"unit": "LF", "cost": 48.00, "description": "8\" Ductile Iron"},
                "rcp_18":      {"unit": "LF", "cost": 78.00, "description": "18\" RCP Class III"},
            },
            "aggregate": {
                "crushed_rock_34": {"unit": "ton", "cost": 32.00, "description": "3/4\" Crushed Stone"},
                "base_course":     {"unit": "ton", "cost": 28.00, "description": "Crusher Run"},
                "pit_run":         {"unit": "ton", "cost": 20.00, "description": "Select Fill"},
            },
            "concrete": {
                "3000_psi": {"unit": "CY", "cost": 195.00, "description": "3,000 PSI Ready Mix"},
                "4000_psi": {"unit": "CY", "cost": 215.00, "description": "4,000 PSI Ready Mix"},
            },
            "asphalt": {
                "hma_dense": {"unit": "ton", "cost": 115.00, "description": "HMA Type 6F"},
            },
            "reinforcement": {
                "rebar_4": {"unit": "LF", "cost": 1.50, "description": "#4 Rebar"},
                "rebar_5": {"unit": "LF", "cost": 2.10, "description": "#5 Rebar"},
            },
        },
        "equipment": {
            "excavator_20t": {"daily": 530.00, "hourly": 76.00, "description": "20-Ton Excavator"},
            "dozer_d6":      {"daily": 650.00, "hourly": 92.00, "description": "Dozer D6 Class"},
            "dump_truck":    {"daily": 420.00, "hourly": 65.00, "description": "Tandem Dump Truck"},
            "compactor":     {"daily": 120.00, "hourly": 18.00, "description": "Compactor"},
            "excavator":     {"daily": 530.00, "hourly": 76.00, "description": "Excavator (generic)"},
            "auger":         {"daily": 530.00, "hourly": 76.00, "description": "Auger / Boring Machine"},
        },
    },

}

# ── Backward-compatible flat rates (used by simple calcs / legacy code) ────────
# These resolve to national averages for compatibility.
MATERIAL_PRICING = {
    "pipe": {
        "4_inch": {"unit": "linear_foot", "cost": 8.50},
        "6_inch": {"unit": "linear_foot", "cost": 13.00},
        "8_inch": {"unit": "linear_foot", "cost": 19.00},
    },
    "concrete": {
        "3000_psi": {"unit": "cubic_yard", "cost": 165.00},
        "4000_psi": {"unit": "cubic_yard", "cost": 180.00},
    },
    "rebar": {
        "4_rebar": {"unit": "linear_foot", "cost": 1.25},
        "5_rebar": {"unit": "linear_foot", "cost": 1.75},
    },
}

LABOR_RATES = {r: {"hourly": v["hourly"]} for r, v in RATE_TABLES["national"]["labor"].items()}

EQUIPMENT_RATES = {
    k: {"daily": v["daily"]}
    for k, v in RATE_TABLES["national"]["equipment"].items()
}


# ── Public API ─────────────────────────────────────────────────────────────────

def get_regions() -> list:
    """Return list of available region keys with labels."""
    _load_external_rate_tables()
    return [
        {
            "key": key,
            "label": region["label"],
            "wage_type": region["wage_type"],
            "description": region["description"],
        }
        for key, region in RATE_TABLES.items()
    ]


def get_rates(region: str = "national") -> dict:
    """Return the full rate table for a region. Falls back to national."""
    _load_external_rate_tables()
    return RATE_TABLES.get(region.lower(), RATE_TABLES["national"])


def load_rates_from_json(region_key: str, data: dict) -> None:
    """
    Load or override a region's rates from external JSON data.
    Intended for future use with scraped prevailing wage data,
    state DOL publications, or community-contributed rate tables.

    Args:
        region_key: Slug for the region (e.g. 'utah_prevailing')
        data: Dict matching the RATE_TABLES structure
    """
    RATE_TABLES[region_key] = data


HEAVYBID_NORMALIZED_DIR = Path(__file__).resolve().parents[2] / "data" / "heavybid" / "normalized"
_EXTERNAL_LIBRARIES_LOADED = False


def _safe_load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text or "").strip().lower()).strip("_")


def _tokenize(text: str) -> list:
    return [part for part in re.split(r"[^a-z0-9]+", str(text or "").lower()) if part]


HISTORY_STOPWORDS = {
    "a",
    "an",
    "and",
    "existing",
    "for",
    "in",
    "install",
    "installation",
    "item",
    "line",
    "main",
    "new",
    "of",
    "pipe",
    "the",
    "to",
    "work",
}


def _bucket_average(items: list) -> float:
    values = [float(value) for value in items if value is not None]
    return round(sum(values) / len(values), 4) if values else 0.0


def _match_labor_type(record: dict) -> str | None:
    desc = f"{record.get('description', '')} {record.get('labor_code', '')}".lower()
    if "foreman" in desc:
        return "foreman"
    if "labor" in desc:
        return "laborer"
    if "operator" in desc or str(record.get("labor_code", "")).upper().startswith("O"):
        return "operator"
    if "pipe" in desc:
        return "pipe_layer"
    if "grade" in desc or "survey" in desc:
        return "grade_checker"
    if "traffic" in desc or "flag" in desc:
        return "traffic_control"
    if "electric" in desc:
        return "electrician"
    if "iron" in desc:
        return "ironworker"
    if "plumb" in desc:
        return "plumber"
    return None


def _match_equipment_type(record: dict) -> str | None:
    desc = f"{record.get('description', '')} {record.get('equipment_code', '')}".lower()
    mappings = [
        ("excavator_mini", ["mini excavator"]),
        ("excavator_30t", ["excavator 330", "excavator 320", "excavator 30"]),
        ("excavator_20t", ["excavator", "trackhoe"]),
        ("backhoe", ["backhoe"]),
        ("dozer_d6", ["dozer", "d6"]),
        ("dump_truck", ["dump truck"]),
        ("water_truck", ["water truck"]),
        ("roller_sheepsfoot", ["sheepsfoot"]),
        ("plate_compactor", ["plate compactor"]),
        ("jumping_jack", ["jumping jack", "rammer"]),
        ("dewatering_pump", ["pump"]),
        ("generator", ["generator"]),
        ("trench_box", ["trench box", "trench plate", "shield"]),
        ("auger", ["auger", "drill"]),
        ("compactor", ["compactor"]),
    ]
    for key, phrases in mappings:
        if any(phrase in desc for phrase in phrases):
            return key
    return None


def _match_material_key(record: dict) -> tuple[str, str] | None:
    desc = f"{record.get('description', '')} {record.get('resource_code', '')}".lower()
    if "road base" in desc or "base course" in desc:
        return ("aggregate", "base_course")
    if "sand" in desc:
        return ("aggregate", "screened_sand")
    if "flow sand" in desc:
        return ("aggregate", "screened_sand")
    if "rebar" in desc and "#5" in desc:
        return ("reinforcement", "rebar_5")
    if "rebar" in desc and "#4" in desc:
        return ("reinforcement", "rebar_4")
    if "concrete" in desc and "4000" in desc:
        return ("concrete", "4000_psi")
    if "concrete" in desc and "3000" in desc:
        return ("concrete", "3000_psi")

    size_match = re.search(r"(\d+)\s*(?:in|inch|\")", desc)
    if size_match:
        size = size_match.group(1)
        if "pe" in desc or "poly" in desc or "hdpe" in desc:
            return ("pipe", f"hdpe_{size}")
        if "ductile" in desc or "dip" in desc:
            return ("pipe", f"dip_{size}")
        if "pvc" in desc and ("c900" in desc or "water" in desc):
            return ("pipe", f"pvc_c900_{size}")
        if "pvc" in desc and ("sdr" in desc or "sewer" in desc):
            return ("pipe", f"pvc_sdr35_{size}")
        if "rcp" in desc or "concrete pipe" in desc:
            return ("pipe", f"rcp_{size}")
    return None


def _apply_bucketed_materials(rate_table: dict, material_rows: list) -> None:
    buckets = {}
    for row in material_rows:
        match = _match_material_key(row)
        if not match:
            continue
        group, key = match
        buckets.setdefault((group, key), []).append(float(row.get("cost", 0) or 0))
    for (group, key), values in buckets.items():
        avg_cost = _bucket_average(values)
        if avg_cost <= 0:
            continue
        rate_table.setdefault("materials", {}).setdefault(group, {})[key] = {
            "unit": "LF" if group == "pipe" else ("CY" if group == "concrete" else ("LF" if "rebar" in key else "ton")),
            "cost": avg_cost,
            "description": key.replace("_", " "),
        }


def _build_heavybid_rate_library() -> dict | None:
    labor_rows = _safe_load_json(HEAVYBID_NORMALIZED_DIR / "labor_rates.json") or []
    equipment_rows = _safe_load_json(HEAVYBID_NORMALIZED_DIR / "equipment_rates.json") or []
    material_rows = _safe_load_json(HEAVYBID_NORMALIZED_DIR / "material_library.json") or []

    if not labor_rows and not equipment_rows and not material_rows:
        return None

    rate_table = deepcopy(RATE_TABLES["national"])
    rate_table.update({
        "label": "HeavyBid Derived (Private)",
        "description": "Private rate library derived from normalized HeavyBid exports on this machine.",
        "wage_type": "private_heavybid",
        "source": "openmud HeavyBid extraction",
        "last_updated": "generated-local",
    })

    labor_buckets = {}
    for row in labor_rows:
        labor_type = _match_labor_type(row)
        if not labor_type:
            continue
        labor_buckets.setdefault(labor_type, []).append(float(row.get("rate", 0) or 0))

    for labor_type, values in labor_buckets.items():
        avg_rate = _bucket_average(values)
        if avg_rate <= 0:
            continue
        title = rate_table["labor"].get(labor_type, {}).get("title", labor_type.replace("_", " ").title())
        rate_table["labor"][labor_type] = {
            "hourly": avg_rate,
            "overtime": round(avg_rate * 1.5, 2),
            "title": title,
        }

    equipment_buckets = {}
    for row in equipment_rows:
        equipment_type = _match_equipment_type(row)
        if not equipment_type:
            continue
        rate = float(row.get("rent_rate", 0) or 0)
        units = str(row.get("units", "")).lower()
        if rate <= 0:
            continue
        equipment_buckets.setdefault(equipment_type, {"hourly": [], "daily": []})
        if units.startswith("hr"):
            equipment_buckets[equipment_type]["hourly"].append(rate)
            equipment_buckets[equipment_type]["daily"].append(rate * 8)
        else:
            equipment_buckets[equipment_type]["daily"].append(rate)

    for equipment_type, values in equipment_buckets.items():
        daily = _bucket_average(values["daily"])
        hourly = _bucket_average(values["hourly"]) or round(daily / 8, 2)
        if daily <= 0 and hourly <= 0:
            continue
        description = rate_table["equipment"].get(equipment_type, {}).get("description", equipment_type.replace("_", " ").title())
        rate_table["equipment"][equipment_type] = {
            "daily": round(daily or hourly * 8, 2),
            "hourly": round(hourly or daily / 8, 2),
            "description": description,
        }

    _apply_bucketed_materials(rate_table, material_rows)
    return rate_table


def _load_external_rate_tables(force: bool = False) -> None:
    global _EXTERNAL_LIBRARIES_LOADED
    if _EXTERNAL_LIBRARIES_LOADED and not force:
        return

    explicit_path = HEAVYBID_NORMALIZED_DIR / "rate_libraries.json"
    explicit = _safe_load_json(explicit_path)
    if isinstance(explicit, dict):
        for key, value in explicit.items():
            if isinstance(value, dict):
                RATE_TABLES[str(key)] = value

    heavybid_derived = _build_heavybid_rate_library()
    if heavybid_derived:
        RATE_TABLES["heavybid_derived"] = heavybid_derived

    _EXTERNAL_LIBRARIES_LOADED = True


def get_rate_libraries() -> list:
    """Return all rate library keys available to estimate tools."""
    _load_external_rate_tables()
    return [
        {
            "key": key,
            "label": value.get("label", key),
            "source": value.get("source", ""),
            "wage_type": value.get("wage_type", ""),
            "description": value.get("description", ""),
        }
        for key, value in RATE_TABLES.items()
    ]


def load_rate_library(region_key: str = "heavybid_derived") -> dict:
    """Load and return a named rate library."""
    _load_external_rate_tables(force=True)
    data = RATE_TABLES.get(region_key)
    if not data:
        return {"error": f"Rate library '{region_key}' not found."}
    return {"region": region_key, "rates": data, "available_libraries": get_rate_libraries()}


def _load_heavybid_snapshot() -> dict:
    return _safe_load_json(HEAVYBID_NORMALIZED_DIR / "snapshot.json") or {}


def _extract_size_tokens(text: str) -> set:
    tokens = set()
    for match in re.finditer(r"(\d+)\s*(?:in|inch|\")", str(text or "").lower()):
        tokens.add(match.group(1))
    return tokens


def _score_bid_item_match(item: dict, description: str = "", unit: str = "") -> int:
    haystack_parts = [
        str(item.get("description", "")),
        str(item.get("item_code", "")),
        str(item.get("cost_code_1", "")),
        str(item.get("cost_code_2", "")),
        str(item.get("crew_code", "")),
        str(item.get("project_name", "")),
    ]
    haystack = " ".join(haystack_parts).lower()
    raw_tokens = _tokenize(description)
    query_tokens = [token for token in raw_tokens if token not in HISTORY_STOPWORDS]
    significant_tokens = set(query_tokens or raw_tokens)
    phrase = " ".join(query_tokens).strip()
    score = 0

    if phrase and phrase in haystack:
        score += 8

    for token in significant_tokens:
        if token in haystack:
            score += 3

    unit_text = str(unit or "").strip().lower()
    item_unit = str(item.get("unit", "")).strip().lower()
    if unit_text:
        if unit_text == item_unit:
            score += 4
        else:
            score -= 3

    query_sizes = _extract_size_tokens(description)
    item_sizes = _extract_size_tokens(haystack)
    if query_sizes:
        if query_sizes & item_sizes:
            score += 5
        else:
            score -= 6

    quantity = float(item.get("quantity", 0) or 0)
    unit_price = float(item.get("unit_price", 0) or 0)
    manhours = float(item.get("manhours", 0) or 0)
    if unit_price > 0:
        score += 1
    if quantity > 0:
        score += 1
    if manhours > 0:
        score += 1

    return score


def _token_overlap_count(item: dict, description: str = "") -> int:
    haystack = " ".join(
        [
            str(item.get("description", "")),
            str(item.get("item_code", "")),
            str(item.get("cost_code_1", "")),
            str(item.get("cost_code_2", "")),
            str(item.get("crew_code", "")),
            str(item.get("project_name", "")),
        ]
    ).lower()
    raw_tokens = _tokenize(description)
    significant_tokens = [token for token in raw_tokens if token not in HISTORY_STOPWORDS]
    tokens = significant_tokens or raw_tokens
    return sum(1 for token in tokens if token in haystack)


def _search_bid_items(
    description: str = "",
    unit: str = "",
    min_score: int = 4,
    exact_unit_only: bool = False,
) -> list:
    snapshot = _load_heavybid_snapshot()
    items = snapshot.get("bid_items", [])
    if not items:
        return []
    raw_tokens = _tokenize(description)
    significant_tokens = [token for token in raw_tokens if token not in HISTORY_STOPWORDS]
    required_overlap = 1 if len(significant_tokens or raw_tokens) <= 1 else 2
    unit_text = str(unit or "").strip().lower()

    matches = []
    for item in items:
        item_unit = str(item.get("unit", "")).strip().lower()
        if exact_unit_only and unit_text and item_unit != unit_text:
            continue
        overlap = _token_overlap_count(item, description)
        if overlap < required_overlap:
            continue
        score = _score_bid_item_match(item, description, unit)
        if score >= min_score:
            enriched = dict(item)
            enriched["_score"] = score
            enriched["_overlap"] = overlap
            matches.append(enriched)
    matches.sort(
        key=lambda row: (
            row.get("_score", 0),
            row.get("_overlap", 0),
            float(row.get("unit_price", 0) or 0) > 0,
            float(row.get("amount", 0) or 0),
        ),
        reverse=True,
    )
    return matches


def get_historical_unit_prices(description: str, unit: str = "", limit: int = 5) -> dict:
    """Find historical unit prices from HeavyBid-derived bid items."""
    matches = [
        item for item in _search_bid_items(description, unit, min_score=5, exact_unit_only=bool(unit))
        if float(item.get("unit_price", 0) or 0) > 0
    ][: max(1, int(limit or 5))]
    if not matches:
        return {"description": description, "unit": unit, "matches": [], "average_unit_price": 0}
    prices = [float(item.get("unit_price", 0) or 0) for item in matches if float(item.get("unit_price", 0) or 0) > 0]
    return {
        "description": description,
        "unit": unit,
        "matches": matches,
        "average_unit_price": round(sum(prices) / len(prices), 4) if prices else 0,
        "estimate_count": len({item.get("estimate_code") for item in matches}),
    }


def lookup_heavybid_crew(crew_code: str = "", description: str = "", limit: int = 10) -> dict:
    """Search normalized HeavyBid crew exports."""
    crews = _safe_load_json(HEAVYBID_NORMALIZED_DIR / "crew_library.json") or []
    query = " ".join([crew_code, description]).strip().lower()
    query_tokens = set(_tokenize(query))
    matches = []
    for crew in crews:
        haystack = f"{crew.get('crew_code', '')} {crew.get('description', '')}".lower()
        score = 0
        if crew_code and crew_code.lower() == str(crew.get("crew_code", "")).lower():
            score += 5
        score += sum(1 for token in query_tokens if token in haystack)
        if score > 0:
            row = dict(crew)
            row["_score"] = score
            matches.append(row)
    matches.sort(key=lambda row: row.get("_score", 0), reverse=True)
    return {"crew_code": crew_code, "description": description, "matches": matches[: max(1, int(limit or 10))]}


def get_production_benchmark(description: str, unit: str = "", limit: int = 5) -> dict:
    """Return productivity benchmarks using quantity and manhours from historical bid items."""
    measurable_units = {"lf", "cy", "tn", "ton", "sy", "sf", "ea", "m3", "mton"}
    unit_text = str(unit or "").strip().lower()
    matches = _search_bid_items(description, unit, min_score=6, exact_unit_only=bool(unit_text))
    benchmarks = []
    for item in matches:
        item_unit = str(item.get("unit", "")).strip().lower()
        if item_unit not in measurable_units:
            continue
        quantity = float(item.get("quantity", 0) or 0)
        manhours = float(item.get("manhours", 0) or 0)
        if quantity <= 0 or manhours <= 0:
            continue
        benchmark = dict(item)
        benchmark["units_per_manhour"] = round(quantity / manhours, 4)
        benchmark["manhours_per_unit"] = round(manhours / quantity, 6)
        benchmarks.append(benchmark)
    benchmarks.sort(key=lambda row: row.get("quantity", 0), reverse=True)
    summary = {
        "description": description,
        "unit": unit,
        "benchmarks": benchmarks[: max(1, int(limit or 5))],
    }
    if summary["benchmarks"]:
        summary["average_units_per_manhour"] = round(
            sum(row["units_per_manhour"] for row in summary["benchmarks"]) / len(summary["benchmarks"]),
            4,
        )
    else:
        summary["average_units_per_manhour"] = 0
    return summary


def estimate_from_bid_history(description: str, quantity: float, unit: str = "", markup: float = 0.0, limit: int = 5) -> dict:
    """Estimate a line item from HeavyBid historical unit-price matches."""
    historical = get_historical_unit_prices(description=description, unit=unit, limit=limit)
    avg = float(historical.get("average_unit_price", 0) or 0)
    direct_cost = quantity * avg
    total = direct_cost * (1 + float(markup or 0))
    return {
        "description": description,
        "quantity": quantity,
        "unit": unit,
        "average_unit_price": round(avg, 4),
        "direct_cost": round(direct_cost, 2),
        "markup": float(markup or 0),
        "total": round(total, 2),
        "matches": historical.get("matches", []),
        "estimate_count": historical.get("estimate_count", 0),
    }


def get_heavybid_snapshot_summary() -> dict:
    """Return counts and metadata for the local HeavyBid snapshot."""
    snapshot = _load_heavybid_snapshot()
    if not snapshot:
        return {"available": False, "counts": {}}
    return {
        "available": True,
        "generated_at": snapshot.get("generated_at", ""),
        "source_dir": snapshot.get("source_dir", ""),
        "counts": snapshot.get("counts", {}),
    }


def get_heavybid_calculator_defaults() -> dict:
    """Return shared calculator constants derived from local HeavyBid artifacts when available."""
    _load_external_rate_tables()
    rates = RATE_TABLES.get("heavybid_derived", RATE_TABLES["national"])
    materials = rates.get("materials", {})
    pipe = materials.get("pipe", {})
    concrete = materials.get("concrete", {})
    reinforcement = materials.get("reinforcement", {})

    labor_options = []
    for key, value in rates.get("labor", {}).items():
        labor_options.append({
            "value": key,
            "label": f"{value.get('title', key.replace('_', ' ').title())} (${value.get('hourly', 0):.2f}/hr)",
        })

    equipment_options = []
    for key, value in rates.get("equipment", {}).items():
        equipment_options.append({
            "value": key,
            "label": f"{value.get('description', key.replace('_', ' ').title())} (${value.get('daily', 0):.2f}/day)",
        })

    material_size_options = {
        "pipe": [
            {"value": "12", "label": f'12" pipe (${pipe.get("pvc_c900_12", {}).get("cost", 38):.2f}/LF)'},
            {"value": "10", "label": f'10" pipe (${pipe.get("pvc_c900_10", {}).get("cost", 27):.2f}/LF)'},
            {"value": "8", "label": f'8" pipe (${pipe.get("pvc_c900_8", {}).get("cost", 19):.2f}/LF)'},
            {"value": "6", "label": f'6" pipe (${pipe.get("pvc_c900_6", {}).get("cost", 13):.2f}/LF)'},
            {"value": "4", "label": f'4" pipe (${pipe.get("pvc_c900_4", {}).get("cost", 8.5):.2f}/LF)'},
        ],
        "concrete": [
            {"value": "5000_psi", "label": f'5,000 PSI (${concrete.get("5000_psi", {}).get("cost", 195):.2f}/CY)'},
            {"value": "4000_psi", "label": f'4,000 PSI (${concrete.get("4000_psi", {}).get("cost", 180):.2f}/CY)'},
            {"value": "3000_psi", "label": f'3,000 PSI (${concrete.get("3000_psi", {}).get("cost", 165):.2f}/CY)'},
        ],
        "rebar": [
            {"value": "5_rebar", "label": f'#5 rebar (${reinforcement.get("rebar_5", {}).get("cost", 1.75):.2f}/LF)'},
            {"value": "4_rebar", "label": f'#4 rebar (${reinforcement.get("rebar_4", {}).get("cost", 1.25):.2f}/LF)'},
        ],
    }

    snapshot = _load_heavybid_snapshot()
    formula_templates = []
    for formula in (snapshot.get("formulas", []) or [])[:20]:
        if formula.get("formula_cells"):
            formula_templates.append({
                "template_name": formula.get("template_name", ""),
                "formula_cells": formula.get("formula_cells", [])[:6],
            })

    return {
        "material_size_options": material_size_options,
        "labor_options": sorted(labor_options, key=lambda item: item["label"]),
        "equipment_options": sorted(equipment_options, key=lambda item: item["label"]),
        "concrete_price_map": {
            "3000": round(concrete.get("3000_psi", {}).get("cost", 165), 2),
            "4000": round(concrete.get("4000_psi", {}).get("cost", 180), 2),
            "5000": round(concrete.get("5000_psi", {}).get("cost", 195), 2),
        },
        "region_options": get_regions(),
        "rate_libraries": get_rate_libraries(),
        "formula_templates": formula_templates,
    }


def calculate_material_cost(
    material_type: str, quantity: float,
    size: str = None, region: str = "national",
) -> dict:
    """Calculate material cost for a given type, quantity, size, and region."""
    rates = get_rates(region)

    # Legacy flat-key lookup for backward compatibility
    if material_type.lower() == "pipe":
        size_key = f"{size}_inch" if size else "8_inch"
        if size_key in MATERIAL_PRICING["pipe"]:
            unit_cost = MATERIAL_PRICING["pipe"][size_key]["cost"]
            # Apply regional multiplier vs national
            nat_cost = RATE_TABLES["national"]["materials"]["pipe"].get(
                f"pvc_c900_{size}", {}
            ).get("cost", unit_cost)
            reg_cost = rates["materials"]["pipe"].get(
                f"pvc_c900_{size}", {}
            ).get("cost", unit_cost)
            if nat_cost:
                unit_cost = unit_cost * (reg_cost / nat_cost)
            total = quantity * unit_cost
            return {
                "material": f"{size}-inch pipe",
                "quantity": quantity,
                "unit": "linear feet",
                "unit_cost": round(unit_cost, 2),
                "waste_factor": "10%",
                "total_cost": round(total, 2),
                "total_with_waste": round(total * 1.1, 2),
                "region": region,
            }

    elif material_type.lower() == "concrete":
        psi_key = size or "4000_psi"
        mat = rates["materials"].get("concrete", {}).get(psi_key)
        if not mat:
            mat = RATE_TABLES["national"]["materials"]["concrete"].get(psi_key, {})
        unit_cost = mat.get("cost", 180.00)
        total = quantity * unit_cost
        return {
            "material": f"Concrete {psi_key.replace('_', ' ')}",
            "quantity": quantity,
            "unit": "cubic yards",
            "unit_cost": unit_cost,
            "waste_factor": "5%",
            "total_cost": round(total, 2),
            "total_with_waste": round(total * 1.05, 2),
            "region": region,
        }

    return {"error": f"Material type '{material_type}' not found in pricing database"}


def calculate_labor_cost(
    labor_type: str, hours: float, region: str = "national",
) -> dict:
    """Calculate labor cost by type, hours, and region."""
    rates = get_rates(region)
    labor = rates["labor"].get(labor_type.lower())
    if not labor:
        labor = RATE_TABLES["national"]["labor"].get(labor_type.lower())
    if not labor:
        available = list(RATE_TABLES['national']['labor'].keys())
        return {"error": f"Labor type '{labor_type}' not found. Available: {available}"}
    hourly = labor["hourly"]
    total = hours * hourly
    return {
        "labor_type": labor_type,
        "title": labor.get("title", labor_type),
        "hours": hours,
        "hourly_rate": hourly,
        "total_cost": round(total, 2),
        "region": region,
    }


def calculate_equipment_cost(
    equipment_type: str, days: float, region: str = "national",
) -> dict:
    """Calculate equipment rental cost by type, days, and region."""
    rates = get_rates(region)
    equip = rates["equipment"].get(equipment_type.lower())
    if not equip:
        equip = RATE_TABLES["national"]["equipment"].get(equipment_type.lower())
    if not equip:
        available = list(RATE_TABLES['national']['equipment'].keys())
        return {"error": f"Equipment '{equipment_type}' not found. Available: {available}"}
    daily = equip["daily"]
    total = days * daily
    return {
        "equipment": equip.get("description", equipment_type),
        "days": days,
        "daily_rate": daily,
        "total_cost": round(total, 2),
        "region": region,
    }


def estimate_project_cost(
    materials: list,
    labor: list,
    equipment: list = None,
    markup: float = 0.15,
    region: str = "national",
) -> dict:
    """
    Full project cost estimate with materials, labor, equipment, and markup.

    Args:
        materials: List of {type, quantity, size} dicts
        labor: List of {type, hours} dicts
        equipment: List of {type, days} dicts
        markup: Overhead & profit as decimal (e.g. 0.15 = 15%)
        region: Region key from RATE_TABLES (default 'national')

    Returns:
        Complete estimate breakdown dict
    """
    material_total = 0.0
    labor_total = 0.0
    equipment_total = 0.0

    material_breakdown = []
    for mat in materials:
        result = calculate_material_cost(
            mat.get("type"), mat.get("quantity"), mat.get("size"), region
        )
        if "total_with_waste" in result:
            material_total += result["total_with_waste"]
            material_breakdown.append(result)

    labor_breakdown = []
    for lab in labor:
        result = calculate_labor_cost(lab.get("type"), lab.get("hours"), region)
        if "total_cost" in result:
            labor_total += result["total_cost"]
            labor_breakdown.append(result)

    equipment_breakdown = []
    for eq in (equipment or []):
        result = calculate_equipment_cost(eq.get("type"), eq.get("days"), region)
        if "total_cost" in result:
            equipment_total += result["total_cost"]
            equipment_breakdown.append(result)

    subtotal = material_total + labor_total + equipment_total
    overhead_profit = subtotal * markup
    total = subtotal + overhead_profit
    region_info = get_rates(region)

    return {
        "region": region,
        "region_label": region_info.get("label", region),
        "wage_type": region_info.get("wage_type", "unknown"),
        "materials": {"breakdown": material_breakdown, "subtotal": round(material_total, 2)},
        "labor": {"breakdown": labor_breakdown, "subtotal": round(labor_total, 2)},
        "equipment": {"breakdown": equipment_breakdown, "subtotal": round(equipment_total, 2)},
        "subtotal": round(subtotal, 2),
        "markup_percentage": round(markup * 100, 1),
        "overhead_profit": round(overhead_profit, 2),
        "total": round(total, 2),
    }
