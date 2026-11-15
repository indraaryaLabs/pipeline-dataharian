from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from dataharian.config import Settings
from dataharian.http import Fetcher, SourceError
from dataharian.models import RowError
from dataharian.sources import bmkg


def row(**changes: str) -> dict[str, str]:
    base = {
        "DateTime": "2026-11-15T15:41:15+00:00",
        "Coordinates": "1.79,122.30",
        "Magnitude": "5.4",
        "Kedalaman": "465 km",
        "Wilayah": "127 km BaratLaut GORONTALOUTARA-GORONTALO",
        "Potensi": "Tidak berpotensi tsunami",
    }
    base.update(changes)
    return base


def test_parses_the_real_list(bmkg_sample: dict[str, Any]) -> None:
    quakes, rejects = bmkg.parse(bmkg_sample["Infogempa"]["gempa"])
    assert rejects == []
    assert len(quakes) == 15
    first = quakes[0]
    assert first.source == "bmkg"
    assert first.time == datetime(2026, 11, 15, 15, 41, 15, tzinfo=UTC)
    assert (first.lat, first.lon, first.depth_km, first.mag) == (1.79, 122.30, 465.0, 5.4)
    assert first.place == "127 km BaratLaut GORONTALOUTARA-GORONTALO"
    assert first.status == "Tidak berpotensi tsunami"


def test_southern_latitudes_are_negative(bmkg_sample: dict[str, Any]) -> None:
    quakes, _ = bmkg.parse(bmkg_sample["Infogempa"]["gempa"])
    tanimbar = next(q for q in quakes if q.mag == 5.4 and q.depth_km == 84.0)
    assert tanimbar.lat == -8.02


def test_ids_are_stable_and_distinct(bmkg_sample: dict[str, Any]) -> None:
    rows = bmkg_sample["Infogempa"]["gempa"]
    first, _ = bmkg.parse(rows)
    second, _ = bmkg.parse(list(reversed(rows)))
    assert {q.id for q in first} == {q.id for q in second}
    assert len({q.id for q in first}) == 15
    assert first[0].id == "bmkg-20261115T154115-1.79_122.30"


@pytest.mark.parametrize(
    ("depth", "expected"),
    [("10 km", 10.0), ("  84 KM ", 84.0), ("12,5 km", 12.5), ("0 km", 0.0)],
)
def test_depth_formats(depth: str, expected: float) -> None:
    assert bmkg.parse_row(row(Kedalaman=depth)).depth_km == expected


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"Kedalaman": "deep"}, "bad_depth"),
        ({"Kedalaman": ""}, "bad_depth"),
        ({"DateTime": "yesterday"}, "bad_time"),
        ({"Coordinates": "1.79"}, "bad_number"),
        ({"Coordinates": "a,b"}, "bad_number"),
        ({"Magnitude": "strong"}, "bad_number"),
    ],
)
def test_rejects_bad_rows(changes: dict[str, str], reason: str) -> None:
    with pytest.raises(RowError) as caught:
        bmkg.parse_row(row(**changes))
    assert caught.value.reason == reason


def test_rejects_rows_missing_fields() -> None:
    for broken in ("text", {"Coordinates": "1,2"}, {"DateTime": "2026-11-15T00:00:00+00:00"}):
        with pytest.raises(RowError, match="malformed_row"):
            bmkg.parse_row(broken)
    incomplete = row()
    del incomplete["Magnitude"]
    with pytest.raises(RowError, match="bad_number"):
        bmkg.parse_row(incomplete)


def test_parse_keeps_good_rows_and_reports_bad_ones() -> None:
    quakes, rejects = bmkg.parse([row(), row(Magnitude="x")])
    assert len(quakes) == 1
    assert [r.reason for r in rejects] == ["bad_number"]
    assert rejects[0].source == "bmkg"


def test_a_missing_region_is_not_an_error() -> None:
    quake = bmkg.parse_row(row(Wilayah="  ", Potensi=""))
    assert quake.place is None
    assert quake.status is None


def fetcher_for(payload: Any) -> Fetcher:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    )
    return Fetcher(client, attempts=1, sleep=lambda _: None)


def test_fetch_returns_the_rows(settings: Settings, bmkg_sample: dict[str, Any]) -> None:
    assert len(bmkg.fetch(fetcher_for(bmkg_sample), settings)) == 15


@pytest.mark.parametrize("payload", [{}, {"Infogempa": {}}, {"Infogempa": {"gempa": "x"}}, []])
def test_fetch_refuses_an_unexpected_shape(settings: Settings, payload: Any) -> None:
    with pytest.raises(SourceError):
        bmkg.fetch(fetcher_for(payload), settings)
