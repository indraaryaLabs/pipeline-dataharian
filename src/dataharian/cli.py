"""Command line entry point: `dataharian run | check | export | demo`."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import httpx

from . import aggregate, demo, export, pipeline, quality
from .config import USER_AGENT, Settings
from .http import Fetcher
from .models import parse_iso
from .store import Store

log = logging.getLogger("dataharian")


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr, force=True
    )
    if not hasattr(args, "handler"):
        parser.print_help()
        return 2
    return int(args.handler(args))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dataharian", description=__doc__)
    commands = parser.add_subparsers(dest="command")

    def common(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--db", type=Path, default=Path("data/warehouse.db"))
        sub.add_argument(
            "--now", type=_moment, default=None, help="ISO time to use instead of the clock"
        )

    run = commands.add_parser("run", help="fetch, load, check and export")
    common(run)
    run.add_argument("--out", type=Path, default=Path("out/data.json"))
    run.add_argument("--mode", choices=["auto", "backfill", "incremental"], default="auto")
    run.set_defaults(handler=_run)

    chk = commands.add_parser("check", help="run the data-quality checks on a warehouse")
    common(chk)
    chk.set_defaults(handler=_check)

    exp = commands.add_parser("export", help="write the public JSON from a warehouse")
    common(exp)
    exp.add_argument("--out", type=Path, default=Path("out/data.json"))
    exp.set_defaults(handler=_export)

    dem = commands.add_parser("demo", help="write synthetic fixture data for development")
    dem.add_argument("--scenario", choices=demo.SCENARIOS, default="normal")
    dem.add_argument("--out", type=Path, required=True)
    dem.add_argument("--now", type=_moment, default=None)
    dem.set_defaults(handler=_demo)
    return parser


def _moment(text: str) -> datetime:
    try:
        return parse_iso(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not an ISO 8601 time: {text!r}") from None


def _now(args: argparse.Namespace) -> datetime:
    return args.now or datetime.now(UTC).replace(microsecond=0)


def _run(args: argparse.Namespace) -> int:
    settings = Settings()
    now = _now(args)
    with (
        httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=settings.http_timeout_s,
            follow_redirects=True,
        ) as client,
        Store(args.db) as store,
    ):
        fetcher = Fetcher(
            client, attempts=settings.http_attempts, backoff_s=settings.http_backoff_s
        )
        report = pipeline.run(store, settings, fetcher, now=now, mode=args.mode)
        size = export.write(aggregate.build_document(store, settings, now), args.out)
        store.compact()
    _print(report, size, args.out)
    return report.exit_code


def _check(args: argparse.Namespace) -> int:
    settings = Settings()
    with Store(args.db) as store:
        checks = quality.run_checks(store, settings, _now(args))
    for item in checks:
        print(f"{item.status.upper():5} {item.name:20} {item.detail}")
    return 1 if quality.worst(checks) == "fail" else 0


def _export(args: argparse.Namespace) -> int:
    settings = Settings()
    now = _now(args)
    with Store(args.db) as store:
        size = export.write(aggregate.build_document(store, settings, now), args.out)
    print(f"wrote {args.out} ({size:,} bytes)")
    return 0


def _demo(args: argparse.Namespace) -> int:
    now = args.now or datetime.now(UTC).replace(microsecond=0)
    with tempfile.TemporaryDirectory() as work:
        size = demo.write_fixture(args.scenario, now, args.out, Path(work))
    print(f"wrote {args.out} ({size:,} bytes, synthetic {args.scenario} data)")
    return 0


def _print(report: pipeline.RunReport, size: int, out: Path) -> None:
    lines = [
        f"run {report.run_id} ({report.mode}): {report.status}",
        f"  USGS  fetched {report.usgs_fetched:>5}  new {report.usgs.inserted:>4}  "
        f"revised {report.usgs.updated:>4}  removed {report.usgs_removed:>3}",
        f"  BMKG  fetched {report.bmkg_fetched:>5}  new {report.bmkg.inserted:>4}",
        f"  rejected rows: {report.rejected}",
    ]
    if report.error:
        lines.append(f"  problem: {report.error}")
    lines.append("  checks:")
    lines += [f"    {c.status.upper():5} {c.name:20} {c.detail}" for c in report.checks]
    lines.append(f"  wrote {out} ({size:,} bytes)")
    text = "\n".join(lines)
    print(text)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("### Pipeline run\n\n```\n" + text + "\n```\n")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
