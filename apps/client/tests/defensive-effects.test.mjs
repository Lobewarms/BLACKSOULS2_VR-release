import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');

const trait = (code, data_id, value) => ({ code, data_id, value });
const skill = (id = 1, hit_type = 1, note = '', formula = '120') => ({ id, hit_type, note, scope: 1, repeats: 1, animation_id: 0,
  damage: { type: 1, formula, element_id: 0, variance: 0, critical: false }, effects: [] });
class Battler extends BattlerBase {
  constructor(features = [], note = '') { super(); this.gear = { features, note }; this.hp = 1000; this.mp = 100; }
  paramBase(i) { return [1000, 100, 100, 10, 100, 10, 10, 10][i]; }
  featureObjects() { return [{ features: [trait(22, 0, 1)], note: '' }, this.gear, ...super.featureObjects()]; }
  skillCostPayable() { return true; }
  skillSealed() { return false; }
}
function environment(t, features = [], note = '') {
  const saved = { ...G }, data = { states: $data.states, skills: $data.skills, system: $data.system };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.states = [null, { id: 1, restriction: 4, features: [] }, { id: 2, features: [], min_turns: 2, max_turns: 2, auto_removal_timing: 2 }];
  $data.states[13] = { id: 13, restriction: 4, features: [] };
  $data.states[14] = { id: 14, features: [trait(22, 7, 0.1)] };
  $data.system = { sounds: [] }; $data.skills = [null, skill()];
  $data.skills[31] = skill(31, 1, '', '60'); $data.skills[32] = skill(32, 1, '', '80');
  const actor = new Battler(features, note), jobs = [], hits = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    outOfFight: () => false, heldBoss: () => false, scheduleDelayed() {}, allies: { substitute: () => null },
    isBlocking: () => false, reportStruck: (_enemy, how) => hits.push(how), skillLook: () => '',
    later: (_ms, callback) => jobs.push(callback), castOrigin: () => new THREE.Vector3(),
    spawnGlow() {}, popup() {}, popupAtPlayer() {}, groggyHit() {},
    checkEnemyDeath(enemy) { if (enemy.b.hp <= 0) enemy.alive = false; },
    playerFalls() { combat.playerDead = true; },
  });
  Object.assign(G, { state: { system: {}, party: { leader: () => actor } }, settings: { difficulty: 1 },
    input: { haptic() {}, moveVector: () => ({ x: 0, y: 0 }) }, audio: null, time: 5,
    player: { headWorld: () => new THREE.Vector3(), invuln: 0 },
    screen: { hurtFlash() {}, hitShake() {}, playAnimationOn() {} },
    map: { playerChar: { fx: 0, fy: 0 }, interpreter: { running: () => false } },
  });
  const enemy = { alive: true, hidden: false, b: new Battler(), battle: {}, fx: 1, fy: 1, h: 1.6,
    state: 'chase', knock: { x: 0, y: 0 }, worldPos: () => new THREE.Vector3(1, 0, 1), drawBar() {} };
  return { actor, combat, enemy, jobs, hits, flush() { while (jobs.length) jobs.shift()(); } };
}

// Trait values were checked against the installed original database: Hunter's
// Attire #6 EVA/MEV +10%, Counter Ring #241 CNT +100%, Mirror Greatshield #63 MRF +50%.
test('ordinary Hunter armor evasion prevents real physical and magical damage and their attached states without a riposte note', t => {
  const { actor, combat, enemy, jobs } = environment(t, [trait(22, 1, 0.1), trait(22, 4, 0.1)]);
  t.mock.method(Math, 'random', () => 0.05);
  for (const type of [1, 2]) {
    const attack = skill(900, type, '', '100'); attack.effects.push({ code: 21, data_id: 2, value1: 1 });
    combat.enemyStrikePlayer(enemy, attack);
    assert.equal(actor.hp, 1000); assert.equal(actor.isState(2), false); assert.equal(jobs.length, 0);
  }
});

