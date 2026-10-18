// Converts an RPG Maker VX Ace tile map into 3D geometry.
//  - A3/A4 wall-type tiles (impassable)  -> solid blocks; the south face reuses the 2D wall art
//  - other large impassable areas         -> solid "mass" blocks (buildings, cliffs, void) whose
//                                            faces show the 2D art bottom-up
//  - ground tiles + passable decorations -> textured floor
//  - small impassable / star B-E tiles   -> upright pictures: long ones fixed see-through boxes with the
//                                            picture on all four sides, low wide ones (2-4 across) standing
//                                            still with some thickness, the rest turning to the viewer
import * as THREE from 'three';
import {
  TileDrawer, TS, F, DIR_BIT, TILE, isWallType, isWallSide, isWallTop, isRoof, isA1, isA2,
  isVisible, autotileKind, isWater,
} from './tiles.js';
import { loadImage, pixelTexture } from '../data/assets.js';
import { PLAYER_BLOCK_REGIONS } from './mapanalysis.js';
import { isLyingTile } from '../entities/lying.js';
import { furnitureFloor, furnitureGeometry, isUprightFurnitureTile } from '../entities/furniture.js';
import { voxelGeometryOf, SLAB_THICKNESS } from '../combat/weapons.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = 1.5; // meters per tile

// ---------------------------------------------------------------------------
// Map grid: tile data + passability (VX Ace rules)
// ---------------------------------------------------------------------------
// A2 table autotiles a tileset left without the counter flag - drawn as a table seen from above like the flagged
// ones, but the 3D view took them for a building: kinds per A2 sheet. 끝나지 않는 다과회's long tea table
// (VXTileA2 #23; the other table kinds of that sheet, 7 / 15 / 31, carry the flag). Only the 3D view reads this
// (isTableTop): talking across a counter keeps to the flag, as in the original
const UNFLAGGED_TABLES = { VXTileA2: [23] };

