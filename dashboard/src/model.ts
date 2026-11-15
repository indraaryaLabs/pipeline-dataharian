/** Pure data logic: decoding, filtering, summarising and shaping for each chart. */
import type { DataDocument, DepthClass, Quake } from './types.ts';

export const DAY = 86_400;
export const SHALLOW_KM = 70;
export const DEEP_KM = 300;
/** Below this magnitude the catalogue is not complete everywhere, so b-values start here. */
export const COMPLETENESS_MAG = 4.5;
/** Older than this and the page says the data has stopped refreshing. */
export const STALE_AFTER_HOURS = 36;

export type PeriodDays = 7 | 30 | 90 | 365;
export const PERIODS: PeriodDays[] = [7, 30, 90, 365];
export type MinMag = 4 | 5 | 6;
export const MIN_MAGS: MinMag[] = [4, 5, 6];

export function decodeEvents(doc: DataDocument): Quake[] {
  return doc.events.rows.map(([id, t, lat, lon, depth, mag, place]) => ({
    id,
    t,
    lat,
    lon,
    depth,
    mag,
    place,
  }));
}

export function depthClass(depthKm: number): DepthClass {
  if (depthKm < SHALLOW_KM) return 'shallow';
  return depthKm < DEEP_KM ? 'mid' : 'deep';
}

export function generatedAtSec(doc: DataDocument): number {
  return Math.floor(Date.parse(doc.generatedAt) / 1000);
}

export function select(events: Quake[], nowSec: number, days: number, minMag: number): Quake[] {
  const since = nowSec - days * DAY;
  return events.filter((q) => q.t > since && q.t <= nowSec && q.mag >= minMag);
}

export interface Summary {
  count: number;
  strongest: Quake | null;
  shallowShare: number | null;
}

export function summarize(events: Quake[]): Summary {
  let strongest: Quake | null = null;
  let shallow = 0;
  for (const q of events) {
    if (!strongest || q.mag > strongest.mag || (q.mag === strongest.mag && q.t > strongest.t)) {
      strongest = q;
    }
    if (q.depth < SHALLOW_KM) shallow += 1;
  }
  return {
    count: events.length,
    strongest,
    shallowShare: events.length ? shallow / events.length : null,
  };
}

export function strongestFirst(events: Quake[], limit: number): Quake[] {
  return [...events].sort((a, b) => b.mag - a.mag || b.t - a.t).slice(0, limit);
}

export function newestFirst(events: Quake[]): Quake[] {
  return [...events].sort((a, b) => b.t - a.t);
}

// -- helicorder ---------------------------------------------------------------------------

export interface Tick {
  quake: Quake;
  /** Position within the UTC day, 0 to 1. */
  at: number;
}

export interface HelicorderRow {
  /** Start of the UTC day, seconds. */
  start: number;
  ticks: Tick[];
  /** How much of the row has happened yet (1 for every day but the last). */
  elapsed: number;
}

/** One row per UTC day for the `days` days up to and including the day of `nowSec`. */
export function helicorder(
  events: Quake[],
  nowSec: number,
  days: number,
  minMag: number,
): HelicorderRow[] {
  const today = Math.floor(nowSec / DAY) * DAY;
  const rows: HelicorderRow[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = today - i * DAY;
    rows.push({ start, ticks: [], elapsed: i === 0 ? (nowSec - today) / DAY : 1 });
  }
  const first = today - (days - 1) * DAY;
  for (const q of events) {
    if (q.mag < minMag || q.t < first || q.t > nowSec) continue;
    const index = Math.floor((q.t - first) / DAY);
    rows[index]?.ticks.push({ quake: q, at: ((q.t - first) % DAY) / DAY });
  }
  for (const row of rows) row.ticks.sort((a, b) => a.at - b.at);
  return rows;
}

// -- activity -----------------------------------------------------------------------------

export interface Bucket {
  /** First day of the bucket as `YYYY-MM-DD`. */
  from: string;
  days: number;
  counts: [number, number, number];
}

