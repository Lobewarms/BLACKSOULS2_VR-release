import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';
import { AllySystem } from '../src/entities/allies.js';
import { Interpreter } from '../src/game/interpreter.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const feature = (code, data_id, value) => ({ code, data_id, value });
const skill = (type = 1, effects = [], formula = '100') => ({ id: 1, name: 'Synthetic attack', note: '', hit_type: 1,
  scope: 1, repeats: 1, success_rate: 100, animation_id: 0, damage: { type, formula, variance: 0, element_id: 0, critical: false }, effects });
class Battler extends BattlerBase {
  constructor(id) { super(); this.id = id; this.gear = { features: [], note: '' }; this.hp = 1000; this.mp = 200; }
  paramBase(i) { return [1000, 200, 100, 10, 100, 10, 10, 10][i]; }
  featureObjects() { return [{ note: '', features: [feature(22, 0, 1)] }, this.gear, ...super.featureObjects()]; }
  skillCostPayable() { return true; }
  paySkillCost() { this.payments = (this.payments || 0) + 1; }
  weapons() { return []; }
}
async function environment(t) {
  const old = { ...G }, data = { ...$data }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, old); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 128, height: 18, getContext: () => ({ clearRect() {}, fillRect() {} }),
  }) } });
  $data.actors = [null, { id: 1 }, { id: 2 }]; $data.system = { opt_followers: true, sounds: [] }; $data.skills = [null, skill()];
  $data.states = [null, { id: 1, restriction: 4, features: [] }, { id: 2, features: [], min_turns: 2, max_turns: 2, auto_removal_timing: 2 },
    { id: 3, features: [], remove_by_damage: true, chance_by_damage: 100 }];
  const leader = new Battler(1), actor = new Battler(2), popups = [], sounds = [], jobs = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root: new THREE.Group(), enemies: [], battles: [{}], popup(_position, text) { popups.push(text); },
    spawnGlow() {}, playerDead: false, later: (_delay, callback) => jobs.push(callback),
    isHeavySkill: () => false, outOfFight: () => false, checkEnemyDeath(e) { if (e.b.hp <= 0) e.alive = false; },
  });
  Object.assign(G, { state: { actor: id => id === 1 ? leader : actor, party: { actors: [1, 2], leader: () => leader }, system: { stateTimers: { 3: 30 } } },
    scripts: {}, settings: { difficulty: 1 }, time: 5, floorAt: () => 0, arena: null, coop: null,
    map: { grid: { valid: () => true }, playerChar: { fx: 10, fy: 10 }, wrapX: x => x, wrapY: y => y,
      validW: () => true, passableFor: () => true, walkable: () => true },
    player: { forward2D: () => ({ x: 0, z: -1 }), headWorld: out => out.set(15, 1.6, 15) },
    audio: { playSystemSe: id => sounds.push(id) },
  });
  t.mock.method(Math, 'random', () => 0.5);
  const allies = combat.allies = new AllySystem(combat); allies.update(0, true);
  const unit = allies.list[0]; await unit.ready; t.after(() => allies.reset());
  const enemy = { alive: true, hidden: false, b: new Battler(3), h: 1.6, fx: 10, fy: 8, battle: {},
    worldPos: out => out.set(15, 0, 12), drawBar() { this.draws = (this.draws || 0) + 1; } };
  return { actor, leader, combat, allies, unit, enemy, popups, sounds, jobs,
    hit: attack => unit.takeHit(enemy, attack, { push: 0 }) };
}

test('companion MP damage and MP drain affect only MP, cap actual loss, and replenish the original caster', async t => {
  const e = await environment(t); e.actor.mp = 25; e.enemy.b.mp = 0; e.actor.addState(3);
  e.hit(skill(2)); assert.equal(e.actor.hp, 1000); assert.equal(e.actor.mp, 0); assert.equal(e.actor.isState(3), true);
  assert.ok(e.popups.includes('MP 25'));
  e.actor.mp = 40; e.hit(skill(6)); assert.equal(e.actor.mp, 0); assert.equal(e.enemy.b.mp, 40); assert.equal(e.actor.hp, 1000);
  e.hit(skill(6)); assert.equal(e.enemy.b.mp, 40, 'empty MP cannot create mana'); assert.equal(e.leader.mp, 200);
});

