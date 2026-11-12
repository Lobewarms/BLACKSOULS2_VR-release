// Building a map, its second stage: what each cell is - the upper layer's objects (a flat decal, a solid thing, a star tile),
// and the solids: walls, masses of the impassable, the void, rails, low blocks (tables, beds, ledges), the parallax's floor.
import { LYING_TILES } from '../lying.js';
import { F, autotileKind, isA1, isA2, isVisible, isWallSide, isWallType } from '../tiles.js';

export function classifyCells(M) {
  const { N4, grid, h, idx, onStairTile, opts, pits, tileAvg, valid, w } = M;
  // ---- upper layer objects: 0 none, 1 flat decal, 2 solid (blocks some direction), 3 star
  const objType = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t2 = grid.tile(x, y, 2);
    if (!isVisible(t2)) continue;
    const f = grid.flag(t2);
    if (f & F.STAR) objType[idx(x, y)] = 3;
    else if ((f & F.ALL) !== 0) objType[idx(x, y)] = 2;
    else objType[idx(x, y)] = 1;
  }

  // ---- solid cells ----------------------------------------------------------------
  //  1 = A3/A4 wall autotile block
  //  2 = "mass": other sizeable impassable areas (buildings drawn with B-E tiles, cliffs, shelves)
  //  3 = "void": untiled black cells next to walkable floor (RPG Maker's black ceiling)
  const SOLID_WALL = 1, SOLID_MASS = 2, SOLID_VOID = 3, SOLID_RAIL = 4, SOLID_LOW = 5, MAX_MASS = 6;
  // a shown water / sky parallax is what the empty cells are (a river under a bridge, sky under
  // floating ground): those cells stay open and the parallax lies below as water or sky
  const pname0 = grid.map.parallax_name || '';
  const parShown = !!(pname0 && grid.map.parallax_show && !/^yuka/i.test(pname0));
  // (異次元 'ijigen' - the void round 병든 시계탑 1's walkways - is open below like a sky: its railings stay railings,
  // not tall walls that made the walkways deep corridors)
  // (maphints.js openSky: a background named otherwise that is the sky round the map and the land far below - 병든 시계탑 3's
  // town at night)
  const parKind = !parShown ? '' : opts.openSky ? 'sky' : /water|sea|river|lake|海|水|川|湖/i.test(pname0) ? 'water' : /sky|cloud|空|雲|ijigen|異次元/i.test(pname0) ? 'sky' : '';
  const openVoid = !!parKind;
  // an "Ocean" backdrop (RTP Ocean1-3: a sky over the sea, seen past the edge of a seaside map): the untiled
  // cells are that view, not the black ceiling - they are not walled in; its sea lies under them
  const oceanView = parShown && /ocean/i.test(pname0);
  let OPEN_LEVEL = parKind === 'water' ? -0.45 : -8;     // tiles (re-based on the lowest shore below)
  const PARAPET = 0.5;                                  // cliff walls rise this far above the upper floor
  const empty = new Uint8Array(w * h);
  const solid = new Uint8Array(w * h);
  const pit = new Uint8Array(w * h);
  const wallKind = new Int16Array(w * h).fill(-1);
  const isSide = new Uint8Array(w * h);
  for (const i of pits) if (i >= 0 && i < w * h) pit[i] = 1;
  // a wall top / roof is "passable" in RPG Maker when its edges only stop you walking off it, a wall
  // face when a decoration drawn on it is: when the player can never get there (opts.reach: the cells
  // they can walk to), it is a solid wall
  const reach = opts.reach || null;
  const offLimits = i => !!reach && !reach[i] && !pit[i];
  // cells drawn with wall tiles that are a floor (maphints.js wallFloors: 리델 묘지 １'s long stairs, drawn with building tiles,
  // the way down their middle): built as floor - their heights from the floors hint - not walls
  const wallFloor = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of opts.wallFloors || []) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (valid(x, y)) wallFloor[idx(x, y)] = 1;
  // a lift's way (mapanalysis.js lifts - lift.js): the rock it is carried through, five cells wide round its column (room round
  // its 3-cell platform), is the slope it rides (set once the floors' heights are known - below), and a landing drawn as rock
  // (its end of the column, walked on) is floor: both drawn lying, never blocks
  const liftCell = new Uint8Array(w * h);
  for (const L of opts.lifts || []) {
    const topOpen = valid(L.x, L.yTop) && grid.anyPassable(L.x, L.yTop);      // (7-1's: nothing to land on at the top)
    for (let y = L.yTop; y <= L.yBottom; y++) for (let x = L.x - 2; x <= L.x + 2; x++) {
      if (!valid(x, y)) continue;
      const end = y === L.yBottom || (y === L.yTop && topOpen), open = grid.anyPassable(x, y);
      if (end ? open : !open) { liftCell[idx(x, y)] = end ? 2 : 1; wallFloor[idx(x, y)] = 1; }
    }
  }
  // a slide down the screen at the player's own pace (mapanalysis.js falls: slide - 피눈물 웅덩이's blood stream down its
  // cliff): the cells it is carried through, from its own down to the floor it comes onto, are a chute - floor sloping from
  // the floor it is left from (the cell above) down to that one (its heights once the floors' heights are known: below),
  // never a hole to drop into; the cliff on either side of it stays
  const chuteCell = new Uint8Array(w * h);
  const chutes = [];
  for (const f of opts.falls || []) {
    if (!f.slide || f.dir !== 1 || !valid(f.x, f.y - 1)) continue;
    const cells = [];
    for (let k = 0; k < f.n && valid(f.x, f.y + k) && !(k > 0 && grid.anyPassable(f.x, f.y + k)); k++) cells.push(idx(f.x, f.y + k));
    if (!cells.length || !valid(f.x, f.y + cells.length)) continue;
    for (const j of cells) { chuteCell[j] = 1; wallFloor[j] = 1; }
    chutes.push({ top: idx(f.x, f.y - 1), cells, bottom: idx(f.x, f.y + cells.length) });
  }
  const raisedTop = new Uint8Array(w * h);
  // the top half of a door drawn two rows tall (maphints.js doorTops): a cell of the wall beside it, drawn as itself
  const doorTop = new Set((opts.doorTops || []).filter(([x, y]) => valid(x, y)).map(([x, y]) => idx(x, y)));
  const wallBeside = (x, y) => {
    for (const dx of [-1, 1]) {
      if (!valid(x + dx, y)) continue;
      const a = grid.tile(x + dx, y, 1), b = grid.tile(x + dx, y, 0);
      if (isWallType(a)) return a;
      if (isWallType(b)) return b;
    }
    return 0;
  };
  // a floor drawn with wall-side tiles the map lets one walk on (무한음식 ２●'s shop: checkered, all of it): a cell of it only
  // a thing drawn over it stops one on - a candy lying there - is that floor with the thing on it, not a pillar of the floor's
  // checks with the candy on its top. (its own tile passable every way, the thing drawn - not a clear tile that only stops one -
  // and two or more cells round it walked on of such tiles - got to: a wall's face the map lets one through, out of reach, with
  // a barred window drawn on it, is a wall - 정신병원 ３; a thing by itself: no cell beside it stopped by more of a drawing -
  // 퀸・랜드's dark doorway, three cells wide, stays whole)
  const sideFloor = (x, y, wt) => {
    if (!isWallSide(wt) || (grid.flag(wt) & (F.ALL | F.STAR)) || objType[idx(x, y)] !== 2 || !(tileAvg(grid.tile(x, y, 2)).cover > 0)) return false;
    let n = 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!valid(nx, ny)) continue;
      if (!grid.anyPassable(nx, ny) && objType[idx(nx, ny)] === 2) return false;      // (a piece of something bigger drawn there)
      if (grid.anyPassable(nx, ny) && !offLimits(idx(nx, ny)) && (isWallSide(grid.tile(nx, ny, 0)) || isWallSide(grid.tile(nx, ny, 1)))) n++;
    }
    return n >= 2;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1), t2 = grid.tile(x, y, 2);
    if (!isVisible(t0) && !isVisible(t1) && !isVisible(t2)) { empty[i] = 1; continue; }
    const wt = isWallType(t1) ? t1 : isWallType(t0) ? t0 : doorTop.has(i) ? wallBeside(x, y) : 0;
    if (wt && !wallFloor[i] && (!grid.anyPassable(x, y) || offLimits(i) || doorTop.has(i)) && !(!grid.anyPassable(x, y) && sideFloor(x, y, wt))) {
      if (grid.anyPassable(x, y)) raisedTop[i] = 1;
      solid[i] = SOLID_WALL;
      const k = autotileKind(wt);
      if (isWallSide(wt)) { isSide[i] = 1; wallKind[i] = k; } else wallKind[i] = k + 8;
    }
  }
  // under an open sky (maphints.js openSky) a cell drawn with nothing but a clear tile is air like the untiled ones: walked on
  // where the original lets you (병든 시계탑 3's bridge nobody can see), fallen through where it drops - nothing is drawn there
  // or under it
  const clear = new Uint8Array(w * h);
  if (opts.openSky) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ids = [0, 1, 2].map(z => grid.tile(x, y, z)).filter(isVisible);
    if (ids.length && ids.every(t => tileAvg(t).cover === 0)) clear[idx(x, y)] = 1;
  }
  // over an open void, impassable upper-layer tiles with nothing under them are railings / bridge edges
  if (openVoid) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (solid[i] || empty[i] || grid.anyPassable(x, y)) continue;
    if (isVisible(grid.tile(x, y, 0)) || isVisible(grid.tile(x, y, 1)) || !isVisible(grid.tile(x, y, 2))) continue;
    solid[i] = SOLID_RAIL;
  }
  // ... and so are those drawn on a walkway's edge over its floor, the void (or such a railing) right beyond and
  // the way on the other side: the upper tile blocks, the floor under it would not - in runs of 3 or more (one or two
  // such cells are a post or a sign by the water, left as they were). (병든 시계탑 1: its walkways' south railings
  // stood as tall walls)
  if (openVoid) {
    const edgeRail = new Set();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (solid[i] || empty[i]) continue;
      const t2 = grid.tile(x, y, 2), t1 = grid.tile(x, y, 1), low = isVisible(t1) ? t1 : grid.tile(x, y, 0);
      if (!isVisible(t2) || !isVisible(low) || (grid.flag(t2) & 0xf) !== 0xf || (grid.flag(low) & 0xf) === 0xf) continue;
      const beyond = ([dx, dy]) => valid(x + dx, y + dy) && (empty[idx(x + dx, y + dy)] || solid[idx(x + dx, y + dy)] === SOLID_RAIL) && valid(x - dx, y - dy) && grid.anyPassable(x - dx, y - dy);
      if (N4.some(beyond)) edgeRail.add(i);
    }
    const seen = new Set();
    for (const i0 of edgeRail) {
      if (seen.has(i0)) continue;
      const run = [i0];
      seen.add(i0);
      for (let k = 0; k < run.length; k++) {
        const x = run[k] % w, y = (run[k] / w) | 0;
        for (const [dx, dy] of N4) {
          const j = valid(x + dx, y + dy) ? idx(x + dx, y + dy) : -1;
          if (j >= 0 && edgeRail.has(j) && !seen.has(j)) { seen.add(j); run.push(j); }
        }
      }
      if (run.length >= 3) for (const j of run) solid[j] = SOLID_RAIL;
    }
  }
  // a drop the map draws black beside a walkway (maphints.js abyss): kept open, not walled in like the black
  // ceiling. Wall faces drawn in it right under a floor (that floor's foundation, seen from the front) leave the
  // floor plan and hang below the floor's edge (hangArt: the cell whose drawing they show)
  const abyss = new Uint8Array(w * h), abyssLo = new Float32Array(w * h), hangArt = new Uint8Array(w * h);
  let anyAbyss = false;
  // ('hang' after the depth: a chasm drawn from the side - H루트 탈출２'s pillars, jumped from top to top: every cell nobody walks on
  // is the drop - the clear tiles that show only the background, and what is drawn in the gaps - but what the drawing shows under
  // a walkable top, its foundation seen from the front (a pillar under each top, an island's rock under its top), hangs below
  // that top as deep as it is drawn, on every side of it: hangTop, the top it hangs from)
  const hangMode = new Uint8Array(w * h), hangTop = new Int32Array(w * h).fill(-1), gapTop = new Int32Array(w * h).fill(-1);
  const drawnAt = (x, y) => [0, 1, 2].some(z => { const t = grid.tile(x, y, z); return isVisible(t) && tileAvg(t).cover > 0; });
  const topOver = (x, y) => {
    for (let yy = y - 1; yy >= 0; yy--) {
      if (grid.anyPassable(x, yy)) return yy;
      if (!drawnAt(x, yy)) return -1;
    }
    return -1;
  };
  // ('all' after the depth: whatever else is there that nobody can reach too - 퀸・랜드's approach: the black round the bridge to
  // the castle, drawn with wall-top tiles, stood as walls along it with the balloons on their tops)
  for (const [x0, y0, x1, y1, depth = 6, all] of opts.abyss || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!valid(x, y)) continue;
      const i = idx(x, y);
      if (all === 'hang') {
        if (grid.anyPassable(x, y)) continue;
        const top = drawnAt(x, y) ? topOver(x, y) : -1;
        if (top >= 0) { hangArt[i] = 1; hangTop[i] = idx(x, top); }
        hangMode[i] = 1;
        objType[i] = 0;                                  // (what is drawn there hangs with the foundation, never stands up)
      } else if (all === 'all' && offLimits(i) && !pit[i]) { /* taken below */ }
      else if (solid[i] === SOLID_WALL && isSide[i] && !grid.anyPassable(x, y)) { hangArt[i] = 1; }
      else if (!empty[i]) continue;
      solid[i] = 0; empty[i] = 1; isSide[i] = 0; wallKind[i] = -1; raisedTop[i] = 0;
      abyss[i] = 1; abyssLo[i] = -depth; anyAbyss = true;
    }
  }
  // (what is drawn in a gap between two foundations at the same depth - a rock drawn across a gap, in front of the pillars either
  // side of it - hangs there with them, on their front)
  for (let i = 0; i < w * h; i++) {
    if (!hangMode[i] || hangArt[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (!drawnAt(x, y)) continue;
    for (const dx of [-1, 1]) {
      const j = valid(x + dx, y) ? idx(x + dx, y) : -1;
      if (j >= 0 && hangArt[j] && hangTop[j] >= 0) { gapTop[i] = hangTop[j]; break; }
    }
  }
  // water (lava, swamp) is what shows: ground drawn over a water base (a fence, a hedge, rocks) is not
  // water, unless it is dark (a moat, an abyss painted over the water)
  const isWaterTop = (x, y) => {
    const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1);
    if (!isVisible(t1) || isA1(t1)) return isA1(isVisible(t1) ? t1 : t0);
    return isA1(t0) && tileAvg(t1).lum < 50;
  };
  // hand-made ledges (maphints.js lips): kept out of the masses, low blocks below
  const lipH = new Float32Array(w * h).fill(NaN);
  for (const [x0, y0, x1, y1, hh] of opts.lips || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (valid(x, y) && !empty[idx(x, y)] && !solid[idx(x, y)] && !grid.anyPassable(x, y)) lipH[idx(x, y)] = hh;
  }
  // things in a row along a wall's foot (maphints.js props): each its own picture, never part of a block
  const propCell = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of opts.props || []) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (valid(x, y)) propCell[idx(x, y)] = 1;
  // (and what blocks a floor carrying the counter flag - grid.counterOnFloorOnly: the cauldrons and bottles stood on blocks of
  // floor as on tables)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!grid.anyPassable(x, y) && grid.counterOnFloorOnly(x, y)) propCell[idx(x, y)] = 1;
  // a flight drawn side-on (maphints floors with 'x'): steps a cell at a time, its drawing (the steps, the banister, the side
  // under it) lying on them - standing up, its pieces stood about the steps as boards; the cells nobody walks on are steps
  // too (the stair's side), never a block
  const flatCell = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1, , , axis] of opts.floorHints || []) {
    if (axis === 'x') for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (valid(x, y)) flatCell[idx(x, y)] = 1;
  }
  for (let i = 0; i < w * h; i++) if (wallFloor[i]) flatCell[i] = 1;
  // ground nobody walks on, drawn as ground (maphints.js mounds: { a2: [A2 kinds], height } - 포자의 숲's thickets round its paths,
  // the mushrooms growing on them): a low bed of that ground, what grows on it standing on its top - not a block of the
  // ground's own art with the mushrooms painted on its faces
  const moundCell = new Uint8Array(w * h);
  const moundH = opts.mounds?.height ?? 0.35;
  if (opts.mounds?.a2?.length) {
    const kinds = new Set(opts.mounds.a2.map(k => 16 + k));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1);
      const ground = isA2(t1) ? t1 : isA2(t0) ? t0 : 0;
      if (ground && kinds.has(autotileKind(ground)) && !grid.anyPassable(x, y)) moundCell[idx(x, y)] = 1;
    }
  }
  // furniture drawn from above (lying.js: beds, tables, coffins, bathtubs): lies as a low block (below), never part of a
  // mass - beds side by side along a wall, a bed maze (혼돈 던전 １), beds in the void round 크리미아 간호 묘지 ３－１ stood as
  // walls with the blankets on their faces
  const lyingTile = new Set();
  for (let t = 0; t < 1024; t++) {
    const list = LYING_TILES[grid.tileset.tileset_names[5 + (t >> 8)]];
    if (list && list.includes(t & 255)) lyingTile.add(t);
  }
  const cand = new Uint8Array(w * h);
  // (maphints solids: cells the map leaves walkable or draws as water that are part of a block - a facade's columns drawn
  // with an animated tile, a garland down it - kept in the block, not a slit in it)
  const forcedSolid = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of opts.solids || []) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (valid(x, y)) forcedSolid[idx(x, y)] = 1;
  // cliffs painted on ground all at one level (maphints.js highGround { from: [x, y], height } - 하얀 성시 ３－１ BOSS: snow
  // plateaus round a canyon, their rock faces B-E tiles on the same ground): the ground a walk from (x, y) never gets to is
  // the plateaus' top, `height` tiles up, and a run of cells nobody walks through drawn straight down from its edge to lower
  // ground is a cliff's face - a block up to that top, its drawing on its front (the faces stood about as boards, the
  // plateaus as flat as the canyon). What nobody walks on elsewhere (a tree, a rock) goes with the ground round it
  const highG = new Uint8Array(w * h), cliffFace = new Uint8Array(w * h), faceUp = new Int32Array(w * h).fill(-1);
  const hg = opts.highGround?.from && opts.highGround.height > 0 ? opts.highGround : null;
  let faceArt = null;
  if (hg) {
    const lowG = new Uint8Array(w * h);
    const [fx, fy] = hg.from;
    const q = valid(fx, fy) ? [idx(fx, fy)] : [];
    for (const k of q) lowG[k] = 1;
    while (q.length) {
      const k = q.pop(), x = k % w, y = (k / w) | 0;
      for (const [d, dx, dy] of [[2, 0, 1], [4, -1, 0], [6, 1, 0], [8, 0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!valid(nx, ny) || lowG[idx(nx, ny)] || !grid.passable(x, y, d) || !grid.passable(nx, ny, 10 - d)) continue;
        lowG[idx(nx, ny)] = 1;
        q.push(idx(nx, ny));
      }
    }
    const ground = i => !solid[i] && !empty[i] && !pit[i];
    const walked = i => grid.anyPassable(i % w, (i / w) | 0);
    for (let i = 0; i < w * h; i++) if (ground(i) && !lowG[i] && walked(i)) highG[i] = 1;
    for (let x = 0; x < w; x++) for (let y = 1; y < h; y++) {
      const up = idx(x, y - 1);
      if (!highG[up]) continue;
      let y1 = y;
      while (y1 < h && y1 - y < 4 && ground(idx(x, y1)) && !walked(idx(x, y1)) && !isWaterTop(x, y1)) y1++;
      if (y1 === y || y1 >= h || !ground(idx(x, y1)) || highG[idx(x, y1)] || (!walked(idx(x, y1)) && !isWaterTop(x, y1))) continue;
      for (let yy = y; yy < y1; yy++) { cliffFace[idx(x, yy)] = 1; faceUp[idx(x, yy)] = up; solid[idx(x, yy)] = SOLID_MASS; }
    }
    const side = new Int8Array(w * h);                    // 1 up, -1 down
    for (let i = 0; i < w * h; i++) if (ground(i) && walked(i)) side[i] = highG[i] ? 1 : -1;
    for (let pass = 0; pass < 12; pass++) {
      const next = [];
      for (let i = 0; i < w * h; i++) {
        if (side[i] || !ground(i)) continue;
        let up = 0, down = 0;
        for (const [dx, dy] of N4) {
          const x = (i % w) + dx, y = ((i / w) | 0) + dy;
          if (valid(x, y)) { const s = side[idx(x, y)]; if (s > 0) up++; else if (s < 0) down++; }
        }
        if (up || down) next.push([i, down ? -1 : 1]);
      }
      if (!next.length) break;
      for (const [i, s] of next) side[i] = s;
    }
    for (let i = 0; i < w * h; i++) if (side[i] > 0) highG[i] = 1;
    // the face as the map draws it most (its tiles from the foot up): the plateau's other sides, where the map draws none,
    // are that rock too
    const runs = new Map();
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      if (!cliffFace[idx(x, y)] || (y > 0 && cliffFace[idx(x, y - 1)])) continue;
      const ids = [];
      for (let yy = y; valid(x, yy) && cliffFace[idx(x, yy)]; yy++) ids.unshift(grid.tile(x, yy, 2));
      const key = ids.join(',');
      runs.set(key, (runs.get(key) || 0) + 1);
    }
    let most = 0;
    for (const [key, n] of runs) if (n > most) { most = n; faceArt = key.split(',').map(Number); }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (forcedSolid[i] && !solid[i] && !empty[i]) { pit[i] = 0; cand[i] = 1; continue; }
    if (solid[i] || empty[i] || pit[i] || propCell[i] || flatCell[i] || moundCell[i] || grid.anyPassable(x, y)) continue;
    if (lyingTile.has(grid.tile(x, y, 2))) continue;
    if (isWaterTop(x, y) || grid.isTableTop(x, y) || !Number.isNaN(lipH[i])) continue; // water/lava, counters, ledges stay low
    if (onStairTile(x, y)) continue;                     // (a stair's edge piece goes with its stairs)
    cand[i] = 1;
  }
  const compSize = new Int32Array(w * h);
  {
    const seen = new Uint8Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!cand[s] || seen[s]) continue;
      const cells = [];
      const q = [s];
      seen[s] = 1;
      let minx = w, maxx = -1, hasObj = false, touches = false;
      while (q.length) {
        const j = q.pop();
        cells.push(j);
        const x = j % w, y = (j / w) | 0;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (objType[j] === 2 || objType[j] === 3) hasObj = true;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!valid(nx, ny)) { touches = true; continue; }
          const k = idx(nx, ny);
          if (solid[k] === SOLID_WALL || empty[k]) touches = true;
          if (cand[k] && !seen[k]) { seen[k] = 1; q.push(k); }
        }
      }
      const n = cells.length, bw = maxx - minx + 1;
      // small free-standing props (tables, barrels, statues) stay as standees
      const isMass = !hasObj || n >= 16 || (n >= 4 && touches && bw >= 2);
      if (isMass) for (const j of cells) { solid[j] = SOLID_MASS; compSize[j] = n; }
    }
  }
  const isFloorIdx = i => !solid[i] && !empty[i] && !pit[i];
  // black untiled cells bordering the floor become walls (closing rooms like the 2D black ceiling)
  for (let y = 0; y < h && !openVoid && !oceanView; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (!empty[i] || abyss[i]) continue;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (valid(nx, ny) && isFloorIdx(idx(nx, ny)) && grid.anyPassable(nx, ny)) { solid[i] = SOLID_VOID; empty[i] = 0; break; }
    }
  }
  const isSolid = (x, y) => valid(x, y) && solid[idx(x, y)] !== 0 && !pit[idx(x, y)];
  const isWallCell = (x, y) => valid(x, y) && solid[idx(x, y)] === SOLID_WALL;
  const isFloor = (x, y) => valid(x, y) && isFloorIdx(idx(x, y));

  // nearest A3/A4 wall kind: "paired" wall art for faces the 2D view never shows
  const nearKind = new Int16Array(w * h).fill(-1);
  {
    const q = [];
    for (let i = 0; i < w * h; i++) if (solid[i] === SOLID_WALL && wallKind[i] >= 0) { nearKind[i] = wallKind[i]; q.push(i); }
    const dist = new Uint8Array(w * h);
    for (let head = 0; head < q.length; head++) {
      const j = q[head];
      if (dist[j] >= 24) continue;
      const x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!valid(nx, ny)) continue;
        const k = idx(nx, ny);
        if (nearKind[k] >= 0) continue;
        nearKind[k] = nearKind[j];
        dist[k] = dist[j] + 1;
        q.push(k);
      }
    }
  }

  Object.assign(M, { MAX_MASS, OPEN_LEVEL, PARAPET, SOLID_LOW, SOLID_MASS, SOLID_RAIL, SOLID_VOID, SOLID_WALL, abyss,
      abyssLo, anyAbyss, chuteCell, chutes, clear, cliffFace, compSize, empty, faceArt, faceUp, flatCell, gapTop,
      hangArt, hangMode, hangTop, hg, highG, isFloor, isFloorIdx, isSide, isSolid, isWallCell, isWaterTop, liftCell,
      lipH, lyingTile, moundCell, moundH, nearKind, objType, openVoid, parKind, pit, propCell, raisedTop, reach, solid,
      wallKind });
}
