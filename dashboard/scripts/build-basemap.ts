/**
 * Builds src/basemap.json from Natural Earth (via the world-atlas package): the countries
 * around Indonesia, clipped to the map frame, simplified and projected. Run `npm run basemap`
 * after changing the frame. The output is committed so a normal build needs no network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { FRAME, FRAME_HEIGHT, FRAME_WIDTH, projectX, projectY } from '../src/projection.ts';

const MARGIN = 1;
const TOLERANCE = 0.5; // projected units; one unit is 1/40 of a degree of longitude

const topology = JSON.parse(
  readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url), 'utf8'),
) as Topology;
const countries = feature(
  topology,
  topology.objects['countries'] as GeometryCollection,
) as unknown as {
  features: Feature<Polygon | MultiPolygon>[];
};

type Ring = Position[];

/** Sutherland-Hodgman against one edge of the rectangle. */
function clipEdge(
  ring: Ring,
  inside: (p: Position) => boolean,
  cut: (a: Position, b: Position) => Position,
): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i] as Position;
    const previous = ring[(i + ring.length - 1) % ring.length] as Position;
    if (inside(current)) {
      if (!inside(previous)) out.push(cut(previous, current));
      out.push(current);
    } else if (inside(previous)) {
      out.push(cut(previous, current));
    }
  }
  return out;
}

function clip(ring: Ring): Ring {
  const x0 = FRAME.minLon - MARGIN;
  const x1 = FRAME.maxLon + MARGIN;
  const y0 = FRAME.minLat - MARGIN;
  const y1 = FRAME.maxLat + MARGIN;
  const at = (a: Position, b: Position, axis: 0 | 1, value: number): Position => {
    const t = (value - (a[axis] as number)) / ((b[axis] as number) - (a[axis] as number));
    return [
      axis === 0 ? value : (a[0] as number) + t * ((b[0] as number) - (a[0] as number)),
      axis === 1 ? value : (a[1] as number) + t * ((b[1] as number) - (a[1] as number)),
    ];
  };
  let result = ring;
  const steps: [(p: Position) => boolean, 0 | 1, number][] = [
    [(p) => (p[0] as number) >= x0, 0, x0],
    [(p) => (p[0] as number) <= x1, 0, x1],
    [(p) => (p[1] as number) >= y0, 1, y0],
    [(p) => (p[1] as number) <= y1, 1, y1],
  ];
  for (const [inside, axis, value] of steps) {
    if (result.length === 0) break;
    result = clipEdge(result, inside, (a, b) => at(a, b, axis, value));
  }
  return result;
}

/** Douglas-Peucker on an open polyline. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const first = points[0] as [number, number];
  const last = points[points.length - 1] as [number, number];
  let worst = 0;
  let index = 0;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i] as [number, number];
    const distance =
      Math.abs(dy * p[0] - dx * p[1] + last[0] * first[1] - last[1] * first[0]) / length;
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function path(rings: Ring[]): string {
  let d = '';
  for (const ring of rings) {
    const clipped = clip(ring);
    if (clipped.length < 3) continue;
    const projected = clipped.map((p): [number, number] => [
      projectX(p[0] as number),
      projectY(p[1] as number),
    ]);
    // A closed ring has no usable baseline, so split it at the point farthest from the start.
    const origin = projected[0] as [number, number];
    let far = 1;
    let reach = 0;
    projected.forEach((p, i) => {
      const distance = Math.hypot(p[0] - origin[0], p[1] - origin[1]);
      if (distance > reach) {
        reach = distance;
        far = i;
      }
    });
    const simple = [
      ...simplify(projected.slice(0, far + 1), TOLERANCE).slice(0, -1),
      ...simplify([...projected.slice(far), origin], TOLERANCE).slice(0, -1),
    ];
    if (simple.length < 3) continue;
    d += `M${simple.map(([x, y]) => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join(' ')}Z`;
  }
  return d;
}

const paths: string[] = [];
for (const country of countries.features) {
  const polygons =
    country.geometry.type === 'Polygon'
      ? [country.geometry.coordinates]
      : country.geometry.coordinates;
  // Polygon rings: the first is the outline, the rest are holes (lakes); drawn with even-odd fill.
  const d = polygons.map((rings) => path(rings)).join('');
  if (d) paths.push(d);
}

const output = { width: FRAME_WIDTH, height: FRAME_HEIGHT, paths };
const text = JSON.stringify(output);
writeFileSync(new URL('../src/basemap.json', import.meta.url), text + '\n');
console.log(`${paths.length} countries, ${(text.length / 1024).toFixed(0)} KB`);
