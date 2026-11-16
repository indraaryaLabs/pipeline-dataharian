"""SQLite warehouse: events, run history, rejected rows and cross-agency matches."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .models import Quake, Reject, Source, iso, parse_iso

SCHEMA_VERSION = 1

_DDL = """
CREATE TABLE quakes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('usgs', 'bmkg')),
  time_utc TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  depth_km REAL NOT NULL,
  mag REAL NOT NULL,
  mag_type TEXT,
  place TEXT,
  status TEXT,
  updated_utc TEXT,
  url TEXT,
  first_seen_utc TEXT NOT NULL,
  last_changed_utc TEXT NOT NULL
);
CREATE INDEX quakes_source_time ON quakes (source, time_utc);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_utc TEXT NOT NULL,
  finished_utc TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  usgs_fetched INTEGER NOT NULL DEFAULT 0,
  usgs_inserted INTEGER NOT NULL DEFAULT 0,
  usgs_updated INTEGER NOT NULL DEFAULT 0,
  usgs_removed INTEGER NOT NULL DEFAULT 0,
  bmkg_fetched INTEGER NOT NULL DEFAULT 0,
  bmkg_inserted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE rejects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raw_id TEXT,
  reason TEXT NOT NULL,
  excerpt TEXT NOT NULL
);

