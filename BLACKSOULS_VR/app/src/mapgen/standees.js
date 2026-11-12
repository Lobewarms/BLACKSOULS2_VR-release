// Building a map, its fifth stage: doorways (a walkable notch in a facade gets a lintel) and the standees - the upright
// B-E pictures that are not part of a mass: stacks a column tall, boxes along a wall, things lying low (beds, tables),
// where a picture drawn on a solid stands, foot shadows; and the cells left that nothing is drawn on (invisible walls).
import { F, TS, isVisible } from '../tiles.js';

export function placeStandees(M) {
  const { SOLID_LOW, connected, drawer, drawnSpan, empty, extCell, flatCell, flatTiles, floorE, gaps, grid, h,
      hasShadow, idx, isFloor, isFloorIdx, isSolid, isWaterTop, lyingTile, moundCell, moundH, objType, opts, pit,
      shadowPx, shaft, sideBox, slope, solid, solidBase, solidTop, valid, w } = M;
  // ---- doorways: a walkable notch in a facade (door tile / door event) gets a lintel ------
  // A door picture (an event's door graphic, or a door tile) stands on the facade's front face as in 2D
  // and the opening goes up to its top, so the wall continues right above it; an empty doorway is 1.25 high.
  const isDoorCell = opts.isDoorCell || (() => false);
  const OPEN = 1.25; // opening height in tiles of a doorway without a door picture
  const stackConsumed = new Uint8Array(w * h);
  const doorways = [];
  const doorBelow = new Map(); // solid cell index -> doorway under its south face
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = idx(x, y);
    if (!isFloorIdx(i) || slope[i]) continue;
    const shaftBehind = valid(x, y - 1) && ((!!sideBox && !!pit[idx(x, y - 1)]) || (!!shaft && !!shaft[idx(x, y - 1)]));   // a door into the drop
    if ((!isSolid(x, y - 1) && !shaftBehind) || !isSolid(x - 1, y) || !isSolid(x + 1, y)) continue;
    if (!isFloor(x, y + 1)) continue;
    const t2 = grid.tile(x, y, 2);
    const hasArt = isVisible(t2) && objType[i] !== 2;
    if (!hasArt && !isDoorCell(x, y)) continue;
    const base = floorE[i];
    const topD = Math.min(solidTop[idx(x - 1, y)], solidTop[idx(x + 1, y)]);
    if (topD - base < 2) continue;
    const picH = opts.doorHeight?.(x, y) || 0;
    const open = picH > 0 ? Math.min(Math.max(picH, 1), topD - base) : hasArt ? 1 : OPEN;
    const d = { x, y, base, top: topD, art: hasArt ? t2 : 0, shaft: shaftBehind && !isSolid(x, y - 1), open };
    if (hasArt) stackConsumed[i] = 1;
    doorways.push(d);
    doorBelow.set(idx(x, y - 1), d);
  }

  // ---- standees (upright B-E objects that are not part of a mass) ---------------------
  const hscratch = document.createElement('canvas');
  hscratch.width = TS * 2; hscratch.height = TS;
  const hctx = hscratch.getContext('2d', { willReadFrequently: true });
  const hconnCache = new Map();
  function hConnected(leftId, rightId) {
    const key = leftId + ':' + rightId;
    if (hconnCache.has(key)) return hconnCache.get(key);
    hctx.clearRect(0, 0, TS * 2, TS);
    drawer.draw(hctx, leftId, 0, 0);
    drawer.draw(hctx, rightId, TS, 0);
    const a = hctx.getImageData(TS - 1, 0, 2, TS).data;
    let both = 0, any = 0;
    for (let i = 0; i < TS; i++) {
      const al = a[i * 8 + 3] > 100, ar = a[i * 8 + 7] > 100;
      if (al && ar) both++;
      if (al || ar) any++;
    }
    const res = both >= 6 && both >= any * 0.45;
    hconnCache.set(key, res);
    return res;
  }
  const taken = i => stackConsumed[i] || extCell[i] || flatCell[i];
  // (maphints overlaps: things drawn over each other - 포자의 숲's mushrooms, one's cap over another's: a piece drawn above the
  // player that does not go on from the piece under it but runs on into a piece beside it in its row is that one's - the climb
  // up a column stops there)
  const othersPiece = (x, yy, t, under) => {
    if (!opts.overlaps || connected(t, under)) return false;
    const l = valid(x - 1, yy) ? grid.tile(x - 1, yy, 2) : 0, r = valid(x + 1, yy) ? grid.tile(x + 1, yy, 2) : 0;
    return (isVisible(l) && hConnected(l, t)) || (isVisible(r) && hConnected(t, r));
  };
  const edgeFence = i => objType[i] === 3 && (grid.flag(grid.tile(i % w, (i / w) | 0, 2)) & F.ALL) !== 0 && grid.anyPassable(i % w, (i / w) | 0);
  // things n rows tall set one behind another in a column (maphints.js cabinets: shelves along a side wall, each drawn
  // facing south): each its own, not one tall thing - their drawings run on into each other
  const cabRows = (x, y) => { for (const [x0, y0, x1, y1, n] of opts.cabinets || []) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return n; return 0; };
  let stacks = [];
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      const i = idx(x, y);
      // (a walkable cell's upper art - a bridge deck, a podium's top, a carpet on stairs, a rail drawn on
      // its edge - lies on the floor; what blocks only some ways gets a rail on that edge)
      const onTable = solid[i] === SOLID_LOW && grid.isTableTop(x, y);
      if (taken(i) || objType[i] !== 2 || (solid[i] && !onTable) || pit[i] || grid.anyPassable(x, y)) continue;
      const tiles = [grid.tile(x, y, 2)];
      stackConsumed[i] = 1;
      const rowsMax = cabRows(x, y) || Infinity;
      // standing in a room: walkable floor in front of it, or something else standing there (a counter,
      // another shelf) whose drawing does not go on from this one (a roof's does: no room there)
      const fi = idx(x, y + 1);
      const roomFloor = valid(x, y + 1) && !solid[fi] && !pit[fi] && (grid.anyPassable(x, y + 1) || !connected(tiles[0], grid.tile(x, y + 1, 2)));
      // how many of the blocking pieces drawn over the wall from row ty up carry the drawing of the piece
      // under them on: a thing's top ends within three (a building's wall drawn with tiles goes on up -
      // none of that is taken)
      const wallRunFrom = (ty, prev) => {
        let n = 0;
        for (; ty >= 0 && n <= 3; ty--) {
          const tj = idx(x, ty), tt = grid.tile(x, ty, 2);
          if (taken(tj) || pit[tj] || !solid[tj] || objType[tj] !== 2 || !connected(tt, prev)) break;
          n++; prev = tt;
        }
        return n > 3 ? 0 : n;
      };
      let overWall = 0, wallRun = -1;
      let yy = y - 1;
      while (yy >= 0 && tiles.length < rowsMax) {
        const j = idx(x, yy);
        if (taken(j) || pit[j]) break;
        const t = grid.tile(x, yy, 2);
        if (wallRun < 0 && solid[j]) wallRun = roomFloor ? wallRunFrom(yy, tiles[tiles.length - 1]) : 0;
        // inside walls/masses only star tiles (tops of things standing in front) are taken - and the upper
        // part of a thing standing in a room against the wall, drawn over the wall's foot as blocking pieces
        // whose drawing goes on from the piece below (a bookshelf, a clock, a stove two to four tiles tall):
        // it was left on the wall face, behind the lower part, so the thing looked cut
        const furnitureTop = solid[j] && objType[j] === 2 && overWall < wallRun && connected(t, tiles[tiles.length - 1]);
        // the same blocking piece again: a railing / fence running north-south, many things in a row
        // rather than one tall thing (whose upper part is drawn above the player), so each stands on its
        // own cell (not so a tall shelf's middle repeated up the wall)
        if (t === tiles[tiles.length - 1] && objType[j] === 2 && !furnitureTop) break;
        if (objType[j] === 3 && othersPiece(x, yy, t, tiles[tiles.length - 1])) break;
        const ok = (objType[j] === 3 && !(edgeFence(j) && solid[idx(x, yy + 1)])) || furnitureTop || (!solid[j] && objType[j] === 2 && !grid.anyPassable(x, yy) && connected(t, tiles[tiles.length - 1]));
        if (!ok) break;
        if (furnitureTop) overWall++;
        tiles.push(t); stackConsumed[j] = 1; yy--;
      }
      stacks.push({ x, cellY: y, topY: y - tiles.length + 1, tiles, elev: 0, onTable });
    }
  }
  // orphan star tiles (drawn above the player, nothing under them to stand on): hang above the cell below
  // them (a lamp, the top of an arch over a path, a roof's eaves, moss hanging off a wall) - unless it is a
  // thing standing free on the ground: its drawing reaches down to the bottom of the tile, there is ground
  // under it, and no wall or block touches it (a croquet hoop, a tree, a statue, a lamp post, a gazebo)
  const reachesBottom = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TS;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const memo = new Map();
    return t => {
      if (memo.has(t)) return memo.get(t);
      cx.clearRect(0, 0, TS, TS);
      drawer.draw(cx, t, 0, 0);
      const a = cx.getImageData(0, TS - 2, TS, 2).data;
      let n = 0;
      for (let k = 3; k < a.length; k += 4) if (a[k] > 100) n++;
      memo.set(t, n >= 3);
      return n >= 3;
    };
  })();
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      const i = idx(x, y);
      if (taken(i) || objType[i] !== 3 || solid[i] || pit[i]) continue;
      const tiles = [grid.tile(x, y, 2)];
      stackConsumed[i] = 1;
      let yy = y - 1;
      while (yy >= 0 && !taken(idx(x, yy)) && objType[idx(x, yy)] === 3 && !solid[idx(x, yy)] && !pit[idx(x, yy)] &&
        !othersPiece(x, yy, grid.tile(x, yy, 2), tiles[tiles.length - 1])) {
        tiles.push(grid.tile(x, yy, 2)); stackConsumed[idx(x, yy)] = 1; yy--;
      }
      const below = y + 1;
      const bi = idx(x, below);
      if (below < h && !taken(bi) && objType[bi] === 1 && !solid[bi] && !pit[bi] && connected(tiles[0], grid.tile(x, below, 2))) {
        tiles.unshift(grid.tile(x, below, 2));
        stackConsumed[bi] = 1;
        stacks.push({ x, cellY: below, topY: y - tiles.length + 2, tiles, elev: 0 });
      } else if (reachesBottom(tiles[0]) && (isVisible(grid.tile(x, y, 0)) || isVisible(grid.tile(x, y, 1))) &&
          !isSolid(x, y - tiles.length) && !isSolid(x - 1, y) && !isSolid(x + 1, y) && !isSolid(x, y + 1) &&
          !(valid(x, y + 1) && pit[idx(x, y + 1)])) {
        stacks.push({ x, cellY: y, topY: y - tiles.length + 1, tiles, elev: 0, star: true });
      } else if (!(below < h && (solid[bi] || pit[bi]))) {
        stacks.push({ x, cellY: Math.min(h - 1, below), topY: y - tiles.length + 1, tiles, elev: 1 });
      } else if (edgeFence(i) && solid[bi]) {
        // a fence along the top of a wall (the railing on a sea wall), drawn above the player: it stands on
        // its own cell (with nothing to hang over, it was left out)
        stacks.push({ x, cellY: y, topY: y - tiles.length + 1, tiles, elev: 0 });
      }
    }
  }
  // a piece drawn above the player beside a thing standing on the ground, whose drawing runs on into that
  // thing's at the same rows (a parasol's canopy, a tree's crown reaching past its trunk), is part of it:
  // it stands on the same foot row, clear under it (hanging a tile over the cell under it, it was lower
  // than the rest of the canopy and turned on its own)
  {
    const ground = stacks.filter(st => !st.elev && !st.onTable);
    const rowTile = (st, y) => (y >= st.topY && y <= st.cellY ? st.tiles[st.cellY - y] : 0);
    const meets = (o, x, t, y) => {
      const ot = rowTile(o, y);
      return !!ot && (o.x < x ? hConnected(ot, t) : hConnected(t, ot));
    };
    // (and on up through such pieces nobody took - over the wall behind too, the drawing going on)
    const extendUp = (st, by) => {
      for (let y = st.topY - 1; y >= 0; y--) {
        const j = idx(st.x, y), t = grid.tile(st.x, y, 2);
        if (taken(j) || objType[j] !== 3 || edgeFence(j) || pit[j] || !(meets(by, st.x, t, y) || connected(t, st.tiles[st.tiles.length - 1]))) break;
        st.tiles.push(t); stackConsumed[j] = 1; st.topY = y;
      }
    };
    for (let changed = true; changed;) {
      changed = false;
      for (const st of stacks) {
        if (st.elev !== 1 && !(opts.overlaps && st.star)) continue;    // (overlaps: a piece standing free beside it too)
        const bottom = st.topY + st.tiles.length - 1;
        const by = ground.find(o => Math.abs(o.x - st.x) === 1 && o.cellY > bottom && o.topY <= bottom &&
          st.tiles.some((t, r) => meets(o, st.x, t, bottom - r)));
        if (!by) continue;
        st.tiles = [...new Array(by.cellY - bottom).fill(0), ...st.tiles];
        st.cellY = by.cellY; st.elev = 0; st.joined = true;
        extendUp(st, by);
        ground.push(st);
        changed = true;
      }
      // its pieces drawn over the wall behind it, beside its own (left on the wall face, cut off it)
      for (const by of [...ground]) {
        for (const nx of [by.x - 1, by.x + 1]) {
          if (nx < 0 || nx >= w || ground.some(o => o.x === nx && o.cellY === by.cellY)) continue;
          for (let y = by.cellY; y >= by.topY; y--) {
            const j = idx(nx, y), t = grid.tile(nx, y, 2);
            if (taken(j) || objType[j] !== 3 || edgeFence(j) || !solid[j] || !meets(by, nx, t, y)) continue;
            const st = { x: nx, cellY: by.cellY, topY: y, tiles: [...new Array(by.cellY - y).fill(0), t], elev: 0, joined: true };
            stackConsumed[j] = 1;
            extendUp(st, by);
            stacks.push(st); ground.push(st);
            changed = true;
            break;
          }
        }
      }
    }
  }
  // a picture over a way between two walls - an arch, a gate's top with its raised portcullis, a door frame, a
  // lamp or a washing line across an alley: walls (not walkable in 2D) on both sides at all its rows and the way
  // under it walkable. It belongs to the facade it spans, so its rows stand as high as the walls' own rows beside
  // it, counted from the facade's foot row (where the walls end and the way goes on). As a free-standing picture
  // it stood on the floor (하얀 성시's gates: the raised portcullis lay on the ground under the arch) or hung a
  // tile up. Where its drawing runs on into the walls' (an arch's stones) or it spans a wider way, it stands in
  // the walls' front plane facing south like them (archFlat); a small thing (a lamp) still turns to the viewer.
  {
    const key = (x, st) => `${x},${st.cellY},${st.elev}`;
    const at = new Map(stacks.map(st => [key(st.x, st), st]));
    const bottomOf = st => st.topY + st.tiles.length - 1;
    const wall = (x, y) => valid(x, y) && isSolid(x, y) && !grid.anyPassable(x, y);
    const done = new Set();
    for (const st of stacks) {
      if (done.has(st) || st.onTable) continue;
      let a = st;
      while (at.has(key(a.x - 1, a))) a = at.get(key(a.x - 1, a));
      const run = [a];
      while (at.has(key(run[run.length - 1].x + 1, a))) run.push(at.get(key(run[run.length - 1].x + 1, a)));
      for (const s of run) done.add(s);
      const top = Math.min(...run.map(s => s.topY)), bottom = Math.max(...run.map(bottomOf));
      const xL = run[0].x - 1, xR = run[run.length - 1].x + 1;
      const way = y => run.every(s => grid.anyPassable(s.x, y) && !isSolid(s.x, y) && !pit[idx(s.x, y)]);
      let arch = true;
      for (let y = top; y <= bottom && arch; y++) arch = wall(xL, y) && wall(xR, y) && way(y);
      if (!arch) continue;
      let foot = bottom;
      while (wall(xL, foot + 1) && wall(xR, foot + 1) && way(foot + 1)) foot++;
      // within the walls' front faces (counted up from their foot); higher up it lies over their tops - a bridge
      // from one to the other, drawn from above (윈터벨's plank bridge over the lane)
      const faceH = Math.min(solidTop[idx(xL, foot)] - solidBase[idx(xL, foot)], solidTop[idx(xR, foot)] - solidBase[idx(xR, foot)]);
      if (foot - top + 1 > faceH + 1e-3) continue;
      const tileAt = (s, y) => (y >= s.topY && y <= bottomOf(s) ? s.tiles[bottomOf(s) - y] : 0);
      let joins = run.length >= 2;
      for (let y = top; y <= bottom && !joins; y++) {
        const tl = grid.tile(xL, y, 2), tr = grid.tile(xR, y, 2), t0 = tileAt(run[0], y), tn = tileAt(run[run.length - 1], y);
        joins = (!!tl && !!t0 && hConnected(tl, t0)) || (!!tr && !!tn && hConnected(tn, tr));
      }
      for (const s of run) {
        s.tiles = [...new Array(foot - bottomOf(s)).fill(0), ...s.tiles];
        s.cellY = foot; s.elev = 0; s.arch = true; s.archFlat = joins;
      }
    }
  }
  // one round thing drawn over many rows and columns (maphints.js whole: a carousel, a circus tent, a swing ride): all
  // of its columns stand on its lowest row, one thing - each column stood on its own foot row, so it came apart in slices
  // (a long one is then a fixed box with the picture on its four sides, as any long thing). What of its drawing lies on
  // walkable cells inside it (a tent's open door) goes with it - not what lies on the ground under its foot (its shadow)
  // ('all' after the rect: what is drawn on the wall above its foot row too - 병든 시계탑's gallows, its beam and nooses drawn over
  // the wall: one thing with its posts, not left on the wall's face a row lower; what lies on its foot row's low solids, a stage,
  // stays there)
  for (const [x0, y0, x1, y1, scope] of opts.whole || []) {
    const mine = stacks.filter(st => (!st.elev || (scope === 'all' && st.elev === 1)) && !st.onTable && st.x >= x0 && st.x <= x1 && st.cellY >= y0 && st.cellY <= y1);
    if (!mine.length) continue;
    const bottom = Math.max(...mine.map(st => st.cellY));
    const cols = new Map();                       // x -> (y -> tile)
    const put = (x, y, t) => { if (!cols.has(x)) cols.set(x, new Map()); cols.get(x).set(y, t); };
    // (each piece from its foot row - one hanging over the floor ('all') from the row it is drawn on, above its foot)
    for (const st of mine) {
      const base = st.elev ? st.topY + st.tiles.length - 1 : st.cellY;
      st.tiles.forEach((t, r) => { if (t) put(st.x, base - r, t); });
    }
    for (let y = y0; y <= bottom; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), t = grid.tile(x, y, 2);
      if (!isVisible(t) || taken(i) || pit[i] || (solid[i] && !(scope === 'all' && y < bottom))) continue;
      put(x, y, t); stackConsumed[i] = 1;
    }
    let top = h;
    for (const m of cols.values()) for (const y of m.keys()) top = Math.min(top, y);
    stacks = stacks.filter(st => !mine.includes(st));
    for (const [x, m] of [...cols].sort((a, b) => a[0] - b[0])) {
      const tiles = [];
      for (let y = bottom; y >= top; y--) tiles.push(m.get(y) || 0);
      while (!tiles[tiles.length - 1]) tiles.pop();
      stacks.push({ x, cellY: bottom, topY: bottom - tiles.length + 1, tiles, elev: 0, whole: true });
    }
  }
  // How an upright picture stands. What the map draws as one unbroken thing - pictures whose drawings run
  // into each other, like a railing or a wood of overlapping trees - is long when it reaches 5 tiles or
  // more across or down the map, and a long thing stands fixed as see-through boxes with the picture on all
  // four sides (clear where the drawing is clear, every side the right way round from outside). So does a
  // wide thing against a wall, which turning would cut into the wall. Anything else turns to face the
  // viewer as one picture, about its middle. A box is a run of columns whose drawings meet side by side (a
  // railing, a row of trees): its long sides show the pieces along them, its ends the piece at that end;
  // or the same piece over and over north-south (a railing drawn from above): one box running that way
  for (const st of stacks) {
    const { x, cellY } = st;
    // its foot and the rows of it behind that nobody can walk on, up to a wall: the next piece of a
    // north-south railing stands right behind that
    st.footY = cellY;
    if (!st.elev) {
      while (st.footY > st.topY && !isSolid(x, st.footY - 1) && !pit[idx(x, st.footY - 1)] && !grid.anyPassable(x, st.footY - 1)) st.footY--;
    }
    // against a wall or a building: it fills the rows up to it (with walkable floor between its foot and
    // the wall - a market stall whose awning reaches the building - it stands free)
    let gap = false;
    for (let yy = st.topY; yy < cellY; yy++) if (!isSolid(x, yy) && grid.anyPassable(x, yy)) gap = true;
    st.againstWall = !gap && (isSolid(x, st.topY - 1) || (isSolid(x, cellY - 1) && st.tiles.length > 1));
  }
  // furniture drawn from above (lying.js: beds, tables, coffins, bathtubs) lies as a low block with its
  // drawing on top. Where part of it is drawn over the wall behind (a bed's head on the wall's foot row),
  // the whole drawing lies on the floor cells in front, a little shorter
  const LYING_H = 0.45;                                  // tiles
  const lyingCols = [];
  const lyingAt = new Map();                            // floor cell -> its column
  // (listed furniture with things drawn above the player over it that are not part of it - blood spattered on the floor behind
  // a coffin (퀸・랜드 １－４), graffiti on the wall over a bed's head (크리미아 간호 묘지): the furniture lies, the rest is drawn
  // where it is, on the floor or the wall - it stood up with them, a bed on end)
  for (const st of stacks) {
    if (st.elev || st.whole || st.joined || st.arch || !lyingTile.has(st.tiles[0])) continue;
    let k = 1;
    while (k < st.tiles.length && lyingTile.has(st.tiles[k])) k++;
    if (k === st.tiles.length) continue;
    let tail = true;
    for (let j = k; j < st.tiles.length; j++) if (objType[idx(st.x, st.cellY - j)] !== 3 || lyingTile.has(st.tiles[j])) tail = false;
    if (!tail) continue;
    for (let j = k; j < st.tiles.length; j++) stackConsumed[idx(st.x, st.cellY - j)] = 0;
    st.tiles = st.tiles.slice(0, k);
    st.topY = st.cellY - k + 1;
  }
  const lyingStacks = stacks.filter(st => !st.elev && st.tiles.every(t => lyingTile.has(t)));
  // its foot in front of it, drawn walkable (the original lets one walk onto the end of a bed - or a table's legs, the stools
  // before a card table): part of it, when the furniture lists have it and its drawing goes on from the piece behind it (it lay
  // flat on the floor, the rest of the bed a block - 루트위지 시가지 상층's beds). Nobody steps into that cell now, as onto the
  // rest of the bed (lyingCells). (Taken before the heads: a bed right in front of another never takes that one's foot for its
  // head)
  const footOf = new Map();
  for (const st of lyingStacks) {
    const fy = st.cellY + 1, fi = idx(st.x, fy), ft = valid(st.x, fy) ? grid.tile(st.x, fy, 2) : 0;
    if (!valid(st.x, fy) || !isVisible(ft) || taken(fi) || solid[fi] || pit[fi] || objType[fi] !== 1 || !grid.anyPassable(st.x, fy)) continue;
    if (!lyingTile.has(ft) || !connected(st.tiles[0], ft)) continue;
    footOf.set(st, ft);
    stackConsumed[fi] = 1;
  }
  for (const st of lyingStacks) {
    st.lying = true;
    const pieces = st.tiles.slice();
    let top = st.topY;
    const hy = top - 1, ht = grid.tile(st.x, hy, 2);
    // (or lying on the floor behind it, walkable in 2D: the head of 퀸・랜드 ５'s bed lay flat on the floor, its foot a block)
    const headOn = hy >= 0 && (isSolid(st.x, hy) || (!taken(idx(st.x, hy)) && objType[idx(st.x, hy)] === 1));
    if (headOn && lyingTile.has(ht) && connected(ht, pieces[pieces.length - 1])) {
      pieces.push(ht);
      stackConsumed[idx(st.x, hy)] = 1;
      top = hy;
    }
    let y0 = st.cellY;
    while (y0 > top && !isSolid(st.x, y0 - 1)) y0--;
    let y1 = st.cellY;
    if (footOf.has(st)) { pieces.unshift(footOf.get(st)); y1++; }
    // the block starts and ends where the drawing does - a bed's foot drawn in the top part of its cell, a headboard in the
    // bottom part of its: the rest of those cells is floor, not the bed's top lying clear over it (start / end: the rows of
    // the head and front pieces drawn; startZ / endZ: where the block starts and ends, in tiles)
    const start = drawnSpan(pieces[pieces.length - 1])[0], end = drawnSpan(pieces[0])[1], dz = (y1 - y0 + 1) / pieces.length;
    const col = { st, x: st.x, pieces, y0, y1, foot: footOf.has(st), start, end, startZ: y0 + start / TS * dz, endZ: y1 + 1 - dz + end / TS * dz };
    lyingCols.push(col);
    for (let y = y0; y <= y1; y++) lyingAt.set(idx(st.x, y), col);
  }
  stacks = stacks.filter(st => !st.lying);
  const level = st => st.lv ?? (st.elev + (st.onTable ? solidTop[idx(st.x, st.cellY)] : floorE[idx(st.x, st.cellY)] || 0));
  // (maphints mounds: a thing standing on a bed's edge - its stem on the path, its cap over the bed, or the other way - is one
  // thing, at the level its stem stands on: not cut in two by the bed's edge)
  const sameLevel = (a, b) => level(a) === level(b) ||
    ((moundCell[idx(a.x, a.cellY)] || moundCell[idx(b.x, b.cellY)]) && Math.abs(level(a) - level(b)) <= moundH + 1e-3);
  const LONG = 5;
  // the cells of upright pictures that belong to something long
  const longCell = new Uint8Array(w * h);
  {
    const piece = new Map();
    for (const st of stacks) st.tiles.forEach((t, r) => piece.set(idx(st.x, st.topY + st.tiles.length - 1 - r), t));
    const up = [];
    const find = i => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
    for (const i of piece.keys()) up[i] = i;
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) up[a] = b; };
    for (const st of stacks) for (let r = 1; r < st.tiles.length; r++) join(idx(st.x, st.topY), idx(st.x, st.topY + r));
    for (const [i, t] of piece) {
      const x = i % w, y = (i / w) | 0;
      if (x + 1 < w && piece.has(i + 1) && hConnected(t, piece.get(i + 1))) join(i, i + 1);
      if (y + 1 < h && piece.has(i + w) && connected(t, piece.get(i + w))) join(i, i + w);
    }
    const ext = new Map();
    for (const i of piece.keys()) {
      const k = find(i), x = i % w, y = (i / w) | 0;
      const e = ext.get(k) || { x0: x, x1: x, y0: y, y1: y };
      e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y);
      ext.set(k, e);
    }
    for (const i of piece.keys()) {
      const e = ext.get(find(i));
      if (e.x1 - e.x0 + 1 >= LONG || e.y1 - e.y0 + 1 >= LONG) longCell[i] = 1;
    }
  }
  const boxes = [];
  {
    const key = (x, y, elev) => (x + y * w) * 2 + elev;
    const at = new Map(stacks.map(st => [key(st.x, st.cellY, st.elev), st]));
    const boxOf = new Map();
    for (const st of [...stacks].sort((a, b) => a.cellY - b.cellY || a.x - b.x)) {
      if (boxOf.has(st)) continue;
      const cols = [st];
      for (;;) {
        const a = cols[cols.length - 1], b = at.get(key(a.x + 1, a.cellY, a.elev));
        if (!b || boxOf.has(b) || !sameLevel(a, b) ||
          (!(a.whole && b.whole) && !a.tiles.some((t, r) => r < b.tiles.length && hConnected(t, b.tiles[r])))) break;
        cols.push(b);
      }
      const arch = cols.some(c => c.archFlat);
      const fixed = arch || cols.some(c => longCell[idx(c.x, c.topY)]) || (cols.length > 1 && cols.some(c => c.againstWall));
      // a map hint keeps some small pictures facing as in 2D (the croquet hoops)
      const flat = !fixed && !!flatTiles && cols.every(c => c.tiles.every(t => flatTiles.has(t)));
      // low and wide - 2 to 4 tiles across and wider than tall (a row of barrels, a bench, a low fence): turning
      // to the viewer it swung round like a board, so it stands still facing south, a little thick
      const slab = !fixed && !flat && cols.length >= 2 && cols.length <= 4 && cols.length > Math.max(...cols.map(c => c.tiles.length));
      const box = { cols, x0: st.x, n: cols.length, cy: st.cellY, fixed, flat, slab, arch };
      if (cols.some(c => level(c) !== level(cols[0]))) {
        const stems = cols.filter(c => c.tiles[0] && objType[idx(c.x, c.cellY)] === 2);
        const lv = Math.max(...(stems.length ? stems : cols).map(level));
        for (const c of cols) c.lv = lv;
      }
      for (const c of cols) boxOf.set(c, box);
      boxes.push(box);
    }
    // the same single piece again right behind (5 times or more, or in something long): one box running
    // north-south
    for (const box of [...boxes].sort((a, b) => b.cy - a.cy)) {
      if (box.n !== 1 || box.gone || box.line) continue;
      const line = [box.cols[0]];
      for (;;) {
        const a = line[line.length - 1], b = at.get(key(a.x, a.footY - 1, a.elev));
        const bb = b && boxOf.get(b);
        if (!bb || bb === box || bb.n !== 1 || bb.gone || bb.line || b.tiles[0] !== a.tiles[0] || level(b) !== level(a)) break;
        line.push(b);
      }
      if (line.length < 2 || (line.length < LONG && !line.every(st => boxOf.get(st).fixed))) continue;
      for (const st of line.slice(1)) boxOf.get(st).gone = true;
      box.line = line;
      box.fixed = true;
    }
    for (let k = boxes.length - 1; k >= 0; k--) if (boxes[k].gone) boxes.splice(k, 1);
  }
  // a free-standing picture whose foot is drawn with clear rows under it (a pew drawn high in its tile, a
  // teapot drawn up on a table) stands on its lowest drawn row - on the floor, or on the table's top - not
  // floating by those rows; against a wall the 2D height is kept
  {
    const gapCv = document.createElement('canvas');
    gapCv.width = gapCv.height = TS;
    const gapCtx = gapCv.getContext('2d', { willReadFrequently: true });
    const gaps = new Map();
    const bottomGap = t => {
      if (gaps.has(t)) return gaps.get(t);
      gapCtx.clearRect(0, 0, TS, TS);
      drawer.draw(gapCtx, t, 0, 0);
      const a = gapCtx.getImageData(0, 0, TS, TS).data;
      let g = 0;
      for (let y = TS - 1; y >= 0; y--) {
        let any = false;
        for (let x = 0; x < TS && !any; x++) if (a[(y * TS + x) * 4 + 3] > 40) any = true;
        if (any) break;
        g++;
      }
      gaps.set(t, g >= TS ? 0 : g);
      return gaps.get(t);
    };
    for (const box of boxes) {
      const pcs = box.line || box.cols;
      if (pcs.some(st => st.elev || st.arch || (st.againstWall && !st.onTable))) continue;
      const drop = Math.min(...pcs.filter(st => !st.whole || st.tiles[0]).map(st => bottomGap(st.tiles[0]))) / TS;   // (a whole one's columns with nothing on its foot row: higher up)
      for (const st of pcs) st.drop = drop;
    }
  }
  const standY = st => level(st) - (st.drop || 0);
  const footShadowAt = new Map();
  for (const box of boxes) for (const st of box.line || box.cols) {
    if (!st.elev && !st.onTable && hasShadow(st.tiles[0])) footShadowAt.set(idx(st.x, st.cellY), st.tiles[0]);
  }
  // (and lying furniture's: under its block, seen where the shadow was cut out of its drawing - between a bed's legs)
  for (const { x, pieces, y0, y1 } of lyingCols) {
    if (pieces.length !== y1 - y0 + 1) continue;
    pieces.forEach((t, r) => { if (shadowPx(t) && !footShadowAt.has(idx(x, y1 - r))) footShadowAt.set(idx(x, y1 - r), t); });
  }

  // An event drawn over an upright picture in 2D (an item glinting on an altar, a flame on a candlestick)
  // shows in front of it in 3D, at the height of that row of the drawing: on the side of a box that faces
  // open floor, or, for a picture turning to the viewer, just on the viewer's side of it. On a walkable
  // cell under a drawing (behind a tree) only what is drawn above characters does: the 2D view hides
  // anything else that stands there
  const onUpright = new Map();
  for (const box of boxes) {
    for (const st of box.line || box.cols) {
      const len = st.tiles.length;
      for (let r = 0; r < len; r++) {
        const yy = st.topY + len - 1 - r;
        if (valid(st.x, yy)) onUpright.set(idx(st.x, yy), { box, st, y: standY(st) + r, ground: !st.elev && r === 0, under: grid.anyPassable(st.x, yy) });
      }
    }
  }
  const openFloor = (x, y) => isFloor(x, y) && grid.anyPassable(x, y);
  function uprightSpot(x, y, lying, above) {
    // on a bed or a table: on top of it (past the end of its drawing - in the part of a bed's foot cell, or of its headboard's,
    // that is floor: on the floor beside it, as in 2D)
    const lie = valid(x, y) && lyingAt.get(idx(x, y));
    if (lie && !(y === lie.y1 && lie.endZ < y + 0.5) && !(y === lie.y0 && lie.startZ > y + 0.5)) return { x: x + 0.5, y: (floorE[idx(x, y)] || 0) + LYING_H, z: y + 0.5, side: 'top', ground: false };
    const o = valid(x, y) && onUpright.get(idx(x, y));
    if (!o || (o.under && !above)) return null;
    const { box, st } = o;
    const hy = lying ? level(st) - st.elev : o.y, ground = lying || o.ground;
    // (in front of a low wide picture standing still, as for the south side of a box)
    if (box.slab) return { x: x + 0.5, y: hy, z: box.cy + 0.5, side: 'S', ground, free: true };
    if (!box.fixed) return { about: [box.x0 + box.n / 2, box.cy + 0.5], y: hy, ground };
    const at = (side, sx, sz) => ({ x: sx, y: hy, z: sz, side, ground, free: true });
    if (box.line) {
      const s0 = box.line[0], sN = box.line[box.line.length - 1];
      if (openFloor(x + 1, y)) return at('E', x + 1, y + 0.5);
      if (openFloor(x - 1, y)) return at('W', x, y + 0.5);
      if (st === s0 && openFloor(x, s0.cellY + 1)) return at('S', x + 0.5, s0.cellY + 1);
      if (st === sN && openFloor(x, sN.footY - 1)) return at('N', x + 0.5, sN.footY);
    } else {
      const { x0, n, cy } = box;
      if (openFloor(x, cy + 1)) return at('S', x + 0.5, cy + 1);
      if (openFloor(x0 + n, cy)) return at('E', x0 + n, cy + 0.5);
      if (openFloor(x0 - 1, cy)) return at('W', x0, cy + 0.5);
      if (y === cy && openFloor(x, cy - 1)) return at('N', x + 0.5, cy);
    }
    return { x: x + 0.5, y: standY(st) + st.tiles.length, z: (box.line ? y : box.cy) + 0.5, side: 'top', ground: false };
  }
  // drawn over a wall right above something standing or lying in front of it, whose drawing runs on up
  // the wall (a ladder leant on it, a bed with its head drawn on the wall): standing on top of that thing
  const topAt = new Map(stacks.filter(st => !st.elev).map(st => [idx(st.x, st.topY), st]));
  function onTopOf(x, y) {
    if (!valid(x, y + 1)) return null;
    const t2 = grid.tile(x, y, 2);
    if (!isVisible(t2)) return null;
    const below = idx(x, y + 1);
    const col = lyingAt.get(below);
    if (col) return col.pieces.includes(t2) || connected(t2, col.pieces[col.pieces.length - 1]) ? { x: x + 0.5, y: (floorE[below] || 0) + LYING_H, z: y + 1.5, side: 'top', ground: false } : null;
    const st = topAt.get(below);
    if (!st || !connected(t2, st.tiles[st.tiles.length - 1])) return null;
    return { x: x + 0.5, y: standY(st) + st.tiles.length, z: st.cellY + 0.5, side: 'top', ground: false };
  }

  const invisibleCells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (solid[i] || empty[i] || pit[i] || slope[i] || stackConsumed[i] || grid.anyPassable(x, y)) continue;
    if (isWaterTop(x, y) || grid.isTableTop(x, y)) continue;
    invisibleCells.push(i);
  }

  Object.assign(M, { LYING_H, boxes, doorBelow, doorways, footShadowAt, hConnected, invisibleCells, lyingAt, lyingCols,
      onTopOf, onUpright, stackConsumed, stacks, standY, taken, uprightSpot });
}
