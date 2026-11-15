import { describe, expect, it } from 'vitest';
import {
  ago,
  formatDate,
  formatDepth,
  formatMag,
  formatNumber,
  formatPercent,
  formatUtc,
  hoursSince,
  placeOf,
  span,
} from '../src/format.ts';
import { detectLang, LANGS, STRINGS } from '../src/i18n.ts';

const en = STRINGS.en;
const id = STRINGS.id;
// 2026-11-10 09:05:00 UTC
const sample = Date.UTC(2026, 10, 10, 9, 5) / 1000;

describe('dates', () => {
  it('formats in UTC regardless of the machine time zone', () => {
    expect(formatUtc(sample, en)).toContain('09:05');
    expect(formatUtc(sample, en)).toContain(en.utc);
    expect(formatDate(sample, en)).toMatch(/10/);
  });

  it('uses Indonesian month names for the Indonesian locale', () => {
    expect(formatDate(Date.UTC(2026, 7, 17) / 1000, id)).toMatch(/Agu/);
  });
});

describe('numbers', () => {
  it('shows magnitude with one decimal', () => {
    expect(formatMag(6, en)).toBe('6.0');
    expect(formatMag(6.74, en)).toBe('6.7');
  });

  it('uses the decimal comma in Indonesian', () => {
    expect(formatNumber(1.5, id, 1)).toBe('1,5');
    expect(formatNumber(1.5, en, 1)).toBe('1.5');
  });

  it('rounds shares to whole percents', () => {
    expect(formatPercent(0.654, en)).toMatch(/65\s?%/);
  });

  it('formats depth with its unit', () => {
    expect(formatDepth(33, en)).toContain('33');
    expect(formatDepth(33, en)).toContain('km');
  });
});

describe('relative time', () => {
  const now = Date.UTC(2026, 10, 16, 12, 0);
  it.each([
    [30_000, 'just now'],
    [10 * 60_000, '10 minutes ago'],
    [3 * 3_600_000, '3 hours ago'],
    [3 * 86_400_000, '3 days ago'],
  ])('says "%s ms" as expected', (offset, expected) => {
    expect(ago(now - offset, now, en).toLowerCase()).toBe(expected);
  });

  it('never reports a negative age for a clock that runs ahead', () => {
    expect(ago(now + 5 * 60_000, now, en).toLowerCase()).toBe('just now');
  });

  it('drops the word "ago" from spans', () => {
    expect(span(5, en)).not.toMatch(/ago/);
    expect(span(72, en)).toMatch(/3/);
    expect(span(5, id)).not.toMatch(/lalu/);
  });

  it('computes hours since an ISO time', () => {
    expect(hoursSince('2026-11-16T00:00:00Z', Date.UTC(2026, 10, 16, 6))).toBe(6);
  });
});

describe('places', () => {
  it('turns a missing place into an empty string', () => {
    expect(placeOf({ place: null })).toBe('');
    expect(placeOf({ place: 'Palu' })).toBe('Palu');
  });
});

describe('language', () => {
  it('has the same keys in every language', () => {
    const shape = (value: unknown): unknown =>
      typeof value === 'function'
        ? 'fn'
        : Array.isArray(value)
          ? value.map(shape)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
            : typeof value;
    expect(shape(STRINGS.id)).toEqual(shape(STRINGS.en));
    expect(LANGS).toEqual(['en', 'id']);
  });

  it('honours a saved choice first, then the browser language', () => {
    expect(detectLang('en', ['id-ID'])).toBe('en');
    expect(detectLang('id', ['en-US'])).toBe('id');
    expect(detectLang(null, ['en-US', 'id-ID'])).toBe('id');
    expect(detectLang(null, ['fr'])).toBe('en');
    expect(detectLang('de', [])).toBe('en');
  });
});
