import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';
import { AllySystem } from '../src/entities/allies.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const feature = (code, data_id, value) => ({ code, data_id, value });
const usable = (changes = {}) => ({ id: 1, name: 'Synthetic usable', note: '', hit_type: 1,
  success_rate: 100, scope: 1, repeats: 1, animation_id: 0, effects: [],
  damage: { type: 1, formula: '400', variance: 0, element_id: 0, critical: false }, ...changes });
class Battler extends BattlerBase {
  constructor(id) { super(); this.id = id; this.gear = { features: [], note: '' }; this.hp = 10000; this.mp = 1000; }
  paramBase(id) { return [10000, 1000, 100, 10, 100, 10, 10, 10][id]; }
  featureObjects() { return [{ features: [feature(22, 0, 1)], note: '' }, this.gear, ...super.featureObjects()]; }
  skillCostPayable() { return true; }
  paySkillCost() {}
  weapons() { return []; }
}
function environment(t) {
  const old = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, old); Object.assign($data, data); });
  t.mock.method(Math, 'random', () => 0.5);
  const states = [];
  states[1] = { id: 1, note: '', features: [], restriction: 4 };
  states[9] = { id: 9, note: '', features: [feature(62, 1, 0)], restriction: 0,
    auto_removal_timing: 2, min_turns: 1, max_turns: 1 };
  states[13] = { id: 13, note: '', features: [], restriction: 4 };
  Object.assign($data, { states, actors: [null, { id: 1 }, { id: 2 }], skills: [null, usable()], system: { sounds: [] } });
  const user = new Battler(1), target = new Battler(3), companion = new Battler(2), jobs = [];
  target.gear.features = [feature(23, 1, 2)];
  Object.assign(G, { state: { actor: id => id === 1 ? user : companion,
    party: { actors: [1, 2], leader: () => user }, system: {} },
    scripts: {}, settings: { difficulty: 1 }, time: 5, audio: null, coop: null, vr: false,
    input: { haptic() {} }, screen: { playAnimationOn() {} }, floorAt: () => 0,
    player: { headWorld: out => out.set(15, 1.6, 15), forward2D: () => ({ x: 0, z: -1 }) },
    map: { grid: { valid: () => true }, playerChar: { fx: 10, fy: 10 }, wrapX: x => x, wrapY: y => y,
      validW: () => true, passableFor: () => true, walkable: () => true } });
  const enemy = { b: target, alive: true, state: 'chase', battle: {}, h: 1.6, hr: 0.2, fx: 10, fy: 8,
    mesh: new THREE.Group(), knock: { x: 0, y: 0 }, worldPos: out => out.set(15, 0, 12), drawBar() {} };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root: new THREE.Group(), enemies: [enemy], symbols: new Map(), battles: [{}],
    heldBoss: () => false, outOfFight: () => false, popup() {}, popupAtPlayer() {}, spawnGlow() {}, spawnTracer() {}, groggyHit() {},
    damageRemovesStates() {}, damageRemovesActorStates() {}, checkEnemyDeath() {}, markBreakOpen() {},
    takeArmedSkill: () => null, buffMult: () => 1, afterPlayerAction() {}, hitPoint: () => new THREE.Vector3(),
    later: (_delay, action) => jobs.push(action), isHeavySkill: () => false,
  });
  return { user, target, companion, enemy, combat, jobs, flush: () => { while (jobs.length) jobs.shift()(); } };
}
async function addCompanion(t, e) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 128, height: 18, getContext: () => ({ clearRect() {}, fillRect() {} }),
  }) } });
  const allies = e.combat.allies = new AllySystem(e.combat); allies.update(0, true);
  const unit = allies.list[0]; await unit.ready;
  t.after(() => { allies.reset(); if (old) Object.defineProperty(globalThis, 'document', old); else delete globalThis.document; });
  return { allies, unit };
}

test('generic physical, magical and MP formula hits use native Guard and the target guard-effect trait', t => {
  const { combat, enemy, target } = environment(t); target.addState(9);
  combat.applyUsableToEnemy(enemy, usable(), null); assert.equal(target.hp, 9900);
  combat.applyUsableToEnemy(enemy, usable({ hit_type: 2 }), null); assert.equal(target.hp, 9800);
  combat.applyUsableToEnemy(enemy, usable({ damage: { type: 2, formula: '400', variance: 0, element_id: 0 } }), null);
  assert.equal(target.mp, 900); assert.equal(target.hp, 9800);
});

test('guard-piercing skill notes bypass native Guard and expiration removes its protection from later hits', t => {
  const { combat, enemy, target } = environment(t);
  combat.addEnemyState(enemy, 9);
  combat.applyUsableToEnemy(enemy, usable({ note: '<防御状態無視率:100>' }), null); assert.equal(target.hp, 9600);
  combat.applyUsableToEnemy(enemy, usable(), null); assert.equal(target.hp, 9500);
  combat.tickEnemyStates(enemy, 2); assert.equal(target.isState(9), false);
  combat.applyUsableToEnemy(enemy, usable(), null); assert.equal(target.hp, 9100);
});

test('native Guard requires a movable battler and does not change recovery or critical and variance multiplication', t => {
  const { combat, target, user } = environment(t); target.addState(9);
  const hit = usable(); hit.damage.variance = 20;
  assert.equal(combat.computeDamage(user, target, hit, 2), 200);
  for (const type of [3, 4]) assert.equal(combat.computeDamage(user, target,
    usable({ damage: { type, formula: '400', variance: 0, element_id: 0 } })), 400);
  target.addState(13); assert.equal(combat.computeDamage(user, target, usable()), 400);
});

test('normal attack repetitions and attack-count traits multiply real damage while native plus manual Guard reduces each hit once', t => {
  const { combat, target, enemy, user, flush } = environment(t);
  $data.skills[1] = usable({ repeats: 2 }); user.gear.features = [feature(34, 0, 2)];
  target.addState(9); enemy.state = 'guard';
  combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3()); flush();
  assert.equal(target.hp, 9400, 'two repeats times three attacks produce six guarded 100-damage hits');
  target.removeState(9); target.hp = target.mhp;
  combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3()); flush();
  assert.equal(target.hp, 9280, 'the existing 0.3 manual guard adaptation remains when no original Guard trait is active');
});

test('a companion attack sees the same native guard as player spells', async t => {
  const e = environment(t), { unit } = await addCompanion(t, e); e.target.addState(9);
  unit.perform({ by: e.companion, skill: usable(), enemy: e.enemy, far: true }, { enemies: [e.enemy], friends: () => [] });
  e.flush(); assert.equal(e.target.hp, 9900);
});

test('a companion native Guard and timed manual guard do not stack, while either guard works independently', async t => {
  const e = environment(t), { unit } = await addCompanion(t, e);
  e.companion.gear.features = [feature(23, 1, 2)]; e.companion.addState(9); unit.guardUntil = 6;
  unit.takeHit(e.enemy, usable(), { push: 0 }); assert.equal(e.companion.hp, 9900);
  unit.guardUntil = 0; unit.takeHit(e.enemy, usable(), { push: 0 }); assert.equal(e.companion.hp, 9800);
  e.companion.removeState(9); unit.guardUntil = 6;
  unit.takeHit(e.enemy, usable(), { push: 0 }); assert.equal(e.companion.hp, 9700);
  unit.takeHit(e.enemy, usable({ note: '<防御状態無視率:100>' }), { push: 0 }); assert.equal(e.companion.hp, 9300);
});
