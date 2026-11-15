import { activityChart, agreementChart, frequencyChart } from './charts.ts';
import { fill, h, svg } from './dom.ts';
import {
  ago,
  formatDateLong,
  formatDate,
  formatDepth,
  formatMag,
  formatNumber,
  formatPercent,
  formatUtc,
  hoursSince,
  placeOf,
  span,
} from './format.ts';
import type { Helicorder } from './helicorder.ts';
import { LANGS, type Lang, type Strings } from './i18n.ts';
import type { QuakeMap } from './map.ts';
import {
  activity,
  frequency,
  generatedAtSec,
  helicorder,
  isStale,
  MIN_EVENTS_FOR_B,
  MIN_MAGS,
  newestFirst,
  PERIODS,
  REGIONS,
  select,
  strongestFirst,
  summarize,
  type MinMag,
  type PeriodDays,
  type RegionKey,
  SHALLOW_KM,
} from './model.ts';
import { radius } from './map.ts';
import { watchWidth } from './responsive.ts';
import type { Tooltip } from './tooltip.ts';
import type { CheckStatus, DataDocument, Quake, Run } from './types.ts';

export type Theme = 'light' | 'dark';

export interface State {
  lang: Lang;
  theme: Theme;
  period: PeriodDays;
  minMag: MinMag;
  region: RegionKey;
  selectedId: string | null;
}

export interface Actions {
  setPeriod(value: PeriodDays): void;
  setMinMag(value: MinMag): void;
  setRegion(value: RegionKey): void;
  setLang(value: Lang): void;
  toggleTheme(): void;
  select(id: string | null): void;
  retry(): void;
}

export interface Context {
  t: Strings;
  state: State;
  actions: Actions;
  tip: Tooltip;
  nowMs: number;
  disposers: (() => void)[];
  /** Play the one-time recording reveal on the helicorder. */
  reveal: boolean;
  /** Which <details> the visitor has opened, so a re-render keeps them open. */
  open: Set<string>;
}

function remember(ctx: Context, key: string): Record<string, unknown> {
  return {
    'data-key': key,
    open: ctx.open.has(key),
    onToggle: (event: Event) => {
      const element = event.currentTarget as HTMLDetailsElement;
      if (element.open) ctx.open.add(key);
      else ctx.open.delete(key);
    },
  };
}

export const HELICORDER_DAYS = 30;
const TOP_COUNT = 6;
const TABLE_LIMIT = 200;
export const REPOSITORY = 'https://github.com/indraaryaLabs/pipeline-dataharian';

// -- small pieces -------------------------------------------------------------------------

