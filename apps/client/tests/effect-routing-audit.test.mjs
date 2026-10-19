import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';
import { Interpreter } from '../src/game/interpreter.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value) => ({ code, data_id, value });
const attack = (changes = {}) => ({ id: 1, name: 'Synthetic attack', note: '', hit_type: 1, success_rate: 100,
  repeats: 1, scope: 1, animation_id: 0, effects: [], tp_gain: 0,
  damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false }, ...changes });
const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
class Battler extends BattlerBase {
  constructor() { super(); this.values = [1000, 200, 100, 10, 100, 10, 10, 100]; this.gear = { features: [], note: '' }; this.hp = 1000; this.mp = 200; }
  paramBase(id) { return this.values[id]; }
  featureObjects() { return [{ features: [trait(22, 0, 1)], note: '' }, this.gear, ...super.featureObjects()]; }
  paySkillCost() { this.payments = (this.payments || 0) + 1; }
}
function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  t.mock.method(Math, 'random', () => 0.5);
  const states = [];
  states[1] = { id: 1, note: '', restriction: 4, features: [] };
  states[9] = { id: 9, note: '', restriction: 0, features: [trait(62, 1, 0)] };
  Object.assign($data, { states, system: { sounds: [] }, skills: [null, attack()], commonEvents: [null, {
    id: 1, trigger: 0, list: [command(122, [88, 88, 1, 0, 1]), command(0)],
  }] });
  const actor = new Battler(), variables = new Map(), charges = [];
  Object.assign(G, { state: { system: {}, v: id => variables.get(id) || 0, setV: (id, value) => variables.set(id, value),
    party: { leader: () => actor, gainItem: (...args) => charges.push(args) } },
    scripts: {}, settings: { difficulty: 1 }, time: 5, audio: null, coop: null, vr: false,
    ui: { messageBusy: () => false }, input: { haptic() {} },
    screen: { hurtFlash() {}, hitShake() {}, playAnimationOn() {} },
    player: { invuln: 0, headWorld: out => out.set(0, 1.6, 0) }, map: { mapId: 1, playerChar: { fx: 0, fy: 0 } } });
  const enemy = { alive: true, hidden: false, b: new Battler(), state: 'chase', h: 1.6, knock: { x: 0, y: 0 },
    worldPos: out => out.set(1, 0, 1), drawBar() { this.draws = (this.draws || 0) + 1; } };
  const owner = enemy.battle = { done: false, enemies: [enemy] };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    battles: [owner], sideInterps: [], symbols: new Map(), skillCD: {},
    heldBoss: () => false, outOfFight: () => false, scheduleDelayed() {},
    allies: { substitute: () => null, healActor() {} }, isBlocking: () => false, reportStruck() {},
    popup() {}, popupAtPlayer() {}, spawnGlow() {}, groggyHit() {},
    damageRemovesStates() {}, damageRemovesActorStates() {},
    playerFalls() {}, checkEnemyDeath() {}, liftInfo: () => ({ states: new Set() }),
    guardTing() {}, perfectGuardReward() {}, stamina: 1,
  });
  return { actor, enemy, owner, combat, charges };
}

test('a real enemy hit restores its custom HP conversion and grants user TP once', t => {
  const { actor, enemy, combat } = environment(t); enemy.b.hp = 100;
  const skill = attack({ note: '<変換攻撃判定:100>\n<HP変換攻撃:50,100>', tp_gain: 10 });
  combat.enemyStrikePlayer(enemy, skill);
  assert.equal(actor.hp, 900); assert.equal(enemy.b.hp, 150); assert.equal(enemy.b.tp, 10);
  assert.ok(enemy.draws > 0, 'the enemy resource display refreshes after its own lifesteal');
});

test('missed and perfectly guarded enemy hits grant neither custom lifesteal nor user TP', t => {
  const { actor, enemy, combat } = environment(t); enemy.b.hp = 100;
  const skill = attack({ note: '<変換攻撃判定:100>\n<HP変換攻撃:50,100>', tp_gain: 10, success_rate: 0 });
  combat.enemyStrikePlayer(enemy, skill);
  assert.deepEqual([actor.hp, enemy.b.hp, enemy.b.tp], [1000, 100, 0]);
  skill.success_rate = 100; combat.isBlocking = () => true; combat.guardRaisedAt = G.time;
  combat.enemyStrikePlayer(enemy, skill);
  assert.deepEqual([actor.hp, enemy.b.hp, enemy.b.tp], [1000, 100, 0]);
});

test('debuff effects use the explicit original user LUK and independently honor ignore-luck, ignore-rate and forced tags', t => {
  const { actor, enemy, combat } = environment(t);
  actor.values[7] = 600; enemy.b.values[7] = 100;
  actor.gear.features = [trait(12, 3, 0.5)];
  const skill = attack({ effects: [{ code: 32, data_id: 3, value1: 5 }] });
  const apply = (note, roll) => {
    actor.removeBuff(3); Math.random.mock.mockImplementation(() => roll);
    combat.applyBuffEffects(actor, { ...skill, note }, 6, 0.6, enemy.b);
    return actor.buffs[3];
  };
  assert.equal(apply('', 0.149), -1); assert.equal(actor.buffTime[3], 30);
  assert.equal(apply('', 0.15), 0, 'ordinary chance includes the 0.5 LUK multiplier as well as rate and incoming scale');
  assert.equal(apply('<運無視弱体付与>', 0.299), -1); assert.equal(apply('<運無視弱体付与>', 0.3), 0);
  assert.equal(apply('<有効度無視弱体付与>', 0.299), -1); assert.equal(apply('<有効度無視弱体付与>', 0.3), 0);
  assert.equal(apply('<強制付与>', 0.599), -1); assert.equal(apply('<強制付与>', 0.6), 0,
    'the existing hostile real-time scale remains even when original luck/rate are ignored');
});

