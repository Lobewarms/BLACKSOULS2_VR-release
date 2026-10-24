import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { WorldPickup, hasPickupReward } from '../src/game/world-pickup.js';
import { GameEvent } from '../src/entities/character.js';
import { Player } from '../src/entities/player.js';
import { GameMap } from '../src/world/gamemap.js';

const command = (code, parameters = []) => ({ code, indent: 0, parameters });
const end = command(0);
function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const pulses = [], gains = [], pressed = new Set(['right']);
  Object.assign($data, { commonEvents: [], items: [null, null, null, { id: 3, name: 'Blood Vial', note: '' }] });
  Object.assign(G, { vr: true, xrAway: false, scripts: {}, coop: null, arena: null, emotes: null,
    state: new GameState(), combat: { engage: () => false }, view: { mesh: { group: new THREE.Group() } },
    ui: { menuOpen: false, sceneOpen: false, messageBusy: () => false, pointerBusy: () => false,
      notifyGain: (...args) => gains.push(args) },
  });
  const map = G.map = new GameMap(); map.mapId = 5;
  map.grid = { w: 100, h: 70, isCounter: () => false }; map.loading = true;
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera);
  G.player = new Player(rig, camera);
  const grip = new THREE.Group(); grip.position.set(1, 0.3, 0.8);
  const left = new THREE.Group(); left.position.set(5, 1, 5);
  G.input = { controllers: { right: { grip }, left: { grip: left } },
    grabPressed: hand => pressed.has(hand), haptic: (...args) => pulses.push(args) };
  const head = new THREE.Vector3(0.75, 1.6, 0.75), pickup = new WorldPickup();
  const add = (list = [command(126, [3, 0, 0, 1]), command(123, ['A', 0]), end]) => {
    const page = { condition: {}, graphic: { tile_id: 0, character_name: '!Flame', character_index: 0, direction: 2, pattern: 1 },
      move_type: 0, move_speed: 3, move_frequency: 3, priority_type: 0, trigger: 0, list };
    const collected = { ...page, condition: { self_switch_valid: true, self_switch_ch: 'A' },
      graphic: { ...page.graphic, character_name: '' }, list: [end] };
    const event = new GameEvent(5, { id: map.eventList.length + 2, x: 0, y: 0, name: 'Pickup', pages: [page, collected] });
    map.events[event.id] = event; map.eventList.push(event);
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), new THREE.MeshBasicMaterial());
    group.position.set(1, 0.2, 0.8); group.add(mesh);
    return { ch: event, group, mesh, hiddenNow: false, info: { object: true }, mode: 'stand', headDrop: 0, footDrop: 0 };
  };
  return { map, head, pickup, add, pressed, grip, left, pulses, gains };
}

test('a hospital-exterior style flame starts the real event, awards once and changes to its collected page', t => {
  const { map, pickup, head, add, pulses, gains } = environment(t), sprite = add();
  assert.equal(pickup.update([sprite], head), true);
  assert.deepEqual(pulses, [['right', 0.25, 45]]);
  assert.equal(G.state.party.itemCount('item', 3), 0, 'grip cannot grant inventory directly');
  assert.equal(pickup.update([sprite], head), false, 'no duplicate pending start');
  assert.equal(map.setupStartingEvent(), true); map.interpreter.update();
  assert.equal(G.state.party.itemCount('item', 3), 1);
  assert.deepEqual(gains, [['item', 3, 1]]);
  assert.equal(G.state.selfSw(5, sprite.ch.id, 'A'), true);
  sprite.ch.unlock(); sprite.ch.refresh();
  assert.equal(pickup.update([sprite], head), false);
  assert.equal(G.state.party.itemCount('item', 3), 1);
});

test('grips reach rendered table and loop-copy positions instead of distant logical cells', t => {
  const { pickup, head, add, grip } = environment(t), sprite = add();
  sprite.ch.realX = 94; sprite.ch.realY = 25;
  sprite.ch.viewPos = { x: 1, y: 0.8, z: 0.8 };
  sprite.group.position.set(1, 0.8, 0.8); grip.position.y = 0.9;
  assert.equal(pickup.update([sprite], head), true);
  sprite.ch.starting = sprite.ch.locked = false;
  sprite.group.position.x = 10; assert.equal(pickup.update([sprite], head), false);
});

