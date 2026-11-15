"""Write the public document to disk, byte-for-byte reproducible."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def dumps(document: dict[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


def write(document: dict[str, Any], path: Path) -> int:
    """Write the document and return its size in bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = dumps(document)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))
