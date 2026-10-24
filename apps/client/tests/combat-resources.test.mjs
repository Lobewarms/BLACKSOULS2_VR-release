import { combatMotion } from './helpers/combat-motion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value) => ({ code, data_id, value });
const attack = (type = 1, formula = '100', effects = []) => ({ id: 900, name: 'Resource attack', note: '', hit_type: 1,
  success_rate: 100, scope: 1, repeats: 1, animation_id: 0, damage: { type, formula, element_id: 0, variance: 0, critical: false }, effects });
class Battler extends BattlerBase {
  constructor(features = [], note = '') { super(); this.gear = { features, note }; this.hp = 1000; this.mp = 200; }
  paramBase(i) { return [1000, 200, 100, 10, 100, 10, 10, 10][i]; }
  featureObjects() { return [{ note: '', features: [trait(22, 0, 1)] }, this.gear, ...super.featureObjects()]; }
}
function environment(t) {
  const saved = { ...G }, data = { ...$data }; t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.states = [];
  for (const [id, name, restriction] of [[1, 'Death', 4], [2, 'Poison', 0], [13, 'Stun', 4], [26, 'Bleeding', 0]]) {
    $data.states[id] = { id, name, restriction, note: '', features: [], min_turns: 2, max_turns: 2, auto_removal_timing: 2 };
  }
  $data.system = { sounds: [] }; $data.skills = [null, attack()];
  const actor = new Battler(), removed = [], falls = [], popups = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { ...combatMotion(),
    symbols: new Map(), heldBoss: () => false, outOfFight: () => false, scheduleDelayed() {},
    allies: { substitute: () => null, healActor() {} }, isBlocking: () => false, skillLook: () => '', reportStruck() {},
    popup(_position, text) { popups.push(text); }, popupAtPlayer(text) { popups.push(text); }, spawnGlow() {}, groggyHit() {},
    damageRemovesStates: () => removed.push('enemy'), damageRemovesActorStates: () => removed.push('actor'),
    playerFalls: killer => falls.push(killer), checkEnemyDeath(enemy) { if (enemy.b.hp <= 0) enemy.alive = false; },
    liftInfo: () => ({ states: new Set() }), later() {},
  });
  Object.assign(G, { state: { system: {}, party: { leader: () => actor } }, scripts: {}, settings: { difficulty: 1 },
    vr: false, time: 5, audio: null, coop: null, arena: null, theater: null,
    player: { invuln: 0, headWorld: () => new THREE.Vector3() }, input: { haptic() {} },
    screen: { hurtFlash() {}, hitShake() {}, playAnimationOn() {} }, map: { playerChar: { fx: 0, fy: 0 } },
  });
  const enemy = { alive: true, hidden: false, b: new Battler(), battle: {}, h: 1.6, state: 'chase', knock: { x: 0, y: 0 },
    worldPos: () => new THREE.Vector3(1, 0, 1), drawBar() {} };
  t.mock.method(Math, 'random', () => 0.5);
  return { actor, combat, enemy, removed, falls, popups, hit: skill => combat.applyUsableToEnemy(enemy, skill, new THREE.Vector3()) };
}

// Installed original examples: Brain Sapper #132 uses MP Attack #259 (type2,
// a.atk*4); Skull Shroom #46 uses Drain Mana #50 (type6); Star Spirit #40 uses
// Drain Life #49 (type5). Game_ActionResult#make_damage caps MP loss and drains.
test('real outgoing MP attacks change MP alone and report the capped amount, including an empty MP target', t => {
  const { actor, enemy, hit, removed, popups } = environment(t);
  assert.equal(hit(attack(2, 'a.atk * 4')), 200); assert.equal(enemy.b.mp, 0); assert.equal(enemy.b.hp, 1000);
  assert.equal(actor.hp, 1000); assert.deepEqual(removed, []); assert.ok(popups.includes('MP -200'));
  assert.equal(hit(attack(2, 'a.atk * 4')), 0); assert.equal(enemy.b.hp, 1000); assert.equal(enemy.alive, true);
});

test('real incoming MP Attack and Drain Mana never subtract HP and drain only available MP', t => {
  const { actor, enemy, combat, removed, falls } = environment(t); enemy.b.mp = 0;
  combat.enemyStrikePlayer(enemy, attack(2, 'a.atk * 4'));
  assert.equal(actor.hp, 1000); assert.equal(actor.mp, 0); assert.equal(enemy.b.mp, 0);
  actor.mp = 20; combat.enemyStrikePlayer(enemy, attack(6, '20 + a.mat - b.mdf * 0.5'));
  assert.equal(actor.hp, 1000); assert.equal(actor.mp, 0); assert.equal(enemy.b.mp, 20);
  combat.enemyStrikePlayer(enemy, attack(6, '100')); assert.equal(enemy.b.mp, 20, 'an empty MP pool cannot create free mana');
  assert.deepEqual(removed, []); assert.deepEqual(falls, []);
});