export class MapGrid {
  constructor(map, tileset) {
    this.map = map;
    this.tileset = tileset;
    this.w = map.width;
    this.h = map.height;
    this.data = map.data.data;
    this.flags = tileset.flags.data;
  }
  valid(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tile(x, y, z) {
    if (!this.valid(x, y)) return 0;
    return this.data[x + y * this.w + z * this.w * this.h] & 0xffff;
  }
  region(x, y) { return this.tile(x, y, 3) >> 8; }
  shadow(x, y) { return this.tile(x, y, 3) & 0x0f; }
  flag(id) { return id >= 0 && id < 8192 ? this.flags[id] & 0xffff : 0; }
  layered(x, y) { return [this.tile(x, y, 2), this.tile(x, y, 1), this.tile(x, y, 0)]; }

  // Game_Map#check_passage (extra: the tiles of events that count as map tiles there, checked first)
  passage(x, y, bit, extra = null) {
    if (!this.valid(x, y)) return false;
    for (const id of extra ? extra.concat(this.layered(x, y)) : this.layered(x, y)) {
      const f = this.flag(id);
      if (f & F.STAR) continue;
      if ((f & bit) === 0) return true;
      if ((f & bit) === bit) return false;
    }
    return false;
  }
  passable(x, y, d, extra = null) { return this.passage(x, y, DIR_BIT[d], extra); }
  anyPassable(x, y) { return this.passable(x, y, 2) || this.passable(x, y, 4) || this.passable(x, y, 6) || this.passable(x, y, 8); }
  checkFlag(x, y, bit) {
    for (const id of this.layered(x, y)) if (this.flag(id) & bit) return true;
    return false;
  }
  isLadder(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.LADDER); }
  isBush(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.BUSH); }
  isCounter(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.COUNTER); }
  // the counter flag only on ground one walks on (a floor the map lets one talk across - 공작 부인의 저택 ６ BOSS's kitchen, 무한음식 ３,
  // 퀸・랜드 ７'s garden): no table there - what blocks the cell is a thing standing on that floor
  counterOnFloorOnly(x, y) {
    if (!this.valid(x, y)) return false;
    const ids = this.layered(x, y).filter(id => id && (this.flag(id) & F.COUNTER));
    return ids.length > 0 && ids.every(id => id >= TILE.A1 && (this.flag(id) & 0xf) === 0);
  }
  // a table or counter for the 3D view: the counter flag, or a table autotile left unflagged (UNFLAGGED_TABLES)
  isTableTop(x, y) {
    if (this.isCounter(x, y)) return true;
    const kinds = UNFLAGGED_TABLES[this.tileset?.tileset_names?.[1]];
    if (!kinds || !this.valid(x, y)) return false;
    for (const z of [0, 1]) {
      const t = this.tile(x, y, z);
      if (t >= 2816 && t < 4352 && kinds.includes(((t - 2816) / 48) | 0)) return true;
    }
    return false;
  }
  isDamage(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.DAMAGE); }
  terrainTag(x, y) {
    if (!this.valid(x, y)) return 0;
    for (const id of this.layered(x, y)) { const t = this.flag(id) >> 12; if (t > 0) return t; }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Texture atlas of composited 32x32 tiles (with extruded padding for mipmaps)
// ---------------------------------------------------------------------------
const PAD = 8;
const SLOT = TS + PAD * 2;

class Atlas {
  constructor(frames = 1) {
    this.frames = frames;
    this.index = new Map();
    this.draws = [];
  }
  request(key, drawFn) {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.draws.length;
      this.index.set(key, i);
      this.draws.push(drawFn);
    }
    return i;
  }
  build() {
    const n = Math.max(1, this.draws.length);
    this.cols = Math.ceil(Math.sqrt(n));
    this.rows = Math.ceil(n / this.cols);
    this.regionW = this.cols * SLOT;
    const c = document.createElement('canvas');
    c.width = this.regionW * this.frames;
    c.height = this.rows * SLOT;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // each tile is drawn and its edges extruded into the padding on a small canvas, then copied in once
    // (copying a big canvas onto itself is slow, and the atlas of a large map is big)
    const slot = document.createElement('canvas');
    slot.width = SLOT; slot.height = SLOT;
    const sctx = slot.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    for (let f = 0; f < this.frames; f++) {
      this.draws.forEach((fn, i) => {
        sctx.clearRect(0, 0, SLOT, SLOT);
        fn(sctx, PAD, PAD, f);
        sctx.drawImage(slot, PAD, PAD, 1, TS, 0, PAD, PAD, TS);
        sctx.drawImage(slot, PAD + TS - 1, PAD, 1, TS, PAD + TS, PAD, PAD, TS);
        sctx.drawImage(slot, 0, PAD, SLOT, 1, 0, 0, SLOT, PAD);
        sctx.drawImage(slot, 0, PAD + TS - 1, SLOT, 1, 0, PAD + TS, SLOT, PAD);
        ctx.drawImage(slot, f * this.regionW + (i % this.cols) * SLOT, Math.floor(i / this.cols) * SLOT);
      });
    }
    this.canvas = c;
    this.W = c.width; this.H = c.height;
    return c;
  }
  // [u0, vTop, u1, vBottom] (flipY texture coordinates) for frame 0
  uv(i, x0 = 0, y0 = 0, x1 = TS, y1 = TS) {
    const px = (i % this.cols) * SLOT + PAD;
    const py = Math.floor(i / this.cols) * SLOT + PAD;
    return [(px + x0) / this.W, 1 - (py + y0) / this.H, (px + x1) / this.W, 1 - (py + y1) / this.H];
  }
}

