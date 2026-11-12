// Building a map, its sixth stage: the geometry - the floor's quads (and its slopes), the faces of every solid with the
// 2D art run up them (walls bottom-up, masses, cliffs, doorway lintels), the standees, lying things, parallax walls,
// all into the accumulators (GeoBuf) of the atlases' materials, the textures asked for from the atlases.
import * as THREE from 'three';
import { PLAYER_BLOCK_REGIONS } from '../mapanalysis.js';
import { DIR_BIT, F, TILE, TS, isVisible, isWater } from '../tiles.js';
import { SLAB_THICKNESS } from '../weapons.js';
import { DIRS, GeoBuf, T } from './common.js';

export function buildGeometry(M) {
  const { LYING_H, OPEN_LEVEL, SOLID_MASS, SOLID_RAIL, SOLID_VOID, SOLID_WALL, abyss, abyssLo, animAtlas, anyAbyss,
      boxes, clear, cliffFace, cliffU, doorBelow, doorways, edgeE, empty, faceArt, faceUp, flatCell, floorE,
      footShadowAt, gapTop, grid, h, hangArt, hangMode, hangTop, hg, highG, idx, isFloorIdx, isSide, isSolid,
      isWallCell, lyingAt, lyingCols, moundCell, nearKind, objType, openVoid, opts, parCrop, parWallImg, pit, pitE,
      reach, requestBare, requestColor, requestComposite, requestFloor, requestFootFace, requestUpright, rimCell, shaft,
      sideBox, sideRowH, slope, solid, solidBase, solidTop, stackConsumed, standY, stripOf, surfN, surfS, taken,
      tileAvg, valid, w, wallKind } = M;
  // ---- geometry -------------------------------------------------------------------------
  const bufs = {
    static: new GeoBuf(), anim: new GeoBuf(),
    bbStatic: new GeoBuf(true), bbAnim: new GeoBuf(true),
    obj: new GeoBuf(), objAnim: new GeoBuf(),          // free-standing pictures: lit alike from both sides
  };
  const pending = []; // geometry ops executed after atlases are built (need uv)
  const bufFor = (atlas, bb) => (atlas === animAtlas ? (bb ? bufs.bbAnim : bufs.anim) : (bb ? bufs.bbStatic : bufs.static));
  const addQuad = (req, corners, shade, normal) => {
    if (!req) return;
    pending.push(() => bufFor(req.atlas, false).quad(corners, req.atlas.uv(req.i), shade, normal));
  };
  const addObjQuad = (req, corners, shade, normal) => {
    if (!req) return;
    pending.push(() => (req.atlas === animAtlas ? bufs.objAnim : bufs.obj).quad(corners, req.atlas.uv(req.i), shade, normal));
  };
  const darkStone = () => requestColor(26, 24, 28);
  // (a parallax that is not open water / sky lies just under the floor - water is not sunk below it)
  const parUnderFloor = !!grid.map.parallax_name && !openVoid;
  const genericWall = (kind, shape) => TILE.A1 + kind * 48 + shape;

  // (a painted cliff's top, maphints highGround: the plateau's ground; the edge drawn along the plateau over the face - snow
  // hanging over it - is at the face's front, where the plateau ends, not a face's height back on the plateau)
  const lipMoved = new Set();
  const faceTop = new Map();
  if (hg) for (let i = 0; i < w * h; i++) {
    if (!cliffFace[i]) continue;
    const u = faceUp[i], ux = u % w, uy = (u / w) | 0, x = i % w, y = (i / w) | 0;
    const front = !valid(x, y + 1) || !cliffFace[idx(x, y + 1)];
    const lip = front && objType[u] && objType[u] !== 3 ? grid.tile(ux, uy, 2) : 0;
    if (lip) lipMoved.add(u);
    faceTop.set(i, requestFloor(grid.tile(ux, uy, 0), grid.tile(ux, uy, 1), lip, 0, 0));
  }
  // floor (with corner ambient occlusion next to solid cells); cliff rows are slopes
  // (a painted cliff's face is flush with the plateau over it - maphints highGround: it shades the ground at its foot only)
  const ao = (x, y, e) => (isSolid(x, y) && !(cliffFace[idx(x, y)] && solidTop[idx(x, y)] <= e + 0.05) ? 1 : 0);
  const floorReq = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (!isFloorIdx(i)) continue;
    const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1), t2 = grid.tile(x, y, 2);
    const decal = objType[i] && (!taken(i) || (flatCell[i] && !stackConsumed[i])) && !lipMoved.has(i) ? t2 : 0;
    let req = requestFloor(t0, t1, decal, grid.shadow(x, y), footShadowAt.get(i) || 0);
    // (a room drawn on its background picture: a floor raised by hand - a stage - is that picture where it lies, not see-through
    // down to the picture under the room)
    if (!req && parCrop && Math.abs(surfN(i)) + Math.abs(surfS(i)) > 0.01) req = parCrop(x * TS, y * TS);
    floorReq[i] = req;
    if (!req || clear[i]) continue;                    // (open sky: a clear tile is air)
    // (water: the ground itself is water nobody walks in - not a thing standing on ground drawn with an A1 tile, 포자의 숲's: it
    // sank a little round each plant there, a black seam round its cell)
    const water = isWater(t0) && !grid.anyPassable(x, y) && (grid.flag(t0) & 0xf) === 0xf;
    const off = water && !parUnderFloor ? -0.06 : 0;
    const c = (cx, cy) => {
      const e = Math.max(surfN(i), surfS(i));
      const n = ao(cx - 1, cy - 1, e) + ao(cx, cy - 1, e) + ao(cx - 1, cy, e) + ao(cx, cy, e);
      return n === 0 ? 1 : n === 1 ? 0.7 : 0.55;
    };
    const shade = [c(x, y), c(x, y + 1), c(x + 1, y + 1), c(x + 1, y)];
    const yn = (surfN(i) + off) * T, ys = (surfS(i) + off) * T;
    const x0 = x * T, x1 = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
    addQuad(req, [[x0, yn, z0], [x0, ys, z1], [x1, ys, z1], [x1, yn, z0]], shade, [0, 1, 0]);
  }

  // rails: an edge RPG Maker lets nobody cross between two walkable floors at one level (a fence or a
  // rail drawn along the tile's edge, lying flat on the floor here), or the edge of ground only the
  // player may not enter (region 50), stands up as a thin rail in the colour of what blocks it, so the
  // stop is not an invisible wall
  const RAIL = 0.6;                                     // tiles
  const blockerTile = (x, y, bit) => {
    for (const id of grid.layered(x, y)) {
      const f = grid.flag(id);
      if (f & F.STAR) continue;
      if ((f & bit) === 0) return 0;
      if ((f & bit) === bit) return id;
    }
    return 0;
  };
  const tileColor = id => tileAvg(id).rgb.map(v => Math.min(248, Math.round(v / 8) * 8));   // (few distinct colours)
  const walkFloor = i => isFloorIdx(i) && !slope[i] && grid.anyPassable(i % w, (i / w) | 0);
  let railCount = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = idx(x, y);
    if (!walkFloor(a)) continue;
    for (const d of [6, 2]) {
      const nx = x + (d === 6 ? 1 : 0), ny = y + (d === 2 ? 1 : 0);
      if (!valid(nx, ny)) continue;
      const b = idx(nx, ny);
      if (!walkFloor(b) || (reach && !reach[a] && !reach[b])) continue;
      const fenced = PLAYER_BLOCK_REGIONS.includes(grid.region(x, y)) !== PLAYER_BLOCK_REGIONS.includes(grid.region(nx, ny));
      if (!fenced && grid.passable(x, y, d) && grid.passable(nx, ny, 10 - d)) continue;
      let id = blockerTile(x, y, DIR_BIT[d]), at = a;
      if (!id) { id = blockerTile(nx, ny, DIR_BIT[10 - d]); at = b; }
      if (!id && fenced) {
        // the ground the player is kept off
        at = PLAYER_BLOCK_REGIONS.includes(grid.region(x, y)) ? a : b;
        const ax = at % w, ay = (at / w) | 0, t1 = grid.tile(ax, ay, 1);
        id = isVisible(t1) ? t1 : grid.tile(ax, ay, 0);
      }
      if (!id || (id === grid.tile(at % w, (at / w) | 0, 2) && taken(at))) continue;   // (drawn upright already)
      const req = requestColor(...tileColor(id));
      const sh = [1, 0.7, 0.7, 1];
      if (d === 6) {
        if (Math.abs(surfN(a) - surfN(b)) > 0.3 || Math.abs(surfS(a) - surfS(b)) > 0.3) continue;
        const hN = Math.max(surfN(a), surfN(b)) * T, hS = Math.max(surfS(a), surfS(b)) * T, r = RAIL * T;
        const X = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
        addQuad(req, [[X, hS + r, z1], [X, hS, z1], [X, hN, z0], [X, hN + r, z0]], sh, [1, 0, 0]);
        addQuad(req, [[X, hN + r, z0], [X, hN, z0], [X, hS, z1], [X, hS + r, z1]], sh, [-1, 0, 0]);
      } else {
        if (Math.abs(surfS(a) - surfN(b)) > 0.3) continue;
        const hh = Math.max(surfS(a), surfN(b)) * T, r = RAIL * T;
        const Z = (y + 1) * T, x0 = x * T, x1 = (x + 1) * T;
        addQuad(req, [[x0, hh + r, Z], [x0, hh, Z], [x1, hh, Z], [x1, hh + r, Z]], sh, [0, 0, 1]);
        addQuad(req, [[x1, hh + r, Z], [x1, hh, Z], [x0, hh, Z], [x0, hh + r, Z]], sh, [0, 0, -1]);
      }
      railCount++;
    }
  }

  // tile ids shown on a solid cell's face at a given art row (row 0 = at the solid's base)
  const ownArt = (x, y) => {
    const t2 = grid.tile(x, y, 2);
    const ids = [grid.tile(x, y, 0), grid.tile(x, y, 1)];
    if (isVisible(t2) && !stackConsumed[idx(x, y)]) ids.push(t2);
    return ids;
  };
  const pairedWall = (i, shape) => (nearKind[i] >= 0 ? [genericWall(nearKind[i], shape)] : null);
  function faceIds(x, y, dname, row, borderShape) {
    const i = idx(x, y);
    if (solid[i] === SOLID_VOID) return pairedWall(i, borderShape);
    if (solid[i] === SOLID_RAIL && row < 0) return null;     // under a bridge edge: plain dark posts
    if (solid[i] === SOLID_MASS) {
      const strip = stripOf[i];
      const facadeSide = dname === 'S' || ((dname === 'E' || dname === 'W') && strip.hasFacade);
      if (!facadeSide && nearKind[i] >= 0) return pairedWall(i, borderShape);
      if (row < 0) return pairedWall(i, borderShape) || ownArt(x, y);
      const cell = strip[Math.min(row, strip.length - 1)];
      if (cell.ext) return [grid.tile(cell.x, cell.y, 2)];
      // (maphints massBackdrop: things piled up drawn over the floor - the library's heaps of books - show against the
      // nearest wall's art on their faces, not the floor carpet standing up between them)
      if (opts.massBackdrop) {
        const t2 = grid.tile(cell.x, cell.y, 2), bg = pairedWall(i, borderShape);
        if (bg && isVisible(t2) && !stackConsumed[idx(cell.x, cell.y)]) return [...bg, t2];
      }
      return ownArt(cell.x, cell.y);
    }
    if (dname === 'S' && row >= 0) {
      const sy = y - row;
      if (sy >= 0 && isSide[idx(x, sy)] && isWallCell(x, sy)) return ownArt(x, sy);
    }
    const kind = wallKind[i];
    if (kind < 0) return ownArt(x, y);
    return [genericWall(kind, borderShape)];
  }
  const SHADE = { S: 0.96, N: 0.56, E: 0.74, W: 0.74 };
  const NORMAL = { S: [0, 0, 1], N: [0, 0, -1], E: [1, 0, 0], W: [-1, 0, 0] };
  const OPP = { S: 'N', N: 'S', E: 'W', W: 'E' };
  function faceCorners(dname, x, y, y0, y1) {
    const x0 = x * T, x1 = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
    if (dname === 'S') return [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]];
    if (dname === 'N') return [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]];
    if (dname === 'E') return [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]];
    return [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]];
  }
  // walls a room drawn on its background picture stands in (maphints.js parallaxWalls: the tiles there draw nothing - 퀸・랜드
  // ２－１, the circus tent's inside): their faces show the picture's own wall - its top row at the wall's top, the rest of
  // it drawn down to the floor (stretched to the wall's height), along the wall as it goes
  // (parallaxWalls: [x, y, w, h] for every wall, or { back, front, backdrop }: front for the faces turned north - the room's
  // south wall, the one with the way in - back for the rest; backdrop [yTop, yFloor]: the faces turned south - the room's back
  // wall - show the picture itself where they stand, its column over them from yTop down to yFloor, so what is painted in front
  // of that wall - ２－１'s great teddy bear - stays where it was drawn. A ledge lower than a tile and a half - a stage's
  // front - keeps its own art)
  const parWall = parWallImg ? (() => {
    const spec = opts.parallaxWalls, crop = parCrop;
    const rects = Array.isArray(spec) ? { back: spec, front: spec } : spec;
    return (dname, x, y, fromTop, rows) => {
      if (dname === 'S' && rects.backdrop) {
        const [yTop, yFloor] = rects.backdrop, part = (yFloor - yTop) / Math.max(1, rows);
        return crop(x * TS, yTop + Math.max(0, fromTop) * part, part);
      }
      const [sx, sy, sw, sh] = dname === 'N' ? (rects.front || rects.back) : rects.back;
      const across = Math.max(1, Math.floor(sw / TS)), u = dname === 'N' || dname === 'S' ? x : y;
      const cx = sx + (((u % across) + across) % across) * TS;
      const part = rows > 1 ? (sh - TS) / (rows - 1) : sh - TS;
      return fromTop <= 0 ? crop(cx, sy, TS) : crop(cx, sy + TS + (fromTop - 1) * part, part);
    };
  })() : null;
  // a vertical face of cell (x,y) on side dname from elevation lo to hi (tiles); ref = art origin
  function emitFace(x, y, dname, lo, hi, ref, leftOpen, rightOpen, door) {
    if (hi - lo < 0.02) return;
    const first = Math.floor(lo - ref + 1e-3), last = Math.ceil(hi - ref - 1e-3) - 1;
    const onPicture = parWall && solid[idx(x, y)] === SOLID_WALL && hi - lo >= 1.5;
    for (let r = first; r <= last; r++) {
      const a = Math.max(lo, ref + r), b = Math.min(hi, ref + r + 1);
      if (b - a < 0.02) continue;
      if (door && r >= Math.ceil(door.open - 1e-3)) continue;       // above the opening: the lintel covers it
      let shape = 0;
      if (r === last) shape |= 2;
      if (r === first) shape |= 8;
      if (leftOpen) shape |= 1;
      if (rightOpen) shape |= 4;
      const ids = onPicture ? null : faceIds(x, y, dname, r, shape);
      const req = onPicture ? parWall(dname, x, y, last - r, last - first + 1) : ids ? (requestComposite(ids, 0, true) || darkStone()) : darkStone();
      const s = SHADE[dname];
      const topS = r === last ? Math.min(1.12, s * 1.12) : s;
      const botS = r === first ? s * 0.62 : s;
      // art rows are 1 tile tall; partial rows sample the matching part of the tile
      const v0 = (a - (ref + r)), v1 = (b - (ref + r));
      const cr = faceCorners(dname, x, y, a * T, b * T);
      if (!req) continue;
      pending.push(() => {
        const [u0, vt, u1, vb] = req.atlas.uv(req.i);
        const vv1 = vb + (vt - vb) * v1, vv0 = vb + (vt - vb) * v0;
        bufFor(req.atlas, false).quad(cr, [u0, vv1, u1, vv0], [topS, botS, botS, topS], NORMAL[dname]);
      });
    }
  }

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (!solid[i] || pit[i]) continue;
    const top = solidTop[i], ref = solidBase[i];
    for (const dname of ['S', 'N', 'E', 'W']) {
      const [dx, dy] = DIRS[dname];
      const nx = x + dx, ny = y + dy;
      if (!valid(nx, ny)) continue;
      const n = idx(nx, ny);
      if (empty[n] && !openVoid && !abyss[n]) continue;
      let lo;
      if (empty[n]) lo = abyss[n] ? abyssLo[n] : OPEN_LEVEL;
      else if (pit[n]) lo = pitE[n];
      else if (solid[n]) lo = solidTop[n];
      else lo = clear[n] ? OPEN_LEVEL : edgeE(n, OPP[dname]);
      if (lo >= top - 0.02) continue;
      const leftOf = { S: [-1, 0], N: [1, 0], E: [0, 1], W: [0, -1] }[dname];
      const faceAt = (cx, cy) => isSolid(cx, cy) && valid(cx + dx, cy + dy) && !isSolid(cx + dx, cy + dy);
      const leftOpen = !faceAt(x + leftOf[0], y + leftOf[1]);
      const rightOpen = !faceAt(x - leftOf[0], y - leftOf[1]);
      const door = dname === 'S' ? doorBelow.get(i) : null;
      emitFace(x, y, dname, lo, top, ref, leftOpen, rightOpen, door);
    }
    // top surface (cliff walls: the upper floor's ground)
    // (a low edge in a room drawn on its background picture - a stage's front: that picture on its top)
    const topReq = parCrop && solid[i] === SOLID_WALL && top - ref < 1.5 ? parCrop(x * TS, y * TS)
      : faceTop.has(i) ? faceTop.get(i)
      : cliffU[i] >= 0 && floorReq[cliffU[i]] && !rimCell[i] ? floorReq[cliffU[i]]
      : solid[i] === SOLID_VOID ? (pairedWall(i, 0) ? requestComposite(pairedWall(i, 0), 0, true) : darkStone()) : (requestComposite(ownArt(x, y), 0, true) || darkStone());
    if (topReq) {
      const yt = top * T, x0 = x * T, x1 = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
      const ts = faceTop.has(i) ? 1 : 0.8;         // (a painted cliff's top: as bright as the plateau it is part of)
      addQuad(topReq, [[x0, yt, z0], [x0, yt, z1], [x1, yt, z1], [x1, yt, z0]], [ts, ts, ts, ts], [0, 1, 0]);
    }
  }
  // step faces between neighbouring surfaces at different heights: cliff-slope sides, pit walls,
  // raised floors meeting lower ones
  const surfaceCell = i => !empty[i] && (pit[i] || !solid[i]);
  const stepTexture = (hiCell, loCell) => {
    if (moundCell[hiCell] && !pit[loCell]) return floorReq[hiCell] || darkStone();     // (a mound's edge: its own ground)
    const pw = pairedWall(pit[loCell] ? loCell : hiCell, 0);
    if (pw) return requestComposite(pw, 0, true);
    return floorReq[hiCell] || darkStone();
  };
  // side views: the drops are tall, so their faces are built a tile at a time (no stretched texture);
  // the face under a ledge shows the drawing's rows below it (the tower's wall: clocks, frames...)
  const inSide = (x, y) => !!sideBox && x >= sideBox[0] && x <= sideBox[2] && y >= sideBox[1] && y <= sideBox[3];
  // (open sky: every drop, and the air of a clear tile, is open down to the same depth)
  const dropCell = (x, y) => valid(x, y) && ((!!sideRowH && !!pit[idx(x, y)] && inSide(x, y)) || (!!shaft && !!shaft[idx(x, y)]) ||
    (!!opts.openSky && (!!pit[idx(x, y)] || !!clear[idx(x, y)])));
  const sideShade = (hgt, max, bottom) => max * (0.15 + 0.85 * THREE.MathUtils.clamp((hgt - bottom) / 8, 0, 1));
  function sideStepY(x, y, aHigher, hi, lo, hiCell, loCell) {
    const z = (y + 1) * T, x0 = x * T, x1 = (x + 1) * T;
    for (let k = 0; hi - k > lo + 0.02; k++) {
      const t = hi - k, bt = Math.max(lo, hi - k - 1);
      const ry = y + 1 + k;
      const art = aHigher && dropCell(x, ry) ? ownArt(x, ry) : null;
      const req = art ? (requestComposite(art, 0, true) || darkStone()) : stepTexture(hiCell, loCell);
      const m = art ? 0.95 : 0.6, st = sideShade(t, m, lo), sb = sideShade(bt, m, lo);
      const corners = aHigher
        ? [[x0, t * T, z], [x0, bt * T, z], [x1, bt * T, z], [x1, t * T, z]]
        : [[x1, t * T, z], [x1, bt * T, z], [x0, bt * T, z], [x0, t * T, z]];
      addQuad(req, corners, [st, sb, sb, st], aHigher ? [0, 0, 1] : [0, 0, -1]);
    }
  }
  function sideStepX(x, y, aHigher, hiN, hiS, loN, loS, hiCell, loCell) {
    const xe = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
    const req = stepTexture(hiCell, loCell);
    for (let k = 0; hiN - k > loN + 0.02 || hiS - k > loS + 0.02; k++) {
      const tN = Math.max(loN, hiN - k), tS = Math.max(loS, hiS - k);
      const bN = Math.max(loN, hiN - k - 1), bS = Math.max(loS, hiS - k - 1);
      if (tN - bN < 0.01 && tS - bS < 0.01) continue;
      const bottom = Math.min(loN, loS);
      const sN = sideShade(tN, 0.6, bottom), sS = sideShade(tS, 0.6, bottom), sbN = sideShade(bN, 0.6, bottom), sbS = sideShade(bS, 0.6, bottom);
      const corners = aHigher
        ? [[xe, tS * T, z1], [xe, bS * T, z1], [xe, bN * T, z0], [xe, tN * T, z0]]
        : [[xe, tN * T, z0], [xe, bN * T, z0], [xe, bS * T, z1], [xe, tS * T, z1]];
      addQuad(req, corners, aHigher ? [sS, sbS, sbN, sN] : [sN, sbN, sbS, sS], aHigher ? [1, 0, 0] : [-1, 0, 0]);
    }
  }
  // (painted cliffs, maphints highGround: a plateau's side over lower ground is the cliff's rock, a tile at a time from the foot
  // up as the map draws its faces - where the map draws none, the plateau's edge seen from the side)
  const cliffSide = (hiCell, loCell, lo, hi, cornersAt, normal, s) => {
    if (!faceArt || !highG[hiCell] || highG[loCell] || pit[loCell]) return false;
    const gx = hiCell % w, gy = (hiCell / w) | 0;
    for (let r = 0; lo + r < hi - 0.02; r++) {
      const a0 = lo + r, b0 = Math.min(hi, lo + r + 1), v1 = b0 - a0;
      const req = requestComposite([grid.tile(gx, gy, 0), grid.tile(gx, gy, 1), faceArt[Math.min(r, faceArt.length - 1)]], 0, true);
      if (!req) continue;
      const bot = r === 0 ? s * 0.62 : s;
      const cr = cornersAt(a0 * T, b0 * T);
      pending.push(() => {
        const [u0, vt, u1, vb] = req.atlas.uv(req.i);
        bufFor(req.atlas, false).quad(cr, [u0, vb + (vt - vb) * v1, u1, vb], [s, bot, bot, s], normal);
      });
    }
    return true;
  };
  // (as drawn: a clear tile under the open sky is air, down at the drops' depth)
  const drawN = i => (clear[i] ? OPEN_LEVEL : surfN(i)), drawS = i => (clear[i] ? OPEN_LEVEL : surfS(i));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = idx(x, y);
    if (!surfaceCell(a)) continue;
    if (valid(x, y + 1)) {
      const b = idx(x, y + 1);
      if (surfaceCell(b)) {
        const ha = drawS(a), hb = drawN(b);
        if (Math.abs(ha - hb) > 0.02 && (dropCell(x, y) || dropCell(x, y + 1))) {
          const aHigher = ha > hb;
          sideStepY(x, y, aHigher, Math.max(ha, hb), Math.min(ha, hb), aHigher ? a : b, aHigher ? b : a);
        } else if (Math.abs(ha - hb) > 0.02) {
          const top = Math.max(ha, hb) * T, bot = Math.min(ha, hb) * T;
          const aHigher = ha > hb;
          const hiCell = aHigher ? a : b, loCell = aHigher ? b : a;
          const z = (y + 1) * T, x0 = x * T, x1 = (x + 1) * T;
          const corners = aHigher
            ? [[x0, top, z], [x0, bot, z], [x1, bot, z], [x1, top, z]]
            : [[x1, top, z], [x1, bot, z], [x0, bot, z], [x0, top, z]];
          const shade = pit[loCell] ? [0.55, 0.05, 0.05, 0.55] : [0.8, 0.5, 0.5, 0.8];
          const along = (p, q) => (aHigher ? [[x0, q, z], [x0, p, z], [x1, p, z], [x1, q, z]] : [[x1, q, z], [x1, p, z], [x0, p, z], [x0, q, z]]);
          if (!cliffSide(hiCell, loCell, Math.min(ha, hb), Math.max(ha, hb), along, aHigher ? [0, 0, 1] : [0, 0, -1], aHigher ? SHADE.S : SHADE.N)) {
            addQuad(stepTexture(hiCell, loCell), corners, shade, aHigher ? [0, 0, 1] : [0, 0, -1]);
          }
        }
      }
    }
    if (valid(x + 1, y)) {
      const b = idx(x + 1, y);
      if (surfaceCell(b)) {
        const aN = drawN(a), aS = drawS(a), bN = drawN(b), bS = drawS(b);
        if ((Math.abs(aN - bN) > 0.02 || Math.abs(aS - bS) > 0.02) && (dropCell(x, y) || dropCell(x + 1, y))) {
          const aHigher = aN + aS > bN + bS;
          sideStepX(x, y, aHigher, aHigher ? aN : bN, aHigher ? aS : bS, aHigher ? bN : aN, aHigher ? bS : aS, aHigher ? a : b, aHigher ? b : a);
        } else if (Math.abs(aN - bN) > 0.02 || Math.abs(aS - bS) > 0.02) {
          const aHigher = aN + aS > bN + bS;
          const hiN = (aHigher ? aN : bN) * T, hiS = (aHigher ? aS : bS) * T;
          const loN = (aHigher ? bN : aN) * T, loS = (aHigher ? bS : aS) * T;
          const hiCell = aHigher ? a : b, loCell = aHigher ? b : a;
          const xe = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
          const corners = aHigher
            ? [[xe, hiS, z1], [xe, loS, z1], [xe, loN, z0], [xe, hiN, z0]]
            : [[xe, hiN, z0], [xe, loN, z0], [xe, loS, z1], [xe, hiS, z1]];
          const shade = pit[loCell] ? [0.5, 0.05, 0.05, 0.5] : [0.7, 0.45, 0.45, 0.7];
          const flat = Math.abs(hiN - hiS) < 0.01 && Math.abs(loN - loS) < 0.01;
          const along = (p, q) => (aHigher ? [[xe, q, z1], [xe, p, z1], [xe, p, z0], [xe, q, z0]] : [[xe, q, z0], [xe, p, z0], [xe, p, z1], [xe, q, z1]]);
          if (!flat || !cliffSide(hiCell, loCell, loN / T, hiN / T, along, aHigher ? [1, 0, 0] : [-1, 0, 0], SHADE.E)) {
            addQuad(stepTexture(hiCell, loCell), corners, shade, aHigher ? [1, 0, 0] : [-1, 0, 0]);
          }
        }
      }
    }
  }

  if (openVoid) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = idx(x, y);
      if (!surfaceCell(a) || pit[a] || clear[a]) continue;
      for (const dname of ['S', 'N', 'E', 'W']) {
        const [dx, dy] = DIRS[dname];
        if (!valid(x + dx, y + dy) || !empty[idx(x + dx, y + dy)] || abyss[idx(x + dx, y + dy)]) continue;
        const hiE = dname === 'N' ? surfN(a) : dname === 'S' ? surfS(a) : Math.min(surfN(a), surfS(a));
        if (hiE <= OPEN_LEVEL) continue;
        const req = floorReq[a] || darkStone();
        const cr = faceCorners(dname, x, y, OPEN_LEVEL * T, hiE * T);
        addQuad(req, cr, [0.45, 0.25, 0.25, 0.45], NORMAL[dname]);
      }
    }
  }
  // the drop beside a walkway (abyss): the floor's edge goes down into the dark a tile at a time, fading - under a
  // floor whose foundation the map draws below it, that drawing's rows (hangArt) - and a small curb runs along the
  // edge on the floor's side, where the original draws its raised rim (홍성 프릿셀 7's bridge under the swinging axes)
  if (anyAbyss) {
    const CURB_H = 0.15, CURB_T = 0.1;                  // tiles
    // (a chasm drawn from the side - abyss 'hang': a top's foundation, a row of its drawing a tile, down every side of the top as
    // deep as it is drawn - the side the 2D shows (south) all of it, the others the rock alone, not what is drawn in front of
    // it - and open under that; under a top with nothing drawn below it, only a thin edge. No curb: the original draws none)
    const hangFaces = (a, x, y, dname, hiE) => {
      let ys = y;
      while (valid(x, ys + 1) && isFloorIdx(idx(x, ys + 1))) ys++;
      const top = idx(x, ys);
      let n = 0;
      while (valid(x, ys + 1 + n) && hangArt[idx(x, ys + 1 + n)] && hangTop[idx(x, ys + 1 + n)] === top) n++;
      const front = dname === 'S' && ys === y, lo = hiE - Math.max(n, 0.35);
      if (!n) {
        const st = sideShade(hiE, 0.6, lo - 2);
        addQuad(stepTexture(a, a), faceCorners(dname, x, y, lo * T, hiE * T), [st, st, st, st], NORMAL[dname]);
        return;
      }
      for (let k = 0; k < n; k++) {
        const ry = ys + 1 + k, t = hiE - k, b = t - 1;
        const art = front ? ownArt(x, ry) : [grid.tile(x, ry, 0), grid.tile(x, ry, 1)];
        const req = requestComposite(art, 0, true) || darkStone();
        const st = sideShade(t, 0.95, lo), sb = sideShade(b, 0.95, lo);
        addQuad(req, faceCorners(dname, x, y, b * T, t * T), [st, sb, sb, st], NORMAL[dname]);
      }
    };
    for (let i = 0; i < w * h; i++) {
      if (gapTop[i] < 0) continue;
      // (drawn across a gap in front of the foundations either side: on their front, at its row's depth below their top)
      const x = i % w, y = (i / w) | 0, ty = (gapTop[i] / w) | 0, t = surfS(gapTop[i]) - (y - ty - 1), b = t - 1;
      const req = requestComposite(ownArt(x, y));
      if (!req) continue;
      const st = sideShade(t, 0.95, t - 8), sb = sideShade(b, 0.95, t - 8);
      addQuad(req, faceCorners('S', x, ty, b * T, t * T), [st, sb, sb, st], NORMAL.S);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = idx(x, y);
      if (!surfaceCell(a) || pit[a]) continue;
      for (const dname of ['S', 'N', 'E', 'W']) {
        const [dx, dy] = DIRS[dname];
        if (!valid(x + dx, y + dy) || !abyss[idx(x + dx, y + dy)]) continue;
        const n = idx(x + dx, y + dy), lo = abyssLo[n];
        const hiE = dname === 'N' ? surfN(a) : dname === 'S' ? surfS(a) : Math.min(surfN(a), surfS(a));
        if (hangMode[n]) { hangFaces(a, x, y, dname, hiE); continue; }
        for (let k = 0; hiE - k > lo + 0.02; k++) {
          const t = hiE - k, b = Math.max(lo, t - 1), ry = y + 1 + k;
          const art = dname === 'S' && valid(x, ry) && hangArt[idx(x, ry)] ? ownArt(x, ry) : null;
          const req = art ? (requestComposite(art, 0, true) || darkStone()) : stepTexture(a, n);
          const m = art ? 0.95 : 0.6, st = sideShade(t, m, lo), sb = sideShade(b, m, lo);
          addQuad(req, faceCorners(dname, x, y, b * T, t * T), [st, sb, sb, st], NORMAL[dname]);
        }
        // the curb, in a lighter shade of the walkway's own colour (its outer side flush with the face below)
        if (!grid.anyPassable(x, y)) continue;
        const top = [2, 1, 0].map(z => grid.tile(x, y, z)).find(isVisible);
        const req = top ? requestColor(...tileColor(top).map(v => Math.min(248, Math.round(v * 1.15 / 8) * 8))) : darkStone();
        const hb = hiE * T, ht = (hiE + CURB_H) * T, ct = CURB_T * T;
        let x0 = x * T, x1 = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
        if (dname === 'W') x1 = x0 + ct; else if (dname === 'E') x0 = x1 - ct; else if (dname === 'N') z1 = z0 + ct; else z0 = z1 - ct;
        addQuad(req, [[x0, ht, z0], [x0, ht, z1], [x1, ht, z1], [x1, ht, z0]], [1, 1, 1, 1], [0, 1, 0]);
        addQuad(req, [[x0, ht, z1], [x0, hb, z1], [x1, hb, z1], [x1, ht, z1]], [0.8, 0.8, 0.8, 0.8], [0, 0, 1]);
        addQuad(req, [[x1, ht, z0], [x1, hb, z0], [x0, hb, z0], [x0, ht, z0]], [0.8, 0.8, 0.8, 0.8], [0, 0, -1]);
        addQuad(req, [[x1, ht, z1], [x1, hb, z1], [x1, hb, z0], [x1, ht, z0]], [0.72, 0.72, 0.72, 0.72], [1, 0, 0]);
        addQuad(req, [[x0, ht, z0], [x0, hb, z0], [x0, hb, z1], [x0, ht, z1]], [0.72, 0.72, 0.72, 0.72], [-1, 0, 0]);
      }
    }
  }

  // doorway lintels: facade rows continue over the opening (from its top up), flush with the neighbours
  for (const d of doorways) {
    const { x, y, base, top, open } = d;
    for (let row = 1; base + row < top - 0.02; row++) {
      if (row + 1 <= open + 1e-3) continue;          // this whole row is inside the opening
      const cy = y - row;
      let ids;
      if (isSolid(x, cy)) {
        const j = idx(x, cy);
        ids = solid[j] === SOLID_MASS || isSide[j] ? ownArt(x, cy) : solid[j] === SOLID_VOID ? pairedWall(j, 0) : [genericWall(wallKind[j], 0)];
      } else ids = d.shaft ? (valid(x, cy) ? ownArt(x, cy) : null) : ownArt(x, y - 1);   // side view: the drawing's own rows, like the wall beside it
      const req = ids ? (requestComposite(ids, 0, true) || darkStone()) : darkStone();
      const y0 = (base + Math.max(row, open)) * T, y1 = Math.min(top, base + row + 1) * T;
      const s = SHADE.S;
      addQuad(req, faceCorners('S', x, y, y0, y1), [s, s, s, s], NORMAL.S);
    }
    const under = requestComposite(ownArt(x, y - 1)) || darkStone();
    const yy = (base + open) * T, x0 = x * T, x1 = (x + 1) * T, z0 = y * T, z1 = (y + 1) * T;
    addQuad(under, [[x0, yy, z0], [x1, yy, z0], [x1, yy, z1], [x0, yy, z1]], [0.3, 0.3, 0.3, 0.3], [0, -1, 0]);
    // a door drawn as a tile: on the front face, in the opening (seen from outside only, so walking in through
    // it shows the doorway, not its back)
    if (d.art) {
      const art = requestComposite([d.art]);
      const s = SHADE.S;
      if (art) addObjQuad(art, faceCorners('S', x, y, base * T, (base + 1) * T), [s, s, s, s], NORMAL.S);
    }
  }

  // upright pictures. A box side is a run of pieces, each [stack, from, to] along it, from the viewer's
  // left to right as fractions of its length. Its sides are set in a hair from the cell edges, so one
  // against a wall never flickers with the wall's face (and, seen only from outside, never shows there)
  const BOX_SHADE = [0.95, 0.85, 0.85, 0.95];
  const HAIR = 0.01 * T;
  const boxSide = (pieces, corner, normal) => {
    for (const [st, f0, f1] of pieces) {
      const e = standY(st);
      st.tiles.forEach((tid, r) => {
        const req = requestUpright(st, tid, r);
        if (!req) return;
        const y0 = (e + r) * T, y1 = (e + r + 1) * T;
        const a = corner(f0), b = corner(f1);
        addObjQuad(req, [[a[0], y1, a[1]], [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]]], BOX_SHADE, normal);
      });
    }
  };
  const slabPieces = [];                      // { tid, x, y, z }: tiles of low wide pictures standing still
  for (const box of boxes) {
    if (box.slab) {
      // facing south as in 2D across the middle of its cells, a little thick: its drawing in front and (mirrored)
      // behind, the edges of its pixels between them as small blocks (built below)
      const { cols, x0, cy } = box;
      const zc = (cy + 0.5) * T, t = SLAB_THICKNESS / 2 * T / TS;
      cols.forEach((st, c) => {
        const e = standY(st), xa = (x0 + c) * T, xb = xa + T;
        st.tiles.forEach((tid, r) => {
          const req = requestUpright(st, tid, r);
          if (!req) return;
          const y0 = (e + r) * T, y1 = (e + r + 1) * T;
          addObjQuad(req, [[xa, y1, zc + t], [xa, y0, zc + t], [xb, y0, zc + t], [xb, y1, zc + t]], BOX_SHADE, [0, 0, 1]);
          addObjQuad(req, [[xb, y1, zc - t], [xb, y0, zc - t], [xa, y0, zc - t], [xa, y1, zc - t]], BOX_SHADE, [0, 0, -1]);
          slabPieces.push({ tid, x: xa + T / 2, y: y0, z: zc });
        });
      });
      continue;
    }
    if (box.arch) {
      // in the walls' front plane, facing south; from the north the same drawing the right way round (the first
      // column at the east end)
      const { cols, x0, n, cy } = box;
      const z = (cy + 1) * T - HAIR;
      cols.forEach((st, c) => {
        const e = standY(st), xa = (x0 + c) * T, xb = xa + T, ma = (x0 + n - 1 - c) * T, mb = ma + T;
        st.tiles.forEach((tid, r) => {
          const req = requestUpright(st, tid, r);
          if (!req) return;
          const y0 = (e + r) * T, y1 = (e + r + 1) * T;
          addObjQuad(req, [[xa, y1, z], [xa, y0, z], [xb, y0, z], [xb, y1, z]], BOX_SHADE, [0, 0, 1]);
          addObjQuad(req, [[mb, y1, z], [mb, y0, z], [ma, y0, z], [ma, y1, z]], BOX_SHADE, [0, 0, -1]);
        });
      });
      continue;
    }
    if (box.flat) {
      // facing south as in 2D, across the middle of its cells, seen from both sides (the back one mirrored)
      const { cols, x0, n, cy } = box;
      const zc = (cy + 0.5) * T;
      cols.forEach((st, c) => {
        const e = standY(st), xa = (x0 + c) * T, xb = xa + T;
        st.tiles.forEach((tid, r) => {
          const req = requestUpright(st, tid, r);
          if (!req) return;
          const y0 = (e + r) * T, y1 = (e + r + 1) * T;
          addObjQuad(req, [[xa, y1, zc], [xa, y0, zc], [xb, y0, zc], [xb, y1, zc]], BOX_SHADE, [0, 0, 1]);
          addObjQuad(req, [[xb, y1, zc], [xb, y0, zc], [xa, y0, zc], [xa, y1, zc]], BOX_SHADE, [0, 0, -1]);
        });
      });
      continue;
    }
    if (!box.fixed) {
      // turning to face the viewer as one picture, about the middle of its foot
      const { cols, x0, n, cy } = box;
      const cx = (x0 + n / 2) * T, cz = (cy + 0.5) * T;
      cols.forEach((st, c) => {
        const e = standY(st), xa = (c - n / 2) * T, xb = xa + T;
        st.tiles.forEach((tid, r) => {
          const req = requestUpright(st, tid, r);
          if (!req) return;
          const y0 = (e + r) * T, y1 = (e + r + 1) * T;
          pending.push(() => bufFor(req.atlas, true).quad(
            [[xa, y1, 0], [xa, y0, 0], [xb, y0, 0], [xb, y1, 0]], req.atlas.uv(req.i), [1, 0.9, 0.9, 1], [0, 0, 1], [cx, 0, cz]));
        });
      });
      continue;
    }
    if (box.line) {
      // north-south: the long sides are east and west, the south and north ends show the end pieces
      const pcs = box.line, s0 = pcs[0], sN = pcs[pcs.length - 1], x = s0.x;
      const xW = x * T + HAIR, xE = (x + 1) * T - HAIR, zS = (s0.cellY + 1) * T - HAIR, zN = sN.footY * T + HAIR;
      boxSide([[s0, 0, 1]], f => [xW + f * (xE - xW), zS], [0, 0, 1]);
      boxSide([[sN, 0, 1]], f => [xE - f * (xE - xW), zN], [0, 0, -1]);
      for (const st of pcs) {
        for (let y = st.footY; y <= st.cellY; y++) {
          const z0 = Math.max(zN, y * T), z1 = Math.min(zS, (y + 1) * T);
          boxSide([[st, 0, 1]], f => [xE, z1 - f * (z1 - z0)], [1, 0, 0]);
          boxSide([[st, 0, 1]], f => [xW, z0 + f * (z1 - z0)], [-1, 0, 0]);
        }
      }
      continue;
    }
    // east-west, over its foot row: the south side; the north side read from the north (the first column
    // at the east end); the ends, the piece at that end
    const { cols, x0, n, cy } = box;
    const xW = x0 * T + HAIR, xE = (x0 + n) * T - HAIR, zN = cy * T + HAIR, zS = (cy + 1) * T - HAIR;
    cols.forEach((st, c) => {
      const xa = c === 0 ? xW : (x0 + c) * T, xb = c === n - 1 ? xE : (x0 + c + 1) * T;
      const ma = n - 1 - c === 0 ? xW : (x0 + n - 1 - c) * T, mb = c === 0 ? xE : (x0 + n - c) * T;
      boxSide([[st, 0, 1]], f => [xa + f * (xb - xa), zS], [0, 0, 1]);
      boxSide([[st, 0, 1]], f => [mb - f * (mb - ma), zN], [0, 0, -1]);
    });
    boxSide([[cols[n - 1], 0, 1]], f => [xE, zS - f * (zS - zN)], [1, 0, 0]);
    boxSide([[cols[0], 0, 1]], f => [xW, zN + f * (zS - zN)], [-1, 0, 0]);
  }

  // lying furniture: the drawing on top of a low block, its pieces north to south as in 2D over the floor
  // cells it covers; the sides show the bottom of the piece at that edge (a bed's foot, a table's apron),
  // clear where it is clear
  const lyingFace = (req, cr, s, normal) => pending.push(() => {
    const [u0, vt, u1, vb] = req.atlas.uv(req.i);
    (req.atlas === animAtlas ? bufs.objAnim : bufs.obj).quad(cr, [u0, vb + (vt - vb) * LYING_H, u1, vb], [s, s * 0.7, s * 0.7, s], normal);
  });
  const openBeside = (x, y) => !lyingAt.has(idx(x, y)) && !isSolid(x, y);
  for (const { x, pieces, y0, y1, start, end } of lyingCols) {
    const e = floorE[idx(x, y1)] || 0, yb = e * T, yt = (e + LYING_H) * T;
    const x0 = x * T, x1 = (x + 1) * T, zS = (y1 + 1) * T, dz = (y1 - y0 + 1) * T / pieces.length;
    // (drawn without the shadow drawn round it - on the block's top it was a solid black strip -, starting and ending where its
    // drawing does: the face at a front cut short shows the drawing's last rows)
    const cut = (TS - end) / TS * dz, lead = start / TS * dz, last = pieces.length - 1;
    pieces.forEach((t, r) => {
      const req = requestBare(t);
      const zb = zS - r * dz - (r === 0 ? cut : 0), za = zS - (r + 1) * dz + (r === last ? lead : 0), mid = Math.floor((za + zb) / 2 / T);
      const face = r === 0 && cut ? requestFootFace(t, pieces[1] || 0, end) : req;
      const vFrom = r === last ? start / TS : 0, vTo = r === 0 ? end / TS : 1;
      const top = [[x0, yt, za], [x0, yt, zb], [x1, yt, zb], [x1, yt, za]];
      pending.push(() => {
        const [u0, vt, u1, vb] = req.atlas.uv(req.i);
        bufs.obj.quad(top, [u0, vt + (vb - vt) * vFrom, u1, vt + (vb - vt) * vTo], [0.95, 0.95, 0.95, 0.95], [0, 1, 0]);
      });
      if (r === 0 && (cut || openBeside(x, y1 + 1))) lyingFace(face, [[x0, yt, zb], [x0, yb, zb], [x1, yb, zb], [x1, yt, zb]], SHADE.S * 0.9, NORMAL.S);
      if (r === last && (lead || openBeside(x, y0 - 1))) lyingFace(req, [[x1, yt, za], [x1, yb, za], [x0, yb, za], [x0, yt, za]], SHADE.N * 0.9, NORMAL.N);
      if (openBeside(x + 1, mid)) lyingFace(face, [[x1, yt, zb], [x1, yb, zb], [x1, yb, za], [x1, yt, za]], SHADE.E * 0.9, NORMAL.E);
      if (openBeside(x - 1, mid)) lyingFace(face, [[x0, yt, za], [x0, yb, za], [x0, yb, zb], [x0, yt, zb]], SHADE.W * 0.9, NORMAL.W);
    });
  }

  Object.assign(M, { bufs, pending, railCount, slabPieces });
}
