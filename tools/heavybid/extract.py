from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from .paths import NORMALIZED_ROOT, resolve_source_dir, write_json

XML_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    text = str(value).strip().replace(",", "").replace("$", "")
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    return int(round(_safe_float(value, default)))


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _estimate_code_from_path(path: Path) -> str:
    return path.parent.name


def _parse_job_xml(path: Path) -> Dict[str, Any]:
    root = ET.fromstring(path.read_text(encoding="utf-8", errors="ignore"))
    job = root.find(".//JOB")
    if job is None:
        return {}

    items = []
    for item in job.findall("./ITEMS/ITEM"):
        row = {child.tag.lower(): _safe_text(child.text) for child in item}
        if not row:
            continue
        items.append(row)

    return {
        "estimate_code": _estimate_code_from_path(path),
        "company": _safe_text(job.findtext("COMPANY")),
        "date_ran": _safe_text(job.findtext("DATE_RAN")),
        "report": _safe_text(job.findtext("REPORT")),
        "user": _safe_text(job.findtext("USER")),
        "code": _safe_text(job.findtext("CODE")),
        "description": _safe_text(job.findtext("DESC")),
        "job_total": _safe_float(job.findtext("JOBTOTAL")),
        "direct_cost": _safe_float(job.findtext("DIRECTCOST")),
        "total_cost": _safe_float(job.findtext("TOTALCOST")),
        "balanced_total": _safe_float(job.findtext("BALANCEDTOTAL")),
        "items": items,
        "source_file": str(path),
    }


def _dict_from_item_nodes(nodes: Iterable[ET.Element]) -> Dict[str, str]:
    data: Dict[str, str] = {}
    for item in nodes:
        key = _safe_text(item.findtext("./Key/string"))
        value = _safe_text(item.findtext("./Value/string"))
        if key:
            data[key] = value
    return data


def parse_etaa_account_xml(path: Path) -> Dict[str, Any]:
    root = ET.fromstring(path.read_text(encoding="utf-8", errors="ignore"))
    project_data = _dict_from_item_nodes(root.findall("./ProjectData/Dictionary/Item"))
    cost_codes = []
    for cost_code in root.findall("./CostCodeList/CostCodeData"):
        row = _dict_from_item_nodes(cost_code.findall("./Dictionary/Item"))
        if row:
            cost_codes.append(row)
    return {
        "estimate_code": _estimate_code_from_path(path),
        "project_data": project_data,
        "cost_codes": cost_codes,
        "source_file": str(path),
    }