test('failed evasion rolls, the correct physical/magic channel and absolute/sure hits retain incoming damage', t => {
  const { actor, combat, enemy } = environment(t, [trait(22, 1, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 2, '', '100')); assert.equal(actor.hp, 900, 'EVA cannot evade a magic attack');
  combat.enemyStrikePlayer(enemy, skill(900, 0, '', '100')); assert.equal(actor.hp, 800, 'sure hits ignore passive evasion');
  combat.enemyStrikePlayer(enemy, skill(900, 1, '<絶対命中>', '100')); assert.equal(actor.hp, 700);
  actor.gear.features = [trait(22, 1, 0.1)];
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); assert.equal(actor.hp, 600);
});

test('enemy passive evasion also avoids the real outgoing damage path without inventing a counter skill', t => {
  const { actor, combat, enemy, jobs } = environment(t); enemy.b.gear.features = [trait(22, 1, 0.1)];
  t.mock.method(Math, 'random', () => 0.05);
  assert.equal(combat.applyUsableToEnemy(enemy, skill(), new THREE.Vector3()), -1);
  assert.equal(enemy.b.hp, 1000); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 0);
});

test('Counter Ring answers only after the original incoming damage and deals real counter damage without spending MP', t => {
  const { actor, combat, enemy, jobs, flush } = environment(t, [trait(22, 6, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100'));
  assert.equal(actor.hp, 900, 'script173 counters do not negate the attack'); assert.equal(enemy.b.hp, 1000);
  assert.equal(jobs.length, 1); flush();
  assert.equal(enemy.b.hp, 880); assert.equal(actor.hp, 900); assert.equal(actor.mp, 100);
});

test('counter chance, highest original counter-skill note and the no-counter tag control the response', t => {
  const { actor, combat, enemy, flush, jobs } = environment(t, [trait(22, 6, 0.3)], '<反撃スキル 31>\n<反撃スキル 32>');
  // Original trait objects carry one selected note; add a separate feature source
  // so selection must inspect every piece of equipment/state, not only the first.
  actor.featureObjects = () => [{ features: [trait(22, 0, 1)], note: '' }, actor.gear, { note: '<反撃スキル 32>', features: [] }];
  t.mock.method(Math, 'random', () => 0.4); combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); assert.equal(jobs.length, 0);
  Math.random.mock.mockImplementation(() => 0.2); combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); flush();
  assert.equal(enemy.b.hp, 920);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '<反撃不可>', '100')); assert.equal(jobs.length, 0);
});

test('counter selection precedes reflection while a normal reflected spell precedes passive magic evasion', t => {
  const { actor, combat, enemy, flush } = environment(t, [trait(22, 6, 1), trait(22, 5, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 2, '<反撃可能>', '100'));
  assert.equal(actor.hp, 900); assert.equal(enemy.b.hp, 1000); flush(); assert.equal(enemy.b.hp, 880);
  actor.gear.features = [trait(22, 5, 1), trait(22, 4, 1)]; actor.hp = 1000; enemy.b.hp = 1000;
  combat.enemyStrikePlayer(enemy, skill(900, 2, '', '100'));
  assert.equal(actor.hp, 1000); assert.equal(enemy.b.hp, 900, 'MRF is resolved before the ordinary evasion roll');
});

test('dead, restrained, disarmed or occupied hands cannot auto-counter, and a vanished attacker cannot be hit later', t => {
  const { actor, combat, enemy, jobs, flush } = environment(t, [trait(22, 6, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  for (const key of ['disarmed', 'restrained', 'spectating', 'held', 'ready', 'gripAdjust']) {
    combat[key] = true; combat.enemyStrikePlayer(enemy, skill(900, 1, '', '1'));
    assert.equal(jobs.length, 0, key); combat[key] = false;
  }
  actor.addState(13); combat.enemyStrikePlayer(enemy, skill(900, 1, '', '1')); assert.equal(jobs.length, 0); actor.removeState(13);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '2000')); assert.equal(combat.playerDead, true); assert.equal(jobs.length, 0);
  combat.playerDead = false; actor.hp = 1000;
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); assert.equal(jobs.length, 1);
  enemy.alive = false; flush(); assert.equal(enemy.b.hp, 1000);
});

test('a multi-hit custom counter stays on its one attacker and cannot start another reflection invocation', t => {
  const { combat, enemy, flush } = environment(t, [trait(22, 6, 1)], '<反撃スキル 32>');
  $data.skills[32] = { ...skill(32, 2, '', '80'), scope: 2, repeats: 3 };
  enemy.b.gear.features = [trait(22, 5, 1)];
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); flush();
  assert.equal(enemy.b.hp, 760);
});

