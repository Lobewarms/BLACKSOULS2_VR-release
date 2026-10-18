import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { isAuthoredFloorAutotile } from '../src/world/floor-autotiles.js';

function namesFor(sheet = '食肉園 (3)') { const names = Array(9).fill(''); names[3] = sheet; return names; }

async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) data.set([112, 74, 82, 255], i);
      return { data };
    } }, { get: (target, key) => key in target ? target[key] : () => {} }),
  }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}

// A single room has a narrow entrance and an ordinary floor island amid a
// checkerboard. Treating its checkerboard as wall faces fabricates a five-row
// stair flight to that island, despite every checkerboard edge being passable.
function room({ sheet, blocked = false } = {}) {
  const w = 13, h = 15, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const wall = 6562, ground = 2816, checkerboard = 7952;
  flags[0] = 16; flags[wall] = 15; flags[checkerboard] = blocked ? 15 : 0;
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 0, wall);
  for (let y = 1; y <= 4; y++) for (let x = 9; x <= 10; x++) set(x, y, 0, ground);
  for (let y = 5; y <= 11; y++) for (let x = 2; x <= 10; x++) set(x, y, 0, checkerboard);
  for (let x = 5; x <= 10; x++) { set(x, 10, 0, ground); set(x, 11, 0, wall); }
  for (let y = 12; y <= 13; y++) for (let x = 2; x <= 10; x++) set(x, y, 0, ground);
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: namesFor(sheet), flags: { data: flags } });
  return { grid, data, flags };
}

test('only the verified checkerboard kind and original A4 source are floor artwork', () => {
  for (let shape = 0; shape < 16; shape++) assert.equal(isAuthoredFloorAutotile(7952 + shape, namesFor()), true);
  for (const id of [7904, 8000, 7379, 7952.5, NaN, undefined, 8192, -1]) assert.equal(isAuthoredFloorAutotile(id, namesFor()), false);
  assert.equal(isAuthoredFloorAutotile(7952, namesFor('Unrelated A4 walls')), false);
  assert.equal(isAuthoredFloorAutotile(7952, null), false);
  assert.equal(isAuthoredFloorAutotile(7952, ['', '', '食肉園 (3)']), false, 'the same name in another source slot is unrelated');
});

test('passable checkerboard room stays at one level around floor islands', async t => {
  await environment(t); const { grid, data, flags } = room();
  const beforeData = data.slice(), beforeFlags = flags.slice();
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  for (const [x, y] of [[9, 4], [9, 5], [9, 9], [9, 10], [4, 9], [4, 10], [4, 11], [4, 12]]) {
    assert.equal(grid.anyPassable(x, y), true);
    assert.equal(mesh.floorAt(x, y), 0, `continuous checkerboard floor ${x},${y} must not become a cliff`);
    assert.equal(mesh.isSolid(x, y), false);
  }
  assert.equal(mesh.isSolid(1, 7), true, 'neighboring actual walls remain solid');
  assert.deepEqual(data, beforeData); assert.deepEqual(flags, beforeFlags);
});

test('same autotile slot on unrelated art retains actual cliff/stair inference', async t => {
  await environment(t); const { grid } = room({ sheet: 'Synthetic wall stair artwork' });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(mesh.floorAt(9, 4) - mesh.floorAt(9, 10), 5, 'a source guard must not flatten unverified wall faces');
});

test('floor-art classification does not open blocked tiles', async t => {
  await environment(t); const { grid, flags } = room({ blocked: true });
  const beforeFlags = flags.slice(), mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(grid.anyPassable(9, 5), false); assert.equal(mesh.isSolid(9, 5), true);
  assert.deepEqual(flags, beforeFlags);
});