test('HP loss wakes only the actual struck companion and drain gain cannot exceed its remaining HP', async t => {
  const e = await environment(t); e.actor.hp = 25; e.enemy.b.hp = 100; e.actor.addState(3); e.leader.addState(3);
  e.allies.stateTimers = new Map([[2, { 3: 8 }]]);
  e.hit(skill(5));
  assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), true); assert.equal(e.actor.isState(3), false);
  assert.equal(e.enemy.b.hp, 125); assert.equal(e.leader.hp, 1000); assert.equal(e.leader.isState(3), true);
  assert.equal(G.state.system.stateTimers[3], 30, 'the leader timer cannot be erased by a companion hit');
  assert.equal(e.allies.stateTimers.get(2)[3], undefined);
});

test('status-only and empty-resource hits apply normal-attack traits, explicit Death and state removals', async t => {
  const e = await environment(t);
  e.enemy.b.gear.features = [feature(32, 2, 1), feature(32, 1, 1)];
  e.actor.gear.features = [feature(14, 1, 0)];
  e.hit(skill(0, [{ code: 21, data_id: 0, value1: 1 }]));
  assert.equal(e.actor.hp, 1000); assert.equal(e.actor.isState(2), true); assert.equal(e.actor.isState(1), false);
  e.actor.mp = 0;
  e.hit(skill(2, [{ code: 22, data_id: 2, value1: 1 }, { code: 31, data_id: 2, value1: 2 }]));
  assert.equal(e.actor.isState(2), false); assert.equal(e.actor.buffs[2], 1); assert.equal(e.actor.buffTime[2], 12);
  e.actor.gear.features = []; e.hit(skill(0, [{ code: 21, data_id: 1, value1: 1 }]));
  assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), true); assert.equal(e.leader.hp, 1000);
});

test('nonfatal hostile statuses retain their real-time0.6 scale and use caster LUK, susceptibility and immunity', async t => {
  const e = await environment(t), effect = skill(0, [{ code: 21, data_id: 2, value1: 1 }]);
  e.actor.gear.features = [feature(13, 2, 0.5)]; e.hit(effect); assert.equal(e.actor.isState(2), false);
  e.actor.gear.features = []; e.hit(effect); assert.equal(e.actor.isState(2), true);
  e.actor.removeState(2); e.actor.gear.features = [feature(14, 2, 0)]; e.hit(effect); assert.equal(e.actor.isState(2), false);
  e.actor.gear.features = []; e.enemy.b.gear.features = [feature(21, 7, 100)];
  e.actor.gear.features = [feature(13, 2, 0.5)]; e.hit(effect); assert.equal(e.actor.isState(2), true, 'caster luck participates in the shared state chance');
});

test('independent HP/MP/TP effects survive zero formula damage and are not treated as a resource drain', async t => {
  const e = await environment(t); e.enemy.b.hp = 100; e.actor.tp = 10;
  e.hit(skill(0, [{ code: 11, value1: -0.1, value2: 0 }, { code: 12, value1: -0.1, value2: 0 }, { code: 13, value1: 5 }]));
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [900, 180, 15]); assert.equal(e.enemy.b.hp, 100);
});

test('companion guards reduce MP damage and failed accuracy or passive EVA/MEV prevents both damage and attached effects', async t => {
  const e = await environment(t); e.unit.guardUntil = 6; e.hit(skill(2)); assert.equal(e.actor.mp, 150);
  const attack = skill(1, [{ code: 21, data_id: 2, value1: 1 }]); attack.success_rate = 0;
  e.hit(attack); assert.equal(e.actor.hp, 1000); assert.equal(e.actor.isState(2), false); assert.equal(e.unit.push, undefined);
  attack.success_rate = 100; e.actor.gear.features = [feature(22, 1, 1), feature(22, 4, 1)];
  e.hit(attack); attack.hit_type = 2; e.hit(attack);
  assert.equal(e.actor.hp, 1000); assert.equal(e.actor.isState(2), false);
  attack.hit_type = 0; e.unit.guardUntil = 0; e.hit(attack); assert.equal(e.actor.hp, 900, 'sure hits retain their original immunity to passive evasion');
});

test('companion criticals use the actual enemy CRI and companion CEV with the original double multiplier', async t => {
  const e = await environment(t), attack = skill(); attack.damage.critical = true;
  e.enemy.b.gear.features = [feature(22, 2, 1)]; e.hit(attack); assert.equal(e.actor.hp, 800);
  e.actor.gear.features = [feature(22, 3, 1)]; e.hit(attack); assert.equal(e.actor.hp, 700);
  e.actor.gear.features = []; e.enemy.b.gear.features = []; e.hit(attack); assert.equal(e.actor.hp, 600);
});

