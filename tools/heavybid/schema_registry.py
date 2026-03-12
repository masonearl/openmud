from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

from .paths import SCHEMA_ROOT, resolve_source_dir, write_json


def _coerce(value: str) -> Any:
    text = value.strip()
    if not text:
        return ""
    if text.isdigit():
        return int(text)
    try:
        return float(text)
    except ValueError:
        return text


def parse_tag_file(path: Path) -> List[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]


def parse_int_file(path: Path) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "database_name": path.stem.upper(),
        "fields": [],
        "indexes": [],
        "raw": {},
    }
    current_field: Dict[str, Any] | None = None
    current_index: Dict[str, Any] | None = None

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if " " in line:
            key, value = line.split(" ", 1)
        else:
            key, value = line, ""

        if key == "FIELD_NUMBER":
            current_field = {"field_number": _coerce(value)}
            meta["fields"].append(current_field)
            current_index = None
            continue

        if key == "INDEX_NUMBER":
            current_index = {"index_number": _coerce(value)}
            meta["indexes"].append(current_index)
            current_field = None
            continue

        bucket = current_field if current_field is not None else current_index
        target_key = key.lower()
        coerced = _coerce(value)
        if bucket is not None:
            existing = bucket.get(target_key)
            if existing is None:
                bucket[target_key] = coerced
            elif isinstance(existing, list):
                existing.append(coerced)
            else:
                bucket[target_key] = [existing, coerced]
        else:
            meta["raw"][target_key] = coerced

    meta["field_count"] = len(meta["fields"])
    meta["index_count"] = len(meta["indexes"])
    return meta


def parse_sql_schema(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    create_table_re = re.compile(
        r"CREATE TABLE \[\?\]\.\[(?P<name>[^\]]+)\]\s*\((?P<body>.*?)\)\s*ON \[PRIMARY\]",
        re.DOTALL,
    )
    drop_shadow_re = re.compile(r"DROP TABLE \[\?\]\.\[(Z_[^\]]+)\]")

    tables: Dict[str, Any] = {}
    for match in create_table_re.finditer(text):
        table_name = match.group("name").upper()
        body = match.group("body")
        columns = []
        for column_match in re.finditer(r"\[(?P<column>[^\]]+)\]\s+(?P<type>[A-Z]+(?:\s*\([^)]+\))?)", body):
            columns.append(
                {
                    "name": column_match.group("column"),
                    "type": column_match.group("type"),
                }
            )
        tables[table_name] = {
            "column_count": len(columns),
            "columns": columns,
        }

    shadow_tables = sorted(set(drop_shadow_re.findall(text)))
    return {"create_tables": tables, "shadow_tables": shadow_tables}


def build_schema_registry(
    source_dir: str | None = None,
    *,
    write_outputs: bool = False,
) -> Dict[str, Any]:
    source = resolve_source_dir(source_dir)
    bin_dir = source / "BIN"
    int_dir = bin_dir / "SQL" / "INT"
    sql_path = bin_dir / "NewSQL22.sp"

    tag_map = {path.stem.upper(): parse_tag_file(path) for path in bin_dir.glob("*.TAG")}
    int_map = {path.stem.upper(): parse_int_file(path) for path in int_dir.glob("*.INT")} if int_dir.exists() else {}
    sql_map = parse_sql_schema(sql_path) if sql_path.exists() else {"create_tables": {}, "shadow_tables": []}
    shadow_lookup = {name.replace("Z_", "", 1): name for name in sql_map.get("shadow_tables", [])}

    all_tables = sorted(set(tag_map) | set(int_map) | set(sql_map.get("create_tables", {}).keys()) | set(shadow_lookup))
    tables = []
    for name in all_tables:
        fields = tag_map.get(name, [])
        int_meta = int_map.get(name, {})
        sql_table = sql_map.get("create_tables", {}).get(name, {})
        tables.append(
            {
                "name": name,
                "field_count": len(fields),
                "fields": fields,
                "int_metadata": int_meta,
                "sql_table": sql_table,
                "shadow_table": shadow_lookup.get(name, ""),
            }
        )

    registry = {
        "source_dir": str(source),
        "table_count": len(tables),
        "tables": tables,
    }

    if write_outputs:
        write_json(SCHEMA_ROOT / "schema-registry.json", registry)
        for table in tables:
            write_json(SCHEMA_ROOT / "tables" / f"{table['name'].lower()}.json", table)
    return registry
