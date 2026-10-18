import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { layoutTilePictures } from '../src/entities/sprites.js';
import { G } from '../src/core/globals.js';

// Tiny software canvas: these synthetic pixels pass through the real tile drawer,
// shadow separation and support analysis. No original game assets are fixtures.
function canvas() {
  let width = 32, height = 32, pixels = new Uint8ClampedArray(width * height * 4);
  const context = new Proxy({
    clearRect(x, y, w, h) {
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) pixels.fill(0, (xx + yy * width) * 4, (xx + yy * width) * 4 + 4);
    },
    drawImage(source, ...args) {
      let sx = 0, sy = 0, sw = source.width, sh = source.height, dx, dy, dw, dh;
      if (args.length === 2) { [dx, dy] = args; dw = sw; dh = sh; }
      else if (args.length === 4) [dx, dy, dw, dh] = args;
      else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      const from = source.pixels;
      if (!from) return;
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const xx = Math.floor(dx + x), yy = Math.floor(dy + y);
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const at = (Math.floor(sx + x * sw / dw) + Math.floor(sy + y * sh / dh) * source.width) * 4;
        pixels.set(from.subarray(at, at + 4), (xx + yy * width) * 4);
      }
    },
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const sx = x + xx, sy = y + yy;
        if (sx >= 0 && sy >= 0 && sx < width && sy < height)
          data.set(pixels.subarray((sx + sy * width) * 4, (sx + sy * width) * 4 + 4), (xx + yy * w) * 4);
      }
      return { data, width: w, height: h };
    },
    putImageData(image, x, y) {
      const w = image.width || 32, h = image.height || 32;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        if (x + xx >= 0 && y + yy >= 0 && x + xx < width && y + yy < height)
          pixels.set(image.data.subarray((xx + yy * w) * 4, (xx + yy * w) * 4 + 4), (x + xx + (y + yy) * width) * 4);
      }
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { get width() { return width; }, set width(v) { width = v; pixels = new Uint8ClampedArray(width * height * 4); },
    get height() { return height; }, set height(v) { height = v; pixels = new Uint8ClampedArray(width * height * 4); },
    get pixels() { return pixels; }, getContext: () => context };
}

let fixture = 0;
async function environment(t, { halo = false, hanging = false, table = false, branch = false, boundary = false } = {}) {
  const descriptors = Object.fromEntries(['document', 'Image'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, d] of Object.entries(descriptors)) {
    if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key];
  } });
  const name = `Synthetic support ${fixture++}`;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    constructor() {
      this.width = this.height = 512; this.pixels = new Uint8ClampedArray(512 * 512 * 4);
      const put = (tile, x, y, rgba) => this.pixels.set(rgba,
        ((tile % 8 * 32 + x) + (Math.floor(tile / 8) * 32 + y) * 512) * 4);
      for (let y = 0; y < 24; y++) for (let x = 8; x < 24; x++) put(1, x, y, [120, 150, 180, 255]);
      if (halo) for (let x = 8; x < 24; x++) put(1, x, 31, [200, 180, 160, 100]);
      else for (let y = 24; y < 32; y++) for (let x = 5; x < 27; x++) put(1, x, y, [10, 10, 10, 128]);
      for (let y = 8; y < (hanging ? 24 : 32); y++) for (let x = 8; x < 24; x++) put(9, x, y, [120, 150, 180, 255]);
      if (branch) {
        for (let y = 8; y < 32; y++) for (let x = 24; x < 32; x++) put(9, x, y, [120, 150, 180, 255]);
        for (let y = 8; y < 24; y++) for (let x = 0; x < 8; x++) put(10, x, y, [120, 150, 180, 255]);
      }
      if (boundary) {
        for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) put(1, x, y, [120, 150, 180, 255]);
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) put(2, x, y, [180, 140, 80, 255]);
      }
    }
    set src(_url) { queueMicrotask(() => this.onload()); }
  } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [`Graphics/Tilesets/${name}.png`] }));
  await initAssets();
  const w = 5, h = 5, data = new Int16Array(w * h * 4), flags = new Int16Array(8192), names = Array(9).fill('');
  data.fill(1536, 0, w * h); flags[0] = flags[9] = 16; flags[1] = 15; names[5] = name;
  data[2 + 1 * w + 2 * w * h] = 9;
  if (branch) { data[3 + 1 * w + 2 * w * h] = 10; flags[10] = 16; }
  if (!hanging) data[2 + 2 * w + 2 * w * h] = 1;
  if (table) { data[2 + 2 * w] = 2816; flags[2816] = 15 | 128; }
  if (boundary) {
    data.fill(0, 2 * w * h, 3 * w * h);
    data[4 + 1 * w + 2 * w * h] = 1; data[0 + 2 * w + 2 * w * h] = 2; flags[2] = 15;
  }
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: names, flags: { data: flags } });
  return { grid, data, flags };
}