// ---------------------------------------------------------------------------
// Geometry accumulator
// ---------------------------------------------------------------------------
class GeoBuf {
  constructor(billboard = false) {
    this.pos = []; this.uv = []; this.col = []; this.nrm = []; this.idx = [];
    this.center = billboard ? [] : null;
    this.n = 0;
  }
  // corners: [[x,y,z] x4] in order TL, BL, BR, TR as seen from the front
  quad(c, uv, shade = [1, 1, 1, 1], normal = [0, 1, 0], center = null) {
    const [u0, vt, u1, vb] = uv;
    const uvs = [[u0, vt], [u0, vb], [u1, vb], [u1, vt]];
    for (let k = 0; k < 4; k++) {
      this.pos.push(c[k][0], c[k][1], c[k][2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      const s = shade[k];
      this.col.push(s, s, s);
      this.nrm.push(normal[0], normal[1], normal[2]);
      if (this.center) this.center.push(center[0], center[1], center[2]);
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.center) g.setAttribute('center', new THREE.Float32BufferAttribute(this.center, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Shared uniform: viewer (head) position for cylindrical billboards
export const billboardUniforms = { uViewer: { value: new THREE.Vector3() } };

export function makeBillboardMaterial(params) {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = shader => {
    shader.uniforms.uViewer = billboardUniforms.uViewer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 center;
        uniform vec3 uViewer;`)
      .replace('#include <beginnormal_vertex>', `
        vec2 bbDir = uViewer.xz - (modelMatrix * vec4(center, 1.0)).xz;   // (where the map stands: a looping map moves it)
        float bbLen = length(bbDir);
        bbDir = bbLen > 0.0001 ? bbDir / bbLen : vec2(0.0, 1.0);
        vec3 objectNormal = vec3(bbDir.x, 0.0, bbDir.y);`)
      .replace('#include <begin_vertex>', `
        vec3 bbRight = vec3(bbDir.y, 0.0, -bbDir.x);
        vec3 transformed = center + bbRight * position.x + vec3(0.0, position.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'billboard';
  return mat;
}

// ---------------------------------------------------------------------------
// Map building
// ---------------------------------------------------------------------------
const DIRS = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };

export async function loadTilesetImages(tileset) {
  return Promise.all(tileset.tileset_names.map(n => (n ? loadImage('Graphics/Tilesets', n) : null)));
}

export async function buildMapMesh(grid, opts = {}) {
  const furniture = furnitureFloor(grid);
  grid = furniture.grid;
  const images = await loadTilesetImages(grid.tileset);
  const parWallImg = opts.parallaxWalls && grid.map.parallax_name ? await loadImage('Graphics/Parallaxes', grid.map.parallax_name) : null;
  const drawer = new TileDrawer(images, grid.flags);
  const { w, h } = grid;
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    const t0 = grid.tile(x, y, 0), t1 = grid.tile(x, y, 1), t2 = grid.tile(x, y, 2);
    if (!isVisible(t0) && !isVisible(t1) && !isVisible(t2)) { empty[i] = 1; continue; }
    const wt = isWallType(t1) ? t1 : isWallType(t0) ? t0 : doorTop.has(i) ? wallBeside(x, y) : 0;
    if (wt && !wallFloor[i] && (!grid.anyPassable(x, y) || offLimits(i) || doorTop.has(i))) {
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
  // ('all' after the depth: whatever else is there that nobody can reach too - 퀸・랜드's approach: the black round the bridge to
  // the castle, drawn with wall-top tiles, stood as walls along it with the balloons on their tops)
  for (const [x0, y0, x1, y1, depth = 6, all] of opts.abyss || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!valid(x, y)) continue;
      const i = idx(x, y);
      if (all === 'all' && offLimits(i) && !pit[i]) { /* taken below */ }
      else if (solid[i] === SOLID_WALL && isSide[i] && !grid.anyPassable(x, y)) { hangArt[i] = 1; }
      else if (!empty[i]) continue;
      solid[i] = 0; empty[i] = 1; isSide[i] = 0; wallKind[i] = -1; raisedTop[i] = 0;
      abyss[i] = 1; abyssLo[i] = -depth; anyAbyss = true;
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
    if (isLyingTile(t, grid.tileset.tileset_names)) lyingTile.add(t);
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
  // remaining walkable wall-side cells (stairs on a wall that is not a cliff) sit at their neighbours' level
  for (let i = 0; i < w * h; i++) {
    if (!sideCell[i] || slope[i] || solid[i] || empty[i] || pit[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (valid(x + dx, y + dy) && levelCell(idx(x + dx, y + dy))) { floorE[i] = floorE[idx(x + dx, y + dy)]; break; }
    }
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
  if (opts.falls?.some(f => f.dir === 1)) {
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
    const flat = i => walk(i) && runLen[i] >= 3;
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
          if (!walk(idx(x, y)) || runLen[idx(x, y)] >= 3) { y++; continue; }
          const y0 = y;
          y++;
          while (y < h && walk(idx(x, y)) && runLen[idx(x, y)] < 3 && link(x, y - 1, 0, 1, 2)) y++;
          const y1 = y - 1;
          const top = link(x, y0 - 1, 0, 1, 2) ? node[idx(x, y0 - 1)] : -1;
          const bot = link(x, y1, 0, 1, 2) ? node[idx(x, y1 + 1)] : -1;
          let ladder = false;
          for (let yy = y0; yy <= y1 && !ladder; yy++) ladder = grid.isLadder(x, yy);
          runs.push({ x, y0, y1, top, bot, ladder });
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
          const rise = r.ladder && floorE0[tc] - floorE0[bc] < 0.9 ? r.y1 - r.y0 + 1 : 0;
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
  for (const [x0, y0, x1, y1] of opts.whole || []) {
    const mine = stacks.filter(st => !st.elev && !st.onTable && st.x >= x0 && st.x <= x1 && st.cellY >= y0 && st.cellY <= y1);
    if (!mine.length) continue;
    const bottom = Math.max(...mine.map(st => st.cellY));
    const cols = new Map();                       // x -> (y -> tile)
    const put = (x, y, t) => { if (!cols.has(x)) cols.set(x, new Map()); cols.get(x).set(y, t); };
    for (const st of mine) st.tiles.forEach((t, r) => { if (t) put(st.x, st.cellY - r, t); });
    for (let y = y0; y <= bottom; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), t = grid.tile(x, y, 2);
      if (!isVisible(t) || taken(i) || solid[i] || pit[i]) continue;
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
      const fixedFurniture = cols.every(c => c.tiles.every(t => isUprightFurnitureTile(t, grid.tileset.tileset_names)));
      const fixed = fixedFurniture || arch || cols.some(c => longCell[idx(c.x, c.topY)]) || (cols.length > 1 && cols.some(c => c.againstWall));
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

  // (developer checks: what the cells became, without building any geometry)
  if (opts.analysisOnly) {
    return {
      isSolid, floorAt,
      isPit: (x, y) => valid(x, y) && pit[idx(x, y)] === 1,
      isStackCell: (x, y) => valid(x, y) && !!stackConsumed[idx(x, y)],
      isRaisedTop: (x, y) => valid(x, y) && !!raisedTop[idx(x, y)],
      stacks: stacks.map(st => ({ x: st.x, y: st.cellY, top: st.topY, foot: st.footY, elev: st.elev, againstWall: st.againstWall, drop: st.drop || 0, tiles: st.tiles, joined: !!st.joined, arch: st.arch ? (st.archFlat ? 'flat' : 'turning') : '' })),
      footShadows: [...footShadowAt.entries()].map(([i, t]) => [i % w, (i / w) | 0, t]),
      lying: lyingCols.map(c => ({ x: c.x, y: c.y1, top: c.y0, tiles: c.pieces })),
      furniture: furniture.cells.map(c => ({ x: c.x, y: c.y, tile: c.tile, kind: c.profile.kind, direction: c.profile.direction })),
      boxes: boxes.map(b => b.line ? { line: b.line.map(st => [st.x, st.cellY, st.footY]), fixed: true } : { x0: b.x0, n: b.n, cy: b.cy, fixed: b.fixed, slab: !!b.slab }),
      stats: { invisibleCells: invisibleCells.map(i => [i % w, (i / w) | 0]), falls: fallStats,
        // (walls drawn between two walkable places that ended at one level: a terraced place laid flat?)
        faces: bands.filter(b => b.lowFloor).length,
        flatFaces: bands.filter(b => b.lowFloor && comp[b.uI] >= 0 && comp[b.uI] === comp[b.lI] && grid.anyPassable(b.uI % w, (b.uI / w) | 0) && grid.anyPassable(b.lI % w, (b.lI / w) | 0)).length },
      dispose() {},
    };
  }

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
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = idx(x, y);
      if (!surfaceCell(a) || pit[a]) continue;
      for (const dname of ['S', 'N', 'E', 'W']) {
        const [dx, dy] = DIRS[dname];
        if (!valid(x + dx, y + dy) || !abyss[idx(x + dx, y + dy)]) continue;
        const n = idx(x + dx, y + dy), lo = abyssLo[n];
        const hiE = dname === 'N' ? surfN(a) : dname === 'S' ? surfS(a) : Math.min(surfN(a), surfS(a));
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

  // ---- build atlases & meshes --------------------------------------------------
  staticAtlas.build();
  animAtlas.build();
  for (const op of pending) op();

  const group = new THREE.Group();
  group.name = 'map';
  let furnitureMaterial = null;
  // A room's chairs stay aligned with its tables, regardless of the camera.
  if (furniture.cells.length) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TS;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = new Map(), byTile = new Map();
    const pixelsFor = tile => {
      if (!pixels.has(tile)) {
        ctx.clearRect(0, 0, TS, TS);
        drawer.draw(ctx, tile, 0, 0);
        pixels.set(tile, ctx.getImageData(0, 0, TS, TS).data);
      }
      return pixels.get(tile);
    };
    for (const c of furniture.cells) {
      if (!byTile.has(c.tile)) byTile.set(c.tile, { geometry: furnitureGeometry(c.profile, pixelsFor, T), cells: [] });
      byTile.get(c.tile).cells.push(c);
    }
    furnitureMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const { geometry, cells } of byTile.values()) {
      if (!geometry) continue;
      // Repeated seating shares its geometry and draw call, including theatre rows.
      const mesh = new THREE.InstancedMesh(geometry, furnitureMaterial, cells.length), matrix = new THREE.Matrix4();
      cells.forEach((c, i) => {
        matrix.makeTranslation((c.x + 0.5) * T, floorAt(c.x, c.y) * T, (c.y + 0.5) * T);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      mesh.name = 'furniture';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  const staticTex = pixelTexture(staticAtlas.canvas);
  const animTex = pixelTexture(animAtlas.canvas);
  animTex.wrapS = THREE.RepeatWrapping;
  // faces are built toward where the 2D view sees them; from behind (a market stall from its back, a
  // wall seen from inside a block) they still show, darker, instead of vanishing
  const matOpts = { vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide };
  const backShaded = mat => {
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;');
    };
    mat.customProgramCacheKey = () => 'map-backshaded';
    return mat;
  };
  const matStatic = backShaded(new THREE.MeshLambertMaterial({ ...matOpts, map: staticTex }));
  const matAnim = backShaded(new THREE.MeshLambertMaterial({ ...matOpts, map: animTex }));
  const matBbStatic = makeBillboardMaterial({ ...matOpts, map: staticTex, side: THREE.DoubleSide });
  const matBbAnim = makeBillboardMaterial({ ...matOpts, map: animTex, side: THREE.DoubleSide });
  // the boxes of upright pictures: a side shows only from outside, so through a clear part of the near
  // side you see what is behind the box, not its far sides
  const matObj = new THREE.MeshLambertMaterial({ ...matOpts, side: THREE.FrontSide, map: staticTex });
  const matObjAnim = new THREE.MeshLambertMaterial({ ...matOpts, side: THREE.FrontSide, map: animTex });
  const meshes = [
    [bufs.static, matStatic], [bufs.anim, matAnim], [bufs.bbStatic, matBbStatic], [bufs.bbAnim, matBbAnim],
    [bufs.obj, matObj], [bufs.objAnim, matObjAnim],
  ];
  for (const [buf, mat] of meshes) {
    if (!buf.n) continue;
    const mesh = new THREE.Mesh(buf.geometry(), mat);
    mesh.frustumCulled = buf.center === null;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  // the low wide pictures standing still: the edges of their pixels, as small blocks, in one mesh
  if (slabPieces.length) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TS;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const byTile = new Map();
    const geos = [];
    for (const p of slabPieces) {
      let g = byTile.get(p.tid);
      if (g === undefined) {
        ctx.clearRect(0, 0, TS, TS);
        drawer.draw(ctx, p.tid, 0, 0);
        g = voxelGeometryOf(ctx.getImageData(0, 0, TS, TS).data, TS, TS, SLAB_THICKNESS, false, false);
        if (g) { g.translate(0, TS / 2, 0); g.scale(T / TS, T / TS, T / TS); }
        byTile.set(p.tid, g);
      }
      if (g) geos.push(g.clone().translate(p.x, p.y, p.z));
    }
    const merged = geos.length ? mergeGeometries(geos) : null;
    for (const g of geos) g.dispose();
    for (const g of byTile.values()) g?.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.matrixAutoUpdate = false;
      mesh.name = 'standing-pictures';
      group.add(mesh);
    }
  }

  // Parallax: in 2D it shows through transparent/empty floor, so in 3D it becomes the ground.
  //  "yuka*" images are pre-drawn floors aligned to the map (遠景床 script); others are tiled.
  const pname = grid.map.parallax_name || '';
  let parallaxFloor = null;
  if (pname && !opts.openSky) {                          // (open sky: the picture is the sky round the map - sky.js - with nothing under it)
    let img = await loadImage('Graphics/Parallaxes', pname);
    const backdrop = /ocean/i.test(pname) && img;
    if (backdrop) {
      // (a sky over the sea, drawn as a view: only the sea under the horizon lies under the map)
      const c = document.createElement('canvas');
      const top = Math.round(img.height * 0.56);
      c.width = img.width; c.height = img.height - top;
      c.getContext('2d').drawImage(img, 0, top, img.width, c.height, 0, 0, c.width, c.height);
      img = c;
    }
    if (img) {
      const tex = pixelTexture(img);
      const mw = w * T, mh = h * T;
      if (/^yuka/i.test(pname)) {
        // (the original's 遠景床 script fixes it to the map and, as a parallax plane does, repeats it from the
        // map's corner: a map-sized drawing lies once, a small one - a patch of forest floor, stone road, sand
        // - covers the whole ground. Laid once at its own size, a small one left the rest of the ground black
        // where the tiles are clear: the forest clearing of 71 ~ 80 77, the stone of 피눈물 웅덩이 1)
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const rx = (w * TS) / img.width, ry = (h * TS) / img.height;
        tex.repeat.set(rx, ry);
        tex.offset.set(0, Math.ceil(ry) - ry);          // (the drawing's top-left corner at the map's)
        parallaxFloor = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshLambertMaterial({ map: tex }));
        parallaxFloor.position.set(mw / 2, -0.02, mh / 2);
      } else {
        tex.wrapS = tex.wrapT = backdrop ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        const grow = parKind === 'sky' || backdrop ? 3 : 1;   // sky far below / the sea seen from a height: reach past the map edges
        tex.repeat.set((w * TS) * grow / img.width, (h * TS) * grow / img.height);
        const mat = new THREE.MeshLambertMaterial({ map: tex });
        if (parKind === 'water') mat.color.setRGB(0.75, 0.8, 0.85);
        parallaxFloor = new THREE.Mesh(new THREE.PlaneGeometry(mw * grow, mh * grow), mat);
        parallaxFloor.position.set(mw / 2, openVoid ? OPEN_LEVEL * T : -0.03, mh / 2);
        parallaxFloor.userData.scroll = [grid.map.parallax_sx || 0, grid.map.parallax_sy || 0];
      }
      parallaxFloor.rotation.x = -Math.PI / 2;
      group.add(parallaxFloor);
    }
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
    // inside a solid (should not happen): use the highest neighbouring floor
    let best2 = 0, found = false;
    for (const [dx, dy] of N4) if (isFloor(x + dx, y + dy)) { const e = floorE[idx(x + dx, y + dy)]; if (!found || e > best2) { best2 = e; found = true; } }
    return best2;
  }

  let frame = 0;
  return {
    group,
    wallHeight: baseH,
    stats: {
      static: staticAtlas.draws.length, anim: animAtlas.draws.length, stacks: stacks.length, lying: lyingCols.length,
      atlasW: staticAtlas.W, atlasH: staticAtlas.H, doorways: doorways.length,
      mass: solid.reduce((n, v) => n + (v === SOLID_MASS ? 1 : 0), 0),
      void: solid.reduce((n, v) => n + (v === SOLID_VOID ? 1 : 0), 0),
      cliffs: slopeBands, cliffWalls, rails: solid.reduce((n, v) => n + (v === SOLID_RAIL ? 1 : 0), 0), open: parKind,
      invisible: invisibleCells.length, edgeRails: railCount, daises, low: solid.reduce((n, v) => n + (v === SOLID_LOW ? 1 : 0), 0), raisedTops: raisedTop.reduce((n, v) => n + v, 0), invisibleCells: invisibleCells.slice(0, 400).map(i => [i % w, (i / w) | 0]),
      slopes: slope.reduce((n, v) => n + v, 0), pits: pit.reduce((n, v) => n + v, 0),
      levels: [...new Set(compElev)].length,
      falls: fallStats,
      terraceFit: terraceFit.slice(0, 60).map(r => `${r[1]} k${r[2]} got ${r[3]} (${r[4]}>${r[5]})`),
    },
    staticAtlas, animAtlas, drawer,
    joinsBelow: connected, joinsBeside: hConnected,     // (upper, lower) / (left, right) tile ids: do their drawings meet
    isSolid,
    isPit: (x, y) => valid(x, y) && pit[idx(x, y)] === 1,
    isSlope: (x, y) => valid(x, y) && slope[idx(x, y)] === 1,
    solidBaseAt: (x, y) => (isSolid(x, y) ? solidBase[idx(x, y)] : NaN),   // (developer checks)
    isCliffAt: (x, y) => valid(x, y) && !Number.isNaN(cliffTop[idx(x, y)]),
    isStackCell: (x, y) => valid(x, y) && !!stackConsumed[idx(x, y)],    // an upright object stands here
    lyingCells: [...lyingAt.keys()],                                     // beds, tables: low blocks nobody walks into
    isRaisedTop: (x, y) => valid(x, y) && !!raisedTop[idx(x, y)],        // a passable wall top / face out of reach, made solid
    // a way nobody can see (open sky: a clear tile walked on, a drop either side of it) and which way it runs: 'x' along
    // a row (drops north and south), 'y' along a column, '' none - player.js keeps a walk along it from drifting off
    hiddenWay(x, y) {
      if (!valid(x, y) || !clear[idx(x, y)] || pit[idx(x, y)] || !grid.anyPassable(x, y)) return '';
      const drop = (dx, dy) => valid(x + dx, y + dy) && !!pit[idx(x + dx, y + dy)];
      return drop(0, -1) && drop(0, 1) ? 'x' : drop(-1, 0) && drop(1, 0) ? 'y' : '';
    },
    solidHeight: (x, y) => (isSolid(x, y) ? solidTop[idx(x, y)] - solidBase[idx(x, y)] : 0),
    solidTopAt: (x, y) => (isSolid(x, y) ? solidTop[idx(x, y)] : -Infinity),   // tiles; walls stop shots below it
    isDoorway: (x, y) => doorways.some(d => d.x === x && d.y === y),
    floorAt,
    // where something drawn over a solid cell in 2D (an NPC set into a wall, a creature on a rock) shows in
    // 3D, in tiles: on the face the 2D view looks at (south), as far up it as it was drawn above the floor;
    // on top of the block when it sits on the roof part. Over an upright picture: in front of it (free:
    // still turning to the viewer; about: kept on the viewer's side of a picture turning about that
    // point). null for open cells
    // side view: drawn on the tower's wall (in the shaft or on a wall beside it), so it hangs there upright
    onSideWall(x, y) {
      if (!valid(x, y)) return false;
      if (shaft) return !!shaft[idx(x, y)] || (isSolid(x, y) && N4.some(([dx, dy]) => valid(x + dx, y + dy) && !!shaft[idx(x + dx, y + dy)]));
      if (!sideRowH || !sideBox) return false;
      if (x < sideBox[0] - 2 || x > sideBox[2] + 2 || y < sideBox[1] || y > sideBox[3]) return false;
      return !!pit[idx(x, y)] || isSolid(x, y);
    },
    spotOnSolid(x, y, lying = false, above = false) {
      // a side view: things drawn on the tower's wall hang on it at their row's height. Drawn in the shaft
      // (the wall behind it in 2D), they go onto the nearest wall: a tower wall beside them, else the face
      // under the ledge above (what the drawing shows above them), else the one below
      const hang = (i, hy) => {
        const x = i % w, y = (i / w) | 0;
        for (const [side, dx] of [['E', -1], ['W', 1]]) {
          if (valid(x + dx, y) && isSolid(x + dx, y) && !pit[idx(x + dx, y)]) return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
        }
        for (const dir of [-1, 1]) {
          for (let d = 1; d <= 14; d++) {
            const yy = y + dir * d;
            if (!valid(x, yy)) break;
            if (pit[idx(x, yy)]) continue;
            const top = isSolid(x, yy) ? solidTop[idx(x, yy)] : floorE[idx(x, yy)];
            if (dir === -1 && hy > top - 0.2) break;          // the face below that ledge does not reach up here
            return dir === -1 ? { x: x + 0.5, y: hy, z: yy + 1, side: 'S', ground: false } : { x: x + 0.5, y: hy, z: yy, side: 'N', ground: false };
          }
        }
        return { x: x + 0.5, y: hy, z: y + 0.5, side: 'top', ground: false };
      };
      // other maps' drops: drawn in the drop, it hangs on the nearest wall at its row's height; on a wall
      // beside the drop, on that wall's face toward it
      if (shaft && valid(x, y)) {
        const i = idx(x, y);
        if (shaft[i]) return hang(i, shaftRowH[i]);
        if (isSolid(x, y)) {
          for (const [side, dx, dy] of [['S', 0, 1], ['E', 1, 0], ['W', -1, 0], ['N', 0, -1]]) {
            if (!valid(x + dx, y + dy) || !shaft[idx(x + dx, y + dy)]) continue;
            return { x: x + 0.5 + dx * 0.5, y: shaftRowH[idx(x + dx, y + dy)], z: y + 0.5 + dy * 0.5, side, ground: false };
          }
        }
      }
      if (sideRowH && sideBox && valid(x, y) && x >= sideBox[0] - 2 && x <= sideBox[2] + 2 && y >= sideBox[1] && y <= sideBox[3]) {
        const i = idx(x, y);
        const hy = sideRowH(y);
        if (pit[i]) {
          for (const [side, dx] of [['E', -1], ['W', 1]]) {
            if (valid(x + dx, y) && isSolid(x + dx, y) && !pit[idx(x + dx, y)]) return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
          }
          for (const dir of [-1, 1]) {
            for (let d = 1; d <= 14; d++) {
              const yy = y + dir * d;
              if (!valid(x, yy)) break;
              if (pit[idx(x, yy)]) continue;
              const top = isSolid(x, yy) ? solidTop[idx(x, yy)] : floorE[idx(x, yy)];
              if (dir === -1 && hy > top - 0.2) break;          // the face below that ledge does not reach up here
              return dir === -1 ? { x: x + 0.5, y: hy, z: yy + 1, side: 'S', ground: false } : { x: x + 0.5, y: hy, z: yy, side: 'N', ground: false };
            }
          }
          return { x: x + 0.5, y: hy, z: y + 0.5, side: 'top', ground: false };
        }
        if (isSolid(x, y)) {
          for (const [side, dx, dy] of [['E', 1, 0], ['W', -1, 0], ['S', 0, 1], ['N', 0, -1]]) {
            if (!valid(x + dx, y + dy) || !pit[idx(x + dx, y + dy)]) continue;
            return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5 + dy * 0.5, side, ground: false };
          }
          // a wall beside the stairs (or behind the tower's edge): on the face toward the tower's inside
          for (const [side, dx] of [['E', 1], ['W', -1]]) {
            for (let d = 1; d <= 3; d++) {
              const xx = x + dx * d;
              if (!valid(xx, y) || xx < sideBox[0] || xx > sideBox[2]) break;
              if (isSolid(xx, y)) continue;
              return { x: xx + 0.5 - dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
            }
          }
        }
      }
      if (!isSolid(x, y)) return uprightSpot(x, y, lying, above);
      // drawn over the upper part of a thing that stands in front of the wall, that part taken off the wall into
      // the thing's picture (a ladder leant on it - 도마뱀 빌 climbing it in 리펀 대성당 -, a tall shelf): in front of
      // that part, at its height (on its lowest part - a fire in a hearth - it goes on as before)
      const up = stackConsumed[idx(x, y)] && onUpright.get(idx(x, y));
      if (up && y < up.st.topY + up.st.tiles.length - 1) {
        const s = uprightSpot(x, y, lying, true);
        if (s) return s;
      }
      const onTop = onTopOf(x, y);
      if (onTop) return onTop;
      const i = idx(x, y);
      if (lying) return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };   // laid on top
      for (let d = 1; d <= 8; d++) {
        const yy = y + d;
        if (!valid(x, yy) || pit[idx(x, yy)]) break;
        if (isSolid(x, yy)) continue;
        if (!isFloor(x, yy)) break;
        const base = surfN(idx(x, yy)), up = base + d - 1;
        if (up > solidTop[i] - 0.6) return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };
        return { x: x + 0.5, y: up, z: yy, side: 'S', ground: d === 1 };
      }
      for (const [side, dx, dy] of [['E', 1, 0], ['W', -1, 0], ['N', 0, -1]]) {
        if (!isFloor(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy);
        return { x: x + 0.5 + dx * 0.5, y: Math.min(surfN(j), surfS(j)), z: y + 0.5 + dy * 0.5, side, ground: true };
      }
      return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };
    },
    update(time) {
      // A1 animation: 0.5s per frame like RPG Maker (30 frames @60fps)
      const f = Math.floor(time * 2) % 3;
      if (f !== frame) { frame = f; animTex.offset.x = f / 3; }
      const sc = parallaxFloor?.userData.scroll;
      if (sc && (sc[0] || sc[1])) {
        const m = parallaxFloor.material.map;
        m.offset.set(-sc[0] * time * 0.004, sc[1] * time * 0.004);
      }
    },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
      for (const m of [matStatic, matAnim, matBbStatic, matBbAnim, matObj, matObjAnim]) m.dispose();
      staticTex.dispose(); animTex.dispose();
      furnitureMaterial?.dispose();
    },
  };
}

// 2D top-down render (debug / minimap)
export async function render2D(grid, scale = 1) {
  const images = await loadTilesetImages(grid.tileset);
  const drawer = new TileDrawer(images, grid.flags);
  const c = document.createElement('canvas');
  c.width = grid.w * TS * scale; c.height = grid.h * TS * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    drawer.draw(ctx, grid.tile(x, y, 0), x * TS, y * TS);
    drawer.draw(ctx, grid.tile(x, y, 1), x * TS, y * TS);
    drawer.drawShadow(ctx, grid.shadow(x, y), x * TS, y * TS);
    drawer.draw(ctx, grid.tile(x, y, 2), x * TS, y * TS);
  }
  return c;
}
