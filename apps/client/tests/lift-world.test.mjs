import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { GameCharacter } from '../src/entities/character.js';
import { CharacterSprite } from '../src/entities/sprites.js';
import { PlayerChar } from '../src/world/gamemap.js';
import { MapGrid, T, buildMapMesh } from '../src/world/mapmesh.js';
import { isLyingTile } from '../src/entities/lying.js';
import { analyzeMap, liftRoute, throughRock, reachableCells } from '../src/world/mapanalysis.js';
import { buildMapView, meshHintOptions } from '../src/world/mapbuild.js';
import { LiftRide } from '../src/world/lift.js';

function environment(t) {
  const saved = { ...G }, document = Object.getOwnPropertyDescriptor(globalThis, 'document'), common = $data.commonEvents;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 32, height: 32, getContext: () => new Proxy({
      getImageData(_x, _y, w, h) { const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) data.set([112, 120, 132, 255], i); return { data }; },
    }, { get: (object, key) => key in object ? object[key] : () => {} }),
  }) } });
  $data.commonEvents = [];
  t.after(() => { Object.assign(G, saved); $data.commonEvents = common;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  return initAssets();
}
const command = (code, ...parameters) => ({ code, parameters });
function route(dir = 1, n = 9, prefix = [command(37), command(29, 3)]) {
  return { repeat: false, skippable: false, wait: false, list: [...prefix, ...Array.from({ length: n }, () => command(dir)), command(0)] };
}
function fixture() {
  const w = 13, h = 18, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  flags[0] = 16; flags[8000] = 15;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[x + y * w] = y >= 4 && y <= 11 ? 8000 : 2816;
  const page = list => ({ trigger: 0, priority_type: 0, through: false, condition: {},
    graphic: { character_name: '', tile_id: 0 }, list });
  const top = { id: 1, x: 6, y: 3, pages: [page([command(205, -1, route()), command(0)]), page([command(0)])] };
  const bottom = { id: 2, x: 6, y: 12, pages: [page([command(205, -1, route(4)), command(0)])] };
  const map = { width: w, height: h, data: { data }, events: new Map([[1, top], [2, bottom]]), note: '', parallax_name: '', parallax_show: false };
  const grid = new MapGrid(map, { flags: { data: flags }, tileset_names: Array(9).fill('') });
  return { map, grid, events: [...map.events.values()], flags, data };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);

test('lift routes require an authored slow vertical through run, not fast falls or unrelated movement', () => {
  assert.deepEqual(liftRoute(route()), { dir: 1, n: 9 });
  assert.deepEqual(liftRoute(route(4, 12, [command(29, 3)]), true), { dir: 4, n: 12 });
  assert.equal(liftRoute(route(1, 7)), null);
  assert.equal(liftRoute(route(1, 9, [command(37), command(29, 6)])), null);
  assert.equal(liftRoute(route(1, 9, [])), null);
  assert.equal(liftRoute(route(1, 9, [command(37), command(38)])), null);
  assert.equal(liftRoute({ list: [...route(1, 4).list.slice(0, -1), command(2), ...route(1, 4, []).list] }), null);
  assert.equal(liftRoute({}), null);
});

test('rock checks reject open corridors and routes beyond the original map', () => {
  const f = fixture();
  assert.equal(throughRock(f.grid, 6, 3, { dir: 1, n: 9 }), true);
  assert.equal(throughRock(f.grid, 6, 12, { dir: 4, n: 9 }), true);
  assert.equal(throughRock(f.grid, 6, 12, { dir: 1, n: 9 }), false);
  assert.equal(throughRock(f.grid, 6, 0, { dir: 1, n: 9 }), false);
});

test('all native pages contribute one merged shaft; riding connects reachable landings without altering passage', async t => {
  await environment(t); const f = fixture(), source = f.data.slice(), flags = f.flags.slice();
  const analysis = analyzeMap(f.map, f.grid, event => event.pages.at(-1));
  assert.deepEqual(analysis.lifts, [{ x: 6, yTop: 3, yBottom: 12 }]);
  assert.equal(analysis.falls.length, 0);
  const walk = reachableCells(f.map, f.grid, analysis, [[6, 14]]);
  assert.equal(walk.reach[6 + 2 * f.grid.w], 1, 'original carry reaches the upper landing');
  for (let y = 4; y <= 11; y++) assert.equal(f.grid.anyPassable(6, y), false);
  assert.deepEqual(f.data, source); assert.deepEqual(f.flags, flags);
});

test('real map builder slopes the carried path between both landings while retaining neighboring rock and original collision', async t => {
  await environment(t); const f = fixture(), source = f.data.slice(), flags = f.flags.slice();
  const { mesh, ana } = await buildMapView({ ...f, mapId: 9999, pageOf: event => event.pages.at(-1), seeds: [[6, 14]], extra: { analysisOnly: true } });
  assert.equal(ana.lifts.length, 1); assert.equal(mesh.stats.falls.edges, 1);
  near(mesh.floorAt(6, 3), 9); near(mesh.floorAt(6, 12), 0);
  for (const x of [4, 6, 8]) {
    let last = mesh.floorAt(x, 3.5);
    for (let y = 3.55; y <= 11.5; y += 0.05) {
      const height = mesh.floorAt(x, y);
      assert.ok(height <= last + 1e-5); assert.ok(last - height < 0.08, 'no vertical jump within a moving platform ride');
      last = height;
    }
    for (let y = 4; y <= 11; y++) { assert.equal(mesh.isSolid(x, y), false); assert.equal(mesh.isPit(x, y), false); }
  }
  assert.equal(mesh.isSolid(1, 7), true, 'rock outside the actual platform footprint remains solid');
  for (let y = 4; y <= 11; y++) assert.equal(f.grid.anyPassable(6, y), false);
  assert.deepEqual(f.data, source); assert.deepEqual(f.flags, flags);
});

test('lift lifecycle holds a broken mid-shaft stop and ends at a native landing or owner replacement', async t => {
  await environment(t); const f = fixture(), player = new PlayerChar(), platform = new GameCharacter(), lift = new LiftRide();
  Object.assign(G, { state: {}, map: { ...f, mapId: 9, playerChar: player, grid: f.grid }, lift });
  player.x = player.realX = 6; player.y = player.realY = 7;
  lift.ride(player, platform, { dir: 1, n: 9 });
  assert.equal(lift.riding, true); assert.equal(lift.carries(platform), true);
  lift.update(); assert.equal(lift.riding, true, 'a stopped original route can deliberately leave the lift inside rock');
  player.y = player.realY = 12; player.moveRouteForcing = true;
  lift.update(); assert.equal(lift.riding, true);
  player.moveRouteForcing = false; lift.update(); assert.equal(lift.riding, false);
  lift.ride(player, null, { dir: 4, n: 9 }); assert.equal(lift.riding, true);
  G.state = {}; assert.equal(lift.riding, false); lift.update(); assert.equal(lift.trip, null);
  lift.ride(player, platform, { dir: 1, n: 9 }); G.map.playerChar = new PlayerChar();
  assert.equal(lift.riding, false); lift.update(); assert.equal(lift.trip, null);
});

test('real PlayerChar route matches only a nearby forced platform and preserves scene speed bookkeeping', async t => {
  await environment(t); const f = fixture(), player = new PlayerChar(), platform = new GameCharacter(), lift = new LiftRide();
  player.x = player.realX = 6; player.y = player.realY = 3;
  Object.assign(platform, { x: 6, y: 3, moveRouteForcing: true, moveRoute: route() });
  Object.assign(G, { state: {}, map: { ...f, mapId: 9, playerChar: player, eventList: [platform] }, lift, player: { startScriptedFall() { assert.fail('slow lift is not a fall'); } } });
  const snapshot = { revision: 0, speed: 4 };
  player.forceMoveRoute(route(), snapshot);
  assert.equal(lift.carries(platform), true); assert.equal(player.moveRouteForcing, true); assert.equal(player.sceneMoveSpeed, snapshot);
  assert.equal(player.moveSpeedRevision, 0);
  lift.end(); platform.x = 10; player.forceMoveRoute(route());
  assert.equal(lift.riding, true); assert.equal(lift.carries(platform), false, 'unrelated distant moving events never become the platform');
});

test('actual platform sprite bypasses rock projection during a ride and resumes its normal wall placement afterward', async t => {
  await environment(t); const f = fixture(), player = new PlayerChar(), platform = new GameCharacter(), lift = new LiftRide();
  Object.assign(platform, { isEvent: true, page: {}, characterName: '', tileId: 0, realX: 6, realY: 7, x: 6, y: 7 });
  const mapInfo = { spotOnSolid: () => ({ x: 6.5, z: 8, y: 20, side: 'S', ground: false }) };
  Object.assign(G, { state: {}, map: { ...f, mapId: 9, playerChar: player }, lift, player: { floorY: 4.25 }, floorAt: () => -20, combat: null, coop: null });
  const sprite = new CharacterSprite(platform, new THREE.Group(), mapInfo);
  sprite.key = sprite.graphicKey(); sprite.mode = 'stand'; sprite.info = { tile: true, object: true };
  sprite.mesh = new THREE.Mesh(new THREE.PlaneGeometry(T, T), new THREE.MeshBasicMaterial()); sprite.group.add(sprite.mesh);
  const viewer = new THREE.Vector3(4, 2, 20);
  sprite.place(viewer); near(sprite.group.position.y, 20 * T);
  lift.ride(player, platform, { dir: 1, n: 9 }); sprite.place(viewer);
  near(sprite.group.position.y, 4.25); near(sprite.group.position.z, 7.5 * T); assert.equal(sprite.spot, null);
  G.player.floorY = 2.5; sprite.place(viewer); near(sprite.group.position.y, 2.5);
  lift.end(); sprite.place(viewer); near(sprite.group.position.y, 20 * T);
  sprite.dispose();
});

test('university desk and table source art lies down while unrelated sheets and native counters remain unchanged', () => {
  const names = Array(9).fill(''); names[5] = 'tileb_interior';
  for (const tile of [84, 103, 160, 211, 226, 233]) assert.equal(isLyingTile(tile, names), true);
  for (const tile of [83, 86, 230, 256 + 84]) assert.equal(isLyingTile(tile, names), false);
  assert.equal(isLyingTile(84, Array(9).fill('other')), false);
  const f = fixture(), table = 2816 + 15 * 48;
  f.data[6 + 14 * f.grid.w] = table; f.flags[table] = 15;
  f.grid.tileset.tileset_names[1] = 'TileA2_interior';
  assert.equal(f.grid.isTableTop(6, 14), true); assert.equal(f.grid.isCounter(6, 14), false);
  assert.equal(f.grid.anyPassable(6, 14), false);
  f.grid.tileset.tileset_names[1] = 'OtherFloor';
  assert.equal(f.grid.isTableTop(6, 14), false);
});

test('generic source-marked wide stairs share the measured landing height and never override measured fork flights', async t => {
  await environment(t); const f = fixture();
  // A separate three-wide stair joins the same landings as the synthetic lift.
  for (let x = 1; x <= 3; x++) for (let y = 4; y <= 11; y++) f.data[x + y * f.grid.w] = 1536 + 32;
  const make = fallStairs => buildMapMesh(f.grid, { analysisOnly: true, lifts: [{ x: 6, yTop: 3, yBottom: 12 }], stairs: [32], fallStairs });
  const mesh = await make([]);
  for (const x of [1, 2, 3]) { near(mesh.floorAt(x, 3), 9); near(mesh.floorAt(x, 12), 0);
    for (let y = 4; y <= 11; y++) near(mesh.floorAt(x, y), 9 * (11.5 - y) / 8);
  }
  assert.deepEqual(meshHintOptions(155).stairs, [32, 33, 34, 40, 41, 42]);
  assert.deepEqual(meshHintOptions(155).fallStairs, [[30, 14, 32, 21, 7], [30, 5, 32, 11, 7]]);
});

test('whole-object hints can collect an upper wall row without swallowing the floor foot or altering native tiles', async t => {
  await environment(t); const f = fixture();
  // One three-row object: its upper piece overlaps a wall; its lower piece is
  // already a free-standing prop. The lowest wall-stage artwork stays put.
  f.data[5 + 11 * f.grid.w + 2 * f.grid.w * f.grid.h] = 100;
  f.data[5 + 12 * f.grid.w + 2 * f.grid.w * f.grid.h] = 108;
  f.data[5 + 13 * f.grid.w + 2 * f.grid.w * f.grid.h] = 116;
  for (const id of [100, 108, 116]) f.flags[id] = 16;
  const before = f.data.slice();
  const mesh = await buildMapMesh(f.grid, { analysisOnly: true, whole: [[5, 11, 5, 13, 'all']] });
  const joined = mesh.stacks.find(stack => stack.x === 5 && stack.y === 13);
  assert.ok(joined); assert.deepEqual(joined.tiles, [116, 108, 100]);
  assert.equal(joined.elev, 0); assert.equal(mesh.isSolid(5, 11), true);
  assert.deepEqual(f.data, before);
});

test('wall-position hints mount a gallows attachment relative to its original floor and only the named rectangle', async t => {
  await environment(t); const f = fixture(), hints = [[5, 11, 5, 11, 1.125, 1]];
  const mesh = await buildMapMesh(f.grid, { onWall: hints });
  t.after(() => mesh.dispose());
  assert.deepEqual(mesh.spotOnSolid(5, 11, false), { x: 5.5, y: 1.125, z: 13, side: 'S', ground: false });
  assert.notDeepEqual(mesh.spotOnSolid(6, 11, false), mesh.spotOnSolid(5, 11, false));
  assert.equal(mesh.spotOnSolid(5, 11, true).side, 'top', 'flat floor props keep their existing top placement');
  assert.deepEqual(meshHintOptions(24).whole.at(-1), [4, 11, 8, 13, 'all']);
});
