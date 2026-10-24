import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);
async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) { const data = new Uint8ClampedArray(w * h * 4); data.fill(255); return { data }; } },
      { get: (object, key) => key in object ? object[key] : () => {} }),
  }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] })); await initAssets();
}

// A ladder's first sloping row also belongs to a broad passage. The fall solver
// replans its remaining narrow rows after that first row has already been built.
// Everything here is synthetic, including the separate four-row authored fall.
function ladderFixture(broadEnd = 'top') {
  const w = 24, h = 18, data = new Int16Array(w * h * 4), flags = new Int16Array(8192); flags[0] = 16;
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  flags[8146] = flags[8144] = flags[8152] = 15;
  flags[996] = flags[1004] = 32;
  for (let x = 3; x <= 16; x++) {
    for (let y = 2; y <= 4; y++) set(x, y, 0, 1567);
    for (let y = 5; y <= 8; y++) set(x, y, 0, y === 5 ? 8146 : y === 8 ? 8152 : 8144);
    for (let y = 9; y <= 15; y++) set(x, y, 0, 1567);
  }
  for (let x = 6; x <= 10; x++) set(x, broadEnd === 'top' ? 5 : 8, 2, 528);
  for (let y = 5; y <= 8; y++) set(8, y, 2, y === 5 ? 996 : 1004);
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: Array(9).fill(''), flags: { data: flags } });
  const options = { analysisOnly: true, floorHints: [[3, 2, 16, 4, 4, 4], [3, 9, 16, 15, 0, 0]],
    falls: [{ x: 15, y: 5, dir: 1, n: 4 }] };
  return { grid, data, flags, options };
}

for (const end of ['top', 'bottom']) test(`a continued ladder joins its ${end} sloping landing at the facing edge, not its center`, async t => {
  await environment(t); const f = ladderFixture(end), source = f.data.slice(), flags = f.flags.slice();
  const mesh = await buildMapMesh(f.grid, f.options);
  close(mesh.floorAt(8, 4.500001), 4);
  for (let y = 5; y <= 8; y++) {
    close(mesh.floorAt(8, y - 0.499999), 9 - y);
    close(mesh.floorAt(8, y + 0.499999), 8 - y);
    close(mesh.floorAt(8, y + 0.499999), mesh.floorAt(8, y + 0.500001));
    assert.equal(mesh.isSolid(8, y), false); assert.equal(mesh.isPit(8, y), false);
    assert.equal(f.grid.isLadder(8, y), true);
  }
  close(mesh.floorAt(8, 9), 0); close(mesh.floorAt(15, 4) - mesh.floorAt(15, 9), 4);
  assert.equal(mesh.isPit(15, 5), true, 'the genuine fall must retain its drop');
  assert.equal(mesh.isSolid(5, 7), true, 'a wall beside the ladder must remain a wall');
  assert.deepEqual(f.data, source); assert.deepEqual(f.flags, flags);
});