test('a fresh grip edge is required and both hands can start at most one nearest item', t => {
  const { pickup, head, add, pressed, left, pulses } = environment(t), a = add(), b = add();
  pressed.clear(); assert.equal(pickup.update([a, b], head), false);
  left.position.copy(G.input.controllers.right.grip.position); pressed.add('left'); pressed.add('right');
  assert.equal(pickup.update([a, b], head), true);
  assert.equal([a, b].filter(s => s.ch.starting).length, 1); assert.equal(pulses.length, 1);
});

test('gripping preserves shields and held objects while allowing the weapon hand and an empty left hand', t => {
  const { pickup, head, add, pressed, left, grip } = environment(t), sprite = add();
  G.combat.weapon = { visible: true };
  assert.equal(pickup.update([sprite], head), true, 'right grip remains free with a weapon');
  sprite.ch.starting = sprite.ch.locked = false;
  G.combat.held = { hand: 'right' }; assert.equal(pickup.update([sprite], head), false);
  pressed.clear(); pressed.add('left'); left.position.copy(grip.position); G.combat.held = null;
  G.combat.shield = { visible: true }; assert.equal(pickup.update([sprite], head), false, 'shield grip guards');
  G.combat.shield.visible = false; assert.equal(pickup.update([sprite], head), true);
});

test('world and hand occlusion block grabs through solid walls without hidden-geometry false positives', t => {
  const { pickup, head, add } = environment(t), sprite = add();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  wall.position.set(1, 0.85, 0.8); G.view.mesh.group.add(wall);
  assert.equal(pickup.update([sprite], head), false);
  wall.visible = false; assert.equal(pickup.update([sprite], head), true);
});

test('grips reject remote or invalid tracking and the invisible padding above small flames', t => {
  const { pickup, head, add, grip } = environment(t), sprite = add();
  grip.position.y = 2.5; assert.equal(pickup.update([sprite], head), false);
  grip.position.y = NaN; assert.equal(pickup.update([sprite], head), false);
  grip.position.set(1, 0.3, 0.8); grip.visible = false;
  assert.equal(pickup.update([sprite], head), false); grip.visible = true;
  sprite.mesh.geometry.dispose(); sprite.mesh.geometry = new THREE.PlaneGeometry(0.2, 2);
  sprite.mesh.geometry.translate(0, 1, 0); sprite.headDrop = 1.7;
  grip.position.y = 1.3; assert.equal(pickup.update([sprite], head), false, 'transparent top is not pickup volume');
  grip.position.y = 0.3; assert.equal(pickup.update([sprite], head), true);
});

test('solid event doors and visible map-loop copies also block pickup reach', t => {
  const { pickup, head, add } = environment(t), sprite = add();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 4), new THREE.MeshBasicMaterial());
  wall.position.set(1, 0.85, 0.8);
  const door = { ch: { page: {}, through: false, normalPriority: () => true }, group: wall, hiddenNow: false };
  assert.equal(pickup.update([sprite, door], head), false);
  door.ch.through = true; assert.equal(pickup.update([sprite, door], head), true);
  sprite.ch.starting = sprite.ch.locked = false;
  G.view.loop = { copies: [{ obj: wall }] };
  assert.equal(pickup.update([sprite], head), false);
  wall.visible = false; assert.equal(pickup.update([sprite], head), true);
});

test('transparent texture holes and shader billboards never form invisible pickup barriers', t => {
  const { pickup } = environment(t), from = new THREE.Vector3(0, 0, 1), to = new THREE.Vector3(0, 0, -1);
  const image = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1); image.needsUpdate = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: image, alphaTest: 0.5, side: THREE.DoubleSide }));
  G.view.mesh.group.add(wall);
  assert.equal(pickup.clearPath(from, to), true, 'the ray crosses a pixel discarded by rendering');
  image.image.data[3] = 255; image.needsUpdate = true;
  assert.equal(pickup.clearPath(from, to), false, 'changed atlas pixels refresh the cached alpha');
  wall.geometry.setAttribute('center', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  assert.equal(pickup.clearPath(from, to), true, 'CPU billboard geometry is not an occluder');
  wall.geometry.deleteAttribute('center'); wall.material.opacity = 0;
  assert.equal(pickup.clearPath(from, to), true);
});

test('door alpha follows the current atlas UV transform even when cloned frames share image data', t => {
  const { pickup } = environment(t), from = new THREE.Vector3(0, 0, 1), to = new THREE.Vector3(0, 0, -1);
  const atlas = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]), 2, 1);
  atlas.repeat.x = 0.5; atlas.needsUpdate = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.4, side: THREE.DoubleSide }));
  G.view.mesh.group.add(wall);
  assert.equal(pickup.clearPath(from, to), true);
  const nextFrame = atlas.clone(); nextFrame.offset.x = 0.5; wall.material.map = nextFrame;
  assert.equal(pickup.clearPath(from, to), false, 'shared source pixels still use each frame texture transform');
});

