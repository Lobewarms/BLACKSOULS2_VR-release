import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase, GameState } from '../src/game/state.js';
import { battlerEffects } from '../src/ui/battler-status.js';

globalThis.addEventListener ||= () => {};
const { ActionEnemy, CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value) => ({ code, data_id, value });
const attack = (id = 1, changes = {}) => ({ id, name: 'Synthetic attack', note: '', hit_type: 1, success_rate: 100,
  scope: 1, repeats: 1, animation_id: 0, effects: [{ code: 21, data_id: 0, value1: 1 }],
  damage: { type: 1, formula: 'a.atk * 4 - b.def * 2', element_id: -1, variance: 0, critical: true }, ...changes });

function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  t.mock.method(Math, 'random', () => 0.5);
  const stats = [500, 100, 10, 10, 12, 8, 15, 100];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Player', class_id: 1, initial_level: 1, equips: [1, 1], features: [], note: '' }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], features: [trait(22, 0, 1)], note: '',
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [null, { id: 1, name: 'Weapon', params: [0, 0, 20, 0, 0, 0, 0, 0],
      note: '', features: [trait(31, 1, 0)], animation_id: 0 }],
    armors: [null, { id: 1, params: Array(8).fill(0), features: [], note: '' }],
    skills: [null, attack()], states: [], items: [],
  });
  for (const id of [1, 13, 26, 29, 90]) $data.states[id] = { id, name: `State ${id}`, note: '', features: [],
    restriction: 0, auto_removal_timing: 0, min_turns: 1, max_turns: 1 };
  Object.assign(G, { state: new GameState(), scripts: {}, map: null, vr: false, time: 1, frame: 1,
    coop: null, arena: null, theater: null, audio: null, settings: { ...G.settings, breakRule: 'original' },
    screen: { playAnimationOn() {} }, input: { haptic() {} }, ui: { toast() {} } });
  G.state.party.actors = [1];
  const actor = G.state.actor(1), pending = [], projectiles = [], killed = [];
  class Target extends BattlerBase {
    constructor() { super(); this.features = []; this.values = [100000, 100, 10, 10, 10, 8, 10, 100]; this.hp = this.mhp; }
    featureObjects() { return [{ features: this.features, note: '' }, ...super.featureObjects()]; }
    paramBase(id) { return this.values[id]; }
  }
  const enemy = Object.assign(Object.create(ActionEnemy.prototype), { b: new Target(), state: 'chase', h: 1.8,
    fx: 0, fy: 0, battle: {}, knock: { x: 0, y: 0 }, group: new THREE.Group(), drawBar() {} });
  const combat = Object.assign(Object.create(CombatSystem.prototype), {
    symbols: new Map(), powerUntil: 0, shotKind: 'gun', weapon: new THREE.Group(), disarmed: false,
    heldBoss: () => false, slipsWithAnswer: () => null, groggyHit() {}, damageRemovesStates() {},
    popup() {}, popupAtPlayer() {}, spawnGlow() {}, applyBuffEffects: () => false, checkEnemyDeath() {},
    killEnemy(e) { e.b.addState(1); e.state = 'dead'; killed.push(e); },
    takeArmedSkill: () => null, afterPlayerAction() {}, hitPoint: () => new THREE.Vector3(),
    later(delay, fn) { pending.push({ delay, fn }); },
    muzzle: () => new THREE.Vector3(), aimRay: () => ({ dir: new THREE.Vector3(0, 0, -1) }),
    spawnProjectile(from, dir, options) { projectiles.push({ from, dir, ...options }); },
    breakArmed: () => null,
  });
  G.combat = combat;
  const flush = () => { while (pending.length) pending.shift().fn(); };
  const hit = () => combat.playerHitEnemy(enemy, 1, false, new THREE.Vector3());
  return { actor, enemy, combat, hit, flush, projectiles, killed };
}

test('equipped ATK and MAT change the actual selected normal-attack formula', t => {
  const { actor, enemy, hit } = environment(t);
  let hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 100);
  actor.equips[0].id = 0;
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 20, 'removing +20 ATK lowers damage');
  $data.weapons[2] = { id: 2, name: 'MAT blade', note: '<攻撃ID変更:2>', features: [trait(31, 1, 0)],
    params: [0, 0, 20, 0, 30, 0, 0, 0], animation_id: 0 };
  actor.equips[0].id = 2;
  $data.skills[2] = attack(2, { damage: { type: 1, formula: 'a.mat * 4 - b.mdf * 2', element_id: -1, variance: 0, critical: true } });
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 152, 'a MAT-based blade uses its real MAT instead of ATK');
});

