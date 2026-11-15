from __future__ import annotations

from datetime import datetime, timedelta

from dataharian import agreement, reconcile
from dataharian.store import Store

from .conftest import make_quake


def load(store: Store, now: datetime, hours_old: list[int], with_usgs: set[int]) -> None:
    for index, hours in enumerate(hours_old):
        when = now - timedelta(hours=hours)
        store.upsert([make_quake(id=f"b{index}", source="bmkg", time=when, mag=5.3)], now)
        if index in with_usgs:
            store.upsert(
                [make_quake(id=f"u{index}", time=when + timedelta(seconds=4), mag=5.0)], now
            )
    store.replace_matches(reconcile.match(store.quakes("usgs"), store.quakes("bmkg")))


def test_counts_matched_unmatched_and_pending(store: Store, now: datetime) -> None:
    load(store, now, hours_old=[2, 30, 50, 80], with_usgs={0, 1, 2})
    result = agreement.compute(store, now, now - timedelta(days=30))
    assert result.pending == 1  # 2 hours old
    assert result.eligible == 3
    assert result.matched == 2  # the two older events that have a USGS twin
    assert [q.id for q in result.unmatched] == ["b3"]
    assert result.rate == 2 / 3
    assert len(result.pairs) == 3  # the pending event is still shown when it matched
    assert result.median_delta_mag == 0.3
    assert result.median_delta_seconds == 4.0


def test_with_nothing_to_compare(store: Store, now: datetime) -> None:
    result = agreement.compute(store, now, now - timedelta(days=30))
    assert result.rate is None
    assert result.median_delta_mag is None
    assert result.pairs == [] and result.unmatched == []