test('a companion reflects magic to its original enemy caster once even when that caster also has reflection', async t => {
  const e = await environment(t), attack = skill(2); attack.hit_type = 2;
  e.actor.gear.features = [feature(22, 5, 1)]; e.enemy.b.gear.features = [feature(22, 5, 1)];
  e.hit(attack);
  assert.equal(e.actor.hp, 1000); assert.equal(e.actor.mp, 200); assert.equal(e.enemy.b.mp, 100);
  assert.equal(e.leader.mp, 200); assert.deepEqual(e.sounds, [20]);
});

test('landed companion hits grant custom lifesteal and user TP once while misses grant neither', async t => {
  const e = await environment(t), attack = skill(); e.enemy.b.hp = 100;
  attack.note = '<変換攻撃判定:100>\n<HP変換攻撃:50,100>'; attack.tp_gain = 5;
  e.hit(attack); assert.equal(e.actor.hp, 900); assert.equal(e.enemy.b.hp, 150); assert.equal(e.enemy.b.tp, 5);
  assert.ok(e.enemy.draws > 0, 'caster healing refreshes its actual resource display');
  attack.success_rate = 0; e.hit(attack); assert.equal(e.enemy.b.hp, 150); assert.equal(e.enemy.b.tp, 5);
});

test('companion lethal damage uses the same configured survival floor and drain limit as the player and enemies', async t => {
  const e = await environment(t);
  $data.states[73] = { id: 73, features: [] }; e.actor.addState(73); e.actor.hp = 20; e.enemy.b.hp = 100;
  G.scripts.guts = { stateId: 73, limit: 99999, limitPercent: false, hp: 1, hpPercent: false, canDieAtOne: true };
  e.hit(skill(5)); assert.equal(e.actor.hp, 1); assert.equal(e.actor.isState(1), false); assert.equal(e.enemy.b.hp, 119);
  e.hit(skill(1)); assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), true);
});

test('a companion revives once from its own state, clears death buffs and timers, then falls on a subsequent lethal hit', async t => {
  const e = await environment(t);
  $data.states[4] = { id: 4, note: '<自動蘇生:250,0>', features: [] };
  e.actor.addState(2); e.actor.addState(4); e.actor.addBuff(2, 12); e.actor.hp = 25;
  e.allies.stateTimers = new Map([[2, { 2: 12, 4: 18 }]]);
  e.hit(skill());
  assert.equal(e.actor.hp, 250); assert.equal(e.actor.isState(1), false);
  assert.equal(e.actor.isState(2), false); assert.equal(e.actor.isState(4), false);
  assert.equal(e.actor.buffs[2], 0); assert.deepEqual(e.allies.stateTimers.get(2), {});
  assert.equal(G.state.system.stateTimers[3], 30, 'companion revival must not erase the leader timers');
  assert.equal(e.unit.barKey, '250/1000'); assert.deepEqual(e.sounds, [16]);
  e.hit(skill(1, [], '1000'));
  assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), true);
  assert.deepEqual(e.sounds, [16], 'the cleared one-use state cannot revive a second time');
});

test('a companion revival breaks its persistent state source through the shared source-break rule', async t => {
  const e = await environment(t);
  $data.states[4] = { id: 4, note: '[全回復無効ステート]\n<自動蘇生:250,0>\n<自動蘇生破損:100>', features: [] };
  $data.states[5] = { id: 5, note: '[全回復無効ステート]', features: [] };
  e.actor.addState(4); e.actor.addState(5); e.actor.hp = 25;
  $data.states[4].__class = 'RPG::State';
  e.allies.stateTimers = new Map([[2, { 4: 18, 5: 24 }]]);
  const originalBreak = e.combat.breakSaver;
  const breaking = t.mock.method(e.combat, 'breakSaver', function (actor, source) { return originalBreak.call(this, actor, source); });
  e.hit(skill());
  assert.equal(e.actor.hp, 250); assert.equal(e.actor.isState(4), false);
  assert.equal(e.actor.isState(5), true, 'a different persistent state survives the death/revival');
  assert.deepEqual(e.allies.stateTimers.get(2), { 5: 24 });
  assert.equal(breaking.mock.callCount(), 1); assert.equal(breaking.mock.calls[0].arguments[0], e.actor);
  assert.equal(breaking.mock.calls[0].arguments[1], $data.states[4]);
  e.hit(skill(1, [], '1000')); assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), true);
});