test('selected attack-first counters still answer an RPG miss, passive evasion and a perfect guard', t => {
  const { actor, combat, enemy, jobs, flush } = environment(t, [trait(22, 6, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  const attack = skill(900, 1, '', '100');
  enemy.b.gear.features = [trait(22, 0, -1)]; // default HIT 1 plus -1: the attack misses
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 1);
  flush(); assert.equal(enemy.b.hp, 880, 'missing the target does not cancel an already selected CNT');
  enemy.b.gear.features = []; actor.gear.features.push(trait(22, 1, 1));
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 1);
  flush(); assert.equal(enemy.b.hp, 760, 'passive EVA affects the attack application, not invocation selection');
  actor.gear.features = [trait(22, 6, 1)]; combat.isBlocking = () => true; combat.guardRaisedAt = G.time;
  combat.perfectGuardReward = () => {}; combat.guardTing = () => {};
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 1);
  flush(); assert.equal(enemy.b.hp, 640);
  G.player.invuln = 1;
  combat.enemyStrikePlayer(enemy, attack); assert.equal(jobs.length, 0, 'a spatial dodge excludes the attack before CNT selection');
});

test('normal-attack counters honor weapon attack-count traits while custom counters use their own repeats', t => {
  const { actor, combat, enemy, flush } = environment(t, [trait(22, 6, 1), trait(34, 0, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); flush();
  assert.equal(enemy.b.hp, 760, 'the normal attack and its extra weapon hit both land');
  actor.gear.note = '<反撃スキル 32>'; $data.skills[32].repeats = 2;
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); flush();
  assert.equal(enemy.b.hp, 600, 'normal-attack extras do not multiply a distinct counter skill');
});

test('a queued counter is canceled if its actor becomes unable to act or party leadership changes', t => {
  const { actor, combat, enemy, jobs, flush } = environment(t, [trait(22, 6, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); assert.equal(jobs.length, 1);
  actor.addState(13); flush(); assert.equal(enemy.b.hp, 1000);
  actor.removeState(13); combat.enemyStrikePlayer(enemy, skill(900, 1, '', '100')); assert.equal(jobs.length, 1);
  G.state.party.leader = () => new Battler(); flush(); assert.equal(enemy.b.hp, 1000);
});

// Original enemy skill 310 Death and skill 313 Death2 have no damage formula:
// their only hostile effect is state 1 at 90% / 30%, respectively.
function deathSkill(rate = 0.9, type = 2, note = '') {
  const death = skill(rate === 0.9 ? 310 : 313, type, note, '0'); death.damage.type = 0;
  death.effects = [{ code: 21, data_id: 1, value1: rate }]; return death;
}

test('Death and Death2 use their actual chance and enter the existing player fall flow after a real hit', t => {
  const { actor, combat, enemy, jobs } = environment(t, [trait(22, 6, 1)]);
  const killers = []; combat.playerFalls = killer => { killers.push(killer); combat.playerDead = true; };
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, deathSkill(0.3)); assert.equal(actor.hp, 1000); assert.equal(killers.length, 0);
  combat.enemyStrikePlayer(enemy, deathSkill(0.9));
  assert.equal(actor.hp, 0); assert.equal(actor.isState(1), true); assert.deepEqual(killers, [enemy.battle]);
  assert.equal(jobs.length, 0, 'a fatal hit cannot be answered with a counter');
});

test('incoming instant death respects death resistance, state rate, luck and original ignore-rate/luck tags', t => {
  const { actor, combat, enemy } = environment(t);
  t.mock.method(Math, 'random', () => 0.5);
  actor.gear.features = [trait(14, 1, 0)]; combat.enemyStrikePlayer(enemy, deathSkill(0.9, 2, '<強制付与>'));
  assert.equal(actor.hp, 1000, 'even forced application cannot bypass state resistance');
  actor.gear.features = [trait(13, 1, 0)]; combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(actor.hp, 1000);
  combat.enemyStrikePlayer(enemy, deathSkill(0.9, 2, '<有効度無視ステート付与>')); assert.equal(actor.hp, 0);
  actor.removeState(1); actor.hp = 1000; combat.playerDead = false;
  actor.gear.features = [trait(21, 7, 101)];
  assert.equal(actor.luk, 1010); assert.equal(enemy.b.luk, 10);
  combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(actor.hp, 1000, 'a full 1000-point LUK advantage makes the ordinary chance zero');
  combat.enemyStrikePlayer(enemy, deathSkill(0.9, 2, '<運無視ステート付与>')); assert.equal(actor.hp, 0);
});

test('a missed, evaded or perfectly guarded death spell never applies state 1, including sure hits against immune equipment', t => {
  const { actor, combat, enemy } = environment(t, [trait(22, 4, 1)]);
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(actor.hp, 1000);
  actor.gear.features = []; const missed = deathSkill(); missed.success_rate = 0;
  combat.enemyStrikePlayer(enemy, missed); assert.equal(actor.hp, 1000);
  combat.isBlocking = () => true; combat.guardRaisedAt = G.time;
  combat.perfectGuardReward = () => {}; combat.guardTing = () => {};
  combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(actor.hp, 1000); assert.equal(actor.isState(1), false);
  combat.isBlocking = () => false; actor.gear.features = [trait(14, 1, 0)];
  combat.enemyStrikePlayer(enemy, deathSkill(0.9, 0, '<絶対命中>')); assert.equal(actor.hp, 1000);
  actor.gear.features = []; G.player.invuln = 1;
  combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(actor.hp, 1000);
});

test('incoming death uses the real in-battle auto-revival and co-op fall paths instead of bypassing them', t => {
  const { actor, combat, enemy } = environment(t, [], '<自動蘇生:250,0>');
  t.mock.method(Math, 'random', () => 0.5);
  delete combat.playerFalls; combat.battles = [{}]; G.state.system.stateTimers = { 2: 5 };
  actor.addState(2); actor.addBuff(3, 8); let deaths = 0; combat.onPlayerDeath = () => deaths++;
  combat.enemyStrikePlayer(enemy, deathSkill());
  assert.equal(actor.hp, 250); assert.equal(actor.isState(1), false); assert.equal(actor.isState(2), false);
  assert.equal(actor.buffs[3], 0); assert.deepEqual(G.state.system.stateTimers, {}); assert.equal(deaths, 0);
  actor.gear = { features: [], note: '' }; let phantomFalls = 0;
  G.coop = { phantom: true, phantomFell: () => phantomFalls++ };
  combat.enemyStrikePlayer(enemy, deathSkill());
  assert.equal(actor.hp, 0); assert.equal(phantomFalls, 1); assert.equal(deaths, 0);
});

test('a reflected Death spell kills its original caster in either direction without reflecting a second time', t => {
  const { actor, combat, enemy, jobs } = environment(t, [trait(22, 5, 1)]);
  enemy.b.gear.features = [trait(22, 5, 1)];
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(combat.applyUsableToEnemy(enemy, deathSkill(), new THREE.Vector3()), -1);
  assert.equal(actor.hp, 0); assert.equal(actor.isState(1), true); assert.equal(combat.playerDead, true);
  assert.equal(enemy.b.hp, 1000); assert.equal(jobs.length, 0);
  actor.removeState(1); actor.hp = 1000; combat.playerDead = false;
  delete combat.checkEnemyDeath; let deaths = 0;
  combat.killEnemy = target => { deaths++; target.alive = false; };
  combat.enemyStrikePlayer(enemy, deathSkill());
  assert.equal(actor.hp, 1000); assert.equal(enemy.b.hp, 0); assert.equal(enemy.alive, false); assert.equal(deaths, 1);
  assert.equal(jobs.length, 0);
});

test('reflected death respects caster death resistance and state rate, including original ignore-rate and forced tags', t => {
  const { actor, combat, enemy } = environment(t, [trait(22, 5, 1)]);
  const mrf = trait(22, 5, 1); enemy.b.gear.features = [mrf];
  t.mock.method(Math, 'random', () => 0.5);
  actor.gear.features = [mrf, trait(14, 1, 0)];
  combat.applyUsableToEnemy(enemy, deathSkill(0.9, 2, '<強制付与>'), new THREE.Vector3()); assert.equal(actor.hp, 1000);
  actor.gear.features = [mrf, trait(13, 1, 0)];
  combat.applyUsableToEnemy(enemy, deathSkill(), new THREE.Vector3()); assert.equal(actor.hp, 1000);
  combat.applyUsableToEnemy(enemy, deathSkill(0.9, 2, '<有効度無視ステート付与>'), new THREE.Vector3()); assert.equal(actor.hp, 0);
  actor.removeState(1); actor.hp = 1000; combat.playerDead = false; actor.gear.features = [mrf];
  enemy.b.gear.features = [mrf, trait(14, 1, 0)];
  combat.enemyStrikePlayer(enemy, deathSkill(0.9, 2, '<強制付与>')); assert.equal(enemy.b.hp, 1000);
  enemy.b.gear.features = [mrf, trait(13, 1, 0)];
  combat.enemyStrikePlayer(enemy, deathSkill()); assert.equal(enemy.b.hp, 1000);
  combat.enemyStrikePlayer(enemy, deathSkill(0.9, 2, '<有効度無視ステート付与>')); assert.equal(enemy.b.hp, 0); assert.equal(enemy.alive, false);
});

test('reflected death uses the original spell caster for LUK rather than the reflecting battler', t => {
  const { actor, combat, enemy } = environment(t, [trait(22, 5, 1)]);
  const mrf = trait(22, 5, 1), highLuck = trait(21, 7, 101);
  t.mock.method(Math, 'random', () => 0.95);
  enemy.b.gear.features = [mrf, highLuck];
  combat.applyUsableToEnemy(enemy, deathSkill(), new THREE.Vector3());
  assert.equal(actor.hp, 1000, 'a high-LUK reflector must not raise the original player spell chance above 90%');
  actor.gear.features = [mrf, highLuck]; enemy.b.gear.features = [mrf];
  combat.enemyStrikePlayer(enemy, deathSkill());
  assert.equal(enemy.b.hp, 1000, 'the reflected enemy spell likewise retains its original caster LUK');
});

test('a player killed by their reflected Death spell retains the real battle death-save flow', t => {
  const { actor, combat, enemy } = environment(t, [], '<自動蘇生:250,0>');
  enemy.b.gear.features = [trait(22, 5, 1)];
  t.mock.method(Math, 'random', () => 0.5);
  delete combat.playerFalls; combat.battles = [{}]; G.state.system.stateTimers = { 2: 5 };
  actor.addState(2); actor.addBuff(3, 8); let deaths = 0; combat.onPlayerDeath = () => deaths++;
  combat.applyUsableToEnemy(enemy, deathSkill(), new THREE.Vector3());
  assert.equal(actor.hp, 250); assert.equal(actor.isState(1), false); assert.equal(actor.isState(2), false);
  assert.equal(actor.buffs[3], 0); assert.deepEqual(G.state.system.stateTimers, {}); assert.equal(deaths, 0);
  assert.equal(enemy.b.hp, 1000);
});

test('an enemy killed by its reflected Death spell retains the real enemy auto-revival flow', t => {
  const { actor, combat, enemy } = environment(t, [trait(22, 5, 1)]);
  enemy.b.gear = { features: [trait(22, 5, 1)], note: '<自動蘇生:250,0>' };
  t.mock.method(Math, 'random', () => 0.5);
  delete combat.checkEnemyDeath; let deaths = 0; combat.killEnemy = () => deaths++;
  enemy.b.addState(2); enemy.stateTimers = { 2: 5 }; enemy.b.addBuff(3, 8);
  combat.enemyStrikePlayer(enemy, deathSkill());
  assert.equal(enemy.b.hp, 250); assert.equal(enemy.alive, true); assert.equal(enemy.b.isState(1), false);
  assert.equal(enemy.b.isState(2), false); assert.equal(enemy.b.buffs[3], 0); assert.deepEqual(enemy.stateTimers, {});
  assert.equal(deaths, 0); assert.equal(actor.hp, 1000);
});

// Original Matango #48 has CRI 100% and critical-enabled Strong Hit #209.
// Resurrectionist's Ring #92 / Mercury Shield #168 have CEV 100%; the Winter
// Warrior armor pieces #234 / #235 have CEV 50% each.
test('incoming critical-enabled enemy damage uses the original double multiplier and actual player CEV', t => {
  const { actor, combat, enemy } = environment(t); enemy.b.gear.features = [trait(22, 2, 1)];
  const attack = skill(209, 1, '', '100'); attack.damage.critical = true;
  let roll = 0.49; t.mock.method(Math, 'random', () => roll);
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 800, 'CRI 100% doubles a real incoming 100-damage hit');
  actor.hp = 1000; actor.gear.features = [trait(22, 3, 1)];
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 900, 'CEV 100% suppresses only the critical, not the hit');
  actor.hp = 1000; actor.gear.features = [trait(22, 3, 0.5)];
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 800, 'the roll below CRI × (1−CEV) can still be critical');
  actor.hp = 1000; roll = 0.5;
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 900, 'a roll at the 50% boundary is an ordinary hit');
});