test('resin state elements affect real weapon damage and fixed skill elements remain authoritative', t => {
  const { actor, enemy, combat, hit } = environment(t);
  enemy.b.features.push(trait(11, 3, 2));
  const resin = { effects: [{ code: 21, data_id: 90, value1: 1 }] };
  $data.states[90].features = [trait(31, 3, 0)];
  assert.equal(combat.isResin(resin), true);
  let hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 100);
  actor.addState(90);
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 200, 'the resin uses the target fire weakness');
  $data.skills[1].damage.element_id = 1;
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 100, 'an explicitly fixed element is not replaced by resin');
  actor.removeState(90);
  $data.skills[1].damage.element_id = -1;
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 100, 'removing the resin removes its benefit');
});

test('normal-attack state rates add across equipment and roll once per distinct state', t => {
  const { actor, enemy, hit } = environment(t);
  $data.weapons[1].features.push(trait(32, 26, 0.3));
  $data.armors[1].features.push(trait(32, 26, 0.4));
  t.mock.method(Math, 'random', () => 0.65);
  assert.deepEqual(actor.atkStates(), [26]); assert.equal(actor.atkStatesRate(26), 0.7);
  hit(); assert.equal(enemy.b.isState(26), true, '0.3 + 0.4 beats a0.65 roll; independent rolls would both fail');
  enemy.b.removeState(26); enemy.b.features.push(trait(14, 26, 0));
  hit(); assert.equal(enemy.b.isState(26), false, 'state immunity is absolute');
});

test('weapon procs respect LUK, susceptibility and explicit ignore tags without bypassing immunity', t => {
  const { enemy, hit } = environment(t);
  $data.weapons[1].features.push(trait(32, 29, 1));
  enemy.b.values[7] = 2100;
  hit(); assert.equal(enemy.b.isState(29), false, 'a2000 LUK deficit makes the normal proc impossible');
  $data.skills[1].note = '<運無視ステート付与>';
  hit(); assert.equal(enemy.b.isState(29), true);
  enemy.b.removeState(29); enemy.b.features.push(trait(13, 29, 0));
  hit(); assert.equal(enemy.b.isState(29), false, 'ignoring luck still respects susceptibility');
  $data.skills[1].note = '<強制付与>';
  hit(); assert.equal(enemy.b.isState(29), true, 'the original forced tag ignores luck and susceptibility');
  enemy.b.removeState(29); enemy.b.features.push(trait(14, 29, 0));
  hit(); assert.equal(enemy.b.isState(29), false);
});

test('weapon death traits can kill and death-resistant enemies remain alive', t => {
  const { enemy, hit, killed } = environment(t);
  $data.weapons[1].features.push(trait(32, 1, 0.8));
  enemy.b.features.push(trait(14, 1, 0));
  hit(); assert.equal(enemy.alive, true); assert.equal(killed.length, 0);
  enemy.b.features.length = 0;
  hit(); assert.equal(enemy.b.hp, 0); assert.equal(enemy.b.isState(1), true); assert.equal(killed.length, 1);
});

function stunWeapon(t) {
  const e = environment(t);
  // Synthetic fixture: the installed Great Sword has attack-state 13 at 80%.
  // Stun restricts actions and lasts one enemy turn; use the normal state path.
  $data.weapons[1].features.push(trait(32, 13, 0.8));
  Object.assign($data.states[13], { name: 'Stun', icon_index: 21, restriction: 4, auto_removal_timing: 1 });
  return e;
}

test('weapon stun interrupts an enemy attack, appears in its effects and expires before AI can act again', t => {
  const { enemy, combat, hit } = stunWeapon(t);
  enemy.state = 'windup'; enemy.timer = 1; enemy.act = {}; enemy.move = 'charge'; enemy.marker = {};
  combat.fadingMarkers = [];
  hit();
  assert.equal(enemy.b.isState(13), true, 'weapon stun must apply the real status, not only reduce the groggy gauge');
  assert.equal(enemy.state, 'recover'); assert.equal(enemy.act, null); assert.equal(enemy.move, null);
  assert.equal(enemy.marker, null); assert.equal(combat.fadingMarkers.length, 1);
  assert.equal(enemy.stateTimers[13], 2);
  assert.deepEqual(battlerEffects(enemy.b).map(effect => [effect.name, effect.icon]), [['Stun', 21]]);
  combat.enemyAI(enemy, 1.5, { fx: 0, fy: 0 }, 0);
  assert.equal(enemy.state, 'recover', 'the restricted enemy cannot start another attack');
  combat.tickEnemyStates(enemy, 2);
  assert.equal(enemy.b.isState(13), false); assert.equal(combat.enemyRestricted(enemy), false);
  combat.enemyAI(enemy, 0.3, { fx: 0, fy: 0 }, 0);
  assert.equal(enemy.state, 'chase', 'normal AI resumes after stun expires');
  assert.deepEqual(battlerEffects(enemy.b), []);
});

