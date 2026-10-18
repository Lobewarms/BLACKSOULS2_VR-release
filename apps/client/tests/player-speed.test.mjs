import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { Player } from '../src/entities/player.js';
import { GameMap } from '../src/world/gamemap.js';
import { T } from '../src/world/mapmesh.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');

const cmd = (code, indent = 0, ...parameters) => ({ code, indent, parameters });
const route = speed => ({ repeat: false, skippable: false, wait: true,
  list: [{ code: 29, parameters: [speed] }, { code: 0, parameters: [] }] });

function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  let running = false, choice = 1;
  const actor = { hp: 100, skillCanceled: () => false };
  Object.assign(G, { vr: false, state: new GameState(), scripts: {}, view: null, arena: null, coop: null,
    combat: null, emotes: null, audio: null, floorAt: () => 0, time: 1,
    settings: { moveSpeed: 3, runMultiplier: 1.5, vrSpeed: 2, eyeHeight: 1.6, snapTurn: true },
    input: { mouse: { dx: 0, dy: 0 }, moveVector: () => ({ x: 0, y: -1 }), running: () => running,
      dodge: () => false, jumpPressed: () => false, interact: () => false, turnAxis: () => 0 },
    ui: { menuOpen: false, consumedConfirm: false, messageBusy: () => false, closeMenu() { this.menuOpen = false; },
      showMessage(message) { message.onChoice(choice); } },
  });
  G.state.party.leader = () => actor;
  const map = G.map = new GameMap(); map.mapId = 1;
  map.grid = { w: 1000, h: 1000, valid: () => true, region: () => 0, terrainTag: () => 0, passable: () => true };
  map.playerEdgePassable = () => true;
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  const player = G.player = new Player(rig, camera);
  const resetPosition = () => {
    rig.position.set(100.5 * T, 0, 100.5 * T);
    map.playerChar.x = map.playerChar.realX = map.playerChar.fx = 100;
    map.playerChar.y = map.playerChar.realY = map.playerChar.fy = 100;
    player.lastTile = { x: 100, y: 100 };
  };
  resetPosition();
  const distance = () => {
    resetPosition(); const before = player.headWorld(new THREE.Vector3()).clone(); player.update(0.1);
    return player.headWorld(new THREE.Vector3()).distanceTo(before);
  };
  $data.commonEvents = [null, { id: 1, trigger: 0, list: [
    cmd(121, 0, 31, 32, 1), cmd(102, 0, ['Normal', 'Fast'], 0), cmd(402, 0, 0, 'Normal'),
    cmd(121, 1, 31, 31, 0), cmd(205, 1, -1, route(4)), cmd(0, 1),
    cmd(402, 0, 1, 'Fast'), cmd(121, 1, 32, 32, 0), cmd(205, 1, -1, route(5)), cmd(0, 1), cmd(404), cmd(0),
  ] }];
  $data.actors = []; $data.system = { start_map_id: 1 };
  const combat = Object.assign(Object.create(CombatSystem.prototype), { applyBuffEffects: () => false });
  const chooseSpeed = selected => {
    choice = selected; G.ui.menuOpen = true;
    const used = combat.applyUsableToActor({ __class: 'RPG::Skill', id: 77, effects: [{ code: 44, data_id: 1 }] }, 'menu');
    assert.equal(used, true); assert.equal(G.ui.menuOpen, false);
    for (let i = 0; i < 30; i++) {
      map.update();
      if (!map.interpreter.running() && !map.playerChar.moveRouteForcing && !map.reservedCommon.length) return;
    }
    assert.fail('the selected movement-speed common event must finish its forced route');
  };
  return { player, map, camera, rig, distance, chooseSpeed, running: value => { running = value; } };
}

