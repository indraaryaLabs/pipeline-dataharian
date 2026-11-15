from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from dataharian.models import Reject
from dataharian.store import SCHEMA_VERSION, MatchRow, Store, UpsertResult

from .conftest import make_quake


def test_upsert_inserts_updates_and_ignores_repeats(store: Store, now: datetime) -> None:
    quake = make_quake()
    assert store.upsert([quake], now) == UpsertResult(inserted=1)
    assert store.upsert([quake], now) == UpsertResult(unchanged=1)
    revised = replace(quake, mag=4.9, updated=now)
    assert store.upsert([revised], now) == UpsertResult(updated=1)
    assert store.quakes()[0].mag == 4.9
    assert store.count("usgs") == 1


def test_upsert_keeps_when_it_first_saw_an_event(store: Store, now: datetime) -> None:
    store.upsert([make_quake()], now - timedelta(days=2))
    store.upsert([make_quake(mag=5.0)], now)
    row = store._db.execute("SELECT first_seen_utc, last_changed_utc FROM quakes").fetchone()
    assert row["first_seen_utc"] == "2026-11-13T09:00:00Z"
    assert row["last_changed_utc"] == "2026-11-15T09:00:00Z"


def test_a_failed_batch_leaves_nothing_behind(store: Store, now: datetime) -> None:
    good = make_quake(id="us-good")
    bad = replace(make_quake(id="us-bad"), source="nope")  # type: ignore[arg-type]
    with pytest.raises(Exception, match="CHECK"):
        store.upsert([good, bad], now)
    assert store.count("usgs") == 0


def test_round_trips_every_field(store: Store, now: datetime) -> None:
    quake = make_quake()
    store.upsert([quake], now)
    assert store.quakes() == [quake]


def test_optional_fields_survive_as_none(store: Store, now: datetime) -> None:
    quake = make_quake(mag_type=None, place=None, status=None, updated=None, url=None)
    store.upsert([quake], now)
    assert store.quakes() == [quake]


def test_filters_by_source_and_time(store: Store, now: datetime) -> None:
    old = make_quake(id="old", time=now - timedelta(days=30))
    new = make_quake(id="new", time=now - timedelta(days=1))
    other = make_quake(id="bmkg-x", source="bmkg", time=now - timedelta(days=1))
    store.upsert([old, new, other], now)
    assert [q.id for q in store.quakes("usgs")] == ["old", "new"]
    assert [q.id for q in store.quakes("usgs", now - timedelta(days=7))] == ["new"]
    assert [q.id for q in store.quakes("bmkg")] == ["bmkg-x"]
    assert store.latest_event_time("usgs") == new.time
    assert store.latest_event_time("bmkg") == other.time


def test_latest_event_time_of_an_empty_source_is_none(store: Store) -> None:
    assert store.latest_event_time("usgs") is None


def test_remove_missing_deletes_only_inside_the_window(store: Store, now: datetime) -> None:
    inside_gone = make_quake(id="gone", time=now - timedelta(days=5))
    inside_kept = make_quake(id="kept", time=now - timedelta(days=4))
    before_window = make_quake(id="before", time=now - timedelta(days=40))
    other_source = make_quake(id="b", source="bmkg", time=now - timedelta(days=5))
    store.upsert([inside_gone, inside_kept, before_window, other_source], now)
    removed = store.remove_missing("usgs", now - timedelta(days=10), now, {"kept"})
    assert removed == 1
    assert {q.id for q in store.quakes()} == {"kept", "before", "b"}


def test_delete_older_than(store: Store, now: datetime) -> None:
    store.upsert(
        [make_quake(id="a", time=now - timedelta(days=400)), make_quake(id="b", time=now)], now
    )
    assert store.delete_older_than(now - timedelta(days=365)) == 1
    assert [q.id for q in store.quakes()] == ["b"]