test('outgoing MP drains replenish the actual user, honor both caps and keep attached states on empty-MP hits', t => {
  const { actor, enemy, combat, hit } = environment(t); actor.mp = 0; enemy.b.mp = 50;
  assert.equal(hit(attack(6, '115')), 50); assert.equal(actor.mp, 50); assert.equal(enemy.b.mp, 0);
  actor.mp = 190; enemy.b.mp = 100; hit(attack(6, '50')); assert.equal(actor.mp, 200); assert.equal(enemy.b.mp, 50);
  const ally = new Battler(); ally.mp = 0; actor.mp = 10;
  combat.applyUsableToEnemy(enemy, attack(6, '100'), new THREE.Vector3(), { by: ally });
  assert.equal(ally.mp, 50); assert.equal(actor.mp, 10); assert.equal(enemy.b.mp, 0);
  hit(attack(2, '100', [{ code: 21, data_id: 26, value1: 1 }])); assert.equal(enemy.b.isState(26), true);
});

test('outgoing HP drains cannot heal overkill damage and incoming drains heal their caster before death resolution', t => {
  const { actor, enemy, combat, hit, falls } = environment(t); actor.hp = 500; enemy.b.hp = 10;
  assert.equal(hit(attack(5, '100')), 100); assert.equal(actor.hp, 510); assert.equal(enemy.b.hp, 0); assert.equal(enemy.alive, false);
  assert.equal(hit(attack(5, '100')), 0); assert.equal(actor.hp, 510, 'an already dead target cannot be drained again');
  enemy.alive = true; enemy.b.hp = 300; actor.hp = 50;
  combat.enemyStrikePlayer(enemy, attack(5, '100'));
  assert.equal(actor.hp, 0); assert.equal(enemy.b.hp, 350); assert.deepEqual(falls, [enemy.battle]);
});

test('drains bypass recovery nullification, cap caster resources and leave ordinary item recovery behavior intact', t => {
  const { actor, enemy, hit, combat } = environment(t);
  actor.gear.note = '<HP回復無効:100>\n<MP回復反転:100>'; actor.hp = 950; actor.mp = 190;
  hit(attack(5, '100')); hit(attack(6, '100')); assert.equal(actor.hp, 1000); assert.equal(actor.mp, 200);
  actor.hp = 500; actor.mp = 100;
  combat.applyUsableToActor({ effects: [{ code: 11, value1: 0, value2: 100 }, { code: 12, value1: 0, value2: 20 }] }, 'quick');
  assert.equal(actor.hp, 500, 'recovery nullification still affects ordinary healing effects');
  assert.equal(actor.mp, 80, 'ordinary MP recovery still honors its reversal state');
});

test('guard reductions apply to MP damage while perfect guards, misses and evasion prevent both loss and drain gain', t => {
  const { actor, enemy, combat } = environment(t); enemy.b.mp = 0; combat.stamina = 1;
  combat.isBlocking = () => true; combat.guardTing = () => {}; combat.perfectGuardReward = () => {};
  combat.enemyStrikePlayer(enemy, attack(6, '100')); assert.equal(actor.mp, 150); assert.equal(enemy.b.mp, 50); assert.equal(actor.hp, 1000);
  combat.guardRaisedAt = G.time; combat.enemyStrikePlayer(enemy, attack(6, '100'));
  assert.equal(actor.mp, 150); assert.equal(enemy.b.mp, 50);
  combat.isBlocking = () => false; const miss = attack(6); miss.success_rate = 0;
  combat.enemyStrikePlayer(enemy, miss); assert.equal(actor.mp, 150); assert.equal(enemy.b.mp, 50);
  actor.gear.features = [trait(22, 1, 1)]; combat.enemyStrikePlayer(enemy, attack(6));
  assert.equal(actor.mp, 150); assert.equal(enemy.b.mp, 50);
});

test('percentage HP/MP effects remain separate from MP formula drains and incoming damage multipliers', t => {
  const { actor, enemy, combat } = environment(t); enemy.b.mp = 0;
  const skill = attack(6, '100', [{ code: 11, value1: -0.1, value2: 0 }, { code: 12, value1: -0.1, value2: 0 }]);
  combat.enemyStrikePlayer(enemy, skill, { mult: 0.5 });
  assert.equal(actor.hp, 950); assert.equal(actor.mp, 130); assert.equal(enemy.b.mp, 50, 'only the50 formula MP loss is drained');
});

