import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const survival = changes => ({ stateId: 73, limit: 999999, limitPercent: false, hp: 1,
  hpPercent: false, canDieAtOne: true, ...changes });
const skill = (type = 1, changes = {}) => ({ id: 7, name: 'Synthetic usable', note: '', effects: [],
  hit_type: 1, success_rate: 100, repeats: 1, scope: 1, animation_id: 0,
  damage: { type, formula: '100', element_id: 0, variance: 0, critical: false }, ...changes });
class Battler extends BattlerBase {
  constructor() { super(); this.hp = 100; this.mp = 100; }
  paramBase(id) { return [1000, 100, 10, 10, 10, 10, 10, 10][id]; }
  featureObjects() { return [{ features: [{ code: 22, data_id: 0, value: 1 }], note: '' }, ...super.featureObjects()]; }
}
function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  t.mock.method(Math, 'random', () => 0.5);
  const states = [];
  for (const id of [1, 73]) states[id] = { id, name: `State ${id}`, note: '', features: [], restriction: 0 };
  Object.assign($data, { states, system: { sounds: [] } });
  const user = new Battler(), target = new Battler();
  Object.assign(G, { scripts: { guts: survival() }, state: { party: { leader: () => user }, system: {} },
    audio: null, coop: null, vr: false, time: 1, floorAt: () => 0, screen: { playAnimationOn() {} } });
  const pending = [];
  const combat = Object.assign(Object.create(CombatSystem.prototype), {
    symbols: new Map(), heldBoss: () => false, popup() {}, popupAtPlayer() {}, spawnGlow() {},
    damageRemovesStates() {}, groggyHit() {},
    checkEnemyDeath(e) { if (e.b.hp <= 0) e.alive = false; },
    later(delay, action) { pending.push({ delay, action }); },
  });
  const enemy = { b: target, alive: true, state: 'chase', battle: {}, h: 1, hr: 0.2,
    knock: { x: 0, y: 0 }, worldPos: out => out.set(0, 0, 0), drawBar() {} };
  return { user, target, enemy, combat, pending, flush: () => { while (pending.length) pending.shift().action(); } };
}

test('Grit requires both the configured state and installed configuration on the real HP damage path', t => {
  const { user, target, combat } = environment(t);
  combat.applyResourceDamage(user, target, skill(), 100);
  assert.equal(target.hp, 0, 'an ordinary lethal hit remains lethal without the state');
  target.hp = 100; target.addState(73); G.scripts.guts = null;
  combat.applyResourceDamage(user, target, skill(), 100);
  assert.equal(target.hp, 0, 'a state alone cannot invent a survival rule without installed settings');
});

test('Grit preserves one HP from a lethal hit, then allows a later hit to kill at its floor', t => {
  const { user, target, combat } = environment(t); target.addState(73);
  const first = combat.applyResourceDamage(user, target, skill(), 150);
  assert.equal(first.hpDamage, 99); assert.equal(target.hp, 1); assert.equal(target.isState(73), true);
  const next = combat.applyResourceDamage(user, target, skill(), 10);
  assert.equal(next.hpDamage, 10); assert.equal(target.hp, 0);
});

test('configured mode can keep a battler at the floor through subsequent lethal hits without changing nonlethal damage', t => {
  const { user, target, combat } = environment(t); target.addState(73);
  G.scripts.guts = survival({ canDieAtOne: false });
  combat.applyResourceDamage(user, target, skill(), 20); assert.equal(target.hp, 80);
  combat.applyResourceDamage(user, target, skill(), 80); assert.equal(target.hp, 1);
  const last = combat.applyResourceDamage(user, target, skill(), 10);
  assert.equal(last.hpDamage, 0); assert.equal(target.hp, 1);
});

test('Grit uses the configured absolute damage limit inclusively and does not absorb hits beyond it', t => {
  const { user, target, combat } = environment(t); target.addState(73);
  G.scripts.guts = survival({ limit: 200 });
  combat.applyResourceDamage(user, target, skill(), 200); assert.equal(target.hp, 1);
  target.hp = 100;
  combat.applyResourceDamage(user, target, skill(), 201); assert.equal(target.hp, 0);
});

