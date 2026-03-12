from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPO_ROOT / "data" / "heavybid"
SCHEMA_ROOT = DATA_ROOT / "schema"
MANIFEST_ROOT = DATA_ROOT / "manifests"
NORMALIZED_ROOT = DATA_ROOT / "normalized"
BINARY_ROOT = DATA_ROOT / "binary"


def default_source_dir() -> Path:
    configured = os.environ.get("OPENMUD_HEAVYBID_SOURCE_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Downloads" / "Heavybid"


def resolve_source_dir(source_dir: str | os.PathLike[str] | None = None) -> Path:
    path = Path(source_dir).expanduser() if source_dir else default_source_dir()
    if not path.exists():
        raise FileNotFoundError(
            f"HeavyBid source directory not found: {path}. "
            "Pass source_dir explicitly or set OPENMUD_HEAVYBID_SOURCE_DIR."
        )
    return path


def ensure_output_dirs() -> None:
    for directory in (DATA_ROOT, SCHEMA_ROOT, MANIFEST_ROOT, NORMALIZED_ROOT, BINARY_ROOT):
        directory.mkdir(parents=True, exist_ok=True)


def write_json(target: Path, payload: Any) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, sort_keys=False), encoding="utf-8")
    return target