def test_run_lifecycle(store: Store, now: datetime) -> None:
    run_id = store.start_run("backfill", now)
    assert store.runs(1)[0].status == "running"
    assert store.last_complete_run() is None
    store.finish_run(
        run_id,
        now=now + timedelta(seconds=9),
        status="ok",
        usgs_fetched=10,
        usgs=UpsertResult(inserted=8, updated=1),
        usgs_removed=2,
        bmkg_fetched=15,
        bmkg=UpsertResult(inserted=3),
        rejected=1,
    )
    run = store.runs(1)[0]
    assert (run.status, run.usgs_fetched, run.usgs_inserted, run.usgs_updated) == ("ok", 10, 8, 1)
    assert (run.usgs_removed, run.bmkg_fetched, run.bmkg_inserted, run.rejected) == (2, 15, 3, 1)
    assert run.finished == now + timedelta(seconds=9)
    assert store.last_complete_run() == run


def test_failed_runs_are_not_complete_but_partial_ones_are(store: Store, now: datetime) -> None:
    partial = store.start_run("incremental", now)
    store.finish_run(partial, now=now, status="partial", error="BMKG down")
    failed = store.start_run("incremental", now + timedelta(days=1))
    store.finish_run(failed, now=now + timedelta(days=1), status="failed", error="USGS down")
    assert store.last_complete_run() is not None
    assert store.last_complete_run().id == partial  # type: ignore[union-attr]
    assert [r.id for r in store.runs(5)] == [failed, partial]


def test_history_is_trimmed(store: Store, now: datetime, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dataharian.store.KEEP_RUNS", 3)
    for day in range(6):
        run_id = store.start_run("incremental", now + timedelta(days=day))
        store.finish_run(run_id, now=now, status="ok")
    assert len(store.runs(50)) == 3


def test_rejects_are_summarised_by_reason(store: Store, now: datetime) -> None:
    run_id = store.start_run("backfill", now)
    store.add_rejects(
        run_id,
        [
            Reject("usgs", "a", "missing_magnitude", "{}"),
            Reject("usgs", "b", "missing_magnitude", "{}"),
            Reject("bmkg", None, "bad_depth", "{}"),
        ],
    )
    assert store.reject_reasons() == [
        ("usgs", "missing_magnitude", 2),
        ("bmkg", "bad_depth", 1),
    ]


def test_matches_are_replaced_not_accumulated(store: Store, now: datetime) -> None:
    store.upsert(
        [make_quake(id="u1"), make_quake(id="u2"), make_quake(id="b1", source="bmkg")], now
    )
    store.replace_matches([MatchRow("b1", "u1", 1.0, 2.0, 0.3)])
    store.replace_matches([MatchRow("b1", "u2", -4.0, 9.0, -0.1)])
    assert store.matches() == [MatchRow("b1", "u2", -4.0, 9.0, -0.1)]


def test_deleting_an_event_deletes_its_match(store: Store, now: datetime) -> None:
    store.upsert([make_quake(id="u1"), make_quake(id="b1", source="bmkg")], now)
    store.replace_matches([MatchRow("b1", "u1", 0, 0, 0)])
    store.remove_missing("usgs", now - timedelta(days=5), now, set())
    assert store.matches() == []


def test_the_file_is_created_and_reopened(tmp_path: Path, now: datetime) -> None:
    path = tmp_path / "nested" / "warehouse.db"
    with Store(path) as first:
        first.upsert([make_quake()], now)
        first.compact()
    with Store(path) as second:
        assert second.count("usgs") == 1
    assert sorted(p.name for p in path.parent.iterdir()) == ["warehouse.db"]


def test_refuses_a_database_from_the_future(tmp_path: Path) -> None:
    path = tmp_path / "future.db"
    with Store(path) as db:
        db._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer than this code"):
        Store(path)


def test_migration_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "w.db"
    Store(path).close()
    Store(path).close()


def test_utc_is_stored_regardless_of_input_zone(store: Store) -> None:
    from datetime import timezone

    wib = timezone(timedelta(hours=7))
    quake = make_quake(time=datetime(2026, 11, 14, 19, 0, tzinfo=wib))
    store.upsert([quake], datetime(2026, 11, 15, tzinfo=UTC))
    stored = store._db.execute("SELECT time_utc FROM quakes").fetchone()[0]
    assert stored == "2026-11-14T12:00:00Z"
