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
