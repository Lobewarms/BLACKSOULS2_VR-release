// Building a map, its fourth stage: what the falls and lifts tell - a fall n rows down the screen lands n tiles lower, so
// the areas a fall joins are put at their heights (side-view towers too), pits and chutes go down, lifts climb; then
// where each solid's art starts and ends (its base and top), and floorAt - the floor's height anywhere on the map.
import * as THREE from 'three';
import { TILE, isWallTop } from '../tiles.js';

export function applyFalls(M) {
  const { N4, PARAPET, SOLID_LOW, SOLID_MASS, SOLID_VOID, baseH, chuteCell, chutes, cliffBase, cliffFace, cliffL,
      cliffTop, cliffU, empty, faceUp, floorE, grid, h, height, hg, idx, isFloor, isFloorIdx, isSide, isSolid, liftCell,
      lipH, objType, opts, pit, raisedTop, slope, solid, surfNArr, surfSArr, tileAvg, valid, w, wallKind } = M;
  let { OPEN_LEVEL } = M;
  // ---- falls tell heights. A fall event that slides the player n rows down the screen from an area
  // lands n tiles lower (or into nothing n tiles down). Areas (walkable cells, joined into rooms when
  // they touch) get their heights from those drops and the narrow passages between them (stairs,
  // ladders) slope from one to the other. Stepping off a ledge's edge opens what the fall passes into
  // a drop; a fall that starts beside a ledge's end slides down along the wall in 2D, and that wall
  // stays a wall. Everything else that cannot be walked on stays as it is drawn.
  //  side views (maphints.js `sideView`, the Room of Falling): a tower whose bricks rise to its top.
  const sideTop = new Map();          // solid cell -> its top, once the walls of a side view are known
  let sideAirDepth = null;
  let sideRowH = null;                // side view: the height a row of the drawing stands for
  let sideBox = null;
  let shaft = null;                   // other maps: cells opened into the drop off a ledge
  let shaftTop = null, shaftRowH = null, shaftDepth = null;
  const fallStats = { edges: 0, drops: 0, shaft: 0, raised: 0, pillars: 0 };
  for (let i = 0; i < w * h; i++) if (liftCell[i] || chuteCell[i]) { solid[i] = 0; empty[i] = 0; pit[i] = 0; isSide[i] = 0; wallKind[i] = -1; raisedTop[i] = 0; }
  if (opts.falls?.some(f => f.dir === 1) || opts.lifts?.length) {
    const tower = !!opts.sideView;
    const walk = i => !solid[i] && !empty[i] && !pit[i] && grid.anyPassable(i % w, (i / w) | 0);
    // the player can step between the two cells (each passable toward the other, as in the original)
    const OPP_DIR = { 2: 8, 4: 6, 6: 4, 8: 2 };
    const link = (x, y, dx, dy, d) => {
      const xx = x + dx, yy = y + dy;
      return valid(x, y) && valid(xx, yy) && walk(idx(x, y)) && walk(idx(xx, yy)) && grid.passable(x, y, d) && grid.passable(xx, yy, OPP_DIR[d]);
    };
    const STEPS = [[0, 1, 2], [-1, 0, 4], [1, 0, 6], [0, -1, 8]];
    const runLen = new Int32Array(w * h);
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!walk(idx(x, y))) { x++; continue; }
        let x1 = x + 1;
        while (x1 < w && link(x1 - 1, y, 1, 0, 6)) x1++;
        for (let k = x; k < x1; k++) runLen[idx(k, y)] = x1 - x;
        x = x1;
      }
    }
    // (maphints stairs: a flight as wide as a corridor is a climb between floors, never floor joining them)
    const stairSet = opts.stairs ? new Set(opts.stairs.map(n => TILE.A5 + n)) : null;
    const stairAt = i => !!stairSet && (stairSet.has(grid.tile(i % w, (i / w) | 0, 0)) || stairSet.has(grid.tile(i % w, (i / w) | 0, 1)));
    const flat = i => walk(i) && runLen[i] >= 3 && !stairAt(i);
    const narrow = i => walk(i) && (runLen[i] < 3 || stairAt(i));
    const node = new Int32Array(w * h).fill(-1);
    const nodeSize = [], nodeRows = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!flat(s0) || node[s0] >= 0) continue;
      const id = nodeSize.length;
      const q = [s0]; node[s0] = id;
      const rows = new Set();
      let n = 0;
      while (q.length) {
        const j = q.pop(); n++;
        const x = j % w, y = (j / w) | 0;
        rows.add(y);
        for (const [dx, dy, d] of STEPS) {
          if (!link(x, y, dx, dy, d)) continue;
          const k = idx(x + dx, y + dy);
          if (node[k] < 0 && flat(k)) { node[k] = id; q.push(k); }
        }
      }
      nodeSize.push(n); nodeRows.push(rows.size);
    }
    const edges = [];
    const ends = [];                                                // cells the falls leave from / land on
    const air = new Set();
    const drops = [];                                               // falls off a ledge's edge
    for (const f of opts.falls) {
      if (f.dir !== 1) continue;                                   // a slide down the screen
      let from = -1, climbed = false;                              // (stepped on from any side)
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        let fx = f.x + dx, fy = f.y + dy;
        if (!valid(fx, fy) || !walk(idx(fx, fy))) continue;
        // on a narrow way (a path along a cliff top, a ladder) the area is where it leads, away from the fall
        for (let g = 0; g < 40 && node[idx(fx, fy)] < 0; g++) {
          if (!link(fx, fy, dx, dy, dx === 1 ? 6 : dx === -1 ? 4 : dy === 1 ? 2 : 8)) break;
          fx += dx; fy += dy;
        }
        if (node[idx(fx, fy)] >= 0) { from = idx(fx, fy); climbed = fx !== f.x + dx || fy !== f.y + dy; break; }
      }
      const ly = f.y + f.n;
      const land = valid(f.x, ly) ? idx(f.x, ly) : -1;
      const landNode = land >= 0 ? node[land] : -1;
      // (the tower keeps its first-come heights from the ledges' own falls)
      if (from >= 0 && landNode >= 0 && node[from] !== landNode && !(tower && climbed)) { edges.push([node[from], landNode, f.n, climbed]); ends.push(from, land); }
      if (f.slide) continue;                       // (a slide: its chute, no drop - above)
      // only stepping south off a ledge's edge opens what the fall passes through
      const above = valid(f.x, f.y - 1) ? idx(f.x, f.y - 1) : -1;
      if (above < 0 || !walk(above)) continue;
      // a room it lands in keeps its floor and the wall right above it (the fall is not shown going
      // through it); falling into nothing, the landing cell is open too
      const landWalk = land >= 0 && walk(land);
      let stop = landWalk ? f.n : f.n + 1;
      if (landNode >= 0 && nodeRows[landNode] > 1) {
        let k = f.n - 1;
        while (k >= 1 && valid(f.x, f.y + k) && node[idx(f.x, f.y + k)] === landNode) k--;
        stop = k;                                   // the row above the room: its wall (or the door in it)
      }
      const cells = [];
      for (let k = 1; k < stop; k++) {
        if (!valid(f.x, f.y + k)) break;
        const j = idx(f.x, f.y + k);
        if (node[j] >= 0) break;                    // a floor on the way down: the drop ends there
        if (!walk(j)) { air.add(j); cells.push([j, k]); }
      }
      drops.push({ f, from: above, land: landWalk ? land : -1, cells });
    }
    // a lift carries the player its rows up the screen: the area at its top end that many tiles above the one at its bottom end
    // (the slope between them: below); one with nothing to land on at the top raises nothing
    const nodeNear = (x, y) => {
      if (!valid(x, y) || !walk(idx(x, y))) return -1;
      const seen = new Set([idx(x, y)]), q = [idx(x, y)];
      for (let hd = 0; hd < q.length && hd < 400; hd++) {
        const j = q[hd];
        if (node[j] >= 0) return j;
        for (const [dx, dy, d] of STEPS) {
          if (!link(j % w, (j / w) | 0, dx, dy, d)) continue;
          const k = idx((j % w) + dx, ((j / w) | 0) + dy);
          if (!seen.has(k)) { seen.add(k); q.push(k); }
        }
      }
      return -1;
    };
    for (const L of opts.lifts || []) {
      const up = nodeNear(L.x, L.yTop), dn = nodeNear(L.x, L.yBottom);
      if (up >= 0 && dn >= 0 && node[up] !== node[dn]) { edges.push([node[up], node[dn], L.yBottom - L.yTop, false]); ends.push(up, dn); }
    }
    fallStats.edges = edges.length; fallStats.drops = drops.length;
    if (tower && edges.length) {
      const hN = new Map();
      const base = edges.map(e => e[1]).sort((a, b) => nodeSize[b] - nodeSize[a])[0];
      let sample = -1;
      for (let i = 0; i < w * h && sample < 0; i++) if (node[i] === base) sample = i;
      hN.set(base, floorE[sample] || 0);
      for (let pass = 0; pass < edges.length + 2; pass++) {
        let changed = false;
        for (const [u, l, n] of edges) {
          if (hN.has(l) && !hN.has(u)) { hN.set(u, hN.get(l) + n); changed = true; }
          else if (hN.has(u) && !hN.has(l)) { hN.set(l, hN.get(u) - n); changed = true; }
        }
        if (!changed) break;
      }
      for (let i = 0; i < w * h; i++) {
        if (node[i] < 0 || !hN.has(node[i])) continue;
        floorE[i] = surfNArr[i] = surfSArr[i] = hN.get(node[i]); slope[i] = 0;
      }
      // the narrow walkable runs between ledges: stairs from one ledge's height to the next
      for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
          const i = idx(x, y);
          if (!walk(i) || runLen[i] >= 3) { y++; continue; }
          const y0 = y;
          while (y < h && walk(idx(x, y)) && runLen[idx(x, y)] < 3) y++;
          const y1 = y - 1, L = y1 - y0 + 1;
          const top = valid(x, y0 - 1) && node[idx(x, y0 - 1)] >= 0 ? hN.get(node[idx(x, y0 - 1)]) : undefined;
          const bot = valid(x, y1 + 1) && node[idx(x, y1 + 1)] >= 0 ? hN.get(node[idx(x, y1 + 1)]) : undefined;
          if (top === undefined && bot === undefined) continue;
          const hTop = top ?? bot, hBot = bot ?? top;
          for (let k = 0; k < L; k++) {
            const j = idx(x, y0 + k);
            surfNArr[j] = hTop + (hBot - hTop) * k / L;
            surfSArr[j] = hTop + (hBot - hTop) * (k + 1) / L;
            floorE[j] = (surfNArr[j] + surfSArr[j]) / 2;
            slope[j] = Math.abs(hTop - hBot) > 0.01 ? 1 : 0;
          }
        }
      }
      // walkable specks left inside the shaft (no ledge, no stairs) are part of the drop
      for (let i = 0; i < w * h; i++) if (walk(i) && node[i] < 0 && !slope[i] && runLen[i] < 3 && floorE[i] === 0 && hN.size) {
        const x = i % w, y = (i / w) | 0;
        let open = 0;
        for (const [dx, dy] of N4) if (valid(x + dx, y + dy) && air.has(idx(x + dx, y + dy))) open++;
        if (open >= 2) air.add(i);
      }
      // the bricks right beside the stairs are the same back wall in the drawing as all round the shaft: open air too (a
      // wall hugging the stairs was this 3D's own), the stairs running down with a drop on either side - the tower's own
      // wall (the last one before the outside) stays
      for (let i = 0; i < w * h; i++) {
        if (!slope[i]) continue;
        const x = i % w, y = (i / w) | 0;
        for (const dx of [-1, 1]) {
          const j = idx(x + dx, y), beyond = valid(x + 2 * dx, y) ? idx(x + 2 * dx, y) : -1;
          if (valid(x + dx, y) && solid[j] && beyond >= 0 && solid[beyond] && solid[beyond] !== SOLID_VOID && !empty[beyond]) air.add(j);
        }
      }
      const heights = [...hN.values()];
      const hiAll = Math.max(...heights), loAll = Math.min(...heights);
      for (const j of air) pit[j] = 1;
      // rows of the drawing -> heights (between the ledges' rows), for what hangs on the tower's walls
      // one row per ledge or room: the highest row a fall leaves from or lands on (the room at the
      // bottom may run on outside the tower)
      const topRow = new Map();
      for (const i of ends) {
        const n = node[i], y = (i / w) | 0;
        if (hN.has(n) && (!topRow.has(n) || y < topRow.get(n))) topRow.set(n, y);
      }
      const anchors = [...topRow].map(([n, y]) => [y, hN.get(n)]);
      anchors.sort((a, b) => a[0] - b[0]);
      sideRowH = y => {
        let lo = null, hi = null;
        for (const a of anchors) { if (a[0] <= y) lo = a; if (a[0] >= y && !hi) hi = a; }
        if (!lo) return hi[1];
        if (!hi || hi[0] === lo[0]) return lo[1];
        return lo[1] + (hi[1] - lo[1]) * (y - lo[0]) / (hi[0] - lo[0]);
      };
      sideAirDepth = loAll - 4;
      // the tower's own walls: from the bottom up past the top ledge
      let x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (let i = 0; i < w * h; i++) {
        if (!air.has(i) && !slope[i] && (node[i] < 0 || node[i] === base || !hN.has(node[i]))) continue;
        const x = i % w, y = (i / w) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y1 + 1); y++) {
        for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) {
          const i = idx(x, y);
          if (solid[i] && !pit[i]) sideTop.set(i, hiAll + baseH);
        }
      }
      sideBox = [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
    } else if (!tower) {
      // heights move area by area: the biggest area a fall lands in keeps its height, an area a fall
      // leaves from goes n tiles above the one it lands in, and areas joined to those by narrow
      // passages move along with them while the passages slope between their two ends
      const floorE0 = Float32Array.from(floorE);
      const delta = new Map();
      const best = new Map();
      edges.forEach(([u, l, n, climbed], k) => {
        const key = u + '>' + l, d = n - (floorE[ends[2 * k]] - floorE[ends[2 * k + 1]]);
        const cur = best.get(key);
        if (!cur || (cur.climbed && !climbed) || (cur.climbed === climbed && d < cur.d)) best.set(key, { u, l, d, climbed });
      });
      const fe = [...best.values()].map(e => [e.u, e.l, e.d]);
      const runs = [];
      for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
          if (!narrow(idx(x, y))) { y++; continue; }
          const y0 = y;
          y++;
          while (y < h && narrow(idx(x, y)) && link(x, y - 1, 0, 1, 2)) y++;
          const y1 = y - 1;
          const top = link(x, y0 - 1, 0, 1, 2) ? node[idx(x, y0 - 1)] : -1;
          const bot = link(x, y1, 0, 1, 2) ? node[idx(x, y1 + 1)] : -1;
          let ladder = false, stairs = false;
          for (let yy = y0; yy <= y1; yy++) { ladder ||= grid.isLadder(x, yy); stairs ||= stairAt(idx(x, yy)); }
          runs.push({ x, y0, y1, top, bot, ladder, stairs });
        }
      }
      // the falls first: each group of falls tied together keeps its biggest landing area where it is
      const landings = [...new Set(fe.map(e => e[1]))].sort((a, b) => nodeSize[b] - nodeSize[a]);
      for (const anchor of landings) {
        if (delta.has(anchor)) continue;
        delta.set(anchor, 0);
        for (let pass = 0; pass < 1000; pass++) {
          let changed = false;
          for (const [u, l, d] of fe) {
            if (delta.has(l) && !delta.has(u)) { delta.set(u, delta.get(l) + d); changed = true; }
            else if (delta.has(u) && !delta.has(l)) { delta.set(l, delta.get(u) - d); changed = true; }
          }
          if (!changed) break;
        }
      }
      // then the areas no fall speaks of follow the ones they are joined to by a narrow passage (a
      // passage between two areas the falls placed is a ramp between them); a ladder climbs as many
      // tiles as it is long, unless the two ends already stand at different levels
      // (short passages first: a doorway joins one floor, a long staircase more likely leads to another)
      for (const maxLen of [2, 4, 8, Infinity]) for (let pass = 0; pass < 1000; pass++) {
        let changed = false;
        for (const r of runs) {
          if (r.top < 0 || r.bot < 0 || r.y1 - r.y0 + 1 > maxLen) continue;
          const tc = idx(r.x, r.y0 - 1), bc = idx(r.x, r.y1 + 1);
          const rise = (r.ladder || r.stairs) && floorE0[tc] - floorE0[bc] < 0.9 ? r.y1 - r.y0 + 1 : 0;
          const tb = rise ? floorE0[bc] + rise - floorE0[tc] : 0;     // delta(top) - delta(bottom)
          if (delta.has(r.top) && !delta.has(r.bot)) { delta.set(r.bot, delta.get(r.top) - tb); changed = true; }
          else if (delta.has(r.bot) && !delta.has(r.top)) { delta.set(r.top, delta.get(r.bot) + tb); changed = true; }
        }
        if (!changed) break;
      }
      for (let i = 0; i < w * h; i++) {
        const d = node[i] >= 0 ? delta.get(node[i]) : undefined;
        if (d) { floorE[i] += d; surfNArr[i] += d; surfSArr[i] += d; }
      }
      for (const r of runs) {
        if (r.stairs) continue;                           // (below, flight by flight)
        const dt = r.top >= 0 ? delta.get(r.top) : undefined, db = r.bot >= 0 ? delta.get(r.bot) : undefined;
        if (dt === undefined && db === undefined) continue;
        const L = r.y1 - r.y0 + 1;
        if (dt !== undefined && db !== undefined) {
          // between two placed areas: a ramp from the one to the other (a ladder down to a lower floor)
          const hT = floorE[idx(r.x, r.y0 - 1)], hB = floorE[idx(r.x, r.y1 + 1)];
          for (let k = 0; k < L; k++) {
            const j = idx(r.x, r.y0 + k);
            surfNArr[j] = hT + (hB - hT) * k / L;
            surfSArr[j] = hT + (hB - hT) * (k + 1) / L;
            floorE[j] = (surfNArr[j] + surfSArr[j]) / 2;
            slope[j] = Math.abs(hT - hB) > 0.01 ? 1 : 0;
          }
          continue;
        }
        if (r.ladder) {
          // a ladder off one area's edge (to an exit at the map's edge): it climbs from that area
          const L1 = r.y1 - r.y0 + 1;
          const end = dt !== undefined ? floorE[idx(r.x, r.y0 - 1)] : floorE[idx(r.x, r.y1 + 1)];
          for (let k = 0; k < L1; k++) {
            const j = idx(r.x, r.y0 + k);
            if (dt !== undefined) { surfNArr[j] = end - k; surfSArr[j] = end - k - 1; }
            else { surfNArr[j] = end + (L1 - k); surfSArr[j] = end + (L1 - k - 1); }
            floorE[j] = (surfNArr[j] + surfSArr[j]) / 2;
            slope[j] = 1;
          }
          continue;
        }
        const a = dt ?? db, b = db ?? dt;                 // one end only: it moves with that area
        if (!a && !b) continue;
        for (let k = 0; k < L; k++) {
          const j = idx(r.x, r.y0 + k);
          surfNArr[j] += a + (b - a) * k / L;
          surfSArr[j] += a + (b - a) * (k + 1) / L;
          floorE[j] = (surfNArr[j] + surfSArr[j]) / 2;
          if (Math.abs(surfNArr[j] - surfSArr[j]) > 0.01) slope[j] = 1;
        }
      }
      // a narrow cell no run up or down the screen ties to an area - stepped onto sideways off one that moved, the end of a
      // ledge - moves as that one did, in turn (옥스・워드 대학교 ５: of two rock cells by its lift's top the drawing lets one across,
      // the far one had stayed where the lift starts - a hole 100 m deep beside the top)
      {
        const placed = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) if (node[i] >= 0 ? delta.has(node[i]) : floorE[i] !== floorE0[i]) placed[i] = 1;
        for (const r of runs) {
          if ((r.top >= 0 && delta.has(r.top)) || (r.bot >= 0 && delta.has(r.bot))) for (let y = r.y0; y <= r.y1; y++) placed[idx(r.x, y)] = 1;
        }
        for (let pass = 0; pass < 64; pass++) {
          const now = [];
          for (let i = 0; i < w * h; i++) {
            if (placed[i] || !narrow(i)) continue;
            const x = i % w, y = (i / w) | 0;
            for (const [dx, dy, d] of STEPS) {
              if (!link(x, y, dx, dy, d)) continue;
              const j = idx(x + dx, y + dy);
              if (placed[j] === 1) { now.push([i, floorE[j] - floorE0[j]]); break; }
            }
          }
          if (!now.length) break;
          for (const [i, d] of now) { floorE[i] += d; surfNArr[i] += d; surfSArr[i] += d; placed[i] = 1; }
        }
      }
      // (maphints stairs) each flight - its cells side by side and one under another - climbs evenly between the floors
      // stepped onto off its north row and its south row, every column alike; with a floor at one end only it climbs
      // from that floor a tile a row, northward up the screen (the way a flight drawn from the front goes up)
      if (stairSet) {
        const seenS = new Uint8Array(w * h);
        for (let s0 = 0; s0 < w * h; s0++) {
          if (seenS[s0] || !walk(s0) || !stairAt(s0)) continue;
          const cells = [s0];
          seenS[s0] = 1;
          for (let hd = 0; hd < cells.length; hd++) {
            const j = cells[hd], x = j % w, y = (j / w) | 0;
            for (const [dx, dy, d] of STEPS) {
              if (!link(x, y, dx, dy, d)) continue;
              const k = idx(x + dx, y + dy);
              if (!seenS[k] && stairAt(k)) { seenS[k] = 1; cells.push(k); }
            }
          }
          let y0 = h, y1 = -1;
          for (const j of cells) { const y = (j / w) | 0; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          const endH = (row, dy) => {
            const hs = [];
            for (const j of cells) {
              const x = j % w, y = (j / w) | 0;
              if (y === row && link(x, y, 0, dy, dy > 0 ? 2 : 8) && !stairAt(idx(x, y + dy))) hs.push(floorE[idx(x, y + dy)]);
            }
            return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : undefined;
          };
          let hT = endH(y0, -1), hB = endH(y1, 1);
          if (hT === undefined && hB === undefined) continue;
          const L = y1 - y0 + 1;
          if (hT === undefined) hT = hB + L;
          if (hB === undefined) hB = hT - L;
          for (const j of cells) {
            const k = ((j / w) | 0) - y0;
            surfNArr[j] = hT + (hB - hT) * k / L;
            surfSArr[j] = hT + (hB - hT) * (k + 1) / L;
            floorE[j] = (surfNArr[j] + surfSArr[j]) / 2;
            slope[j] = Math.abs(hT - hB) > 0.01 ? 1 : 0;
          }
        }
      }
      // floor that cannot be walked on (under furniture, behind counters) moves with what is beside it
      {
        const moved = new Uint8Array(w * h), q = [];
        for (let i = 0; i < w * h; i++) if (walk(i)) { moved[i] = 1; q.push(i); }
        for (let head = 0; head < q.length; head++) {
          const i = q[head], x = i % w, y = (i / w) | 0, d = floorE[i] - floorE0[i];
          for (const [dx, dy] of N4) {
            if (!valid(x + dx, y + dy)) continue;
            const j = idx(x + dx, y + dy);
            if (moved[j] || !isFloorIdx(j)) continue;
            moved[j] = 1;
            if (d) { floorE[j] += d; surfNArr[j] += d; surfSArr[j] += d; }
            q.push(j);
          }
        }
      }
      // cliff walls follow the floors they stand between
      for (let i = 0; i < w * h; i++) {
        if (Number.isNaN(cliffTop[i])) continue;
        const u = cliffU[i], l = cliffL[i];
        const du = u >= 0 ? floorE[u] - floorE0[u] : 0;
        cliffTop[i] += du;
        cliffBase[i] += l >= 0 ? floorE[l] - floorE0[l] : du;
      }
      // the drops: the fall's cell and what it passes through, open down past where it lands
      shaft = new Uint8Array(w * h);
      shaftTop = new Float32Array(w * h).fill(-Infinity);
      shaftRowH = new Float32Array(w * h).fill(NaN);
      shaftDepth = new Float32Array(w * h).fill(Infinity);
      for (const dr of drops) {
        const hU = floorE[dr.from];
        const hL = dr.land >= 0 ? floorE[dr.land] : hU - dr.f.n;
        if (hU - hL < 0.9) continue;                      // lands on the same level: a slide, not a drop
        const span = dr.f.n + 1;                          // rows from the ledge to where it lands
        const put = (j, k) => {
          shaft[j] = 1;
          shaftTop[j] = Math.max(shaftTop[j], hU);
          const rh = hU + (hL - hU) * k / span;            // the height this row of the drawing stands for
          shaftRowH[j] = Number.isNaN(shaftRowH[j]) ? rh : Math.max(shaftRowH[j], rh);
          shaftDepth[j] = Math.min(shaftDepth[j], hL - 4);
        };
        put(idx(dr.f.x, dr.f.y), 1);
        for (const [j, k] of dr.cells) put(j, k + 1);
      }
      // a narrow thing drawn down the face under the ledge (a pillar, a pipe: wall tiles one or two wide with the drop either
      // side and the ledge, or more of the same, above) is part of that face, not a wall standing up out of the drop
      // (병든 시계탑 3: its towers' pillars stood as thin walls along the walkway)
      for (let y = 1; y < h; y++) for (let x = 1; x < w - 1; x++) {
        const i = idx(x, y);
        if (!shaft[i - 1] || shaft[i] || !solid[i] || pit[i]) continue;
        let n = 0;
        while (n < 3 && x + n < w && solid[i + n] && !pit[i + n] && !shaft[i + n]) n++;
        if (n > 2 || x + n >= w || !shaft[i + n]) continue;
        const run = [];
        for (let k = 0; k < n; k++) run.push(i + k);
        if (!run.every(j => shaft[j - w] || walk(j - w))) continue;
        for (const j of run) {
          shaft[j] = 1; fallStats.pillars++;
          shaftTop[j] = Math.max(shaftTop[i - 1], shaftTop[i + n]);
          shaftRowH[j] = Math.max(shaftRowH[i - 1], shaftRowH[i + n]);
          shaftDepth[j] = Math.min(shaftDepth[i - 1], shaftDepth[i + n]);
        }
      }
      for (let i = 0; i < w * h; i++) if (shaft[i]) { pit[i] = 1; fallStats.shaft++; }
      // a wall between an area the falls raised and the lower one below it is the cliff face drawn in
      // 2D: its top is the upper floor's edge with a low lip, not a wall rising over that floor
      for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
          if (!solid[idx(x, y)] || pit[idx(x, y)]) { y++; continue; }
          const y0 = y;
          while (y < h && solid[idx(x, y)] && !pit[idx(x, y)]) y++;
          const y1 = y - 1;
          const up = valid(x, y0 - 1) ? idx(x, y0 - 1) : -1, dn = valid(x, y1 + 1) ? idx(x, y1 + 1) : -1;
          if (up < 0 || dn < 0 || !isFloorIdx(up) || !isFloorIdx(dn) || y1 - y0 + 1 > 12) continue;
          if (floorE[up] - floorE[dn] < 0.9) continue;
          if (floorE[up] === floorE0[up] && floorE[dn] === floorE0[dn]) continue;   // the falls moved neither
          for (let yy = y0; yy <= y1; yy++) {
            const j = idx(x, yy);
            if (solid[j] === SOLID_MASS) continue;
            cliffTop[j] = floorE[up] + PARAPET; cliffBase[j] = floorE[dn]; cliffU[j] = up; cliffL[j] = dn;
          }
        }
      }
      fallStats.raised = [...delta.values()].filter(d => d).length;
    }
  }
  // the lifts' ways: a slope from the bottom end's floor up to the top end's (or, nothing to land on at the top, the ride's rows
  // above the bottom), as steep as the ride is long - the platform and the player carried up it at the ride's own speed
  const liftEnds = [];
  for (const L of opts.lifts || []) {
    const b = idx(L.x, L.yBottom), t = idx(L.x, L.yTop);
    const hb = liftCell[b] === 2 || isFloorIdx(b) ? floorE[b] : 0;
    const landing = liftCell[t] === 2;
    const ht = landing ? floorE[t] : hb + (L.yBottom - L.yTop);
    const y0 = landing ? L.yTop + 1 : L.yTop, n = L.yBottom - y0;
    for (let y = y0; y < L.yBottom; y++) for (let x = L.x - 2; x <= L.x + 2; x++) {
      if (!valid(x, y) || liftCell[idx(x, y)] !== 1) continue;
      const j = idx(x, y), k = y - y0;
      surfNArr[j] = ht + (hb - ht) * k / n; surfSArr[j] = ht + (hb - ht) * (k + 1) / n;
      floorE[j] = (surfNArr[j] + surfSArr[j]) / 2; slope[j] = 1;
    }
    liftEnds.push({ L, hb, ht });
  }
  // the chutes (above): from the north edge of the first cell, level with the floor it is left from, down to the south edge
  // of the last, level with the floor it comes onto - as steep as the slide is short
  for (const C of chutes) {
    const ht = floorE[C.top], hb = floorE[C.bottom], n = C.cells.length;
    C.cells.forEach((j, k) => {
      surfNArr[j] = ht + (hb - ht) * k / n; surfSArr[j] = ht + (hb - ht) * (k + 1) / n;
      floorE[j] = (surfNArr[j] + surfSArr[j]) / 2; slope[j] = Math.abs(ht - hb) > 0.01 ? 1 : 0;
    });
  }
  for (let i = 0; i < w * h; i++) if (liftCell[i] || chuteCell[i]) { solid[i] = 0; empty[i] = 0; pit[i] = 0; }
  // a dais: a small walkable wall top with its top and rim drawn over it (a podium, a stage: a solid
  // picture, not a ladder's rungs) and a row of steps in front stands a little above the ground, the
  // steps rising to it
  const DAIS_H = 0.5;                                   // tiles
  let daises = 0;
  {
    const topAt = i => isWallTop(grid.tile(i % w, (i / w) | 0, 0)) || isWallTop(grid.tile(i % w, (i / w) | 0, 1));
    const daisCell = i => isFloorIdx(i) && !slope[i] && topAt(i) && objType[i] === 2 && grid.anyPassable(i % w, (i / w) | 0) &&
      tileAvg(grid.tile(i % w, (i / w) | 0, 2)).cover > 0.6;
    const seen = new Uint8Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || !daisCell(s)) continue;
      const cells = [s];
      seen[s] = 1;
      for (let hd = 0; hd < cells.length; hd++) {
        const x = cells[hd] % w, y = (cells[hd] / w) | 0;
        for (const [dx, dy] of N4) {
          if (!valid(x + dx, y + dy)) continue;
          const j = idx(x + dx, y + dy);
          if (!seen[j] && daisCell(j)) { seen[j] = 1; cells.push(j); }
        }
      }
      if (cells.length < 2 || cells.length > 40) continue;   // (a whole floor of such tiles is no dais)
      const steps = [];
      for (const j of cells) {
        const x = j % w, y = (j / w) | 0;
        if (!valid(x, y + 1)) continue;
        const k = idx(x, y + 1);
        if (isFloorIdx(k) && !slope[k] && !topAt(k) && grid.passable(x, y + 1, 8) && grid.passable(x, y, 2)) steps.push(k);
      }
      if (!steps.length) continue;
      for (const j of cells) { floorE[j] += DAIS_H; surfNArr[j] += DAIS_H; surfSArr[j] += DAIS_H; }
      for (const k of steps) { surfNArr[k] += DAIS_H; floorE[k] = (surfNArr[k] + surfSArr[k]) / 2; slope[k] = 1; }
      daises++;
    }
  }
  // pits: no floor; their walls run far down
  const PIT_DEPTH = 8;
  const pitE = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!pit[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let m = Infinity;
    for (const [dx, dy] of N4) if (isFloor(x + dx, y + dy)) m = Math.min(m, floorE[idx(x + dx, y + dy)]);
    pitE[i] = (m === Infinity ? 0 : m) - PIT_DEPTH;
  }
  // a side view's chasm is one open shaft: every hole in it goes down to the same depth
  if (sideAirDepth !== null) for (let i = 0; i < w * h; i++) if (pit[i]) pitE[i] = sideAirDepth;
  if (shaft) for (let i = 0; i < w * h; i++) if (shaft[i]) pitE[i] = shaftDepth[i];
  // under an open sky (maphints.js openSky) every drop is the same air: all of them, and the faces of what stands in it, go
  // down as far as the deepest
  if (opts.openSky) {
    for (let i = 0; i < w * h; i++) if (pit[i]) OPEN_LEVEL = Math.min(OPEN_LEVEL, pitE[i]);
    for (let i = 0; i < w * h; i++) if (pit[i]) pitE[i] = OPEN_LEVEL;
  }
  // surface height of a non-solid cell at one of its edges ('N','S','E','W' -> E/W take the low end)
  const surfN = i => (pit[i] ? pitE[i] : surfNArr[i]);
  const surfS = i => (pit[i] ? pitE[i] : surfSArr[i]);
  const edgeE = (i, side) => (side === 'N' ? surfN(i) : side === 'S' ? surfS(i) : Math.min(surfN(i), surfS(i)));
  // solids: base (where their art starts) and top
  const solidBase = new Float32Array(w * h), solidTop = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (!solid[i] || pit[i]) continue;
    let lo = Infinity, hi = -Infinity, ledge = -Infinity;
    for (const [dx, dy] of N4) {
      if (shaft && valid(x + dx, y + dy) && shaft[idx(x + dx, y + dy)]) ledge = Math.max(ledge, shaftTop[idx(x + dx, y + dy)]);
      if (!isFloor(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      lo = Math.min(lo, surfN(j), surfS(j)); hi = Math.max(hi, surfN(j), surfS(j));
    }
    if (lo === Infinity) { lo = 0; hi = 0; }
    solidBase[i] = lo;
    solidTop[i] = Math.max(hi, ledge) + height[i];      // (walls beside a drop rise to the ledge above it)
    // (in a terraced town a wall or house between a street and a higher terrace stands its height above the
    // street, or as a retaining wall a little over the terrace - not its height again over the terrace: a tower)
    if (opts.terraces) solidTop[i] = Math.max(lo + height[i], Math.max(hi, ledge) + Math.min(height[i], PARAPET));
  }
  // solids with no floor neighbour inherit the level of solid neighbours (so blocks stay flush)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (!solid[i] || pit[i]) continue;
      let hasFloor = false;
      for (const [dx, dy] of N4) if (isFloor(x + dx, y + dy)) hasFloor = true;
      if (hasFloor) continue;
      let hi = -Infinity, lo = Infinity;
      for (const [dx, dy] of N4) {
        if (!isSolid(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy);
        hi = Math.max(hi, solidTop[j] - height[j]);
        lo = Math.min(lo, solidBase[j]);
      }
      if (hi !== -Infinity) { solidTop[i] = Math.max(solidTop[i], hi + height[i]); solidBase[i] = lo; }
    }
  }

  for (let i = 0; i < w * h; i++) if (!Number.isNaN(cliffTop[i])) { solidBase[i] = cliffBase[i]; solidTop[i] = cliffTop[i]; }
  for (const [i, top] of sideTop) { solidTop[i] = Math.max(solidTop[i], top); solidBase[i] = Math.min(solidBase[i], sideAirDepth ?? solidBase[i]); }
  // the rock a lift's way is cut through (the blocks drawn as the rock of its way, all of a piece round it) stands whole from the
  // bottom end's floor up to the top end's: a cliff with the way climbing inside it, the top landing on it - not a field of low
  // blocks with the slope standing up out of it
  for (const { hb, ht } of liftEnds) {
    const kindOf = j => { const t = grid.tile(j % w, (j / w) | 0, 0); return t >= 2048 ? 2048 + Math.floor((t - 2048) / 48) * 48 : t; };
    const rock = new Set();
    for (let i = 0; i < w * h; i++) if (liftCell[i] === 1) rock.add(kindOf(i));
    const seen = new Uint8Array(w * h), q = [];
    const visit = j => { if (!seen[j] && solid[j] && !pit[j] && rock.has(kindOf(j))) { seen[j] = 1; q.push(j); } };
    for (let i = 0; i < w * h; i++) {
      if (liftCell[i] !== 1) continue;
      for (const [dx, dy] of N4) if (valid((i % w) + dx, ((i / w) | 0) + dy)) visit(idx((i % w) + dx, ((i / w) | 0) + dy));
    }
    for (let hd = 0; hd < q.length; hd++) {
      const j = q[hd];
      solidTop[j] = ht; solidBase[j] = Math.min(solidBase[j], hb);
      for (const [dx, dy] of N4) if (valid((j % w) + dx, ((j / w) | 0) + dy)) visit(idx((j % w) + dx, ((j / w) | 0) + dy));
    }
  }
  // walls that are the front of a raised floor (maphints caps [x0, y0, x1, y1, top]): their top no higher than that floor
  // (a gallery's front of bookshelves rose two tiles over the gallery, standing on it as on a terrace)
  for (const [x0, y0, x1, y1, top] of opts.caps || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isSolid(x, y)) { const i = idx(x, y); solidTop[i] = Math.min(solidTop[i], Math.max(solidBase[i], top)); }
  }
  // solids as tall as a map hint says (maphints tops [x0, y0, x1, y1, top]): a castle front between floors raised by hand,
  // as high as the floor behind it - inside a big block nothing tells the cells away from the floors how high they are
  for (const [x0, y0, x1, y1, top] of opts.tops || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isSolid(x, y)) { const i = idx(x, y); solidTop[i] = Math.max(solidBase[i], top); }
  }
  // a painted cliff's face (maphints highGround): from the ground at its foot up to the plateau over it - its drawing from the
  // foot up, the plateau's ground on its top
  if (hg) for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    const i = idx(x, y);
    if (!cliffFace[i] || (y > 0 && cliffFace[idx(x, y - 1)])) continue;
    let y1 = y;
    while (valid(x, y1 + 1) && cliffFace[idx(x, y1 + 1)]) y1++;
    const top = surfS(faceUp[i]), foot = valid(x, y1 + 1) && isFloorIdx(idx(x, y1 + 1)) ? surfN(idx(x, y1 + 1)) : top - hg.height;
    for (let yy = y; yy <= y1; yy++) { solidTop[idx(x, yy)] = top; solidBase[idx(x, yy)] = Math.min(foot, top); }
  }

  // floor height (tiles) at a continuous position (tile-centre coordinates)
  function floorAt(fx, fy) {
    const x = Math.round(fx), y = Math.round(fy);
    if (!valid(x, y)) return 0;
    const i = idx(x, y);
    if (pit[i]) return pitE[i];
    if (slope[i]) {
      const v = THREE.MathUtils.clamp(fy - (y - 0.5), 0, 1);
      return surfNArr[i] + (surfSArr[i] - surfNArr[i]) * v;
    }
    if (isFloorIdx(i)) return floorE[i];
    // a ledge (maphints lips): its top - one is walked over where a boss fight opens the way over it (arena.js openWays)
    if (!Number.isNaN(lipH[i]) && solid[i] === SOLID_LOW) return solidTop[i];
    // inside a solid (should not happen): use the highest neighbouring floor
    let best2 = 0, found = false;
    for (const [dx, dy] of N4) if (isFloor(x + dx, y + dy)) { const e = floorE[idx(x + dx, y + dy)]; if (!found || e > best2) { best2 = e; found = true; } }
    return best2;
  }

  Object.assign(M, { OPEN_LEVEL, daises, edgeE, fallStats, floorAt, pitE, shaft, shaftRowH, sideBox, sideRowH,
      solidBase, solidTop, surfN, surfS });
}
