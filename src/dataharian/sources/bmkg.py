"""BMKG list of recent M5+ earthquakes (data.bmkg.go.id, "gempaterkini")."""

from __future__ import annotations

import json
import re
from typing import Any

from ..config import Settings
from ..http import Fetcher, SourceError
from ..models import Quake, Reject, RowError, parse_iso

_DEPTH = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*km\s*$", re.IGNORECASE)


def fetch(fetcher: Fetcher, settings: Settings) -> list[dict[str, Any]]:
    """Download the raw list of events."""
    payload = fetcher.get_json(settings.bmkg_url)
    try:
        rows = payload["Infogempa"]["gempa"]
    except (KeyError, TypeError):
        raise SourceError("BMKG answered without Infogempa.gempa") from None
    if not isinstance(rows, list):
        raise SourceError("BMKG answered without a list of events")
    return rows


def parse_row(row: Any) -> Quake:
    """Turn one BMKG row into a Quake, or raise RowError with a reason."""
    if not isinstance(row, dict):
        raise RowError("malformed_row")
    stamp = row.get("DateTime")
    coords = row.get("Coordinates")
    if not isinstance(stamp, str) or not isinstance(coords, str):
        raise RowError("malformed_row")
    try:
        moment = parse_iso(stamp)
    except ValueError:
        raise RowError("bad_time") from None
    try:
        lat_text, lon_text = coords.split(",")
        lat, lon = float(lat_text), float(lon_text)
        magnitude = float(row["Magnitude"])
    except (ValueError, KeyError, TypeError):
        raise RowError("bad_number") from None
    depth_match = _DEPTH.match(str(row.get("Kedalaman", "")))
    if depth_match is None:
        raise RowError("bad_depth")
    depth = float(depth_match.group(1).replace(",", "."))

    region = row.get("Wilayah")
    return Quake(
        id=f"bmkg-{moment:%Y%m%dT%H%M%S}-{lat:.2f}_{lon:.2f}",
        source="bmkg",
        time=moment,
        lat=lat,
        lon=lon,
        depth_km=depth,
        mag=magnitude,
        place=region.strip() if isinstance(region, str) and region.strip() else None,
        status=str(row["Potensi"]).strip() if row.get("Potensi") else None,
    )


def parse(rows: list[dict[str, Any]]) -> tuple[list[Quake], list[Reject]]:
    quakes: dict[str, Quake] = {}
    rejects: list[Reject] = []
    for row in rows:
        try:
            quake = parse_row(row)
        except RowError as error:
            rejects.append(
                Reject("bmkg", error.raw_id, error.reason, json.dumps(row, default=str)[:240])
            )
            continue
        quakes[quake.id] = quake
    return list(quakes.values()), rejects
