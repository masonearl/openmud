from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .paths import MANIFEST_ROOT, resolve_source_dir, write_json


def _safe_rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _list_estimate_dirs(est_root: Path) -> List[Path]:
    if not est_root.exists():
        return []
    return sorted(
        [
            path
            for path in est_root.iterdir()
            if path.is_dir() and any(child.is_file() for child in path.iterdir())
        ],
        key=lambda p: p.name.lower(),
    )


def _top_items(counter: Counter[str], limit: int = 25) -> List[Dict[str, Any]]:
    return [{"name": name, "count": count} for name, count in counter.most_common(limit)]


def _iter_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_file():
            yield path


def build_discovery_manifest(
    source_dir: str | None = None,
    *,
    write_outputs: bool = False,
) -> Dict[str, Any]:
    source = resolve_source_dir(source_dir)
    est_root = source / "EST"
    hcss_root = source / "HCSS"
    calc_root = hcss_root / "CalcTemplates"
    estimate_dirs = _list_estimate_dirs(est_root)

    extension_counts: Counter[str] = Counter()
    estimate_file_names: Counter[str] = Counter()
    xml_exports: Counter[str] = Counter()
    workbook_exports: Counter[str] = Counter()
    calc_templates: Counter[str] = Counter()

    for file_path in _iter_files(source):
        extension = file_path.suffix.lower() or "<none>"
        extension_counts[extension] += 1

    for estimate_dir in estimate_dirs:
        for file_path in estimate_dir.iterdir():
            if not file_path.is_file():
                continue
            estimate_file_names[file_path.name] += 1
            if file_path.suffix.lower() == ".xml":
                xml_exports[file_path.name] += 1
            if file_path.suffix.lower() == ".xlsx":
                workbook_exports[file_path.name] += 1

    if calc_root.exists():
        for file_path in _iter_files(calc_root):
            calc_templates[file_path.suffix.lower() or "<none>"] += 1

    manifest = {
        "source_dir": str(source),
        "estimate_directory_count": len(estimate_dirs),
        "estimate_directories_sample": [_safe_rel(path, source) for path in estimate_dirs[:20]],
        "extension_counts": _top_items(extension_counts, 50),
        "common_estimate_files": _top_items(estimate_file_names, 60),
        "xml_exports": _top_items(xml_exports, 40),
        "workbook_exports": _top_items(workbook_exports, 40),
        "calc_template_extensions": _top_items(calc_templates, 20),
        "calc_template_directories": [
            _safe_rel(path, source)
            for path in sorted(calc_root.iterdir(), key=lambda p: p.name.lower())
            if path.is_dir()
        ] if calc_root.exists() else [],
    }

    if write_outputs:
        write_json(MANIFEST_ROOT / "discovery-manifest.json", manifest)
    return manifest
