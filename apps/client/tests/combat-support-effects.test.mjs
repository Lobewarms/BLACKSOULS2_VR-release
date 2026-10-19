import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase, GameActor } from '../src/game/state.js';
import { AllySystem } from '../src/entities/allies.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const skill = (type = 0, formula = '0', effects = [], extra = {}) => ({ __class: 'RPG::Skill', id: 900,
  name: 'Synthetic support', note: '', scope: 11, repeats: 1, hit_type: 0, success_rate: 100,
  damage: { type, formula, variance: 0, element_id: 0, critical: false }, effects, ...extra });
const effect = (code, data_id, value1 = 1, value2 = 0) => ({ code, data_id, value1, value2 });
class Battler extends BattlerBase {
  constructor(id, mat = 100, features = [], note = '') {
    super(); this.id = id; this.mag = mat; this.gear = { features, note }; this.hp = 1000; this.mp = 0; this.skills = [];
  }
  paramBase(i) { return [10000, 1000, 100, 10, this.mag, 10, 10, 10][i]; }
  featureObjects() { return [this.gear, ...super.featureObjects()]; }
  skillMpCost(s) { return GameActor.prototype.skillMpCost.call(this, s); }
  skillCostPayable(s) { return GameActor.prototype.skillCostPayable.call(this, s); }
  paySkillCost(s) { return GameActor.prototype.paySkillCost.call(this, s); }
  skillSealed(s) { return GameActor.prototype.skillSealed.call(this, s); }
  skillTypeUsable() { return true; }
  allSkills() { return GameActor.prototype.allSkills.call(this); }
}
function setup(t) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.states = [];
  for (const id of [1, 2, 3]) $data.states[id] = { id, note: '', features: [], min_turns: 2, max_turns: 2, auto_removal_timing: 2 };
  $data.skills = []; $data.system = { sounds: [] };
  const actor = new Battler(1), ally = new Battler(2, 20), dead = new Battler(3), fourth = new Battler(4), bench = new Battler(5);
  dead.hp = 0;
  const actors = [actor, ally, dead, fourth, bench], globals = [], popups = [], falls = [], redraws = [];
  const unit = { id: 2, members: () => [ally], drawBar: () => redraws.push('ally') };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    battles: [], symbols: new Map(), enemies: [], skillCD: {}, root: new THREE.Group(),
    allies: { list: [unit], unitOf: id => id === 2 ? unit : null, showHeal() {} },
    popupAtPlayer: value => popups.push(value), slipHurt() {}, spawnGlow() {},
    itemGlobalEffects: obj => { for (const e of obj.effects || []) if (e.code === 44) globals.push(e.data_id); },
    playerFalls: () => falls.push('player'), checkEnemyDeath(e) { if (e.b.hp <= 0 && !e.b.stateResist(1)) e.alive = false; },
    playerFollowUp() {}, actorUserEffect() {}, stageCool() {}, coolSeconds: () => 0,
  });
  Object.assign(G, { state: { system: {}, party: { actors: actors.map(a => a.id), leader: () => actor, members: () => actors } },
    map: { reserveCommonEvent: id => globals.push(id), playerChar: {} }, scripts: {}, time: 2, coop: null,
    audio: null, ui: { closeMenu() {}, toast() {} }, settings: {}, screen: { playAnimationOn() {} },
    input: { haptic() {} }, vr: false,
  });
  t.mock.method(Math, 'random', () => 0.5);
  const enemy = (b = new Battler(20)) => ({ b, alive: true, hidden: false, h: 2,
    worldPos: () => new THREE.Vector3(2, 0, 2), drawBar: () => redraws.push('enemy') });
  return { combat, actor, ally, dead, fourth, bench, globals, popups, falls, redraws, enemy };
}

