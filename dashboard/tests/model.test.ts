import { describe, expect, it } from 'vitest';
import {
  activity,
  ageHours,
  DAY,
  decodeEvents,
  depthClass,
  frequency,
  generatedAtSec,
  helicorder,
  isStale,
  MIN_EVENTS_FOR_B,
  newestFirst,
  select,
  strongestFirst,
  summarize,
} from '../src/model.ts';
import type { Quake } from '../src/types.ts';
import { loadFixture, quake } from './helpers.ts';

const doc = loadFixture('normal');
const events = decodeEvents(doc);
const now = generatedAtSec(doc);

describe('decodeEvents', () => {
  it('turns every row into a named quake', () => {
    expect(events).toHaveLength(doc.events.rows.length);
    const [id, t, lat, lon, depth, mag, place] = doc.events.rows[0] ?? [];
    expect(events[0]).toEqual({ id, t, lat, lon, depth, mag, place });
  });
});

describe('depthClass', () => {
  it.each([
    [0, 'shallow'],
    [69.9, 'shallow'],
    [70, 'mid'],
    [299.9, 'mid'],
    [300, 'deep'],
    [650, 'deep'],
  ])('classes %d km as %s', (km, expected) => {
    expect(depthClass(km)).toBe(expected);
  });
});

describe('select', () => {
  it('keeps only events inside the window and above the magnitude', () => {
    const picked = select(events, now, 7, 5);
    expect(picked.length).toBeGreaterThan(0);
    for (const q of picked) {
      expect(q.mag).toBeGreaterThanOrEqual(5);
      expect(q.t).toBeGreaterThan(now - 7 * DAY);
      expect(q.t).toBeLessThanOrEqual(now);
    }
  });

  it('excludes the exact start of the window and anything in the future', () => {
    const list = [quake({ id: 'edge', t: now - 7 * DAY }), quake({ id: 'future', t: now + 1 })];
    expect(select(list, now, 7, 4)).toEqual([]);
  });

  it('is monotonic: a longer period never has fewer events', () => {
    const counts = [7, 30, 90, 365].map((days) => select(events, now, days, 4).length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });
});

describe('summarize', () => {
  it('handles no events', () => {
    expect(summarize([])).toEqual({ count: 0, strongest: null, shallowShare: null });
  });

  it('picks the strongest, preferring the newer event on a tie', () => {
    const older = quake({ id: 'a', mag: 6, t: 10 });
    const newer = quake({ id: 'b', mag: 6, t: 20 });
    expect(summarize([older, newer, quake({ mag: 5 })]).strongest?.id).toBe('b');
  });

  it('counts shallow events under 70 km', () => {
    const list = [
      quake({ depth: 10 }),
      quake({ depth: 69 }),
      quake({ depth: 70 }),
      quake({ depth: 400 }),
    ];
    expect(summarize(list).shallowShare).toBe(0.5);
  });
});

describe('ordering', () => {
  it('sorts strongest first, then newest, and respects the limit', () => {
    const list = [
      quake({ id: 'a', mag: 5, t: 1 }),
      quake({ id: 'b', mag: 6, t: 1 }),
      quake({ id: 'c', mag: 5, t: 2 }),
    ];
    expect(strongestFirst(list, 2).map((q) => q.id)).toEqual(['b', 'c']);
    expect(newestFirst(list).map((q) => q.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate its input', () => {
    const list = [quake({ id: 'a', t: 1 }), quake({ id: 'b', t: 2 })];
    newestFirst(list);
    strongestFirst(list, 5);
    expect(list.map((q) => q.id)).toEqual(['a', 'b']);
  });
});

describe('helicorder', () => {
  it('has one row per UTC day, oldest first, ending on the current day', () => {
    const rows = helicorder(events, now, 30, 4);
    expect(rows).toHaveLength(30);
    const today = Math.floor(now / DAY) * DAY;
    expect(rows.at(-1)?.start).toBe(today);
    expect(rows[0]?.start).toBe(today - 29 * DAY);
    expect(rows.at(-1)?.elapsed).toBeCloseTo((now - today) / DAY);
    expect(rows[0]?.elapsed).toBe(1);
  });

  it('places each tick at its fraction of the day', () => {
    const today = Math.floor(now / DAY) * DAY;
    const noon = quake({ id: 'noon', t: today - DAY + DAY / 2 });
    const rows = helicorder([noon], now, 3, 4);
    const row = rows.find((r) => r.ticks.length > 0);
    expect(row?.start).toBe(today - DAY);
    expect(row?.ticks[0]?.at).toBeCloseTo(0.5);
  });

  it('drops events below the magnitude, before the first day or after now', () => {
    const today = Math.floor(now / DAY) * DAY;
    const list = [
      quake({ id: 'weak', mag: 4.2, t: now - 100 }),
      quake({ id: 'old', mag: 6, t: today - 5 * DAY }),
      quake({ id: 'future', mag: 6, t: now + 10 }),
    ];
    const rows = helicorder(list, now, 3, 5);
    expect(rows.flatMap((r) => r.ticks)).toEqual([]);
  });

  it('accounts for every selected event in the window', () => {
    const rows = helicorder(events, now, 30, 4);
    const ticks = rows.reduce((sum, r) => sum + r.ticks.length, 0);
    const today = Math.floor(now / DAY) * DAY;
    const expected = events.filter(
      (q) => q.t >= today - 29 * DAY && q.t <= now && q.mag >= 4,
    ).length;
    expect(ticks).toBe(expected);
  });
});

describe('activity', () => {
  it('returns daily buckets for short periods', () => {
    const buckets = activity(doc, 30, 4);
    expect(buckets).toHaveLength(30);
    expect(buckets.every((b) => b.days === 1)).toBe(true);
  });

  it('groups long periods by week without losing events', () => {
    const daily = activity(doc, 90, 4);
    const weekly = activity(doc, 365, 4);
    expect(weekly.every((b) => b.days <= 7)).toBe(true);
    const sum = (list: ReturnType<typeof activity>) =>
      list.reduce((n, b) => n + b.counts[0] + b.counts[1] + b.counts[2], 0);
    expect(sum(weekly)).toBeGreaterThanOrEqual(sum(daily));
    expect(sum(weekly)).toBe(doc.daily.counts.flat().reduce((a, b) => a + b, 0));
  });

  it('zeroes bands below the minimum magnitude', () => {
    for (const bucket of activity(doc, 30, 5)) expect(bucket.counts[0]).toBe(0);
    for (const bucket of activity(doc, 30, 6)) {
      expect(bucket.counts[0]).toBe(0);
      expect(bucket.counts[1]).toBe(0);
    }
  });

  it('never asks for more days than the document holds', () => {
    expect(activity(doc, 365, 4).reduce((n, b) => n + b.days, 0)).toBe(doc.daily.counts.length);
  });
});

describe('frequency', () => {
  it('returns nothing for no events', () => {
    expect(frequency([])).toEqual({ points: [], b: null });
  });

  it('counts events at least as strong, falling as magnitude rises', () => {
    const list = [4.0, 4.0, 4.5, 5.0, 6.0].map((mag, i) => quake({ id: String(i), mag }));
    const { points } = frequency(list);
    expect(points[0]).toEqual({ mag: 4, atLeast: 5 });
    expect(points.at(-1)).toEqual({ mag: 6, atLeast: 1 });
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]?.atLeast).toBeLessThanOrEqual(points[i - 1]?.atLeast ?? 0);
    }
  });

  it('withholds the b-value until there are enough complete events', () => {
    const few = Array.from({ length: MIN_EVENTS_FOR_B - 1 }, (_, i) =>
      quake({ id: String(i), mag: 4.6 }),
    );
    expect(frequency(few).b).toBeNull();
  });

  it('recovers a known b-value from a synthetic catalogue', () => {
    // Magnitudes drawn from an exponential law with b = 1, binned to 0.1.
    const list: Quake[] = [];
    let seed = 42;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let i = 0; i < 4000; i += 1) {
      const mag = 4.45 - Math.log10(1 - random());
      list.push(quake({ id: String(i), mag: Math.round(mag * 10) / 10 }));
    }
    const b = frequency(list).b;
    expect(b?.value).toBeGreaterThan(0.9);
    expect(b?.value).toBeLessThan(1.1);
    expect(b?.error).toBeLessThan(0.05);
  });
});

describe('freshness', () => {
  it('measures the age of the document', () => {
    const generated = Date.parse(doc.generatedAt);
    expect(ageHours(doc, generated + 3 * 3_600_000)).toBeCloseTo(3);
  });

  it('turns stale only after 36 hours', () => {
    const generated = Date.parse(doc.generatedAt);
    expect(isStale(doc, generated + 36 * 3_600_000)).toBe(false);
    expect(isStale(doc, generated + 36 * 3_600_000 + 1)).toBe(true);
  });
});
