import { describe, expect, it } from 'vitest';
import { localizeDetail } from '../src/check-detail.ts';
import { loadFixture, type Scenario } from './helpers.ts';

const SCENARIOS: Scenario[] = ['normal', 'partial', 'failed', 'empty'];

describe('localizeDetail', () => {
  it('leaves English as written', () => {
    expect(localizeDetail('2,944 USGS events in the window.', 'en')).toBe(
      '2,944 USGS events in the window.',
    );
  });

  it('translates every sentence the pipeline writes into Indonesian', () => {
    const untranslated: string[] = [];
    for (const name of SCENARIOS) {
      for (const check of loadFixture(name).pipeline.checks) {
        if (localizeDetail(check.detail, 'id') === check.detail) untranslated.push(check.detail);
      }
    }
    // Only the technical source errors may stay as written; none of these fixtures have others.
    expect(untranslated).toEqual([]);
  });

  it.each([
    ['2,944 USGS events in the window.', '2.944 kejadian USGS dalam rentang waktu.'],
    ['Newest event is 1 hour old.', 'Kejadian terbaru berumur 1 jam.'],
    ['5 events yesterday; a typical day has 2.5.', '5 kejadian kemarin; hari biasa ada 2,5.'],
    [
      '1 of 19 rows rejected in the last run. 1 BMKG outside the region left out, as expected.',
      '1 dari 19 baris ditolak pada proses terakhir. 1 data BMKG di luar wilayah dikecualikan, sesuai harapan.',
    ],
    [
      '19 of 21 BMKG events found in USGS (90%).',
      '19 dari 21 kejadian BMKG ditemukan di USGS (90%).',
    ],
  ])('renders "%s"', (english, indonesian) => {
    expect(localizeDetail(english, 'id')).toBe(indonesian);
  });

  it('shows a sentence it does not know as written instead of hiding it', () => {
    expect(localizeDetail('Something new the pipeline says.', 'id')).toBe(
      'Something new the pipeline says.',
    );
  });
});
