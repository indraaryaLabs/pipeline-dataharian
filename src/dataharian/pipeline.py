"""One pipeline run: fetch, validate, load, reconcile, check."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal

from . import quality, reconcile
from .config import Settings
from .http import Fetcher, SourceError
from .models import Quake, Reject
from .sources import bmkg, usgs
from .store import Store, UpsertResult
from .validate import check

log = logging.getLogger("dataharian")

Mode = Literal["auto", "backfill", "incremental"]

# A full refresh may only delete events that vanished upstream when that is plausible.
MAX_REMOVED_SHARE = 0.2


@dataclass(slots=True)
class RunReport:
    run_id: int
    mode: str
    status: str
    usgs_fetched: int = 0
    usgs: UpsertResult = field(default_factory=UpsertResult)
    usgs_removed: int = 0
    bmkg_fetched: int = 0
    bmkg: UpsertResult = field(default_factory=UpsertResult)
    rejected: int = 0
    error: str | None = None
    checks: list[quality.Check] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        failed = self.status == "failed" or quality.worst(self.checks) == "fail"
        return 1 if failed else 0


def resolve_mode(store: Store, requested: Mode) -> Literal["backfill", "incremental"]:
    """Incremental needs a previous complete run to measure "since when" from."""
    if requested == "backfill":
        return "backfill"
    if store.count("usgs") == 0 or store.last_complete_run() is None:
        return "backfill"
    return "incremental"


def run(
    store: Store,
    settings: Settings,
    fetcher: Fetcher,
    *,
    now: datetime,
    mode: Mode = "auto",
    monotonic: Callable[[], float] = time.monotonic,
) -> RunReport:
    """Run once. `now` is the logical start time; `monotonic` measures how long the run took."""
    resolved = resolve_mode(store, mode)
    updated_after: datetime | None = None
    if resolved == "incremental":
        previous = store.last_complete_run()
        assert previous is not None
        updated_after = previous.started - timedelta(hours=settings.overlap_hours)

    started = monotonic()
    run_id = store.start_run(resolved, now)

    def finished() -> datetime:
        return now + timedelta(seconds=monotonic() - started)

    report = RunReport(run_id=run_id, mode=resolved, status="ok")
    rejects: list[Reject] = []
    problems: list[str] = []
    window_start = now - timedelta(days=settings.retention_days)

    try:
        _load_usgs(
            store, settings, fetcher, now, window_start, updated_after, resolved, report, rejects
        )
    except SourceError as error:
        log.error("USGS: %s", error)
        report.status = "failed"
        problems.append(f"USGS: {error}")
    except Exception as error:
        store.finish_run(run_id, now=finished(), status="failed", error=f"unexpected: {error!r}")
        raise

    try:
        _load_bmkg(store, settings, fetcher, now, report, rejects)
    except SourceError as error:
        log.warning("BMKG: %s", error)
        if report.status == "ok":
            report.status = "partial"
        problems.append(f"BMKG: {error}")

    if rejects:
        store.add_rejects(run_id, rejects)
    report.rejected = len(rejects)
    report.error = "; ".join(problems) or None

    store.delete_older_than(window_start)
    store.replace_matches(
        reconcile.match(store.quakes("usgs", window_start), store.quakes("bmkg", window_start))
    )
    store.finish_run(
        run_id,
        now=finished(),
        status=report.status,
        usgs_fetched=report.usgs_fetched,
        usgs=report.usgs,
        usgs_removed=report.usgs_removed,
        bmkg_fetched=report.bmkg_fetched,
        bmkg=report.bmkg,
        rejected=report.rejected,
        error=report.error,
    )
    report.checks = quality.run_checks(store, settings, now)
    return report


def _accept(
    quakes: list[Quake], settings: Settings, now: datetime, rejects: list[Reject]
) -> list[Quake]:
    kept: list[Quake] = []
    for quake in quakes:
        reason = check(quake, now=now, bbox=settings.bbox)
        if reason is None:
            kept.append(quake)
        else:
            rejects.append(Reject(quake.source, quake.id, reason, repr(quake)[:240]))
    return kept


def _load_usgs(
    store: Store,
    settings: Settings,
    fetcher: Fetcher,
    now: datetime,
    window_start: datetime,
    updated_after: datetime | None,
    mode: str,
    report: RunReport,
    rejects: list[Reject],
) -> None:
    features = usgs.fetch(fetcher, settings, window_start, now, updated_after)
    report.usgs_fetched = len(features)
    parsed, bad = usgs.parse(features)
    rejects.extend(bad)
    quakes = _accept(parsed, settings, now, rejects)
    log.info("USGS: %d rows, %d accepted", len(features), len(quakes))

    if mode == "backfill":
        existing = store.count("usgs")
        if not quakes and existing:
            raise SourceError("a full refresh returned no events; keeping the stored ones")
        keep = {q.id for q in quakes}
        stale = [q for q in store.quakes("usgs", window_start) if q.id not in keep]
        if existing and len(stale) > MAX_REMOVED_SHARE * existing:
            raise SourceError(
                f"a full refresh would delete {len(stale)} of {existing} events; keeping them"
            )
        report.usgs = store.upsert(quakes, now)
        report.usgs_removed = store.remove_missing("usgs", window_start, now, keep)
    else:
        report.usgs = store.upsert(quakes, now)


def _load_bmkg(
    store: Store,
    settings: Settings,
    fetcher: Fetcher,
    now: datetime,
    report: RunReport,
    rejects: list[Reject],
) -> None:
    rows = bmkg.fetch(fetcher, settings)
    report.bmkg_fetched = len(rows)
    parsed, bad = bmkg.parse(rows)
    rejects.extend(bad)
    quakes = _accept(parsed, settings, now, rejects)
    report.bmkg = store.upsert(quakes, now)
    log.info("BMKG: %d rows, %d accepted", len(rows), len(quakes))
