import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { GameState } from '../src/game/state.js';
import { normalizeMoveSpeed } from '../src/game/movement-speed.js';

globalThis.addEventListener ||= () => {};
const { Coop } = await import('../src/network/coop.js');

function environment(t) {
  const previous = { ...G }; t.after(() => Object.assign(G, previous));
  const state = new GameState(), entered = [];
  state.start = { x: 1, y: 2, dir: 2, moveSpeed: 4 };
  state.switches[12] = true;
  const pc = { x: 21, y: 22, direction: 8, moveSpeed: 5 };
  Object.assign(G, { state, scripts: {}, combat: { reset() {} },
    map: { mapId: 101, playerChar: pc, interpreter: { clear() {} }, reservedCommon: [] },
    enterWorld(next, position) {
      entered.push({ state: next, position }); G.state = next;
      pc.moveSpeed = normalizeMoveSpeed(position?.moveSpeed ?? next.start?.moveSpeed);
    },
  });
  const coop = G.coop = new Coop(new THREE.Scene());
  return { coop, state, pc, entered };
}

test('an unsaved movement-speed selection survives a host visit and returns with its home snapshot', t => {
  const { coop, state, pc, entered } = environment(t);
  coop.summon({ sw: [], vars: [], self: [] }, { m: 5, x: 7, y: 9, d: 6 });
  assert.equal(coop.home.state, state); assert.equal(coop.home.moveSpeed, 5);
  assert.equal(entered[0].position.moveSpeed, 5); assert.equal(pc.moveSpeed, 5);
  assert.equal(state.start.moveSpeed, 4, 'the snapshot must use live character speed rather than the last save position');
  pc.moveSpeed = 3; // a route in the visited world changes only that visit
  coop.goHome();
  assert.equal(entered[1].state, state); assert.equal(entered[1].position.moveSpeed, 5);
  assert.deepEqual(entered[1].position, { mapId: 101, x: 21, y: 22, dir: 8, moveSpeed: 5 });
  assert.equal(pc.moveSpeed, 5); assert.equal(state.sw(12), true); assert.equal(coop.home, null);
});

test('developer-world entry preserves home speed while respecting the visited save speed', t => {
  const { coop, pc, entered } = environment(t), worldState = new GameState();
  worldState.start.moveSpeed = 3; coop.role = 'world'; coop.wphase = 'choosing';
  coop.enterAway(worldState, null, 'prologue');
  assert.equal(coop.home.moveSpeed, 5); assert.equal(pc.moveSpeed, 3);
  assert.equal(entered[0].state, worldState);
  coop.goHome(); assert.equal(pc.moveSpeed, 5); assert.equal(entered[1].position.moveSpeed, 5);
});

test('co-op speed snapshots normalize invalid live values and accept legacy home snapshots', t => {
  const { coop, pc, state, entered } = environment(t);
  for (const speed of [1, 6, undefined, NaN, 0, 7, '5']) {
    G.state = state; pc.moveSpeed = speed;
    coop.summon({ sw: [], vars: [], self: [] }, { m: 5, x: 7, y: 9, d: 6 });
    assert.equal(coop.home.moveSpeed, normalizeMoveSpeed(speed));
    coop.goHome(); assert.equal(pc.moveSpeed, normalizeMoveSpeed(speed));
  }
  state.start.moveSpeed = 6;
  coop.home = { state, mapId: 101, x: 21, y: 22, dir: 8 }; coop.goHome();
  assert.equal(pc.moveSpeed, 6, 'legacy snapshots can restore their saved movement setting');
  delete state.start.moveSpeed;
  coop.home = { state, mapId: 101, x: 21, y: 22, dir: 8 }; coop.goHome(); assert.equal(pc.moveSpeed, 4);
  const calls = entered.length; coop.goHome(); assert.equal(entered.length, calls, 'no home snapshot cannot re-enter a world');
});
