"""USGS earthquake catalogue (FDSN event web service, GeoJSON)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from ..config import Settings
from ..http import Fetcher, SourceError
from ..models import Quake, Reject, RowError
from ._values import number

LIMIT = 20_000


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


def windows(start: datetime, end: datetime, chunk_days: int) -> Iterator[tuple[datetime, datetime]]:
    """Split [start, end) into consecutive windows of at most `chunk_days`."""
    step = timedelta(days=chunk_days)
    cursor = start
    while cursor < end:
        yield cursor, min(cursor + step, end)
        cursor += step


def params(
    settings: Settings,
    start: datetime,
    end: datetime,
    updated_after: datetime | None = None,
) -> dict[str, str | int | float]:
    query: dict[str, str | int | float] = {
        "format": "geojson",
        "eventtype": "earthquake",
        "orderby": "time-asc",
        "limit": LIMIT,
        "starttime": _stamp(start),
        "endtime": _stamp(end),
        "minmagnitude": settings.usgs_min_magnitude,
        "minlatitude": settings.bbox.min_lat,
        "maxlatitude": settings.bbox.max_lat,
        "minlongitude": settings.bbox.min_lon,
        "maxlongitude": settings.bbox.max_lon,
    }
    if updated_after is not None:
        query["updatedafter"] = _stamp(updated_after)
    return query


def fetch(
    fetcher: Fetcher,
    settings: Settings,
    start: datetime,
    end: datetime,
    updated_after: datetime | None = None,
) -> list[dict[str, Any]]:
    """Download raw GeoJSON features for [start, end), in windows the API accepts."""
    features: list[dict[str, Any]] = []
    for window_start, window_end in windows(start, end, settings.chunk_days):
        payload = fetcher.get_json(
            settings.usgs_url, params(settings, window_start, window_end, updated_after)
        )
        if payload is None:
            continue
        rows = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise SourceError("USGS answered without a list of features")
        if len(rows) >= LIMIT:
            raise SourceError("USGS window hit the row limit; use a smaller chunk")
        features.extend(rows)
    return features


def parse_feature(feature: Any) -> Quake:
    """Turn one GeoJSON feature into a Quake, or raise RowError with a reason."""
    if not isinstance(feature, dict):
        raise RowError("malformed_feature")
    raw_id = feature.get("id")
    raw_id = raw_id if isinstance(raw_id, str) and raw_id else None
    props = feature.get("properties")
    geometry = feature.get("geometry")
    if raw_id is None or not isinstance(props, dict) or not isinstance(geometry, dict):
        raise RowError("malformed_feature", raw_id)
    coords = geometry.get("coordinates")
    if not isinstance(coords, list) or len(coords) < 3:
        raise RowError("missing_coordinates", raw_id)
    kind = props.get("type")
    if kind not in (None, "earthquake"):
        raise RowError("not_an_earthquake", raw_id)

    magnitude = number(props.get("mag"), "missing_magnitude", raw_id)
    millis = number(props.get("time"), "missing_time", raw_id)
    lon = number(coords[0], "missing_coordinates", raw_id)
    lat = number(coords[1], "missing_coordinates", raw_id)
    depth = number(coords[2], "missing_depth", raw_id)
    updated_ms = props.get("updated")
    updated = (
        datetime.fromtimestamp(updated_ms / 1000, UTC)
        if isinstance(updated_ms, int | float) and not isinstance(updated_ms, bool)
        else None
    )
    return Quake(
        id=raw_id,
        source="usgs",
        time=datetime.fromtimestamp(millis / 1000, UTC).replace(microsecond=0),
        lat=lat,
        lon=lon,
        depth_km=depth,
        mag=magnitude,
        mag_type=_text(props.get("magType")),
        place=_text(props.get("place")),
        status=_text(props.get("status")),
        updated=updated,
        url=_text(props.get("url")),
    )


def parse(features: list[dict[str, Any]]) -> tuple[list[Quake], list[Reject]]:
    """Parse features, keeping the most recently updated copy of any repeated id."""
    best: dict[str, Quake] = {}
    rejects: list[Reject] = []
    for feature in features:
        try:
            quake = parse_feature(feature)
        except RowError as error:
            rejects.append(Reject("usgs", error.raw_id, error.reason, _excerpt(feature)))
            continue
        known = best.get(quake.id)
        if known is None or _updated(quake) >= _updated(known):
            best[quake.id] = quake
    return list(best.values()), rejects


def _updated(quake: Quake) -> datetime:
    return quake.updated or datetime.min.replace(tzinfo=UTC)


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _excerpt(row: Any) -> str:
    return json.dumps(row, default=str, ensure_ascii=False)[:240]
