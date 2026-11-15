from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from dataharian.config import Settings
from dataharian.models import Quake
from dataharian.store import Store

DATA = Path(__file__).parent / "data"
NOW = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


@pytest.fixture
def now() -> datetime:
    return NOW


@pytest.fixture
def settings() -> Settings:
    return Settings()


@pytest.fixture
def store() -> Iterator[Store]:
    with Store(":memory:") as db:
        yield db


@pytest.fixture
def usgs_sample() -> dict[str, Any]:
    sample: dict[str, Any] = json.loads((DATA / "usgs_sample.json").read_text(encoding="utf-8"))
    return sample


@pytest.fixture
def bmkg_sample() -> dict[str, Any]:
    sample: dict[str, Any] = json.loads((DATA / "bmkg_sample.json").read_text(encoding="utf-8"))
    return sample


def make_quake(**overrides: Any) -> Quake:
    fields: dict[str, Any] = {
        "id": "us0001",
        "source": "usgs",
        "time": datetime(2026, 11, 14, 12, 0, tzinfo=UTC),
        "lat": -2.0,
        "lon": 120.0,
        "depth_km": 30.0,
        "mag": 4.6,
        "mag_type": "mb",
        "place": "10 km N of Somewhere, Indonesia",
        "status": "reviewed",
        "updated": datetime(2026, 11, 14, 12, 30, tzinfo=UTC),
        "url": "https://example.invalid/e/1",
    }
    fields.update(overrides)
    return Quake(**fields)
