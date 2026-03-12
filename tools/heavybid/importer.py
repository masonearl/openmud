from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from .binary_decoder import decode_binary_tables
from .discover import build_discovery_manifest
from .extract import extract_structured_assets
from .paths import NORMALIZED_ROOT, ensure_output_dirs, resolve_source_dir, write_json
from .schema_registry import build_schema_registry


def _merge_bid_items(
    structured_items: List[Dict[str, Any]],
    binary_hints: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged = list(structured_items)
    known = {
        (
            str(item.get("estimate_code") or ""),
            str(item.get("item_code") or ""),
            str(item.get("description") or ""),
        )
        for item in structured_items
    }
    for hint in binary_hints:
        signature = (
            str(hint.get("estimate_code") or ""),
            str(hint.get("item_code") or ""),
            str(hint.get("description_hint") or ""),
        )
        if signature in known:
            continue
        merged.append(
            {
                "estimate_code": hint.get("estimate_code", ""),
                "item_code": hint.get("item_code", ""),
                "description": hint.get("description_hint", ""),
                "quantity": 0.0,
                "unit": "",
                "unit_price": 0.0,
                "amount": 0.0,
                "source_kind": hint.get("source_kind", "binary_biditem"),
                "source_file": hint.get("source_file", ""),
                "confidence": hint.get("confidence", "low"),
            }
        )
    return merged


def _build_private_kb(structured: Dict[str, Any], formulas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    entries = []
    by_estimate: Dict[str, List[Dict[str, Any]]] = {}
    for item in structured.get("bid_items", []):
        estimate_code = str(item.get("estimate_code") or "")
        by_estimate.setdefault(estimate_code, []).append(item)

    for estimate_code, items in list(by_estimate.items())[:80]:
        high_value = sorted(items, key=lambda row: row.get("amount", 0.0), reverse=True)[:6]
        summary = "; ".join(
            f"{item.get('description', 'Item')} at ${item.get('unit_price', 0):,.2f}/{item.get('unit', '')}".strip()
            for item in high_value
            if item.get("description")
        )
        if not summary:
            continue
        entries.append(
            {
                "id": f"heavybid-estimate-{estimate_code}",
                "title": f"HeavyBid estimate {estimate_code}",
                "content": summary,
                "estimate_code": estimate_code,
                "topic": "estimating",
            }
        )

    for formula in formulas[:40]:
        formula_cells = formula.get("formula_cells", [])
        if not formula_cells:
            continue
        expressions = "; ".join(cell.get("formula", "") for cell in formula_cells[:4] if cell.get("formula"))
        entries.append(
            {
                "id": f"heavybid-formula-{formula.get('template_name', '').lower().replace(' ', '-')}",
                "title": formula.get("template_name", "HeavyBid formula"),
                "content": expressions,
                "topic": "calculator",
            }
        )
    return entries


def build_heavybid_snapshot(
    source_dir: str | None = None,
    *,
    write_outputs: bool = True,
) -> Dict[str, Any]:
    source = resolve_source_dir(source_dir)
    ensure_output_dirs()

    discovery = build_discovery_manifest(str(source), write_outputs=write_outputs)
    schema = build_schema_registry(str(source), write_outputs=write_outputs)
    structured = extract_structured_assets(str(source), write_outputs=write_outputs)
    binary = decode_binary_tables(str(source), write_outputs=write_outputs)

    merged_bid_items = _merge_bid_items(structured.get("bid_items", []), binary.get("merged_bid_hints", []))
    private_kb = _build_private_kb(structured, structured.get("formulas", []))

    snapshot = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_dir": str(source),
        "discovery": discovery,
        "schema": {
            "table_count": schema.get("table_count", 0),
            "tables": [table["name"] for table in schema.get("tables", [])],
        },
        "counts": {
            "bids": len(structured.get("bids", [])),
            "bid_items": len(merged_bid_items),
            "crew_library": len(structured.get("crew_library", [])),
            "labor_rates": len(structured.get("labor_rates", [])),
            "equipment_rates": len(structured.get("equipment_rates", [])),
            "material_library": len(structured.get("material_library", [])),
            "vendors": len(structured.get("vendors", [])),
            "formulas": len(structured.get("formulas", [])),
            "binary_estimates": len(binary.get("decoded_estimates", [])),
        },
        "bids": structured.get("bids", []),
        "bid_items": merged_bid_items,
        "crew_library": structured.get("crew_library", []),
        "labor_rates": structured.get("labor_rates", []),
        "equipment_rates": structured.get("equipment_rates", []),
        "material_library": structured.get("material_library", []),
        "vendors": structured.get("vendors", []),
        "codebooks": structured.get("codebooks", []),
        "formulas": structured.get("formulas", []),
        "binary": binary,
        "private_kb": private_kb,
    }

    if write_outputs:
        write_json(NORMALIZED_ROOT / "bid_items.json", merged_bid_items)
        write_json(NORMALIZED_ROOT / "private_kb.json", private_kb)
        write_json(NORMALIZED_ROOT / "snapshot.json", snapshot)
    return snapshot
