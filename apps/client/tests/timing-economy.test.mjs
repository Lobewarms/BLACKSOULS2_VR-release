import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState, BattlerBase } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { clearEdgeCache } from '../src/world/collision.js';
import { T } from '../src/world/mapmesh.js';
import { AllySystem } from '../src/entities/allies.js';
import { GameplayDelay } from '../src/combat/gameplay-delay.js';
globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const feature = (code, data_id, value = 1) => ({ code, data_id, value });
const skill = (id, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Synthetic skill ${id}`, note: '', icon_index: id,
  stype_id: 1, occasion: 0, scope: 1, hit_type: 1, success_rate: 100, repeats: 1, animation_id: 0,
  mp_cost: 10, tp_cost: 0, tp_gain: 0, required_wtype_id1: 0, required_wtype_id2: 0,
  damage: { type: 1, formula: '100', variance: 0, element_id: 0, critical: false }, effects: [], ...extra });
function environment(t, extra = {}) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  const params = [1000, 200, 80, 30, 100, 30, 50, 40];
  Object.assign($data, { actors: [null,
    { id: 1, class_id: 1, initial_level: 1, name: 'Actor', equips: [1, 0, 0, 0, 0], note: '', features: [] },
    { id: 2, class_id: 1, initial_level: 1, name: 'Companion', equips: [], note: '', features: [] }],
  classes: [null, { exp_params: [30, 20, 30, 30], note: '', learnings: [],
    features: [feature(41, 1), feature(51, 1), feature(51, 2), feature(22, 0)],
    params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
  weapons: [null, { id: 1, __class: 'RPG::Weapon', name: 'Normal blade', note: '', etype_id: 0, wtype_id: 1, features: [], params: Array(8).fill(0) },
    { id: 2, __class: 'RPG::Weapon', name: 'Borrowed blade', note: '', etype_id: 0, wtype_id: 2,
      features: [feature(43, 101)], params: [0, 0, 100, 0, 0, 0, 0, 0] }],
  armors: [], items: [], skills: [], states: [], commonEvents: [], animations: [], system: { sounds: [], skill_types: ['', 'Skills'] } });
  $data.skills[1] = skill(1, { mp_cost: 0 }); $data.skills[101] = skill(101, extra);
  $data.states[30] = { id: 30, name: 'Timed ward', note: '', features: [], restriction: 0, auto_removal_timing: 1, min_turns: 3, max_turns: 3 };
  const state = G.state = new GameState(); state.party.actors = [1, 2]; state.party.weapons.set(2, 1);
  const actor = state.party.leader(); actor.learnSkill(101); actor.hp = 500; actor.mp = 100; actor.tp = 50;
  const map = G.map = new GameMap(); map.mapId = 1;
  map.grid = { w: 20, h: 20, region: () => 0, valid: (x, y) => x >= 0 && y >= 0 && x < 20 && y < 20, passable: () => true };
  map.playerChar.fx = 4; map.playerChar.fy = 4; map.playerChar.syncFromContinuous(); clearEdgeCache();
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); root.add(camera); camera.position.set(4.5 * T, 1.6, 4.5 * T);
  Object.assign(G, { time: 10, frame: 1, vr: false, xrAway: false, coop: null, arena: null, theater: null, scripts: {},
    settings: { difficulty: 1, breakRule: 'original' }, floorAt: () => 0, solidTopAt: () => 0, three: { camera }, audio: null,
    input: { controllers: {}, haptic() {}, breakHeld: () => false }, screen: { playAnimationOn() {}, hurtFlash() {} },
    player: { headWorld: out => out.copy(camera.position), forwardVec: () => new THREE.Vector3(0, 0, -1), dodge: { cooldown: 0 } },
    ui: { menuOpen: false, sceneOpen: null, menuSection: 'skills', toast() {}, closeMenu() { this.menuOpen = false; } } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { root, gen: 1, stamina: 1, battles: [],
    enemies: [], symbols: new Map(), puppets: new Map(), skillCD: {}, projectiles: [], sideInterps: [],
    weapon: new THREE.Group(), allies: { list: [], unitOf: () => null }, popup() {}, popupAtPlayer() {}, spawnGlow() {}, showArms() {} });
  combat.weapon.userData.length = 1;
  const record = { note: '', features: [], actions: [{ skill_id: 101, rating: 5, condition_type: 0 }] };
  class Target extends BattlerBase {
    paramBase(id) { return [10000, 200, 80, 30, 100, 30, 50, 40][id]; }
    featureObjects() { return [record, ...super.featureObjects()]; }
  }
  const b = new Target(); b.hp = b.mhp; b.mp = b.mmp;
  const battle = { done: false, enemies: [] };
  const enemy = { b, battle, data: record, fx: 4, fy: 2, r: 0.3, hr: 0.3, h: 1.8, state: 'chase', hidden: false,
    turn: 1, timer: 0, cooldown: 0, alertTime: 0, mesh: new THREE.Group(), knock: { x: 0, y: 0 },
    ring: { scale: new THREE.Vector3(), material: {} }, drawBar() {},
    get alive() { return b.hp > 0 && !b.isState(1); }, worldPos: out => out.set(4.5 * T, 0, 2.5 * T) };
  battle.enemies.push(enemy); combat.battles.push(battle); combat.enemies.push(enemy);
  const advance = (dt, paused = false) => { G.time += dt; combat.updateBonusActions(dt, paused); };
  return { actor, state, map, combat, enemy, record, battle, advance, art: $data.skills[101] };
}

test('gameplay-delay jobs wait through pauses and newly scheduled zero-delay work cannot run recursively', () => {
  const queue = new GameplayDelay(), ran = [];
  queue.schedule(100, () => { ran.push('first'); queue.schedule(0, () => ran.push('second')); });
  queue.update(100, true); queue.update(0); assert.deepEqual(ran, []);
  queue.update(0.1); assert.deepEqual(ran, ['first']);
  queue.update(0.001); assert.deepEqual(ran, ['first', 'second']);
});

test('gameplay-delay cancellation is exactly once even when a callback resets an in-flight batch', () => {
  const queue = new GameplayDelay(), cancelled = [], ran = [];
  queue.schedule(0, () => { ran.push('reset'); queue.clear(); });
  queue.schedule(0, () => ran.push('stale'), { cancel: () => cancelled.push('resource') });
  queue.update(1); queue.clear(); queue.update(1);
  assert.deepEqual(ran, ['reset']); assert.deepEqual(cancelled, ['resource']); assert.equal(queue.jobs.length, 0);
});

test('actual direct repeats freeze with R and XR-away, then apply each original hit once after resuming', t => {
  const e = environment(t, { repeats: 3 });
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(e.enemy.b.hp, 9900); assert.equal(e.actor.mp, 90);
  G.ui.menuOpen = true; e.advance(10, true); G.ui.menuOpen = false; G.xrAway = true; e.advance(10);
  assert.equal(e.enemy.b.hp, 9900); assert.equal(e.actor.mp, 90);
  G.xrAway = false; e.advance(0.119); assert.equal(e.enemy.b.hp, 9900);
  e.advance(0.001); assert.equal(e.enemy.b.hp, 9800); e.advance(0.12); assert.equal(e.enemy.b.hp, 9700);
  e.advance(1); assert.equal(e.enemy.b.hp, 9700); assert.equal(e.actor.mp, 90);
});

for (const change of ['generation', 'map', 'state', 'leader', 'battle', 'transfer']) test(`delayed actions invalidate ${change} ownership and clean up while paused`, t => {
  const e = environment(t); let ran = 0, disposed = 0;
  e.combat.later(50, () => ran++, { battle: e.battle, cancel: () => disposed++ });
  if (change === 'generation') e.combat.gen++;
  if (change === 'map') G.map = { ...G.map };
  if (change === 'state') G.state = { ...G.state };
  if (change === 'leader') e.state.party.actors = [2, 1];
  if (change === 'battle') e.battle.done = true;
  if (change === 'transfer') e.map.transferring = true;
  e.combat.updateDelayedActions(0, true); e.combat.updateDelayedActions(10, false);
  assert.equal(ran, 0); assert.equal(disposed, 1);
});

test('delayed borrowed hits retain source stats while paused and a completed target battle cancels the remaining hits', t => {
  const e = environment(t, { repeats: 3, damage: { type: 1, formula: 'a.atk', variance: 0, critical: false, element_id: 0 } });
  e.actor.skills = []; t.mock.method(Math, 'random', () => 0.5);
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(e.enemy.b.hp, 9820); assert.equal(e.actor.atk, 80);
  G.ui.menuOpen = true; e.advance(5, true); assert.equal(e.enemy.b.hp, 9820);
  G.ui.menuOpen = false; e.advance(0.12); assert.equal(e.enemy.b.hp, 9640); assert.equal(e.actor.atk, 80);
  e.battle.done = true; e.advance(1); assert.equal(e.enemy.b.hp, 9640);
});

test('committed wave, direct and companion hits keep their active battle owner and cannot land after it ends', t => {
  const e = environment(t); let playerHits = 0, allyHits = 0;
  t.mock.method(e.combat, 'enemyStrikePlayer', () => playerHits++);
  const ally = { alive: true, takeHit: () => allyHits++ };
  const schedule = () => {
    e.combat.passOver({ e: e.enemy, skill: e.art, hits: 2 }, true);
    e.combat.strikeHits(e.enemy, e.art, 2, true);
    e.combat.hitAlly(ally, e.enemy, e.art, 2);
  };
  schedule(); e.advance(0.01); assert.deepEqual([playerHits, allyHits], [2, 1]);
  G.ui.menuOpen = true; e.advance(10, true); assert.deepEqual([playerHits, allyHits], [2, 1]);
  e.battle.done = true; e.combat.updateDelayedActions(0, true);
  G.ui.menuOpen = false; e.advance(1); assert.deepEqual([playerHits, allyHits], [2, 1]);
  assert.equal(e.combat.delayedActions.jobs.length, 0);
});

test('guest delayed repeats accept the current host-owned puppet battle outside the local battle list', t => {
  const e = environment(t, { repeats: 3 });
  G.coop = { phantom: true };
  const battle = e.combat.puppetBattle = { done: false, puppet: true, enemies: [e.enemy] };
  e.enemy.puppet = true; e.enemy.battle = battle; e.combat.battles = [];
  e.combat.puppets.set(7, e.enemy);
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(e.enemy.b.hp, 9900);
  e.advance(0.12); assert.equal(e.enemy.b.hp, 9800);
  e.advance(0.12); assert.equal(e.enemy.b.hp, 9700);
  assert.equal(e.actor.mp, 90); assert.equal(e.combat.delayedActions.jobs.length, 0);
});

for (const change of ['replacement', 'ended', 'generation']) test(`guest delayed actions cancel ${change} ownership and release resources once`, t => {
  const e = environment(t); let ran = 0, disposed = 0;
  G.coop = { phantom: true };
  const battle = e.combat.puppetBattle = { done: false, puppet: true, enemies: [e.enemy] };
  e.combat.battles = [];
  e.combat.later(50, () => ran++, { battle, cancel: () => disposed++ });
  if (change === 'replacement') e.combat.puppetBattle = { done: false, puppet: true, enemies: [] };
  if (change === 'ended') battle.done = true;
  if (change === 'generation') e.combat.gen++;
  e.combat.updateDelayedActions(0, true); e.combat.updateDelayedActions(1, false);
  assert.equal(ran, 0); assert.equal(disposed, 1);
});

test('player, companion and enemy cooldowns all freeze on paused reads and new paused deadlines do not inherit old time', t => {
  const e = environment(t, { note: '<クールタイム:3>' });
  const allies = e.combat.allies = Object.assign(Object.create(AllySystem.prototype), { combat: e.combat, cools: new Map(), list: [] });
  const seconds = e.combat.coolSeconds(e.art); e.combat.setSkillCooldown(e.art, seconds); allies.cool(e.actor, e.art); e.combat.commitSkill(e.enemy, e.art);
  G.ui.menuOpen = true; G.time += 100;
  assert.equal(allies.cooling(e.actor, e.art), true); assert.equal(e.combat.enemyCanUse(e.enemy, e.art), false);
  assert.equal(e.combat.skillCooling(e.art), seconds);
  assert.equal(allies.cools.get(e.actor.id)[e.art.id] - G.time, seconds); assert.equal(e.enemy.cool[e.art.id] - G.time, seconds);
  G.time += 50; allies.cool(e.actor, e.art); assert.equal(allies.cools.get(e.actor.id)[e.art.id] - G.time, seconds);
  G.ui.menuOpen = false; e.advance(seconds + 0.01);
  assert.equal(allies.cooling(e.actor, e.art), false); assert.equal(e.combat.enemyCanUse(e.enemy, e.art), true);
});

test('companion rebuffs refresh actor-owned time and JSON/new-system/reset preserve only that actor remaining duration', t => {
  const e = environment(t), companion = e.state.actor(2); companion.hp = 500;
  let current = companion;
  const unit = { stands: true, members: () => [current], drawBar() {}, dispose() {} };
  const allies = e.combat.allies = Object.assign(Object.create(AllySystem.prototype), { combat: e.combat, list: [unit], cools: new Map(), unitOf: () => unit });
  const support = skill(102, { scope: 8, damage: { type: 0 }, effects: [{ code: 21, data_id: 30, value1: 1 }] });
  const cast = () => e.combat.applyUsableToActor(support, 'self', { target: current, user: e.actor, global: false });
  cast(); allies.tickStates(0); assert.equal(current.stateTimerRemaining[30], 18); allies.tickStates(17);
  cast(); allies.tickStates(0); assert.equal(current.stateTimerRemaining[30], 18); allies.tickStates(3);
  const loaded = GameState.fromJSON(e.state.toJSON()); current = loaded.actor(2); assert.equal(current.stateTimerRemaining[30], 15);
  allies.reset(); allies.list = [unit]; allies.tickStates(1); assert.equal(current.stateTimerRemaining[30], 14);
  assert.equal(allies.stateTimers.get(2), current.stateTimerRemaining); assert.equal(companion.stateTimerRemaining[30], 15);
});

test('normal-ready actions preserve earned extras while a bypass or explicit released queue spends one without rerolling', t => {
  const e = environment(t); $data.actors[1].features = [feature(61, 0, 1)]; let rolls = 0;
  e.combat.bonusManager().random = () => { rolls++; return 0; };
  const prime = e.combat.beginPlayerAction(true, { active: 0.3, recovery: 0.9 }); e.combat.completePlayerAction(prime);
  assert.equal(e.combat.bonusStatus().count, 1); e.advance(1);
  const normal = e.combat.beginPlayerAction(true, { active: 0.3, recovery: 0.9 });
  assert.equal(normal.ticket.bonus, false); assert.equal(e.combat.bonusStatus().count, 1);
  e.advance(0.301); const bypass = e.combat.beginPlayerAction(true, { active: 0.3, recovery: 0.9 });
  assert.equal(bypass.ticket.bonus, true); e.combat.completePlayerAction(bypass); assert.equal(e.combat.bonusStatus(), null);
  e.advance(1); e.combat.completePlayerAction(normal); assert.equal(e.combat.bonusStatus().count, 1);
  const explicit = e.combat.beginPlayerAction(true, { preferBonus: true, active: 0.3, recovery: 0.9 });
  assert.equal(explicit.ticket.bonus, true); e.combat.completePlayerAction(explicit); assert.equal(e.combat.bonusStatus(), null);
  assert.equal(rolls, 0, 'guaranteed sources need no random draw and bonus actions never reroll');
  e.advance(1); assert.equal(e.combat.beginPlayerAction(true, { preferBonus: true }), false, 'a lost queue cannot fall back to a normal action');
});

test('enemy base and state extra-action sources both contribute once to the existing real-time pace adapter', t => {
  const e = environment(t); e.record.features = [feature(61, 0, 1), feature(61, 0, 1)];
  assert.equal(e.combat.actionPace(e.enemy), 3);
  $data.states[30].features = [feature(61, 0, 0.5)]; e.enemy.b.addState(30); assert.equal(e.combat.actionPace(e.enemy), 3.5);
  e.enemy.b.removeState(30); assert.equal(e.combat.actionPace(e.enemy), 3);
});

test('enemy skill/type seals and resource failures cannot invent an unlisted Attack action', t => {
  const e = environment(t); assert.equal(e.combat.chooseAction(e.enemy), e.art);
  $data.states[30].features = [feature(42, 1)]; e.enemy.b.addState(30);
  assert.equal(e.combat.chooseAction(e.enemy), null); assert.equal(e.combat.enemyCanUse(e.enemy, e.art), false);
  e.enemy.b.removeState(30); $data.states[30].features = [feature(44, 101)]; e.enemy.b.addState(30);
  assert.equal(e.combat.chooseAction(e.enemy), null);
  e.enemy.b.removeState(30); e.enemy.b.mp = 0; assert.equal(e.combat.pickAction(e.enemy), null);
  const mp = e.enemy.b.mp, playerHp = e.actor.hp;
  e.combat.enemyAI(e.enemy, 0.016, { fx: 4, fy: 3 }, 0);
  assert.equal(e.enemy.skill, null); assert.equal(e.enemy.state, 'recover'); assert.equal(e.enemy.turn, 2);
  assert.equal(e.actor.hp, playerHp); assert.equal(e.enemy.b.mp, mp);
});

test('native enemy Rampage selects its normal attack replacement and an explicit forced action retains its original exception', t => {
  const e = environment(t); $data.states[30].restriction = 1; $data.states[30].note = '<攻撃ID変更:103>';
  $data.skills[103] = skill(103, { mp_cost: 0 }); e.enemy.b.addState(30);
  assert.equal(e.combat.chooseAction(e.enemy), $data.skills[103]);
  e.enemy.forcedSkill = e.art; assert.equal(e.combat.chooseAction(e.enemy), e.art);
});
