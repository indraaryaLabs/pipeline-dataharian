from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from dataharian import cli, demo
from dataharian.config import Settings
from dataharian.store import Store

NOW = "2026-11-15T09:00:00Z"


@pytest.fixture
def upstream_client(monkeypatch: pytest.MonkeyPatch) -> demo.Upstream:
    when = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
    events, bmkg = demo.synthesize(5, when - timedelta(days=400), when)
    up = demo.Upstream(events, bmkg, Settings())
    up.now = when
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda **_: real_client(transport=httpx.MockTransport(up._handle))
    )
    monkeypatch.setattr("time.sleep", lambda _: None)
    return up


def test_no_command_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main([]) == 2
    assert "usage: dataharian" in capsys.readouterr().out


def test_run_loads_exports_and_reports(
    upstream_client: demo.Upstream, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    db, out = tmp_path / "w.db", tmp_path / "out" / "data.json"
    code = cli.main(["run", "--db", str(db), "--out", str(out), "--now", NOW])
    text = capsys.readouterr().out
    assert code == 0
    assert "run 1 (backfill): ok" in text
    assert "checks:" in text and "PASS" in text
    document = json.loads(out.read_text(encoding="utf-8"))
    assert document["generatedAt"] == NOW
    with Store(db) as store:
        assert store.count("usgs") == len(document["events"]["rows"]) > 100


def test_a_failing_source_gives_a_nonzero_exit_and_still_writes_the_page_data(
    upstream_client: demo.Upstream, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    upstream_client.usgs_down = True
    out = tmp_path / "data.json"
    code = cli.main(["run", "--db", str(tmp_path / "w.db"), "--out", str(out), "--now", NOW])
    assert code == 1
    assert "problem: USGS" in capsys.readouterr().out
    assert json.loads(out.read_text(encoding="utf-8"))["pipeline"]["runs"][0]["status"] == "failed"


def test_the_step_summary_is_written_when_github_provides_one(
    upstream_client: demo.Upstream, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    cli.main(
        ["run", "--db", str(tmp_path / "w.db"), "--out", str(tmp_path / "d.json"), "--now", NOW]
    )
    assert summary.read_text(encoding="utf-8").startswith("### Pipeline run")


def test_check_passes_on_a_healthy_warehouse_and_fails_on_an_empty_one(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    healthy = tmp_path / "healthy.db"
    demo.build("normal", datetime(2026, 11, 15, 9, 0, tzinfo=UTC), healthy)
    assert cli.main(["check", "--db", str(healthy), "--now", NOW]) == 0
    assert "PASS  catalogue_present" in capsys.readouterr().out
    assert cli.main(["check", "--db", str(tmp_path / "new.db"), "--now", NOW]) == 1


def test_export_writes_the_document(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    db = tmp_path / "w.db"
    demo.build("normal", datetime(2026, 11, 15, 9, 0, tzinfo=UTC), db)
    out = tmp_path / "data.json"
    assert cli.main(["export", "--db", str(db), "--out", str(out), "--now", NOW]) == 0
    assert out.exists()
    assert "wrote" in capsys.readouterr().out


def test_demo_writes_a_fixture(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "f.json"
    assert cli.main(["demo", "--scenario", "partial", "--out", str(out), "--now", NOW]) == 0
    assert "synthetic partial data" in capsys.readouterr().out
    assert json.loads(out.read_text(encoding="utf-8"))["pipeline"]["runs"][0]["status"] == "partial"


def test_a_bad_time_is_a_usage_error(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as caught:
        cli.main(["check", "--now", "tomorrow"])
    assert caught.value.code == 2
    assert "not an ISO 8601 time" in capsys.readouterr().err


def test_the_default_clock_is_used_without_now(
    upstream_client: demo.Upstream, tmp_path: Path
) -> None:
    upstream_client.now = datetime.now(UTC) + timedelta(days=1)
    out = tmp_path / "d.json"
    assert cli.main(["run", "--db", str(tmp_path / "w.db"), "--out", str(out)]) in (0, 1)
    stamp = json.loads(out.read_text(encoding="utf-8"))["generatedAt"]
    assert (
        abs(
            (
                datetime.now(UTC) - datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            ).total_seconds()
        )
        < 60
    )


def test_the_real_client_is_configured_with_a_user_agent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen: dict[str, Any] = {}

    real_client = httpx.Client

    def factory(**kwargs: Any) -> httpx.Client:
        seen.update(kwargs)
        return real_client(transport=httpx.MockTransport(lambda _: httpx.Response(503)))

    monkeypatch.setattr(httpx, "Client", factory)
    monkeypatch.setattr("time.sleep", lambda _: None)
    cli.main(
        ["run", "--db", str(tmp_path / "w.db"), "--out", str(tmp_path / "d.json"), "--now", NOW]
    )
    assert seen["headers"]["User-Agent"].startswith("dataharian/")
    assert seen["follow_redirects"] is True
    assert seen["timeout"] == Settings().http_timeout_s
