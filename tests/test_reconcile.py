from __future__ import annotations

from datetime import timedelta

import pytest

from dataharian.reconcile import MAX_DISTANCE_KM, distance_km, match

from .conftest import make_quake


def test_distance_matches_a_known_pair() -> None:
    # Jakarta to Surabaya is about 660 km by great circle.
    km = distance_km(-6.2088, 106.8456, -7.2575, 112.7521)
    assert 650 < km < 675


def test_distance_to_self_is_zero_and_symmetric() -> None:
    assert distance_km(1.0, 2.0, 1.0, 2.0) == 0
    assert distance_km(1.0, 2.0, 3.0, 4.0) == pytest.approx(distance_km(3.0, 4.0, 1.0, 2.0))


def test_matches_the_same_event_reported_twice() -> None:
    u = make_quake(id="u", mag=5.1)
    b = make_quake(
        id="b", source="bmkg", mag=5.4, time=u.time + timedelta(seconds=6), lat=-2.1, lon=120.1
    )
    [pair] = match([u], [b])
    assert (pair.bmkg_id, pair.usgs_id) == ("b", "u")
    assert pair.dt_s == -6.0  # USGS time minus BMKG time
    assert pair.dmag == pytest.approx(0.3)
    assert 10 < pair.dist_km < 20


def test_events_too_far_apart_in_time_do_not_match() -> None:
    u = make_quake(id="u")
    b = make_quake(id="b", source="bmkg", time=u.time + timedelta(minutes=5))
    assert match([u], [b]) == []


def test_events_too_far_apart_in_space_do_not_match() -> None:
    u = make_quake(id="u")
    b = make_quake(id="b", source="bmkg", lat=u.lat + 3.0)
    assert distance_km(u.lat, u.lon, b.lat, b.lon) > MAX_DISTANCE_KM
    assert match([u], [b]) == []


def test_each_event_is_used_once_and_the_closest_pair_wins() -> None:
    base = make_quake(id="u-near", lat=-2.0, lon=120.0)
    farther = make_quake(id="u-far", lat=-2.5, lon=120.0, time=base.time + timedelta(seconds=20))
    report = make_quake(id="b", source="bmkg", lat=-2.0, lon=120.0, time=base.time)
    [pair] = match([farther, base], [report])
    assert pair.usgs_id == "u-near"


def test_two_reports_cannot_share_one_event() -> None:
    u = make_quake(id="u")
    first = make_quake(id="b1", source="bmkg", time=u.time)
    second = make_quake(id="b2", source="bmkg", time=u.time + timedelta(seconds=30))
    pairs = match([u], [first, second])
    assert [p.bmkg_id for p in pairs] == ["b1"]


def test_nothing_to_match() -> None:
    assert match([], []) == []
    assert match([make_quake()], []) == []
