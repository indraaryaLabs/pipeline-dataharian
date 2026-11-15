import { h, svg } from './dom.ts';
import { formatMag, formatNumber } from './format.ts';
import type { Strings } from './i18n.ts';
import type { Bucket, Frequency } from './model.ts';
import { COMPLETENESS_MAG } from './model.ts';
import type { Pair } from './types.ts';
import type { Tooltip } from './tooltip.ts';

interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function ticks(max: number, count: number): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

// -- stacked bars -------------------------------------------------------------------------

export function activityChart(
  buckets: Bucket[],
  width: number,
  t: Strings,
  tip: Tooltip,
): SVGSVGElement {
  const margin: Margin = { top: 10, right: 8, bottom: 24, left: 34 };
  const height = 200;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const totals = buckets.map((b) => b.counts[0] + b.counts[1] + b.counts[2]);
  const max = niceMax(Math.max(1, ...totals));
  const y = (value: number): number => margin.top + plotH - (value / max) * plotH;
  const slot = plotW / Math.max(1, buckets.length);
  const weekly = (buckets[0]?.days ?? 1) > 1;

  const root = svg('svg', {
    class: 'chart chart--activity',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': t.activity.label(
      totals.reduce((a, b) => a + b, 0),
      buckets.reduce((a, b) => a + b.days, 0),
    ),
  });

  for (const value of ticks(max, 4)) {
    root.append(
      svg('line', {
        class: 'chart__grid',
        x1: margin.left,
        x2: width - margin.right,
        y1: y(value),
        y2: y(value),
      }),
      svg(
        'text',
        { class: 'chart__tick', x: margin.left - 6, y: y(value) + 3.5, 'text-anchor': 'end' },
        formatNumber(value, t),
      ),
    );
  }

  const gap = slot > 5 ? 1 : 0.4;
  buckets.forEach((bucket, index) => {
    let base = 0;
    bucket.counts.forEach((count, band) => {
      if (count === 0) return;
      root.append(
        svg('rect', {
          class: `chart__bar chart__bar--${band}`,
          x: margin.left + index * slot + gap / 2,
          width: Math.max(0.8, slot - gap),
          y: y(base + count),
          height: y(base) - y(base + count),
        }),
      );
      base += count;
    });
  });

  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 78))));
  buckets.forEach((bucket, index) => {
    if (index % labelEvery !== 0) return;
    const date = new Date(`${bucket.from}T00:00:00Z`);
    const label = new Intl.DateTimeFormat(t.locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
    root.append(
      svg('text', { class: 'chart__tick', x: margin.left + index * slot, y: height - 6 }, label),
    );
  });

  root.addEventListener('pointermove', (event) => {
    const box = root.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - margin.left) / slot);
    const bucket = buckets[index];
    if (!bucket) return tip.hide();
    const total = bucket.counts[0] + bucket.counts[1] + bucket.counts[2];
    tip.show(
      [
        h(
          'div',
          { class: 'tip__head' },
          h('strong', null, t.activity.perDay(total)),
          h(
            'span',
            null,
            t.activity.bucket(
              new Intl.DateTimeFormat(t.locale, {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              }).format(new Date(`${bucket.from}T00:00:00Z`)),
              bucket.days,
            ),
          ),
        ),
        ...bucket.counts.map((count, band) =>
          h('div', { class: 'tip__line' }, `${t.activity.bands[band as 0 | 1 | 2]}: ${count}`),
        ),
      ],
      event.clientX,
      event.clientY,
    );
  });
  root.addEventListener('pointerleave', () => tip.hide());
  void weekly;
  return root;
}

// -- magnitude against count (log scale) --------------------------------------------------

