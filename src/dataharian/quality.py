"""Data-quality checks. They run after every load and are published with the data."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median
from typing import Literal

from . import agreement
from .config import Settings
from .models import Quake
from .reconcile import distance_km
from .store import Store

Status = Literal["pass", "warn", "fail", "skip"]

# Two events this close in time and place are the same event under two IDs.
DUPLICATE_SECONDS = 5
DUPLICATE_KM = 5


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    status: Status
    detail: str


def run_checks(store: Store, settings: Settings, now: datetime) -> list[Check]:
    since = now - timedelta(days=settings.retention_days)
    usgs = store.quakes("usgs", since)
    return [
        _catalogue_present(len(usgs)),
        _values_plausible(usgs),
        _inside_region(usgs, settings),
        _fresh(store, now),
        _daily_volume(usgs, now),
        _no_double_counting(usgs),
        _last_run(store),
        _reject_rate(store),
        _agreement(store, now, since),
    ]


def worst(checks: list[Check]) -> Status:
    if any(c.status == "fail" for c in checks):
        return "fail"
    if any(c.status == "warn" for c in checks):
        return "warn"
    return "pass"


def _catalogue_present(count: int) -> Check:
    if count == 0:
        return Check("catalogue_present", "fail", "The USGS catalogue is empty.")
    return Check("catalogue_present", "pass", f"{count:,} USGS events in the window.")


def _values_plausible(usgs: list[Quake]) -> Check:
    bad = [q for q in usgs if not 0 <= q.mag <= 10 or not -5 <= q.depth_km <= 800]
    if bad:
        return Check("values_plausible", "fail", f"{len(bad)} events have impossible values.")
    return Check("values_plausible", "pass", "Magnitude 0 to 10 and depth -5 to 800 km everywhere.")


def _inside_region(usgs: list[Quake], settings: Settings) -> Check:
    outside = [q for q in usgs if not settings.bbox.contains(q.lat, q.lon)]
    if outside:
        return Check("inside_region", "fail", f"{len(outside)} events lie outside the region.")
    return Check("inside_region", "pass", "Every event lies inside the configured region.")


def _fresh(store: Store, now: datetime) -> Check:
    latest = store.latest_event_time("usgs")
    if latest is None:
        return Check("fresh_catalogue", "fail", "No USGS events to measure freshness against.")
    age = now - latest
    hours = age.total_seconds() / 3600
    detail = f"Newest event is {hours:.0f} {'hour' if round(hours) == 1 else 'hours'} old."
    if age <= timedelta(hours=72):
        return Check("fresh_catalogue", "pass", detail)
    if age <= timedelta(days=7):
        return Check("fresh_catalogue", "warn", detail)
    return Check("fresh_catalogue", "fail", detail)


def _daily_volume(usgs: list[Quake], now: datetime) -> Check:
    """Flag a quiet or unusually busy last full day against the previous two weeks."""
    today = now.date()
    counts = Counter(q.time.date() for q in usgs)
    history = [counts.get(today - timedelta(days=n), 0) for n in range(2, 16)]
    if len(usgs) < 30:
        return Check("daily_volume", "skip", "Too little history to judge daily volume.")
    typical = median(history)
    yesterday = counts.get(today - timedelta(days=1), 0)
    if typical >= 3 and yesterday == 0:
        return Check("daily_volume", "warn", f"No events yesterday; a typical day has {typical:g}.")
    if yesterday > max(12, 4 * typical):
        return Check(
            "daily_volume", "warn", f"{yesterday} events yesterday; a typical day has {typical:g}."
        )
    return Check(
        "daily_volume", "pass", f"{yesterday} events yesterday; a typical day has {typical:g}."
    )


def _no_double_counting(usgs: list[Quake]) -> Check:
    """Flag one event stored under two IDs: same moment, same place.

    The first real run showed that wider limits (60 s, 50 km) flag aftershock swarms, where
    distinct events follow each other within seconds. Those pairs are real, so only a pair
    with practically identical time and position counts as a duplicate.
    """
    close = 0
    for index, event in enumerate(usgs):
        for other in usgs[index + 1 :]:
            if (other.time - event.time).total_seconds() > DUPLICATE_SECONDS:
                break
            if distance_km(event.lat, event.lon, other.lat, other.lon) < DUPLICATE_KM:
                close += 1
    if close:
        return Check(
            "no_double_counting", "warn", f"{close} pairs look like one event stored twice."
        )
    return Check(
        "no_double_counting",
        "pass",
        f"No events within {DUPLICATE_SECONDS} s and {DUPLICATE_KM} km of each other.",
    )


def _last_run(store: Store) -> Check:
    runs = store.runs(1)
    if not runs:
        return Check("last_run", "skip", "No run recorded yet.")
    run = runs[0]
    if run.status == "ok":
        return Check("last_run", "pass", "The last run read both sources.")
    if run.status == "partial":
        return Check("last_run", "warn", run.error or "The last run read only some sources.")
    return Check("last_run", "fail", run.error or f"The last run ended as {run.status}.")


def _reject_rate(store: Store) -> Check:
    runs = store.runs(1)
    if not runs or runs[0].usgs_fetched + runs[0].bmkg_fetched == 0:
        return Check("reject_rate", "skip", "Nothing fetched in the last run.")
    run = runs[0]
    fetched = run.usgs_fetched + run.bmkg_fetched
    # BMKG lists the whole country, so trimming it to the region is expected filtering, not a
    # defect. Counting it made a quiet incremental run (a handful of rows) warn every day.
    filtered = store.reject_count(run.id, "bmkg", "outside_region")
    rejected = run.rejected - filtered
    detail = f"{rejected} of {fetched:,} rows rejected in the last run."
    if filtered:
        detail += f" {filtered} BMKG outside the region left out, as expected."
    share = rejected / fetched
    if share <= 0.02:
        return Check("reject_rate", "pass", detail)
    return Check("reject_rate", "warn" if share <= 0.10 else "fail", detail)


def _agreement(store: Store, now: datetime, since: datetime) -> Check:
    result = agreement.compute(store, now, since)
    if result.eligible < 5:
        return Check("agency_agreement", "skip", f"Only {result.eligible} BMKG events to compare.")
    share = result.matched / result.eligible
    detail = f"{result.matched} of {result.eligible} BMKG events found in USGS ({share:.0%})."
    return Check("agency_agreement", "pass" if share >= 0.7 else "warn", detail)
