"""Match the same earthquake across two agencies.

Agencies compute their own origin time, position and magnitude, so the same event never
agrees exactly. A pair is accepted when it is close in both time and space, and each event
is used at most once, closest pairs first.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from math import asin, cos, radians, sin, sqrt

from .models import Quake
from .store import MatchRow

MAX_DELTA = timedelta(seconds=90)
MAX_DISTANCE_KM = 150.0
EARTH_RADIUS_KM = 6371.0088


def distance_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle distance (haversine)."""
    d_lat = radians(b_lat - a_lat)
    d_lon = radians(b_lon - a_lon)
    h = sin(d_lat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))


def match(usgs: Sequence[Quake], bmkg: Sequence[Quake]) -> list[MatchRow]:
    """Pair BMKG events with USGS events, one-to-one, closest first."""
    candidates: list[tuple[float, str, str, float, float, float]] = []
    ordered = sorted(usgs, key=lambda q: q.time)
    for b in bmkg:
        for u in ordered:
            gap = (u.time - b.time).total_seconds()
            if gap < -MAX_DELTA.total_seconds():
                continue
            if gap > MAX_DELTA.total_seconds():
                break
            km = distance_km(b.lat, b.lon, u.lat, u.lon)
            if km > MAX_DISTANCE_KM:
                continue
            score = abs(gap) / MAX_DELTA.total_seconds() + km / MAX_DISTANCE_KM
            candidates.append((score, b.id, u.id, gap, km, b.mag - u.mag))
    candidates.sort(key=lambda c: (c[0], c[1], c[2]))

    used_bmkg: set[str] = set()
    used_usgs: set[str] = set()
    pairs: list[MatchRow] = []
    for _, b_id, u_id, gap, km, d_mag in candidates:
        if b_id in used_bmkg or u_id in used_usgs:
            continue
        used_bmkg.add(b_id)
        used_usgs.add(u_id)
        pairs.append(MatchRow(b_id, u_id, round(gap, 1), round(km, 1), round(d_mag, 2)))
    return sorted(pairs, key=lambda p: p.bmkg_id)
