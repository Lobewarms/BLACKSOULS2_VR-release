import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase, GameState } from '../src/game/state.js';

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
    popup() {}, popupAtPlayer() {}, applyBuffEffects: () => false, checkEnemyDeath() {},
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
