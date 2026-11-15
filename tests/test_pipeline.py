from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from dataharian import demo, pipeline
from dataharian.config import Settings
from dataharian.store import Store

DAY0 = datetime(2026, 11, 1, 1, 17, tzinfo=UTC)


@pytest.fixture
def settings() -> Settings:
    return Settings(retention_days=60)


@pytest.fixture
def upstream(settings: Settings) -> demo.Upstream:
    events, bmkg = demo.synthesize(11, DAY0 - timedelta(days=62), DAY0 + timedelta(days=10))
    up = demo.Upstream(events, bmkg, settings)
    up.now = DAY0
    return up


def run(store: Store, settings: Settings, up: demo.Upstream, when: datetime, **kw):  # type: ignore[no-untyped-def]
    up.now = when
    return pipeline.run(store, settings, up.fetcher(), now=when, **kw)


def in_window(up: demo.Upstream, newer_than_days: int = 50, older_than_days: int = 5):  # type: ignore[no-untyped-def]
    """An event the store certainly holds: inside the retention window, not too recent."""
    return next(
        e
        for e in up.events
        if DAY0 - timedelta(days=newer_than_days) < e.time < DAY0 - timedelta(days=older_than_days)
    )


def usgs_queries(up: demo.Upstream) -> list[dict[str, str]]:
    return [dict(u.params) for u in up.requests if u.host == "earthquake.usgs.gov"]


