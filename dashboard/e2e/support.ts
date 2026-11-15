import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export type Scenario = 'normal' | 'partial' | 'failed' | 'empty';

/** The fixtures are generated at this moment; the page is told it is three hours later. */
export const GENERATED = '2026-11-15T01:17:00Z';
export const FRESH_NOW = '2026-11-15T04:17:00Z';
export const STALE_NOW = '2026-11-19T12:00:00Z';

export function fixture(name: Scenario): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), 'utf8');
}

export interface Options {
  now?: string;
  /** A scenario fixture, or a custom response for the data file. */
  data?: Scenario | { status: number; body: string; contentType?: string } | 'abort';
}

export async function open(page: Page, options: Options = {}, hash = ''): Promise<void> {
  await page.clock.setFixedTime(new Date(options.now ?? FRESH_NOW));
  const data = options.data ?? 'normal';
  await page.route('**/data.json*', async (route) => {
    if (data === 'abort') return route.abort('failed');
    if (typeof data === 'string') {
      return route.fulfill({ contentType: 'application/json', body: fixture(data) });
    }
    return route.fulfill({
      status: data.status,
      contentType: data.contentType ?? 'application/json',
      body: data.body,
    });
  });
  await page.goto(`/${hash}`);
}
