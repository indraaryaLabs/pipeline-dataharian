"""Settings shared by every stage of the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field

USER_AGENT = "dataharian/1.0 (+https://github.com/indraaryaLabs/pipeline-dataharian)"


@dataclass(frozen=True, slots=True)
class BBox:
    """A latitude/longitude rectangle in decimal degrees."""

    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.min_lat <= lat <= self.max_lat and self.min_lon <= lon <= self.max_lon


@dataclass(frozen=True, slots=True)
class Settings:
    """Pipeline settings. Defaults describe the production configuration."""

    region_name: str = "Indonesia and surroundings"
    bbox: BBox = field(default_factory=lambda: BBox(-11.0, 6.0, 95.0, 141.0))
    usgs_min_magnitude: float = 4.0
    retention_days: int = 365
    # How far before the previous run an incremental fetch looks for revised events.
    overlap_hours: int = 6
    chunk_days: int = 60
    http_timeout_s: float = 30.0
    http_attempts: int = 3
    http_backoff_s: float = 1.0
    usgs_url: str = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    bmkg_url: str = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"
