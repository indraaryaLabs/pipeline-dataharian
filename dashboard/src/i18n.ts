import type { CheckStatus, DepthClass, RunStatus } from './types.ts';
import type { MinMag, PeriodDays, RegionKey } from './model.ts';

export type Lang = 'en' | 'id';
export const LANGS: Lang[] = ['en', 'id'];

export interface Strings {
  locale: string;
  htmlLang: string;
  documentTitle: string;
  skip: string;
  brand: string;
  tagline: string;
  language: string;
  theme: { toLight: string; toDark: string };

  loading: string;
  loadFailed: { title: string; body: string; retry: string };
  badFormat: { title: string; body: string };
  stale: (age: string) => string;
  runFailed: (when: string) => string;
  runPartial: string;

  controls: {
    period: string;
    magnitude: string;
    area: string;
    periods: Record<PeriodDays, string>;
    mags: Record<MinMag, string>;
    regions: Record<RegionKey, string>;
  };

  headline: (count: number, minMag: number, days: number) => string;
  headlineNone: (minMag: number, days: number) => string;
  strongestSentence: (mag: string, place: string, date: string) => string;
  shallowSentence: (percent: string, km: number) => string;
  updated: (ago: string) => string;

  depth: { title: string; classes: Record<DepthClass, string> };
  size: string;

  helicorder: {
    title: string;
    intro: (days: number) => string;
    hours: string;
    notYet: string;
    group: string;
    keys: string;
    rowSummary: (date: string, count: number, strongest: string | null) => string;
    empty: string;
  };

  map: { title: string; intro: string; label: (count: number) => string };

  events: {
    title: string;
    none: string;
    select: string;
    allTitle: (count: number) => string;
    note: (shown: number) => string;
    columns: { time: string; mag: string; depth: string; place: string };
    km: string;
  };

  activity: {
    title: string;
    intro: (weekly: boolean) => string;
    none: string;
    bands: [string, string, string];
    label: (total: number, days: number) => string;
    perDay: (count: number) => string;
    bucket: (from: string, days: number) => string;
  };

  magnitudeFrequency: {
    title: string;
    intro: string;
    axisX: string;
    axisY: string;
    result: (value: string, factor: string, error: string, n: number) => string;
    tooFew: (needed: number) => string;
    label: string;
  };

  agreement: {
    title: string;
    intro: string;
    result: (matched: number, eligible: number, percent: string) => string;
    differences: (mag: string, km: string, seconds: string) => string;
    pending: (count: number) => string;
    scatterLabel: (pairs: number) => string;
    axisX: string;
    axisY: string;
    nothing: string;
    unmatchedTitle: (count: number) => string;
    unmatchedNote: string;
    bmkgHigher: string;
    bmkgLower: string;
    same: string;
  };

  pipeline: {
    title: string;
    intro: string;
    runs: string;
    columns: {
      when: string;
      mode: string;
      status: string;
      usgs: string;
      bmkg: string;
      rejected: string;
      took: string;
    };
    modes: { backfill: string; incremental: string };
    runStatus: Record<RunStatus, string>;
    checks: string;
    checkStatus: Record<CheckStatus, string>;
    checkNames: Record<string, string>;
    sources: string;
    lastSuccess: (ago: string) => string;
    never: string;
    latestEvent: (ago: string) => string;
    revised: string;
    seconds: (n: number) => string;
    rejects: string;
    noRejects: string;
    rejectReasons: Record<string, string>;
  };

  footer: {
    about: string;
    limits: string[];
    code: string;
    author: string;
  };

