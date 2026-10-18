import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, T } from '../src/world/mapmesh.js';
import { buildMapView } from '../src/world/mapbuild.js';
import { completePassagePockets, gradePassageChains } from '../src/world/passage-grades.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { Player } from '../src/entities/player.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);
async function environment(t) {
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document'), common = $data.commonEvents;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 32, height: 32,
    getContext: () => new Proxy({ getImageData(_x, _y, w, h) { const data = new Uint8ClampedArray(w * h * 4); data.fill(255); return { data }; } },
      { get: (object, key) => key in object ? object[key] : () => {} }),
  }) } });
  $data.commonEvents = [];
  t.after(() => { $data.commonEvents = common;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}

// Two real endpoint rooms and a winding corridor that widens twice. The
// authored twelve-row fall independently fixes the height of both endpoints.
// No source map, artwork or script is included in this synthetic fixture.
function wideningPassage(pocket = false) {
  const w = 40, h = 26, data = new Int16Array(w * h * 4), flags = new Int16Array(8192); flags[0] = 16;
  const rect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[x + y * w] = 2816; };
  rect(15, 0, 30, 4); rect(15, 17, 30, 24);
  rect(23, 5, 23, 5); rect(20, 6, 25, 11); rect(23, 12, 23, 12);
  rect(20, 13, 24, 15); rect(20, 16, 21, 16); rect(16, 5, 16, 5);
  if (pocket) { rect(31, 3, 32, 3); rect(32, 4, 32, 6); rect(33, 5, 33, 5); }
  const event = { id: 1, x: 16, y: 5, pages: [{ condition: {}, trigger: 1, priority_type: 0, through: false,
    graphic: { character_name: '', tile_id: 0 }, list: [{ code: 205, parameters: [-1, { list: [
      { code: 37, parameters: [] }, { code: 29, parameters: [6] },
      ...Array.from({ length: 12 }, () => ({ code: 1, parameters: [] })), { code: 0, parameters: [] },
    ] }] }, { code: 0, parameters: [] }] }] };
  const map = { width: w, height: h, data: { data }, events: new Map([[1, event]]), note: '', parallax_name: '' };
  const grid = new MapGrid(map, { tileset_names: Array(9).fill(''), flags: { data: flags } });
  return { map, grid, events: [event], flags, data };
}

test('production map builder distributes a false single-row wall over the entire widening walkway while retaining the real fall', async t => {
  await environment(t); const fixture = wideningPassage(), source = fixture.data.slice(), flags = fixture.flags.slice();
  const { mesh, ana } = await buildMapView({ ...fixture, mapId: 999, pageOf: e => e.pages[0], seeds: [[23, 20]], extra: { analysisOnly: true } });
  assert.equal(ana.falls.length, 1); assert.equal(ana.falls[0].n, 12); assert.equal(mesh.stats.falls.edges, 1);
  close(mesh.floorAt(23, 4), 12); close(mesh.floorAt(23, 17), 0);
  close(mesh.floorAt(16, 4) - mesh.floorAt(16, 17), 12); assert.equal(mesh.isPit(16, 5), true);
  for (let y = 5; y <= 16; y++) for (let x = 20; x <= 25; x++) {
    if (!fixture.grid.anyPassable(x, y)) continue;
    assert.equal(mesh.isSolid(x, y), false); assert.equal(mesh.isPit(x, y), false);
    close(mesh.floorAt(x, y), 16.5 - y);
    close(mesh.floorAt(x, y - 0.49999), 17 - y - 0.00001);
    close(mesh.floorAt(x, y + 0.49999), 16 - y + 0.00001);
  }
  // Every shared original passage edge now has matching surface heights,
  // including sideways steps through both temporarily widened sections.
  for (let y = 4; y <= 17; y++) for (let x = 20; x <= 25; x++) for (const [dx, dy, dir] of [[1, 0, 6], [0, 1, 2]]) {
    if (!fixture.grid.passable(x, y, dir) || !fixture.grid.passable(x + dx, y + dy, 10 - dir)) continue;
    const edgeX = x + dx / 2, edgeY = y + dy / 2;
    close(mesh.floorAt(edgeX - dx * 1e-6, edgeY - dy * 1e-6), mesh.floorAt(edgeX + dx * 1e-6, edgeY + dy * 1e-6));
  }
  assert.deepEqual(fixture.data, source); assert.deepEqual(fixture.flags, flags);
});

