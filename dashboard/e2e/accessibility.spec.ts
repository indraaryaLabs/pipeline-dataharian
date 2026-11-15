import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, type Scenario } from './support.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const cases: { scenario: Scenario; theme: 'light' | 'dark'; lang: 'en' | 'id' }[] = [
  { scenario: 'normal', theme: 'light', lang: 'en' },
  { scenario: 'normal', theme: 'dark', lang: 'en' },
  { scenario: 'normal', theme: 'light', lang: 'id' },
  { scenario: 'partial', theme: 'dark', lang: 'id' },
  { scenario: 'failed', theme: 'light', lang: 'en' },
  { scenario: 'empty', theme: 'light', lang: 'en' },
  { scenario: 'empty', theme: 'dark', lang: 'en' },
];

for (const { scenario, theme, lang } of cases) {
  test(`${scenario} / ${theme} / ${lang} has no WCAG 2.2 AA violations`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript((value) => localStorage.setItem('gh-lang', value), lang);
    await open(page, { data: scenario });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('group').first().waitFor();
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
    await context.close();
  });
}

test('error state has no violations', async ({ page }) => {
  await open(page, { data: 'abort' });
  await expect(page.getByRole('alert')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('expanded tables have no violations', async ({ page }) => {
  await open(page);
  await page.getByText(/All \d+ earthquakes as a table/).click();
  await page.getByText(/BMKG reports without a USGS match/).click();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});
