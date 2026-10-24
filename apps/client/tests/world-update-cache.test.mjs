import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { TransferMarkers } from '../src/world/markers.js';
import { layoutTilePictures } from '../src/entities/sprites.js';

const transfer = (mapId = 2, mode = 0) => ({ code: 201, parameters: [mode, mapId, 1, 2, 2, 0] });
const call = id => ({ code: 117, parameters: [id] });
function environment(t) {
  const before = { ...G }, commonEvents = $data.commonEvents;
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }) }, { get: (object, key) => object[key] || (() => {}) });
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  G.map = { mapId: 1, exitRevision: 0, width: 8, events: {}, playerChar: { fx: 1, fy: 1 },
    grid: { valid: (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 }, nearX: x => x, nearY: y => y };
  G.floorAt = (x, y) => (x + y) / 10; G.arena = null; G.time = 0;
  $data.commonEvents = [];
  const markers = new TransferMarkers(new THREE.Scene());
  t.after(() => {
    markers.clear(); markers.ringTex.dispose(); markers.colTex.dispose();
    Object.assign(G, before); $data.commonEvents = commonEvents;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  return markers;
}
function eventMarker(markers, list, mapId = 2) {
  const event = { x: 1, y: 1, erased: false, page: { trigger: 0, list } };
  G.map.events[1] = event;
  markers.build([{ kind: 'event', eventId: 1, x: 1, y: 1, mapId, trigger: 0 }]);
  return event;
}
function countedList(length = 200) {
  let reads = 0;
  const list = Array.from({ length }, () => ({ get code() { reads++; return 0; }, parameters: [] }));
  list.push(transfer());
  return { list, reads: () => reads };
}

test('unchanged active exit pages avoid rescanning commands while floor and moving-event placement remain live', t => {
  const markers = environment(t), counted = countedList();
  const event = eventMarker(markers, counted.list);
  assert.equal(markers.update(0.1), false);
  const reads = counted.reads(); assert.ok(reads >= 200);
  for (let i = 0; i < 30; i++) { G.time += 0.01; assert.equal(markers.update(0.01), false); }
  assert.equal(counted.reads(), reads, 'stable page analysis must not reread hundreds of unrelated commands per frame');
  event.x = 4; event.y = 3;
  assert.equal(markers.update(0.1), true);
  assert.equal(markers.items[0].root.position.x, 6.75);
  assert.equal(markers.items[0].root.position.y, 0.76);
  assert.equal(counted.reads(), reads, 'moving an exit does not alter its native command list');
  G.floorAt = () => 7; markers.update(0.1);
  assert.equal(markers.items[0].root.position.y, 7.06, 'geometry-height changes remain visible without route analysis');
});

test('exit caches follow page/list replacement, revision, direct parameter edits and erased/locked pages', t => {
  const markers = environment(t), counted = countedList();
  const event = eventMarker(markers, counted.list);
  markers.update(0.1); const initial = counted.reads();
  G.map.exitRevision++; markers.update(0.1); assert.ok(counted.reads() > initial);
  counted.list.at(-1).parameters[1] = 3;
  assert.equal(markers.update(0.1), true); assert.equal(markers.items[0].root.visible, false);
  counted.list.at(-1).parameters[1] = 2; markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  event.page = { trigger: 0, list: [transfer(3)] };
  markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  event.page.list = [transfer(2)]; markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  event.page.list = []; markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  event.page.list.push(transfer(2)); markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  event.erased = true; markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  event.erased = false; event.page.trigger = 4; markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
});

test('common-event exits invalidate for table, entry, list and nested fall-check dependency replacements', t => {
  const markers = environment(t), counted = countedList();
  $data.commonEvents[4] = { list: counted.list };
  eventMarker(markers, [call(4)]); markers.update(0.1);
  const reads = counted.reads(); for (let i = 0; i < 10; i++) markers.update(0.1);
  assert.equal(counted.reads(), reads, 'unchanged common-event bodies are analyzed once');
  $data.commonEvents[4] = { list: [transfer(3)] };
  markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  $data.commonEvents[4].list = [transfer(2)]; markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  $data.commonEvents = []; markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  $data.commonEvents[4] = { list: [call(5), transfer(2)] };
  $data.commonEvents[5] = { list: [call(6)] }; $data.commonEvents[6] = { list: [] };
  markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  const route = [{ code: 37, parameters: [] }, { code: 32, parameters: [] },
    ...Array.from({ length: 5 }, () => ({ code: 1, parameters: [] }))];
  $data.commonEvents[6].list = [{ code: 205, parameters: [-1, { list: route }] }];
  markers.update(0.1); assert.equal(markers.items[0].root.visible, false, 'a newly authored nested fall is not a usable exit');
  route.at(-1).code = 0; markers.update(0.1); assert.equal(markers.items[0].root.visible, true, 'changed movement-route parameters are not cached as a fall');
  route.at(-1).code = 1; markers.update(0.1); assert.equal(markers.items[0].root.visible, false);
  $data.commonEvents[6].list = []; markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  $data.commonEvents[7] = { list: [{ code: 205, parameters: [-1, { list: route }] }] };
  $data.commonEvents[5].list[0].parameters[0] = 7;
  markers.update(0.1); assert.equal(markers.items[0].root.visible, false, 'changing a called common-event id refreshes its fall dependencies');
});

test('variable-mode transfer markers retain unresolved native map zero rather than caching variable values', t => {
  const markers = environment(t), command = transfer(9, 1);
  G.state = { v: () => 2 };
  eventMarker(markers, [command], 0); markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  G.state.v = () => 3; markers.update(0.1); assert.equal(markers.items[0].root.visible, true);
  command.parameters[0] = 0; command.parameters[1] = 2;
  markers.update(0.1); assert.equal(markers.items[0].root.visible, false, 'changing the native transfer mode invalidates analysis');
});

function picture(x = 1, y = 1, tileId = 1) {
  return { ch: { isEvent: true, x, y, tileId, priorityType: 1, through: false },
    mesh: {}, hiddenNow: false, mode: 'stand' };
}
function pictures(t) {
  const previous = G.map; t.after(() => { G.map = previous; }); G.map = { width: 8 };
  let joins = 0;
  const mapInfo = { isWall: () => false, joinsBelow: () => true,
    joinsBeside: () => { joins++; return true; }, tilesetNames: [] };
  return { list: [picture(), picture(2)], mapInfo, joins: () => joins };
}

test('unchanged tile pictures retain assembly without allocating grouping Maps or serializing coordinates', t => {
  const { list, mapInfo, joins } = pictures(t);
  layoutTilePictures(list, mapInfo);
  const groups = list.map(s => s.tp), joined = joins(); let allocations = 0, coordinateReads = 0;
  for (const sprite of list) { const x = sprite.ch.x; Object.defineProperty(sprite.ch, 'x', { configurable: true,
    get() { coordinateReads++; return x; } }); }
  const NativeMap = globalThis.Map;
  globalThis.Map = class extends NativeMap { constructor(...args) { super(...args); allocations++; } };
  try { for (let i = 0; i < 20; i++) layoutTilePictures(list, mapInfo); }
  finally { globalThis.Map = NativeMap; }
  assert.deepEqual(list.map(s => s.tp), groups); assert.equal(joins(), joined);
  assert.equal(allocations, 0, 'the unchanged path needs no lookup/grouping Map');
  assert.equal(coordinateReads, 40, 'each eligible coordinate is checked once, with no serialized layout key');
});

test('tile picture replacement and new artwork of identical metadata receive fresh assembly ownership', t => {
  const { list, mapInfo } = pictures(t); layoutTilePictures(list, mapInfo);
  const removed = list[1]; list[1] = picture(2); layoutTilePictures(list, mapInfo);
  assert.equal(list[1].tp?.n, 2); assert.equal(list[1].tp.c, 1);
  assert.equal(removed.tp, null, 'retired members do not retain the old assembly');
  list[0].tp = null; list[0].mesh = {}; layoutTilePictures(list, mapInfo);
  assert.equal(list[0].tp?.n, 2, 'late or rebuilt artwork must rejoin even when event metadata is unchanged');
  list[1].ch = { ...list[1].ch }; layoutTilePictures(list, mapInfo);
  assert.equal(list[1].tp?.c, 1);
});

test('tile picture disappearance, mode, movement and width changes regroup without stale links', t => {
  const { list, mapInfo } = pictures(t); layoutTilePictures(list, mapInfo);
  list[1].hiddenNow = true; layoutTilePictures(list, mapInfo);
  assert.ok(list.every(s => s.tp === null));
  list[1].hiddenNow = false; layoutTilePictures(list, mapInfo); assert.equal(list[1].tp?.n, 2);
  for (const s of list) s.mode = 'over'; layoutTilePictures(list, mapInfo);
  assert.ok(list.every(s => s.tp?.lift === 1.9));
  list[1].ch.x = 4; layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp === null));
  list[1].ch.x = 2; layoutTilePictures(list, mapInfo); assert.equal(list[1].tp?.n, 2);
  G.map.width = 2; layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp === null), 'adjacency must respect the current map width');
});