test('a common-event skill changes actual Player walking distance and Normal restores the original speed', t => {
  const e = environment(t), normal = e.distance();
  assert.ok(Math.abs(normal - 0.3) < 1e-10);
  e.chooseSpeed(1);
  assert.equal(e.map.playerChar.moveSpeed, 5); assert.equal(G.state.sw(32), true); assert.equal(G.state.sw(31), false);
  assert.ok(Math.abs(e.distance() / normal - 2) < 1e-10, 'the original speed-index change must double free movement');
  e.chooseSpeed(0);
  assert.equal(e.map.playerChar.moveSpeed, 4); assert.equal(G.state.sw(31), true); assert.equal(G.state.sw(32), false);
  assert.ok(Math.abs(e.distance() - normal) < 1e-10);
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'PC'} sprint and player speed settings compose with the chosen route speed`, t => {
  const e = environment(t); G.vr = vr;
  const baseline = e.distance(); e.chooseSpeed(1);
  const fast = e.distance(); e.running(true);
  assert.ok(Math.abs(fast / baseline - 2) < 1e-10);
  assert.ok(Math.abs(e.distance() / fast - G.settings.runMultiplier) < 1e-10);
  G.settings.moveSpeed = 4;
  assert.ok(Math.abs(e.distance() / fast - 2) < 1e-10, 'the custom base speed remains usable together with sprint and the skill');
  e.running(false); G.combat = { inCombat: true, guardUp: true };
  assert.ok(Math.abs(e.distance() / fast - (4 / 3) * 0.55) < 1e-10, 'guard slowdown remains applied once');
});

test('ordinary slower route speeds reduce locomotion and invalid legacy values stay at normal speed', t => {
  const e = environment(t), normal = e.distance();
  e.map.playerChar.processMoveCommand({ code: 29, parameters: [3] });
  assert.ok(Math.abs(e.distance() / normal - 0.5) < 1e-10);
  for (const value of [undefined, null, NaN, Infinity, -1, 0, 7, '5']) {
    e.map.playerChar.moveSpeed = value;
    assert.ok(Math.abs(e.distance() - normal) < 1e-10, `invalid movement speed ${String(value)} must not corrupt the rig or accelerate the player`);
  }
});

test('forced routes keep their grid distance and do not apply free locomotion or sprint a second time', t => {
  const e = environment(t); e.running(true); G.vr = true;
  G.input.moveVector = () => ({ x: 0, y: 0 });
  const pc = e.map.playerChar;
  pc.forceMoveRoute({ repeat: false, skippable: false, wait: true,
    list: [{ code: 29, parameters: [5] }, { code: 4, parameters: [] }, { code: 0, parameters: [] }] });
  for (let i = 0; i < 60 && pc.moveRouteForcing; i++) { pc.update(); e.player.update(1 / 60); }
  assert.equal(pc.moveRouteForcing, false); assert.equal(pc.y, 99);
  assert.ok(Math.abs(e.player.headWorld(new THREE.Vector3()).z - 99.5 * T) < 1e-10);
  assert.equal(pc.moveSpeed, 5, 'the event-selected speed remains after its forced route finishes');
});

test('RPG Maker imports preserve numeric movement speed and mod save state roundtrips it', t => {
  const e = environment(t);
  for (const value of [1, 3, 4, 5, 6]) {
    const state = new GameState();
    state.importRmSave(new Map([['map', { map_id: 7 }], ['player', { x: 10, y: 12, direction: 6, move_speed: value }]]), 'Synthetic');
    assert.deepEqual(state.start, { x: 10, y: 12, dir: 6, moveSpeed: value });
    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));
    assert.equal(restored.start.moveSpeed, value); e.map.playerChar.moveSpeed = restored.start.moveSpeed;
    assert.ok(Math.abs(e.distance() - 0.3 * 2 ** (value - 4)) < 1e-10);
  }
  for (const value of [undefined, null, '5', NaN, Infinity, 0, 7]) {
    const state = new GameState(); state.importRmSave(new Map([['player', { move_speed: value }]]), 'Legacy');
    assert.equal(state.start.moveSpeed, 4);
  }
});
