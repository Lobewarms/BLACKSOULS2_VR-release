import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';

const feature = (code, data_id) => ({ code, data_id, value: 0 });
function environment(t, dual = false) {
  const previous = { ...G }, old = { ...$data }; t.after(() => { Object.assign(G, previous); Object.assign($data, old); });
  const stats = [100, 20, 10, 10, 10, 10, 10, 10];
  $data.actors = [null, { id: 1, class_id: 1, initial_level: 1, equips: [0, 0, 0, 0, 0], features: [], note: '' }];
  $data.classes = [null, { learnings: [], exp_params: [30, 20, 30, 30], note: '',
    features: [feature(51, 1), feature(51, 2), feature(41, 1), ...(dual ? [feature(55, 1)] : [])],
    params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }];
  $data.weapons = [null, ...[1, 2].map(id => ({ id, wtype_id: id, params: Array(8).fill(0), features: [], note: '' }))];
  $data.armors = []; $data.states = [];
  G.state = new GameState(); G.state.party.actors = [1]; G.map = null; G.scripts = {};
  for (const id of [1, 2]) G.state.party.gainItem('weapon', id, 1);
  return G.state.party.leader();
}

test('a required weapon type gates the real actor even for a type-zero skill and clearing equipment restores the restriction', t => {
  const actor = environment(t), skill = { stype_id: 0, required_wtype_id1: 1, required_wtype_id2: 0 };
  assert.equal(actor.skillTypeUsable(skill), false);
  assert.equal(actor.changeEquipById(0, 2), true); assert.equal(actor.skillWeaponUsable(skill), false);
  assert.equal(actor.changeEquipById(0, 1), true); assert.equal(actor.skillTypeUsable(skill), true);
  assert.equal(actor.changeEquipById(0, 0), true); assert.equal(actor.skillTypeUsable(skill), false);
});

test('either positive required type may satisfy the skill and zero means no additional alternative', t => {
  const actor = environment(t);
  assert.equal(actor.skillWeaponUsable({ required_wtype_id1: 0, required_wtype_id2: 0 }), true);
  assert.equal(actor.skillWeaponUsable({}), true);
  actor.changeEquipById(0, 2);
  assert.equal(actor.skillWeaponUsable({ required_wtype_id1: 1, required_wtype_id2: 2 }), true);
  assert.equal(actor.skillWeaponUsable({ required_wtype_id1: 0, required_wtype_id2: 2 }), true);
  assert.equal(actor.skillWeaponUsable({ required_wtype_id1: 1, required_wtype_id2: 0 }), false);
});

test('the second actual weapon in a dual-wield slot satisfies the same original OR rule', t => {
  const actor = environment(t, true), skill = { stype_id: 1, required_wtype_id1: 2, required_wtype_id2: 0 };
  actor.changeEquipById(0, 1); assert.equal(actor.skillTypeUsable(skill), false);
  assert.equal(actor.changeEquipById(1, 2), true); assert.equal(actor.equips[1].kind, 'weapon');
  assert.equal(actor.skillTypeUsable(skill), true);
  actor.changeEquipById(1, 0); assert.equal(actor.skillTypeUsable(skill), false);
});

test('meeting weapon requirements never bypasses a missing or sealed skill category', t => {
  const actor = environment(t), skill = { stype_id: 1, required_wtype_id1: 1, required_wtype_id2: 0 };
  actor.changeEquipById(0, 1); assert.equal(actor.skillTypeUsable(skill), true);
  $data.actors[1].features = [feature(42, 1)]; assert.equal(actor.skillTypeUsable(skill), false);
  $data.actors[1].features = []; skill.stype_id = 2; assert.equal(actor.skillTypeUsable(skill), false);
});