test('mapInfo replacement and modified grouping methods invalidate tile picture geometry decisions', t => {
  const { list, mapInfo } = pictures(t); layoutTilePictures(list, mapInfo);
  const wallInfo = { ...mapInfo, isWall: () => true };
  layoutTilePictures(list, wallInfo); assert.ok(list.every(s => s.tp === null));
  wallInfo.isWall = () => false; layoutTilePictures(list, wallInfo); assert.equal(list[0].tp?.n, 2);
  wallInfo.joinsBeside = () => false; layoutTilePictures(list, wallInfo); assert.ok(list.every(s => s.tp === null));
  wallInfo.joinsBeside = () => true; layoutTilePictures(list, wallInfo); assert.equal(list[0].tp?.n, 2);
  G.map = { width: 8 }; list[0].tp = null; layoutTilePictures(list, wallInfo); assert.equal(list[0].tp?.n, 2);
});

test('picture blocking metadata and in-place tileset identities update physical assembly depth and furniture', t => {
  const { mapInfo } = pictures(t);
  const list = [...Array.from({ length: 5 }, (_, i) => picture(i + 1, 2)),
    ...Array.from({ length: 5 }, (_, i) => picture(i + 1, 1))];
  layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp?.d === 2 && s.tp.fixed));
  list[5].ch.through = true; layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp?.d === 1));
  list[5].ch.through = false; list[5].ch.priorityType = 0;
  mapInfo.tileFlag = () => 0; layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp?.d === 1));
  mapInfo.tileFlag = () => 15; layoutTilePictures(list, mapInfo); assert.ok(list.every(s => s.tp?.d === 2));
  const furniture = [picture(1, 1, 58)]; layoutTilePictures(furniture, mapInfo); assert.equal(furniture[0].tp, null);
  mapInfo.tilesetNames[5] = 'Inside_B'; layoutTilePictures(furniture, mapInfo); assert.equal(furniture[0].tp?.fixed, true);
  mapInfo.tilesetNames[5] = 'OtherSheet'; layoutTilePictures(furniture, mapInfo); assert.equal(furniture[0].tp, null);
  mapInfo.tilesetNames[5] = 'Inside_B'; layoutTilePictures(furniture, mapInfo); assert.equal(furniture[0].tp?.fixed, true);
  furniture[0].ch.tileId = 1; layoutTilePictures(furniture, mapInfo); assert.equal(furniture[0].tp, null);
});