test('reflected MP damage hits its original caster resource exactly once in either direction', t => {
  const { actor, enemy, combat, hit } = environment(t); const mrf = trait(22, 5, 1);
  actor.gear.features = [mrf]; enemy.b.gear.features = [mrf];
  const spell = attack(2, '100'); spell.hit_type = 2;
  assert.equal(hit(spell), -1); assert.equal(actor.mp, 100); assert.equal(actor.hp, 1000); assert.equal(enemy.b.mp, 200);
  combat.enemyStrikePlayer(enemy, spell); assert.equal(enemy.b.mp, 100); assert.equal(enemy.b.hp, 1000); assert.equal(actor.mp, 100);
});

test('reflected drains return actual loss to the original caster without overkill healing or recursion', t => {
  const { actor, enemy, combat, hit, falls } = environment(t); const mrf = trait(22, 5, 1);
  actor.gear.features = [mrf]; enemy.b.gear.features = [mrf]; actor.hp = 50; enemy.b.hp = 50; actor.mp = 20; enemy.b.mp = 20;
  for (const type of [5, 6]) {
    const spell = attack(type, '100'); spell.hit_type = 2;
    assert.equal(hit(spell), -1); combat.enemyStrikePlayer(enemy, spell);
    assert.equal(actor.hp, 50); assert.equal(enemy.b.hp, 50); assert.equal(actor.mp, 20); assert.equal(enemy.b.mp, 20);
  }
  assert.deepEqual(falls, []); assert.equal(enemy.alive, true);
});

// Original Rotting Dog #11 carries Bleeding26 at30%, and Great Serpent #23
// Poison2 at30%. Their Bite skills65/164 use effect21/data0 (attack states).
test('incoming normal-attack states aggregate traits once and apply real poison, bleeding and stun states', t => {
  const { actor, enemy, combat } = environment(t);
  enemy.b.gear.features = [trait(32, 26, 0.3), trait(32, 26, 0.4), trait(32, 2, 1), trait(32, 13, 1)];
  Math.random.mock.mockImplementation(() => 0.4);
  combat.enemyStrikePlayer(enemy, attack(1, '100', [{ code: 21, data_id: 0, value1: 1 }]));
  assert.equal(actor.hp, 900); assert.equal(actor.isState(26), true, 'combined0.7×existing0.6 scaling beats0.4; separate trait rolls would fail');
  assert.equal(actor.isState(2), true); assert.equal(actor.isState(13), true);
  assert.ok(G.state.system.stateTimers[26] > 0); assert.ok(G.state.system.stateTimers[13] > 0);
  assert.equal($data.states[13].restriction, 4, 'stun remains an actual restricting state');
});

test('incoming attack states honor immunity, state rate, original-caster LUK and ignore tags', t => {
  const { actor, enemy, combat } = environment(t); enemy.b.gear.features = [trait(32, 26, 1)];
  const bite = attack(1, '0', [{ code: 21, data_id: 0, value1: 1 }]);
  actor.gear.features = [trait(14, 26, 0)]; bite.note = '<強制付与>';
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  actor.gear.features = [trait(13, 26, 0)]; bite.note = '';
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  bite.note = '<有効度無視ステート付与>'; combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), true);
  actor.removeState(26); actor.gear.features = [trait(21, 7, 101)]; bite.note = '';
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  bite.note = '<運無視ステート付与>'; combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), true);
});

test('missed, evaded and perfectly guarded normal attacks cannot apply state traits; lethal traits retain death handling', t => {
  const { actor, enemy, combat, falls } = environment(t); enemy.b.gear.features = [trait(32, 26, 1)];
  const bite = attack(1, '100', [{ code: 21, data_id: 0, value1: 1 }]);
  bite.success_rate = 0; combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  bite.success_rate = 100; actor.gear.features = [trait(22, 1, 1)];
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  actor.gear.features = []; combat.isBlocking = () => true; combat.guardRaisedAt = G.time;
  combat.guardTing = () => {}; combat.perfectGuardReward = () => {};
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.isState(26), false);
  combat.isBlocking = () => false; enemy.b.gear.features = [trait(32, 1, 1)];
  combat.enemyStrikePlayer(enemy, bite); assert.equal(actor.hp, 0); assert.equal(actor.isState(1), true); assert.deepEqual(falls, [enemy.battle]);
});