  relative: {
    justNow: string;
    minutes: (n: number) => string;
    hours: (n: number) => string;
    days: (n: number) => string;
  };
  utc: string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const en: Strings = {
  locale: 'en-GB',
  htmlLang: 'en',
  documentTitle: 'Gempa Harian · Indonesia earthquakes, updated daily',
  skip: 'Skip to content',
  brand: 'Gempa Harian',
  tagline: 'Indonesia earthquakes, updated daily',
  language: 'Language',
  theme: { toLight: 'Switch to light theme', toDark: 'Switch to dark theme' },

  loading: 'Loading earthquake data',
  loadFailed: {
    title: 'The data could not be loaded',
    body: 'The page reads one file that is refreshed every day. It did not arrive, so there is nothing to show yet. Check your connection and try again.',
    retry: 'Try again',
  },
  badFormat: {
    title: 'The data file is in a format this page does not understand',
    body: 'The page and the data were probably published at different times. Reload in a minute; if it persists, the pipeline repository has the details.',
  },
  stale: (age) =>
    `The data has not refreshed for ${age}. What you see is the last successful update; newer earthquakes are missing.`,
  runFailed: (when) =>
    `The latest update (${when}) failed, so this is older data. The pipeline keeps the last good copy and tries again on its next run.`,
  runPartial:
    'The latest update could not read BMKG. Earthquakes are current; the agency comparison is not.',

  controls: {
    period: 'Period',
    magnitude: 'Magnitude',
    area: 'Area',
    periods: { 7: '7 days', 30: '30 days', 90: '90 days', 365: '1 year' },
    mags: { 4: '4 and above', 5: '5 and above', 6: '6 and above' },
    regions: {
      all: 'All Indonesia',
      sumatra: 'Sumatra',
      java: 'Java and Nusa Tenggara',
      sulawesi: 'Sulawesi and Maluku',
      papua: 'Papua',
    },
  },

  headline: (count, minMag, days) =>
    `Indonesia recorded ${count.toLocaleString('en-GB')} ${plural(count, 'earthquake', 'earthquakes')} of magnitude ${minMag} or more in the last ${days === 365 ? 'year' : `${days} days`}.`,
  headlineNone: (minMag, days) =>
    `No earthquakes of magnitude ${minMag} or more were recorded in the last ${days === 365 ? 'year' : `${days} days`}.`,
  strongestSentence: (mag, place, date) =>
    `The strongest was magnitude ${mag}, ${place}, on ${date}.`,
  shallowSentence: (percent, km) =>
    `${percent} were shallow, under ${km} km deep, where shaking at the surface is strongest.`,
  updated: (ago) => `Updated ${ago}`,

  depth: {
    title: 'Depth',
    classes: { shallow: 'Under 70 km', mid: '70 to 300 km', deep: 'Over 300 km' },
  },
  size: 'Size shows magnitude',

  helicorder: {
    title: 'Day by day, last 30 days',
    intro: (days) =>
      `A seismograph drum, unrolled. Each row is one day in UTC, read left to right from 00:00 to 24:00. Each tick is one earthquake; the taller it is, the stronger. The last ${days} days are shown, newest at the bottom.`,
    hours: 'Hour of day, UTC',
    notYet: 'Not yet recorded',
    group: 'Daily earthquake record',
    keys: 'Use the up and down arrow keys to move between days.',
    rowSummary: (date, count, strongest) =>
      count === 0
        ? `${date}: no earthquakes.`
        : `${date}: ${count} ${plural(count, 'earthquake', 'earthquakes')}, strongest ${strongest}.`,
    empty: 'No earthquakes at this magnitude in the last 30 days.',
  },

  map: {
    title: 'Where they happened',
    intro:
      'Circle size shows magnitude and colour shows depth. Select an earthquake to follow it across the page.',
    label: (count) =>
      `Map of ${count} ${plural(count, 'earthquake', 'earthquakes')} in the chosen area and period. The list beside it has the same events.`,
  },

  events: {
    title: 'Strongest in this period',
    none: 'No earthquakes match these filters.',
    select: 'Show on map',
    allTitle: (count) =>
      `All ${count.toLocaleString('en-GB')} ${plural(count, 'earthquake', 'earthquakes')} as a table`,
    note: (shown) => `Showing the most recent ${shown}.`,
    columns: { time: 'Time (UTC)', mag: 'Magnitude', depth: 'Depth', place: 'Location' },
    km: 'km',
  },

  activity: {
    title: 'How busy it has been',
    intro: (weekly) =>
      `Earthquakes per ${weekly ? 'week' : 'day'}, darker for stronger ones. A few per day is normal for this region.`,
    none: 'Nothing to chart for this period.',
    bands: ['Magnitude 4 to 4.9', 'Magnitude 5 to 5.9', 'Magnitude 6 and above'],
    label: (total, days) => `Bar chart of ${total} earthquakes over ${days} days.`,
    perDay: (count) => `${count} ${plural(count, 'earthquake', 'earthquakes')}`,
    bucket: (from, days) => (days === 1 ? from : `Week of ${from}`),
  },

  magnitudeFrequency: {
    title: 'How rare the big ones are',
    intro:
      'For every magnitude, how many earthquakes were at least that strong. Because each step up is much rarer, the points fall along a straight line on a log scale.',
    axisX: 'Magnitude',
    axisY: 'Earthquakes at least this strong',
    result: (value, factor, error, n) =>
      `Each whole step in magnitude was about ${factor} times rarer (b = ${value} ± ${error}, from ${n} earthquakes of magnitude 4.5 and above). Worldwide, b is close to 1.`,
    tooFew: (needed) =>
      `Pick a longer period or lower magnitude: a reliable b-value needs at least ${needed} earthquakes of magnitude 4.5 and above.`,
    label: 'Chart of earthquake counts by magnitude on a logarithmic scale.',
  },

  agreement: {
    title: 'Do two agencies agree?',
    intro:
      'BMKG, Indonesia’s agency, reports its own list of earthquakes of magnitude 5 and above. Each is matched to the same event in the USGS catalogue when it is within 90 seconds and 150 km.',
    result: (matched, eligible, percent) =>
      `${matched} of ${eligible} BMKG earthquakes older than 12 hours were found in USGS (${percent}).`,
    differences: (mag, km, seconds) =>
      `Typical differences between matched pairs: ${mag} in magnitude, ${km} km in position, ${seconds} in time.`,
    pending: (count) =>
      `${count} newer ${plural(count, 'report is', 'reports are')} not counted yet, since USGS can take hours to publish.`,
    scatterLabel: (pairs) =>
      `Scatter plot of BMKG against USGS magnitude for ${pairs} matched earthquakes.`,
    axisX: 'USGS magnitude',
    axisY: 'BMKG magnitude',
    nothing:
      'BMKG data starts accumulating from the first run, so there is nothing to compare yet.',
    unmatchedTitle: (count) =>
      `${count} BMKG ${plural(count, 'report', 'reports')} without a USGS match`,
    unmatchedNote:
      'These are listed, not hidden. Agencies sometimes locate an event too differently to pair, or one of them never lists it.',
    bmkgHigher: 'higher at BMKG',
    bmkgLower: 'lower at BMKG',
    same: 'the same',
  },

  pipeline: {
    title: 'Can you trust this data?',
    intro:
      'A pipeline refreshes this page once a day. These are its own records: when it last ran, what it found, and the checks the data has to pass before it is published.',
    runs: 'Recent runs',
    columns: {
      when: 'Started',
      mode: 'Kind',
      status: 'Result',
      usgs: 'USGS new / revised',
      bmkg: 'BMKG new',
      rejected: 'Rejected',
      took: 'Took',
    },
    modes: { backfill: 'Full refresh', incremental: 'Daily update' },
    runStatus: { running: 'Running', ok: 'Succeeded', partial: 'Partly', failed: 'Failed' },
    checks: 'Data checks',
    checkStatus: { pass: 'Passed', warn: 'Warning', fail: 'Failed', skip: 'Not enough data' },
    checkNames: {
      catalogue_present: 'Catalogue is not empty',
      values_plausible: 'Values are physically possible',
      inside_region: 'Events are inside the region',
      fresh_catalogue: 'Newest event is recent',
      daily_volume: 'Yesterday looks normal',
      no_double_counting: 'No event counted twice',
      last_run: 'Last run finished cleanly',
      reject_rate: 'Few rows rejected',
      agency_agreement: 'Agencies agree',
    },
    sources: 'Sources',
    lastSuccess: (ago) => `last read ${ago}`,
    never: 'not read yet',
    latestEvent: (ago) => `newest event ${ago}`,
    revised: 'Revised',
    seconds: (n) => `${n} s`,
    rejects: 'Rows the pipeline refused recently',
    noRejects: 'No rows were rejected recently.',
    rejectReasons: {
      missing_magnitude: 'no magnitude yet',
      missing_depth: 'no depth',
      missing_time: 'no time',
      missing_coordinates: 'no position',
      malformed_feature: 'unreadable record',
      not_an_earthquake: 'not an earthquake',
      outside_region: 'outside the region',
      magnitude_out_of_range: 'impossible magnitude',
      depth_out_of_range: 'impossible depth',
      coordinates_out_of_range: 'impossible position',
      time_in_future: 'time in the future',
      bad_time: 'unreadable time',
      bad_number: 'unreadable number',
      bad_depth: 'unreadable depth',
      malformed_row: 'unreadable record',
    },
  },

  footer: {
    about:
      'Earthquake data comes from the USGS Earthquake Catalog and the Indonesian meteorological agency, BMKG. This page is an independent project, not an official warning service.',
    limits: [
      'USGS lists earthquakes of magnitude 4 and above in this region. It may be incomplete below about 4.5, and magnitudes can be revised for days.',
      'Days follow UTC. Indonesia is 7 to 9 hours ahead.',
      'Locations are the nearest town USGS names, not an administrative area.',
      'For warnings, use BMKG.',
    ],
    code: 'Source code and documentation',
    author: 'Built by Indra Arya',
  },

  relative: {
    justNow: 'just now',
    minutes: (n) => `${n} ${plural(n, 'minute', 'minutes')} ago`,
    hours: (n) => `${n} ${plural(n, 'hour', 'hours')} ago`,
    days: (n) => `${n} ${plural(n, 'day', 'days')} ago`,
  },
  utc: 'UTC',
};

const id: Strings = {
  locale: 'id-ID',
  htmlLang: 'id',
  documentTitle: 'Gempa Harian · Gempa bumi Indonesia, diperbarui setiap hari',
  skip: 'Lompat ke konten',
  brand: 'Gempa Harian',
  tagline: 'Gempa bumi Indonesia, diperbarui setiap hari',
  language: 'Bahasa',
  theme: { toLight: 'Ganti ke tema terang', toDark: 'Ganti ke tema gelap' },

  loading: 'Memuat data gempa',
  loadFailed: {
    title: 'Data tidak dapat dimuat',
    body: 'Halaman ini membaca satu berkas yang diperbarui setiap hari. Berkas itu tidak sampai, jadi belum ada yang bisa ditampilkan. Periksa koneksi lalu coba lagi.',
    retry: 'Coba lagi',
  },
  badFormat: {
    title: 'Format berkas data tidak dikenali halaman ini',
    body: 'Halaman dan datanya kemungkinan dipublikasikan pada waktu berbeda. Muat ulang satu menit lagi; jika masih sama, rinciannya ada di repositori pipeline.',
  },
  stale: (age) =>
    `Data belum diperbarui selama ${age}. Yang tampil adalah pembaruan terakhir yang berhasil; gempa yang lebih baru belum masuk.`,
  runFailed: (when) =>
    `Pembaruan terakhir (${when}) gagal, jadi ini data yang lebih lama. Pipeline menyimpan salinan terakhir yang baik dan mencoba lagi pada jadwal berikutnya.`,
  runPartial:
    'Pembaruan terakhir tidak dapat membaca BMKG. Data gempa tetap terbaru; perbandingan antarlembaga tidak.',

  controls: {
    period: 'Periode',
    magnitude: 'Magnitudo',
    area: 'Wilayah',
    periods: { 7: '7 hari', 30: '30 hari', 90: '90 hari', 365: '1 tahun' },
    mags: { 4: '4 ke atas', 5: '5 ke atas', 6: '6 ke atas' },
    regions: {
      all: 'Seluruh Indonesia',
      sumatra: 'Sumatra',
      java: 'Jawa dan Nusa Tenggara',
      sulawesi: 'Sulawesi dan Maluku',
      papua: 'Papua',
    },
  },

  headline: (count, minMag, days) =>
    `Indonesia mencatat ${count.toLocaleString('id-ID')} gempa bermagnitudo ${minMag} atau lebih dalam ${days === 365 ? 'satu tahun' : `${days} hari`} terakhir.`,
  headlineNone: (minMag, days) =>
    `Tidak ada gempa bermagnitudo ${minMag} atau lebih dalam ${days === 365 ? 'satu tahun' : `${days} hari`} terakhir.`,
  strongestSentence: (mag, place, date) =>
    `Yang terkuat bermagnitudo ${mag}, ${place}, pada ${date}.`,
  shallowSentence: (percent, km) =>
    `${percent} tergolong dangkal, kurang dari ${km} km, tempat guncangan di permukaan paling kuat.`,
  updated: (ago) => `Diperbarui ${ago}`,

  depth: {
    title: 'Kedalaman',
    classes: { shallow: 'Kurang dari 70 km', mid: '70 sampai 300 km', deep: 'Lebih dari 300 km' },
  },
  size: 'Ukuran menunjukkan magnitudo',

  helicorder: {
    title: 'Hari demi hari, 30 hari terakhir',
    intro: (days) =>
      `Drum seismograf yang dibentangkan. Setiap baris adalah satu hari dalam UTC, dibaca dari kiri ke kanan, 00:00 sampai 24:00. Setiap garis adalah satu gempa; makin tinggi, makin kuat. Ditampilkan ${days} hari terakhir, yang terbaru di bawah.`,
    hours: 'Jam dalam sehari, UTC',
    notYet: 'Belum terekam',
    group: 'Catatan gempa harian',
    keys: 'Gunakan tombol panah atas dan bawah untuk berpindah antarhari.',
    rowSummary: (date, count, strongest) =>
      count === 0 ? `${date}: tidak ada gempa.` : `${date}: ${count} gempa, terkuat ${strongest}.`,
    empty: 'Tidak ada gempa pada magnitudo ini dalam 30 hari terakhir.',
  },

  map: {
    title: 'Di mana terjadinya',
    intro:
      'Ukuran lingkaran menunjukkan magnitudo dan warna menunjukkan kedalaman. Pilih satu gempa untuk mengikutinya di seluruh halaman.',
    label: (count) =>
      `Peta ${count} gempa pada wilayah dan periode terpilih. Daftar di sebelahnya berisi kejadian yang sama.`,
  },

  events: {
    title: 'Terkuat pada periode ini',
    none: 'Tidak ada gempa yang cocok dengan filter ini.',
    select: 'Tampilkan di peta',
    allTitle: (count) => `Seluruh ${count.toLocaleString('id-ID')} gempa dalam bentuk tabel`,
    note: (shown) => `Menampilkan ${shown} yang terbaru.`,
    columns: { time: 'Waktu (UTC)', mag: 'Magnitudo', depth: 'Kedalaman', place: 'Lokasi' },
    km: 'km',
  },

  activity: {
    title: 'Seberapa sering terjadi',
    intro: (weekly) =>
      `Jumlah gempa per ${weekly ? 'pekan' : 'hari'}, makin gelap makin kuat. Beberapa gempa per hari adalah hal biasa di kawasan ini.`,
    none: 'Tidak ada yang bisa digambar untuk periode ini.',
    bands: ['Magnitudo 4 sampai 4,9', 'Magnitudo 5 sampai 5,9', 'Magnitudo 6 ke atas'],
    label: (total, days) => `Diagram batang ${total} gempa selama ${days} hari.`,
    perDay: (count) => `${count} gempa`,
    bucket: (from, days) => (days === 1 ? from : `Pekan ${from}`),
  },

  magnitudeFrequency: {
    title: 'Betapa jarangnya gempa besar',
    intro:
      'Untuk setiap magnitudo, berapa banyak gempa yang setidaknya sekuat itu. Karena setiap kenaikan jauh lebih jarang, titik-titiknya jatuh pada garis lurus di skala logaritmik.',
    axisX: 'Magnitudo',
    axisY: 'Gempa setidaknya sekuat ini',
    result: (value, factor, error, n) =>
      `Setiap kenaikan satu magnitudo sekitar ${factor} kali lebih jarang (b = ${value} ± ${error}, dari ${n} gempa magnitudo 4,5 ke atas). Di seluruh dunia, b mendekati 1.`,
    tooFew: (needed) =>
      `Pilih periode lebih panjang atau magnitudo lebih rendah: nilai b yang andal butuh setidaknya ${needed} gempa magnitudo 4,5 ke atas.`,
    label: 'Grafik jumlah gempa menurut magnitudo pada skala logaritmik.',
  },

  agreement: {
    title: 'Apakah dua lembaga sepakat?',
    intro:
      'BMKG melaporkan daftarnya sendiri untuk gempa magnitudo 5 ke atas. Setiap gempa dicocokkan dengan kejadian yang sama di katalog USGS bila selisihnya dalam 90 detik dan 150 km.',
    result: (matched, eligible, percent) =>
      `${matched} dari ${eligible} gempa BMKG yang lebih lama dari 12 jam ditemukan di USGS (${percent}).`,
    differences: (mag, km, seconds) =>
      `Selisih tipikal pasangan yang cocok: ${mag} magnitudo, ${km} km posisi, ${seconds} waktu.`,
    pending: (count) =>
      `${count} laporan lebih baru belum dihitung, karena USGS bisa butuh beberapa jam untuk menerbitkannya.`,
    scatterLabel: (pairs) =>
      `Diagram sebar magnitudo BMKG terhadap USGS untuk ${pairs} gempa yang cocok.`,
    axisX: 'Magnitudo USGS',
    axisY: 'Magnitudo BMKG',
    nothing:
      'Data BMKG mulai terkumpul sejak proses pertama, jadi belum ada yang bisa dibandingkan.',
    unmatchedTitle: (count) => `${count} laporan BMKG tanpa pasangan di USGS`,
    unmatchedNote:
      'Laporan ini ditampilkan, bukan disembunyikan. Kadang lokasinya terlalu berbeda untuk dipasangkan, atau salah satu lembaga tidak mencatatnya.',
    bmkgHigher: 'lebih tinggi di BMKG',
    bmkgLower: 'lebih rendah di BMKG',
    same: 'sama',
  },

  pipeline: {
    title: 'Bisakah data ini dipercaya?',
    intro:
      'Sebuah pipeline memperbarui halaman ini sekali sehari. Ini catatannya sendiri: kapan terakhir berjalan, apa yang ditemukan, dan pemeriksaan yang harus dilewati data sebelum dipublikasikan.',
    runs: 'Proses terbaru',
    columns: {
      when: 'Mulai',
      mode: 'Jenis',
      status: 'Hasil',
      usgs: 'USGS baru / direvisi',
      bmkg: 'BMKG baru',
      rejected: 'Ditolak',
      took: 'Durasi',
    },
    modes: { backfill: 'Muat ulang penuh', incremental: 'Pembaruan harian' },
    runStatus: { running: 'Berjalan', ok: 'Berhasil', partial: 'Sebagian', failed: 'Gagal' },
    checks: 'Pemeriksaan data',
    checkStatus: { pass: 'Lulus', warn: 'Peringatan', fail: 'Gagal', skip: 'Data belum cukup' },
    checkNames: {
      catalogue_present: 'Katalog tidak kosong',
      values_plausible: 'Nilai masuk akal secara fisik',
      inside_region: 'Kejadian berada di dalam wilayah',
      fresh_catalogue: 'Kejadian terbaru masih baru',
      daily_volume: 'Kemarin tampak normal',
      no_double_counting: 'Tidak ada kejadian terhitung dua kali',
      last_run: 'Proses terakhir selesai dengan baik',
      reject_rate: 'Sedikit baris yang ditolak',
      agency_agreement: 'Lembaga-lembaga sepakat',
    },
    sources: 'Sumber',
    lastSuccess: (ago) => `terakhir dibaca ${ago}`,
    never: 'belum pernah dibaca',
    latestEvent: (ago) => `gempa terbaru ${ago}`,
    revised: 'Direvisi',
    seconds: (n) => `${n} dtk`,
    rejects: 'Baris yang baru-baru ini ditolak pipeline',
    noRejects: 'Tidak ada baris yang ditolak baru-baru ini.',
    rejectReasons: {
      missing_magnitude: 'belum ada magnitudo',
      missing_depth: 'tanpa kedalaman',
      missing_time: 'tanpa waktu',
      missing_coordinates: 'tanpa posisi',
      malformed_feature: 'catatan tidak terbaca',
      not_an_earthquake: 'bukan gempa',
      outside_region: 'di luar wilayah',
      magnitude_out_of_range: 'magnitudo mustahil',
      depth_out_of_range: 'kedalaman mustahil',
      coordinates_out_of_range: 'posisi mustahil',
      time_in_future: 'waktu di masa depan',
      bad_time: 'waktu tidak terbaca',
      bad_number: 'angka tidak terbaca',
      bad_depth: 'kedalaman tidak terbaca',
      malformed_row: 'catatan tidak terbaca',
    },
  },

  footer: {
    about:
      'Data gempa berasal dari USGS Earthquake Catalog dan Badan Meteorologi, Klimatologi, dan Geofisika (BMKG). Halaman ini proyek independen, bukan layanan peringatan resmi.',
    limits: [
      'USGS mencatat gempa magnitudo 4 ke atas di kawasan ini. Katalognya mungkin belum lengkap di bawah sekitar 4,5, dan magnitudo bisa direvisi selama beberapa hari.',
      'Hari mengikuti UTC. Indonesia 7 sampai 9 jam lebih awal.',
      'Lokasi adalah kota terdekat yang disebut USGS, bukan wilayah administratif.',
      'Untuk peringatan, gunakan BMKG.',
    ],
    code: 'Kode sumber dan dokumentasi',
    author: 'Dibuat oleh Indra Arya',
  },

  relative: {
    justNow: 'baru saja',
    minutes: (n) => `${n} menit lalu`,
    hours: (n) => `${n} jam lalu`,
    days: (n) => `${n} hari lalu`,
  },
  utc: 'UTC',
};

export const STRINGS: Record<Lang, Strings> = { en, id };

export function detectLang(saved: string | null, languages: readonly string[]): Lang {
  if (saved === 'en' || saved === 'id') return saved;
  return languages.some((language) => language.toLowerCase().startsWith('id')) ? 'id' : 'en';
}
