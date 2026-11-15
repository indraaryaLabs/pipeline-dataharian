/**
 * The map projection shared by the basemap build script and the page.
 * Web Mercator in a fixed frame, scaled so one degree of longitude is `UNIT` units wide.
 * Nothing here depends on the DOM.
 */

export interface Extent {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** The frame the basemap is drawn in. Slightly larger than the monitored region. */
export const FRAME: Extent = { minLon: 93.5, maxLon: 142.5, minLat: -12.5, maxLat: 7.5 };

export const UNIT = 40;

const RAD = Math.PI / 180;

function mercator(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / RAD;
}

export function projectX(lon: number): number {
  return (lon - FRAME.minLon) * UNIT;
}

export function projectY(lat: number): number {
  return (mercator(FRAME.maxLat) - mercator(lat)) * UNIT;
}

export const FRAME_WIDTH = (FRAME.maxLon - FRAME.minLon) * UNIT;
export const FRAME_HEIGHT = (mercator(FRAME.maxLat) - mercator(FRAME.minLat)) * UNIT;

/** The rectangle, in projected units, that shows `extent`. */
export function viewBoxFor(extent: Extent): [number, number, number, number] {
  const left = projectX(extent.minLon);
  const top = projectY(extent.maxLat);
  return [left, top, projectX(extent.maxLon) - left, projectY(extent.minLat) - top];
}