export function frequencyChart(data: Frequency, width: number, t: Strings): SVGSVGElement {
  const margin: Margin = { top: 12, right: 12, bottom: 38, left: 44 };
  const height = 260;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const mags = data.points.map((p) => p.mag);
  const minMag = Math.floor(Math.min(...mags, 4));
  const maxMag = Math.ceil(Math.max(...mags, 5) * 2) / 2;
  const top = Math.max(...data.points.map((p) => p.atLeast), 10);
  const decades = Math.ceil(Math.log10(top));
  const x = (mag: number): number => margin.left + ((mag - minMag) / (maxMag - minMag)) * plotW;
  const y = (count: number): number =>
    margin.top + plotH - (Math.log10(Math.max(1, count)) / decades) * plotH;

  const root = svg('svg', {
    class: 'chart chart--frequency',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': t.magnitudeFrequency.label,
  });

  for (let d = 0; d <= decades; d += 1) {
    const value = 10 ** d;
    root.append(
      svg('line', {
        class: 'chart__grid',
        x1: margin.left,
        x2: width - margin.right,
        y1: y(value),
        y2: y(value),
      }),
      svg(
        'text',
        { class: 'chart__tick', x: margin.left - 6, y: y(value) + 3.5, 'text-anchor': 'end' },
        formatNumber(value, t),
      ),
    );
  }
  for (let m = Math.ceil(minMag); m <= maxMag; m += 1) {
    root.append(
      svg('line', {
        class: 'chart__grid chart__grid--v',
        x1: x(m),
        x2: x(m),
        y1: margin.top,
        y2: margin.top + plotH,
      }),
      svg(
        'text',
        { class: 'chart__tick', x: x(m), y: height - 20, 'text-anchor': 'middle' },
        formatNumber(m, t),
      ),
    );
  }
  root.append(
    svg(
      'text',
      { class: 'chart__title', x: margin.left + plotW / 2, y: height - 4, 'text-anchor': 'middle' },
      t.magnitudeFrequency.axisX,
    ),
    svg(
      'text',
      {
        class: 'chart__title',
        transform: `translate(11 ${margin.top + plotH / 2}) rotate(-90)`,
        'text-anchor': 'middle',
      },
      t.magnitudeFrequency.axisY,
    ),
  );

  const anchor = data.points.find((p) => Math.abs(p.mag - COMPLETENESS_MAG) < 0.05);
  if (data.b && anchor) {
    const at = (mag: number): number =>
      anchor.atLeast * 10 ** (-data.b!.value * (mag - COMPLETENESS_MAG));
    const last = data.points[data.points.length - 1]?.mag ?? maxMag;
    root.append(
      svg('line', {
        class: 'chart__fit',
        x1: x(COMPLETENESS_MAG),
        y1: y(at(COMPLETENESS_MAG)),
        x2: x(last),
        y2: y(Math.max(1, at(last))),
      }),
    );
  }
  for (const point of data.points) {
    root.append(
      svg('circle', {
        class: `chart__dot${point.mag >= COMPLETENESS_MAG ? '' : ' is-incomplete'}`,
        cx: x(point.mag),
        cy: y(point.atLeast),
        r: 3,
      }),
    );
  }
  return root;
}

// -- BMKG against USGS --------------------------------------------------------------------

export function agreementChart(
  pairs: Pair[],
  width: number,
  t: Strings,
  tip: Tooltip,
): SVGSVGElement {
  const margin: Margin = { top: 12, right: 12, bottom: 38, left: 44 };
  const size = Math.min(width, 420);
  const plot = size - margin.left - margin.right;
  const all = pairs.flatMap((p) => [p.bmkg.mag, p.usgs.mag]);
  const low = Math.floor(Math.min(...all, 5) * 2) / 2 - 0.5;
  const high = Math.ceil(Math.max(...all, 6) * 2) / 2 + 0.5;
  const x = (mag: number): number => margin.left + ((mag - low) / (high - low)) * plot;
  const y = (mag: number): number => margin.top + plot - ((mag - low) / (high - low)) * plot;

  const root = svg('svg', {
    class: 'chart chart--agreement',
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    role: 'img',
    'aria-label': t.agreement.scatterLabel(pairs.length),
  });
  for (let m = Math.ceil(low); m <= high; m += 0.5) {
    root.append(
      svg('line', {
        class: 'chart__grid',
        x1: margin.left,
        x2: margin.left + plot,
        y1: y(m),
        y2: y(m),
      }),
      svg('line', {
        class: 'chart__grid chart__grid--v',
        x1: x(m),
        x2: x(m),
        y1: margin.top,
        y2: margin.top + plot,
      }),
      svg(
        'text',
        { class: 'chart__tick', x: margin.left - 6, y: y(m) + 3.5, 'text-anchor': 'end' },
        formatMag(m, t),
      ),
      svg(
        'text',
        { class: 'chart__tick', x: x(m), y: size - 20, 'text-anchor': 'middle' },
        formatMag(m, t),
      ),
    );
  }
  root.append(
    svg('line', { class: 'chart__fit', x1: x(low), y1: y(low), x2: x(high), y2: y(high) }),
    svg(
      'text',
      { class: 'chart__title', x: margin.left + plot / 2, y: size - 4, 'text-anchor': 'middle' },
      t.agreement.axisX,
    ),
    svg(
      'text',
      {
        class: 'chart__title',
        transform: `translate(11 ${margin.top + plot / 2}) rotate(-90)`,
        'text-anchor': 'middle',
      },
      t.agreement.axisY,
    ),
  );
  for (const pair of pairs) {
    const dot = svg('circle', {
      class: 'chart__pair',
      cx: x(pair.usgs.mag),
      cy: y(pair.bmkg.mag),
      r: 4.5,
    });
    dot.addEventListener('pointermove', (event) =>
      tip.show(
        [
          h(
            'div',
            { class: 'tip__head' },
            h('strong', null, `BMKG M${formatMag(pair.bmkg.mag, t)}`),
            h('span', null, `USGS M${formatMag(pair.usgs.mag, t)}`),
          ),
          h('div', { class: 'tip__line' }, pair.usgs.place ?? pair.bmkg.place ?? ''),
          h(
            'div',
            { class: 'tip__line tip__muted' },
            `${formatNumber(pair.distanceKm, t, 0)} km · ${formatNumber(Math.abs(pair.deltaSeconds), t, 0)} s`,
          ),
        ],
        event.clientX,
        event.clientY,
      ),
    );
    dot.addEventListener('pointerleave', () => tip.hide());
    root.append(dot);
  }
  return root;
}
