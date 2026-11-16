import type { Lang } from './i18n.ts';

/**
 * The pipeline writes each check's detail line in English. For other languages the page maps
 * the known sentences to their translation and shows anything it does not recognise as written,
 * so a new or reworded check never disappears. The fixtures test covers every known sentence.
 */
type Rule = [pattern: RegExp, render: (match: string[]) => string];

// "2,944" in the pipeline's text becomes "2.944" in Indonesian.
const num = (value: string | undefined): string => (value ?? '').replace(/,/g, '.');
const at = (match: string[], index: number): string => match[index] ?? '';

const ID: Rule[] = [
  [
    /^([\d,]+) USGS events in the window\.$/,
    (m) => `${num(at(m, 1))} kejadian USGS dalam rentang waktu.`,
  ],
  [/^The USGS catalogue is empty\.$/, () => 'Katalog USGS kosong.'],
  [
    /^Magnitude 0 to 10 and depth -5 to 800 km everywhere\.$/,
    () => 'Magnitudo 0 sampai 10 dan kedalaman -5 sampai 800 km di semua kejadian.',
  ],
  [
    /^(\d+) events have impossible values\.$/,
    (m) => `${at(m, 1)} kejadian punya nilai yang mustahil.`,
  ],
  [
    /^Every event lies inside the configured region\.$/,
    () => 'Semua kejadian berada di dalam wilayah yang ditetapkan.',
  ],
  [
    /^(\d+) events lie outside the region\.$/,
    (m) => `${at(m, 1)} kejadian berada di luar wilayah.`,
  ],
  [/^Newest event is (\d+) hours? old\.$/, (m) => `Kejadian terbaru berumur ${at(m, 1)} jam.`],
  [
    /^No USGS events to measure freshness against\.$/,
    () => 'Tidak ada kejadian USGS untuk mengukur kebaruan.',
  ],
  [
    /^No events yesterday; a typical day has ([\d.]+)\.$/,
    (m) => `Tidak ada kejadian kemarin; hari biasa ada ${at(m, 1).replace('.', ',')}.`,
  ],
  [
    /^(\d+) events yesterday; a typical day has ([\d.]+)\.$/,
    (m) => `${at(m, 1)} kejadian kemarin; hari biasa ada ${at(m, 2).replace('.', ',')}.`,
  ],
  [
    /^Too little history to judge daily volume\.$/,
    () => 'Riwayat terlalu sedikit untuk menilai jumlah harian.',
  ],
  [
    /^No events within (\d+) s and (\d+) km of each other\.$/,
    (m) => `Tidak ada kejadian dalam ${at(m, 1)} detik dan ${at(m, 2)} km satu sama lain.`,
  ],
  [
    /^(\d+) pairs look like one event stored twice\.$/,
    (m) => `${at(m, 1)} pasang tampak seperti satu kejadian yang tersimpan dua kali.`,
  ],
  [/^The last run read both sources\.$/, () => 'Proses terakhir membaca kedua sumber.'],
  [/^No run recorded yet\.$/, () => 'Belum ada proses yang tercatat.'],
  [
    /^(.+): (\S+) failed after (\d+) attempts \(HTTP (\d+)\)$/,
    (m) => `${at(m, 1)}: ${at(m, 2)} gagal setelah ${at(m, 3)} percobaan (HTTP ${at(m, 4)})`,
  ],
  [/^Nothing fetched in the last run\.$/, () => 'Tidak ada yang diambil pada proses terakhir.'],
  [
    /^(\d+) of ([\d,]+) rows rejected in the last run\.(?: (\d+) BMKG outside the region left out, as expected\.)?$/,
    (m) =>
      `${at(m, 1)} dari ${num(at(m, 2))} baris ditolak pada proses terakhir.` +
      (m[3] ? ` ${m[3]} data BMKG di luar wilayah dikecualikan, sesuai harapan.` : ''),
  ],
  [
    /^(\d+) of (\d+) BMKG events found in USGS \((\d+)%\)\.$/,
    (m) => `${at(m, 1)} dari ${at(m, 2)} kejadian BMKG ditemukan di USGS (${at(m, 3)}%).`,
  ],
  [
    /^Only (\d+) BMKG events to compare\.$/,
    (m) => `Hanya ${at(m, 1)} kejadian BMKG untuk dibandingkan.`,
  ],
];

export function localizeDetail(detail: string, lang: Lang): string {
  if (lang === 'en') return detail;
  for (const [pattern, render] of ID) {
    const match = pattern.exec(detail);
    if (match) return render(match);
  }
  return detail;
}
