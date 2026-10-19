import test from 'node:test';
import assert from 'node:assert/strict';
import { $data } from '../src/data/data.js';
import { G } from '../src/core/globals.js';
import { BattlerBase, GameState } from '../src/game/state.js';

const feature = (code, data_id, value = 0) => ({ code, data_id, value });
class Battler extends BattlerBase {
  constructor() { super(); this.gear = { features: [] }; this.hp = 100; this.mp = 20; }
  paramBase(i) { return [100, 20, 10, 10, 10, 10, 10, 10][i]; }
  featureObjects() { return [this.gear, ...super.featureObjects()]; }
}
function environment(t) {
  const previous = { ...G }, old = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, old); });
  const stats = [100, 20, 10, 10, 10, 10, 10, 10];
  $data.states = [null, { id: 1, features: [] },
    { id: 2, features: [feature(21, 0, 2)], remove_by_walking: true, steps_to_remove: 5, min_turns: 3 },
    { id: 3, features: [feature(14, 2)], min_turns: 2 },
    { id: 4, features: [feature(13, 2, 0)] }];
  $data.actors = [null, { id: 1, class_id: 1, initial_level: 1, equips: [0, 0, 0, 0, 0], features: [], note: '' }];
  $data.classes = [null, { learnings: [], exp_params: [30, 20, 30, 30], note: '', features: [feature(51, 1)],
    params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }];
  $data.weapons = [null, { id: 1, wtype_id: 1, note: '', features: [feature(14, 2)], params: Array(8).fill(0) }];
  $data.armors = []; G.state = new GameState(); G.map = null; G.scripts = {};
}

test('adding a resistance-granting state erases an already-active resisted state and its counts before resource clamps', t => {
  environment(t); const b = new Battler(); b.addState(2); b.hp = 180;
  assert.equal(b.stateSteps[2], 5); assert.equal(b.stateTurns[2], 3);
  b.addState(3);
  assert.deepEqual(b.states, [3]); assert.equal(b.stateRate(2), 1); assert.equal(b.stateResist(2), true);
  assert.equal(b.hp, 100); assert.equal(b.stateSteps[2], undefined); assert.equal(b.stateTurns[2], undefined);
  b.addState(2); assert.deepEqual(b.states, [3], 'the same immunity also blocks a later application');
});

test('equipping an owned immunity weapon cleanses its resisted state through the real equipment trade', t => {
  environment(t); G.state.party.actors = [1]; const a = G.state.party.leader();
  a.addState(2); G.state.party.gainItem('weapon', 1, 1);
  assert.equal(a.changeEquipById(0, 1), true);
  assert.equal(a.isState(2), false); assert.equal(a.stateResist(2), true); assert.equal(G.state.party.itemCount('weapon', 1), 0);
  assert.equal(a.changeEquipById(0, 0), true);
  assert.equal(a.stateResist(2), false); assert.equal(a.isState(2), false, 'losing immunity never resurrects the erased status');
  assert.equal(G.state.party.itemCount('weapon', 1), 1);
});

test('zero susceptibility is distinct from complete state resistance and does not cleanse an existing state', t => {
  environment(t); const b = new Battler(); b.addState(2); b.addState(4);
  assert.equal(b.stateRate(2), 0); assert.equal(b.stateResist(2), false); assert.equal(b.isState(2), true);
  assert.equal(b.stateSteps[2], 5);
});

test('refresh erases resisted Death without recursive removeState or reviving a zero-HP battler', t => {
  environment(t); const b = new Battler(); b.addState(1); b.stateTurns[1] = 4;
  b.gear.features = [feature(14, 1)];
  b.removeState = () => assert.fail('refresh must erase directly rather than invoke revival/removal semantics');
  b.clampHpMp();
  assert.equal(b.isState(1), false); assert.equal(b.stateTurns[1], undefined); assert.equal(b.hp, 0);
  b.clampHpMp(); assert.equal(b.hp, 0, 'repeated refresh is stable');
});
