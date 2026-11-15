from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from dataharian import quality, reconcile
from dataharian.config import Settings
from dataharian.models import Quake
from dataharian.store import Store, UpsertResult

from .conftest import make_quake


def by_name(checks: list[quality.Check]) -> dict[str, quality.Check]:
    return {c.name: c for c in checks}


def steady_history(now: datetime, per_day: int = 4, days: int = 20) -> list[Quake]:
    events: list[Quake] = []
    for day in range(days + 1):
        for slot in range(per_day):
            when = now - timedelta(days=day, hours=slot + 1)
            events.append(
                make_quake(id=f"u-{day}-{slot}", time=when, lat=-2 + slot, lon=110 + slot)
            )
    return events


def test_a_healthy_catalogue_passes_everything(
    store: Store, settings: Settings, now: datetime
) -> None:
    store.upsert(steady_history(now), now)
    run = store.start_run("backfill", now)
    store.finish_run(run, now=now, status="ok", usgs_fetched=80, bmkg_fetched=15)
    checks = by_name(quality.run_checks(store, settings, now))
    assert {c.status for c in checks.values()} <= {"pass", "skip"}
    assert checks["catalogue_present"].status == "pass"
    assert quality.worst(list(checks.values())) == "pass"


def test_an_empty_catalogue_fails(store: Store, settings: Settings, now: datetime) -> None:
    checks = by_name(quality.run_checks(store, settings, now))
    assert checks["catalogue_present"].status == "fail"
    assert checks["fresh_catalogue"].status == "fail"
    assert quality.worst(list(checks.values())) == "fail"


@pytest.mark.parametrize(
    ("age", "status"),
    [(timedelta(hours=5), "pass"), (timedelta(days=5), "warn"), (timedelta(days=9), "fail")],
)
def test_freshness_thresholds(
    store: Store, settings: Settings, now: datetime, age: timedelta, status: str
) -> None:
    store.upsert([make_quake(time=now - age)], now)
    assert by_name(quality.run_checks(store, settings, now))["fresh_catalogue"].status == status


def test_freshness_reads_singular_hour(store: Store, settings: Settings, now: datetime) -> None:
    store.upsert([make_quake(time=now - timedelta(minutes=70))], now)
    detail = by_name(quality.run_checks(store, settings, now))["fresh_catalogue"].detail
    assert detail == "Newest event is 1 hour old."


def test_impossible_values_fail(store: Store, settings: Settings, now: datetime) -> None:
    store.upsert(
        [make_quake(id="bad-mag", mag=11.0), make_quake(id="bad-depth", depth_km=900)], now
    )
    assert by_name(quality.run_checks(store, settings, now))["values_plausible"].status == "fail"


def test_events_outside_the_region_fail(store: Store, settings: Settings, now: datetime) -> None:
    store.upsert([make_quake(lat=50.0, lon=10.0)], now)
    assert by_name(quality.run_checks(store, settings, now))["inside_region"].status == "fail"


def test_a_silent_day_is_flagged(store: Store, settings: Settings, now: datetime) -> None:
    events = [q for q in steady_history(now) if q.time.date() != (now - timedelta(days=1)).date()]
    store.upsert(events, now)
    check = by_name(quality.run_checks(store, settings, now))["daily_volume"]
    assert check.status == "warn"
    assert "No events yesterday" in check.detail


def test_a_burst_day_is_flagged(store: Store, settings: Settings, now: datetime) -> None:
    store.upsert(steady_history(now), now)
    burst_day = (now - timedelta(days=1)).replace(hour=3)
    burst = [
        make_quake(id=f"burst-{i}", time=burst_day + timedelta(minutes=i), lat=-5, lon=100 + i)
        for i in range(30)
    ]
    store.upsert(burst, now)
    assert by_name(quality.run_checks(store, settings, now))["daily_volume"].status == "warn"


