import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRController } from 'three/src/renderers/webxr/WebXRController.js';
import { G } from '../src/core/globals.js';
import { Player } from '../src/entities/player.js';
import { GameEvent } from '../src/entities/character.js';
import { GameMap } from '../src/world/gamemap.js';
import { eventActionPosition } from '../src/entities/event-position.js';
import { T } from '../src/world/mapmesh.js';
import { Coop } from '../src/network/coop.js';
import { $data } from '../src/data/data.js';

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

const fallbackTargets = [
  { label: 'below-priority door', x: 0, y: -1, priority: 0 },
  { label: 'nearby diagonal NPC', x: 1, y: -1, priority: 1 },
];
const invalidControllerPoses = [
  { label: 'lost tracking', invalidate(ray) {
    const controller = new WebXRController(), trackedRay = controller.getTargetRaySpace();
    trackedRay.position.copy(ray.position); trackedRay.quaternion.copy(ray.quaternion);
    trackedRay.updateMatrixWorld(true);
    const source = { handedness: 'right', targetRaySpace: {} };
    controller.update(source, { session: { visibilityState: 'visible' }, getPose: () => null }, {});
    assert.equal(trackedRay.visible, false, 'the real Three manager marks unavailable tracking');
    assert.deepEqual(trackedRay.position.toArray(), ray.position.toArray(), 'its previous pose remains stored');
    G.input.controllers.right = { ray: trackedRay };
  } },
  { label: 'nearly vertical pointing', invalidate(ray) {
    ray.rotation.set(Math.PI / 2 - 1e-8, Math.PI / 2, 0, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ray.quaternion);
    assert.ok(Math.hypot(forward.x, forward.z) < 1e-6 && forward.y > 0.999, 'the fixture points almost straight up');
  } },
  { label: 'invalid controller position', invalidate(ray) { ray.position.x = NaN; } },
  { label: 'invalid controller orientation', invalidate(ray) { ray.quaternion.set(NaN, 0, 0, 1); } },
];

for (const pose of invalidControllerPoses) for (const target of fallbackTargets) {
  test(`VR ${pose.label} uses head direction and player origin for a ${target.label}`, t => {
    const { player, ray, add, awards } = environment(t), ev = add(target.x, target.y, target.priority);
    // Neither the old sideways direction nor the distant hand origin can aim
    // at this target. Falling back only one half of the aim pair must fail.
    ray.position.set(0.5 * T, 1.1, -3.5 * T); ray.rotation.set(0, Math.PI / 2, 0);
    ray.updateMatrixWorld(true); pose.invalidate(ray); ray.updateMatrixWorld(true);
    const aim = player.interactionAim();
    assert.equal(aim.origin, null);
    assert.deepEqual(aim.direction, player.forward2D());
    assert.equal(player.actionCone(aim.direction)?.ev, ev, 'the default cone origin also uses validated tracking');
    assert.equal(player.tryAction(), true);
    assert.equal(ev.starting, true); assert.deepEqual(awards, [], 'only the authored event is queued');
  });
}

test('an explicit player-origin cone never reads a different valid controller origin', t => {
  const { player, ray, add } = environment(t), ev = add(1, -1, 1);
  ray.position.set(0.5 * T, 1.1, -3.5 * T); ray.updateMatrixWorld(true);
  assert.equal(player.actionCone(player.forward2D(), () => true, null)?.ev, ev);
});

test('VR aims across an original counter independently of headset yaw without extending other targets', t => {
  const { player, map, add } = environment(t), npc = add(2, 0, 1);
  assert.equal(player.facingDir(), 8, 'the headset faces north while the tracked controller points east');
  map.grid.isCounter = (x, y) => x === 1 && y === 0;
  assert.equal(player.tryAction(), true); assert.equal(npc.starting, true);
  assert.equal(map.playerChar.direction, 6, 'event movement faces the actual counter target');
  npc.starting = npc.locked = false;
  map.grid.isCounter = () => false;
  assert.equal(player.tryAction(), false); assert.equal(npc.starting, false, 'far targets need an authored intervening counter');
  map.grid.isCounter = (x, y) => x === 0 && y === -1;
  assert.equal(player.tryAction(), false); assert.equal(npc.starting, false, 'a counter in another direction does not extend reach');
});

