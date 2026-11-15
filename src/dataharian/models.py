"""Domain types and small time helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

Source = Literal["usgs", "bmkg"]


@dataclass(frozen=True, slots=True)
class Quake:
    """One earthquake as reported by one agency, normalised to UTC and kilometres."""

    id: str
    source: Source
    time: datetime
    lat: float
    lon: float
    depth_km: float
    mag: float
    mag_type: str | None = None
    place: str | None = None
    status: str | None = None
    updated: datetime | None = None
    url: str | None = None


@dataclass(frozen=True, slots=True)
class Reject:
    """A source row that failed parsing or validation, kept for inspection."""

    source: Source
    raw_id: str | None
    reason: str
    excerpt: str


class RowError(ValueError):
    """Raised by a parser for a row it cannot turn into a Quake."""

    def __init__(self, reason: str, raw_id: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.raw_id = raw_id


def iso(moment: datetime) -> str:
    """Format an aware datetime as `2026-11-15T15:41:15Z` (UTC, whole seconds)."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text: str) -> datetime:
    """Parse the format written by `iso`, or any ISO 8601 string with an offset."""
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)