test('a grounded upright picture rests its visible foot on the floor after its raw drop shadow is separated', async t => {
  const { grid, data, flags } = await environment(t), before = data.slice(), originalFlags = flags.slice();
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  const picture = mesh.stacks.find(st => st.x === 2 && st.y === 2);
  assert.ok(picture); assert.equal(picture.elev, 0); assert.equal(picture.againstWall, false);
  assert.equal(picture.drop, 8 / 32, 'the eight shadow rows disappear from the upright image and cannot count as its foot');
  const visibleFoot = mesh.floorAt(2, 2) - picture.drop + 8 / 32;
  assert.equal(visibleFoot, mesh.floorAt(2, 2));
  assert.deepEqual(mesh.footShadows, [[2, 2, 1]], 'the original shadow stays on the floor');
  assert.deepEqual(data, before); assert.deepEqual(flags, originalFlags); assert.equal(grid.anyPassable(2, 2), false);
});

test('a low-alpha halo discarded by the actual material cannot lift a freestanding picture', async t => {
  const { grid } = await environment(t, { halo: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(mesh.stacks.find(st => st.x === 2 && st.y === 2)?.drop, 8 / 32);
});

test('an object on a counter retains its unstripped source shadow and table support', async t => {
  const { grid } = await environment(t, { table: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  const picture = mesh.stacks.find(st => st.x === 2 && st.y === 2);
  assert.ok(picture); assert.equal(picture.drop, 0);
  assert.equal(mesh.isSolid(2, 2), true); assert.equal(grid.isTableTop(2, 2), true);
});

test('intentional orphan-star hanging artwork keeps its authored elevated placement', async t => {
  const { grid } = await environment(t, { hanging: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  const picture = mesh.stacks.find(st => st.x === 2);
  assert.ok(picture); assert.equal(picture.elev, 1); assert.equal(picture.drop, 0);
});

test('an attached canopy column padded with an empty foot cannot keep the real stem floating', async t => {
  const { grid } = await environment(t, { branch: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  const stem = mesh.stacks.find(st => st.x === 2 && st.y === 2);
  const canopy = mesh.stacks.find(st => st.x === 3 && st.y === 2);
  assert.ok(stem); assert.ok(canopy); assert.equal(canopy.joined, true);
  assert.deepEqual(canopy.tiles, [0, 10], 'the real joining pipeline must generate the empty-foot column');
  assert.equal(stem.drop, 8 / 32); assert.equal(canopy.drop, stem.drop, 'the whole picture follows its visible supporting foot');
  assert.deepEqual(stem.tiles, [1, 9], 'none of the original stem or canopy artwork is discarded');
});

test('a map-edge picture cannot join an unrelated picture at the start of the next row', async t => {
  const { grid } = await environment(t, { boundary: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(mesh.boxes.length, 2, 'linear cell keys must not alias (width,y) with (0,y+1)');
  assert.ok(mesh.boxes.every(box => box.n === 1));
  assert.ok(mesh.boxes.some(box => box.x0 === 4 && box.cy === 1));
  assert.ok(mesh.boxes.some(box => box.x0 === 0 && box.cy === 2));
  assert.equal(mesh.stacks.find(st => st.x === 4 && st.y === 1)?.drop, 8 / 32);
  assert.equal(mesh.stacks.find(st => st.x === 0 && st.y === 2)?.drop, 0);
});

test('event tile pictures obey the same row boundary while real horizontal neighbors still assemble', t => {
  const previous = G.map; t.after(() => { G.map = previous; }); G.map = { width: 5 };
  const picture = (x, y, tileId) => ({ ch: { isEvent: true, x, y, tileId, priorityType: 1, through: false },
    mesh: {}, hiddenNow: false, mode: 'stand' });
  const mapInfo = { isWall: () => false, joinsBelow: () => true, joinsBeside: () => true };
  const acrossEdge = [picture(4, 1, 1), picture(0, 2, 2)];
  layoutTilePictures(acrossEdge, mapInfo);
  assert.ok(acrossEdge.every(sprite => sprite.tp === null), 'unrelated event pictures cannot be moved into one slab across rows');
  assert.deepEqual(acrossEdge.map(sprite => [sprite.ch.x, sprite.ch.y]), [[4, 1], [0, 2]]);
  const neighbors = [picture(3, 1, 1), picture(4, 1, 2)];
  layoutTilePictures(neighbors, mapInfo);
  assert.ok(neighbors.every(sprite => sprite.tp.n === 2 && sprite.tp.fy === 1 && sprite.tp.slab));
  assert.deepEqual(neighbors.map(sprite => sprite.tp.c), [0, 1]);
});
