import type { DataDocument } from './types.ts';

export class DataError extends Error {
  readonly kind: 'network' | 'format';

  constructor(kind: 'network' | 'format', message: string) {
    super(message);
    this.kind = kind;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the parts of the document the page relies on, so a bad file shows an error, not a crash. */
export function parseDocument(raw: unknown): DataDocument {
  if (!isRecord(raw) || raw['schemaVersion'] !== 1) {
    throw new DataError('format', 'Unsupported data format');
  }
  const events = raw['events'];
  const daily = raw['daily'];
  const pipeline = raw['pipeline'];
  const crosscheck = raw['crosscheck'];
  const valid =
    typeof raw['generatedAt'] === 'string' &&
    !Number.isNaN(Date.parse(raw['generatedAt'])) &&
    isRecord(events) &&
    Array.isArray(events['rows']) &&
    isRecord(daily) &&
    Array.isArray(daily['counts']) &&
    Array.isArray(daily['max']) &&
    isRecord(crosscheck) &&
    Array.isArray(crosscheck['pairs']) &&
    isRecord(pipeline) &&
    Array.isArray(pipeline['runs']) &&
    Array.isArray(pipeline['checks']) &&
    Array.isArray(pipeline['sources']) &&
    isRecord(raw['window']) &&
    isRecord(raw['region']);
  if (!valid) throw new DataError('format', 'Data file is incomplete');
  return raw as unknown as DataDocument;
}

/** Loads data.json from the same place as the page. `now` only busts the browser cache. */
export async function loadData(now: number = Date.now()): Promise<DataDocument> {
  let response: Response;
  try {
    response = await fetch(`./data.json?v=${Math.floor(now / 60_000)}`, { cache: 'no-cache' });
  } catch {
    throw new DataError('network', 'Could not reach the data file');
  }
  if (!response.ok) throw new DataError('network', `Data file answered ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DataError('format', 'Data file is not valid JSON');
  }
  return parseDocument(body);
}