test('companion revival caps its restored HP and leaves an unbroken equipment source usable', async t => {
  const e = await environment(t); e.actor.gear.note = '<自動蘇生:5000,0>'; e.actor.hp = 25;
  e.hit(skill()); assert.equal(e.actor.hp, e.actor.mhp); assert.equal(e.actor.isState(1), false);
  e.hit(skill(1, [], '5000')); assert.equal(e.actor.hp, e.actor.mhp); assert.deepEqual(e.sounds, [16, 16]);
});

test('Death immunity keeps a struck companion at zero HP without consuming or attempting auto-revival', async t => {
  const e = await environment(t);
  $data.states[4] = { id: 4, note: '<自動蘇生:250,0>', features: [] };
  e.actor.addState(4); e.actor.gear.features = [feature(14, 1, 0)]; e.actor.hp = 25;
  const autoRevive = t.mock.method(e.actor, 'autoRevive');
  e.hit(skill());
  assert.equal(e.actor.hp, 0); assert.equal(e.actor.isState(1), false); assert.equal(e.actor.isState(4), true);
  assert.equal(e.unit.reviveOnFall(e.actor), false); assert.equal(autoRevive.mock.callCount(), 0);
  assert.deepEqual(e.sounds, []);
});

test('the actual friendly support path revives a companion killed by its healing-reversal state', async t => {
  const e = await environment(t);
  $data.states[4] = { id: 4, note: '<自動蘇生:250,0>\n<HP回復反転:100>', features: [] };
  e.actor.addState(4); e.actor.hp = 10;
  const support = { ...skill(0, [{ code: 11, value1: 0, value2: 100 }]), scope: 7, hit_type: 0 };
  assert.equal(e.combat.applyUsableToActor(support, 'ally', { target: e.actor, user: e.leader }), true);
  assert.equal(e.actor.hp, 250); assert.equal(e.actor.isState(1), false); assert.equal(e.actor.isState(4), false);
  assert.equal(e.leader.hp, 1000); assert.deepEqual(e.sounds, [16]);
});

test('companion attack-count traits retain more than twelve legitimate shots while spells keep their own repeats', async t => {
  const e = await environment(t), attack = $data.skills[1];
  e.actor.gear.features = [feature(34, 0, 11), feature(34, 0, 2)];
  const landed = [], global = []; e.combat.applyUsableToEnemy = (_enemy, s, _from, options) => landed.push([s, options.by]);
  e.combat.itemGlobalEffects = s => global.push(s);
  e.combat.playerAttackSkill = () => attack;
  const ctx = { enemies: [e.enemy], friends: () => [] };
  e.unit.perform({ by: e.actor, skill: attack, enemy: e.enemy }, ctx);
  while (e.jobs.length) e.jobs.shift()();
  assert.equal(landed.length, 14); assert.ok(landed.every(([, by]) => by === e.actor)); assert.equal(e.actor.payments, 1);
  assert.deepEqual(global, [attack], 'an action common event dispatches once before all fourteen impacts');
  const spell = { ...skill(), id: 2, repeats: 3 }; landed.length = 0;
  e.unit.perform({ by: e.actor, skill: spell, enemy: e.enemy }, ctx);
  while (e.jobs.length) e.jobs.shift()();
  assert.equal(landed.length, 3); assert.equal(e.actor.payments, 2);
  assert.deepEqual(global, [attack, spell]);
});

test('the real companion action dispatches its common event to the targeted second battle instead of the first fight', async t => {
  const e = await environment(t), variables = new Map();
  G.state.v = id => variables.get(id) || 0;
  G.state.setV = (id, value) => variables.set(id, value);
  const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
  $data.commonEvents = [null, { id: 1, trigger: 0,
    list: [command(339, [0, 0, 1]), command(122, [88, 88, 1, 0, 1]), command(0)] }];
  e.enemy.memberIndex = 0;
  const owner = e.enemy.battle = { done: false, enemies: [e.enemy] };
  const otherEnemy = { alive: true, memberIndex: 0, b: new Battler(4) };
  e.combat.battles = [{ done: false, enemies: [otherEnemy] }, owner]; e.combat.sideInterps = [];
  const attack = skill(1, [{ code: 44, data_id: 1 }]);
  e.unit.perform({ by: e.actor, skill: attack, enemy: e.enemy }, { enemies: [e.enemy], friends: () => [] });
  assert.equal(e.actor.payments, 1); assert.equal(e.combat.sideInterps.length, 1);
  const source = e.combat.sideInterps[0];
  assert.ok(source instanceof Interpreter); assert.equal(source.battleOwner, owner);
  source.update();
  assert.equal(e.enemy.forcedSkill, $data.skills[1]); assert.equal(otherEnemy.forcedSkill, undefined);
  assert.equal(G.state.v(88), 1);
});