def _shared_strings(archive: ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for si in root:
        values.append("".join(node.text or "" for node in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
    return values


def _workbook_sheets(archive: ZipFile) -> List[Dict[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    sheets = []
    for node in workbook.find("a:sheets", XML_NS) or []:
        rid = node.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = relmap.get(rid, "")
        if target:
            sheets.append({"name": node.attrib.get("name", "Sheet"), "target": f"xl/{target}"})
    return sheets


def _sheet_rows(archive: ZipFile, sheet_target: str, shared_strings: List[str]) -> List[List[str]]:
    root = ET.fromstring(archive.read(sheet_target))
    rows = []
    for row in root.findall(".//a:sheetData/a:row", XML_NS):
        values = []
        for cell in row.findall("a:c", XML_NS):
            value_node = cell.find("a:v", XML_NS)
            formula_node = cell.find("a:f", XML_NS)
            value = value_node.text if value_node is not None else ""
            if cell.attrib.get("t") == "s" and str(value).isdigit():
                value = shared_strings[int(value)]
            if formula_node is not None and formula_node.text:
                value = value or formula_node.text
            values.append(_safe_text(value))
        if any(values):
            rows.append(values)
    return rows


def parse_workbook(path: Path, *, max_rows_per_sheet: int = 200) -> Dict[str, Any]:
    with ZipFile(path) as archive:
        shared_strings = _shared_strings(archive)
        sheets = []
        for sheet in _workbook_sheets(archive):
            rows = _sheet_rows(archive, sheet["target"], shared_strings)
            header = rows[0] if rows else []
            records = []
            for row in rows[1:max_rows_per_sheet]:
                record = {}
                for idx, cell in enumerate(row):
                    key = header[idx] if idx < len(header) and header[idx] else f"column_{idx + 1}"
                    record[key] = cell
                if any(record.values()):
                    records.append(record)
            sheets.append({"name": sheet["name"], "headers": header, "records": records})
    return {
        "estimate_code": _estimate_code_from_path(path),
        "workbook_name": path.name,
        "source_file": str(path),
        "sheets": sheets,
    }


def parse_formula_template(path: Path) -> Dict[str, Any]:
    magic = path.read_bytes()[:8]
    if magic.startswith(b"PK"):
        workbook = parse_workbook(path, max_rows_per_sheet=120)
        formulas = []
        with ZipFile(path) as archive:
            shared_strings = _shared_strings(archive)
            for sheet in _workbook_sheets(archive):
                root = ET.fromstring(archive.read(sheet["target"]))
                for row in root.findall(".//a:sheetData/a:row", XML_NS):
                    for cell in row.findall("a:c", XML_NS):
                        formula_node = cell.find("a:f", XML_NS)
                        value_node = cell.find("a:v", XML_NS)
                        if formula_node is None or not formula_node.text:
                            continue
                        value = value_node.text if value_node is not None else ""
                        if cell.attrib.get("t") == "s" and str(value).isdigit():
                            value = shared_strings[int(value)]
                        formulas.append(
                            {
                                "sheet": sheet["name"],
                                "cell": cell.attrib.get("r", ""),
                                "formula": formula_node.text,
                                "value": _safe_text(value),
                            }
                        )
        return {
            "template_name": path.stem,
            "format": "xlsx",
            "extractable": True,
            "formula_cells": formulas,
            "sheets": workbook["sheets"],
            "source_file": str(path),
        }

    is_ole = magic.startswith(bytes.fromhex("d0cf11e0a1b11ae1"))
    return {
        "template_name": path.stem,
        "format": "compound_document" if is_ole else "binary",
        "extractable": False,
        "formula_cells": [],
        "source_file": str(path),
    }


def _normalize_bid_items(job: Dict[str, Any], source_kind: str) -> List[Dict[str, Any]]:
    items = []
    for item in job.get("items", []):
        quantity = _safe_float(item.get("quan"))
        total = _safe_float(item.get("total"))
        unit_price = _safe_float(item.get("price") or item.get("unitprice"))
        if not unit_price and quantity:
            unit_price = total / quantity if quantity else 0.0
        items.append(
            {
                "estimate_code": job.get("estimate_code") or job.get("code"),
                "project_name": job.get("description", ""),
                "item_code": _safe_text(item.get("code")),
                "description": _safe_text(item.get("desc")),
                "quantity": quantity,
                "unit": _safe_text(item.get("unit")),
                "unit_price": round(unit_price, 4),
                "amount": round(total, 2),
                "direct_cost": round(_safe_float(item.get("directcost")), 2),
                "indirect_cost": round(_safe_float(item.get("indirectcost")), 2),
                "markup": round(_safe_float(item.get("markup")), 2),
                "manhours": round(_safe_float(item.get("manhours")), 2),
                "source_kind": source_kind,
                "source_file": job.get("source_file", ""),
            }
        )
    return items


def _normalize_etaa_cost_codes(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    project_data = payload.get("project_data", {})
    estimate_code = payload.get("estimate_code") or project_data.get("EstimateInfoCode")
    project_name = project_data.get("EstimateInfoName", "")
    items = []
    for row in payload.get("cost_codes", []):
        quantity = _safe_float(row.get("Quantity"))
        total_price = _safe_float(row.get("TotalPrice"))
        unit_price = _safe_float(row.get("UnitPrice"))
        if not unit_price and quantity:
            unit_price = total_price / quantity if quantity else 0.0
        items.append(
            {
                "estimate_code": estimate_code,
                "project_name": project_name,
                "item_code": _safe_text(row.get("Biditem")),
                "revenue_code": _safe_text(row.get("RevenueCode")),
                "cost_code_1": _safe_text(row.get("CostCode1")),
                "cost_code_2": _safe_text(row.get("CostCode2")),
                "description": _safe_text(row.get("Description")),
                "quantity": quantity,
                "unit": _safe_text(row.get("Unit")),
                "unit_price": round(unit_price, 4),
                "amount": round(total_price, 2),
                "manhours": round(_safe_float(row.get("Manhours")), 2),
                "crew_code": _safe_text(row.get("CrewCode")),
                "crew_hours": round(_safe_float(row.get("CrewHours")), 2),
                "notes": _safe_text(row.get("Notes")),
                "source_kind": "etaa_account",
                "source_file": payload.get("source_file", ""),
            }
        )
    return items


def _dedupe_records(records: Iterable[Dict[str, Any]], keys: List[str]) -> List[Dict[str, Any]]:
    seen = set()
    unique = []
    for record in records:
        signature = tuple(_safe_text(record.get(key)) for key in keys)
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(record)
    return unique


def _summarize_bid(payload: Dict[str, Any]) -> Dict[str, Any]:
    project_data = payload.get("project_data", {})
    return {
        "estimate_code": payload.get("estimate_code") or project_data.get("EstimateInfoCode"),
        "project_name": project_data.get("EstimateInfoName", ""),
        "company": project_data.get("CompanyName", ""),
        "bid_total": round(_safe_float(project_data.get("PricingTotalBidPrice")), 2),
        "balanced_total": round(_safe_float(project_data.get("PricingTotalBalancedPrice")), 2),
        "cost_total": round(_safe_float(project_data.get("SummaryTotalCost")), 2),
        "direct_cost_total": round(_safe_float(project_data.get("SummaryTotalDirectCost")), 2),
        "source_kind": "etaa_account",
        "source_file": payload.get("source_file", ""),
    }


def extract_structured_assets(
    source_dir: str | None = None,
    *,
    write_outputs: bool = False,
) -> Dict[str, Any]:
    source = resolve_source_dir(source_dir)
    est_root = source / "EST"
    calc_root = source / "HCSS" / "CalcTemplates"

    bids: List[Dict[str, Any]] = []
    bid_items: List[Dict[str, Any]] = []
    crew_library: List[Dict[str, Any]] = []
    labor_rates: List[Dict[str, Any]] = []
    equipment_rates: List[Dict[str, Any]] = []
    material_library: List[Dict[str, Any]] = []
    vendors: List[Dict[str, Any]] = []
    codebooks: List[Dict[str, Any]] = []
    formulas: List[Dict[str, Any]] = []

    for estimate_dir in sorted([path for path in est_root.iterdir() if path.is_dir()], key=lambda p: p.name.lower()):
        for xml_file in sorted(estimate_dir.glob("*.xml")) + sorted(estimate_dir.glob("*.XML")):
            upper_name = xml_file.name.upper()
            if upper_name.startswith("BIDFORM"):
                parsed = _parse_job_xml(xml_file)
                bids.append(
                    {
                        "estimate_code": parsed.get("estimate_code") or parsed.get("code"),
                        "project_name": parsed.get("description", ""),
                        "company": parsed.get("company", ""),
                        "bid_total": round(parsed.get("job_total", 0.0), 2),
                        "cost_total": round(parsed.get("total_cost", 0.0), 2),
                        "direct_cost_total": round(parsed.get("direct_cost", 0.0), 2),
                        "balanced_total": round(parsed.get("balanced_total", 0.0), 2),
                        "source_kind": "bidform",
                        "source_file": parsed.get("source_file", ""),
                    }
                )
                bid_items.extend(_normalize_bid_items(parsed, "bidform"))
            elif upper_name.startswith("ETA_BUDGETREVIEW"):
                parsed = _parse_job_xml(xml_file)
                bids.append(
                    {
                        "estimate_code": parsed.get("estimate_code") or parsed.get("code"),
                        "project_name": parsed.get("description", ""),
                        "company": parsed.get("company", ""),
                        "bid_total": round(parsed.get("job_total", 0.0), 2),
                        "source_kind": "budget_review",
                        "source_file": parsed.get("source_file", ""),
                    }
                )
                bid_items.extend(_normalize_bid_items(parsed, "budget_review"))
            elif upper_name == "ETAACCTDATA.XML":
                parsed = parse_etaa_account_xml(xml_file)
                bids.append(_summarize_bid(parsed))
                bid_items.extend(_normalize_etaa_cost_codes(parsed))

        for workbook_path in sorted(estimate_dir.glob("*.xlsx")):
            workbook = parse_workbook(workbook_path)
            sheet = workbook["sheets"][0] if workbook["sheets"] else {"records": []}
            rows = sheet.get("records", [])
            estimate_code = workbook["estimate_code"]
            workbook_name = workbook["workbook_name"].lower()

            if workbook_name == "crew.xlsx":
                for row in rows:
                    crew_library.append(
                        {
                            "estimate_code": estimate_code,
                            "crew_code": _safe_text(row.get("Crew Code")),
                            "description": _safe_text(row.get("Description")),
                            "calendar": _safe_text(row.get("Calendar")),
                            "notes": _safe_text(row.get("Notes")),
                            "header": _safe_text(row.get("Header (Y/N)")),
                            "dispatcher_type": _safe_text(row.get("HCSS Dispatcher Type")),
                            "source_file": workbook["source_file"],
                        }
                    )
            elif workbook_name == "labor.xlsx":
                for row in rows:
                    labor_rates.append(
                        {
                            "estimate_code": estimate_code,
                            "labor_code": _safe_text(row.get("Labor Code")),
                            "description": _safe_text(row.get("Description")),
                            "rate": round(_safe_float(row.get("Rate")), 4),
                            "tax_percent": round(_safe_float(row.get("Tax Percent")), 4),
                            "fringe": round(_safe_float(row.get("Fringe $")), 4),
                            "unit": _safe_text(row.get("Unit")),
                            "overtime_rule": _safe_text(row.get("Overtime Rule")),
                            "dispatcher_type": _safe_text(row.get("Dispatcher Type")),
                            "dispatcher_subtype": _safe_text(row.get("Dispatcher Subtype")),
                            "schedule_code": _safe_text(row.get("Schedule Code")),
                            "source_file": workbook["source_file"],
                        }
                    )
            elif workbook_name == "equipment.xlsx":
                for row in rows:
                    equipment_rates.append(
                        {
                            "estimate_code": estimate_code,
                            "equipment_code": _safe_text(row.get("Equipment Code")),
                            "description": _safe_text(row.get("Description")),
                            "units": _safe_text(row.get("Units")),
                            "rent_type": _safe_text(row.get("Type Rent")),
                            "rent_rate": round(_safe_float(row.get("Rent Rate")), 4),
                            "eoe_total_per_hour": round(_safe_float(row.get("EOE Total $/HR")), 4),
                            "operator_code": _safe_text(row.get("Operator")),
                            "header": _safe_text(row.get("Header (Y/N)")),
                            "source_file": workbook["source_file"],
                        }
                    )
            elif workbook_name == "local material.xlsx":
                for row in rows:
                    material_library.append(
                        {
                            "estimate_code": estimate_code,
                            "resource_code": _safe_text(row.get("Local Resource Code")),
                            "description": _safe_text(row.get("Description")),
                            "unit": _safe_text(row.get("Unit")),
                            "cost": round(_safe_float(row.get("Cost")), 4),
                            "job_cost_code_1": _safe_text(row.get("Job Cost Code 1")),
                            "job_cost_description": _safe_text(row.get("Job Cost Description")),
                            "quote_folder": _safe_text(row.get("Quote Folder")),
                            "source_file": workbook["source_file"],
                        }
                    )
            elif workbook_name == "local vendors.xlsx":
                for row in rows:
                    vendors.append(
                        {
                            "estimate_code": estimate_code,
                            "quote_folder": _safe_text(row.get("Quote Folder")),
                            "vendor_code": _safe_text(row.get("Vendor Code")),
                            "vendor_name": _safe_text(row.get("Vendor Name")),
                            "city": _safe_text(row.get("City")),
                            "state": _safe_text(row.get("State")),
                            "phone": _safe_text(row.get("Phone")),
                            "email": _safe_text(row.get("Email")),
                            "source_file": workbook["source_file"],
                        }
                    )
            elif workbook_name in {"activity codebook.xlsx", "material codebook.xlsx", "crew resources.xlsx"}:
                for row in rows:
                    row_copy = dict(row)
                    row_copy["estimate_code"] = estimate_code
                    row_copy["workbook_name"] = workbook["workbook_name"]
                    row_copy["source_file"] = workbook["source_file"]
                    codebooks.append(row_copy)

    if calc_root.exists():
        for calc_dir in sorted([path for path in calc_root.iterdir() if path.is_dir()], key=lambda p: p.name.lower()):
            for template in sorted(calc_dir.iterdir(), key=lambda p: p.name.lower()):
                if not template.is_file():
                    continue
                parsed = parse_formula_template(template)
                parsed["template_group"] = calc_dir.name
                formulas.append(parsed)

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_dir": str(source),
        "bids": _dedupe_records(bids, ["estimate_code", "project_name", "source_kind"]),
        "bid_items": bid_items,
        "crew_library": _dedupe_records(crew_library, ["estimate_code", "crew_code"]),
        "labor_rates": _dedupe_records(labor_rates, ["estimate_code", "labor_code"]),
        "equipment_rates": _dedupe_records(equipment_rates, ["estimate_code", "equipment_code"]),
        "material_library": _dedupe_records(material_library, ["estimate_code", "resource_code"]),
        "vendors": _dedupe_records(vendors, ["estimate_code", "vendor_code", "vendor_name"]),
        "codebooks": codebooks,
        "formulas": formulas,
    }

    if write_outputs:
        write_json(NORMALIZED_ROOT / "bids.json", payload["bids"])
        write_json(NORMALIZED_ROOT / "bid_items.json", payload["bid_items"])
        write_json(NORMALIZED_ROOT / "crew_library.json", payload["crew_library"])
        write_json(NORMALIZED_ROOT / "labor_rates.json", payload["labor_rates"])
        write_json(NORMALIZED_ROOT / "equipment_rates.json", payload["equipment_rates"])
        write_json(NORMALIZED_ROOT / "material_library.json", payload["material_library"])
        write_json(NORMALIZED_ROOT / "vendors.json", payload["vendors"])
        write_json(NORMALIZED_ROOT / "codebooks.json", payload["codebooks"])
        write_json(NORMALIZED_ROOT / "formulas.json", payload["formulas"])
        write_json(NORMALIZED_ROOT / "heavybid-summary.json", payload)
    return payload
