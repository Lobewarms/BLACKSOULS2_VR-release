// Building a map, its third stage: heights - how tall each solid stands (relative, in tiles), and the levels of the floor:
// the map's walkable places tied together by its stairs and cliffs, cliffs becoming slopes, the hand-made heights
// (maphints.js floors, terraces, high ground) put in.
import { isVisible, isWallSide } from '../tiles.js';

export function raiseLevels(M) {
  const { MAX_MASS, N4, PARAPET, SOLID_LOW, SOLID_MASS, SOLID_RAIL, SOLID_VOID, SOLID_WALL, compSize, empty, flatCell,
      gaps, grid, h, hg, highG, idx, isFloor, isFloorIdx, isSide, isWallCell, isWaterTop, lipH, moundCell, moundH,
      objType, onStairTile, openVoid, opts, pit, propCell, raisedTop, sideStairTiles, solid, tileAvg, valid, w } = M;
  let { OPEN_LEVEL } = M;
  // ---- heights of solids (relative, in tiles) ----------------------------------------
  const height = new Float32Array(w * h);
  const runs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isWallCell(x, y) || isWallCell(x, y + 1) || !valid(x, y + 1)) continue;
    let k = 0;
    while (y - k >= 0 && isSide[idx(x, y - k)] && isWallCell(x, y - k)) k++;
    if (k > 0) runs.push(k);
  }
  const counts = {};
  for (const k of runs) counts[k] = (counts[k] || 0) + 1;
  let mode = 2, best = -1;
  for (const k in counts) if (counts[k] > best) { best = counts[k]; mode = +k; }
  const baseH = Math.min(4, Math.max(2, opts.wallTiles || mode));
  for (let i = 0; i < w * h; i++) if (solid[i] === SOLID_WALL || solid[i] === SOLID_VOID) height[i] = baseH;
  for (let i = 0; i < w * h; i++) if (solid[i] === SOLID_RAIL) height[i] = 0.35;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isWallCell(x, y) || isWallCell(x, y + 1)) continue;
    let k = 0;
    while (y - k >= 0 && isSide[idx(x, y - k)] && isWallCell(x, y - k)) k++;
    // (a long run is a wall up to 6 tiles - or as tall as drawn, up to maphints.js wallCap: 병든 시계탑 3's towers)
    if (k > baseH) for (let j = 0; j <= k && y - j >= 0; j++) if (isWallCell(x, y - j)) height[idx(x, y - j)] = Math.max(height[idx(x, y - j)], Math.min(k, opts.wallCap || 6));
  }
  // masses: each vertical run in a column becomes a block whose front shows the 2D art
  // bottom-up (facade first, then roof), plus star tiles directly behind it (roof tips)
  const stripOf = new Array(w * h);
  const extCell = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (solid[idx(x, y)] !== SOLID_MASS) { y++; continue; }
      const y0 = y;
      while (y < h && solid[idx(x, y)] === SOLID_MASS) y++;
      const y1 = y - 1, len = y1 - y0 + 1;
      const ext = [];
      for (let yy = y0 - 1; yy >= 0 && ext.length < 3; yy--) {
        const j = idx(x, yy);
        if (solid[j] || objType[j] !== 3) break;
        ext.push(yy);
      }
      const big = compSize[idx(x, y0)] >= 16;
      const hgt = Math.min(MAX_MASS, Math.max(big ? 2 : 1, len + ext.length));
      const strip = [];
      for (let r = 0; r < hgt; r++) {
        if (r < len) strip.push({ x, y: y1 - r, ext: false });
        else if (r - len < ext.length) strip.push({ x, y: ext[r - len], ext: true });
        else strip.push(strip[strip.length - 1]);
      }
      strip.hasFacade = isFloor(x, y1 + 1);
      for (const yy of ext) extCell[idx(x, yy)] = 1;
      for (let yy = y0; yy <= y1; yy++) { height[idx(x, yy)] = hgt; stripOf[idx(x, yy)] = strip; }
    }
  }
  // what is drawn flat but cannot be walked on, kept out of the masses by the props beside it, stands up
  // instead of lying on the floor: a table or counter (ground tiles with the counter flag) as a low
  // block, a piece of a wall or cliff (a fern on it) as high as the wall, rocks as a low block; dark
  // ones (a hole, an open grave) stay pictures on the floor
  const LOW_H = 0.5;                                    // tiles
  for (let i = 0; i < w * h; i++) {
    if (solid[i] || empty[i] || pit[i] || extCell[i] || propCell[i] || flatCell[i] || moundCell[i]) continue;   // (props: pictures or nothing, no block)
    if (!Number.isNaN(lipH[i])) { solid[i] = SOLID_LOW; height[i] = lipH[i]; continue; }     // (maphints lips)
    const x = i % w, y = (i / w) | 0;
    if (grid.anyPassable(x, y) || isWaterTop(x, y) || onStairTile(x, y)) continue;
    // (a table with a teapot or a book on it too: what stands on it stands on its top)
    if (grid.isTableTop(x, y)) { solid[i] = SOLID_LOW; height[i] = LOW_H; continue; }
    if (objType[i] === 1 || objType[i] === 2) continue;
    let wallH = 0;
    for (const [dx, dy] of N4) {
      if (!valid(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      if (solid[j] === SOLID_MASS || solid[j] === SOLID_WALL || solid[j] === SOLID_VOID) wallH = Math.max(wallH, height[j]);
    }
    if (wallH) { solid[i] = SOLID_LOW; height[i] = wallH; continue; }
    const t1 = grid.tile(x, y, 1), top = isVisible(t1) ? t1 : grid.tile(x, y, 0);
    if (!isVisible(top) || tileAvg(top).lum < 90) continue;
    solid[i] = SOLID_LOW;
    height[i] = LOW_H;
  }

  // ---- elevation: cliffs become slopes ------------------------------------------------------
  // In the 3/4 view a cliff of height k is drawn as k rows of wall-side tiles between the upper
  // floor (U) and the lower floor (L). When U and L are only linked through those rows (stairs)
  // or not at all, U is raised and the k rows turn into a slope carrying the cliff art: stairs on
  // the face become walkable ramps and fall rows the slope's lip. With nothing below, the slope
  // runs down into darkness.
  // (a terraced town, maphints.js: its stairs drawn as floor tiles climb between levels - not a level)
  const sideCell = new Uint8Array(w * h), stairCell = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (empty[i] || solid[i] === SOLID_MASS || solid[i] === SOLID_VOID) continue;
    const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1);
    if (isWallSide(t0) || isWallSide(t1)) sideCell[i] = 1;
    else if (!solid[i] && !pit[i] && onStairTile(x, y)) stairCell[i] = 1;
  }
  // (and there one level is only what you can walk across: a roof's edge stops you, so the street behind the
  // roof is not the roof's level)
  const walkAcross = (j, k) => {
    if (!opts.terraces) return true;
    const x = j % w, y = (j / w) | 0, nx = k % w, ny = (k / w) | 0;
    const d = nx > x ? 6 : nx < x ? 4 : ny > y ? 2 : 8;
    return grid.passable(x, y, d) && grid.passable(nx, ny, 10 - d);
  };
  const levelCell = i => !solid[i] && !empty[i] && !sideCell[i] && !pit[i] && !stairCell[i];
  // (a walkable cell of the column x, rows y0..y1, opens sideways onto a walkable wall-side cell whose run down its own column
  // is not the same rows - not the next column of the same stairs)
  const sideRun = (x, y) => { let a = y, b = y; while (valid(x, a - 1) && sideCell[idx(x, a - 1)]) a--; while (valid(x, b + 1) && sideCell[idx(x, b + 1)]) b++; return [a, b]; };
  const sideways = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) {
      if (solid[idx(x, y)] || pit[idx(x, y)] || !grid.anyPassable(x, y)) continue;
      for (const [dx, d] of [[-1, 4], [1, 6]]) {
        const nx = x + dx;
        if (!valid(nx, y) || !sideCell[idx(nx, y)] || solid[idx(nx, y)] || pit[idx(nx, y)]) continue;
        if (!grid.passable(x, y, d) || !grid.passable(nx, y, 10 - d)) continue;
        const [a, b] = sideRun(nx, y);
        if (a !== y0 || b !== y1) return true;
      }
    }
    return false;
  };
  const BIG_AREA = 30;
  const bands = [];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!sideCell[idx(x, y)]) { y++; continue; }
      const y0 = y;
      while (y < h && sideCell[idx(x, y)]) y++;
      const y1 = y - 1;
      // fall rows (pits) right above the face are its lip: they belong to the slope
      let ys = y0;
      while (valid(x, ys - 1) && pit[idx(x, ys - 1)] && !solid[idx(x, ys - 1)]) ys--;
      let fall = ys < y0, gapRows = false;
      for (let yy = y0; yy <= y1; yy++) {
        if (!pit[idx(x, yy)]) continue;
        if (gaps.has(idx(x, yy))) gapRows = true; else fall = true;
      }
      // a rim nobody can step on (a wall top made solid) may run along the top edge: the upper floor
      // lies past it, and the rim becomes the cliff's parapet
      const rim = [];
      while (rim.length < 2 && valid(x, ys - 1 - rim.length) && raisedTop[idx(x, ys - 1 - rim.length)]) rim.push(idx(x, ys - 1 - rim.length));
      const uI = valid(x, ys - 1 - rim.length) ? idx(x, ys - 1 - rim.length) : -1;
      if (uI < 0 || !levelCell(uI)) continue;
      // a cliff face is a few rows tall; a long run of wall tiles is a wall (or a backdrop the map is
      // painted on, like the Room of Falling), not a drop of that many storeys
      // (a terraced town's walls under its high terraces run taller)
      if (y1 - ys + 1 > (opts.terraces ? 10 : 6) && !fall) continue;
      const lI = valid(x, y1 + 1) ? idx(x, y1 + 1) : -1;
      const lowFloor = lI >= 0 && levelCell(lI);
      const lowNothing = lI < 0 || empty[lI] || solid[lI] === SOLID_VOID || pit[lI];
      if (!lowFloor && !lowNothing && !fall) continue; // a wall standing on another wall
      let stairs = false;
      for (let yy = ys; yy <= y1 && !stairs; yy++) if (!solid[idx(x, yy)] && !pit[idx(x, yy)] && grid.anyPassable(x, yy)) stairs = true;
      // the gap under a jump is not a way down: the face is a cliff, its top row the edge jumped from
      if (gapRows) stairs = fall = false;
      // wall-side tiles one walks off sideways onto more of them, a run of another length beside (passable both ways): a floor
      // drawn with wall tiles, not a cliff with stairs on it - nobody walks along a cliff's face (무한음식 ２●: its shop's checkered
      // floor, wall tiles all of it, the strip between the carpet and a display case had gone 7.5 m down as a cliff's stairs)
      if (stairs && !fall && sideways(x, y0, y1)) continue;
      bands.push({ x, y0: ys, y1, k: y1 - ys + 1, uI, lI, lowFloor, fall, stairs, rim });
    }
  }
  // components of same-level floor (cliff rows and pits excluded)
  const comp = new Int32Array(w * h).fill(-1);
  const compCells = [];
  for (let s = 0; s < w * h; s++) {
    if (comp[s] >= 0 || !levelCell(s)) continue;
    const c = compCells.length;
    const cells = [];
    const q = [s];
    comp[s] = c;
    while (q.length) {
      const j = q.pop();
      cells.push(j);
      const x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!valid(nx, ny)) continue;
        const k = idx(nx, ny);
        if (comp[k] < 0 && levelCell(k) && walkAcross(j, k)) { comp[k] = c; q.push(k); }
      }
    }
    compCells.push(cells);
  }
  // an upper floor's size counts the solid rim along its edge (the rim rows are that floor's edge)
  const rimArea = new Int32Array(compCells.length);
  {
    const counted = new Uint8Array(w * h);
    for (const b of bands) {
      const c = comp[b.uI];
      if (c < 0) continue;
      const q = b.rim.filter(i => !counted[i]);
      for (const i of q) counted[i] = 1;
      while (q.length) {
        const j = q.pop();
        rimArea[c]++;
        const x = j % w, y = (j / w) | 0;
        for (const dx of [-1, 1]) {
          if (!valid(x + dx, y)) continue;
          const k = idx(x + dx, y);
          if (raisedTop[k] && !counted[k]) { counted[k] = 1; q.push(k); }
        }
      }
    }
  }
  const areaOf = c => compCells[c].length + rimArea[c];
  const compElev = new Float32Array(compCells.length);
  // a terraced town's stairs: each flight, the places it joins (north to south, by where it meets them)
  const stairFlights = [];
  if (opts.terraces) {
    const seen = new Uint8Array(w * h);
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!stairCell[s0] || seen[s0]) continue;
      const cells = [s0];
      seen[s0] = 1;
      for (let hd = 0; hd < cells.length; hd++) {
        const x = cells[hd] % w, y = (cells[hd] / w) | 0;
        for (const [dx, dy] of N4) {
          if (!valid(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if (stairCell[k] && !seen[k] && walkAcross(cells[hd], k)) { seen[k] = 1; cells.push(k); }
        }
      }
      const meet = new Map();
      let y0 = h, y1 = -1;
      for (const j of cells) {
        const x = j % w, y = (j / w) | 0;
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const [dx, dy] of N4) {
          if (!valid(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if (comp[k] < 0 || !walkAcross(j, k)) continue;
          const m = meet.get(comp[k]) || { c: comp[k], n: 0, y: 0 };
          m.n++; m.y += y + dy;
          meet.set(comp[k], m);
        }
      }
      const ends = [...meet.values()].map(m => ({ c: m.c, y: m.y / m.n, n: m.n })).sort((a, b) => a.y - b.y);
      stairFlights.push({ cells, ends, y0, y1 });
    }
  }
  const constrained = new Uint8Array(compCells.length);
  const terraceFit = [];                              // (developer checks: walls the fitted heights disagree with)
  if (opts.terraces) {
    // A terraced town (maphints.js): how high each place stands comes from the walls drawn under its roofs and
    // terraces (a wall of k rows: k tiles above the place in front), and - weaker, for places no wall ties in -
    // from the stairs between places (as many tiles as rows they climb, the north end up). The drawing is not
    // always consistent, so the heights are the best fit of all of them (least squares); the lowest place of
    // each group tied together stands at 0
    const cons = [];
    for (const b of bands) {
      if (!b.lowFloor) continue;
      const A = comp[b.uI], B = comp[b.lI];
      if (A >= 0 && B >= 0 && A !== B) cons.push([A, B, b.k, 1, b]);
    }
    for (const f of stairFlights) {
      if (f.ends.length < 2) continue;
      const top = f.ends[0], bottom = f.ends[f.ends.length - 1];
      const rise = Math.max(0, Math.round(bottom.y - top.y) - 1);
      if (top.c !== bottom.c) cons.push([top.c, bottom.c, rise, rise ? 0.4 : 0.1]);
    }
    const nC = compCells.length;
    const adj = Array.from({ length: nC }, () => []);
    for (const [A, B, k, wt] of cons) { adj[A].push([B, k, wt]); adj[B].push([A, -k, wt]); }
    const group = new Int32Array(nC).fill(-1);
    const order = compCells.map((c, i) => i).sort((a, b) => areaOf(b) - areaOf(a));
    let ng = 0;
    for (const root of order) {
      if (group[root] >= 0) continue;
      group[root] = ng; compElev[root] = 0;
      const q = [root];
      for (let head = 0; head < q.length; head++) {
        for (const [to, k] of adj[q[head]]) if (group[to] < 0) { group[to] = ng; compElev[to] = compElev[q[head]] - k; q.push(to); }
      }
      ng++;
    }
    for (let it = 0; it < 800; it++) {
      for (let a = 0; a < nC; a++) {
        if (!adj[a].length) continue;
        let sum = 0, ws = 0;
        for (const [to, k, wt] of adj[a]) { sum += wt * (compElev[to] + k); ws += wt; }
        compElev[a] = sum / ws;
      }
    }
    const gMin = new Float32Array(ng).fill(Infinity);
    for (let a = 0; a < nC; a++) gMin[group[a]] = Math.min(gMin[group[a]], compElev[a]);
    for (const [A, B, k, wt, b] of cons) {
      const res = compElev[A] - compElev[B] - k;
      if (Math.abs(res) >= 1) terraceFit.push([Math.abs(res), b ? `wall ${b.x},${b.y0}-${b.y1}` : 'stairs', k, +(compElev[A] - compElev[B]).toFixed(2), A, B]);
    }
    terraceFit.sort((a, b) => b[0] - a[0]);
    const gSize = new Map();
    for (let a = 0; a < nC; a++) if (compCells[a].some(j => grid.anyPassable(j % w, (j / w) | 0))) gSize.set(group[a], (gSize.get(group[a]) || 0) + compCells[a].length);
    for (const [g, n] of [...gSize].sort((a, b) => b[1] - a[1]).slice(1, 30)) {
      const a = order.find(c => group[c] === g), j = compCells[a][0];
      terraceFit.push([0, `group ${g} of ${n} cells at ${j % w},${(j / w) | 0}`, 0, 0, a, a]);
    }
    for (let a = 0; a < nC; a++) {
      compElev[a] = Math.round((compElev[a] - gMin[group[a]]) * 4) / 4;
      constrained[a] = adj[a].length ? 1 : 0;
    }
  } else {
    const edges = new Map(); // "A>B" -> ks (A above B)
    const proved = new Set();
    for (const b of bands) {
      if (!b.lowFloor) continue;
      const A = comp[b.uI], B = comp[b.lI];
      if (A < 0 || B < 0 || A === B) continue;
      // a plain wall between two places is only a cliff when stairs / a fall lip prove it,
      // or when both sides are real areas (not a decorative strip on top of a wall)
      if (!b.stairs && !b.fall && (areaOf(A) < BIG_AREA || areaOf(B) < BIG_AREA)) continue;
      const key = A + '>' + B;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(b.k);
      if (b.stairs || b.fall) proved.add(key);
    }
    // two places each said to stand above the other (혼돈 던전 51's fort: its front, three rows of wall with the ladder up it, says
    // its top stands 3 above the yard; the strip of wall along its back, the yard beyond, says the yard is 1 above the top - and
    // the top had gone under the yard): the side stairs or a fall's lip prove wins, else the side more of the faces say - as
    // many either way, neither (혼돈 던전 11's wooden stairs through the log wall: a row of wall above the step between their
    // flights and one below it, the step had sunk a tile between the two floors at one level)
    for (const key of [...edges.keys()]) {
      const rev = key.split('>').reverse().join('>');
      if (!edges.has(key) || !edges.has(rev)) continue;
      const p1 = proved.has(key), p2 = proved.has(rev), n1 = edges.get(key).length, n2 = edges.get(rev).length;
      if (p1 === p2 && n1 === n2) { edges.delete(key); edges.delete(rev); continue; }
      edges.delete(p1 !== p2 ? (p1 ? rev : key) : n1 > n2 ? rev : key);
    }
    const adj = compCells.map(() => []);
    for (const [key, ks] of edges) {
      const [A, B] = key.split('>').map(Number);
      if (ks.length < 2 && compCells[A].length > 2 && compCells[B].length > 2) continue; // too weak
      const tally = {};
      for (const k of ks) tally[k] = (tally[k] || 0) + 1;
      const k = +Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      adj[A].push({ to: B, d: -k });
      adj[B].push({ to: A, d: k });
    }
    const done = new Uint8Array(compCells.length);
    const order = compCells.map((c, i) => i).sort((a, b) => areaOf(b) - areaOf(a));
    for (const root of order) {
      if (done[root]) continue;
      done[root] = 1; compElev[root] = 0;
      const q = [root];
      for (let head = 0; head < q.length; head++) {
        const a = q[head];
        for (const { to, d } of adj[a]) if (!done[to]) { done[to] = 1; compElev[to] = compElev[a] + d; q.push(to); }
      }
    }
    // a small floor nothing ties to a level, closed off by a counter - the shopkeeper's side of one: the level of the
    // floor across the counter (정신병원's dispensary: its room had gone two tiles under the backdrop drawn as floor
    // round the building, the shopkeeper's side stayed where it was - the counter a wall of 3.75 m)
    for (let a = 0; a < compCells.length; a++) {
      if (adj[a].length || areaOf(a) >= BIG_AREA) continue;
      const votes = new Map();
      for (const j of compCells[a]) {
        const x = j % w, y = (j / w) | 0;
        for (const [dx, dy] of N4) {
          let nx = x + dx, ny = y + dy, n = 0;
          while (n < 3 && valid(nx, ny) && grid.isTableTop(nx, ny)) { nx += dx; ny += dy; n++; }
          if (!n || !valid(nx, ny)) continue;
          const c = comp[idx(nx, ny)];
          if (c >= 0 && c !== a) votes.set(c, (votes.get(c) || 0) + 1);
        }
      }
      let best = -1, most = 0;
      for (const [c, n] of votes) if (n > most || (n === most && areaOf(c) > areaOf(best))) { best = c; most = n; }
      if (best >= 0) compElev[a] = compElev[best];
    }
  }
  const floorE = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) if (comp[i] >= 0) floorE[i] = compElev[comp[i]];
  for (let i = 0; i < w * h; i++) if (moundCell[i] && comp[i] >= 0) floorE[i] += moundH;   // (maphints mounds: a low bed)
  if (opts.terraces) {
    // what nobody walks on (a planter, the foot of a pillar, a canal) and places nothing ties in sit, cell by
    // cell, at the level most of the ground around them has (they were places of their own, at the bottom)
    const fixed = new Uint8Array(w * h);
    for (let c = 0; c < compCells.length; c++) {
      if (!constrained[c] || !compCells[c].some(j => grid.anyPassable(j % w, (j / w) | 0))) continue;
      for (const j of compCells[c]) fixed[j] = 1;
    }
    for (let pass = 0; pass < 60; pass++) {
      const next = [];
      for (let i = 0; i < w * h; i++) {
        if (comp[i] < 0 || fixed[i]) continue;
        const x = i % w, y = (i / w) | 0;
        const votes = new Map();
        for (const [dx, dy] of N4) {
          if (!valid(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if (fixed[k]) votes.set(floorE[k], (votes.get(floorE[k]) || 0) + 1);
        }
        let best = null, bn = 0;
        for (const [v, n] of votes) if (n > bn || (n === bn && v > best)) { best = v; bn = n; }
        if (best !== null) next.push([i, best]);
      }
      if (!next.length) break;
      for (const [i, v] of next) { floorE[i] = v; fixed[i] = 1; }
    }
  }
  // hand-made heights (maphints.js) for walkable cells the 2D layout cannot place: first as levels, so the
  // cliffs around them are built from these heights; the slopes are laid on after the cliffs
  const hinted = [];
  for (const [x0, y0, x1, y1, hN, hS, axis] of opts.floorHints || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!valid(x, y)) continue;
      const i = idx(x, y);
      if (solid[i] || empty[i] || pit[i]) continue;
      // (a flight drawn side-on, 'x': steps from its west end (hN) to its east end (hS), each cell a flat step - as a
      // terraced town's side-on stairs)
      if (axis === 'x') {
        const e = hN + (hS - hN) * (x - x0 + 0.5) / (x1 - x0 + 1);
        floorE[i] = e;
        hinted.push([i, e, e]);
        continue;
      }
      const span = y1 - y0 + 1;
      const n = hN + (hS - hN) * (y - y0) / span, s = hN + (hS - hN) * (y - y0 + 1) / span;
      floorE[i] = (n + s) / 2;
      hinted.push([i, n, s]);
    }
  }
  // (painted cliffs - maphints highGround: the plateaus' top)
  if (hg) for (let i = 0; i < w * h; i++) if (highG[i] && isFloorIdx(i)) floorE[i] += hg.height;
  if (openVoid) {
    // the water / sky lies below the lowest ground that touches it (bridges can sit low over a gorge)
    let low = Infinity;
    for (let i = 0; i < w * h; i++) {
      if (comp[i] < 0) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of N4) if (valid(x + dx, y + dy) && empty[idx(x + dx, y + dy)]) { low = Math.min(low, floorE[i]); break; }
    }
    if (low !== Infinity) OPEN_LEVEL += low;
  }
  // sloped cliff rows (surface heights at the cell's north / south edges)
  const slope = new Uint8Array(w * h);
  const surfNArr = new Float32Array(w * h), surfSArr = new Float32Array(w * h);
  const cliffTop = new Float32Array(w * h).fill(NaN), cliffBase = new Float32Array(w * h), cliffU = new Int32Array(w * h).fill(-1), cliffL = new Int32Array(w * h).fill(-1);
  const rimCell = new Uint8Array(w * h);
  let slopeBands = 0, cliffWalls = 0;
  for (const b of bands) {
    const eU = floorE[b.uI];
    let eL;
    if (b.lowFloor && eU - floorE[b.lI] >= 0.4) eL = floorE[b.lI];
    else if (b.lowFloor) continue;                     // same level on both sides: an ordinary wall (a fall lip stays a gap)
    else if (!b.fall && !b.stairs && areaOf(comp[b.uI]) < BIG_AREA) continue; // decorative strip
    else eL = eU - b.k;                                // a drop (into darkness or a chasm)
    for (const i of b.rim) {
      rimCell[i] = 1;
      cliffTop[i] = eU + PARAPET; cliffBase[i] = b.lowFloor ? eL : (openVoid ? Math.min(eL, OPEN_LEVEL) : eL);
      cliffU[i] = b.uI; cliffL[i] = b.lowFloor ? b.lI : -1;
    }
    if ((!b.stairs && !b.fall) || (b.fall && b.k > 6)) {   // (a fall face taller than a cliff: a wall to look down from)
      // a cliff with no way up here: a wall from the lower side to a parapet above the upper floor
      // (only the stair columns become ramps, so what looks walkable is walkable)
      const base = b.lowFloor ? eL : (openVoid ? Math.min(eL, OPEN_LEVEL) : eL);
      for (let y = b.y0; y <= b.y1; y++) {
        const i = idx(b.x, y);
        if (!solid[i]) continue;
        cliffTop[i] = eU + PARAPET; cliffBase[i] = base; cliffU[i] = b.uI; cliffL[i] = b.lowFloor ? b.lI : -1;
      }
      cliffWalls++;
      continue;
    }
    slopeBands++;
    for (let y = b.y0; y <= b.y1; y++) {
      const i = idx(b.x, y);
      slope[i] = 1; pit[i] = 0;
      if (solid[i] === SOLID_WALL) solid[i] = 0;
      surfNArr[i] = eU + (eL - eU) * (y - b.y0) / b.k;
      surfSArr[i] = eU + (eL - eU) * (y - b.y0 + 1) / b.k;
      floorE[i] = (surfNArr[i] + surfSArr[i]) / 2;
    }
  }
  // remaining walkable wall-side cells (stairs on a wall that is not a cliff) sit at their neighbours' level - and one with only
  // such cells beside it at theirs, in turn (옥스・워드 대학교 ５: two cells of rock by its lift's top that the drawing over them lets
  // one across - the far one had stayed at the bottom, a hole 100 m deep beside the top)
  const sideSet = new Uint8Array(w * h);
  for (let pass = 0; pass < 64; pass++) {
    const now = [];
    for (let i = 0; i < w * h; i++) {
      if (sideSet[i] || !sideCell[i] || slope[i] || solid[i] || empty[i] || pit[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (!valid(x + dx, y + dy)) continue;
        const k = idx(x + dx, y + dy);
        if (pass === 0 ? levelCell(k) : sideSet[k] === 1) { now.push([i, floorE[k]]); break; }
      }
    }
    if (!now.length) break;
    for (const [i, e] of now) { floorE[i] = e; sideSet[i] = 1; }
  }
  for (let i = 0; i < w * h; i++) if (!slope[i]) { surfNArr[i] = floorE[i]; surfSArr[i] = floorE[i]; }
  if (opts.terraces) {
    // a terraced town's stairs ramp row by row from the place at their top (north) down to the one at their foot;
    // a flight drawn side-on runs across: it steps down cell by cell along the way from its highest end to its
    // lowest (as a north-south ramp it rose and fell under the feet)
    const rampDone = new Uint8Array(w * h);
    const inFlight = new Int32Array(w * h).fill(-1);
    stairFlights.forEach((f, n) => { for (const j of f.cells) inFlight[j] = n; });
    stairFlights.forEach((f, n) => {
      if (f.ends.length < 2 || !f.cells.some(j => sideStairTiles.has(grid.tile(j % w, (j / w) | 0, 0)) || sideStairTiles.has(grid.tile(j % w, (j / w) | 0, 1)))) return;
      const ends = [...f.ends].sort((a, b) => compElev[b.c] - compElev[a.c]);
      const hi = ends[0], lo = ends[ends.length - 1];
      const dist = c => {
        const d = new Map(), q = [];
        for (const j of f.cells) {
          const x = j % w, y = (j / w) | 0;
          for (const [dx, dy] of N4) {
            if (!valid(x + dx, y + dy)) continue;
            const k = idx(x + dx, y + dy);
            if (comp[k] === c && walkAcross(j, k) && !d.has(j)) { d.set(j, 0); q.push(j); }
          }
        }
        for (let hd = 0; hd < q.length; hd++) {
          const j = q[hd], x = j % w, y = (j / w) | 0;
          for (const [dx, dy] of N4) {
            if (!valid(x + dx, y + dy)) continue;
            const k = idx(x + dx, y + dy);
            if (inFlight[k] === n && !d.has(k) && walkAcross(j, k)) { d.set(k, d.get(j) + 1); q.push(k); }
          }
        }
        return d;
      };
      const dH = dist(hi.c), dL = dist(lo.c), hH = compElev[hi.c], hL = compElev[lo.c];
      for (const j of f.cells) {
        const a = dH.get(j), b = dL.get(j);
        const e = a === undefined ? hL : b === undefined ? hH : hH + (hL - hH) * (a + 0.5) / (a + b + 1);
        surfNArr[j] = surfSArr[j] = floorE[j] = e;
        slope[j] = 0; rampDone[j] = 1;
      }
    });
    for (const f of stairFlights) {
      if (!f.ends.length || rampDone[f.cells[0]]) continue;
      const top = f.ends[0], bottom = f.ends[f.ends.length - 1];
      const hT = compElev[top.c], hB = compElev[bottom.c];
      const yT = Math.min(f.y0, Math.round(top.y) + 1), yB = Math.max(f.y1 + 1, Math.round(bottom.y));
      for (const j of f.cells) {
        const y = (j / w) | 0;
        const n = top.c === bottom.c || yB <= yT ? hT : hT + (hB - hT) * (y - yT) / (yB - yT);
        const s2 = top.c === bottom.c || yB <= yT ? hT : hT + (hB - hT) * (y + 1 - yT) / (yB - yT);
        surfNArr[j] = n; surfSArr[j] = s2; floorE[j] = (n + s2) / 2;
        slope[j] = Math.abs(n - s2) > 0.01 ? 1 : 0;
        rampDone[j] = 1;
      }
    }
    // (a stair's edge piece nobody steps on goes with the step beside it)
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < w * h; i++) {
      if (!stairCell[i] || rampDone[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!valid(x + dx, y + dy)) continue;
        const k = idx(x + dx, y + dy);
        if (!rampDone[k]) continue;
        surfNArr[i] = surfNArr[k]; surfSArr[i] = surfSArr[k]; floorE[i] = floorE[k]; slope[i] = slope[k]; rampDone[i] = 1;
        break;
      }
    }
    // a walkable piece of wall face (a landing at a side-on flight's end, a step drawn on the wall) stands
    // between the places it lets you walk to - not at whichever level touches it, or at 0 when none does
    const known = i => rampDone[i] || (comp[i] >= 0 && levelCell(i));
    const faceDone = new Uint8Array(w * h);
    for (let pass = 0; pass < 4; pass++) {
      const next = [];
      for (let i = 0; i < w * h; i++) {
        if (!sideCell[i] || slope[i] || solid[i] || empty[i] || pit[i] || faceDone[i]) continue;
        const x = i % w, y = (i / w) | 0;
        let sum = 0, n = 0;
        for (const [dx, dy] of N4) {
          if (!valid(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if ((known(k) || faceDone[k]) && walkAcross(i, k)) { sum += (surfNArr[k] + surfSArr[k]) / 2; n++; }
        }
        if (n) next.push([i, sum / n]);
      }
      if (!next.length) break;
      for (const [i, e] of next) { floorE[i] = surfNArr[i] = surfSArr[i] = e; faceDone[i] = 1; }
    }
  }
  for (const [i, n, s] of hinted) {
    if (solid[i] || pit[i]) continue;
    surfNArr[i] = n; surfSArr[i] = s; floorE[i] = (n + s) / 2;
    slope[i] = Math.abs(n - s) > 0.01 ? 1 : 0;
  }
  Object.assign(M, { OPEN_LEVEL, bands, baseH, cliffBase, cliffL, cliffTop, cliffU, cliffWalls, comp, compElev,
      extCell, floorE, height, rimCell, slope, slopeBands, stripOf, surfNArr, surfSArr, terraceFit });
}
