import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value) => ({ code, data_id, value });
class Stats extends BattlerBase {
  constructor(hit = 1) { super(); this.gear = { note: '', features: [trait(22, 0, hit)] }; this.hp = 1000; this.mp = 100; }
  paramBase(i) { return [1000, 100, 100, 10, 100, 10, 10, 10][i]; }
  featureObjects() { return [this.gear, ...super.featureObjects()]; }
}
function environment(t) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  const actor = new Stats(0.95), target = new Stats(), notices = [], actions = [];
  const skill = { id: 1, success_rate: 100, hit_type: 1, note: '', repeats: 1, scope: 1, animation_id: 0,
    damage: { type: 1, formula: '100', element_id: 0, critical: true, variance: 0 }, effects: [] };
  Object.assign($data, { states: [null, { id: 1, features: [] }, { id: 2, features: [], min_turns: 1 }], skills: [null, skill], system: { sounds: [] } });
  Object.assign(G, { state: { party: { leader: () => actor }, system: {} }, scripts: {}, audio: null, coop: null,
    time: 5, settings: {}, input: { haptic() {} }, screen: { playAnimationOn() {} } });
  const enemy = { b: target, alive: true, state: 'chase', battle: {}, h: 1.5, knock: { x: 0, y: 0 },
    worldPos: out => out.set(0, 0, -1), drawBar() {} };
  const combat = Object.assign(Object.create(CombatSystem.prototype), { heldBoss: () => false,
    takeArmedSkill: () => null, skillByState: (_actor, obj) => obj, buffMult: () => 1,
    afterPlayerAction: (...args) => actions.push(args), hitPoint: () => new THREE.Vector3(),
    spawnGlow() {}, groggyHit() {}, damageRemovesStates() {}, popup: (_position, text, color) => notices.push({ text, color }),
    checkEnemyDeath(e) { if (e.b.hp <= 0) { e.alive = false; e.state = 'dying'; } },
  });
  return { actor, target, skill, enemy, combat, notices, actions };
}

test('weapon HIT penalties change real damage and prevent attached effects when a physical contact misses', t => {
  const { actor, target, skill, enemy, combat, notices, actions } = environment(t);
  t.mock.method(Math, 'random', () => 0.8);
  combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3());
  assert.equal(target.hp, 900); assert.equal(notices.at(-1).text, '100');
  actor.gear.features.push(trait(22, 0, -0.3));
  skill.effects.push({ code: 21, data_id: 2, value1: 1 });
  combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3());
  assert.ok(Math.abs(actor.hit - 0.65) < 1e-10);
  assert.equal(target.hp, 900, 'a weapon accuracy penalty cannot remain a display-only value');
  assert.equal(target.isState(2), false); assert.equal(notices.length, 1);
  assert.equal(actions.length, 2, 'a miss still completes the attempted action rather than granting another free attempt');
});

test('skill success rates apply to physical, magic and sure-hit types, while HIT modifies physical only', t => {
  const { actor, target, skill, enemy, combat } = environment(t);
  actor.gear.features = [trait(22, 0, 0.25)]; t.mock.method(Math, 'random', () => 0.4);
  for (const type of [0, 1, 2]) {
    skill.hit_type = type; skill.success_rate = 30;
    assert.equal(combat.applyUsableToEnemy(enemy, skill, null), -1);
    assert.equal(target.hp, 1000);
  }
  skill.success_rate = 100; skill.hit_type = 1;
  assert.equal(combat.applyUsableToEnemy(enemy, skill, null), -1);
  skill.hit_type = 2; assert.equal(combat.applyUsableToEnemy(enemy, skill, null), 100);
  skill.hit_type = 0; assert.equal(combat.applyUsableToEnemy(enemy, skill, null), 100);
  assert.equal(target.hp, 800);
});

test('the original absolute-hit tag bypasses accuracy and evasion without multiplying damage', t => {
  const { actor, target, skill, enemy, combat } = environment(t);
  actor.gear.features = [trait(22, 0, 0)]; target.gear.features.push(trait(22, 1, 1));
  skill.note = '<絶対命中>'; skill.success_rate = 0; t.mock.method(Math, 'random', () => 0.99);
  assert.equal(combat.applyUsableToEnemy(enemy, skill, null), 100);
  assert.equal(target.hp, 900);
});

test('critical evasion changes the damage of an actual weapon attack and does not cancel the underlying hit', t => {
  const { target, skill, enemy, combat, notices } = environment(t);
  t.mock.method(Math, 'random', () => 0.5);
  combat.playerHitEnemy(enemy, 1, true, new THREE.Vector3());
  assert.equal(target.hp, 800, 'the original normal-game critical multiplier remains two');
  target.gear.features.push(trait(22, 3, 1));
  combat.playerHitEnemy(enemy, 1, true, new THREE.Vector3());
  assert.equal(target.hp, 700, 'full critical evasion leaves a normal hit');
  target.gear.features = [trait(22, 0, 1), trait(22, 3, 0.25)];
  combat.playerHitEnemy(enemy, 1, true, new THREE.Vector3()); assert.equal(target.hp, 500);
  skill.damage.critical = false;
  combat.playerHitEnemy(enemy, 1, true, new THREE.Vector3()); assert.equal(target.hp, 400);
  assert.deepEqual(notices.map(row => row.text), ['200', '100', '200', '100']);
});

test('invalid hit rates fail safely and an unrolled critical cannot be created by negative or absent CEV', t => {
  const { actor, target, skill, enemy, combat } = environment(t);
  t.mock.method(Math, 'random', () => 0.5);
  for (const value of [NaN, -100]) {
    skill.success_rate = value; assert.equal(combat.hitLands(actor, skill), false);
  }
  skill.success_rate = 100; target.gear.features.push(trait(22, 3, -1));
  combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3()); assert.equal(target.hp, 900);
});
