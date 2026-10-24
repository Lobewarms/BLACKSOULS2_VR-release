import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';

// Sprites may sit on a support face rather than at their original map cell.
// Keep action targeting on that visible position, in the map's tile-centre units.
export function eventActionPosition(ev, map = G.map, reference = map?.playerChar) {
  const view = ev?.viewPos;
  let x = Number.isFinite(view?.x) && Number.isFinite(view?.z) ? view.x / T - 0.5 : ev?.realX;
  let y = Number.isFinite(view?.x) && Number.isFinite(view?.z) ? view.z / T - 0.5 : ev?.realY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rx = reference?.fx ?? reference?.x, ry = reference?.fy ?? reference?.y;
  if (Number.isFinite(rx)) x = map?.nearX?.(x, rx) ?? x;
  if (Number.isFinite(ry)) y = map?.nearY?.(y, ry) ?? y;
  return { x, y };
}
