import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { isBridgeDeckTile } from '../src/world/bridges.js';

const namesFor = (sheet = 'VXTileE', slot = 8) => { const names = Array(9).fill(''); names[slot] = sheet; return names; };
async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) data.set([130, 120, 90, 255], i);
      return { data };
    } }, { get: (target, key) => key in target ? target[key] : () => {} }),
  }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}

function banks({ deck = 870, sheet = 'VXTileE', blocked = false } = {}) {
  const w = 16, h = 13, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const ground = 2816, wallNorth = 6562, wallSouth = 6568;
  flags[0] = 16; flags[wallNorth] = flags[wallSouth] = 15; flags[deck] = blocked ? 15 : 0;
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  for (let x = 1; x <= 14; x++) {
    for (let y = 1; y <= 4; y++) set(x, y, 0, ground);
    for (let y = 7; y <= 9; y++) set(x, y, 0, ground);
    set(x, 5, 0, wallNorth); set(x, 6, 0, wallSouth);
  }
  for (let x = 6; x <= 8; x++) for (const y of [5, 6]) set(x, y, 2, deck);
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: 'water1', parallax_show: true },
    { tileset_names: namesFor(sheet), flags: { data: flags } });
  return { grid, data, flags };
}

test('only verified complete bridge deck cells use the original VXTileE identity', () => {
  for (const slot of [5, 6, 7, 8]) for (const cell of [102, 107]) {
    assert.equal(isBridgeDeckTile((slot - 5) * 256 + cell, namesFor('VXTileE', slot)), true);
  }
  for (const cell of [1, 4, 9, 12, 99, 101, 103, 109, 110, 111, 115, 116, 117, 118, 119, 127]) {
    assert.equal(isBridgeDeckTile(768 + cell, namesFor()), false, 'stairs, rails, broken fragments and neighboring art are not complete decks');
  }
  for (const id of [null, undefined, NaN, -1, 102.5, 1024, 1536 + 102]) assert.equal(isBridgeDeckTile(id, namesFor()), false);
  assert.equal(isBridgeDeckTile(870, namesFor('Other bridge art')), false);
  assert.equal(isBridgeDeckTile(870, null), false);
});

for (const deck of [870, 875]) test(`passable bridge ${deck} crosses a painted cliff without inventing a descending floor`, async t => {
  await environment(t); const { grid, data, flags } = banks({ deck });
  const beforeData = data.slice(), beforeFlags = flags.slice(), mesh = await buildMapMesh(grid, { analysisOnly: true });
  for (const [x, y] of [[7, 4], [7, 5], [7, 6], [7, 7]]) {
    assert.equal(grid.anyPassable(x, y), true); assert.equal(mesh.floorAt(x, y), 0);
    assert.equal(mesh.isSolid(x, y), false, 'the original passable deck remains a usable crossing');
  }
  assert.ok(Math.abs(mesh.floorAt(0, 6) + 0.45) < 1e-6, 'the river stays just below the connected banks');
  assert.equal(mesh.isSolid(2, 5), true, 'the neighboring uncovered bank wall stays solid');
  assert.equal(grid.anyPassable(2, 5), false); assert.equal(mesh.isPit(7, 5), false);
  assert.deepEqual(data, beforeData); assert.deepEqual(flags, beforeFlags);
});

test('unrelated passable art still follows existing cliff and stair inference', async t => {
  await environment(t); const { grid } = banks({ sheet: 'Synthetic stair artwork' });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(mesh.floorAt(7, 4) - mesh.floorAt(7, 7), 2, 'source-specific bridge handling must not flatten real stairs');
  assert.equal(grid.anyPassable(7, 5), true);
});

test('blocked bridge artwork cannot open a crossing or lower surrounding walls', async t => {
  await environment(t); const { grid } = banks({ blocked: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(grid.anyPassable(7, 5), false); assert.equal(mesh.isSolid(7, 5), true);
  assert.equal(mesh.isSolid(2, 5), true); assert.equal(grid.anyPassable(2, 5), false);
});