def test_volume_is_not_judged_on_thin_history(
    store: Store, settings: Settings, now: datetime
) -> None:
    store.upsert([make_quake()], now)
    assert by_name(quality.run_checks(store, settings, now))["daily_volume"].status == "skip"


@pytest.mark.parametrize(
    ("gap_s", "shift_deg", "expected"),
    [
        (0, 0.0, "warn"),  # the same event under two IDs
        (4, 0.02, "warn"),  # a re-import with rounded values
        (11, 0.09, "pass"),  # an aftershock pair seen in the first real run: 11 s, 10 km
        (20, 0.0, "pass"),  # same place but 20 s apart is a different event
        (0, 0.5, "pass"),  # same moment but 55 km apart is a different event
    ],
)
def test_only_a_near_identical_pair_counts_as_one_event_twice(
    store: Store, settings: Settings, now: datetime, gap_s: int, shift_deg: float, expected: str
) -> None:
    when = now - timedelta(hours=5)
    store.upsert(
        [
            make_quake(id="a", time=when),
            make_quake(id="b", time=when + timedelta(seconds=gap_s), lat=-2.0 + shift_deg),
        ],
        now,
    )
    check = by_name(quality.run_checks(store, settings, now))["no_double_counting"]
    assert check.status == expected


def test_run_status_drives_the_last_run_check(
    store: Store, settings: Settings, now: datetime
) -> None:
    assert by_name(quality.run_checks(store, settings, now))["last_run"].status == "skip"
    run = store.start_run("incremental", now)
    store.finish_run(run, now=now, status="partial", error="BMKG: down")
    check = by_name(quality.run_checks(store, settings, now))["last_run"]
    assert (check.status, check.detail) == ("warn", "BMKG: down")
    run = store.start_run("incremental", now)
    store.finish_run(run, now=now, status="failed", error="USGS: down")
    assert by_name(quality.run_checks(store, settings, now))["last_run"].status == "fail"


@pytest.mark.parametrize(("rejected", "status"), [(0, "pass"), (3, "warn"), (30, "fail")])
def test_reject_rate_thresholds(
    store: Store, settings: Settings, now: datetime, rejected: int, status: str
) -> None:
    run = store.start_run("incremental", now)
    store.finish_run(
        run, now=now, status="ok", usgs_fetched=100, rejected=rejected, usgs=UpsertResult()
    )
    assert by_name(quality.run_checks(store, settings, now))["reject_rate"].status == status


def test_reject_rate_is_skipped_when_nothing_was_fetched(
    store: Store, settings: Settings, now: datetime
) -> None:
    run = store.start_run("incremental", now)
    store.finish_run(run, now=now, status="ok")
    assert by_name(quality.run_checks(store, settings, now))["reject_rate"].status == "skip"


def test_agreement_needs_enough_events_then_a_good_match_rate(
    store: Store, settings: Settings, now: datetime
) -> None:
    assert by_name(quality.run_checks(store, settings, now))["agency_agreement"].status == "skip"
    for index in range(10):
        when = now - timedelta(days=2, hours=index * 2)
        store.upsert([make_quake(id=f"b{index}", source="bmkg", time=when, mag=5.2)], now)
        if index < 4:  # only 4 of 10 have a USGS twin
            store.upsert([make_quake(id=f"u{index}", time=when)], now)
    store.replace_matches(reconcile.match(store.quakes("usgs"), store.quakes("bmkg")))
    check = by_name(quality.run_checks(store, settings, now))["agency_agreement"]
    assert check.status == "warn"
    assert "4 of 10" in check.detail


def test_worst_orders_the_levels() -> None:
    ok = quality.Check("a", "pass", "")
    warn = quality.Check("b", "warn", "")
    fail = quality.Check("c", "fail", "")
    skip = quality.Check("d", "skip", "")
    assert quality.worst([ok, skip]) == "pass"
    assert quality.worst([ok, warn]) == "warn"
    assert quality.worst([warn, fail, ok]) == "fail"
    assert quality.worst([]) == "pass"