test('busy UI, inactive events, hidden sprites, stale maps and occupied combat controls never collect', t => {
  const { pickup, head, add, map, pulses } = environment(t), sprite = add();
  const blocked = [
    ['vr', () => { G.vr = false; }, () => { G.vr = true; }],
    ['away', () => { G.xrAway = true; }, () => { G.xrAway = false; }],
    ['menu', () => { G.ui.menuOpen = true; }, () => { G.ui.menuOpen = false; }],
    ['pointer', () => { G.ui.pointerBusy = () => true; }, () => { G.ui.pointerBusy = () => false; }],
    ['scene', () => { G.ui.sceneOpen = true; }, () => { G.ui.sceneOpen = false; }],
    ['quick ring', () => { G.combat.quick = { isOpen: true }; }, () => { G.combat.quick = null; }],
    ['dead', () => { G.combat.playerDead = true; }, () => { G.combat.playerDead = false; }],
    ['aiming', () => { G.combat.ready = true; }, () => { G.combat.ready = false; }],
    ['erased', () => { sprite.ch.erased = true; }, () => { sprite.ch.erased = false; }],
    ['hidden', () => { sprite.hiddenNow = true; }, () => { sprite.hiddenNow = false; }],
    ['mesh hidden', () => { sprite.mesh.visible = false; }, () => { sprite.mesh.visible = true; }],
    ['faded', () => { sprite.mesh.material.opacity = 0; }, () => { sprite.mesh.material.opacity = 1; }],
    ['boss', () => { G.arena = { blocksTrigger: () => true }; }, () => { G.arena = null; }],
    ['stale map', () => { map.eventList = []; }, () => { map.eventList = [sprite.ch]; }],
  ];
  for (const [name, block, restore] of blocked) { block(); assert.equal(pickup.update([sprite], head), false, name); restore(); }
  assert.deepEqual(pulses, []); assert.equal(G.state.party.itemCount('item', 3), 0);
});

test('chests keep messages and choices, and co-op refusal never pretends to grant loot', t => {
  const { pickup, head, add, map, pulses } = environment(t);
  const list = [command(101, ['', 0, 0, 2]), command(401, ['Open the chest?']), command(102, [['Yes', 'No'], 1]), command(126, [3, 0, 0, 1]), end];
  const sprite = add(list); let requested = 0;
  G.coop = { role: 'world', mayStart: () => { requested++; return false; } };
  assert.equal(pickup.update([sprite], head), false); assert.equal(requested, 1); assert.deepEqual(pulses, []);
  G.coop = null; assert.equal(pickup.update([sprite], head), true);
  assert.equal(map.setupStartingEvent(), true);
  assert.equal(map.interpreter.list, list, 'all scripted messages and choices stay in their original order');
  assert.equal(G.state.party.itemCount('item', 3), 0);
});

test('only visible object loot qualifies; living NPC rewards and removal-only props stay normal interactions', t => {
  const { pickup, head, add } = environment(t), npc = add();
  npc.info.object = false; assert.equal(pickup.update([npc], head), false);
  const prop = add([command(126, [3, 1, 0, 1]), end]); assert.equal(pickup.update([prop], head), false);
  prop.ch.page = { ...prop.ch.page, list: [command(126, [3, 0, 0, 1]), end] };
  assert.equal(pickup.update([prop], head), true, 'new active pages invalidate cached eligibility');
});

test('loot detection follows common events safely and distinguishes positive rewards from removals', () => {
  for (const cmd of [command(125, [0, 0, 5]), command(126, [3, 0, 0, 1]), command(127, [1, 0, 1, 42]),
    command(128, [1, 0, 0, 1]), command(355, ['$game_party.gain_item($data_items[3], 2)'])]) {
    assert.equal(hasPickupReward([cmd]), true);
  }
  for (const cmd of [command(125, [1, 0, 5]), command(126, [3, 1, 1, 42]), command(126, [3, 0, 0, 0]),
    command(355, ['$game_party.gain_item($data_items[3], -2)'])]) assert.equal(hasPickupReward([cmd]), false);
  const common = [null, { list: [command(117, [2])] }, { list: [command(117, [1])] }];
  assert.equal(hasPickupReward([command(117, [1])], common), false, 'cycles terminate');
  common[2].list.push(command(126, [3, 0, 0, 1]));
  assert.equal(hasPickupReward([command(117, [1])], common), true);
});
