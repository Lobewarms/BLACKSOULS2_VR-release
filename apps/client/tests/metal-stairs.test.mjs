import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { meshHintOptions } from '../src/world/mapbuild.js';

async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) data.set([110, 115, 120, 255], i);
      return { data };
    } }, { get: (target, key) => key in target ? target[key] : () => {} }),
  }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] })); await initAssets();
}

function stairs() {
  const w = 90, h = 40, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  flags[0] = 16; flags[6833] = 15; for (const t of [7378, 7376, 7384]) flags[t] = 15;
  for (let x = 77; x <= 87; x++) {
    for (const y of [32, 33]) set(x, y, 0, 1567);
    for (let y = 28; y <= 31; y++) set(x, y, 0, y === 28 ? 7378 : y === 31 ? 7384 : 7376);
  }
  for (let x = 80; x <= 84; x++) set(x, 27, 0, 6833);
  for (let x = 81; x <= 83; x++) for (let y = 28; y <= 31; y++) set(x, y, 2, (y < 30 ? 4 : y === 30 ? 12 : 20) + x - 81);
  const map = { width: w, height: h, data: { data }, parallax_name: '', parallax_show: false };
  const grid = new MapGrid(map, { tileset_names: Array(9).fill(''), flags: { data: flags } });
  // A separately established lower room is two tiles below the doorway. All
  // textures and surrounding layout are synthetic; no original game is loaded.
  return { grid, data, flags, lowerRoom: [77, 32, 87, 33, -2, -2] };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('a transfer-door stair without an upper room joins both flights and its middle landing continuously', async t => {
  await environment(t); const { grid, data, flags, lowerRoom } = stairs(), beforeData = data.slice(), beforeFlags = flags.slice();
  const hints = meshHintOptions(313);
  const mesh = await buildMapMesh(grid, { ...hints, floorHints: [...(hints.floorHints || []), lowerRoom], analysisOnly: true });
  for (let x = 81; x <= 83; x++) {
    near(mesh.floorAt(x, 27.500001), 0); near(mesh.floorAt(x, 31.499999), -2);
    for (let y = 28; y <= 31; y++) {
      assert.equal(grid.passable(x, y, 2), true); assert.equal(grid.passable(x, y, 8), true);
      assert.equal(mesh.isSolid(x, y), false); assert.equal(mesh.isPit(x, y), false);
      near(mesh.floorAt(x, y + 0.499999), mesh.floorAt(x, y + 0.500001));
    }
    near(mesh.floorAt(x, 29.500001), -1); near(mesh.floorAt(x, 30.499999), -1);
    assert.ok(mesh.floorAt(x, 28) > mesh.floorAt(x, 29)); assert.ok(mesh.floorAt(x, 30) > mesh.floorAt(x, 31));
  }
  assert.equal(mesh.isSolid(80, 29), true, 'the stair profile cannot open its neighboring wall');
  near(mesh.floorAt(79, 32), -2); near(mesh.floorAt(85, 33), -2);
  assert.deepEqual(data, beforeData); assert.deepEqual(flags, beforeFlags, 'only presentation heights change');
});

test('a source-specific stair profile leaves unrelated maps and ordinary sustained wall faces untouched', async t => {
  await environment(t); const { grid, lowerRoom } = stairs();
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(314), floorHints: [lowerRoom], analysisOnly: true });
  near(mesh.floorAt(82, 30), 0); near(mesh.floorAt(82, 31), -2);
  assert.equal(mesh.isSolid(80, 29), true);
  assert.equal(meshHintOptions(314).floorHints, null);
});
