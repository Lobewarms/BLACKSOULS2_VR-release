import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase, GameActor } from '../src/game/state.js';
import { AllySystem } from '../src/entities/allies.js';
globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value) => ({ code, data_id, value });
const effect = (code, data_id, value1 = 1, value2 = 0) => ({ code, data_id, value1, value2 });
const spell = (type = 1, formula = '100', effects = [], extra = {}) => ({ __class: 'RPG::Skill', id: 901,
  name: 'Synthetic reflected spell', note: '', scope: 2, repeats: 9, hit_type: 2, success_rate: 100,
  damage: { type, formula, variance: 0, element_id: 0, critical: false }, effects, ...extra });
class Battler extends BattlerBase {
  constructor(features = [], note = '') { super(); this.gear = { features, note }; this.hp = 500; this.mp = 100; }
  paramBase(i) { return [1000, 200, 100, 10, 100, 10, 10, 10][i]; }
  featureObjects() { return [{ features: [trait(22, 0, 1)], note: '' }, this.gear, ...super.featureObjects()]; }
  skillMpCost(s) { return GameActor.prototype.skillMpCost.call(this, s); }
  paySkillCost(s) { return GameActor.prototype.paySkillCost.call(this, s); }
}
function setup(t) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.states = [];
  for (const id of [1, 2, 3]) $data.states[id] = { id, note: '', features: [], min_turns: 2, max_turns: 2, auto_removal_timing: 2 };
  $data.skills = []; $data.system = { sounds: [] };
  const actor = new Battler(), flashes = [], globals = [], falls = [], sounds = [], haptics = [], deaths = [];
  const battle = { done: false, enemies: [] };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    battles: [battle], enemies: [], symbols: new Map(), allies: {},
    spawnGlow() {}, popup() {}, popupAtPlayer() {}, slipHurt() {}, markBreakOpen() {}, later() {},
    itemGlobalEffects: obj => globals.push(obj.id),
    playerFalls: owner => falls.push(owner), checkEnemyDeath(e) { if (e.b.hp <= 0) { e.alive = false; deaths.push(e); } },
  });
  Object.assign(G, { state: { system: {}, party: { leader: () => actor } }, scripts: {}, time: 2, coop: null,
    map: { reserveCommonEvent: id => globals.push(id) }, settings: {},
    player: { headWorld: () => new THREE.Vector3() }, input: { haptic: (...args) => haptics.push(args) },
    audio: { playSystemSe: id => sounds.push(id) }, screen: { hurtFlash: v => flashes.push(v) },
  });
  const enemy = { b: new Battler(), alive: true, hidden: false, h: 2, state: 'chase', battle,
    worldPos: () => new THREE.Vector3(1, 0, 1), drawBar() {} };
  battle.enemies.push(enemy);
  t.mock.method(Math, 'random', () => 0.5);
  return { combat, actor, enemy, battle, globals, falls, flashes, sounds, haptics, deaths };
}

test('player reflection applies every compound effect once despite repeats/all-target scope and preserves its source user', t => {
  const { combat, actor, enemy, globals, flashes, sounds, haptics } = setup(t);
  actor.addState(2);
  actor.gear = { features: [trait(23, 5, 2)], note: '<HP変換攻撃:50,100>' };
  const obj = spell(1, '100', [effect(11, 0, -0.1), effect(12, 0, 0, -20), effect(22, 2), effect(21, 3), effect(31, 2, 2), effect(44, 40)],
    { note: '<変換攻撃判定:100>', tp_gain: 5 });
  combat.reflectOntoPlayer(enemy, obj);
  assert.equal(actor.hp, 350); assert.equal(actor.mp, 80);
  assert.equal(actor.isState(2), false); assert.equal(actor.isState(3), true); assert.equal(actor.buffs[2], 1);
  assert.equal(actor.tp, 10); assert.equal(enemy.b.hp, 500); assert.deepEqual(globals, []);
  assert.deepEqual(flashes, [1]); assert.deepEqual(sounds, [20]); assert.equal(haptics.length, 2);
});