test('self conversion formula pays HP and restores MP; MP damage and self drains use the correct resource', t => {
  const { combat, actor, falls } = setup(t);
  // Installed skill145 has a300HP formula and a flat100MP recovery effect.
  combat.applyUsableToActor(skill(1, '300', [effect(12, 0, 0, 100)]), 'quick');
  assert.equal(actor.hp, 700); assert.equal(actor.mp, 100);
  combat.applyUsableToActor(skill(2, '40'), 'quick'); assert.equal(actor.hp, 700); assert.equal(actor.mp, 60);
  combat.applyUsableToActor(skill(6, '100'), 'quick'); assert.equal(actor.mp, 60, 'a self drain returns only the amount actually lost');
  assert.deepEqual(falls, []);
});

test('friendly formula damage uses normal element/rate/variance rules and triggers the existing death path', t => {
  const { combat, actor, falls } = setup(t);
  actor.gear.features = [{ code: 23, data_id: 6, value: 0.5 }];
  const obj = skill(1, '300', [], { hit_type: 1 });
  combat.applyUsableToActor(obj, 'quick'); assert.equal(actor.hp, 850);
  actor.hp = 10; combat.applyUsableToActor(obj, 'quick');
  assert.equal(actor.hp, 0); assert.deepEqual(falls, ['player']);
});

test('three-repeat support heals run formula and effects per pass while global events run once', t => {
  const { combat, actor, globals } = setup(t);
  // Installed skill803: MAT*12 and5%MHP, repeated three times.
  combat.applyUsableToActor(skill(3, 'a.mat * 12', [effect(11, 1, 0.05), effect(44, 40)], { repeats: 3 }), 'quick');
  assert.equal(actor.hp, 6100); assert.deepEqual(globals, [40]);
});

test('all-friend support changes living battle members once and leaves dead and reserve members alone', t => {
  const { combat, actor, ally, dead, fourth, bench, globals } = setup(t);
  combat.applyUsableToActor(skill(3, 'a.mat * 6', [effect(31, 2, 2), effect(44, 44)], { scope: 8 }), 'quick');
  assert.deepEqual([actor.hp, ally.hp, fourth.hp], [1600, 1600, 1600]);
  assert.equal(dead.hp, 0); assert.equal(bench.hp, 1000);
  assert.deepEqual([actor.buffs[2], ally.buffs[2], fourth.buffs[2]], [1, 1, 1]);
  assert.equal(bench.buffs[2], 0); assert.deepEqual(globals, [44]);
});

test('explicit companion recipient uses caster MAT and item PHA, recipient REC, recovery inversion and state immunity', t => {
  const { combat, actor, ally } = setup(t);
  actor.gear.features = [{ code: 23, data_id: 3, value: 2 }]; // item knowledge
  ally.gear.features = [{ code: 23, data_id: 2, value: 0.5 }, { code: 14, data_id: 2, value: 1 }];
  const obj = skill(3, 'a.mat * 6', [effect(11, 0, 0, 100), effect(21, 2)], { __class: 'RPG::Item' });
  combat.applyUsableToActor(obj, 'ally', { target: ally, user: actor, global: false });
  assert.equal(ally.hp, 1400); assert.equal(actor.hp, 1000); assert.equal(ally.isState(2), false);
  ally.gear = { features: ally.gear.features, note: '<HP回復反転:100>' };
  combat.applyUsableToActor(skill(3, '100'), 'ally', { target: ally, user: actor });
  assert.equal(ally.hp, 1350);
});

test('self scope stays on caster, cancellation is per recipient, and death immunity blocks friendly death effects', t => {
  const { combat, actor, ally, globals } = setup(t);
  ally.skillCanceled = () => true;
  combat.applyUsableToActor(skill(3, '100', [effect(44, 10)], { scope: 8 }), 'quick');
  assert.equal(actor.hp, 1100); assert.equal(ally.hp, 1000); assert.deepEqual(globals, [10]);
  actor.gear.features = [{ code: 14, data_id: 1, value: 1 }];
  combat.applyUsableToActor(skill(0, '0', [effect(21, 1)]), 'quick');
  assert.equal(actor.hp, 1100); assert.equal(actor.isState(1), false);
  combat.applyUsableToActor(skill(3, '100'), 'quick'); assert.equal(ally.hp, 1000);
});