test('incoming zero or absent CRI, noncritical attacks and effect-only skills add no critical random roll', t => {
  const { actor, combat, enemy } = environment(t);
  let calls = 0; t.mock.method(Math, 'random', () => { calls++; return 0.5; });
  const attack = skill(209, 1, '', '100'); attack.damage.critical = true;
  const apply = () => { actor.hp = 1000; calls = 0; combat.enemyStrikePlayer(enemy, attack); return calls; };
  const noCriRolls = apply(); assert.equal(actor.hp, 900);
  enemy.b.gear.features = [trait(22, 2, 0)]; assert.equal(apply(), noCriRolls); assert.equal(actor.hp, 900);
  enemy.b.gear.features = [trait(22, 2, 1)]; attack.damage.critical = false;
  assert.equal(apply(), noCriRolls); assert.equal(actor.hp, 900);
  attack.damage.type = 0; const effectOnlyRolls = apply(); assert.equal(actor.hp, 1000);
  attack.damage.critical = true; assert.equal(apply(), effectOnlyRolls); assert.equal(actor.hp, 1000);
  attack.damage.type = 1; actor.gear.features = [trait(22, 3, 1)];
  assert.equal(apply(), noCriRolls); assert.equal(actor.hp, 900, 'complete critical immunity does not consume a futile roll');
});