test('real Player movement climbs and descends both widening sections without a wall collision, step or false fall', async t => {
  await environment(t); const previous = { ...G }; t.after(() => Object.assign(G, previous));
  const fixture = wideningPassage(), { mesh, walk } = await buildMapView({ ...fixture, mapId: 999,
    pageOf: event => event.pages[0], seeds: [[20, 19]], extra: { analysisOnly: true } });
  let movement = { x: 0, y: 0 };
  Object.assign(G, {
    vr: false, state: new GameState(), scripts: {}, view: { mesh, walk }, arena: null, coop: null,
    combat: null, emotes: null, audio: null, time: 1, floorAt: (x, y) => mesh.floorAt(x, y) * T,
    settings: { moveSpeed: 3, runMultiplier: 1.5, vrSpeed: 2, eyeHeight: 1.6, snapTurn: true },
    input: { mouse: { dx: 0, dy: 0 }, moveVector: () => movement, running: () => false,
      dodge: () => false, jumpPressed: () => false, interact: () => false, turnAxis: () => 0 },
    ui: { menuOpen: false, consumedConfirm: false, messageBusy: () => false },
  });
  G.state.party.leader = () => ({ hp: 100 });
  const map = G.map = new GameMap(); map.mapId = 999; map.map = fixture.map; map.grid = fixture.grid;
  map.blockedCells = new Set(walk.blocked);
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  const player = G.player = new Player(rig, camera); player.teleportTo(20, 19);
  const step = () => {
    G.time += 1 / 60; player.update(1 / 60); rig.updateMatrixWorld(true);
    assert.ok(Math.abs(player.floorY - G.floorAt(map.playerChar.fx, map.playerChar.fy)) < 0.25,
      'the body follows the whole passage rather than jumping at a temporarily narrow row');
    assert.equal(player.fallV, 0);
  };
  const go = (x, y) => {
    for (let frame = 0; frame < 450; frame++) {
      const dx = x - map.playerChar.fx, dy = y - map.playerChar.fy;
      if (Math.hypot(dx, dy) < 0.02) { movement = { x: 0, y: 0 }; return; }
      movement = { x: Math.abs(dx) > 0.02 ? Math.sign(dx) : 0, y: Math.abs(dy) > 0.02 ? Math.sign(dy) : 0 };
      const before = Math.hypot(dx, dy); step();
      assert.ok(Math.hypot(x - map.playerChar.fx, y - map.playerChar.fy) < before,
        'real GameMap/player edge collision must allow the original route');
    }
    assert.fail('the original landing must be reachable with normal walking');
  };
  go(20, 14); go(23, 14); go(23, 3);
  for (let frame = 0; frame < 60; frame++) step(); close(player.floorY, 12 * T);
  go(23, 14); go(20, 14); go(20, 19);
  for (let frame = 0; frame < 60; frame++) step(); close(player.floorY, 0);
  assert.equal(map.playerEdgePassable(23, 12, 8), true);
  assert.equal(map.playerEdgePassable(20, 16, 4), false, 'repair must not open the impassable side of the passage');
  assert.equal(mesh.isPit(16, 5), true); close(mesh.floorAt(16, 4) - mesh.floorAt(16, 17), 12);
});

test('actual map building places a sideways-only grass alcove at its adjoining raised path height', async t => {
  await environment(t); const fixture = wideningPassage(true);
  const { mesh } = await buildMapView({ ...fixture, mapId: 999, pageOf: event => event.pages[0],
    seeds: [[23, 20]], extra: { analysisOnly: true } });
  assert.equal(fixture.grid.passable(32, 5, 6), true); assert.equal(fixture.grid.passable(33, 5, 4), true);
  close(mesh.floorAt(32, 5), 12); close(mesh.floorAt(33, 5), 12);
  close(mesh.floorAt(32.5 - 1e-6, 5), mesh.floorAt(32.5 + 1e-6, 5));
  close(mesh.floorAt(16, 4) - mesh.floorAt(16, 17), 12);
  assert.equal(fixture.grid.anyPassable(33, 4), false); assert.equal(fixture.grid.anyPassable(33, 6), false);
});

function pocket() {
  const w = 5, h = 3, node = new Int32Array(w * h).fill(-1), resolved = new Uint8Array(w * h),
    floor = new Float32Array(w * h), north = new Float32Array(w * h), south = new Float32Array(w * h), slope = new Uint8Array(w * h);
  const cells = new Set([6, 7, 8]), protectedCells = new Set();
  for (const [i, id] of [[6, 0], [8, 1]]) { node[i] = id; resolved[i] = 1; floor[i] = north[i] = south[i] = -2; }
  const options = { w, h, node, resolved, walk: i => cells.has(i),
    link: (x, y, dx, dy) => cells.has(x + y * w) && cells.has(x + dx + (y + dy) * w),
    protectedCell: i => protectedCells.has(i), floor, north, south, slope };
  return { options, cells, protectedCells };
}