test('Grit percentage settings derive the damage limit and HP floor from the actual target maximum', t => {
  const { user, target, combat } = environment(t); target.addState(73); target.hp = 300;
  G.scripts.guts = survival({ limit: 50, limitPercent: true, hp: 10, hpPercent: true });
  assert.equal(target.mhp, 1000);
  const first = combat.applyResourceDamage(user, target, skill(), 500);
  assert.equal(first.hpDamage, 200); assert.equal(target.hp, 100);
  target.hp = 300;
  combat.applyResourceDamage(user, target, skill(), 501); assert.equal(target.hp, 0);
  target.hp = 100;
  combat.applyResourceDamage(user, target, skill(), 100); assert.equal(target.hp, 0, 'configured floor is also the subsequent-hit threshold');
});

test('MP damage bypasses Grit and HP drain returns only the loss allowed by survival', t => {
  const { user, target, combat } = environment(t); target.addState(73); user.hp = 500; user.mp = 0;
  const mp = combat.applyResourceDamage(user, target, skill(6), 200);
  assert.deepEqual(mp, { hpDamage: 0, mpDamage: 100, hpDrain: 0, mpDrain: 100 });
  assert.equal(target.hp, 100); assert.equal(user.mp, 100);
  const hp = combat.applyResourceDamage(user, target, skill(5), 200);
  assert.equal(hp.hpDamage, 99); assert.equal(hp.hpDrain, 99);
  assert.equal(target.hp, 1); assert.equal(user.hp, 599);
});

test('an actual death-state effect remains lethal while Grit only changes formula HP damage', t => {
  const { target, enemy, combat } = environment(t); target.addState(73);
  const death = skill(0, { effects: [{ code: 21, data_id: 1, value1: 1 }] });
  combat.applyUsableToEnemy(enemy, death, null);
  assert.equal(target.hp, 0); assert.equal(enemy.alive, false);
});

test('thrown impacts deliver all seven and nine repeats through real enemy HP damage', t => {
  const { target, enemy, combat, flush } = environment(t);
  combat.allTargets = () => [enemy];
  for (const repeats of [7, 9]) {
    target.hp = target.mhp;
    const obj = skill(1, { repeats });
    combat.landThrown({ usable: obj, mesh: { position: new THREE.Vector3() } });
    flush();
    assert.equal(target.hp, target.mhp - repeats * 100, `${repeats} authored impact repeats must reach damage resolution`);
  }
});

test('area bursts deliver all nine authored repeats to each in-range enemy', t => {
  const { target, enemy, combat, flush } = environment(t); target.hp = target.mhp;
  combat.allTargets = () => [enemy]; combat.burstFx = () => {}; combat.skillColor = () => 0;
  combat.burstUsable(skill(1, { repeats: 9 }), new THREE.Vector3(), 2);
  flush();
  assert.equal(target.hp, 100, 'a nine-repeat area usable must not be truncated at five');
});

test('enemy skill hit plans preserve seven and nine repeats plus random-target counts', t => {
  const { combat } = environment(t);
  assert.equal(combat.skillHits(skill(1, { repeats: 7 })), 7);
  assert.equal(combat.skillHits(skill(1, { repeats: 9 })), 9);
  assert.equal(combat.skillHits(skill(1, { repeats: 9, scope: 6 })), 36);
});

test('skill volleys preserve nine shots and keep every projectile a single hit', t => {
  const { user, enemy, combat, flush } = environment(t); const shots = [];
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 0.5, 0.5); camera.updateMatrixWorld();
  G.three = { camera }; G.map = { mapId: 1, validW: () => true };
  combat.allTargets = () => [enemy];
  assert.equal(combat.readyAim().enemy, enemy, 'the skill volley starts with a real target in the camera ray');
  let charges = 0;
  user.skillCostPayable = () => true; user.skillSealed = () => false; user.skillTypeUsable = () => true;
  Object.assign(combat, { skillCooling: () => 0, actorPays: () => charges++, coolSeconds: () => 1, skillCD: {},
    fireShot(kind, one, breakSkill, options) { shots.push({ kind, one, breakSkill, options }); } });
  const obj = skill(1, { repeats: 9 });
  combat.fireSkillShot(user, obj); flush();
  assert.equal(shots.length, 9); assert.equal(charges, 1);
  assert.ok(shots.every(shot => shot.kind === 'gun' && shot.one === true && shot.options.skill === obj));
  assert.equal(new Set(shots.map(shot => shot.options.volley)).size, 1, 'one shared action owns the whole volley');
});
