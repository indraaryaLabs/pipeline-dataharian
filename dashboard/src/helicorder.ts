import { svg, h } from './dom.ts';
import { formatDay, formatMag } from './format.ts';
import type { Strings } from './i18n.ts';
import { depthClass, type HelicorderRow, type Tick } from './model.ts';
import { quakeTip } from './quake-label.ts';
import type { Tooltip } from './tooltip.ts';
import { watchWidth } from './responsive.ts';

export interface HelicorderInput {
  rows: HelicorderRow[];
  t: Strings;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tip: Tooltip;
  /** Play the one-time "recording" reveal. */
  reveal: boolean;
}

export interface Helicorder {
  element: HTMLElement;
  update(input: HelicorderInput): void;
  destroy(): void;
}

const GUIDES = [0, 0.25, 0.5, 0.75, 1];
const NEAR_PX = 7;

function tickHalfHeight(mag: number, rowHeight: number): number {
  return Math.min(rowHeight / 2 - 1.5, 2 + Math.max(0, mag - 4) * 3.4);
}

export function createHelicorder(): Helicorder {
  let input: HelicorderInput | null = null;
  let width = 0;
  let active = -1;

  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const surface = h('div', { class: 'helico__surface' });
  const element = h('div', { class: 'helico', tabindex: '0', role: 'group' }, surface, live);

  const summary = (row: HelicorderRow, t: Strings): string => {
    const top = row.ticks.reduce<Tick | null>(
      (best, tick) => (!best || tick.quake.mag > best.quake.mag ? tick : best),
      null,
    );
    return t.helicorder.rowSummary(
      formatDay(row.start, t),
      row.ticks.length,
      top ? `M${formatMag(top.quake.mag, t)}` : null,
    );
  };

  function draw(): void {
    if (!input || width === 0) return;
    const { rows, t, selectedId, reveal } = input;
    input.reveal = false; // the reveal plays once, however often the chart is redrawn
    const compact = width < 440;
    const labelWidth = compact ? 40 : 54;
    const rowHeight = compact ? 17 : 20;
    const top = 24;
    const right = 8;
    const plot = width - labelWidth - right;
    const height = top + rows.length * rowHeight + 8;
    const x = (at: number): number => labelWidth + at * plot;

    element.setAttribute('aria-label', `${t.helicorder.group}. ${t.helicorder.keys}`);

    const root = svg('svg', {
      class: reveal ? 'helico__svg is-recording' : 'helico__svg',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });

    // Hour guides and labels
    GUIDES.forEach((at, index) => {
      const hour = String(Math.round(at * 24)).padStart(2, '0');
      root.append(
        svg('line', { class: 'helico__guide', x1: x(at), x2: x(at), y1: top - 4, y2: height - 6 }),
        svg(
          'text',
          {
            class: 'helico__axis',
            x: x(at),
            y: 12,
            'text-anchor': index === 0 ? 'start' : index === GUIDES.length - 1 ? 'end' : 'middle',
          },
          hour,
        ),
      );
    });

    const rowsLayer = svg('g');
    rows.forEach((row, index) => {
      const cy = top + index * rowHeight + rowHeight / 2;
      const last = index === rows.length - 1;
      const group = svg('g', {
        class: `helico__row${index === active ? ' is-active' : ''}${last ? ' is-today' : ''}`,
        'data-row': index,
        style: `--i:${index}`,
      });
      group.append(
        svg('rect', {
          class: 'helico__band',
          x: labelWidth,
          y: cy - rowHeight / 2,
          width: plot,
          height: rowHeight,
        }),
        svg('line', { class: 'helico__base', x1: x(0), x2: x(row.elapsed), y1: cy, y2: cy }),
      );
      if (row.elapsed < 1) {
        group.append(
          svg(
            'rect',
            {
              class: 'helico__future',
              x: x(row.elapsed),
              y: cy - rowHeight / 2 + 1,
              width: plot * (1 - row.elapsed),
              height: rowHeight - 2,
            },
            svg('title', null, t.helicorder.notYet),
          ),
        );
      }
      for (const tick of row.ticks) {
        const half = tickHalfHeight(tick.quake.mag, rowHeight);
        const picked = tick.quake.id === selectedId;
        group.append(
          svg('line', {
            class: `helico__tick helico__tick--${depthClass(tick.quake.depth)}${picked ? ' is-selected' : ''}${tick.quake.mag >= 6 ? ' is-strong' : ''}`,
            x1: x(tick.at),
            x2: x(tick.at),
            y1: cy - half,
            y2: cy + half,
          }),
        );
      }
      group.append(
        svg(
          'text',
          {
            class: `helico__label${last ? ' is-today' : ''}`,
            x: labelWidth - 8,
            y: cy + 3.5,
            'text-anchor': 'end',
          },
          formatDay(row.start, t),
        ),
      );
      rowsLayer.append(group);
    });
    root.append(rowsLayer);

    const locate = (event: PointerEvent): { row: number; tick: Tick | null } => {
      const box = root.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      const row = Math.floor((py - top) / rowHeight);
      const data = rows[row];
      if (!data || py < top) return { row: -1, tick: null };
      let best: Tick | null = null;
      let distance = NEAR_PX;
      for (const tick of data.ticks) {
        const gap = Math.abs(x(tick.at) - px);
        if (gap <= distance) {
          best = tick;
          distance = gap;
        }
      }
      return { row, tick: best };
    };

    root.addEventListener('pointermove', (event) => {
      const { row, tick } = locate(event);
      const data = rows[row];
      if (!data) {
        input?.tip.hide();
        return;
      }
      if (tick) input?.tip.show(quakeTip(tick.quake, t), event.clientX, event.clientY);
      else
        input?.tip.show(
          [h('div', { class: 'tip__line' }, summary(data, t))],
          event.clientX,
          event.clientY,
        );
    });
    root.addEventListener('pointerleave', () => input?.tip.hide());
    root.addEventListener('click', (event) => {
      const { tick } = locate(event as PointerEvent);
      if (tick) input?.onSelect(tick.quake.id === selectedId ? null : tick.quake.id);
    });

    surface.replaceChildren(root);
  }

  element.addEventListener('keydown', (event) => {
    if (!input) return;
    const count = input.rows.length;
    let next: number;
    if (event.key === 'ArrowDown') next = active < 0 ? count - 1 : Math.min(count - 1, active + 1);
    else if (event.key === 'ArrowUp') next = active < 0 ? count - 1 : Math.max(0, active - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    active = next;
    const row = input.rows[active];
    if (row) live.textContent = summary(row, input.t);
    draw();
  });
  element.addEventListener('blur', () => {
    active = -1;
    draw();
  });

  const stop = watchWidth(surface, (value) => {
    width = value;
    draw();
  });

  return {
    element,
    update(next) {
      input = next;
      if (active >= next.rows.length) active = -1;
      draw();
    },
    destroy: stop,
  };
}