function mark(): SVGSVGElement {
  const line = (y: number, spikes: [number, number][]): SVGPathElement => {
    let d = `M2 ${y}`;
    for (const [x, amplitude] of spikes)
      d += ` H${x - 1} L${x} ${y - amplitude} L${x + 1} ${y + amplitude} L${x + 2} ${y}`;
    return svg('path', {
      d: `${d} H30`,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  };
  return svg(
    'svg',
    { class: 'mark', viewBox: '0 0 32 24', width: 28, height: 21, 'aria-hidden': 'true' },
    line(5, [[20, 3]]),
    line(12, [
      [9, 5],
      [24, 2],
    ]),
    line(19, [[15, 4]]),
  );
}

function icon(status: CheckStatus | 'ok'): SVGSVGElement {
  const paths: Record<string, string> = {
    pass: 'M3.5 8.5l3 3 6-7',
    ok: 'M3.5 8.5l3 3 6-7',
    warn: 'M8 3.5v5.5M8 11.8v.4',
    fail: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    skip: 'M4 8h8',
  };
  return svg(
    'svg',
    {
      class: `icon icon--${status}`,
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      'aria-hidden': 'true',
    },
    svg('path', {
      d: paths[status] ?? '',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}

function chartHost(ctx: Context, className: string, draw: (width: number) => Node): HTMLElement {
  const element = h('div', { class: className });
  ctx.disposers.push(watchWidth(element, (width) => element.replaceChildren(draw(width))));
  return element;
}

function segmented<T extends string | number>(
  name: string,
  legend: string,
  options: { value: T; label: string }[],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  return h(
    'fieldset',
    { class: 'seg' },
    h('legend', { class: 'seg__legend' }, legend),
    h(
      'div',
      { class: 'seg__options' },
      ...options.map((option) => {
        const id = `${name}-${String(option.value)}`;
        const input = h('input', {
          type: 'radio',
          name,
          id,
          value: String(option.value),
          checked: option.value === current,
          'data-focus': id,
          onChange: () => onChange(option.value),
        });
        input.checked = option.value === current;
        return h('label', { class: 'seg__option', for: id }, input, h('span', null, option.label));
      }),
    ),
  );
}

// -- chrome -------------------------------------------------------------------------------

export function header(ctx: Context): HTMLElement {
  const { t, state, actions } = ctx;
  return h(
    'header',
    { class: 'top' },
    h(
      'div',
      { class: 'top__inner' },
      h(
        'a',
        { class: 'brand', href: './' },
        mark(),
        h('span', { class: 'brand__name' }, t.brand),
        h('span', { class: 'brand__tag' }, t.tagline),
      ),
      h(
        'div',
        { class: 'top__tools' },
        h(
          'div',
          { class: 'lang', role: 'group', 'aria-label': t.language },
          ...LANGS.map((lang) =>
            h(
              'button',
              {
                type: 'button',
                class: 'lang__button',
                lang,
                'aria-pressed': String(state.lang === lang),
                'data-focus': `lang-${lang}`,
                onClick: () => actions.setLang(lang),
              },
              lang.toUpperCase(),
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-button',
            'aria-label': state.theme === 'dark' ? t.theme.toLight : t.theme.toDark,
            'data-focus': 'theme',
            onClick: () => actions.toggleTheme(),
          },
          svg(
            'svg',
            { viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': 'true' },
            svg('path', {
              d:
                state.theme === 'dark'
                  ? 'M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6L15 15M5 15l1.4-1.4M13.6 6.4L15 5'
                  : 'M16 11.5A6.5 6.5 0 018.5 4a6.5 6.5 0 107.5 7.5z',
              fill: state.theme === 'dark' ? 'none' : 'currentColor',
              stroke: 'currentColor',
              'stroke-width': 1.6,
              'stroke-linecap': 'round',
            }),
            state.theme === 'dark'
              ? svg('circle', { cx: 10, cy: 10, r: 3, fill: 'currentColor' })
              : null,
          ),
        ),
      ),
    ),
  );
}

export function footer(t: Strings): HTMLElement {
  return h(
    'footer',
    { class: 'foot' },
    h(
      'div',
      { class: 'wrap foot__inner' },
      h('p', { class: 'foot__about' }, t.footer.about),
      h('ul', { class: 'foot__limits' }, ...t.footer.limits.map((line) => h('li', null, line))),
      h(
        'p',
        { class: 'foot__links' },
        h('a', { href: REPOSITORY, rel: 'noopener' }, t.footer.code),
        h('span', null, t.footer.author),
      ),
    ),
  );
}

export function notices(ctx: Context, doc: DataDocument): HTMLElement | null {
  const { t, nowMs } = ctx;
  const items: HTMLElement[] = [];
  if (isStale(doc, nowMs)) {
    items.push(
      h(
        'p',
        { class: 'notice notice--warn' },
        t.stale(span(hoursSince(doc.generatedAt, nowMs), t)),
      ),
    );
  }
  const run = doc.pipeline.runs[0];
  if (run?.status === 'failed') {
    items.push(
      h(
        'p',
        { class: 'notice notice--warn' },
        t.runFailed(formatUtc(Date.parse(run.startedAt) / 1000, t)),
      ),
    );
  } else if (run?.status === 'partial') {
    items.push(h('p', { class: 'notice' }, t.runPartial));
  }
  return items.length ? h('div', { class: 'notices wrap', role: 'status' }, ...items) : null;
}

// -- hero ---------------------------------------------------------------------------------

function hero(ctx: Context, doc: DataDocument, windowEvents: Quake[]): HTMLElement {
  const { t, state, nowMs } = ctx;
  const summary = summarize(windowEvents);
  const lead: Node[] = [];
  if (summary.strongest) {
    lead.push(
      document.createTextNode(
        t.strongestSentence(
          formatMag(summary.strongest.mag, t),
          placeOf(summary.strongest) || '—',
          formatDateLong(summary.strongest.t, t),
        ),
      ),
      document.createTextNode(' '),
    );
  }
  if (summary.shallowShare !== null) {
    lead.push(
      document.createTextNode(
        t.shallowSentence(formatPercent(summary.shallowShare, t), SHALLOW_KM),
      ),
    );
  }
  return h(
    'section',
    { class: 'hero wrap' },
    h('p', { class: 'hero__updated' }, t.updated(ago(Date.parse(doc.generatedAt), nowMs, t))),
    h(
      'h1',
      { class: 'hero__title' },
      summary.count > 0
        ? t.headline(summary.count, state.minMag, state.period)
        : t.headlineNone(state.minMag, state.period),
    ),
    lead.length ? h('p', { class: 'hero__lead' }, ...lead) : null,
  );
}

function controls(ctx: Context): HTMLElement {
  const { t, state, actions } = ctx;
  return h(
    'div',
    { class: 'controls wrap' },
    segmented(
      'period',
      t.controls.period,
      PERIODS.map((value) => ({ value, label: t.controls.periods[value] })),
      state.period,
      actions.setPeriod,
    ),
    segmented(
      'magnitude',
      t.controls.magnitude,
      MIN_MAGS.map((value) => ({ value, label: t.controls.mags[value] })),
      state.minMag,
      actions.setMinMag,
    ),
  );
}

// -- helicorder + map ---------------------------------------------------------------------

function depthLegend(t: Strings): HTMLElement {
  const item = (kind: 'shallow' | 'mid' | 'deep'): HTMLElement =>
    h(
      'li',
      null,
      h('span', { class: `swatch swatch--${kind}`, 'aria-hidden': 'true' }),
      t.depth.classes[kind],
    );
  const sizes = svg(
    'svg',
    {
      class: 'legend__sizes',
      width: 112,
      height: 28,
      viewBox: '0 0 112 28',
      'aria-hidden': 'true',
    },
    ...[4, 5, 6, 7].map((mag, index) =>
      svg('circle', {
        class: 'legend__circle',
        cx: 10 + index * 30 + (index > 1 ? index * 2 : 0),
        cy: 14,
        r: radius(mag),
      }),
    ),
  );
  return h(
    'div',
    { class: 'legend' },
    h(
      'ul',
      { class: 'legend__depth', 'aria-label': t.depth.title },
      item('shallow'),
      item('mid'),
      item('deep'),
    ),
    h('div', { class: 'legend__size' }, sizes, h('span', null, t.size)),
  );
}

function strongestList(ctx: Context, windowEvents: Quake[]): HTMLElement {
  const { t, state, actions } = ctx;
  const top = strongestFirst(windowEvents, TOP_COUNT);
  return h(
    'div',
    { class: 'top-events' },
    h('h3', { class: 'h3' }, t.events.title),
    top.length === 0
      ? h('p', { class: 'muted' }, t.events.none)
      : h(
          'ol',
          { class: 'top-events__list' },
          ...top.map((q) =>
            h(
              'li',
              null,
              h(
                'button',
                {
                  type: 'button',
                  class: 'top-event',
                  'data-id': q.id,
                  'data-focus': `event-${q.id}`,
                  'aria-pressed': String(q.id === state.selectedId),
                  onClick: () => actions.select(q.id === state.selectedId ? null : q.id),
                },
                h(
                  'span',
                  {
                    class: `top-event__mag top-event__mag--${q.depth < 70 ? 'shallow' : q.depth < 300 ? 'mid' : 'deep'}`,
                  },
                  formatMag(q.mag, t),
                ),
                h(
                  'span',
                  { class: 'top-event__body' },
                  h('span', { class: 'top-event__place' }, placeOf(q)),
                  h(
                    'span',
                    { class: 'top-event__meta' },
                    `${t.depth.title} ${formatDepth(q.depth, t)} · ${formatDate(q.t, t)}`,
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}

function locations(
  ctx: Context,
  quakes: Quake[],
  windowEvents: Quake[],
  doc: DataDocument,
  helico: Helicorder,
  map: QuakeMap,
): HTMLElement {
  const { t, state, actions, tip } = ctx;
  const nowSec = generatedAtSec(doc);
  const rows = helicorder(quakes, nowSec, HELICORDER_DAYS, state.minMag);
  helico.update({
    rows,
    t,
    selectedId: state.selectedId,
    onSelect: actions.select,
    tip,
    reveal: ctx.reveal,
  });
  map.update({
    events: windowEvents,
    region: state.region,
    t,
    selectedId: state.selectedId,
    onSelect: actions.select,
    tip,
  });

  const none = rows.every((row) => row.ticks.length === 0);
  return h(
    'div',
    { class: 'twin wrap' },
    h(
      'section',
      { class: 'panel panel--helico', 'aria-labelledby': 'h-helico' },
      h('h2', { class: 'h2', id: 'h-helico' }, t.helicorder.title),
      h('p', { class: 'muted' }, t.helicorder.intro(HELICORDER_DAYS)),
      none ? h('p', { class: 'empty' }, t.helicorder.empty) : null,
      helico.element,
      h('p', { class: 'hint' }, t.helicorder.keys),
    ),
    h(
      'div',
      { class: 'twin__right' },
      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'h-map' },
        h('h2', { class: 'h2', id: 'h-map' }, t.map.title),
        h('p', { class: 'muted' }, t.map.intro),
        segmented(
          'region',
          t.controls.area,
          REGIONS.map((value) => ({ value, label: t.controls.regions[value] })),
          state.region,
          actions.setRegion,
        ),
        map.element,
        depthLegend(t),
      ),
      h(
        'section',
        { class: 'panel', 'aria-label': t.events.title },
        strongestList(ctx, windowEvents),
      ),
    ),
  );
}

function allEvents(ctx: Context, windowEvents: Quake[]): HTMLElement {
  const { t, state, actions } = ctx;
  const rows = newestFirst(windowEvents).slice(0, TABLE_LIMIT);
  return h(
    'details',
    { class: 'wrap disclosure', ...remember(ctx, 'all-events') },
    h('summary', null, t.events.allTitle(windowEvents.length)),
    windowEvents.length === 0
      ? h('p', { class: 'muted' }, t.events.none)
      : h(
          'div',
          {
            class: 'table-scroll',
            tabindex: '0',
            role: 'region',
            'aria-label': t.events.allTitle(windowEvents.length),
          },
          h(
            'table',
            { class: 'table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { scope: 'col' }, t.events.columns.time),
                h('th', { scope: 'col', class: 'num' }, t.events.columns.mag),
                h('th', { scope: 'col', class: 'num' }, t.events.columns.depth),
                h('th', { scope: 'col' }, t.events.columns.place),
              ),
            ),
            h(
              'tbody',
              null,
              ...rows.map((q) =>
                h(
                  'tr',
                  { class: q.id === state.selectedId ? 'is-selected' : '', 'data-id': q.id },
                  h('td', null, formatUtc(q.t, t)),
                  h('td', { class: 'num' }, formatMag(q.mag, t)),
                  h('td', { class: 'num' }, formatDepth(q.depth, t)),
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'link-button',
                        onClick: () => actions.select(q.id === state.selectedId ? null : q.id),
                      },
                      placeOf(q),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    windowEvents.length > TABLE_LIMIT
      ? h('p', { class: 'hint' }, t.events.note(TABLE_LIMIT))
      : null,
  );
}

// -- activity, frequency, agreement ---------------------------------------------------------

function activitySection(ctx: Context, doc: DataDocument): HTMLElement {
  const { t, state, tip } = ctx;
  const buckets = activity(doc, state.period, state.minMag);
  const total = buckets.reduce((sum, b) => sum + b.counts[0] + b.counts[1] + b.counts[2], 0);
  const weekly = (buckets[0]?.days ?? 1) > 1;
  return h(
    'section',
    { class: 'panel wrap', 'aria-labelledby': 'h-activity' },
    h('h2', { class: 'h2', id: 'h-activity' }, t.activity.title),
    h('p', { class: 'muted' }, t.activity.intro(weekly)),
    total === 0
      ? h('p', { class: 'empty' }, t.activity.none)
      : h(
          'div',
          null,
          h(
            'ul',
            { class: 'legend__bands' },
            ...t.activity.bands.map((label, band) =>
              h(
                'li',
                null,
                h('span', { class: `swatch swatch--band${band}`, 'aria-hidden': 'true' }),
                label,
              ),
            ),
          ),
          chartHost(ctx, 'chart-host', (width) => activityChart(buckets, width, t, tip)),
        ),
  );
}

function frequencySection(ctx: Context, windowEvents: Quake[]): HTMLElement {
  const { t } = ctx;
  const data = frequency(windowEvents);
  const factor = data.b ? 10 ** data.b.value : 0;
  return h(
    'section',
    { class: 'panel wrap split', 'aria-labelledby': 'h-freq' },
    h(
      'div',
      { class: 'split__text' },
      h('h2', { class: 'h2', id: 'h-freq' }, t.magnitudeFrequency.title),
      h('p', { class: 'muted' }, t.magnitudeFrequency.intro),
      data.b
        ? h(
            'p',
            { class: 'finding' },
            t.magnitudeFrequency.result(
              formatNumber(data.b.value, t, 2),
              formatNumber(factor, t, 1),
              formatNumber(data.b.error, t, 2),
              data.b.n,
            ),
          )
        : h(
            'p',
            { class: 'finding finding--quiet' },
            t.magnitudeFrequency.tooFew(MIN_EVENTS_FOR_B),
          ),
    ),
    data.points.length
      ? chartHost(ctx, 'chart-host', (width) => frequencyChart(data, width, t))
      : h('p', { class: 'empty' }, t.events.none),
  );
}

function agreementSection(ctx: Context, doc: DataDocument): HTMLElement {
  const { t, tip } = ctx;
  const check = doc.crosscheck;
  const text: Node[] = [];
  if (check.pairs.length > 0 && check.eligible > 0) {
    text.push(
      h(
        'p',
        { class: 'finding' },
        t.agreement.result(
          check.matched,
          check.eligible,
          formatPercent(check.matched / check.eligible, t),
        ),
      ),
    );
    if (
      check.medianDeltaMag !== null &&
      check.medianDistanceKm !== null &&
      check.medianDeltaSeconds !== null
    ) {
      const direction =
        check.medianDeltaMag > 0.04
          ? t.agreement.bmkgHigher
          : check.medianDeltaMag < -0.04
            ? t.agreement.bmkgLower
            : t.agreement.same;
      text.push(
        h(
          'p',
          { class: 'muted' },
          t.agreement.differences(
            `${formatNumber(Math.abs(check.medianDeltaMag), t, 1)} (${direction})`,
            formatNumber(check.medianDistanceKm, t),
            t.pipeline.seconds(Math.round(Math.abs(check.medianDeltaSeconds))),
          ),
        ),
      );
    }
    if (check.pending > 0) text.push(h('p', { class: 'hint' }, t.agreement.pending(check.pending)));
  } else {
    text.push(h('p', { class: 'finding finding--quiet' }, t.agreement.nothing));
  }
  return h(
    'section',
    { class: 'panel wrap split', 'aria-labelledby': 'h-agree' },
    h(
      'div',
      { class: 'split__text' },
      h('h2', { class: 'h2', id: 'h-agree' }, t.agreement.title),
      h('p', { class: 'muted' }, t.agreement.intro),
      ...text,
      check.unmatched.length > 0
        ? h(
            'details',
            { class: 'disclosure disclosure--inline', ...remember(ctx, 'unmatched') },
            h('summary', null, t.agreement.unmatchedTitle(check.unmatched.length)),
            h('p', { class: 'hint' }, t.agreement.unmatchedNote),
            h(
              'ul',
              { class: 'plain' },
              ...check.unmatched.map((q) =>
                h('li', null, `M${formatMag(q.mag, t)} · ${formatUtc(q.t, t)} · ${q.place ?? ''}`),
              ),
            ),
          )
        : null,
    ),
    check.pairs.length > 0
      ? chartHost(ctx, 'chart-host chart-host--square', (width) =>
          agreementChart(check.pairs, width, t, tip),
        )
      : null,
  );
}

// -- pipeline health -------------------------------------------------------------------------

function runRow(run: Run, t: Strings): HTMLElement {
  return h(
    'tr',
    null,
    h('td', null, formatUtc(Date.parse(run.startedAt) / 1000, t)),
    h('td', null, t.pipeline.modes[run.mode]),
    h(
      'td',
      null,
      h('span', { class: `chip chip--${run.status}` }, t.pipeline.runStatus[run.status]),
    ),
    h('td', { class: 'num' }, `${run.usgs.inserted} / ${run.usgs.updated}`),
    h('td', { class: 'num' }, String(run.bmkg.inserted)),
    h('td', { class: 'num' }, String(run.rejected)),
    h(
      'td',
      { class: 'num' },
      run.durationSeconds === null
        ? '—'
        : t.pipeline.seconds(Math.max(0, Math.round(run.durationSeconds))),
    ),
  );
}

function pipelineSection(ctx: Context, doc: DataDocument): HTMLElement {
  const { t, nowMs } = ctx;
  const { checks, runs, sources, rejects } = doc.pipeline;
  const columns = t.pipeline.columns;
  return h(
    'section',
    { class: 'panel wrap', 'aria-labelledby': 'h-pipeline' },
    h('h2', { class: 'h2', id: 'h-pipeline' }, t.pipeline.title),
    h('p', { class: 'muted' }, t.pipeline.intro),
    h(
      'div',
      { class: 'health' },
      h(
        'div',
        null,
        h('h3', { class: 'h3' }, t.pipeline.checks),
        h(
          'ul',
          { class: 'checks' },
          ...checks.map((check) =>
            h(
              'li',
              { class: `check check--${check.status}` },
              icon(check.status),
              h('span', { class: 'check__name' }, t.pipeline.checkNames[check.name] ?? check.name),
              h('span', { class: 'check__status' }, t.pipeline.checkStatus[check.status]),
              h('span', { class: 'check__detail' }, check.detail),
            ),
          ),
        ),
      ),
      h(
        'div',
        null,
        h('h3', { class: 'h3' }, t.pipeline.sources),
        h(
          'ul',
          { class: 'sources' },
          ...sources.map((source) =>
            h(
              'li',
              null,
              h('a', { href: source.url, rel: 'noopener' }, source.name),
              h(
                'span',
                { class: 'muted' },
                [
                  source.lastSuccessAt
                    ? t.pipeline.lastSuccess(ago(Date.parse(source.lastSuccessAt), nowMs, t))
                    : t.pipeline.never,
                  source.latestEventAt
                    ? t.pipeline.latestEvent(ago(Date.parse(source.latestEventAt), nowMs, t))
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ),
          ),
        ),
        h('h3', { class: 'h3' }, t.pipeline.rejects),
        rejects.length === 0
          ? h('p', { class: 'muted' }, t.pipeline.noRejects)
          : h(
              'ul',
              { class: 'plain' },
              ...rejects.map((r) =>
                h(
                  'li',
                  null,
                  `${r.source.toUpperCase()}: ${t.pipeline.rejectReasons[r.reason] ?? r.reason} (${r.count})`,
                ),
              ),
            ),
      ),
    ),
    h('h3', { class: 'h3' }, t.pipeline.runs),
    h(
      'div',
      { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': t.pipeline.runs },
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, columns.when),
            h('th', { scope: 'col' }, columns.mode),
            h('th', { scope: 'col' }, columns.status),
            h('th', { scope: 'col', class: 'num' }, columns.usgs),
            h('th', { scope: 'col', class: 'num' }, columns.bmkg),
            h('th', { scope: 'col', class: 'num' }, columns.rejected),
            h('th', { scope: 'col', class: 'num' }, columns.took),
          ),
        ),
        h('tbody', null, ...runs.map((run) => runRow(run, t))),
      ),
    ),
  );
}

// -- whole page -----------------------------------------------------------------------------

export function dashboard(
  ctx: Context,
  doc: DataDocument,
  quakes: Quake[],
  helico: Helicorder,
  map: QuakeMap,
): HTMLElement[] {
  const nowSec = generatedAtSec(doc);
  const windowEvents = select(quakes, nowSec, ctx.state.period, ctx.state.minMag);
  return [
    notices(ctx, doc),
    hero(ctx, doc, windowEvents),
    controls(ctx),
    locations(ctx, quakes, windowEvents, doc, helico, map),
    allEvents(ctx, windowEvents),
    activitySection(ctx, doc),
    frequencySection(ctx, windowEvents),
    agreementSection(ctx, doc),
    pipelineSection(ctx, doc),
  ].filter((node): node is HTMLElement => node !== null);
}

export function skeleton(t: Strings): HTMLElement {
  return h(
    'div',
    { class: 'wrap skeleton', role: 'status', 'aria-label': t.loading },
    h('div', { class: 'skeleton__line skeleton__line--short' }),
    h('div', { class: 'skeleton__line skeleton__line--title' }),
    h('div', { class: 'skeleton__line skeleton__line--title' }),
    h('div', { class: 'skeleton__block' }),
  );
}

export function problem(ctx: Context, kind: 'network' | 'format'): HTMLElement {
  const { t, actions } = ctx;
  const copy = kind === 'network' ? t.loadFailed : t.badFormat;
  return h(
    'section',
    { class: 'wrap problem', role: 'alert' },
    h('h1', { class: 'hero__title' }, copy.title),
    h('p', { class: 'hero__lead' }, copy.body),
    kind === 'network'
      ? h(
          'button',
          {
            type: 'button',
            class: 'button',
            'data-focus': 'retry',
            onClick: () => actions.retry(),
          },
          t.loadFailed.retry,
        )
      : null,
  );
}

export { fill };