test('actual incoming debuffs pass the enemy user and retain the existing 0.6 hostile adaptation', t => {
  const { actor, enemy, combat } = environment(t); actor.values[7] = 2100;
  const skill = attack({ damage: { type: 0 }, effects: [{ code: 32, data_id: 3, value1: 5 }] });
  combat.enemyStrikePlayer(enemy, skill); assert.equal(actor.buffs[3], 0, 'a 2000 LUK deficit makes the ordinary debuff fail');
  skill.note = '<運無視弱体付与>'; combat.enemyStrikePlayer(enemy, skill); assert.equal(actor.buffs[3], -1);
  actor.removeBuff(3); Math.random.mock.mockImplementation(() => 0.6);
  combat.enemyStrikePlayer(enemy, skill); assert.equal(actor.buffs[3], 0);
});

test('a paid skill common event runs once even when all nine repeats miss, using its real battle-owned interpreter', t => {
  const { actor, enemy, owner, combat } = environment(t);
  const skill = attack({ repeats: 9, success_rate: 0, effects: [{ code: 44, data_id: 1 }] });
  combat.payUsable(skill, 'skill');
  for (let hit = 0; hit < 9; hit++) combat.applyUsableToEnemy(enemy, skill, null);
  assert.equal(actor.payments, 1); assert.equal(enemy.b.hp, 1000); assert.equal(combat.sideInterps.length, 1);
  const source = combat.sideInterps[0];
  assert.ok(source instanceof Interpreter); assert.equal(source.troop, true);
  assert.equal(source.battleOwner, owner); assert.equal(combat.battleOf(source), owner);
  source.update(); assert.equal(G.state.v(88), 1);
});

test('landed nine-repeat item uses dispatch once per use and two distinct same-frame uses are not debounced', t => {
  const { enemy, owner, combat, charges } = environment(t);
  const item = attack({ id: 7, __class: 'RPG::Item', consumable: true, repeats: 9,
    damage: { type: 1, formula: '10', element_id: 0, variance: 0 }, effects: [{ code: 44, data_id: 1 }] });
  for (let use = 0; use < 2; use++) {
    combat.payUsable(item, 'item');
    for (let hit = 0; hit < 9; hit++) combat.applyUsableToEnemy(enemy, item, null);
  }
  assert.equal(enemy.b.hp, 820); assert.equal(combat.sideInterps.length, 2);
  assert.deepEqual(charges, [['item', 7, -1], ['item', 7, -1]]);
  for (const source of combat.sideInterps) { assert.equal(source.battleOwner, owner); source.update(); }
  assert.equal(G.state.v(88), 2);
});

test('an explicitly selected global-event owner remains distinct from the first concurrent battle', t => {
  const { enemy, owner, combat } = environment(t);
  const other = { done: false, enemies: [{ alive: true }] }; combat.battles.unshift(other);
  const skill = attack({ effects: [{ code: 44, data_id: 1 }] });
  combat.itemGlobalEffects(skill, owner);
  for (let hit = 0; hit < 9; hit++) combat.applyUsableToEnemy(enemy, skill, null);
  assert.equal(combat.sideInterps.length, 1);
  assert.equal(combat.sideInterps[0].battleOwner, owner); assert.equal(combat.battleOf(combat.sideInterps[0]), owner);
});

test('paying a skill preserves its selected second-battle owner through the real common-event interpreter', t => {
  const { actor, enemy, owner, combat } = environment(t);
  enemy.memberIndex = 0;
  const otherEnemy = { alive: true, memberIndex: 0, b: new Battler() };
  const other = { done: false, enemies: [otherEnemy] }; combat.battles.unshift(other);
  $data.commonEvents[1].list = [command(339, [0, 0, 1]), command(122, [88, 88, 1, 0, 1]), command(0)];
  const skill = attack({ effects: [{ code: 44, data_id: 1 }] });
  combat.payUsable(skill, 'skill', owner);
  assert.equal(actor.payments, 1); assert.equal(combat.sideInterps.length, 1);
  const source = combat.sideInterps[0];
  assert.ok(source instanceof Interpreter); assert.equal(source.battleOwner, owner);
  source.update();
  assert.equal(enemy.forcedSkill, $data.skills[1]); assert.equal(otherEnemy.forcedSkill, undefined);
  assert.equal(G.state.v(88), 1, 'the paid action common event executes once in its selected battle');
});

test('actual player native Guard plus a raised manual shield reduces formula damage once', t => {
  const { actor, enemy, combat } = environment(t);
  actor.gear.features = [trait(23, 1, 2)]; actor.addState(9);
  combat.isBlocking = () => true; combat.hasShield = true;
  const skill = attack({ damage: { type: 1, formula: '400', element_id: 0, variance: 0 } });
  combat.enemyStrikePlayer(enemy, skill);
  assert.equal(actor.hp, 900, 'the native 1/(2×GRD) reduction is not multiplied by manual shield reduction');
  actor.removeState(9); combat.enemyStrikePlayer(enemy, skill);
  assert.equal(actor.hp, 850, 'manual shield behavior remains available when native Guard is absent');
});