test('weapon stun observes the 80% boundary, enemy susceptibility, immunity and missed attacks', t => {
  const { enemy, hit } = stunWeapon(t);
  Math.random.mock.mockImplementation(() => 0.8); hit(); assert.equal(enemy.b.isState(13), false);
  Math.random.mock.mockImplementation(() => 0.79); hit(); assert.equal(enemy.b.isState(13), true);
  enemy.b.removeState(13); enemy.b.features = [trait(13, 13, 0.5)];
  Math.random.mock.mockImplementation(() => 0.4); hit(); assert.equal(enemy.b.isState(13), false);
  Math.random.mock.mockImplementation(() => 0.39); hit(); assert.equal(enemy.b.isState(13), true);
  enemy.b.removeState(13); enemy.b.features = [trait(14, 13, 0)];
  hit(); assert.equal(enemy.b.isState(13), false);
  enemy.b.features = []; $data.weapons[1].features.push(trait(22, 0, -1));
  hit(); assert.equal(enemy.b.isState(13), false, 'a missed physical hit cannot apply stun');
});

test('VR weapon hits and direct stun skills retain the same real status application', t => {
  const { enemy, combat, hit } = stunWeapon(t); G.vr = true;
  hit(); assert.equal(enemy.b.isState(13), true); assert.equal(combat.enemyRestricted(enemy), true);
  enemy.b.removeState(13);
  const skill = attack(2, { effects: [{ code: 21, data_id: 13, value1: 0.8 }] });
  combat.applyUsableToEnemy(enemy, skill, null);
  assert.equal(enemy.b.isState(13), true); assert.equal(enemy.stateTimers[13], 2);
});

test('stun weapons retain ordinary groggy buildup without converting their stun rate into a second groggy bonus', t => {
  const { actor, enemy, combat, hit } = stunWeapon(t);
  delete combat.groggyHit;
  enemy.b.enemyId = 1; enemy.b.data = { features: [] };
  combat.groggyMax(enemy); const full = enemy.grog;
  hit();
  assert.equal(enemy.b.isState(13), true);
  assert.ok(Math.abs(full - enemy.grog - actor.atk) < 1e-8);
  assert.ok(enemy.grog > 0); assert.notEqual(enemy.state, 'stagger', 'stun does not require emptying the independent groggy gauge');
});

test('dagger repetitions and upgraded machine-gun traits deliver every real hit', t => {
  const { enemy, hit, flush } = environment(t);
  $data.skills[1].repeats = 2;
  let hp = enemy.b.hp; hit(); flush(); assert.equal(hp - enemy.b.hp, 200);
  $data.skills[1].repeats = 1;
  $data.weapons[1].features.push(trait(34, 0, 9), trait(34, 0, 2));
  hp = enemy.b.hp; hit(); flush(); assert.equal(hp - enemy.b.hp, 1200, 'the +9 and +2 traits produce twelve hits');
});

test('a twelve-round ranged volley preserves one-hit projectile semantics and bounded queues', t => {
  const { actor, enemy, combat, flush, projectiles } = environment(t);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0.75, 1, 1.5); camera.updateMatrixWorld();
  G.three = { camera }; G.map = { mapId: 1, validW: () => true }; G.floorAt = () => 0;
  enemy.hr = 0.2;
  combat.allTargets = () => [enemy];
  assert.equal(combat.readyAim().enemy, enemy, 'the ranged volley starts with a real target in the camera ray');
  $data.weapons[1].features.push(trait(34, 0, 9), trait(34, 0, 2));
  combat.fireRanged(); flush(); assert.equal(projectiles.length, 12);
  assert.ok(projectiles.every(p => p.one === true));
  const hp = enemy.b.hp;
  for (const projectile of projectiles) combat.playerHitEnemy(enemy, 1, false, projectile.from, { one: projectile.one });
  flush(); assert.equal(hp - enemy.b.hp, 1200, 'twelve rounds do not multiply into144 hits on impact');
  $data.weapons[1].features = [trait(34, 0, 1e12)];
  assert.equal(combat.attackHits($data.skills[1], actor), 64);
  $data.weapons[1].features = [trait(34, 0, Infinity)];
  assert.equal(combat.attackHits({ repeats: NaN, scope: 1 }, actor), 1);
});

