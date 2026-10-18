import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Player } from '../src/entities/player.js';
import { GameEvent } from '../src/entities/character.js';
import { GameMap } from '../src/world/gamemap.js';
import { eventActionPosition } from '../src/entities/event-position.js';
import { T } from '../src/world/mapmesh.js';

function environment(t) {
  const previous = { ...G }; t.after(() => Object.assign(G, previous));
  const awards = [];
  Object.assign(G, { vr: true, coop: null, combat: null, arena: null,
    ui: { menuOpen: false, sceneOpen: false, messageBusy: () => false },
    state: { sw: () => false, party: { gainItem: (...args) => awards.push(args) } },
    input: { controllers: {} },
  });
  const map = G.map = new GameMap();
  map.mapId = 5; map.grid = { w: 12, h: 8, isCounter: () => false };
  map.playerChar.fx = 0; map.playerChar.fy = 0; map.playerChar.direction = 2;
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera);
  const player = G.player = new Player(rig, camera);
  const ray = new THREE.Object3D();
  ray.position.set(0.5 * T + 0.3, 1.1, 0.5 * T);
  ray.rotation.y = -Math.PI / 2; ray.updateMatrixWorld(true);
  G.input.controllers.right = { ray };
  const add = (x, y, priority = 0, list = [{ code: 126, indent: 0, parameters: [1, 0, 0, 1] }, { code: 0, indent: 0, parameters: [] }]) => {
    const page = { condition: {}, graphic: { tile_id: 0, character_name: '!Flame', character_index: 0, direction: 2, pattern: 1 },
      move_type: 0, move_speed: 3, move_frequency: 3, priority_type: priority, trigger: 0, list };
    const ev = new GameEvent(map.mapId, { id: map.eventList.length + 1, x, y, pages: [page] });
    map.events[ev.id] = ev; map.eventList.push(ev); return ev;
  };
  return { map, player, ray, add, awards };
}

test('event action positions follow rendered supports, reject invalid positions and use the nearest loop copy', t => {
  const { map } = environment(t);
  const ev = { realX: 8, realY: 7, viewPos: { x: 1.5 * T, y: 0.7, z: 2.5 * T } };
  assert.deepEqual(eventActionPosition(ev), { x: 1, y: 2 });
  ev.viewPos.x = NaN; assert.deepEqual(eventActionPosition(ev), { x: 8, y: 7 });
  ev.realX = Infinity; assert.equal(eventActionPosition(ev), null);
  map.loopX = map.loopY = true; map.playerChar.fx = 11.8; map.playerChar.fy = 7.8;
  ev.viewPos = { x: 0.5 * T, z: 0.5 * T };
  assert.deepEqual(eventActionPosition(ev), { x: 12, y: 8 });
  assert.deepEqual(eventActionPosition(ev, map, { x: -0.2, y: -0.2 }), { x: 0, y: 0 });
});

test('VR controller aim selects the world item instead of unrelated loot underfoot, while desktop remains tile-first', t => {
  const { player, add } = environment(t), underfoot = add(0, 0), pointed = add(1, 0);
  assert.equal(player.tryAction(), true);
  assert.equal(pointed.starting, true); assert.equal(underfoot.starting, false);
  assert.equal(G.map.playerChar.direction, 6);
  pointed.starting = pointed.locked = false;
  G.vr = false;
  assert.equal(player.tryAction(), true);
  assert.equal(underfoot.starting, true); assert.equal(pointed.starting, false);
});

test('the action cone reaches a nearby rendered support instead of its distant logical cell and preserves reach limits', t => {
  const { player, add, map } = environment(t), ev = add(3, 0);
  ev.viewPos = { x: 1.5 * T, y: 0.75, z: 0.5 * T };
  assert.equal(player.actionCone({ x: 1, z: 0 })?.ev, ev);
  assert.equal(player.startActionEvent(ev), true); assert.equal(map.playerChar.direction, 6);
  ev.starting = ev.locked = false;
  ev.viewPos.x = 3.5 * T; assert.equal(player.actionCone({ x: 1, z: 0 }), null);
  ev.viewPos = null; ev.realX = 1.5;
  assert.equal(player.actionCone({ x: 1, z: 0 }), null, 'below-priority items retain their 1.1-tile reach');
  ev.priorityType = 1; assert.equal(player.actionCone({ x: 1, z: 0 })?.ev, ev);
  ev.trigger = 1; assert.equal(player.actionCone({ x: 1, z: 0 }), null, 'the cone remains limited to action events');
});

