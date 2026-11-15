from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from dataharian.config import Settings
from dataharian.http import Fetcher, SourceError
from dataharian.models import RowError
from dataharian.sources import usgs


def test_windows_cover_the_range_without_gaps() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    end = start + timedelta(days=130)
    parts = list(usgs.windows(start, end, 60))
    assert parts[0][0] == start
    assert parts[-1][1] == end
    assert [b - a for a, b in parts] == [timedelta(days=60), timedelta(days=60), timedelta(days=10)]
    assert all(parts[i][1] == parts[i + 1][0] for i in range(len(parts) - 1))


def test_windows_of_an_empty_range_is_empty() -> None:
    moment = datetime(2026, 1, 1, tzinfo=UTC)
    assert list(usgs.windows(moment, moment, 60)) == []


def test_query_describes_the_region_and_threshold(settings: Settings) -> None:
    start = datetime(2026, 11, 1, 6, 30, tzinfo=UTC)
    query = usgs.params(settings, start, start + timedelta(days=1))
    assert query["starttime"] == "2026-11-01T06:30:00"
    assert query["endtime"] == "2026-11-02T06:30:00"
    assert query["minmagnitude"] == 4.0
    assert (query["minlatitude"], query["maxlatitude"]) == (-11.0, 6.0)
    assert (query["minlongitude"], query["maxlongitude"]) == (95.0, 141.0)
    assert query["eventtype"] == "earthquake"
    assert "updatedafter" not in query


def test_query_can_ask_only_for_recent_revisions(settings: Settings) -> None:
    moment = datetime(2026, 11, 1, tzinfo=UTC)
    query = usgs.params(settings, moment, moment + timedelta(days=1), moment)
    assert query["updatedafter"] == "2026-11-01T00:00:00"


def test_parses_real_features(usgs_sample: dict[str, Any]) -> None:
    quakes, rejects = usgs.parse(usgs_sample["features"])
    assert rejects == []
    first = next(q for q in quakes if q.id == "us7000tydm")
    assert first.source == "usgs"
    assert (first.lat, first.lon, first.depth_km, first.mag) == (-8.6791, 120.659, 10.0, 4.4)
    assert first.mag_type == "mb"
    assert first.place == "22 km ESE of Ruteng, Indonesia"
    assert first.status == "reviewed"
    assert first.time == datetime.fromtimestamp(1794734690, UTC)
    assert first.time.tzinfo is not None
    assert first.updated is not None and first.updated > first.time


def feature(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "us1",
        "properties": {"mag": 4.5, "time": 1_794_000_000_000, "type": "earthquake"},
        "geometry": {"coordinates": [120.0, -2.0, 10.0]},
    }
    for key, value in changes.items():
        if key in base["properties"] or key in ("place", "updated", "status"):
            base["properties"][key] = value
        else:
            base[key] = value
    return base


@pytest.mark.parametrize(
    ("row", "reason"),
    [
        ("not a dict", "malformed_feature"),
        ({"properties": {}, "geometry": {}}, "malformed_feature"),
        (feature(id=""), "malformed_feature"),
        (feature(geometry={"coordinates": [1, 2]}), "missing_coordinates"),
        (feature(geometry={"coordinates": "no"}), "missing_coordinates"),
        (feature(geometry={"coordinates": ["x", -2, 10]}), "missing_coordinates"),
        (feature(geometry={"coordinates": [120, -2, None]}), "missing_depth"),
        (feature(mag=None), "missing_magnitude"),
        (feature(mag="4.5"), "missing_magnitude"),
        (feature(mag=True), "missing_magnitude"),
        (feature(mag=float("nan")), "missing_magnitude"),
        (feature(time=None), "missing_time"),
        (feature(type="quarry blast"), "not_an_earthquake"),
    ],
)
def test_rejects_rows_with_a_named_reason(row: Any, reason: str) -> None:
    with pytest.raises(RowError) as caught:
        usgs.parse_feature(row)
    assert caught.value.reason == reason


def test_parse_separates_good_rows_from_rejects(usgs_sample: dict[str, Any]) -> None:
    rows = [*usgs_sample["features"], feature(mag=None, id="us-bad")]
    quakes, rejects = usgs.parse(rows)
    assert len(quakes) == 2
    assert [(r.source, r.raw_id, r.reason) for r in rejects] == [
        ("usgs", "us-bad", "missing_magnitude")
    ]
    assert "us-bad" in rejects[0].excerpt


def test_repeated_ids_keep_the_latest_revision() -> None:
    older = feature(updated=1_000)
    newer = copy.deepcopy(older)
    newer["properties"]["updated"] = 2_000
    newer["properties"]["mag"] = 5.1
    quakes, _ = usgs.parse([newer, older])
    assert [q.mag for q in quakes] == [5.1]


def test_missing_update_time_is_allowed() -> None:
    quake = usgs.parse_feature(feature())
    assert quake.updated is None


def client_with(payload: Any, status: int = 200) -> tuple[Fetcher, list[httpx.URL]]:
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        if payload is None:
            return httpx.Response(204)
        return httpx.Response(status, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return Fetcher(client, attempts=1, sleep=lambda _: None), seen


def test_fetch_requests_one_window_per_chunk(
    settings: Settings, usgs_sample: dict[str, Any]
) -> None:
    fetcher, seen = client_with(usgs_sample)
    end = datetime(2026, 11, 15, tzinfo=UTC)
    rows = usgs.fetch(fetcher, settings, end - timedelta(days=130), end)
    assert len(seen) == 3
    assert len(rows) == 6


def test_fetch_treats_no_content_as_no_events(settings: Settings) -> None:
    fetcher, _ = client_with(None)
    end = datetime(2026, 11, 15, tzinfo=UTC)
    assert usgs.fetch(fetcher, settings, end - timedelta(days=1), end) == []


def test_fetch_refuses_an_unexpected_shape(settings: Settings) -> None:
    fetcher, _ = client_with({"unexpected": 1})
    end = datetime(2026, 11, 15, tzinfo=UTC)
    with pytest.raises(SourceError, match="list of features"):
        usgs.fetch(fetcher, settings, end - timedelta(days=1), end)


def test_fetch_refuses_a_window_that_hit_the_row_limit(settings: Settings) -> None:
    fetcher, _ = client_with({"features": [{}] * usgs.LIMIT})
    end = datetime(2026, 11, 15, tzinfo=UTC)
    with pytest.raises(SourceError, match="row limit"):
        usgs.fetch(fetcher, settings, end - timedelta(days=1), end)