test('critical formula damage does not double a compound skill percentage-HP effect', t => {
  const { actor, combat, enemy } = environment(t); enemy.b.gear.features = [trait(22, 2, 1)];
  const attack = skill(900, 1, '', '100'); attack.damage.critical = true;
  attack.effects = [{ code: 11, data_id: 0, value1: -0.1, value2: 0 }];
  t.mock.method(Math, 'random', () => 0.5);
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 700, '200 critical formula damage plus 100 percentage effect');
  actor.hp = 1000; combat.enemyStrikePlayer(enemy, attack, { mult: 0.5 });
  assert.equal(actor.hp, 850, 'the original incoming multiplier still scales both damage and the independent percentage effect');
  actor.hp = 1000; attack.damage.critical = false;
  combat.enemyStrikePlayer(enemy, attack, { mult: 0.5 }); assert.equal(actor.hp, 900);
});

test('critical enemy hits still respect perfect guards, misses, passive evasion and fatal counter gating', t => {
  const { actor, combat, enemy, jobs, flush } = environment(t, [trait(22, 6, 1)]);
  enemy.b.gear.features = [trait(22, 2, 1)];
  const attack = skill(209, 1, '', '100'); attack.damage.critical = true;
  t.mock.method(Math, 'random', () => 0.5);
  combat.isBlocking = () => true; combat.guardRaisedAt = G.time;
  combat.perfectGuardReward = () => {}; combat.guardTing = () => {};
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 1);
  flush(); assert.equal(enemy.b.hp, 880);
  combat.isBlocking = () => false; actor.gear.features = [trait(22, 1, 1)];
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000); assert.equal(jobs.length, 0);
  actor.gear.features = []; attack.success_rate = 0;
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 1000);
  attack.success_rate = 100; actor.hp = 150; actor.gear.features = [trait(22, 6, 1)];
  combat.enemyStrikePlayer(enemy, attack); assert.equal(actor.hp, 0); assert.equal(combat.playerDead, true); assert.equal(jobs.length, 0);
});

