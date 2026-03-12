from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from .paths import BINARY_ROOT, resolve_source_dir, write_json
from .schema_registry import build_schema_registry


TARGET_TABLES = [
    "BIDITEM",
    "ESTDETL",
    "CREW",
    "LABOR",
    "WORKCOMP",
    "BURDTBLE",
    "BIDJOB",
    "CALCDATA",
    "CASHFLOW",
]


def _extract_ascii_tokens(data: bytes, *, min_len: int = 4, limit: int = 120) -> List[str]:
    text = "".join(chr(byte) if 32 <= byte < 127 else " " for byte in data)
    tokens = re.findall(r"[A-Za-z0-9_#/\".\-]{%d,}" % min_len, text)
    seen = set()
    unique = []
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        unique.append(token)
        if len(unique) >= limit:
            break
    return unique


def _extract_biditem_candidates(tokens: List[str]) -> List[Dict[str, str]]:
    candidates = []
    pattern = re.compile(r"^(?P<code>\d{2,6})(?P<desc>[A-Z].+)$")
    for token in tokens:
        match = pattern.match(token)
        if not match:
            continue
        desc = match.group("desc").replace("JOB", " JOB ").replace("MAIN", " MAIN ").strip()
        candidates.append({"item_code": match.group("code"), "description_hint": desc})
    return candidates[:60]


def _read_table_snapshot(dat_path: Path, hdr_path: Path | None) -> Dict[str, Any]:
    dat_bytes = dat_path.read_bytes()
    hdr_bytes = hdr_path.read_bytes() if hdr_path and hdr_path.exists() else b""
    header_ints = [
        int.from_bytes(dat_bytes[idx: idx + 4], "little", signed=False)
        for idx in range(0, min(64, len(dat_bytes)), 4)
    ]
    return {
        "dat_file": str(dat_path),
        "hdr_file": str(hdr_path) if hdr_path and hdr_path.exists() else "",
        "dat_size": len(dat_bytes),
        "hdr_size": len(hdr_bytes),
        "header_ints": header_ints,
        "estimated_record_count": header_ints[0] if header_ints else 0,
        "ascii_tokens": _extract_ascii_tokens(dat_bytes),
    }


def decode_binary_tables(
    source_dir: str | None = None,
    *,
    write_outputs: bool = False,
) -> Dict[str, Any]:
    source = resolve_source_dir(source_dir)
    est_root = source / "EST"
    registry = build_schema_registry(source_dir)
    registry_lookup = {table["name"]: table for table in registry["tables"]}
    estimate_dirs = sorted([path for path in est_root.iterdir() if path.is_dir()], key=lambda p: p.name.lower())

    decoded_estimates = []
    merged_bid_hints = []
    for estimate_dir in estimate_dirs:
        tables = []
        for table_name in TARGET_TABLES:
            dat_path = estimate_dir / f"{table_name}.DAT"
            hdr_path = estimate_dir / f"{table_name}.HDR"
            if not dat_path.exists():
                continue
            snapshot = _read_table_snapshot(dat_path, hdr_path if hdr_path.exists() else None)
            table_payload = {
                "table": table_name,
                "schema_field_count": len(registry_lookup.get(table_name, {}).get("fields", [])),
                "shadow_table": registry_lookup.get(table_name, {}).get("shadow_table", ""),
                **snapshot,
            }
            if table_name == "BIDITEM":
                table_payload["decoded_rows"] = _extract_biditem_candidates(snapshot["ascii_tokens"])
                for hint in table_payload["decoded_rows"]:
                    merged_bid_hints.append(
                        {
                            "estimate_code": estimate_dir.name,
                            "item_code": hint["item_code"],
                            "description_hint": hint["description_hint"],
                            "source_kind": "binary_biditem",
                            "source_file": str(dat_path),
                            "confidence": "low",
                        }
                    )
            tables.append(table_payload)
        if tables:
            decoded_estimates.append(
                {
                    "estimate_code": estimate_dir.name,
                    "tables": tables,
                }
            )

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_dir": str(source),
        "decoded_estimates": decoded_estimates,
        "merged_bid_hints": merged_bid_hints,
    }
    if write_outputs:
        write_json(BINARY_ROOT / "binary-tables.json", payload)
        write_json(BINARY_ROOT / "binary-biditem-hints.json", merged_bid_hints)
    return payload
