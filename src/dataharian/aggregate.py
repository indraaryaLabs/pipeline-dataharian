"""Build the public document the dashboard reads."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from . import __version__, agreement, quality
from .config import Settings
from .models import Quake, iso
from .store import RunRow, Store

SCHEMA_VERSION = 1
RECENT_RUNS = 14

EVENT_COLUMNS = ["id", "t", "lat", "lon", "depth", "mag", "place"]


def build_document(store: Store, settings: Settings, now: datetime) -> dict[str, Any]:
    """Assemble every section from the warehouse. Pure apart from reading the database."""
    window_start = now - timedelta(days=settings.retention_days)
    events = store.quakes("usgs", window_start)
    checks = quality.run_checks(store, settings, now)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": iso(now),
        "pipelineVersion": __version__,
        "region": {
            "name": settings.region_name,
            "bbox": [
                settings.bbox.min_lon,
                settings.bbox.min_lat,
                settings.bbox.max_lon,
                settings.bbox.max_lat,
            ],
            "minMagnitude": settings.usgs_min_magnitude,
        },
        "window": {
            "from": window_start.date().isoformat(),
            "to": now.date().isoformat(),
            "days": settings.retention_days,
        },
        "events": {"columns": EVENT_COLUMNS, "rows": [_event_row(q) for q in events]},
        "daily": _daily(events, window_start, now),
        "crosscheck": _crosscheck(store, now, window_start),
        "pipeline": _pipeline(store, checks, now),
    }


def _event_row(q: Quake) -> list[Any]:
    return [
        q.id,
        int(q.time.timestamp()),
        round(q.lat, 3),
        round(q.lon, 3),
        round(q.depth_km, 1),
        round(q.mag, 1),
        q.place,
    ]


def _band(mag: float) -> int:
    return 0 if mag < 5 else 1 if mag < 6 else 2


def _daily(events: list[Quake], window_start: datetime, now: datetime) -> dict[str, Any]:
    """Counts per UTC day in three magnitude bands (4-4.9, 5-5.9, 6+), plus the day's maximum."""
    first = window_start.date()
    days = (now.date() - first).days + 1
    counts: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    strongest: dict[int, float] = {}
    for q in events:
        index = (q.time.date() - first).days
        if not 0 <= index < days:
            continue
        counts[index][_band(q.mag)] += 1
        strongest[index] = max(strongest.get(index, 0.0), q.mag)
    return {
        "from": first.isoformat(),
        "bands": ["4.0-4.9", "5.0-5.9", "6.0+"],
        "counts": [counts.get(i, [0, 0, 0]) for i in range(days)],
        "max": [round(strongest[i], 1) if i in strongest else None for i in range(days)],
    }


def _crosscheck(store: Store, now: datetime, since: datetime) -> dict[str, Any]:
    result = agreement.compute(store, now, since)

    def side(q: Quake) -> dict[str, Any]:
        return {
            "id": q.id,
            "t": int(q.time.timestamp()),
            "lat": round(q.lat, 3),
            "lon": round(q.lon, 3),
            "depth": round(q.depth_km, 1),
            "mag": round(q.mag, 1),
            "place": q.place,
        }

    return {
        "eligible": result.eligible,
        "matched": result.matched,
        "pending": result.pending,
        "medianDeltaMag": result.median_delta_mag,
        "medianDistanceKm": result.median_distance_km,
        "medianDeltaSeconds": result.median_delta_seconds,
        "pairs": [
            {
                "bmkg": side(p.bmkg),
                "usgs": side(p.usgs),
                "deltaSeconds": p.match.dt_s,
                "distanceKm": p.match.dist_km,
                "deltaMag": p.match.dmag,
            }
            for p in result.pairs
        ],
        "unmatched": [side(q) for q in result.unmatched],
    }


def _run(run: RunRow) -> dict[str, Any]:
    duration = (run.finished - run.started).total_seconds() if run.finished else None
    return {
        "id": run.id,
        "startedAt": iso(run.started),
        "durationSeconds": None if duration is None else round(duration, 1),
        "mode": run.mode,
        "status": run.status,
        "usgs": {
            "fetched": run.usgs_fetched,
            "inserted": run.usgs_inserted,
            "updated": run.usgs_updated,
            "removed": run.usgs_removed,
        },
        "bmkg": {"fetched": run.bmkg_fetched, "inserted": run.bmkg_inserted},
        "rejected": run.rejected,
        "error": run.error,
    }


def _pipeline(store: Store, checks: list[quality.Check], now: datetime) -> dict[str, Any]:
    runs = store.runs(RECENT_RUNS)
    history = store.runs(200)
    last_complete = next((r for r in history if r.status in ("ok", "partial")), None)
    last_clean = next((r for r in history if r.status == "ok"), None)
    reasons: Counter[tuple[str, str]] = Counter()
    for source, reason, count in store.reject_reasons():
        reasons[(source, reason)] += count
    latest_usgs = store.latest_event_time("usgs")
    latest_bmkg = store.latest_event_time("bmkg")
    return {
        "runs": [_run(r) for r in runs],
        "totals": {
            "usgsEvents": store.count("usgs"),
            "bmkgEvents": store.count("bmkg"),
            "rejectsRecent": sum(reasons.values()),
        },
        "rejects": [{"source": s, "reason": r, "count": n} for (s, r), n in reasons.most_common()],
        "checks": [{"name": c.name, "status": c.status, "detail": c.detail} for c in checks],
        "sources": [
            {
                "id": "usgs",
                "name": "USGS Earthquake Catalog",
                "url": "https://earthquake.usgs.gov/fdsnws/event/1/",
                "lastSuccessAt": _finished(last_complete),
                "latestEventAt": iso(latest_usgs) if latest_usgs else None,
            },
            {
                "id": "bmkg",
                "name": "BMKG recent M5+ list",
                "url": "https://data.bmkg.go.id/",
                "lastSuccessAt": _finished(last_clean),
                "latestEventAt": iso(latest_bmkg) if latest_bmkg else None,
            },
        ],
    }


def _finished(run: RunRow | None) -> str | None:
    return iso(run.finished) if run and run.finished else None
