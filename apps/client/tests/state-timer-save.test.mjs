import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';

function fixture(t) {
  const prior = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, prior); Object.assign($data, data); });
  const stats = [100, 30, 10, 10, 10, 10, 10, 10];
  Object.assign($data, {
    actors: [null, ...[1, 2].map(id => ({ id, name: `Actor ${id}`, class_id: 1, initial_level: 1, equips: [], features: [], note: '' }))],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], features: [], note: '',
      params: { xsize: 8, ysize: 2, data: [...stats, ...stats] } }],
    weapons: [], armors: [], items: [], system: { start_map_id: 1 },
    states: [null, { id: 1, features: [], note: '', min_turns: 0 },
      { id: 2, features: [{ code: 21, data_id: 2, value: 2 }], note: '', min_turns: 10, max_turns: 10, auto_removal_timing: 2 },
      { id: 3, features: [], note: '', min_turns: 0, max_turns: 0, auto_removal_timing: 0 }],
  });
  G.state = new GameState(); G.state.party.actors = [1, 2]; G.scripts = {}; G.map = null; G.coop = null;
  return G.state;
}

test('actor-owned companion seconds and native counts survive the actual JSON save roundtrip including expired zero', t => {
  const state = fixture(t), actor = state.actor(2);
  actor.addState(2); actor.addState(3); actor.stateTurns[2] = 1; actor.stateTimerRemaining[2] = 4.25;
  let saved = JSON.parse(JSON.stringify(state.toJSON()));
  let restored = GameState.fromJSON(saved).actor(2);
  assert.equal(restored.stateTurns[2], 1); assert.equal(restored.stateTimerRemaining[2], 4.25);
  assert.equal(restored.atk, 20); assert.deepEqual(restored.states, [2, 3]);
  actor.stateTimerRemaining[2] = 0;
  saved = JSON.parse(JSON.stringify(state.toJSON())); restored = GameState.fromJSON(saved).actor(2);
  assert.equal(restored.stateTimerRemaining[2], 0, 'zero must expire on the next active tick rather than rerolling');
});

test('original-save import initializes remaining seconds for every actor and keeps leader timers compatible', t => {
  const state = fixture(t), contents = new Map([
    ['party', { actors: [1, 2] }], ['actors', { data: [null,
      { states: [2], state_turns: new Map([[2, 2]]) },
      { states: [2, 3], state_turns: new Map([[2, 1], [3, 20]]) }] }], ['map', { map_id: 1 }],
  ]);
  state.importRmSave(contents, 'synthetic');
  assert.equal(state.actor(1).stateTimerRemaining[2], 12); assert.equal(state.system.stateTimers[2], 12);
  assert.equal(state.actor(2).stateTimerRemaining[2], 6);
  assert.equal(state.actor(2).stateTurns[3], 20); assert.equal(state.actor(2).stateTimerRemaining[3], undefined);
  assert.equal(contents.get('actors').data[2].state_turns.get(2), 1);
});

test('reapplying, removing and clearing states invalidate only the matching actor timer', t => {
  const state = fixture(t), actor = state.actor(2);
  actor.addState(2); actor.addState(3); actor.stateTimerRemaining = { 2: 1, 3: 50 };
  actor.addState(2); assert.equal(actor.stateTimerRemaining[2], undefined); assert.equal(actor.stateTimerRemaining[3], 50);
  actor.stateTimerRemaining[2] = 6; actor.removeState(2); assert.equal(actor.stateTimerRemaining[2], undefined);
  actor.clearStates(); assert.deepEqual(actor.stateTimerRemaining, {});
});

test('legacy and malformed timer fields cannot create persistent, absent-state or invalid countdowns', t => {
  const state = fixture(t), actor = state.actor(2); actor.addState(2); actor.addState(3);
  const saved = JSON.parse(JSON.stringify(state.toJSON())), raw = saved.actors[0];
  raw.stateTimerRemaining = { 1: 2, 2: -3, 3: 20, 99: 20 }; raw.stateTurns = { 2: 1.5, 99: 2 };
  let restored = GameState.fromJSON(saved).actor(2);
  assert.deepEqual(restored.stateTimerRemaining, {}); assert.deepEqual(restored.stateTurns, {});
  delete raw.stateTimerRemaining; delete raw.stateTurns;
  restored = GameState.fromJSON(saved).actor(2);
  assert.deepEqual(restored.stateTimerRemaining, {}); assert.deepEqual(restored.states, [2, 3]);
});