/** Daily counts for the last `days` days. Long periods are grouped by week to stay legible. */
export function activity(doc: DataDocument, days: number, minMag: number): Bucket[] {
  const total = doc.daily.counts.length;
  const take = Math.min(days, total);
  const offset = total - take;
  const first = Date.parse(`${doc.daily.from}T00:00:00Z`);
  const bandFloor = [4, 5, 6];
  const daily: Bucket[] = [];
  for (let i = 0; i < take; i += 1) {
    const source = doc.daily.counts[offset + i] ?? [0, 0, 0];
    const counts = source.map((n, band) => ((bandFloor[band] ?? 4) + 0.99 >= minMag ? n : 0));
    daily.push({
      from: new Date(first + (offset + i) * DAY * 1000).toISOString().slice(0, 10),
      days: 1,
      counts: counts as [number, number, number],
    });
  }
  if (days <= 120) return daily;
  const weeks: Bucket[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const slice = daily.slice(i, i + 7);
    const sum: [number, number, number] = [0, 0, 0];
    for (const day of slice) {
      sum[0] += day.counts[0];
      sum[1] += day.counts[1];
      sum[2] += day.counts[2];
    }
    weeks.push({ from: slice[0]?.from ?? '', days: slice.length, counts: sum });
  }
  return weeks;
}

// -- magnitude-frequency ------------------------------------------------------------------

export interface FrequencyPoint {
  mag: number;
  /** Number of events with magnitude at least `mag`. */
  atLeast: number;
}

export interface Frequency {
  points: FrequencyPoint[];
  /** Gutenberg-Richter b-value (Aki maximum likelihood) and its standard error. */
  b: { value: number; error: number; n: number } | null;
}

export const MIN_EVENTS_FOR_B = 50;

export function frequency(events: Quake[]): Frequency {
  if (events.length === 0) return { points: [], b: null };
  const mags = events.map((q) => Math.round(q.mag * 10));
  const lowest = Math.min(...mags);
  const highest = Math.max(...mags);
  const points: FrequencyPoint[] = [];
  for (let m = lowest; m <= highest; m += 1) {
    const atLeast = mags.filter((value) => value >= m).length;
    if (atLeast > 0) points.push({ mag: m / 10, atLeast });
  }
  const complete = events.filter((q) => q.mag >= COMPLETENESS_MAG);
  if (complete.length < MIN_EVENTS_FOR_B) return { points, b: null };
  const mean = complete.reduce((sum, q) => sum + q.mag, 0) / complete.length;
  // Aki (1965) with Utsu's correction for magnitudes rounded to 0.1.
  const value = Math.LOG10E / (mean - (COMPLETENESS_MAG - 0.05));
  return { points, b: { value, error: value / Math.sqrt(complete.length), n: complete.length } };
}

// -- freshness ----------------------------------------------------------------------------

export function ageHours(doc: DataDocument, nowMs: number): number {
  return (nowMs - Date.parse(doc.generatedAt)) / 3_600_000;
}

export function isStale(doc: DataDocument, nowMs: number): boolean {
  return ageHours(doc, nowMs) > STALE_AFTER_HOURS;
}

// -- regions ------------------------------------------------------------------------------

export type RegionKey = 'all' | 'sumatra' | 'java' | 'sulawesi' | 'papua';
export const REGIONS: RegionKey[] = ['all', 'sumatra', 'java', 'sulawesi', 'papua'];

export interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export const REGION_BOUNDS: Record<RegionKey, Bounds> = {
  all: { minLon: 94.5, maxLon: 141.5, minLat: -11.5, maxLat: 6.5 },
  sumatra: { minLon: 94.5, maxLon: 108.5, minLat: -7, maxLat: 6.5 },
  java: { minLon: 104, maxLon: 126, minLat: -11.5, maxLat: -5 },
  sulawesi: { minLon: 118, maxLon: 134, minLat: -8, maxLat: 5.5 },
  papua: { minLon: 130, maxLon: 141.5, minLat: -10.5, maxLat: 0.5 },
};
