import { h } from './dom.ts';
import { formatDepth, formatLocal, formatMag, formatUtc, placeOf } from './format.ts';
import type { Strings } from './i18n.ts';
import type { Quake } from './types.ts';

/** The tooltip body for one earthquake. */
export function quakeTip(q: Quake, t: Strings): Node[] {
  return [
    h(
      'div',
      { class: 'tip__head' },
      h('strong', { class: 'tip__mag' }, `M${formatMag(q.mag, t)}`),
      h('span', null, placeOf(q)),
    ),
    h('div', { class: 'tip__line' }, `${t.depth.title} ${formatDepth(q.depth, t)}`),
    h('div', { class: 'tip__line tip__muted' }, `${formatUtc(q.t, t)} · ${formatLocal(q.t, t)}`),
  ];
}
