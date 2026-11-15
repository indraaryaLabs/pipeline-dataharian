import type { Strings } from './i18n.ts';
import type { Quake } from './types.ts';

const HOUR_MS = 3_600_000;

export function formatDate(sec: number, t: Strings): string {
  return new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(sec * 1000);
}

export function formatDay(sec: number, t: Strings): string {
  return new Intl.DateTimeFormat(t.locale, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(sec * 1000);
}

export function formatDateLong(sec: number, t: Strings): string {
  return new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(sec * 1000);
}

export function formatUtc(sec: number, t: Strings): string {
  const text = new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(sec * 1000);
  return `${text} ${t.utc}`;
}

/** The viewer's own clock, with the zone abbreviation, for the tooltip's second line. */
export function formatLocal(sec: number, t: Strings): string {
  return new Intl.DateTimeFormat(t.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(sec * 1000);
}

export function formatMag(mag: number, t: Strings): string {
  return mag.toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatNumber(value: number, t: Strings, digits = 0): string {
  return value.toLocaleString(t.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(share: number, t: Strings): string {
  return `${Math.round(share * 100).toLocaleString(t.locale)}%`;
}

export function formatDepth(depth: number, t: Strings): string {
  return `${Math.round(depth).toLocaleString(t.locale)} ${t.events.km}`;
}

export function ago(fromMs: number, nowMs: number, t: Strings): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 2) return t.relative.justNow;
  if (minutes < 90) return t.relative.minutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 36) return t.relative.hours(hours);
  return t.relative.days(Math.round(hours / 24));
}

/** "4 days" / "4 hari" style span, for the stale notice. */
export function span(hours: number, t: Strings): string {
  return hours < 48
    ? t.relative.hours(Math.round(hours)).replace(/ ago$| lalu$/, '')
    : t.relative.days(Math.round(hours / 24)).replace(/ ago$| lalu$/, '');
}

export function placeOf(q: Pick<Quake, 'place'>): string {
  return q.place ?? '';
}

export function hoursSince(iso: string, nowMs: number): number {
  return (nowMs - Date.parse(iso)) / HOUR_MS;
}
