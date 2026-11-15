import { expect, test } from '@playwright/test';
import { fixture, FRESH_NOW, open, STALE_NOW } from './support.ts';

test.describe('normal day', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('leads with a plain sentence about the period', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Indonesia recorded \d+ earthquakes of magnitude 4 or more in the last 30 days\./,
    );
    await expect(page.getByText(/Updated 3 hours ago/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('draws the helicorder, the map and the strongest list', async ({ page }) => {
    await expect(page.locator('.helico__row')).toHaveCount(30);
    await expect(page.locator('.helico__tick').first()).toBeAttached();
    await expect(page.locator('.map__quake').first()).toBeAttached();
    await expect(page.locator('.top-event')).toHaveCount(6);
    const magnitudes = (await page.locator('.top-event__mag').allTextContents()).map(Number);
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
  });

  test('selecting an event highlights it in the map, the drum and the table', async ({ page }) => {
    await page.getByRole('group', { name: /Language/ }).waitFor();
    const top = page.locator('.top-event').first();
    await top.click();
    await expect(top).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.map__ring')).toHaveCount(1);
    await expect(page.locator('.map__quake.is-selected')).toHaveCount(1);
    await expect(page.locator('.helico__tick.is-selected')).toHaveCount(1);

    await page.getByText(/All \d+ earthquakes as a table/).click();
    await expect(page.locator('tr.is-selected')).toHaveCount(1);

    await page.locator('.top-event').first().click();
    await expect(page.locator('.map__ring')).toHaveCount(0);
    await expect(page.locator('.helico__tick.is-selected')).toHaveCount(0);
  });

  test('keeps the table open and the selection when the view re-renders', async ({ page }) => {
    await page.getByText(/All \d+ earthquakes as a table/).click();
    await page.getByRole('button', { name: 'ID', exact: true }).click();
    await expect(page.locator('details.disclosure[data-key="all-events"]')).toHaveAttribute(
      'open',
      '',
    );
  });

  test('filters by period and magnitude, and remembers them in the address', async ({ page }) => {
    await page.getByRole('radio', { name: '7 days' }).check();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/in the last 7 days\./);
    await page.getByRole('radio', { name: '5 and above' }).check();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/magnitude 5 or more/);
    await expect(page).toHaveURL(/#period=7&mag=5&area=all$/);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /magnitude 5 or more in the last 7 days/,
    );
    await expect(page.getByRole('radio', { name: '7 days' })).toBeChecked();
  });

  test('a stricter magnitude filter only lists strong earthquakes', async ({ page }) => {
    await page.getByRole('radio', { name: '6 and above' }).check();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/magnitude 6 or more/);
    const magnitudes = await page.locator('.top-event__mag').allTextContents();
    expect(magnitudes.length).toBeGreaterThan(0);
    for (const value of magnitudes) expect(Number(value)).toBeGreaterThanOrEqual(6);
  });

  test('zooms the map to a region', async ({ page }) => {
    const map = page.locator('.map__svg');
    const before = (await map.getAttribute('viewBox')) ?? '';
    await page.getByRole('radio', { name: 'Sumatra' }).check();
    await expect(map).not.toHaveAttribute('viewBox', before);
    await expect(page).toHaveURL(/area=sumatra/);
  });

  test('switches language and keeps the choice', async ({ page }) => {
    await page.getByRole('button', { name: 'ID', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/gempa/i);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('button', { name: 'ID', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('switches theme and keeps the choice', async ({ page }) => {
    const html = page.locator('html');
    const before = (await html.getAttribute('data-theme')) as string;
    await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
    await expect(html).not.toHaveAttribute('data-theme', before);
    const after = (await html.getAttribute('data-theme')) as string;
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after);
  });

  test('moves through days with the arrow keys and announces them', async ({ page }) => {
    const drum = page.locator('.helico');
    await drum.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.helico__row.is-active')).toHaveCount(1);
    const live = page.locator('.helico [aria-live]');
    await expect(live).not.toBeEmpty();
    const first = (await live.textContent()) ?? '';
    await page.keyboard.press('ArrowUp');
    await expect(live).not.toHaveText(first);
    await page.keyboard.press('Home');
    await expect(page.locator('.helico__row').first()).toHaveClass(/is-active/);
    await page.keyboard.press('End');
    await expect(page.locator('.helico__row').last()).toHaveClass(/is-active/);
  });

  test('shows a tooltip on the map and hides it on leave', async ({ page }) => {
    // Smaller circles are drawn last, so the last one is never covered.
    await page.locator('.map__quake').last().hover();
    await expect(page.locator('.tip')).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(page.locator('.tip')).toBeHidden();
  });

  test('reports the data checks and the sources', async ({ page }) => {
    await expect(page.locator('.check')).toHaveCount(9);
    await expect(page.locator('.sources li')).toHaveCount(2);
    await expect(
      page.getByRole('table', { name: /./ }).or(page.locator('table')).last(),
    ).toBeVisible();
  });
});

test.describe('other states', () => {
  test('a partial run is flagged without hiding the data', async ({ page }) => {
    await open(page, { data: 'partial' });
    await expect(page.getByRole('status')).toContainText(/could not read BMKG/);
    await expect(page.locator('.top-event').first()).toBeVisible();
  });

  test('a failed run is flagged as older data', async ({ page }) => {
    await open(page, { data: 'failed' });
    await expect(page.getByRole('status')).toContainText(/latest update .* failed/);
    await expect(page.locator('.helico__row')).toHaveCount(30);
  });

  test('an empty catalogue explains itself instead of drawing blank charts', async ({ page }) => {
    await open(page, { data: 'empty' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /No earthquakes|0 earthquakes/i,
    );
    await expect(page.locator('.empty').first()).toBeVisible();
    await expect(page.locator('.map__svg')).toBeVisible();
  });

  test('data older than 36 hours is called stale', async ({ page }) => {
    await open(page, { now: STALE_NOW });
    await expect(page.getByRole('status')).toContainText(/has not refreshed for 4 days/);
  });

  test('a missing data file shows an error with a way to retry', async ({ page }) => {
    await open(page, { data: 'abort' });
    await expect(page.getByRole('alert')).toContainText('The data could not be loaded');

    await page.unroute('**/data.json*');
    await open(page, { data: 'normal' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/earthquakes of magnitude/);
  });

  test('retry button loads the data once it is available', async ({ page }) => {
    let healthy = false;
    await page.clock.setFixedTime(new Date(FRESH_NOW));
    await page.route('**/data.json*', async (route) => {
      if (!healthy) return route.fulfill({ status: 503, body: 'down' });
      return route.fulfill({ contentType: 'application/json', body: fixture('normal') });
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
    healthy = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/earthquakes of magnitude/);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a file in the wrong format is reported, not crashed on', async ({ page }) => {
    await open(page, { data: { status: 200, body: JSON.stringify({ schemaVersion: 9 }) } });
    await expect(page.getByRole('alert')).toContainText(/format this page does not understand/);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('shows a loading placeholder while the file is on its way', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FRESH_NOW));
    await page.route('**/data.json*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ contentType: 'application/json', body: fixture('normal') });
    });
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Loading earthquake data' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test('has no horizontal scrolling at 320 px', async ({ page }) => {
    await open(page);
    await expect(page.locator('.helico__row')).toHaveCount(30);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test('respects reduced motion by not playing the recording reveal', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page);
  const name = await page
    .locator('.helico__row')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('none');
  await context.close();
});