test('controller counter reach preserves inactive and locked event pages and ordinary below-priority reach', t => {
  const { player, map, add } = environment(t), ev = add(2, 0, 1);
  map.grid.isCounter = (x, y) => x === 1 && y === 0;
  ev.page = null;
  assert.equal(player.tryAction(), false); assert.equal(ev.starting, false);
  ev.page = ev.event.pages[0]; ev.locked = true;
  assert.equal(player.tryAction(), false); assert.equal(ev.starting, false);
  ev.locked = false; ev.priorityType = 0;
  assert.equal(player.tryAction(), false); assert.equal(ev.starting, false, 'floor objects are not counter NPCs');
  ev.priorityType = 1;
  assert.equal(player.tryAction(), true); assert.equal(ev.starting, true);
});

for (const trigger of [1, 2]) test(`VR controller-facing tile fallback preserves original touch trigger ${trigger}`, t => {
  const { player, map, add } = environment(t), ev = add(1, 0, 1);
  ev.trigger = trigger;
  assert.equal(player.facingDir(), 8);
  assert.equal(player.actionCone(player.aimDirection()), null, 'touch pages do not become ranged action events');
  assert.equal(player.tryAction(), true); assert.equal(ev.starting, true);
  assert.equal(map.playerChar.direction, 6);
});

test('desktop phantom tile fallback skips guest-ineligible underfoot loot and reaches an eligible front exit', t => {
  const { player, add, map, awards } = environment(t), underfoot = add(0, 0);
  const front = add(0, -1, 1, [
    { code: 201, indent: 0, parameters: [0, 9, 3, 4, 6, 0] },
    { code: 0, indent: 0, parameters: [] },
  ]);
  const before = $data.mapInfos; t.after(() => { $data.mapInfos = before; });
  $data.mapInfos = new Map([[9, { name: 'Synthetic destination' }]]);
  t.mock.method(console, 'info', () => {});
  G.vr = false;
  const coop = G.coop = Object.assign(Object.create(Coop.prototype), {
    role: 'guest', summoned: true, spectating: false,
    localRules: { guestsFollow: false, guestStartsBoss: false },
  });
  const touch = t.mock.method(coop, 'phantomTouch', function (events, how) {
    return Coop.prototype.phantomTouch.call(this, events, how);
  });
  assert.equal(player.askBossAction(), true);
  assert.deepEqual(touch.mock.calls.map(call => call.arguments), [[[underfoot], 'action'], [[front], 'action']],
    'a rejected guest action does not mask the next original tile candidate');
  assert.deepEqual(map.transfer, { mapId: 9, x: 3, y: 4, dir: 6, fade: 0 });
  assert.equal(underfoot.starting, false); assert.equal(front.starting, false, 'phantom actions retain native co-op ownership');
  assert.deepEqual(awards, [], 'a guest cannot execute or claim the host world item');
});

test('VR tile fallback continues after a native authority refusal just as the original tile action does', t => {
  const { player, add, map, awards } = environment(t), underfoot = add(0, 0), front = add(1, 0, 1);
  front.trigger = 1;
  const attempts = [];
  G.coop = { role: 'world', mayStart: ev => { attempts.push(ev); return ev === front; } };
  assert.equal(player.actionCone(player.aimDirection()), null,
    'the controller points away from underfoot loot and touch pages stay outside the ranged cone');
  assert.equal(map.actionAt(0, 0, 1, 0), true, 'the original native tile path proceeds to the front after refusal');
  assert.deepEqual(attempts, [underfoot, front]);
  front.starting = front.locked = false; attempts.length = 0;
  assert.equal(player.tryAction(), true);
  assert.deepEqual(attempts, [underfoot, front]);
  assert.equal(underfoot.starting, false); assert.equal(front.starting, true);
  assert.equal(map.playerChar.direction, 6); assert.deepEqual(awards, []);
});