test('enemy reflection applies compound recovery/removal/buffs and user gains once without another invocation', t => {
  const { combat, actor, enemy, globals } = setup(t);
  enemy.b.addState(2);
  enemy.b.gear = { features: [trait(23, 5, 2), trait(22, 5, 1)], note: '<HP変換攻撃:50,100>' };
  const obj = spell(1, '100', [effect(11, 0, -0.1), effect(12, 0, 0, -20), effect(22, 2), effect(21, 3), effect(31, 2, 2), effect(44, 40)],
    { note: '<変換攻撃判定:100>', tp_gain: 5 });
  combat.reflectOntoEnemy(enemy, obj);
  assert.equal(enemy.b.hp, 350); assert.equal(enemy.b.mp, 80);
  assert.equal(enemy.b.isState(2), false); assert.equal(enemy.b.isState(3), true); assert.equal(enemy.b.buffs[2], 1);
  assert.equal(enemy.b.tp, 10); assert.equal(actor.hp, 500); assert.deepEqual(globals, []);
});

test('reflected formula recovery and flat HP/MP recovery are honored in both directions', t => {
  const { combat, actor, enemy } = setup(t);
  const obj = spell(3, '100', [effect(11, 0, 0, 50), effect(12, 0, 0, 20)]);
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.deepEqual([actor.hp, enemy.b.hp], [650, 650]);
  assert.deepEqual([actor.mp, enemy.b.mp], [120, 120]);
});

// Installed script109 (VX Ace SP1) sets subject.magic_reflection=true and
// overrides opposite?(battler) to include that flag. Reflected normal states
// therefore retain susceptibility; ordinary friendly support excludes it.
test('installed SP1 reflection keeps state susceptibility while ordinary self support remains friendly', t => {
  const { combat, actor, enemy } = setup(t);
  const rates = [trait(13, 3, 0)]; actor.gear.features = rates; enemy.b.gear.features = rates;
  const obj = spell(0, '0', [effect(21, 3)]);
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.equal(actor.isState(3), false); assert.equal(enemy.b.isState(3), false);
  combat.applyUsableToActor({ ...obj, scope: 11, repeats: 1 }, 'quick');
  combat.applySkillOn(enemy, { ...obj, scope: 11, repeats: 1 });
  assert.equal(actor.isState(3), true); assert.equal(enemy.b.isState(3), true);
});

test('reflected normal-state ignore tags bypass susceptibility but never immunity', t => {
  const { combat, actor, enemy } = setup(t);
  actor.gear.features = [trait(13, 3, 0)]; enemy.b.gear.features = [trait(14, 3, 1)];
  const obj = spell(0, '0', [effect(21, 3)], { note: '<強制付与>' });
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.equal(actor.isState(3), true); assert.equal(enemy.b.isState(3), false);
});

test('reflected skill cancellation prevents all damage/effects/user gains while preserving reflection feedback', t => {
  const { combat, actor, enemy, globals, sounds } = setup(t);
  actor.skillCanceled = () => true; enemy.b.skillCanceled = () => true;
  const obj = spell(1, '100', [effect(12, 0, 0, -50), effect(31, 2, 2), effect(44, 40)], { tp_gain: 5 });
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.deepEqual([actor.hp, enemy.b.hp], [500, 500]); assert.deepEqual([actor.mp, enemy.b.mp], [100, 100]);
  assert.deepEqual([actor.tp, enemy.b.tp], [0, 0]); assert.deepEqual([actor.buffs[2], enemy.b.buffs[2]], [0, 0]);
  assert.deepEqual(globals, []); assert.deepEqual(sounds, [20, 20]);
});

test('a reflected fatal effect passes the correct battle to player defeat and invokes enemy defeat once', t => {
  const { combat, actor, enemy, battle, falls, deaths } = setup(t);
  const obj = spell(0, '0', [effect(21, 1)]);
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.equal(actor.hp, 0); assert.deepEqual(falls, [battle]);
  assert.equal(enemy.b.hp, 0); assert.equal(enemy.alive, false); assert.deepEqual(deaths, [enemy]);
});

