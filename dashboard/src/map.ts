import basemap from './basemap.json' with { type: 'json' };
import { h, svg } from './dom.ts';
import { depthClass, REGION_BOUNDS, type Bounds, type RegionKey } from './model.ts';
import { projectX, projectY } from './projection.ts';
import { quakeTip } from './quake-label.ts';
import { watchWidth } from './responsive.ts';
import type { Strings } from './i18n.ts';
import type { Tooltip } from './tooltip.ts';
import type { Quake } from './types.ts';

export interface MapInput {
  events: Quake[];
  region: RegionKey;
  t: Strings;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tip: Tooltip;
}

export interface QuakeMap {
  element: HTMLElement;
  update(input: MapInput): void;
  destroy(): void;
}

const MAX_HEIGHT = 460;
const GRID = 5;

export function radius(mag: number): number {
  return 2.6 + Math.max(0, mag - 4) * 3.2;
}

function fit(
  bounds: Bounds,
  width: number,
): { w: number; h: number; scale: number; left: number; top: number } {
  const left = projectX(bounds.minLon);
  const top = projectY(bounds.maxLat);
  const spanX = projectX(bounds.maxLon) - left;
  const spanY = projectY(bounds.minLat) - top;
  const height = Math.min(MAX_HEIGHT, Math.round((width * spanY) / spanX));
  const scale = Math.min(width / spanX, height / spanY);
  return {
    w: width,
    h: height,
    scale,
    left: left - (width / scale - spanX) / 2,
    top: top - (height / scale - spanY) / 2,
  };
}

export function createMap(): QuakeMap {
  let input: MapInput | null = null;
  let width = 0;
  const surface = h('div', { class: 'map__surface' });
  const element = h('div', { class: 'map' }, surface);

  function draw(): void {
    if (!input || width === 0) return;
    const { events, region, t, selectedId } = input;
    const view = fit(REGION_BOUNDS[region], width);
    const px = (lon: number): number => (projectX(lon) - view.left) * view.scale;
    const py = (lat: number): number => (projectY(lat) - view.top) * view.scale;
    const bounds = REGION_BOUNDS[region];

    const root = svg('svg', {
      class: 'map__svg',
      width: view.w,
      height: view.h,
      viewBox: `0 0 ${view.w} ${view.h}`,
      role: 'img',
      'aria-label': t.map.label(events.length),
    });
    root.append(svg('rect', { class: 'map__sea', width: view.w, height: view.h }));

    const land = svg('g', {
      class: 'map__land',
      transform: `scale(${view.scale}) translate(${-view.left} ${-view.top})`,
    });
    for (const d of basemap.paths) land.append(svg('path', { d, 'fill-rule': 'evenodd' }));
    root.append(land);

    // Graticule every 5 degrees, labelled along the top and left edges.
    const grid = svg('g', { class: 'map__grid' });
    const firstLon = Math.ceil(bounds.minLon / GRID) * GRID;
    for (let lon = firstLon; lon <= 142; lon += GRID) {
      const x = px(lon);
      if (x < 4 || x > view.w - 4) continue;
      grid.append(svg('line', { x1: x, x2: x, y1: 0, y2: view.h }));
      // Keep labels clear of the latitude labels on the left and the clipped right edge.
      if (x > 44 && x < view.w - 44) grid.append(svg('text', { x: x + 4, y: 11 }, `${lon}°E`));
    }
    for (let lat = Math.ceil(-12 / GRID) * GRID; lat <= 10; lat += GRID) {
      const y = py(lat);
      if (y < 4 || y > view.h - 4) continue;
      grid.append(svg('line', { x1: 0, x2: view.w, y1: y, y2: y }));
      if (y > 24) {
        grid.append(
          svg('text', { x: 4, y: y - 4 }, `${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`),
        );
      }
    }
    root.append(grid);

    const points = svg('g', { class: 'map__points' });
    const shown = events
      .filter((q) => q.lon >= bounds.minLon - 1 && q.lon <= bounds.maxLon + 1)
      .filter((q) => q.lat >= bounds.minLat - 1 && q.lat <= bounds.maxLat + 1)
      .sort((a, b) => b.mag - a.mag || a.t - b.t);
    for (const q of shown) {
      points.append(
        svg('circle', {
          class: `map__quake map__quake--${depthClass(q.depth)}${q.id === selectedId ? ' is-selected' : ''}`,
          cx: px(q.lon),
          cy: py(q.lat),
          r: radius(q.mag),
          'data-id': q.id,
        }),
      );
    }
    root.append(points);

    const picked = shown.find((q) => q.id === selectedId);
    if (picked) {
      root.append(
        svg('circle', {
          class: 'map__ring',
          cx: px(picked.lon),
          cy: py(picked.lat),
          r: radius(picked.mag) + 5,
        }),
      );
    }

    const lookup = new Map(shown.map((q) => [q.id, q]));
    const quakeAt = (event: Event): Quake | undefined => {
      const target = event.target as Element | null;
      const id = target?.getAttribute?.('data-id');
      return id ? lookup.get(id) : undefined;
    };
    root.addEventListener('pointermove', (event) => {
      const quake = quakeAt(event);
      if (quake) input?.tip.show(quakeTip(quake, t), event.clientX, event.clientY);
      else input?.tip.hide();
    });
    root.addEventListener('pointerleave', () => input?.tip.hide());
    root.addEventListener('click', (event) => {
      const quake = quakeAt(event);
      input?.onSelect(quake && quake.id !== selectedId ? quake.id : null);
    });

    surface.replaceChildren(root);
  }

  const stop = watchWidth(surface, (value) => {
    width = value;
    draw();
  });

  return {
    element,
    update(next) {
      input = next;
      draw();
    },
    destroy: stop,
  };
}
