"""A synthetic upstream for tests, local development and dashboard fixtures.

Nothing here is real seismology. Events follow a Gutenberg-Richter magnitude law along rough
tectonic lines so the dashboard has a realistic shape to render. Real data only ever comes from
the agencies; this module replaces them with an `httpx.MockTransport`, so the demo database is
produced by the same code that processes production data.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

import httpx

from . import aggregate, export, pipeline
from .config import Settings
from .http import Fetcher
from .models import iso
from .store import Store

Scenario = Literal["normal", "partial", "failed", "empty"]
SCENARIOS: tuple[Scenario, ...] = ("normal", "partial", "failed", "empty")

# name, (lat, lon) start, (lat, lon) end, jitter in degrees, weight, mean depth in km
_ZONES: tuple[tuple[str, tuple[float, float], tuple[float, float], float, float, float], ...] = (
    ("Sumatra", (5.5, 94.8), (-5.5, 102.5), 0.9, 0.17, 40),
    ("Java", (-8.6, 104.0), (-9.4, 116.0), 0.6, 0.10, 55),
    ("Nusa Tenggara", (-8.3, 116.5), (-8.2, 125.0), 0.7, 0.10, 70),
    ("Banda Sea", (-6.5, 126.0), (-7.2, 131.5), 1.2, 0.15, 150),
    ("Molucca Sea", (3.0, 126.5), (-1.5, 127.5), 0.8, 0.15, 60),
    ("Sulawesi", (1.4, 120.5), (-3.5, 121.5), 1.0, 0.10, 35),
    ("Papua", (-1.5, 134.5), (-4.5, 141.0), 1.0, 0.13, 20),
    ("Sangihe", (3.5, 125.5), (1.5, 126.2), 0.5, 0.10, 80),
)
_DIRECTIONS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


@dataclass(frozen=True, slots=True)
class DemoEvent:
    id: str
    time: datetime
    lat: float
    lon: float
    depth: float
    mag: float
    place: str
    updated: datetime


@dataclass(frozen=True, slots=True)
class DemoBmkg:
    time: datetime
    lat: float
    lon: float
    depth: float
    mag: float
    region: str


def synthesize(
    seed: int, start: datetime, end: datetime, per_day: float = 3.4
) -> tuple[list[DemoEvent], list[DemoBmkg]]:
    """Generate a catalogue and the BMKG view of its larger events."""
    rng = random.Random(seed)
    weights = [zone[4] for zone in _ZONES]
    events: list[DemoEvent] = []
    bmkg: list[DemoBmkg] = []
    cursor = start
    index = 0
    while True:
        cursor += timedelta(seconds=rng.expovariate(per_day / 86400))
        if cursor >= end:
            break
        zone = rng.choices(_ZONES, weights)[0]
        along = rng.random()
        lat = zone[1][0] + (zone[2][0] - zone[1][0]) * along + rng.gauss(0, zone[3])
        lon = zone[1][1] + (zone[2][1] - zone[1][1]) * along + rng.gauss(0, zone[3])
        lat, lon = min(max(lat, -10.8), 5.8), min(max(lon, 95.2), 140.8)
        depth = min(max(abs(rng.gauss(zone[5], zone[5] * 0.6)), 5.0), 650.0)
        mag = min(round(4.0 + rng.expovariate(math.log(10)), 1), 7.4)
        when = cursor.replace(microsecond=0)
        place = f"{rng.randrange(8, 240)} km {rng.choice(_DIRECTIONS)} of {zone[0]}"
        event = DemoEvent(
            id=f"demo{index:05d}",
            time=when,
            lat=round(lat, 3),
            lon=round(lon, 3),
            depth=round(depth, 1),
            mag=mag,
            place=f"{place}, Indonesia",
            updated=when + timedelta(minutes=rng.randrange(8, 50)),
        )
        events.append(event)
        index += 1
        if mag >= 4.8 and rng.random() < 0.9:
            reported = round(mag + rng.gauss(0.25, 0.25), 1)
            if reported >= 5.0:
                # A few BMKG reports land far from any USGS event, as real ones sometimes do.
                shift = 3.0 if rng.random() < 0.08 else 0.0
                bmkg.append(
                    DemoBmkg(
                        time=when + timedelta(seconds=round(rng.gauss(0, 8))),
                        lat=round(event.lat + shift + rng.gauss(0, 0.2), 2),
                        lon=round(event.lon + rng.gauss(0, 0.2), 2),
                        depth=float(max(10, round(depth / 10) * 10)),
                        mag=reported,
                        region=f"{place} {zone[0].upper()}",
                    )
                )
    return events, bmkg


class Upstream:
    """Stands in for both agencies. Set `now`, `usgs_down` and `bmkg_down` between runs."""

    def __init__(self, events: list[DemoEvent], bmkg: list[DemoBmkg], settings: Settings) -> None:
        self.events = events
        self.bmkg = bmkg
        self.settings = settings
        self.now = datetime.now(UTC)
        self.usgs_down = False
        self.bmkg_down = False
        self.extra_usgs: list[dict[str, Any]] = []
        self.requests: list[httpx.URL] = []

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self._handle))

    def fetcher(self) -> Fetcher:
        return Fetcher(self.client(), attempts=3, backoff_s=0, sleep=lambda _: None)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request.url)
        if request.url.host == "earthquake.usgs.gov":
            return self._usgs(request)
        if request.url.host == "data.bmkg.go.id":
            return self._bmkg()
        return httpx.Response(404)

    def _usgs(self, request: httpx.Request) -> httpx.Response:
        if self.usgs_down:
            return httpx.Response(503, text="service unavailable")
        query = request.url.params
        start = _parse(query["starttime"])
        end = _parse(query["endtime"])
        after = _parse(query["updatedafter"]) if "updatedafter" in query else None
        floor = float(query.get("minmagnitude", 0))
        rows = [
            e
            for e in self.events
            if start <= e.time < end
            and e.time <= self.now
            and e.updated <= self.now
            and e.mag >= floor
            and (after is None or e.updated >= after)
        ]
        features = [_feature(e) for e in rows]
        if rows or self.extra_usgs:
            features += self.extra_usgs
            self.extra_usgs = []
        if not features:
            return httpx.Response(204)
        return httpx.Response(200, json={"type": "FeatureCollection", "features": features})

    def _bmkg(self) -> httpx.Response:
        if self.bmkg_down:
            return httpx.Response(503, text="service unavailable")
        recent = sorted((b for b in self.bmkg if b.time <= self.now), key=lambda b: b.time)
        rows = [_bmkg_row(b) for b in reversed(recent[-15:])]
        return httpx.Response(200, json={"Infogempa": {"gempa": rows}})


def _parse(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC)


def _feature(e: DemoEvent) -> dict[str, Any]:
    return {
        "type": "Feature",
        "id": e.id,
        "properties": {
            "mag": e.mag,
            "place": e.place,
            "time": int(e.time.timestamp() * 1000),
            "updated": int(e.updated.timestamp() * 1000),
            "status": "reviewed",
            "type": "earthquake",
            "magType": "mb",
            "url": f"https://example.invalid/event/{e.id}",
        },
        "geometry": {"type": "Point", "coordinates": [e.lon, e.lat, e.depth]},
    }


def _bmkg_row(b: DemoBmkg) -> dict[str, str]:
    lat = f"{abs(b.lat):.2f} {'LU' if b.lat >= 0 else 'LS'}"
    lon = f"{abs(b.lon):.2f} BT"
    return {
        "Tanggal": b.time.strftime("%d %b %Y"),
        "Jam": b.time.strftime("%H:%M:%S") + " WIB",
        "DateTime": b.time.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "Coordinates": f"{b.lat:.2f},{b.lon:.2f}",
        "Lintang": lat,
        "Bujur": lon,
        "Magnitude": f"{b.mag:.1f}",
        "Kedalaman": f"{b.depth:.0f} km",
        "Wilayah": b.region,
        "Potensi": "Tidak berpotensi tsunami",
    }


class _Stopwatch:
    """A deterministic stand-in for `time.monotonic`: every run appears to take 2 to 7 seconds."""

    def __init__(self) -> None:
        self._calls = 0
        self._elapsed = 0.0

    def __call__(self) -> float:
        self._calls += 1
        if self._calls % 2 == 0:  # the end of a run
            self._elapsed += 2.0 + (self._calls * 7 % 50) / 10
        return self._elapsed


def build(
    scenario: Scenario,
    now: datetime,
    db_path: Path | str,
    *,
    seed: int = 7,
    days: int = 90,
) -> Settings:
    """Run the real pipeline against the synthetic upstream and leave a warehouse behind."""
    settings = Settings(retention_days=days)
    events, bmkg = synthesize(seed, now - timedelta(days=days + 1), now)
    upstream = Upstream(events, bmkg, settings)
    fetcher = upstream.fetcher()
    stopwatch = _Stopwatch()
    run_hour = timedelta(hours=1, minutes=17)
    midnight = datetime(now.year, now.month, now.day, tzinfo=UTC)

    with Store(db_path) as store:
        if scenario == "empty":
            upstream.now = now
            upstream.usgs_down = True
            pipeline.run(
                store,
                settings,
                fetcher,
                now=midnight + run_hour,
                mode="backfill",
                monotonic=stopwatch,
            )
            return settings
        history = 14 if scenario != "failed" else 16
        for back in range(history, -1, -1):
            moment = midnight - timedelta(days=back) + run_hour
            upstream.now = moment
            upstream.usgs_down = False
            upstream.bmkg_down = False
            last = back == 0
            if scenario == "partial" and last:
                upstream.bmkg_down = True
            if scenario == "failed" and back <= 1:
                upstream.usgs_down = True
            if scenario == "normal" and last:
                upstream.extra_usgs = [_broken_feature()]
            pipeline.run(
                store,
                settings,
                fetcher,
                now=moment,
                mode="backfill" if back == history else "incremental",
                monotonic=stopwatch,
            )
        store.compact()
    return settings


def _broken_feature() -> dict[str, Any]:
    """A feature the way USGS occasionally publishes one: no magnitude yet."""
    return {
        "type": "Feature",
        "id": "demo-unrated",
        "properties": {"mag": None, "time": 0, "type": "earthquake"},
        "geometry": {"type": "Point", "coordinates": [120.0, -2.0, 10.0]},
    }


def make_document(
    scenario: Scenario, now: datetime, work_dir: Path, *, seed: int = 7, days: int = 90
) -> dict[str, Any]:
    """Build the public JSON for a scenario, as the dashboard would receive it."""
    db_path = work_dir / f"{scenario}.db"
    db_path.unlink(missing_ok=True)
    settings = build(scenario, now, db_path, seed=seed, days=days)
    midnight = datetime(now.year, now.month, now.day, tzinfo=UTC)
    published = midnight + timedelta(hours=1, minutes=17)
    with Store(db_path) as store:
        return aggregate.build_document(store, settings, published)


def write_fixture(
    scenario: Scenario, now: datetime, out: Path, work_dir: Path, *, seed: int = 7
) -> int:
    document = make_document(scenario, now, work_dir, seed=seed)
    return export.write(document, out)


def dump(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False)


__all__ = ["SCENARIOS", "Scenario", "Upstream", "build", "iso", "make_document", "synthesize"]