test('a reflected zero-success spell misses its caster and skips every attached effect and user gain', t => {
  const { combat, actor, enemy, globals, falls } = setup(t);
  actor.addState(2); enemy.b.addState(2);
  const obj = spell(1, '100', [effect(12, 0, 0, -20), effect(22, 2), effect(21, 1), effect(31, 2, 2), effect(44, 40)], { success_rate: 0, tp_gain: 5 });
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.deepEqual([actor.hp, enemy.b.hp], [500, 500]); assert.deepEqual([actor.mp, enemy.b.mp], [100, 100]);
  assert.equal(actor.isState(2), true); assert.equal(enemy.b.isState(2), true);
  assert.deepEqual([actor.buffs[2], enemy.b.buffs[2], actor.tp, enemy.b.tp], [0, 0, 0, 0]);
  assert.deepEqual(globals, []); assert.deepEqual(falls, []);
});

test('reflected magic uses its own caster MEV and absolute hit defeats both passive and absolute evasion', t => {
  const { combat, actor, enemy } = setup(t);
  actor.gear = { features: [trait(22, 4, 1)], note: '<魔法絶対回避>' };
  enemy.b.gear = { features: [trait(22, 4, 1)], note: '<魔法絶対回避>' };
  const obj = spell(1, '100', [effect(12, 0, 0, -20), effect(21, 3)], { tp_gain: 5 });
  combat.reflectOntoPlayer(enemy, obj); combat.reflectOntoEnemy(enemy, obj);
  assert.deepEqual([actor.hp, enemy.b.hp], [500, 500]); assert.deepEqual([actor.mp, enemy.b.mp], [100, 100]);
  assert.equal(actor.isState(3), false); assert.equal(enemy.b.isState(3), false);
  combat.reflectOntoPlayer(enemy, { ...obj, note: '<絶対命中>' });
  combat.reflectOntoEnemy(enemy, { ...obj, note: '<絶対命中>' });
  assert.deepEqual([actor.hp, enemy.b.hp], [400, 400]); assert.deepEqual([actor.mp, enemy.b.mp], [80, 80]);
  assert.equal(actor.isState(3), true); assert.equal(enemy.b.isState(3), true);
});

test('reflected passive evasion ignores a different channel and the reflector does not supply its evasion', t => {
  const { combat, actor, enemy } = setup(t);
  actor.gear.features = [trait(22, 1, 1)]; enemy.b.gear.features = [trait(22, 4, 1)];
  const obj = spell();
  combat.reflectOntoPlayer(enemy, obj); assert.equal(actor.hp, 400, 'caster EVA and reflector MEV cannot evade the caster magic');
  combat.reflectOntoEnemy(enemy, obj); assert.equal(enemy.b.hp, 500, 'the original enemy caster can evade its reflected magic');
});

test('target skill cancellation applies to hostile hits without refunding an action cost or duplicating its global event', t => {
  const { combat, actor, enemy, globals } = setup(t);
  enemy.b.gear.note = '<スキル無効:901>';
  const obj = spell(1, '100', [effect(12, 0, 0, -20), effect(21, 3), effect(31, 2, 2), effect(44, 40)],
    { hit_type: 1, scope: 1, repeats: 1, animation_id: 0, mp_cost: 10, tp_cost: 0, tp_gain: 5 });
  Object.assign(combat, { heldBoss: () => false, skillCD: {},
    pickTargets: () => [enemy], castOrigin: () => new THREE.Vector3(), playerFollowUp() {},
  });
  G.input.haptic = () => {}; G.audio.playSe = () => {};
  assert.equal(combat.performUsable(obj, 'skill', 'quick', { direct: true }), true);
  assert.equal(actor.mp, 90, 'a canceled impact does not undo its cast cost'); assert.deepEqual(globals, [901]);
  assert.equal(enemy.b.hp, 500); assert.equal(enemy.b.mp, 100); assert.equal(enemy.b.isState(3), false);
  assert.equal(enemy.b.buffs[2], 0); assert.equal(actor.tp, 0);
  assert.equal(combat.applyUsableToEnemy(enemy, obj, null), -1);
  const item = { ...obj, __class: 'RPG::Item' };
  combat.applyUsableToEnemy(enemy, item, null);
  assert.equal(enemy.b.hp, 400); assert.equal(enemy.b.mp, 80); assert.equal(enemy.b.isState(3), true);
  assert.equal(actor.tp, 5, 'same-ID items are not canceled by a skill-only tag');
});

