import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');

function environment(t, actorChanges = {}, secondChanges = {}) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const stats = [100, 20, 20, 20, 20, 20, 20, 20];
  Object.assign($data, {
    actors: [null, ...[1, 2].map(id => ({ id, name: `Actor ${id}`, class_id: 1,
      initial_level: 1, equips: [0, 0, 0, 0, 0], note: '', features: [] }))],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], features: [], note: '',
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [], armors: [], items: [],
    states: [null, null,
      { id: 2, name: 'Walking poison', features: [], remove_by_walking: true, steps_to_remove: 10 },
      { id: 3, name: 'Timed state', features: [], auto_removal_timing: 1, min_turns: 999, max_turns: 999 },
      { id: 4, name: 'Persistent state', features: [], auto_removal_timing: 0 }],
    system: { start_map_id: 1 },
  });
  const actor = { name: 'Imported actor', class_id: 1, level: 1, states: [], hp: 100, mp: 20, ...actorChanges };
  const second = { ...actor, ...secondChanges };
  const original = new Map([
    ['party', { actors: [1, 2], items: new Map(), weapons: new Map(), armors: new Map() }],
    ['actors', { data: [null, actor, second] }], ['map', { map_id: 1 }], ['player', { x: 1, y: 2 }],
  ]);
  Object.assign(G, { state: new GameState(), scripts: {}, coop: null, map: null });
  const untouched = structuredClone(original);
  G.state.importRmSave(original, 'Synthetic original save');
  assert.deepEqual(original, untouched, 'import must leave the parsed original save untouched');
  const combat = Object.assign(Object.create(CombatSystem.prototype), {
    regenerate() {}, restrainCheck() {}, stateExpired: () => [], playerDead: false,
  });
  return { actor: G.state.actor(1), second: G.state.actor(2), state: G.state, combat };
}

test('original walking-state counts retain their remaining step instead of restarting full duration', t => {
  const { actor } = environment(t, { states: [2], state_steps: new Map([[2, 1]]) });
  assert.equal(actor.stateSteps[2], 1);
  assert.deepEqual(actor.walkStep(), [2]); assert.equal(actor.isState(2), false);
});

test('imported buffs and debuffs affect actual parameters and expire after remaining turns at six seconds each', t => {
  const { actor, combat } = environment(t, {
    buffs: [0, 0, 1, -2, 0, 0, 0, 0], buff_turns: [0, 0, 2, 1, 0, 0, 0, 0],
  });
  assert.equal(actor.atk, 25); assert.equal(actor.def, 10);
  assert.equal(actor.buffTime[2], 12); assert.equal(actor.buffTime[3], 6);
  combat.updateActorStates(5.5, false);
  assert.equal(actor.atk, 25); assert.equal(actor.def, 10);
  combat.updateActorStates(0.5, false);
  assert.equal(actor.def, 20); assert.equal(actor.atk, 25); assert.equal(actor.buffTime[2], 6);
  combat.updateActorStates(6, false); assert.equal(actor.atk, 20);
});

test('leader timed states use saved turns on the first real update and never time persistent states', t => {
  const { actor, second, state, combat } = environment(t,
    { states: [3, 4], state_turns: new Map([[3, 1], [4, 0]]) },
    { state_turns: new Map([[3, 2], [4, 0]]) });
  assert.deepEqual(actor.stateTurns, { 3: 1, 4: 0 });
  assert.deepEqual(second.stateTurns, { 3: 2, 4: 0 });
  assert.deepEqual(state.system.stateTimers, { 3: 6 });
  combat.updateActorStates(5, false); assert.equal(actor.isState(3), true);
  combat.updateActorStates(1, false); assert.equal(actor.isState(3), false);
  assert.equal(actor.isState(4), true); assert.equal(second.isState(3), true);
});

test('a zero-turn auto-removal state expires on the first active tick while pause preserves imported clocks', t => {
  const { actor, combat } = environment(t, { states: [3], state_turns: new Map([[3, 0]]),
    buffs: [0, 0, 1, 0, 0, 0, 0, 0], buff_turns: [0, 0, 1, 0, 0, 0, 0, 0] });
  combat.updateActorStates(20, true); assert.equal(actor.isState(3), true); assert.equal(actor.buffTime[2], 6);
  combat.updateActorStates(0.5, false); assert.equal(actor.isState(3), false); assert.equal(actor.buffTime[2], 5.5);
});

test('legacy absent counters keep defaults and malformed counts cannot create infinite buffs or timers', t => {
  const { actor, state } = environment(t, { states: [2, 3, 4],
    state_steps: new Map([[2, -1]]), state_turns: new Map([[3, Infinity], [4, 10]]),
    buffs: [0, 0, 99, -99, NaN, 0.5, 0, 0], buff_turns: [0, 0, 2, Infinity, 1, 1, 0, 0] });
  assert.deepEqual(actor.buffs, [0, 0, 2, -2, 0, 0, 0, 0]);
  assert.equal(actor.buffTime[2], 12); assert.equal(actor.buffTime[3], 0);
  assert.equal(state.system.stateTimers, undefined);
  assert.deepEqual(actor.walkStep(), []); assert.equal(actor.stateSteps[2], 9);
  const legacy = environment(t, { states: [2, 3] });
  assert.deepEqual(legacy.actor.buffs, Array(8).fill(0)); assert.deepEqual(legacy.actor.stateSteps, {});
  assert.deepEqual(legacy.actor.stateTurns, {}); assert.equal(legacy.state.system.stateTimers, undefined);
});

test('native saves retain converted imported buff, walking and leader-state clocks without resetting them', t => {
  const { actor, state, combat } = environment(t, { states: [2, 3], state_steps: new Map([[2, 2]]),
    state_turns: new Map([[3, 2]]), buffs: [0, 0, 1, 0, 0, 0, 0, 0], buff_turns: [0, 0, 2, 0, 0, 0, 0, 0] });
  actor.walkStep(); combat.updateActorStates(2, false);
  const restored = GameState.fromJSON(JSON.parse(JSON.stringify(state.toJSON()))), loaded = restored.actor(1);
  assert.equal(loaded.stateSteps[2], 1); assert.equal(loaded.buffTime[2], 10); assert.equal(restored.system.stateTimers[3], 10);
  assert.equal(loaded.atk, 25); assert.deepEqual(loaded.walkStep(), [2]);
});
