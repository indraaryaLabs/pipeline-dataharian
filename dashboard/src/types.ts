/** The shape of data.json. Mirrors schema/data.schema.json at the repository root. */

export type RunStatus = 'running' | 'ok' | 'partial' | 'failed';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface Reading {
  id: string;
  t: number;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  place: string | null;
}

export interface Pair {
  bmkg: Reading;
  usgs: Reading;
  deltaSeconds: number;
  distanceKm: number;
  deltaMag: number;
}

export interface Run {
  id: number;
  startedAt: string;
  durationSeconds: number | null;
  mode: 'backfill' | 'incremental';
  status: RunStatus;
  usgs: { fetched: number; inserted: number; updated: number; removed: number };
  bmkg: { fetched: number; inserted: number };
  rejected: number;
  error: string | null;
}

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface Source {
  id: 'usgs' | 'bmkg';
  name: string;
  url: string;
  lastSuccessAt: string | null;
  latestEventAt: string | null;
}

export interface Crosscheck {
  eligible: number;
  matched: number;
  pending: number;
  medianDeltaMag: number | null;
  medianDistanceKm: number | null;
  medianDeltaSeconds: number | null;
  pairs: Pair[];
  unmatched: Reading[];
}

export interface DataDocument {
  schemaVersion: 1;
  generatedAt: string;
  pipelineVersion: string;
  region: { name: string; bbox: [number, number, number, number]; minMagnitude: number };
  window: { from: string; to: string; days: number };
  events: {
    columns: string[];
    rows: [string, number, number, number, number, number, string | null][];
  };
  daily: {
    from: string;
    bands: string[];
    counts: [number, number, number][];
    max: (number | null)[];
  };
  crosscheck: Crosscheck;
  pipeline: {
    runs: Run[];
    totals: { usgsEvents: number; bmkgEvents: number; rejectsRecent: number };
    rejects: { source: 'usgs' | 'bmkg'; reason: string; count: number }[];
    checks: Check[];
    sources: Source[];
  };
}

/** One decoded earthquake from `events.rows`. */
export interface Quake {
  id: string;
  t: number;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  place: string | null;
}

export type DepthClass = 'shallow' | 'mid' | 'deep';
