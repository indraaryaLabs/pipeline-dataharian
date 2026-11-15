"""How well the two agencies agree about the events they both report."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

from .models import Quake
from .store import MatchRow, Store

# USGS can take a few hours to publish an event BMKG reported at once. Younger events are
# "pending" and do not count against the match rate.
PENDING_WINDOW = timedelta(hours=12)


@dataclass(frozen=True, slots=True)
class Pair:
    bmkg: Quake
    usgs: Quake
    match: MatchRow


@dataclass(frozen=True, slots=True)
class Agreement:
    eligible: int
    matched: int
    pending: int
    pairs: list[Pair]
    unmatched: list[Quake]
    median_delta_mag: float | None
    median_distance_km: float | None
    median_delta_seconds: float | None

    @property
    def rate(self) -> float | None:
        return self.matched / self.eligible if self.eligible else None


def compute(store: Store, now: datetime, since: datetime) -> Agreement:
    bmkg = store.quakes("bmkg", since)
    by_id = {q.id: q for q in store.quakes("usgs", since - timedelta(days=1))}
    matches = {m.bmkg_id: m for m in store.matches()}

    pairs: list[Pair] = []
    unmatched: list[Quake] = []
    eligible = matched = pending = 0
    for event in bmkg:
        link = matches.get(event.id)
        partner = by_id.get(link.usgs_id) if link else None
        young = now - event.time < PENDING_WINDOW
        if young:
            pending += 1
        else:
            eligible += 1
        if link and partner:
            pairs.append(Pair(event, partner, link))
            if not young:
                matched += 1
        elif not young:
            unmatched.append(event)

    def middle(values: list[float]) -> float | None:
        return round(median(values), 2) if values else None

    return Agreement(
        eligible=eligible,
        matched=matched,
        pending=pending,
        pairs=pairs,
        unmatched=unmatched,
        median_delta_mag=middle([p.match.dmag for p in pairs]),
        median_distance_km=middle([p.match.dist_km for p in pairs]),
        median_delta_seconds=middle([p.match.dt_s for p in pairs]),
    )
