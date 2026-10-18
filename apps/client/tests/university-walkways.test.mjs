import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { GameState } from '../src/game/state.js';
import { Player } from '../src/entities/player.js';
import { GameMap } from '../src/world/gamemap.js';
import { MapGrid, T } from '../src/world/mapmesh.js';
import { buildMapView, meshHintOptions } from '../src/world/mapbuild.js';

async function environment(t) {
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document'), commonEvents = $data.commonEvents;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 32, height: 32, getContext: () => new Proxy({
      getImageData(_x, _y, w, h) { const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) data.set([130, 120, 90, 255], i); return { data }; },
    }, { get: (object, key) => key in object ? object[key] : () => {} }),
  }) } });
  $data.commonEvents = [];
  t.after(() => { $data.commonEvents = commonEvents;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}

// Synthetic rooms, a lower landing, a seven-row fall and three-wide stairs.
// They exercise the original command analysis and production map-view builder;
// no original map, script or artwork is distributed as a fixture.
function university() {
  const w = 64, h = 35, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  flags[0] = 16; flags[8000] = flags[6608] = flags[6256] = flags[5792] = 15;
  const set = (x, y, tile) => { data[x + y * w] = tile; };
  const rectangle = (x0, y0, x1, y1, tile) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, tile);
  };
  rectangle(26, 22, 56, 32, 2816); rectangle(13, 29, 56, 32, 2816);
  rectangle(13, 12, 56, 13, 2816); rectangle(13, 14, 25, 21, 2816);
  rectangle(26, 0, 56, 11, 8000); rectangle(30, 0, 32, 4, 6608);
  rectangle(29, 14, 33, 18, 6256); rectangle(26, 19, 56, 21, 5792);
  for (let x = 30; x <= 32; x++) for (const [y0, y1] of [[5, 11], [14, 21]]) {
    for (let y = y0; y <= y1; y++) set(x, y, 1568 + x - 30);
  }
  rectangle(54, 9, 54, 11, 1595); set(54, 8, 1536);
  const events = new Map();
  for (const x of [15, 18, 22]) {
    set(x, 22, 2816);
    const id = events.size + 1;
    events.set(id, { id, x, y: 22, pages: [{ condition: {}, trigger: 1, priority_type: 0, through: false,
      graphic: { character_name: '', tile_id: 0 }, list: [{ code: 205, parameters: [-1, { list: [
        { code: 37, parameters: [] }, { code: 29, parameters: [6] },
        ...Array.from({ length: 7 }, () => ({ code: 1, parameters: [] })), { code: 0, parameters: [] },
      ] }] }, { code: 0, parameters: [] }] }] });
  }
  const map = { width: w, height: h, data: { data }, events, note: '', parallax_name: '', parallax_show: false };
  const names = Array(9).fill(''); names[4] = 'evilcastle_A5';
  const grid = new MapGrid(map, { tileset_names: names, flags: { data: flags } });
  return { map, grid, events: [...events.values()], data, flags };
}
async function view(fixture, mapId = 155, extra = {}) {
  return buildMapView({ ...fixture, mapId, pageOf: event => event.pages[0], seeds: [[31, 23]], extra });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} should equal ${expected}`);

test('original fall commands place the gallery seven tiles up while the hall and lower landing remain at zero', async t => {
  await environment(t); const fixture = university(), source = fixture.data.slice(), flags = fixture.flags.slice();
  const { mesh, ana } = await view(fixture, 155, { analysisOnly: true });
  assert.equal(ana.falls.length, 3); assert.ok(ana.falls.every(fall => fall.n === 7));
  assert.equal(mesh.stats.falls.edges, 3); near(mesh.floorAt(18, 21), 7);
  near(mesh.floorAt(31, 12), 7); near(mesh.floorAt(31, 23), 0); near(mesh.floorAt(18, 29), 0);
  assert.ok(mesh.isPit(18, 22), 'the original fall trigger remains a drop');
  assert.deepEqual(fixture.data, source); assert.deepEqual(fixture.flags, flags);
});

test('the complete three-wide flight continuously joins both landings and retains original passage', async t => {
  await environment(t); const fixture = university(), { mesh } = await view(fixture, 155, { analysisOnly: true });
  for (const x of [30, 31, 32]) {
    for (let y = 14; y <= 21; y++) {
      assert.equal(fixture.grid.anyPassable(x, y), true); assert.equal(mesh.isSolid(x, y), false);
      assert.equal(mesh.isPit(x, y), false); near(mesh.floorAt(x, y), 7 * (21.5 - y) / 8);
    }
    let previous = mesh.floorAt(x, 13);
    for (let y = 13.05; y <= 22.05; y += 0.05) {
      const height = mesh.floorAt(x, y);
      assert.ok(height <= previous + 1e-5); assert.ok(previous - height < 0.05, 'no vertical step may cut across the route');
      previous = height;
    }
    near(previous, 0);
  }
});

test('rendered wall triangles never span the central stair while the side walls remain closed', async t => {
  await environment(t); const fixture = university(), { mesh } = await view(fixture);
  t.after(() => mesh.dispose()); const cx = 31.5 * T;
  for (const child of mesh.group.children) {
    const geometry = child.geometry, positions = geometry?.getAttribute('position');
    if (!positions) continue;
    const index = geometry.index, count = index ? index.count : positions.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const ids = [k, k + 1, k + 2].map(i => index ? index.getX(i) : i);
      const xs = ids.map(i => positions.getX(i)), ys = ids.map(i => positions.getY(i)), zs = ids.map(i => positions.getZ(i));
      if (Math.max(...xs) <= cx || Math.min(...xs) >= cx || Math.max(...ys) - Math.min(...ys) < 0.1) continue;
      if (Math.max(...zs) - Math.min(...zs) > 1e-5 || zs[0] <= 14 * T || zs[0] >= 22 * T) continue;
      assert.fail('an upright wall triangle crosses the original walkable stair');
    }
  }
  assert.equal(mesh.isSolid(29, 17), true); assert.equal(mesh.isSolid(33, 17), true);
  assert.equal(fixture.grid.anyPassable(29, 17), false); assert.equal(fixture.grid.anyPassable(33, 17), false);
});

test('the upper flight and small exit stair rise from the actual gallery without opening blocked corridor tiles', async t => {
  await environment(t); const fixture = university(), { mesh } = await view(fixture, 155, { analysisOnly: true });
  near(mesh.floorAt(31, 11), 7.5); near(mesh.floorAt(31, 5), 13.5);
  near(mesh.floorAt(54, 11), 7.5); near(mesh.floorAt(54, 9), 9.5); near(mesh.floorAt(54, 8), 10);
  assert.equal(fixture.grid.anyPassable(31, 3), false); assert.equal(mesh.isSolid(31, 3), true);
});

test('unlisted maps retain existing fall inference and a blocked stair cannot become a walkable opening', async t => {
  await environment(t); const fixture = university(), original = await view(fixture, 999, { analysisOnly: true });
  near(original.mesh.floorAt(31, 12), original.mesh.floorAt(31, 23));
  for (const id of [1, 154, 156, 184, 999]) assert.equal(meshHintOptions(id).fallStairs, null);
  fixture.flags[1569] = 15;
  const blocked = await view(fixture, 155, { analysisOnly: true });
  assert.equal(fixture.grid.anyPassable(31, 18), false); assert.equal(blocked.mesh.isSolid(31, 18), true);
});

test('actual Player movement crosses the full flight uphill and downhill through original GameMap collision', async t => {
  await environment(t); const previous = { ...G };
  t.after(() => Object.assign(G, previous));
  const fixture = university(), { mesh, walk } = await view(fixture, 155, { analysisOnly: true });
  let direction = -1;
  Object.assign(G, {
    vr: false, state: new GameState(), scripts: {}, view: { mesh, walk }, arena: null, coop: null,
    combat: null, emotes: null, audio: null, time: 1, floorAt: (x, y) => mesh.floorAt(x, y) * T,
    settings: { moveSpeed: 3, runMultiplier: 1.5, vrSpeed: 2, eyeHeight: 1.6, snapTurn: true },
    input: { mouse: { dx: 0, dy: 0 }, moveVector: () => ({ x: 0, y: direction }), running: () => false,
      dodge: () => false, jumpPressed: () => false, interact: () => false, turnAxis: () => 0 },
    ui: { menuOpen: false, consumedConfirm: false, messageBusy: () => false },
  });
  G.state.party.leader = () => ({ hp: 100 });
  const map = G.map = new GameMap(); map.mapId = 155; map.map = fixture.map; map.grid = fixture.grid;
  map.blockedCells = new Set(walk.blocked);
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  const player = G.player = new Player(rig, camera); player.teleportTo(31, 23);
  const step = () => { G.time += 1 / 60; player.update(1 / 60); rig.updateMatrixWorld(true); };
  const traverse = (end, uphill) => {
    let lastY = map.playerChar.fy;
    for (let frame = 0; frame < 400 && (uphill ? lastY > end : lastY < end); frame++) {
      step(); const { fx, fy } = map.playerChar;
      assert.ok(uphill ? fy < lastY : fy > lastY, 'original tile edges must not stop walking on the flight');
      assert.ok(Math.abs(fx - 31) < 1e-8, 'the three-wide passage must not push the player sideways');
      assert.ok(Math.abs(player.floorY - G.floorAt(fx, fy)) < 0.2, 'the rig follows the sloping floor without an artificial step');
      assert.equal(player.fallV, 0, 'walking down the continuous slope must not trigger a fall');
      lastY = fy;
    }
    assert.ok(uphill ? lastY <= end : lastY >= end, 'the landing must be reached with normal movement');
    direction = 0; for (let frame = 0; frame < 60; frame++) step();
  };
  traverse(12.1, true); near(player.floorY, 7 * T);
  direction = 1; traverse(23, false); near(player.floorY, 0);
  assert.equal(map.playerEdgePassable(31, 18, 8), true);
  assert.equal(map.playerEdgePassable(30, 18, 4), false, 'the flanking original wall remains blocked');
});
