import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { GameMap } = await import('../src/world/gamemap.js');
const { GameEvent } = await import('../src/entities/character.js');
const { MapGrid, T } = await import('../src/world/mapmesh.js');
const { TransferMarkers } = await import('../src/world/markers.js');
const { collectCurrentExits } = await import('../src/world/exit-routes.js');

const transfer = mapId => ({ code: 201, parameters: [0, mapId, 1, 1, 2, 0] });
const end = { code: 0, parameters: [] };
function page(list, condition = {}, trigger = 0) {
  return { condition, trigger, list: [...list, end],
    graphic: { character_name: '', character_index: 0, tile_id: 0, direction: 2, pattern: 1 },
    move_type: 0, move_speed: 4, move_frequency: 3, move_route: { list: [end] }, priority_type: 0,
    walk_anime: false, step_anime: false, direction_fix: false, through: false };
}
function canvas() {
  const ctx = new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, getContext: () => ctx };
}
function environment(t, pages = [page([]), page([transfer(2)], { switch1_valid: true, switch1_id: 10 })]) {
  const before = { ...G }, commonEvents = $data.commonEvents, mapInfos = $data.mapInfos;
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, before); $data.commonEvents = commonEvents; $data.mapInfos = mapInfos;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  const switches = new Set(), floorCalls = []; let meshRebuilds = 0;
  G.state = { sw: id => switches.has(id), v: () => 0, selfSw: () => false, party: { actors: [], hasItem: () => false } };
  G.combat = null; G.coop = null; G.time = 0; G.arena = null;
  G.onMapTilesChanged = () => meshRebuilds++;
  G.floorAt = (x, y) => { floorCalls.push([x, y]); return (x + y) / 10; };
  $data.commonEvents = []; $data.mapInfos = new Map();
  const map = G.map = new GameMap(); map.mapId = 1; map.loading = true;
  const data = new Int16Array(6 * 6 * 4); data.fill(1, 0, 36);
  const raw = { width: 6, height: 6, data: { data }, note: '', events: new Map() };
  const flags = new Int16Array(8192); flags[0] = 16;
  map.map = raw; map.grid = new MapGrid(raw, { flags: { data: flags } });
  const original = { id: 1, x: 1, y: 1, pages }; raw.events.set(1, original);
  const event = new GameEvent(1, original); map.events[1] = event; map.eventList = [event]; map.loading = false;
  map.playerChar.fx = map.playerChar.fy = 1;
  const markers = new TransferMarkers(new THREE.Scene());
  t.after(() => { markers.clear(); markers.ringTex.dispose(); markers.colTex.dispose(); });
  return { map, event, original, switches, markers, floorCalls, meshRebuilds: () => meshRebuilds };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should equal ${expected}`);

test('an initially locked exit appears after its real event page unlocks without rebuilding world geometry', t => {
  const { map, switches, markers, meshRebuilds } = environment(t);
  assert.deepEqual(collectCurrentExits(map), []); markers.build([]);
  switches.add(10); map.requestRefresh(); map.refresh();
  const exits = collectCurrentExits(map);
  assert.equal(exits.length, 1); assert.equal(exits[0].mapId, 2); assert.equal(exits[0].label, 'Area 2');
  markers.build(exits); assert.equal(markers.update(0.1, new THREE.Vector3()), false);
  assert.equal(markers.items[0].root.visible, true); assert.equal(markers.items[0].label.visible, true);
  assert.equal(meshRebuilds(), 0, 'a transfer-only page change must not require a tile/collision mesh rebuild');
});

test('exit revisions ignore map-loading setup but record later real page transitions without tile rebuilds', t => {
  const { map, event, switches, meshRebuilds } = environment(t);
  assert.equal(map.exitRevision, 0);
  map.loading = true; switches.add(10); map.refresh();
  assert.equal(collectCurrentExits(map).length, 1, 'loading still selects the actual active event page');
  assert.equal(map.exitRevision, 0, 'initial loading is handled by the initial map presentation');
  map.loading = false; map.refresh(); assert.equal(map.exitRevision, 0, 'refreshing an unchanged active page does not bump the revision');
  switches.delete(10); map.refresh(); assert.equal(map.exitRevision, 1);
  map.refresh(); assert.equal(map.exitRevision, 1);
  switches.add(10); map.refresh(); assert.equal(map.exitRevision, 2);
  event.moveto(4, 3); assert.equal(map.exitRevision, 2, 'runtime movement is detected by marker updates rather than pretending the page changed');
  event.erase(); assert.equal(map.exitRevision, 3);
  assert.equal(meshRebuilds(), 0);
});

test('repeated inactive and erased event refreshes do not rebuild stable exit markers', t => {
  const { map, event, switches, meshRebuilds } = environment(t, [page([transfer(2)], { switch1_valid: true, switch1_id: 10 })]);
  assert.equal(event.page, null);
  for (let i = 0; i < 20; i++) { map.requestRefresh(); map.refresh(); }
  assert.equal(map.exitRevision, 0, 'an unchanged null page is not a route transition');
  switches.add(10); map.refresh(); assert.equal(map.exitRevision, 1);
  event.erase(); assert.equal(map.exitRevision, 2);
  for (let i = 0; i < 20; i++) { map.requestRefresh(); map.refresh(); }
  assert.equal(map.exitRevision, 2, 'an erased page must not keep invalidating the marker collection');
  assert.deepEqual(collectCurrentExits(map), []); assert.equal(meshRebuilds(), 0);
});

test('locked, erased and changed-destination pages immediately hide stale circles before refreshing their collection', t => {
  const { map, event, switches, markers } = environment(t, [page([]),
    page([transfer(2)], { switch1_valid: true, switch1_id: 10 }),
    page([transfer(3)], { switch1_valid: true, switch1_id: 11 })]);
  switches.add(10); map.refresh(); markers.build(collectCurrentExits(map));
  switches.delete(10); map.refresh();
  assert.equal(markers.update(0.1, new THREE.Vector3()), true); assert.equal(markers.items[0].root.visible, false);
  assert.deepEqual(collectCurrentExits(map), []); markers.build([]); assert.equal(markers.update(0.1), false);
  switches.add(10); map.refresh(); markers.build(collectCurrentExits(map));
  switches.add(11); map.refresh(); assert.equal(markers.update(0.1), true); assert.equal(markers.items[0].root.visible, false);
  const redirected = collectCurrentExits(map); assert.equal(redirected[0].mapId, 3);
  markers.build(redirected); assert.equal(markers.update(0.1), false); assert.equal(markers.items[0].root.visible, true);
  event.erase(); assert.equal(markers.update(0.1), true); assert.equal(markers.items[0].root.visible, false);
  assert.deepEqual(collectCurrentExits(map), []);
});

test('moving exit events follow runtime coordinates, floor height and nearest loop copies without changing source events', t => {
  const { map, event, original, markers, floorCalls } = environment(t, [page([transfer(2)])]);
  const exits = collectCurrentExits(map); markers.build(exits); event.moveto(4, 3);
  assert.equal(markers.update(0.1), true);
  assert.deepEqual(collectCurrentExits(map).map(exit => [exit.x, exit.y]), [[4, 3]]);
  assert.deepEqual([original.x, original.y], [1, 1]); assert.deepEqual([exits[0].x, exits[0].y], [1, 1]);
  let root = markers.items[0].root;
  near(root.position.x, 4.5 * T); near(root.position.z, 3.5 * T); near(root.position.y, 0.7 + 0.06);
  assert.deepEqual(floorCalls.at(-1), [4, 3], 'floor sampling uses tile-centre coordinates, with no half-cell offset');
  assert.equal(markers.update(0.1), false, 'a stable event must not request a refresh each frame');
  map.loopX = map.loopY = true; map.playerChar.fx = 15; map.playerChar.fy = -4;
  markers.update(0.1); root = markers.items[0].root;
  near(root.position.x, (map.nearX(4, 15) + 0.5) * T); near(root.position.z, (map.nearY(3, -4) + 0.5) * T);
  near(root.position.y, 0.76);
});

test('boss arenas suppress exits, distance affects only labels and old-map circles cannot leak through transfers', t => {
  const { map, markers } = environment(t, [page([transfer(2)])]);
  G.arena = { active: true }; markers.build(collectCurrentExits(map));
  assert.equal(markers.group.visible, false); assert.equal(markers.update(0.1), false);
  G.arena.active = false; markers.update(0.1); assert.equal(markers.group.visible, true);
  const marker = markers.items[0]; assert.equal(marker.label.visible, true);
  map.playerChar.fx = map.playerChar.fy = 5; markers.update(0.1);
  assert.equal(marker.root.visible, true); assert.equal(marker.label.visible, false);
  assert.equal(marker.ring.material.depthTest, true, 'terrain still occludes floor markers normally');
  assert.equal(marker.ring.material.depthWrite, false);
  map.mapId = 9; markers.update(0.1); assert.equal(markers.group.visible, false);
});

test('region exits retain original analysis rules and script-only or death-common-event routes are not invented', t => {
  const { map, event, markers } = environment(t, [page([{ code: 117, parameters: [3] }])]);
  $data.commonEvents[3] = { list: [transfer(2), end] }; // Existing NOT_EXIT_CE exclusion.
  $data.commonEvents[4] = { list: [transfer(3), end] };
  map.map.note = 'RCE:1,4,0'; map.grid.data[3 * 36] = 1 << 8;
  let exits = collectCurrentExits(map); assert.equal(exits.length, 1); assert.equal(exits[0].kind, 'region');
  assert.deepEqual([exits[0].x, exits[0].y, exits[0].mapId], [0, 0, 3]);
  event.setupPage(page([{ code: 355, parameters: ['$game_player.reserve_transfer(2, 1, 1)'] }]));
  exits = collectCurrentExits(map); assert.equal(exits.length, 1); assert.equal(exits[0].kind, 'region');
  markers.build(exits); assert.equal(markers.items.length, 1);
  assert.equal(markers.update(0.1), false);
});

test('rebuilding marker-only visuals disposes old per-marker resources while keeping shared ring art alive', t => {
  const { map, markers } = environment(t, [page([transfer(2)])]); markers.build(collectCurrentExits(map));
  const marker = markers.items[0]; let geometries = 0, materials = 0, labelTextures = 0, sharedTextures = 0;
  marker.ring.geometry.addEventListener('dispose', () => geometries++); marker.column.geometry.addEventListener('dispose', () => geometries++);
  for (const object of [marker.ring, marker.column, marker.label]) object.material.addEventListener('dispose', () => materials++);
  marker.label.material.map.addEventListener('dispose', () => labelTextures++);
  markers.ringTex.addEventListener('dispose', () => sharedTextures++); markers.colTex.addEventListener('dispose', () => sharedTextures++);
  markers.build(collectCurrentExits(map));
  assert.equal(geometries, 2); assert.equal(materials, 3); assert.equal(labelTextures, 1); assert.equal(sharedTextures, 0);
  assert.equal(markers.items.length, 1); assert.equal(markers.group.children.length, 1);
});
