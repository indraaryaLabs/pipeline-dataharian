from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from dataharian.config import Settings
from dataharian.validate import check

from .conftest import make_quake


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({}, None),
        ({"lat": 91.0}, "coordinates_out_of_range"),
        ({"lon": -181.0}, "coordinates_out_of_range"),
        ({"lat": 40.0, "lon": -100.0}, "outside_region"),
        ({"mag": -0.1}, "magnitude_out_of_range"),
        ({"mag": 10.1}, "magnitude_out_of_range"),
        ({"depth_km": -6.0}, "depth_out_of_range"),
        ({"depth_km": 801.0}, "depth_out_of_range"),
        ({"depth_km": -2.0}, None),
        ({"depth_km": 700.0}, None),
    ],
)
def test_reasons(changes: dict[str, float], reason: str | None, now: datetime) -> None:
    assert check(make_quake(**changes), now=now, bbox=Settings().bbox) == reason


def test_events_from_the_future_are_rejected(now: datetime) -> None:
    bbox = Settings().bbox
    assert check(make_quake(time=now + timedelta(hours=1)), now=now, bbox=bbox) == "time_in_future"
    assert check(make_quake(time=now + timedelta(minutes=5)), now=now, bbox=bbox) is None


def test_region_edges_are_inside(now: datetime) -> None:
    bbox = Settings().bbox
    assert check(make_quake(lat=bbox.min_lat, lon=bbox.max_lon), now=now, bbox=bbox) is None