test('menu and quick casts pay once for all party recipients and repeats', t => {
  const { combat, actor, ally } = setup(t);
  const obj = skill(3, '100', [], { scope: 8, repeats: 3, mp_cost: 10, tp_cost: 0, occasion: 0, animation_id: 0 });
  $data.skills[obj.id] = obj; actor.skills.push(obj.id);
  actor.mp = 100;
  assert.equal(combat.useSkillFromMenu(obj), true);
  assert.equal(actor.mp, 90); assert.equal(actor.hp, 1300); assert.equal(ally.hp, 1300);
  assert.equal(combat.performUsable(obj, 'skill'), true);
  assert.equal(actor.mp, 80); assert.equal(actor.hp, 1600); assert.equal(ally.hp, 1600);
});

test('enemy self healing executes formula, repeated HP/MP recovery and recipient recovery rules', t => {
  const { combat, enemy, globals } = setup(t);
  const e = enemy();
  combat.applySkillToSelf(e, skill(3, 'a.mat * 6'));
  assert.equal(e.b.hp, 1600);
  combat.applySkillToSelf(e, skill(0, '0', [effect(11, 0, 0.1), effect(12, 0, 0.5)], { repeats: 3 }));
  assert.equal(e.b.hp, 4600); assert.equal(e.b.mp, 1000);
  e.b.gear = { features: [], note: '<MP回復反転:100>' }; e.b.mp = 100;
  combat.applySkillToSelf(e, skill(0, '0', [effect(12, 0, 0, 30), effect(44, 40)]));
  assert.equal(e.b.mp, 70); assert.deepEqual(globals, [], 'enemy action dispatch owns its global event');
});

test('enemy all-friend formula uses the original caster for every target and respects target REC', t => {
  const { combat, enemy } = setup(t);
  const caster = enemy(), recipient = enemy(new Battler(21, 20)), hidden = enemy(), dead = enemy();
  recipient.b.gear.features = [{ code: 23, data_id: 2, value: 0.5 }]; hidden.hidden = true; dead.alive = false;
  caster.battle = { enemies: [caster, recipient, hidden, dead] };
  combat.applySkillToSelf(caster, skill(3, 'a.mat * 6', [], { scope: 8 }));
  assert.equal(caster.b.hp, 1600); assert.equal(recipient.b.hp, 1300);
  assert.equal(hidden.b.hp, 1000); assert.equal(dead.b.hp, 1000);
});

test('enemy self damage and MP drain preserve caps and death flow rather than acting as free recovery', t => {
  const { combat, enemy } = setup(t); const e = enemy();
  combat.applySkillToSelf(e, skill(1, '300', [effect(12, 0, 0, 100)]));
  assert.equal(e.b.hp, 700); assert.equal(e.b.mp, 100);
  combat.applySkillToSelf(e, skill(6, '200')); assert.equal(e.b.mp, 100); assert.equal(e.b.hp, 700);
  e.b.hp = 100; combat.applySkillToSelf(e, skill(1, '300', [], { repeats: 3 }));
  assert.equal(e.b.hp, 0); assert.equal(e.alive, false);
});