def test_the_first_run_is_a_backfill_that_loads_both_sources(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    report = run(store, settings, upstream, DAY0)
    assert (report.mode, report.status, report.exit_code) == ("backfill", "ok", 0)
    assert report.usgs.inserted == report.usgs_fetched > 50
    assert store.count("usgs") == report.usgs.inserted
    assert store.count("bmkg") == report.bmkg.inserted > 0
    assert store.matches()  # agencies were reconciled
    assert store.runs(1)[0].status == "ok"


def test_the_next_run_is_incremental_and_asks_only_for_recent_revisions(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    upstream.requests.clear()
    report = run(store, settings, upstream, DAY0 + timedelta(days=1))
    assert report.mode == "incremental"
    [query] = usgs_queries(upstream)
    assert query["updatedafter"] == "2026-10-31T19:17:00"  # previous start minus 6 hours
    assert report.usgs_fetched < 20


def test_running_twice_with_nothing_new_changes_nothing(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    before = store.quakes()
    report = run(store, settings, upstream, DAY0 + timedelta(minutes=30))
    assert report.usgs.inserted == 0 and report.usgs.updated == 0
    assert report.bmkg.inserted == 0
    assert store.quakes() == before


def test_a_revised_magnitude_is_picked_up(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    target = in_window(upstream, older_than_days=1)
    upstream.events[upstream.events.index(target)] = replace(
        target, mag=target.mag + 0.4, updated=DAY0 + timedelta(hours=2)
    )
    report = run(store, settings, upstream, DAY0 + timedelta(days=1))
    assert report.usgs.updated == 1
    stored = next(q for q in store.quakes("usgs") if q.id == target.id)
    assert stored.mag == pytest.approx(target.mag + 0.4)


def test_events_that_appear_later_are_added(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    before = {q.id for q in store.quakes("usgs")}
    report = run(store, settings, upstream, DAY0 + timedelta(days=3))
    assert report.usgs.inserted > 0
    added = {q.id for q in store.quakes("usgs")} - before
    assert len(added) == report.usgs.inserted


def test_usgs_failing_fails_the_run_but_keeps_the_data(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    before = {q.id for q in store.quakes("usgs", DAY0 - timedelta(days=50))}
    upstream.usgs_down = True
    report = run(store, settings, upstream, DAY0 + timedelta(days=1))
    assert (report.status, report.exit_code) == ("failed", 1)
    assert report.error is not None and report.error.startswith("USGS:")
    assert "failed after 3 attempts (HTTP 503)" in report.error
    assert before <= {q.id for q in store.quakes("usgs")}
    assert store.runs(1)[0].status == "failed"
    # The next healthy run goes back to asking since the last *complete* run.
    upstream.usgs_down = False
    upstream.requests.clear()
    recovered = run(store, settings, upstream, DAY0 + timedelta(days=2))
    assert recovered.status == "ok"
    assert usgs_queries(upstream)[0]["updatedafter"] == "2026-10-31T19:17:00"


def test_bmkg_failing_is_only_a_partial_run(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    upstream.bmkg_down = True
    report = run(store, settings, upstream, DAY0 + timedelta(days=1))
    assert (report.status, report.exit_code) == ("partial", 0)
    assert report.error is not None and report.error.startswith("BMKG:")
    assert report.usgs_fetched > 0


def test_both_sources_failing_reports_both(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    upstream.usgs_down = upstream.bmkg_down = True
    report = run(store, settings, upstream, DAY0)
    assert report.status == "failed"
    assert report.error is not None and "USGS:" in report.error and "BMKG:" in report.error


def test_bad_rows_are_rejected_recorded_and_do_not_stop_the_run(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    upstream.extra_usgs = [demo._broken_feature()]
    report = run(store, settings, upstream, DAY0)
    assert report.status == "ok"
    assert report.rejected == 1
    assert store.reject_reasons() == [("usgs", "missing_magnitude", 1)]


def test_rows_outside_the_region_are_rejected(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    stray = demo._feature(
        replace(upstream.events[0], id="stray", time=DAY0 - timedelta(hours=9), lat=45.0, lon=10.0)
    )
    upstream.extra_usgs = [stray]
    run(store, settings, upstream, DAY0)
    assert ("usgs", "outside_region", 1) in store.reject_reasons()
    assert all(q.id != "stray" for q in store.quakes())


def test_a_full_refresh_removes_events_that_vanished_upstream(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    victim = in_window(upstream)
    upstream.events.remove(victim)
    report = run(store, settings, upstream, DAY0 + timedelta(hours=1), mode="backfill")
    assert report.usgs_removed == 1
    assert all(q.id != victim.id for q in store.quakes("usgs"))


def test_an_incremental_run_never_deletes(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    upstream.events.pop(0)
    count = store.count("usgs")
    run(store, settings, upstream, DAY0 + timedelta(days=1))
    assert store.count("usgs") >= count


def test_a_refresh_that_would_delete_too_much_is_refused(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    count = store.count("usgs")
    del upstream.events[: len(upstream.events) // 2]
    report = run(store, settings, upstream, DAY0 + timedelta(hours=1), mode="backfill")
    assert report.status == "failed"
    assert report.error is not None and "keeping them" in report.error
    assert store.count("usgs") == count


def test_a_refresh_that_returns_nothing_is_refused(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    count = store.count("usgs")
    upstream.events.clear()
    report = run(store, settings, upstream, DAY0 + timedelta(hours=1), mode="backfill")
    assert report.status == "failed"
    assert "returned no events" in (report.error or "")
    assert store.count("usgs") == count


def test_old_events_age_out_of_the_window(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    run(store, settings, upstream, DAY0)
    run(store, settings, upstream, DAY0 + timedelta(days=30))
    oldest = min(q.time for q in store.quakes("usgs"))
    assert oldest >= DAY0 + timedelta(days=30) - timedelta(days=60)


def test_requesting_incremental_without_history_falls_back_to_a_backfill(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    assert pipeline.resolve_mode(store, "incremental") == "backfill"
    assert pipeline.resolve_mode(store, "auto") == "backfill"
    assert pipeline.resolve_mode(store, "backfill") == "backfill"


def test_a_bug_is_recorded_and_not_swallowed(
    store: Store, settings: Settings, upstream: demo.Upstream, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_: object, **__: object) -> None:
        raise ZeroDivisionError("oops")

    monkeypatch.setattr(pipeline, "_load_usgs", boom)
    with pytest.raises(ZeroDivisionError):
        run(store, settings, upstream, DAY0)
    last = store.runs(1)[0]
    assert last.status == "failed"
    assert "ZeroDivisionError" in (last.error or "")


def test_the_report_carries_checks_and_a_failing_check_fails_the_exit_code(
    store: Store, settings: Settings, upstream: demo.Upstream
) -> None:
    upstream.events.clear()
    report = run(store, settings, upstream, DAY0)
    assert report.status == "ok"  # both sources answered; the catalogue is just empty
    assert any(c.name == "catalogue_present" and c.status == "fail" for c in report.checks)
    assert report.exit_code == 1
