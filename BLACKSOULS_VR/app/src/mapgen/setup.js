// Building a map, its first stage: the tileset's images, the tile painter, and the helpers every later stage reads the
// map through - which tiles' drawings meet, the event pieces built as map tiles, cell indexing, the tile kinds.
import { loadImage } from '../assets.js';
import { TILE, TS, TileDrawer, isA1, isVisible } from '../tiles.js';
import { Atlas, loadTilesetImages } from './common.js';

export async function prepareBuild(M) {
  const { opts } = M;
  let { grid } = M;
  const images = await loadTilesetImages(grid.tileset);
  const parWallImg = opts.parallaxWalls && grid.map.parallax_name ? await loadImage('Graphics/Parallaxes', grid.map.parallax_name) : null;
  const drawer = new TileDrawer(images, grid.flags);
  const { w, h } = grid;
  // whether the drawing of one tile goes on into the one under it (their touching edges both drawn)
  const scratch = document.createElement('canvas');
  scratch.width = TS; scratch.height = TS * 2;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const connCache = new Map();
  function connected(upperId, lowerId) {
    const key = upperId + ':' + lowerId;
    if (connCache.has(key)) return connCache.get(key);
    sctx.clearRect(0, 0, TS, TS * 2);
    drawer.draw(sctx, upperId, 0, 0);
    drawer.draw(sctx, lowerId, 0, TS);
    const a = sctx.getImageData(0, TS - 1, TS, 2).data;
    let both = 0, any = 0;
    for (let i = 0; i < TS; i++) {
      const au = a[i * 4 + 3] > 100, al = a[(TS + i) * 4 + 3] > 100;
      if (au && al) both++;
      if (au || al) any++;
    }
    const res = both >= 6 && both >= any * 0.45;
    connCache.set(key, res);
    return res;
  }
  // an event's tile picture that is the rest of a thing the map draws above it (opts.eventPieces - mapbuild.js: 동화 창고's
  // bookshelves, their tops map tiles, their bottoms events; 퀸・랜드 １'s notice board on its legs): built as the map's own
  // upper-layer piece there - blocking, as the event stands there as characters do - so the thing stands whole, its drawing
  // joined as the 2D draws it (the event's own picture is left out: sprites.js)
  const pieceAt = new Map();
  for (const [i, p] of opts.eventPieces || []) {
    const x = i % w, y = (i / w) | 0;
    if (grid.valid(x, y - 1) && grid.tile(x, y - 1, 2) > 0 && connected(grid.tile(x, y - 1, 2), p.tile)) pieceAt.set(i, p);
  }
  if (pieceAt.size) {
    const under = grid;
    grid = Object.assign(Object.create(under), {
      tile: (x, y, z) => (z === 2 && under.valid(x, y) && pieceAt.has(x + y * w) ? pieceAt.get(x + y * w).tile : under.tile(x, y, z)),
      passage: (x, y, bit, extra) => !(under.valid(x, y) && pieceAt.has(x + y * w)) && under.passage(x, y, bit, extra),
    });
  }
  const flatTiles = opts.flatPictures ? new Set(opts.flatPictures) : null;   // maphints: pictures kept facing south
  // maphints terraces: a terraced town's stairs drawn as floor tiles (their edge pieces too)
  const sideStairTiles = new Set((opts.terraces?.sideStairs || []).map(n => TILE.A5 + n));
  const stairTiles = opts.terraces ? new Set([...opts.terraces.stairs.map(n => TILE.A5 + n), ...sideStairTiles]) : null;
  const onStairTile = (x, y) => !!stairTiles && (stairTiles.has(grid.tile(x, y, 0)) || stairTiles.has(grid.tile(x, y, 1)));

  const staticAtlas = new Atlas(1);
  // a piece of a room's background picture (maphints parallaxWalls), as a tile: [cx, cy] its corner in the picture's pixels, ch
  // how many of its rows (stretched to a tile)
  const parCrop = parWallImg ? (cx, cy, ch = TS) => {
    const i = staticAtlas.request(`PW${cx},${cy.toFixed(2)},${ch.toFixed(2)}`, (ctx, ax, ay) => ctx.drawImage(parWallImg, cx, cy, TS, ch, ax, ay, TS, TS));
    return { atlas: staticAtlas, i };
  } : null;
  const animAtlas = new Atlas(3);
  const anyA1 = ids => ids.some(id => isA1(id));
  const atlasFor = ids => (anyA1(ids) ? animAtlas : staticAtlas);

  // composite request: list of tile ids drawn in order (+ optional shadow bits)
  // opaque: walls get a dark backing, so art with see-through pixels never leaves holes in a wall
  function requestComposite(ids, shadowBits = 0, opaque = false) {
    const vis = ids.filter(isVisible);
    if (!vis.length && !shadowBits) return null;
    const key = (opaque ? 'O' : '') + vis.join(',') + '|' + shadowBits;
    const atlas = atlasFor(vis);
    const i = atlas.request(key, (ctx, x, y, f) => {
      if (opaque) { ctx.fillStyle = 'rgb(24,22,27)'; ctx.fillRect(x, y, TS, TS); }
      for (const id of vis) drawer.draw(ctx, id, x, y, f);
      if (shadowBits) drawer.drawShadow(ctx, shadowBits, x, y);
    });
    return { atlas, i };
  }
  // floor composite draws shadow between lower layers and upper decal (and the shadow drawn under a thing
  // standing on the cell: its foot tile's shadow pixels)
  function requestFloor(t0, t1, t2, shadowBits, footShadow = 0) {
    const lower = [t0, t1].filter(isVisible);
    const upper = isVisible(t2) ? [t2] : [];
    if (!lower.length && !upper.length) return null;
    const key = 'F' + lower.join(',') + '|' + shadowBits + '|' + upper.join(',') + (footShadow ? '|S' + footShadow : '');
    const atlas = atlasFor(lower.concat(upper));
    const i = atlas.request(key, (ctx, x, y, f) => {
      for (const id of lower) drawer.draw(ctx, id, x, y, f);
      if (shadowBits) drawer.drawShadow(ctx, shadowBits, x, y);
      if (footShadow) ctx.drawImage(shadowPart(footShadow, true), x, y);
      for (const id of upper) drawer.draw(ctx, id, x, y, f);
    });
    return { atlas, i };
  }
  // a shadow drawn on the ground in a tile (RTP style: black, half clear - under a parasol, a tree, a post):
  // with keep, only those pixels; without, the tile without them. Upright, the half-clear black stood up
  // as a solid black board under the thing
  const shadowParts = new Map();
  const isShadowPx = (a, k) => a[k + 3] >= 24 && a[k + 3] <= 200 && a[k] + a[k + 1] + a[k + 2] <= 120;
  function shadowPart(t, keep) {
    const key = t + (keep ? 'k' : 'd');
    if (shadowParts.has(key)) return shadowParts.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const cx = c.getContext('2d', { willReadFrequently: true });
    drawer.draw(cx, t, 0, 0);
    const im = cx.getImageData(0, 0, TS, TS), a = im.data;
    // (on the floor the shadow goes on under the thing's foot: what the foot covers within the shadow's
    // span in each row is shadow too, not a light print of the foot)
    const under = new Uint8Array(TS * TS);
    if (keep) {
      for (let y = 0; y < TS; y++) {
        let x0 = TS, x1 = -1;
        for (let x = 0; x < TS; x++) if (isShadowPx(a, (y * TS + x) * 4)) { x0 = Math.min(x0, x); x1 = x; }
        for (let x = x0 + 1; x < x1; x++) if (a[(y * TS + x) * 4 + 3] > 0 && !isShadowPx(a, (y * TS + x) * 4)) under[y * TS + x] = 1;
      }
    }
    for (let k = 0; k < a.length; k += 4) {
      if (under[k >> 2]) { a[k] = a[k + 1] = a[k + 2] = 0; a[k + 3] = 128; } else if (isShadowPx(a, k) !== keep) a[k + 3] = 0;
    }
    cx.putImageData(im, 0, 0);
    shadowParts.set(key, c);
    return c;
  }
  const shadowCount = new Map();
  const shadowPx = t => {
    if (!isVisible(t) || t >= 1024) return 0;              // B-E tiles only
    if (!shadowCount.has(t)) {
      const c = document.createElement('canvas');
      c.width = c.height = TS;
      const cx = c.getContext('2d', { willReadFrequently: true });
      drawer.draw(cx, t, 0, 0);
      const a = cx.getImageData(0, 0, TS, TS).data;
      let n = 0;
      for (let k = 0; k < a.length; k += 4) if (isShadowPx(a, k)) n++;
      shadowCount.set(t, n);
    }
    return shadowCount.get(t);
  };
  const hasShadow = t => shadowPx(t) >= 48;
  // a tile without the shadow drawn on the ground round what it shows
  function requestBare(t) {
    const i = staticAtlas.request('U' + t, (ctx, x, y) => ctx.drawImage(shadowPart(t, false), x, y));
    return { atlas: staticAtlas, i };
  }
  // an upright picture's tile; its foot on the ground leaves the shadow drawn there to the floor
  function requestUpright(st, tid, r) {
    if (r !== 0 || st.elev || st.onTable || !hasShadow(tid)) return requestComposite([tid]);
    return requestBare(tid);
  }
  // the rows of a tile with something drawn on them (a drawn shadow not counted): [first, after the last]; [0, TS] if none
  const drawnSpanOf = new Map();
  const drawnSpan = t => {
    if (!drawnSpanOf.has(t)) {
      const c = document.createElement('canvas');
      c.width = c.height = TS;
      const cx = c.getContext('2d', { willReadFrequently: true });
      drawer.draw(cx, t, 0, 0);
      const a = cx.getImageData(0, 0, TS, TS).data;
      let first = -1, n = 0;
      for (let k = 0; k < a.length; k += 4) {
        if (a[k + 3] <= 40 || isShadowPx(a, k)) continue;
        const row = (k >> 2) / TS | 0;
        if (first < 0) first = row;
        n = row + 1;
      }
      drawnSpanOf.set(t, first < 0 ? [0, TS] : [first, n]);
    }
    return drawnSpanOf.get(t);
  };
  // the face of lying furniture whose front piece ends part way down its cell: the drawing's last rows - of that piece, and of
  // the piece behind it when the front one is short - moved down to the bottom of the tile, the drawn shadow left out
  function requestFootFace(foot, behind, end) {
    const i = staticAtlas.request('LF' + foot + ',' + behind + ',' + end, (ctx, x, y) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, TS, TS); ctx.clip();
      if (behind) ctx.drawImage(shadowPart(behind, false), x, y - end);
      ctx.drawImage(shadowPart(foot, false), x, y + TS - end);
      ctx.restore();
    });
    return { atlas: staticAtlas, i };
  }
  // plain dark stone tile (used where no wall art exists at all)
  function requestColor(r, g, b) {
    const key = `C${r},${g},${b}`;
    const i = staticAtlas.request(key, (ctx, x, y) => {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, TS, TS);
      let seed = r * 31 + g * 17 + b;
      for (let k = 0; k < 90; k++) {
        seed = (seed * 9301 + 49297) % 233280;
        const px = seed % TS; seed = (seed * 9301 + 49297) % 233280;
        const py = seed % TS;
        const d = (seed % 3) - 1;
        ctx.fillStyle = `rgba(${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},0.07)`;
        ctx.fillRect(x + px, y + py, 2, 2);
      }
    });
    return { atlas: staticAtlas, i };
  }

  // a tile's average colour (opaque pixels), brightness and how much of it is drawn
  const tileAvgs = new Map();
  const tileAvg = id => {
    if (tileAvgs.has(id)) return tileAvgs.get(id);
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    drawer.draw(ctx, id, 0, 0, 0);
    const d = ctx.getImageData(0, 0, TS, TS).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 128) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
    const avg = n ? { rgb: [r / n, g / n, b / n], lum: (0.299 * r + 0.587 * g + 0.114 * b) / n, cover: n / (TS * TS) } : { rgb: [72, 64, 56], lum: 64, cover: 0 };
    tileAvgs.set(id, avg);
    return avg;
  };

  const idx = (x, y) => x + y * w;
  const valid = (x, y) => grid.valid(x, y);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const pits = opts.pits || new Set();          // fall zones / jump gaps: rendered as holes
  const gaps = opts.gaps || new Set();          // (the jump gaps among them)

  Object.assign(M, { N4, animAtlas, connected, drawer, drawnSpan, flatTiles, gaps, grid, h, hasShadow, idx, onStairTile,
      parCrop, parWallImg, pieceAt, pits, requestBare, requestColor, requestComposite, requestFloor, requestFootFace,
      requestUpright, shadowPx, sideStairTiles, staticAtlas, tileAvg, valid, w });
}