test('real companion friendly execution applies repeated buffs and recovery to both recipients after one cost/global event', async t => {
  const { combat, actor, ally, globals } = setup(t);
  const oldDocument = globalThis.document;
  t.after(() => { globalThis.document = oldDocument; });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {} }) }) };
  $data.actors = [null, {}, { id: 2, face_name: '', character_name: '' }];
  G.state.party.actors = [1, 2]; G.state.party.members = () => [actor, ally];
  G.state.actor = id => id === 1 ? actor : id === 2 ? ally : null; G.state.system.followers = true;
  G.map.grid = { valid: () => true }; G.map.walkable = () => true;
  G.map.validW = () => true; G.map.wrapX = x => x; G.map.wrapY = y => y; G.map.passableFor = () => true;
  G.map.playerChar = { fx: 10, fy: 10 }; G.floorAt = () => 0;
  G.player = { headWorld: () => new THREE.Vector3(), forward2D: () => new THREE.Vector3(0, 0, 1) };
  const system = combat.allies = new AllySystem(combat);
  system.update(0, true);
  const unit = system.unitOf(2); assert.ok(unit); await unit.ready;
  t.after(() => system.reset());
  ally.mp = 100;
  const obj = skill(3, 'a.mat * 6', [effect(31, 2, 2), effect(12, 0, 0, 10), effect(44, 50)],
    { scope: 8, repeats: 3, mp_cost: 10, tp_cost: 0, animation_id: 0 });
  unit.perform({ by: ally, skill: obj }, { friends: () => [{ battler: actor, ally: null }, { battler: ally, ally: unit }] });
  assert.deepEqual([actor.hp, ally.hp], [1360, 1360]);
  assert.deepEqual([actor.mp, ally.mp], [30, 120]);
  assert.deepEqual([actor.buffs[2], ally.buffs[2]], [2, 2]); assert.deepEqual(globals, [50]);
  system.update(20, true); assert.equal(ally.buffs[2], 2, 'paused simulation keeps the support buff');
  system.tickStates(13); assert.equal(ally.buffs[2], 0, 'companion buffs expire using their actual simulation clock');
});

test('support effects keep source order when max-HP buffs surround percentage healing', t => {
  const { combat, actor } = setup(t);
  combat.applyUsableToActor(skill(0, '0', [effect(11, 0, 0.1), effect(31, 0, 2), effect(11, 0, 0.1)]), 'quick');
  assert.equal(actor.hp, 3250, 'heal1000 before the buff, then1250 after the buff');
});

test('support user resources accrue per landed recipient and repeat, with caster TCR and custom conversion', t => {
  const { combat, actor, ally, enemy } = setup(t);
  actor.gear.features = [{ code: 23, data_id: 5, value: 2 }];
  combat.applyUsableToActor(skill(0, '0', [effect(31, 2, 2)], { scope: 8, repeats: 3, tp_gain: 5 }), 'quick');
  assert.equal(actor.tp, 90, 'three living battle recipients times three repetitions times10TP');
  assert.equal(ally.tp, 0, 'recipient does not receive the caster TP');
  const e = enemy();
  combat.applySkillToSelf(e, skill(3, '100', [], { repeats: 3, tp_gain: 2 })); assert.equal(e.b.tp, 6);
  actor.gear = { features: [], note: '<HP変換攻撃:50,100>' };
  combat.applyUsableToActor(skill(1, '100', [], { note: '<変換攻撃判定:100>' }), 'ally', { target: ally, user: actor });
  assert.equal(ally.hp, 900); assert.equal(actor.hp, 1050);
});

test('single-dead and all-dead support revive only current dead battle members, never an alive leader or reserve', t => {
  const { combat, actor, ally, dead, fourth, bench } = setup(t);
  ally.addState(1); dead.addState(1); bench.addState(1);
  const revive = skill(3, 'b.mhp / 2', [effect(22, 1)], { scope: 9, repeats: 3 });
  assert.equal(combat.applyUsableToActor(revive, 'quick'), true);
  assert.equal(ally.hp, 5000, 'one dead recipient is chosen and cannot receive further dead-only repeats once alive');
  assert.equal(ally.isState(1), false); assert.equal(dead.hp, 0); assert.equal(actor.hp, 1000); assert.equal(fourth.hp, 1000); assert.equal(bench.hp, 0);
  combat.applyUsableToActor({ ...revive, scope: 10, repeats: 1, damage: { ...revive.damage, formula: 'b.mhp' } }, 'quick');
  assert.equal(dead.hp, 10000); assert.equal(bench.hp, 0); assert.equal(ally.hp, 5000);
});

