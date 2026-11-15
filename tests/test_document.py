from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from dataharian import aggregate, demo, export
from dataharian.config import Settings
from dataharian.store import Store

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "schema" / "data.schema.json").read_text(encoding="utf-8"))
FIXTURES = ROOT / "dashboard" / "fixtures"
FIXTURE_NOW = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


def validate(document: dict[str, Any]) -> None:
    jsonschema.Draft202012Validator(SCHEMA).validate(document)


@pytest.fixture(scope="module")
def documents(tmp_path_factory: pytest.TempPathFactory) -> dict[str, dict[str, Any]]:
    work = tmp_path_factory.mktemp("scenarios")
    return {name: demo.make_document(name, FIXTURE_NOW, work) for name in demo.SCENARIOS}


@pytest.fixture(params=demo.SCENARIOS)
def scenario_document(
    request: pytest.FixtureRequest, documents: dict[str, dict[str, Any]]
) -> tuple[str, dict[str, Any]]:
    return request.param, documents[request.param]


def test_every_scenario_matches_the_published_schema(
    scenario_document: tuple[str, dict[str, Any]],
) -> None:
    validate(scenario_document[1])


def test_the_schema_rejects_a_changed_shape(scenario_document: tuple[str, dict[str, Any]]) -> None:
    broken = json.loads(json.dumps(scenario_document[1]))
    broken["pipeline"]["runs"][0]["status"] = "great"
    with pytest.raises(jsonschema.ValidationError):
        validate(broken)
    del broken["events"]
    with pytest.raises(jsonschema.ValidationError):
        validate(broken)


def test_committed_fixtures_are_what_the_code_produces_today(
    scenario_document: tuple[str, dict[str, Any]],
) -> None:
    name, document = scenario_document
    committed = (FIXTURES / f"{name}.json").read_text(encoding="utf-8")
    assert committed == export.dumps(document), (
        f"dashboard/fixtures/{name}.json is out of date; run `make fixtures`"
    )


def test_daily_series_line_up_with_the_window(
    scenario_document: tuple[str, dict[str, Any]],
) -> None:
    _, document = scenario_document
    daily = document["daily"]
    days = (
        datetime.fromisoformat(document["window"]["to"]) - datetime.fromisoformat(daily["from"])
    ).days + 1
    assert len(daily["counts"]) == len(daily["max"]) == days
    assert daily["from"] == document["window"]["from"]


def test_daily_counts_add_up_to_the_events(scenario_document: tuple[str, dict[str, Any]]) -> None:
    _, document = scenario_document
    total = sum(sum(day) for day in document["daily"]["counts"])
    assert total == len(document["events"]["rows"])


def test_daily_maximum_is_the_strongest_event_of_that_day(
    scenario_document: tuple[str, dict[str, Any]],
) -> None:
    _, document = scenario_document
    first = datetime.fromisoformat(document["daily"]["from"]).date()
    strongest: dict[int, float] = {}
    for _, stamp, _, _, _, mag, _ in document["events"]["rows"]:
        index = (datetime.fromtimestamp(stamp, UTC).date() - first).days
        strongest[index] = max(strongest.get(index, 0), mag)
    expected = [strongest.get(i) for i in range(len(document["daily"]["max"]))]
    assert document["daily"]["max"] == expected


def test_events_are_in_time_order_with_unique_ids(
    scenario_document: tuple[str, dict[str, Any]],
) -> None:
    _, document = scenario_document
    rows = document["events"]["rows"]
    assert [r[1] for r in rows] == sorted(r[1] for r in rows)
    assert len({r[0] for r in rows}) == len(rows)


def test_crosscheck_numbers_are_consistent(scenario_document: tuple[str, dict[str, Any]]) -> None:
    _, document = scenario_document
    check = document["crosscheck"]
    assert check["matched"] + len(check["unmatched"]) == check["eligible"]
    assert len(check["pairs"]) >= check["matched"]


def test_the_normal_scenario_tells_a_realistic_story(documents: dict[str, dict[str, Any]]) -> None:
    document = documents["normal"]
    pipeline = document["pipeline"]
    assert pipeline["runs"][0]["status"] == "ok"
    assert pipeline["rejects"] == [{"source": "usgs", "reason": "missing_magnitude", "count": 1}]
    assert 250 < len(document["events"]["rows"]) < 400
    assert document["crosscheck"]["matched"] > 5
    assert document["crosscheck"]["unmatched"], "some BMKG reports have no USGS twin"


def test_a_partial_run_names_the_source_that_failed(documents: dict[str, dict[str, Any]]) -> None:
    run = documents["partial"]["pipeline"]["runs"][0]
    assert run["status"] == "partial" and "BMKG" in run["error"]


def test_a_failed_run_still_publishes_the_last_good_data(
    documents: dict[str, dict[str, Any]],
) -> None:
    document = documents["failed"]
    assert [r["status"] for r in document["pipeline"]["runs"][:2]] == ["failed", "failed"]
    assert document["events"]["rows"]


def test_an_empty_warehouse_after_a_failed_first_run(documents: dict[str, dict[str, Any]]) -> None:
    document = documents["empty"]
    assert document["events"]["rows"] == []
    assert document["pipeline"]["runs"][0]["status"] == "failed"
    assert set(document["daily"]["max"]) == {None}


def test_building_twice_gives_identical_bytes(tmp_path: Path) -> None:
    first = export.dumps(demo.make_document("normal", FIXTURE_NOW, tmp_path))
    second = export.dumps(demo.make_document("normal", FIXTURE_NOW, tmp_path))
    assert first == second


def test_export_writes_and_reports_the_size(tmp_path: Path) -> None:
    settings = Settings()
    with Store(":memory:") as store:
        document = aggregate.build_document(store, settings, FIXTURE_NOW)
    out = tmp_path / "deep" / "data.json"
    size = export.write(document, out)
    assert size == out.stat().st_size
    assert json.loads(out.read_text(encoding="utf-8")) == document
    validate(document)


def test_an_empty_warehouse_still_produces_a_valid_document() -> None:
    with Store(":memory:") as store:
        document = aggregate.build_document(store, Settings(), FIXTURE_NOW)
    validate(document)
    assert document["events"]["rows"] == []
    assert document["pipeline"]["runs"] == []
    assert document["pipeline"]["sources"][0]["lastSuccessAt"] is None