test('below-priority loot dispatches its real event once, and only the original interpreter grants the item', t => {
  const { player, add, map, awards } = environment(t), ev = add(1, 0), second = add(0, 1);
  assert.equal(ev.normalPriority(), false);
  assert.equal(player.startActionEvent(ev), true);
  assert.equal(player.startActionEvent(ev), false, 'pending starts cannot be repeated');
  assert.equal(player.startActionEvent(second), false, 'a second hand cannot queue another event in the same frame');
  assert.deepEqual(awards, [], 'grabbing only starts the event');
  assert.equal(map.setupStartingEvent(), true); map.interpreter.update();
  assert.deepEqual(awards, [['item', 1, 1]]);
  assert.equal(player.startActionEvent(ev), false, 'the running event stays locked until the map releases it');
});

test('refused original starts return false, keep player direction and never activate unrelated tile loot', t => {
  const { player, add, map, awards } = environment(t), underfoot = add(0, 0), pointed = add(1, 0);
  let requested = 0;
  G.coop = { role: 'world', mayStart: () => { requested++; return false; } };
  assert.equal(player.tryAction(), false);
  assert.equal(requested, 1); assert.equal(pointed.starting, false); assert.equal(underfoot.starting, false);
  assert.equal(map.playerChar.direction, 2); assert.deepEqual(awards, []);
});

test('world action dispatch rejects stale, inactive, hidden, erased, locked, boss-blocked and busy events', t => {
  const { player, add, map } = environment(t), ev = add(1, 0);
  const reset = () => {
    ev.page = ev.event.pages[0]; ev.erased = ev.starting = ev.locked = false;
    G.combat = null; G.arena = null; G.coop = null;
    G.ui.menuOpen = G.ui.sceneOpen = false; G.ui.messageBusy = () => false;
    map.transferring = false; map.interpreter.terminate();
  };
  for (const block of [() => { ev.page = null; }, () => { ev.erased = true; }, () => { ev.locked = true; },
    () => { ev.starting = true; }, () => { G.combat = { hidesEvent: () => true }; },
    () => { G.arena = { blocksTrigger: () => true }; }, () => { G.ui.menuOpen = true; },
    () => { G.ui.sceneOpen = true; }, () => { G.ui.messageBusy = () => true; },
    () => { map.transferring = true; }, () => { map.interpreter.setup(ev.list); },
    () => { G.combat = { gripAdjust: {} }; },
  ]) {
    reset(); block(); assert.equal(player.startActionEvent(ev), false);
  }
  reset(); map.eventList = []; assert.equal(player.startActionEvent(ev), false, 'a previous-map object is never dispatched');
});

test('phantom aimed actions use the co-op authority path and honor refusal and hidden network events', t => {
  const { player, add, awards } = environment(t), underfoot = add(0, 0), pointed = add(1, 0);
  const requests = []; let accepts = true;
  G.coop = { phantom: true, phantomTouch: (events, how) => { requests.push({ events, how }); return accepts; } };
  assert.equal(player.askBossAction(), true);
  assert.deepEqual(requests, [{ events: [pointed], how: 'action' }]);
  assert.equal(pointed.starting, false); assert.equal(underfoot.starting, false); assert.deepEqual(awards, []);
  accepts = false; assert.equal(player.askBossAction(), false);
  pointed.net = { hidden: true }; assert.equal(player.startActionEvent(pointed), false);
  pointed.net = { gone: true }; assert.equal(player.startActionEvent(pointed), false);
  assert.equal(requests.length, 2);
});

test('looped controller targeting and logical facing agree across both map seams', t => {
  const { player, add, map, ray } = environment(t);
  map.loopX = map.loopY = true; map.playerChar.fx = 11.4; map.playerChar.fy = 7.4;
  ray.position.set(11.9 * T, 1.1, 7.9 * T); ray.rotation.y = -3 * Math.PI / 4; ray.updateMatrixWorld(true);
  const ev = add(0, 0); ev.viewPos = { x: 0.5 * T, y: 0, z: 0.5 * T };
  assert.equal(player.actionCone(player.aimDirection())?.ev, ev);
  assert.equal(player.startActionEvent(ev), true);
  assert.ok([2, 6].includes(map.playerChar.direction), 'the original script moves toward the nearby seam copy');
});
