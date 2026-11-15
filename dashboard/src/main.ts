import '@fontsource-variable/familjen-grotesk/wght.css';
import '@fontsource-variable/public-sans/wght.css';
import './styles.css';
import { DataError, loadData } from './api.ts';
import { h } from './dom.ts';
import { createHelicorder } from './helicorder.ts';
import { detectLang, STRINGS, type Lang } from './i18n.ts';
import { createMap } from './map.ts';
import {
  decodeEvents,
  MIN_MAGS,
  PERIODS,
  REGIONS,
  type MinMag,
  type PeriodDays,
  type RegionKey,
} from './model.ts';
import { createTooltip } from './tooltip.ts';
import type { DataDocument, Quake } from './types.ts';
import {
  dashboard,
  footer,
  header,
  problem,
  skeleton,
  type Actions,
  type Context,
  type State,
  type Theme,
} from './view.ts';

const mount = document.getElementById('app');
if (!mount) throw new Error('Missing #app');
const root: HTMLElement = mount;

const tip = createTooltip();
const helico = createHelicorder();
const map = createMap();

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}

function fromHash(): Partial<Pick<State, 'period' | 'minMag' | 'region'>> {
  const params = new URLSearchParams(location.hash.slice(1));
  const period = Number(params.get('period'));
  const mag = Number(params.get('mag'));
  const area = params.get('area');
  return {
    ...(PERIODS.includes(period as PeriodDays) ? { period: period as PeriodDays } : {}),
    ...(MIN_MAGS.includes(mag as MinMag) ? { minMag: mag as MinMag } : {}),
    ...(REGIONS.includes(area as RegionKey) ? { region: area as RegionKey } : {}),
  };
}

const initialTheme: Theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';

const state: State = {
  lang: detectLang(stored('gh-lang'), navigator.languages ?? [navigator.language]),
  theme: initialTheme,
  period: 30,
  minMag: 4,
  region: 'all',
  selectedId: null,
  ...fromHash(),
};

let doc: DataDocument | null = null;
let quakes: Quake[] = [];
let failure: 'network' | 'format' | null = null;
let loadedAt = 0;
let reveal = true;
let disposers: (() => void)[] = [];
const open = new Set<string>();

function writeHash(): void {
  const params = new URLSearchParams({
    period: String(state.period),
    mag: String(state.minMag),
    area: state.region,
  });
  history.replaceState(null, '', `#${params.toString()}`);
}

const actions: Actions = {
  setPeriod(value) {
    state.period = value;
    state.selectedId = null;
    writeHash();
    render();
  },
  setMinMag(value) {
    state.minMag = value;
    state.selectedId = null;
    writeHash();
    render();
  },
  setRegion(value) {
    state.region = value;
    writeHash();
    render();
  },
  setLang(value: Lang) {
    state.lang = value;
    store('gh-lang', value);
    render();
  },
  toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset['theme'] = state.theme;
    store('gh-theme', state.theme);
    render();
  },
  select(id) {
    state.selectedId = id;
    render();
  },
  retry() {
    void load();
  },
};

function render(): void {
  const focused = document.activeElement?.getAttribute('data-focus') ?? null;
  const scroll = window.scrollY;
  for (const dispose of disposers) dispose();
  disposers = [];
  tip.hide();

  const t = STRINGS[state.lang];
  document.documentElement.lang = t.htmlLang;
  document.title = t.documentTitle;

  const ctx: Context = { t, state, actions, tip, nowMs: Date.now(), disposers, reveal, open };
  const main = h('main', { id: 'main', tabindex: '-1' });
  if (failure) main.append(problem(ctx, failure));
  else if (!doc) main.append(skeleton(t));
  else {
    main.append(...dashboard(ctx, doc, quakes, helico, map));
    reveal = false;
  }
  root.replaceChildren(
    h('a', { class: 'skip', href: '#main' }, t.skip),
    header(ctx),
    main,
    footer(t),
  );

  if (focused) {
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-focus]')).find(
      (element) => element.getAttribute('data-focus') === focused,
    );
    target?.focus({ preventScroll: true });
  }
  window.scrollTo({ top: scroll });
}

async function load(): Promise<void> {
  failure = null;
  if (!doc) render();
  try {
    doc = await loadData();
    quakes = decodeEvents(doc);
    loadedAt = Date.now();
  } catch (error) {
    if (!doc) failure = error instanceof DataError ? error.kind : 'network';
  }
  render();
}

// Keep "updated 3 hours ago" honest, and pick up the next daily refresh without a reload.
window.setInterval(() => {
  if (!doc) return;
  if (Date.now() - loadedAt > 3_600_000) void load();
  else render();
}, 600_000);

void load();