test('the selected drain attack restores HP through the real damage runtime', t => {
  const { actor, enemy, hit } = environment(t);
  actor.hp = 100;
  $data.weapons[1].note = '<攻撃ID変更:2>';
  $data.skills[2] = attack(2, { note: '<変換攻撃判定:100>\n<HP変換攻撃:50,100>',
    damage: { type: 1, formula: '80', element_id: 0, variance: 0, critical: false } });
  const hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 80); assert.equal(actor.hp, 140);
});

test('skill penetration accepts both game spellings once and preserves element immunity and vulnerabilities', t => {
  const { enemy, hit } = environment(t);
  enemy.b.features.push(trait(23, 6, 0.2));
  let hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 20);
  $data.skills[1].note = '<ダメージ率貫通:1,50>';
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 60);
  $data.skills[1].note += '\n<ダメージ率貫通追加:50>';
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 60, 'equivalent skill tags do not stack twice');
  $data.weapons[1].note = '<ダメージ率貫通:1,50>';
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 100, 'feature penetration adds to the skill bonus');
  enemy.b.features.push(trait(11, 1, 0));
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 0, 'damage-rate penetration never defeats elemental immunity');
  enemy.b.features = [trait(23, 6, 2)];
  hp = enemy.b.hp; hit(); assert.equal(hp - enemy.b.hp, 200, 'a damage vulnerability is not reduced by penetration');
});

test('physical and magical penetration use their matching hit type, including original zero-rate behavior', t => {
  const { actor, enemy, combat } = environment(t);
  enemy.b.features.push(trait(23, 6, 0), trait(23, 7, 0.4));
  const skill = attack(2, { effects: [], note: '<ダメージ率貫通:1,100>' });
  assert.equal(combat.computeDamage(actor, enemy.b, skill), 100, 'original penetration also bypasses a zero PDR');
  skill.hit_type = 2;
  assert.equal(combat.computeDamage(actor, enemy.b, skill), 40, 'physical penetration does not pierce MDR');
  skill.note = '<ダメージ率貫通:2,50>';
  assert.equal(combat.computeDamage(actor, enemy.b, skill), 70);
  skill.note = '<ダメージ率貫通:2,5000>';
  assert.equal(combat.computeDamage(actor, enemy.b, skill), 100, 'malformed excessive percentages cannot amplify damage');
});

function hardBreakClub(t) {
  const e = environment(t);
  // Synthetic metadata for a club with Hard Break, Stun60% and a critical buff
  // skill. These traits are the same mechanisms used by King Club #166.
  $data.weapons[1].features.push(trait(32, 7, 1), trait(43, 110, 0), trait(32, 13, 0.6));
  $data.states[7] = { id: 7, name: 'Hard Break', note: '', icon_index: 8, restriction: 4,
    auto_removal_timing: 1, min_turns: 2, max_turns: 2,
    features: [trait(23, 6, 3), trait(23, 7, 3), trait(13, 7, 0), trait(13, 8, 0), trait(14, 13, 0)] };
  $data.states[8] = { id: 8, name: 'Break', note: '', restriction: 4, auto_removal_timing: 1,
    min_turns: 2, max_turns: 2, features: [] };
  Object.assign($data.states[13], { name: 'Stun', restriction: 4, auto_removal_timing: 1 });
  Object.assign(e.enemy, { alertTime: 0, cooldown: 0, r: 0.4, timer: 1 });
  e.combat.fadingMarkers = [];
  return e;
}

test('weapon Hard Break enters the real stagger lifecycle and prevents AI recovery until its 3.2-second opening ends', t => {
  const { actor, enemy, combat, hit } = hardBreakClub(t);
  Object.assign(enemy, { state: 'windup', act: {}, move: 'charge', marker: {} });
  hit();
  assert.equal(enemy.b.isState(7), true); assert.equal(enemy.state, 'stagger'); assert.equal(enemy.timer, 3.2);
  assert.equal(enemy.marker, null); assert.equal(combat.fadingMarkers.length, 1);
  assert.equal(enemy.b.pdr, 3); assert.equal(enemy.b.mdr, 3);
  assert.equal(combat.computeDamage(actor, enemy.b, $data.skills[1]), 300, 'the original native triple-damage vulnerability remains');
  assert.equal(enemy.b.isState(13), false, 'Hard Break itself makes Stun immune, matching the original state metadata');
  combat.enemyAI(enemy, 3.19, { fx: 0, fy: 0 }, 0);
  assert.equal(enemy.state, 'stagger'); assert.equal(enemy.b.isState(7), true);
  combat.enemyAI(enemy, 0.02, { fx: 0, fy: 0 }, 0);
  assert.equal(enemy.state, 'chase'); assert.equal(enemy.b.isState(7), false); assert.equal(enemy.b.pdr, 1);
});