test('innate enemy HP regeneration works without timed states, respects its turn and never exceeds max HP', t => {
  const { combat, enemy } = environment(t); enemy.b.gear.features = [trait(22, 7, 0.05)]; enemy.b.hp = 500;
  combat.tickEnemyStates(enemy, 1); assert.equal(enemy.b.hp, 500);
  combat.tickEnemyStates(enemy, 1); assert.equal(enemy.b.hp, 550);
  enemy.stateTimers = {}; enemy.b.hp = 980; combat.tickEnemyStates(enemy, 2); assert.equal(enemy.b.hp, 1000);
  enemy.b.hp = 0; combat.tickEnemyStates(enemy, 2); assert.equal(enemy.b.hp, 0);
  enemy.b.hp = 500; enemy.alive = false; combat.tickEnemyStates(enemy, 2); assert.equal(enemy.b.hp, 500);
});

test('regeneration ticks preserve negative HP effects, MP regeneration and expired-state cleanup', t => {
  const { combat, enemy } = environment(t); enemy.b.gear.features = [trait(22, 7, -0.05), trait(22, 8, 0.1)]; enemy.b.mp = 50;
  combat.tickEnemyStates(enemy, 2); assert.equal(enemy.b.hp, 950); assert.equal(enemy.b.mp, 60);
  enemy.b.gear.features = []; enemy.b.hp = 500; enemy.b.addState(14); enemy.stateTimers = { 14: 1 };
  combat.tickEnemyStates(enemy, 2); assert.equal(enemy.b.isState(14), false); assert.equal(enemy.b.hp, 500);
  assert.deepEqual(enemy.stateTimers, {});
});

test('player equipment regeneration, state/buff expiry and pause gating remain active', t => {
  const { actor, combat } = environment(t, [trait(22, 7, 0.03), trait(22, 8, 0.05)]);
  actor.hp = 500; actor.mp = 50; combat.battles = [{}]; actor.addBuff(3, 1); actor.addState(2); G.state.system.stateTimers = { 2: 1 };
  combat.updateActorStates(2, true); assert.equal(actor.hp, 500); assert.equal(actor.buffs[3], 1); assert.equal(actor.isState(2), true);
  combat.updateActorStates(2, false); assert.equal(actor.buffs[3], 0); assert.equal(actor.isState(2), false);
  combat.updateActorStates(4, false); assert.equal(actor.hp, 530); assert.equal(actor.mp, 55);
});
