// Grid collision helpers shared by enemies: circle vs blocked tile edges, line of sight, BFS paths.
import { G } from '../core/globals.js';

// (a looping map: cells past an edge are those on the other side)
function validW(x, y) { return G.map.validW(x, y); }
// edge passability for non-player movers (events/enemies): region 50 is open for them
function edgeOpen(x, y, d) {
  const m = G.map;
  const g = m.grid;
  const dx = d === 4 ? -1 : d === 6 ? 1 : 0, dy = d === 8 ? -1 : d === 2 ? 1 : 0;
  x = m.wrapX(x); y = m.wrapY(y);
  const x2 = m.wrapX(x + dx), y2 = m.wrapY(y + dy);
  if (!g.valid(x, y) || !g.valid(x2, y2)) return false;
  // (the dark opened round a boss fight - arena.js)
  if ((G.arena?.opens(x2, y2) || G.arena?.opens(x, y)) && m.walkable(x, y) && m.walkable(x2, y2)) return true;
  const fake = { isPlayer: false };
  return m.passableFor(fake, x, y, d) && m.passableFor(fake, x2, y2, 10 - d);
}

const edgeCache = new Map();
export function clearEdgeCache() { edgeCache.clear(); }
export function edgeOpenCached(x, y, d) {
  x = G.map.wrapX(x); y = G.map.wrapY(y);
  const k = (x * 4096 + y) * 10 + d;
  let v = edgeCache.get(k);
  if (v === undefined) { v = edgeOpen(x, y, d); edgeCache.set(k, v); }
  return v;
}

// Resolve circle at continuous tile coords (fx, fy; tile centre = integer) with radius r (tiles)
export function resolveCircle(fx, fy, r) {
  let px = fx + 0.5, py = fy + 0.5;
  const g = G.map.grid;
  for (let iter = 0; iter < 3; iter++) {
    const cx = Math.floor(px), cy = Math.floor(py);
    let moved = false;
    const span = Math.ceil(r) + 1;
    for (let j = cy - span; j <= cy + span; j++) {
      for (let i = cx - span; i <= cx + span; i++) {
        const inA = validW(i, j);
        // right edge of (i,j)
        const inR = validW(i + 1, j);
        if ((inA || inR) && (!inA || !inR || !edgeOpenCached(i, j, 6))) {
          const res = push(px, py, i + 1, j, i + 1, j + 1, r);
          if (res) { px = res[0]; py = res[1]; moved = true; }
        }
        const inB = validW(i, j + 1);
        if ((inA || inB) && (!inA || !inB || !edgeOpenCached(i, j, 2))) {
          const res = push(px, py, i, j + 1, i + 1, j + 1, r);
          if (res) { px = res[0]; py = res[1]; moved = true; }
        }
      }
    }
    if (!moved) break;
  }
  return [px - 0.5, py - 0.5];
}
function push(px, py, ax, ay, bx, by, r) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const qx = ax + abx * t, qy = ay + aby * t;
  const dx = px - qx, dy = py - qy;
  const d = Math.hypot(dx, dy);
  if (d >= r || d < 1e-6) return null;
  return [qx + dx / d * r, qy + dy / d * r];
}

// a cell no mover can be in: its own tile lets no one out of any side (a pillar, a wall mass, deep water) and no
// boss arena opened it (cached with the edges: key d 0)
function cellShut(x, y) {
  const m = G.map;
  x = m.wrapX(x); y = m.wrapY(y);
  const k = (x * 4096 + y) * 10;
  let v = edgeCache.get(k);
  if (v === undefined) {
    const fake = { isPlayer: false };
    v = m.grid.valid(x, y) && !G.arena?.opens(x, y) && ![2, 4, 6, 8].some(d => m.passableFor(fake, x, y, d));
    edgeCache.set(k, v);
  }
  return v;
}

// Grid walk (DDA) between tile-centre coordinates; true if no blocked edge is crossed. leave: a start inside such
// cells (a flier over a pillar, a boss chasing through a wall) does not shut the line in - it runs out of that block
// freely, and edges count from the first open cell on
export function lineOfSight(x0, y0, x1, y1, leave = false) {
  let x = Math.round(x0), y = Math.round(y0);
  const tx = Math.round(x1), ty = Math.round(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const px = x0 + 0.5, py = y0 + 0.5;
  const tDeltaX = stepX ? Math.abs(1 / dx) : Infinity, tDeltaY = stepY ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX ? ((stepX > 0 ? Math.floor(px) + 1 - px : px - Math.floor(px)) * tDeltaX) : Infinity;
  let tMaxY = stepY ? ((stepY > 0 ? Math.floor(py) + 1 - py : py - Math.floor(py)) * tDeltaY) : Infinity;
  let inside = leave && cellShut(x, y);
  for (let guard = 0; guard < 200; guard++) {
    if (x === tx && y === ty) return true;
    if (tMaxX < tMaxY) {
      if (tMaxX > 1) return true;
      if (!inside && !edgeOpenCached(stepX > 0 ? x : x - 1, y, 6)) return false;
      x += stepX; tMaxX += tDeltaX;
    } else {
      if (tMaxY > 1) return true;
      if (!inside && !edgeOpenCached(x, stepY > 0 ? y : y - 1, 2)) return false;
      y += stepY; tMaxY += tDeltaY;
    }
    inside &&= cellShut(x, y);
  }
  return true;
}

// BFS next waypoint from (sx,sy) toward (tx,ty) on the tile grid (max radius limit)
export function nextStep(sx, sy, tx, ty, limit = 24) {
  const g = G.map.grid;
  sx = Math.round(sx); sy = Math.round(sy); tx = Math.round(tx); ty = Math.round(ty);
  if (sx === tx && sy === ty) return null;
  const key = (x, y) => x * 4096 + y;
  const prev = new Map();
  const q = [[sx, sy]];
  prev.set(key(sx, sy), null);
  let found = false;
  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) { found = true; break; }
    if (Math.abs(x - sx) > limit || Math.abs(y - sy) > limit) continue;
    for (const [d, dx, dy] of [[2, 0, 1], [4, -1, 0], [6, 1, 0], [8, 0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!validW(nx, ny) || prev.has(key(nx, ny))) continue;
      const ok = d === 6 ? edgeOpenCached(x, y, 6) : d === 4 ? edgeOpenCached(nx, ny, 6) : d === 2 ? edgeOpenCached(x, y, 2) : edgeOpenCached(nx, ny, 2);
      if (!ok) continue;
      prev.set(key(nx, ny), [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!found) return null;
  let cur = [tx, ty];
  let p = prev.get(key(cur[0], cur[1]));
  while (p && !(p[0] === sx && p[1] === sy)) { cur = p; p = prev.get(key(cur[0], cur[1])); }
  return { x: cur[0], y: cur[1] };
}
