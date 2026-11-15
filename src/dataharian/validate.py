"""Row-level validation shared by every source."""

from __future__ import annotations

from datetime import datetime, timedelta

from .config import BBox
from .models import Quake

MAX_CLOCK_SKEW = timedelta(minutes=10)


def check(quake: Quake, *, now: datetime, bbox: BBox) -> str | None:
    """Return the reason a quake must be rejected, or None when it is acceptable."""
    if not -90.0 <= quake.lat <= 90.0 or not -180.0 <= quake.lon <= 180.0:
        return "coordinates_out_of_range"
    if not bbox.contains(quake.lat, quake.lon):
        return "outside_region"
    if not 0.0 <= quake.mag <= 10.0:
        return "magnitude_out_of_range"
    if not -5.0 <= quake.depth_km <= 800.0:
        return "depth_out_of_range"
    if quake.time > now + MAX_CLOCK_SKEW:
        return "time_in_future"
    return None
