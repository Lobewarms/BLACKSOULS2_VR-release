import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { meshHintOptions } from '../src/world/mapbuild.js';

async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) data.set([111, 85, 51, 255], i);
      return { data };
    } }, { get: (target, key) => key in target ? target[key] : () => {} }),
  }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}

function stairRooms({ blockedSide = 'north', bypassOpen = false } = {}) {
  const w = 12, h = 11, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const ground = 2816, northEdge = 2817, southEdge = 2818, roof = 5410, side = 5802, stair = 565;
  flags[0] = 16; flags[roof] = flags[side] = 15;
  flags[northEdge] = bypassOpen ? 0 : 1; // RPG Maker down passage bit.
  flags[southEdge] = bypassOpen ? 0 : 8; // RPG Maker up passage bit.
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  for (let x = 1; x <= 8; x++) {
    for (let y = 1; y <= 2; y++) set(x, y, 0, ground);
    for (let y = 7; y <= 9; y++) set(x, y, 0, ground);
  }
  for (let y = 3; y <= 6; y++) {
    set(7, y, 0, y % 2 ? roof : side); set(7, y, 2, stair);
    set(1, y, 0, ground);
  }
  // The two floors touch in the drawing beside their stairs, but the original
  // north floor's roof edge or the south floor's lip forbids crossing there.
  if (blockedSide === 'north') set(1, 6, 0, northEdge);
  else set(1, 7, 0, southEdge);
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: Array(9).fill(''), flags: { data: flags } });
  return { grid, data, flags };
}

function ladderGallery({ blockedRung = false } = {}) {
  const w = 16, h = 16, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const ground = 2816, roof = 5410, side = 5802, ladder = 236, broken = 237;
  flags[0] = 16; flags[roof] = flags[side] = 15;
  flags[ladder] = 32 | 2 | 4; flags[broken] = flags[ladder] | 8;
  const set = (x, y, z, tile) => { data[x + y * w + z * w * h] = tile; };
  // A decorative north wall one row tall and the south three-row ladder both
  // separate the same gallery/ground components. The actual climb is decisive.
  for (let x = 2; x <= 11; x++) {
    for (let y = 2; y <= 5; y++) set(x, y, 0, ground);
    set(x, 1, 0, side);
  }
  for (let x = 1; x <= 14; x++) for (let y = 10; y <= 14; y++) set(x, y, 0, ground);
  for (let y = 0; y <= 10; y++) set(14, y, 0, ground);
  for (let x = 2; x <= 14; x++) set(x, 0, 0, ground);
  for (let y = 6; y <= 9; y++) {
    set(7, y, 0, y === 6 ? roof : side);
    set(7, y, 2, blockedRung && y === 8 ? broken : ladder);
  }
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: Array(9).fill(''), flags: { data: flags } });
  return { grid, data, flags };
}

function passages(grid) {
  return Array.from({ length: grid.w * grid.h }, (_, i) => [2, 4, 6, 8].map(direction => grid.passable(i % grid.w, Math.floor(i / grid.w), direction)));
}

for (const blockedSide of ['north', 'south']) test(`stairs join distinct floors when the ${blockedSide} side forbids a painted bypass`, async t => {
  await environment(t); const { grid, data, flags } = stairRooms({ blockedSide });
  const originalData = data.slice(), originalFlags = flags.slice(), originalPassages = passages(grid);
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(217), analysisOnly: true });
  const top = mesh.floorAt(7, 2), bottom = mesh.floorAt(7, 7);
  assert.equal(top - bottom, 2, 'two original wall-side rows establish a two-tile climb');
  assert.equal(mesh.floorAt(7, 5), top - 1, 'middle roof cell is the landing between the two flights');
  for (let y = 2; y < 7; y++) {
    const north = mesh.floorAt(7, y + 0.5 - 1e-7), south = mesh.floorAt(7, y + 0.5 + 1e-7);
    assert.ok(Math.abs(north - south) < 1e-5, `shared stair edge ${y}/${y + 1} stays continuous`);
  }
  assert.equal(grid.passable(1, blockedSide === 'north' ? 6 : 7, blockedSide === 'north' ? 2 : 8), false);
  assert.equal(mesh.isSolid(7, 4), false); assert.equal(mesh.isSolid(7, 6), false);
  assert.deepEqual(passages(grid), originalPassages, 'rendering must not change any original passage direction');
  assert.deepEqual(data, originalData); assert.deepEqual(flags, originalFlags);
});

test('a genuinely passable bypass remains one flat floor component', async t => {
  await environment(t); const { grid } = stairRooms({ bypassOpen: true });
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(217), analysisOnly: true });
  assert.equal(grid.passable(1, 6, 2) && grid.passable(1, 7, 8), true);
  assert.equal(mesh.floorAt(7, 2), mesh.floorAt(7, 7), 'passage-aware grouping must not split a real flat route');
});

test('metal ladder joins the gallery and ground without a wall between its rungs', async t => {
  await environment(t); const { grid, data, flags } = ladderGallery();
  const originalData = data.slice(), originalFlags = flags.slice(), originalPassages = passages(grid);
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(282), analysisOnly: true });
  assert.equal(mesh.floorAt(7, 5) - mesh.floorAt(7, 10), 3, 'three climbable brick rows take precedence over the decorative back wall');
  for (let y = 5; y < 10; y++) {
    const north = mesh.floorAt(7, y + 0.5 - 1e-7), south = mesh.floorAt(7, y + 0.5 + 1e-7);
    assert.ok(Math.abs(north - south) < 1e-5, `shared ladder edge ${y}/${y + 1} stays continuous`);
  }
  for (let y = 6; y <= 9; y++) {
    assert.equal(grid.isLadder(7, y), true); assert.equal(mesh.isSolid(7, y), false);
    assert.equal(grid.passable(7, y, 2), true); assert.equal(grid.passable(7, y, 8), true);
    assert.equal(grid.passable(7, y, 4), false); assert.equal(grid.passable(7, y, 6), false);
  }
  assert.deepEqual(passages(grid), originalPassages); assert.deepEqual(data, originalData); assert.deepEqual(flags, originalFlags);
});

test('a blocked rung cannot claim a proven continuous climb', async t => {
  await environment(t); const { grid } = ladderGallery({ blockedRung: true });
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(282), analysisOnly: true });
  assert.equal(grid.passable(7, 8, 8), false);
  assert.equal(mesh.floorAt(7, 5) - mesh.floorAt(7, 10), -1, 'an interrupted route retains ordinary wall inference');
});

test('climb evidence does not change unopted map inference', async t => {
  await environment(t); const { grid } = ladderGallery();
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(999), analysisOnly: true });
  assert.equal(mesh.floorAt(7, 5) - mesh.floorAt(7, 10), -1);
});

test('passage-aware level inference is an explicit map opt-in', () => {
  assert.equal(meshHintOptions(217).passageLevels, true);
  assert.equal(meshHintOptions(282).passageLevels, true);
  for (const id of [0, 1, 31, 42, 155, 161, 309, 313, 999]) assert.notEqual(meshHintOptions(id).passageLevels, true);
});