test('incoming target cancellation aggregates real feature tags and preserves an already selected counter', t => {
  const { combat, actor, enemy } = setup(t);
  actor.gear.note = '<スキル無効:901,40>';
  $data.states[2].note = '<スキル無効:901,40>'; actor.addState(2);
  const counter = { id: 50 }, queued = [];
  Object.assign(combat, { outOfFight: () => false, playerCounterSkill: () => counter,
    queuePlayerCounter: (e, s) => queued.push([e, s]),
  });
  const obj = spell(1, '100', [effect(12, 0, 0, -20), effect(21, 3)], { hit_type: 1, repeats: 1, tp_gain: 5 });
  combat.enemyStrikePlayer(enemy, obj);
  assert.equal(actor.hp, 500); assert.equal(actor.mp, 100); assert.equal(actor.isState(3), false);
  assert.equal(enemy.b.tp, 0); assert.deepEqual(queued, [[enemy, counter]]);
});

test('hostile cancellation remains after reflection selection, so only the reflected caster can cancel its own spell', t => {
  const { combat, actor, enemy } = setup(t);
  enemy.b.gear = { features: [trait(22, 5, 1)], note: '<スキル無効:901>' };
  combat.heldBoss = () => false;
  const obj = spell(1, '100', [], { repeats: 1 });
  assert.equal(combat.applyUsableToEnemy(enemy, obj, null), -1);
  assert.equal(actor.hp, 400); assert.equal(enemy.b.hp, 500);
});

test('real companion hostile cancellation blocks resources/states/user gains while a same-ID item still lands', async t => {
  const { combat, actor, enemy } = setup(t);
  const oldDocument = globalThis.document;
  t.after(() => { globalThis.document = oldDocument; });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {} }) }) };
  const companion = new Battler(); actor.id = 1; companion.id = 2; companion.gear.note = '<スキル無効:901>';
  $data.actors = [null, {}, { id: 2, face_name: '', character_name: '' }];
  G.state.actor = id => id === 1 ? actor : companion;
  G.state.party.actors = [1, 2]; G.state.system.followers = true;
  G.map.grid = { valid: () => true }; G.map.walkable = () => true; G.map.validW = () => true;
  G.map.wrapX = x => x; G.map.wrapY = y => y; G.map.passableFor = () => true; G.map.playerChar = { fx: 10, fy: 10 };
  G.floorAt = () => 0; G.player.forward2D = () => new THREE.Vector3(0, 0, 1);
  combat.root = new THREE.Group(); combat.enemies = [];
  const system = combat.allies = new AllySystem(combat); system.update(0, true);
  const unit = system.unitOf(2); assert.ok(unit); await unit.ready; t.after(() => system.reset());
  const obj = spell(1, '100', [effect(12, 0, 0, -20), effect(21, 3)], { hit_type: 1, repeats: 1, tp_gain: 5 });
  unit.takeHit(enemy, obj, { push: 0 });
  assert.equal(companion.hp, 500); assert.equal(companion.mp, 100); assert.equal(companion.isState(3), false); assert.equal(enemy.b.tp, 0);
  unit.takeHit(enemy, { ...obj, __class: 'RPG::Item' }, { push: 0 });
  assert.equal(companion.hp, 400); assert.equal(companion.mp, 80); assert.equal(companion.isState(3), true); assert.equal(enemy.b.tp, 5);
});