function puppetEnvironment(t) {
  const env = environment(t), { combat, enemy } = env;
  Object.assign(enemy, { puppet: true, netId: 7, group: new THREE.Group(), mesh: new THREE.Group() }); enemy.b.enemyId = 1;
  Object.assign(combat, { puppets: new Map([[7, enemy]]), puppetBattle: {}, enemies: [enemy],
    puppetMoves: () => false, groggyMax: () => 0, puppetEnd() {} });
  const snapshot = (mp = 200) => ({ id: 7, enemyId: 1, fx: 1, fy: 1, hover: 0, lift: 0, flags: 2, k: 1,
    state: 'chase', aim: null, hp: 1000, states: [], grog: 0, ...(mp === undefined ? {} : { mp }) });
  combat.applyPuppets([snapshot()]);
  return { ...env, snapshot };
}

test('a real guest MP hit reports only MP and stale snapshots cannot rewind its unacknowledged loss', t => {
  const { actor, combat, enemy, snapshot, hit } = puppetEnvironment(t); actor.mp = 0;
  hit(attack(6, '50')); assert.equal(enemy.b.mp, 150); assert.equal(actor.mp, 50);
  const [report] = combat.puppetReports(); assert.equal(report.md, 50); assert.equal(report.d, 0);
  assert.equal(combat.puppetSnap(enemy).mp, 150);
  G.time += 0.1; combat.applyPuppets([snapshot(200)]); assert.equal(enemy.b.mp, 150);
  assert.deepEqual(combat.puppetReports(), [], 'an old host packet must not create a second MP hit report');
  G.time += 1; combat.applyPuppets([snapshot(140)]); assert.equal(enemy.b.mp, 140, 'authoritative MP takes over after the correction window');
});

test('an enemy drain on a guest reports gained MP and fresh host packets preserve that local gain', t => {
  const { actor, combat, enemy, snapshot } = puppetEnvironment(t); enemy.b.mp = 0; enemy.netBase = combat.puppetSnap(enemy);
  combat.enemyStrikePlayer(enemy, attack(6, '50')); assert.equal(actor.mp, 150); assert.equal(actor.hp, 1000); assert.equal(enemy.b.mp, 50);
  const [report] = combat.puppetReports(); assert.equal(report.md, -50); assert.equal(report.d, 0);
  G.time += 0.1; combat.applyPuppets([snapshot(0)]); assert.equal(enemy.b.mp, 50);
  G.time += 1; combat.applyPuppets([snapshot(50)]); assert.equal(enemy.b.mp, 50);
  assert.deepEqual(combat.puppetReports(), []);
});

test('host guest-hit application routes bounded MP deltas separately from HP and accepts legacy omitted MP', t => {
  const { combat, enemy, removed } = puppetEnvironment(t);
  const report = md => ({ id: 7, d: 0, add: [], rm: [], g: 0, brk: 0, big: false, ...(md === undefined ? {} : { md }) });
  assert.equal(combat.applyGuestHit(report(50)), true); assert.equal(enemy.b.mp, 150); assert.equal(enemy.b.hp, 1000);
  assert.equal(combat.applyGuestHit(report(1e7)), true); assert.equal(enemy.b.mp, 0); assert.equal(enemy.b.hp, 1000);
  assert.equal(combat.applyGuestHit(report(-1e7)), true); assert.equal(enemy.b.mp, 200); assert.equal(enemy.alive, true);
  assert.equal(combat.applyGuestHit(report()), true); assert.equal(enemy.b.mp, 200); assert.deepEqual(removed, []);
  for (const invalid of [NaN, Infinity, -Infinity, 0.5, '50', 1e7 + 1, -1e7 - 1]) {
    const malformed = report(invalid); malformed.d = 100;
    assert.equal(combat.applyGuestHit(malformed), false); assert.equal(enemy.b.mp, 200); assert.equal(enemy.b.hp, 1000);
  }
});

test('optional enemy MP snapshots are validated, capped to max MP and omitted zero-delta reports stay legacy-compatible', t => {
  const { combat, enemy, snapshot } = puppetEnvironment(t); enemy.b.mp = 50;
  for (const invalid of [undefined, NaN, Infinity, -1, 0.5, '100', 1e8 + 1]) {
    const packet = snapshot(); if (invalid === undefined) delete packet.mp; else packet.mp = invalid;
    combat.applyPuppets([packet]); assert.equal(enemy.b.mp, 50);
  }
  combat.applyPuppets([snapshot(0)]); assert.equal(enemy.b.mp, 0);
  combat.applyPuppets([snapshot(1e8)]); assert.equal(enemy.b.mp, 200);
  enemy.b.hp -= 10; const [hpOnly] = combat.puppetReports(); assert.equal(hpOnly.d, 10); assert.equal('md' in hpOnly, false);
  assert.deepEqual(combat.puppetReports(), []);
});
