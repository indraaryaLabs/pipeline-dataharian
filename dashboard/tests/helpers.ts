import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DataDocument, Quake } from '../src/types.ts';

export type Scenario = 'normal' | 'partial' | 'failed' | 'empty';

export function loadFixture(name: Scenario): DataDocument {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as DataDocument;
}

export function quake(overrides: Partial<Quake> = {}): Quake {
  return {
    id: 'q',
    t: 1_700_000_000,
    lat: -2,
    lon: 120,
    depth: 10,
    mag: 4.5,
    place: 'Somewhere, Indonesia',
    ...overrides,
  };
}
