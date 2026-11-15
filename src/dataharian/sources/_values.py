"""Helpers for reading loosely typed JSON values."""

from __future__ import annotations

from typing import Any

from ..models import RowError


def number(value: Any, reason: str, raw_id: str | None) -> float:
    """Accept ints and floats only. Strings and booleans are a data problem, not a number."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise RowError(reason, raw_id)
    if value != value or value in (float("inf"), float("-inf")):
        raise RowError(reason, raw_id)
    return float(value)