test('normal weapon Break procs retain native susceptibility, LUK, immunity and accuracy before entering stagger', t => {
  const { enemy, hit } = hardBreakClub(t);
  enemy.b.features = [trait(13, 7, 0.5), trait(14, 13, 0)]; enemy.b.values[7] = 600;
  Math.random.mock.mockImplementation(() => 0.25); hit(); assert.equal(enemy.b.isState(7), false);
  Math.random.mock.mockImplementation(() => 0.249); hit(); assert.equal(enemy.state, 'stagger');
  enemy.b.removeState(7); enemy.state = 'chase';
  enemy.b.features = [trait(14, 7, 0), trait(14, 13, 0)];
  Math.random.mock.mockImplementation(() => 0); hit(); assert.equal(enemy.b.isState(7), false);
  enemy.b.features = []; $data.weapons[1].features.push(trait(22, 0, -1));
  Math.random.mock.mockImplementation(() => 0.5); hit(); assert.equal(enemy.b.isState(7), false); assert.equal(enemy.b.isState(13), false);
});

test('a companion weapon Break uses its own traits and the same stagger path rather than the leader traits', t => {
  const { actor, enemy, combat } = hardBreakClub(t);
  $data.actors[2] = { ...$data.actors[1], id: 2, name: 'Synthetic companion' };
  const companion = G.state.actor(2); actor.equips[0].id = 0;
  assert.deepEqual(actor.atkStates(), []); assert.deepEqual(companion.atkStates(), [7, 13]);
  combat.applyUsableToEnemy(enemy, $data.skills[1], null, { by: companion });
  assert.equal(enemy.state, 'stagger'); assert.equal(enemy.b.isState(7), true); assert.equal(enemy.timer, 3.2);
  enemy.b.removeState(7); enemy.state = 'chase';
  $data.weapons[1].features = [trait(32, 8, 1)];
  combat.applyUsableToEnemy(enemy, $data.skills[1], null, { by: companion });
  assert.equal(enemy.state, 'stagger'); assert.equal(enemy.b.isState(8), true); assert.equal(enemy.timer, 2.2);
});

test('club Stun60% still applies when Hard Break fails and respects susceptibility and immunity', t => {
  const { enemy, hit } = hardBreakClub(t); enemy.b.features = [trait(13, 7, 0)];
  Math.random.mock.mockImplementation(() => 0.6); hit(); assert.equal(enemy.b.isState(13), false);
  Math.random.mock.mockImplementation(() => 0.59); hit(); assert.equal(enemy.b.isState(13), true);
  assert.equal(enemy.stateTimers[13], 2);
  enemy.b.removeState(13); enemy.b.features = [trait(13, 7, 0), trait(13, 13, 0.5)];
  Math.random.mock.mockImplementation(() => 0.3); hit(); assert.equal(enemy.b.isState(13), false);
  Math.random.mock.mockImplementation(() => 0.29); hit(); assert.equal(enemy.b.isState(13), true);
  enemy.b.removeState(13); enemy.b.features = [trait(13, 7, 0), trait(14, 13, 0)];
  Math.random.mock.mockImplementation(() => 0); hit(); assert.equal(enemy.b.isState(13), false);
});

test('the club critical buff skill grants its real 30-point CRI increase for the current adapted duration', t => {
  const { actor, combat } = hardBreakClub(t);
  $data.states[45] = { id: 45, name: 'Critical buff', note: '', restriction: 0,
    auto_removal_timing: 1, min_turns: 3, max_turns: 3, features: [trait(22, 2, 0.3)] };
  const skill = $data.skills[110] = attack(110, { scope: 11, hit_type: 0, note: '<クールタイム:3>', mp_cost: 4,
    damage: { type: 0 }, effects: [{ code: 21, data_id: 45, value1: 1 }] });
  combat.skillCD = {}; combat.battles = [];
  assert.ok(actor.allSkills().includes(skill));
  const beforeMp = actor.mp, beforeCri = actor.cri;
  combat.payUsable(skill, 'skill'); combat.applyUsableToActor(skill, 'quick');
  assert.equal(beforeMp - actor.mp, 4); assert.equal(actor.cri - beforeCri, 0.3);
  assert.equal(G.state.system.stateTimers[45], 18); assert.equal(combat.skillCD[110] - G.time, 4.5);
  combat.updateActorStates(18, false);
  assert.equal(actor.isState(45), false); assert.equal(actor.cri, beforeCri);
});