test('an unambiguous original-passable narrow pocket inherits the common boundary height and preserves both rooms', () => {
  const e = pocket(); assert.equal(completePassagePockets(e.options), 1);
  assert.deepEqual([...e.options.floor.slice(6, 9)], [-2, -2, -2]); assert.equal(e.options.resolved[7], 1);
  assert.equal(completePassagePockets(e.options), 0);
});

for (const kind of ['mixed levels', 'sloped boundary', 'profile', 'blocked edge', 'unresolved room']) test(`pocket completion preserves ${kind} instead of guessing a new connection`, () => {
  const e = pocket();
  if (kind === 'mixed levels') e.options.floor[8] = e.options.north[8] = e.options.south[8] = 3;
  if (kind === 'sloped boundary') { e.options.north[6] = -1; e.options.south[6] = -3; e.options.slope[6] = 1; }
  if (kind === 'profile') e.protectedCells.add(7);
  if (kind === 'blocked edge') e.options.link = () => false;
  if (kind === 'unresolved room') e.options.resolved[8] = 0;
  const before = [e.options.floor.slice(), e.options.north.slice(), e.options.south.slice()];
  assert.equal(completePassagePockets(e.options), 0);
  assert.deepEqual([e.options.floor, e.options.north, e.options.south], before);
});

function chain() {
  const w = 9, h = 16, node = new Int32Array(w * h).fill(-1), cells = new Set();
  const floor = new Float32Array(w * h), north = new Float32Array(w * h), south = new Float32Array(w * h), slope = new Uint8Array(w * h);
  const fill = (id, x0, y0, x1, y1, height) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = x + y * w; node[i] = id; cells.add(i); floor[i] = north[i] = south[i] = height;
    }
  };
  fill(0, 1, 0, 7, 1, 10); fill(1, 3, 3, 5, 5, 10); fill(2, 2, 7, 4, 9, 10); fill(3, 1, 11, 7, 14, 0);
  const runs = [{ x: 4, y0: 2, y1: 2, top: 0, bot: 1, ladder: false, rise: null },
    { x: 4, y0: 6, y1: 6, top: 1, bot: 2, ladder: false, rise: null },
    { x: 3, y0: 10, y1: 10, top: 2, bot: 3, ladder: false, rise: null }];
  for (const run of runs) for (let y = run.y0; y <= run.y1; y++) {
    const i = run.x + y * w; cells.add(i); floor[i] = 5; north[i] = 10; south[i] = 0; slope[i] = 1;
  }
  const protectedCells = new Set();
  const options = { w, h, node, runs, anchored: new Set([0, 3]), walk: i => cells.has(i),
    link: (x, y, dx, dy) => cells.has(x + y * w) && cells.has(x + dx + (y + dy) * w),
    protectedCell: i => protectedCells.has(i), floor, north, south, slope };
  return { options, protectedCells, cells, index: (x, y) => x + y * w };
}

test('only unanchored passage interiors are graded; fixed endpoint rooms remain byte-for-byte unchanged', () => {
  const e = chain(), { floor, north, south } = e.options;
  assert.equal(gradePassageChains(e.options), 1);
  close(north[e.index(4, 2)], 10); close(south[e.index(3, 10)], 0);
  for (let i = 0; i < floor.length; i++) if ([0, 3].includes(e.options.node[i])) {
    const expected = e.options.node[i] === 0 ? 10 : 0; close(floor[i], expected); close(north[i], expected); close(south[i], expected);
  }
  assert.equal(gradePassageChains(e.options), 0, 'the same corridor cannot be repeatedly stretched');
});

for (const kind of ['ladder', 'profile', 'anchored', 'branch']) test(`${kind} authority prevents a passage repair from inventing a route or replacing explicit heights`, () => {
  const e = chain();
  if (kind === 'ladder') e.options.runs[1].ladder = true;
  if (kind === 'profile') e.protectedCells.add(e.index(4, 4));
  if (kind === 'anchored') { e.options.anchored.add(1); e.options.anchored.add(2); }
  if (kind === 'branch') {
    const i = e.index(6, 4); e.cells.add(i); e.options.node[i] = 4;
    // An extra original horizontal passage is absent from the vertical-run
    // graph, so the geometric boundary guard must conservatively reject it.
  }
  const before = [e.options.floor.slice(), e.options.north.slice(), e.options.south.slice()];
  assert.equal(gradePassageChains(e.options), 0);
  assert.deepEqual([e.options.floor, e.options.north, e.options.south], before);
});