CREATE TABLE matches (
  bmkg_id TEXT PRIMARY KEY REFERENCES quakes (id) ON DELETE CASCADE,
  usgs_id TEXT NOT NULL REFERENCES quakes (id) ON DELETE CASCADE,
  dt_s REAL NOT NULL,
  dist_km REAL NOT NULL,
  dmag REAL NOT NULL
);
"""

KEEP_RUNS = 200


@dataclass(frozen=True, slots=True)
class UpsertResult:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0


@dataclass(frozen=True, slots=True)
class RunRow:
    id: int
    started: datetime
    finished: datetime | None
    mode: str
    status: str
    usgs_fetched: int
    usgs_inserted: int
    usgs_updated: int
    usgs_removed: int
    bmkg_fetched: int
    bmkg_inserted: int
    rejected: int
    error: str | None


@dataclass(frozen=True, slots=True)
class MatchRow:
    bmkg_id: str
    usgs_id: str
    dt_s: float
    dist_km: float
    dmag: float


class Store:
    """Thin wrapper around one SQLite file. Use as a context manager."""

    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        try:
            self._migrate()
        except BaseException:
            self._db.close()
            raise

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._db.close()

    # -- schema ---------------------------------------------------------------------------

    def _migrate(self) -> None:
        version = int(self._db.execute("PRAGMA user_version").fetchone()[0])
        if version == SCHEMA_VERSION:
            return
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"database schema {version} is newer than this code supports ({SCHEMA_VERSION})"
            )
        self._db.executescript("BEGIN;" + _DDL + f"PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;")

    # -- events ---------------------------------------------------------------------------

    def upsert(self, quakes: Iterable[Quake], now: datetime) -> UpsertResult:
        """Insert new events and update changed ones. Re-running with the same input is a no-op."""
        inserted = updated = unchanged = 0
        stamp = iso(now)
        self._db.execute("BEGIN")
        try:
            for quake in quakes:
                row = self._db.execute("SELECT * FROM quakes WHERE id = ?", (quake.id,)).fetchone()
                values = _values(quake)
                if row is None:
                    self._db.execute(
                        "INSERT INTO quakes (id, source, time_utc, lat, lon, depth_km, mag, "
                        "mag_type, place, status, updated_utc, url, first_seen_utc, "
                        "last_changed_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (*values, stamp, stamp),
                    )
                    inserted += 1
                elif _row_values(row) != values:
                    self._db.execute(
                        "UPDATE quakes SET source = ?, time_utc = ?, lat = ?, lon = ?, "
                        "depth_km = ?, mag = ?, mag_type = ?, place = ?, status = ?, "
                        "updated_utc = ?, url = ?, last_changed_utc = ? WHERE id = ?",
                        (*values[1:], stamp, quake.id),
                    )
                    updated += 1
                else:
                    unchanged += 1
            self._db.execute("COMMIT")
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        return UpsertResult(inserted, updated, unchanged)

    def remove_missing(
        self, source: Source, start: datetime, end: datetime, keep_ids: set[str]
    ) -> int:
        """Delete events of `source` inside [start, end) that a complete fetch did not return."""
        rows = self._db.execute(
            "SELECT id FROM quakes WHERE source = ? AND time_utc >= ? AND time_utc < ?",
            (source, iso(start), iso(end)),
        ).fetchall()
        gone = [row["id"] for row in rows if row["id"] not in keep_ids]
        for event_id in gone:
            self._db.execute("DELETE FROM quakes WHERE id = ?", (event_id,))
        return len(gone)

    def delete_older_than(self, cutoff: datetime) -> int:
        cursor = self._db.execute("DELETE FROM quakes WHERE time_utc < ?", (iso(cutoff),))
        return cursor.rowcount

    def quakes(self, source: Source | None = None, since: datetime | None = None) -> list[Quake]:
        sql = "SELECT * FROM quakes WHERE 1 = 1"
        args: list[str] = []
        if source is not None:
            sql += " AND source = ?"
            args.append(source)
        if since is not None:
            sql += " AND time_utc >= ?"
            args.append(iso(since))
        sql += " ORDER BY time_utc, id"
        return [_quake(row) for row in self._db.execute(sql, args)]

    def count(self, source: Source) -> int:
        row = self._db.execute("SELECT COUNT(*) AS n FROM quakes WHERE source = ?", (source,))
        return int(row.fetchone()["n"])

    def latest_event_time(self, source: Source) -> datetime | None:
        row = self._db.execute(
            "SELECT MAX(time_utc) AS t FROM quakes WHERE source = ?", (source,)
        ).fetchone()
        return parse_iso(row["t"]) if row["t"] else None

    # -- runs -----------------------------------------------------------------------------

    def start_run(self, mode: str, now: datetime) -> int:
        cursor = self._db.execute(
            "INSERT INTO runs (started_utc, mode, status) VALUES (?, ?, 'running')",
            (iso(now), mode),
        )
        assert cursor.lastrowid is not None
        return cursor.lastrowid

    def finish_run(
        self,
        run_id: int,
        *,
        now: datetime,
        status: str,
        usgs_fetched: int = 0,
        usgs: UpsertResult = UpsertResult(),
        usgs_removed: int = 0,
        bmkg_fetched: int = 0,
        bmkg: UpsertResult = UpsertResult(),
        rejected: int = 0,
        error: str | None = None,
    ) -> None:
        self._db.execute(
            "UPDATE runs SET finished_utc = ?, status = ?, usgs_fetched = ?, usgs_inserted = ?, "
            "usgs_updated = ?, usgs_removed = ?, bmkg_fetched = ?, bmkg_inserted = ?, "
            "rejected = ?, error = ? WHERE id = ?",
            (
                iso(now),
                status,
                usgs_fetched,
                usgs.inserted,
                usgs.updated,
                usgs_removed,
                bmkg_fetched,
                bmkg.inserted,
                rejected,
                error,
                run_id,
            ),
        )
        self._db.execute(
            "DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT ?)",
            (KEEP_RUNS,),
        )

    def runs(self, limit: int = 14) -> list[RunRow]:
        rows = self._db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,))
        return [_run(row) for row in rows]

    def last_complete_run(self) -> RunRow | None:
        """The latest run whose USGS fetch worked (ok or partial)."""
        row = self._db.execute(
            "SELECT * FROM runs WHERE status IN ('ok', 'partial') ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return _run(row) if row else None

    def add_rejects(self, run_id: int, rejects: Sequence[Reject]) -> None:
        self._db.executemany(
            "INSERT INTO rejects (run_id, source, raw_id, reason, excerpt) VALUES (?, ?, ?, ?, ?)",
            [(run_id, r.source, r.raw_id, r.reason, r.excerpt) for r in rejects],
        )

    def reject_count(self, run_id: int, source: Source, reason: str) -> int:
        row = self._db.execute(
            "SELECT COUNT(*) AS n FROM rejects WHERE run_id = ? AND source = ? AND reason = ?",
            (run_id, source, reason),
        ).fetchone()
        return int(row["n"])

    def reject_reasons(self, last_runs: int = 30) -> list[tuple[str, str, int]]:
        rows = self._db.execute(
            "SELECT source, reason, COUNT(*) AS n FROM rejects WHERE run_id IN "
            "(SELECT id FROM runs ORDER BY id DESC LIMIT ?) GROUP BY source, reason "
            "ORDER BY n DESC, source, reason",
            (last_runs,),
        )
        return [(row["source"], row["reason"], int(row["n"])) for row in rows]

    # -- matches --------------------------------------------------------------------------

    def replace_matches(self, matches: Iterable[MatchRow]) -> None:
        self._db.execute("BEGIN")
        self._db.execute("DELETE FROM matches")
        self._db.executemany(
            "INSERT INTO matches (bmkg_id, usgs_id, dt_s, dist_km, dmag) VALUES (?, ?, ?, ?, ?)",
            [(m.bmkg_id, m.usgs_id, m.dt_s, m.dist_km, m.dmag) for m in matches],
        )
        self._db.execute("COMMIT")

    def matches(self) -> list[MatchRow]:
        rows = self._db.execute("SELECT * FROM matches ORDER BY bmkg_id")
        return [
            MatchRow(r["bmkg_id"], r["usgs_id"], r["dt_s"], r["dist_km"], r["dmag"]) for r in rows
        ]

    def compact(self) -> None:
        self._db.execute("VACUUM")


def _values(q: Quake) -> tuple[object, ...]:
    return (
        q.id,
        q.source,
        iso(q.time),
        q.lat,
        q.lon,
        q.depth_km,
        q.mag,
        q.mag_type,
        q.place,
        q.status,
        iso(q.updated) if q.updated else None,
        q.url,
    )


def _row_values(row: sqlite3.Row) -> tuple[object, ...]:
    return tuple(
        row[key]
        for key in (
            "id",
            "source",
            "time_utc",
            "lat",
            "lon",
            "depth_km",
            "mag",
            "mag_type",
            "place",
            "status",
            "updated_utc",
            "url",
        )
    )


def _quake(row: sqlite3.Row) -> Quake:
    return Quake(
        id=row["id"],
        source=row["source"],
        time=parse_iso(row["time_utc"]),
        lat=row["lat"],
        lon=row["lon"],
        depth_km=row["depth_km"],
        mag=row["mag"],
        mag_type=row["mag_type"],
        place=row["place"],
        status=row["status"],
        updated=parse_iso(row["updated_utc"]) if row["updated_utc"] else None,
        url=row["url"],
    )


def _run(row: sqlite3.Row) -> RunRow:
    return RunRow(
        id=row["id"],
        started=parse_iso(row["started_utc"]),
        finished=parse_iso(row["finished_utc"]) if row["finished_utc"] else None,
        mode=row["mode"],
        status=row["status"],
        usgs_fetched=row["usgs_fetched"],
        usgs_inserted=row["usgs_inserted"],
        usgs_updated=row["usgs_updated"],
        usgs_removed=row["usgs_removed"],
        bmkg_fetched=row["bmkg_fetched"],
        bmkg_inserted=row["bmkg_inserted"],
        rejected=row["rejected"],
        error=row["error"],
    )
