import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { Player } from '../src/entities/player.js';
import { T } from '../src/world/mapmesh.js';

function environment(t, vr, source) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const stats = [100, 20, 10, 10, 10, 10, 10, 10], seal = { code: 44, data_id: 12, value: 0 };
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Player', class_id: 1, initial_level: 1, equips: [0, 0, 0, 0, 0], features: [], note: '' }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], features: [], note: '',
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    armors: [null, { id: 1, features: [seal], params: Array(8).fill(0), note: '' }], weapons: [],
    states: [null, null, { id: 2, features: [seal], note: '', min_turns: 1 }],
    system: {}, commonEvents: [],
  });
  const sounds = [];
  Object.assign(G, { state: new GameState(), vr, scripts: {}, view: null, arena: null, coop: null,
    combat: null, emotes: null, time: 1, floorAt: () => 0,
    audio: { playSystemSe: id => sounds.push(id) },
    settings: { moveSpeed: 3, runMultiplier: 1.5, vrSpeed: 2, eyeHeight: 1.6, snapTurn: true },
    ui: { menuOpen: false, consumedConfirm: false, messageBusy: () => false },
  });
  G.state.party.actors = [1];
  const actor = G.state.party.leader(); actor.tp = 50;
  if (source === 'armor') actor.equips[3] = { kind: 'armor', id: 1 };
  else actor.addState(2);
  const input = G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), btn: { left: [], right: [] }, btnPrev: { left: [], right: [] },
    mouse: { dx: 0, dy: 0 }, moveVector: () => ({ x: 0, y: 0 }), running: () => false,
    turnAxis: () => 0, jumpPressed: () => false, interact: () => false,
  });
  const map = G.map = new GameMap(); map.mapId = 1;
  map.grid = { w: 1000, h: 1000, valid: () => true, region: () => 0, terrainTag: () => 0, passable: () => true };
  map.playerEdgePassable = () => true;
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  rig.position.set(100.5 * T, 0, 100.5 * T);
  map.playerChar.x = map.playerChar.realX = map.playerChar.fx = 100;
  map.playerChar.y = map.playerChar.realY = map.playerChar.fy = 100;
  const player = G.player = new Player(rig, camera); player.lastTile = { x: 100, y: 100 };
  const press = () => { input.keys = new Set(['Space']); input.keysPrev = new Set(); input.btn.right = [false, false, false, false, true]; input.btnPrev.right = []; };
  const held = () => { input.keysPrev = new Set(input.keys); input.btnPrev.right = [...input.btn.right]; };
  const unseal = () => { if (source === 'armor') actor.equips[3] = { kind: 'armor', id: 0 }; else actor.removeState(2); };
  return { player, actor, rig, sounds, press, held, unseal };
}

for (const vr of [false, true]) for (const source of ['armor', 'state']) {
  test(`${vr ? 'VR A' : 'PC Space'} cannot bypass a ${source} Dodge seal or retain a queued Dodge after the seal ends`, t => {
    const e = environment(t, vr, source), position = e.rig.position.clone();
    const resources = [e.actor.hp, e.actor.mp, e.actor.tp];
    assert.equal(e.actor.skillSealed(12), true);
    e.press(); e.player.wantDodge = true; e.player.update(0.05);
    assert.deepEqual(e.rig.position.toArray(), position.toArray());
    assert.equal(e.player.invuln, 0); assert.equal(e.player.dodge.t, 0); assert.equal(e.player.dodge.cooldown, 0);
    assert.equal(e.player.wantDodge, false); assert.deepEqual(e.sounds, []);
    assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], resources, 'a blocked dash spends no skill resources');

    e.held(); e.player.update(0.05); e.unseal(); e.player.update(0.05);
    assert.equal(e.actor.skillSealed(12), false); assert.equal(e.player.dodge.t, 0);
    assert.deepEqual(e.sounds, [], 'holding a blocked press cannot replay it or repeatedly signal an error');
    e.press(); e.player.update(0.05);
    assert.ok(e.rig.position.distanceTo(position) > 0.5, 'a fresh press after removing the seal starts the real dash');
    assert.ok(e.player.dodge.t > 0); assert.equal(e.player.invuln, 0.35); assert.equal(e.player.dodge.cooldown, 0.75);
    assert.deepEqual(e.sounds, [17]);
  });
}