test('dead-friend skills reject an explicit living recipient and cost nothing when no dead member exists', t => {
  const { combat, actor, ally, dead, globals } = setup(t);
  dead.hp = 1000; actor.mp = 100;
  const revive = skill(3, 'b.mhp / 2', [effect(22, 1), effect(44, 44)],
    { scope: 9, repeats: 1, mp_cost: 10, tp_cost: 0, occasion: 0, animation_id: 0 });
  $data.skills[revive.id] = revive; actor.skills.push(revive.id);
  assert.equal(combat.applyUsableToActor(revive, 'quick', { target: ally }), false);
  assert.equal(combat.useSkillFromMenu(revive), false); assert.equal(combat.performUsable(revive, 'skill'), false);
  assert.equal(actor.mp, 100); assert.equal(combat.skillCD[revive.id], undefined); assert.deepEqual(globals, []);
  ally.addState(1);
  assert.equal(combat.useSkillFromMenu(revive), true);
  assert.equal(actor.mp, 90); assert.equal(actor.hp, 1000); assert.equal(ally.hp, 5000); assert.deepEqual(globals, [44]);
});

test('enemy resurrection restores the existing dead object, render and AI state and rewards it only once after a second defeat', t => {
  const { combat, enemy } = setup(t);
  const caster = enemy(), dead = enemy(), escaped = enemy(), hidden = enemy();
  const root = combat.root;
  for (const e of [caster, dead, escaped, hidden]) {
    e.group = new THREE.Group(); root.add(e.group); e.b.solo = () => e.b;
    Object.defineProperty(e.b, 'dead', { get() { return this.isState(1); } });
    Object.defineProperty(e, 'alive', { get() { return !this.b.dead && this.state !== 'dying' && this.state !== 'dead'; } });
    e.state = 'chase'; e.mat = new THREE.MeshBasicMaterial(); e.mesh = new THREE.Mesh(new THREE.PlaneGeometry(), e.mat);
    e.data = { note: '', gold: 0, exp: 0, drop_items: [] };
  }
  combat.dropMarker = () => {};
  delete combat.checkEnemyDeath;
  combat.enemies = [caster, dead, escaped, hidden];
  const battle = { result: 0, enemies: [caster, dead, escaped, hidden], done: false };
  for (const e of battle.enemies) e.battle = battle;
  combat.killEnemy(dead); combat.killEnemy(escaped); combat.killEnemy(hidden);
  escaped.escaped = true; hidden.hidden = true;
  root.remove(dead.group); let builds = 0;
  dead.build = () => { builds++; return Promise.resolve(); };
  const revive = skill(3, 'b.mhp', [effect(22, 1)], { scope: 10 });
  combat.applySkillToSelf(caster, revive);
  assert.equal(caster.b.hp, 1000); assert.equal(dead.b.hp, 10000); assert.equal(dead.alive, true); assert.equal(dead.b.isState(1), false);
  assert.equal(dead.state, 'recover'); assert.equal(dead.timer, 0.8); assert.equal(dead.group.parent, root); assert.equal(dead.group.visible, true);
  assert.equal(builds, 1); assert.equal(combat.enemies.filter(e => e === dead).length, 1); assert.equal(battle.enemies.filter(e => e === dead).length, 1);
  assert.equal(escaped.b.hp, 0); assert.equal(hidden.b.hp, 0);
  combat.killEnemy(dead); combat.killEnemy(caster);
  dead.data = { note: '', gold: 17, exp: 0, drop_items: [{ kind: 1, data_id: 1, denominator: 1 }] };
  let gold = 0, drops = 0;
  Object.assign(G.state.party, { partyAbility: () => false, gainGold: n => gold += n, gainItem: (_kind, _id, n) => drops += n });
  G.state.system.winCount = 0; G.ui.notifyGain = () => {}; G.ui.notifyGold = () => {}; G.coop = null; G.arena = null; G.theater = null;
  G.player = { floatDown() {} };
  combat.music = null; combat.defeated = new Map(); combat.battles = []; combat.fightStates = null;
  combat.onBattleEnd(battle);
  assert.equal(gold, 17); assert.equal(drops, 1); assert.equal(G.state.system.winCount, 1);
});
