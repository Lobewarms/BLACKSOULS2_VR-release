import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState, BattlerBase } from '../src/game/state.js';
import { AllySystem } from '../src/entities/allies.js';
import { Player } from '../src/entities/player.js';
import { GameMap } from '../src/world/gamemap.js';
import { T } from '../src/world/mapmesh.js';
import { clearEdgeCache } from '../src/world/collision.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value = 1) => ({ code, data_id, value });
const action = (id = 1, extra = {}) => ({ __class: 'RPG::Skill', id, name: 'Synthetic action', note: '',
  icon_index: 0, stype_id: 1, occasion: 0, scope: 1, hit_type: 1, success_rate: 100, repeats: 1,
  animation_id: 0, mp_cost: 0, tp_cost: 0, tp_gain: 0, required_wtype_id1: 0, required_wtype_id2: 0,
  damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false }, effects: [], ...extra });
function environment(t) {
  const saved = { ...G }, data = { ...$data }, doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    G.combat?.allies?.reset?.();
    Object.assign(G, saved); Object.assign($data, data);
    if (doc) Object.defineProperty(globalThis, 'document', doc); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 128, height: 18, getContext: () => ({ clearRect() {}, fillRect() {} }),
  }) } });
  t.mock.method(Math, 'random', () => 0.5);
  const params = [10000, 1000, 100, 100, 100, 100, 100, 100];
  const actorData = id => ({ id, name: 'Synthetic actor', class_id: 1, initial_level: 1,
    equips: [], features: [], note: '', character_name: '', face_name: '' });
  Object.assign($data, {
    actors: [null, actorData(1), actorData(2)],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], features: [trait(41, 1), trait(22, 0, 1)], note: '',
      params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
    weapons: [], armors: [], items: [], skills: [null, action()], states: [null, { id: 1, features: [], note: '', restriction: 4 }],
    animations: [], commonEvents: [], system: { sounds: [], opt_followers: true },
  });
  const state = new GameState(); state.party.actors = [1, 2];
  const actor = state.actor(1), companion = state.actor(2);
  for (const a of [actor, companion]) { a.hp = a.mhp; a.mp = a.mmp; }
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  camera.position.set(5.25, 1.6, 6.75); root.add(camera);
  Object.assign(G, {
    state, time: 1, scripts: {}, vr: false, xrAway: false, coop: null, arena: null, audio: null,
    settings: { difficulty: 1, breakRule: 'original' }, floorAt: () => 0, three: { camera },
    map: { mapId: 1, requestRefresh() {}, grid: { w: 20, h: 20, valid: () => true }, playerChar: { fx: 3, fy: 4 },
      wrapX: x => x, wrapY: y => y, validW: () => true, passableFor: () => true, walkable: () => true },
    player: { invuln: 0, headWorld: out => out.copy(camera.position), forwardVec: () => new THREE.Vector3(0, 0, -1),
      forward2D: () => ({ x: 0, z: -1 }) },
    input: { controllers: {}, haptic() {} },
    screen: { playAnimationOn() {}, hurtFlash() {}, hitShake() {} },
    ui: { menuOpen: false, toast() {}, closeMenu() { this.menuOpen = false; }, messageBusy: () => false, dialogueActive: () => false },
  });
  clearEdgeCache();
  class EnemyBattler extends BattlerBase {
    constructor() { super(); this.gear = { features: [trait(22, 0, 1)], note: '' }; this.hp = 10000; this.mp = 1000; }
    paramBase(id) { return params[id]; }
    featureObjects() { return [this.gear, ...super.featureObjects()]; }
  }
  const b = new EnemyBattler(), battle = { done: false, enemies: [] };
  const enemy = { b, battle, state: 'chase', fx: 3, fy: 2, h: 1.8, hr: 0.3, hidden: false, mesh: new THREE.Group(),
    knock: { x: 0, y: 0 }, stateTimers: {}, drawBar() {}, get alive() { return b.hp > 0; },
    worldPos: out => out.set(5.25, 0, 3.75) };
  battle.enemies.push(enemy);
  const counters = [], combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    gen: 1, root, enemies: [enemy], battles: [battle], symbols: new Map(), puppets: new Map(), passing: new Set(), skillCD: {},
    sideInterps: [], projectiles: [], stamina: 1, showArms() {}, popup() {}, popupAtPlayer() {},
    spawnGlow() {}, spawnTracer() {}, groggyHit() {}, reportStruck() {}, scheduleDelayed() {},
    damageRemovesActorStates() {}, damageRemovesStates() {}, playerFalls() {},
    liftInfo: () => ({ states: new Set() }), isBlocking: () => false,
    startCounter: (_enemy, skill) => { counters.push({ id: skill?.id, enemyHP: b.hp }); return true; },
  });
  combat.allies = new AllySystem(combat);
  combat.pickTargets = () => [enemy];
  return { state, actor, companion, combat, enemy, b, battle, counters,
    advance: (seconds = 0.2, paused = false) => { G.time += seconds; combat.updateDelayedActions(seconds, paused); },
    async ally() { combat.allies.update(0, true); const unit = combat.allies.list[0]; await unit.ready; return unit; },
  };
}
const critical = () => ({ type: 1, formula: '100', element_id: 0, variance: 0, critical: true });
const setMultiplier = (value = 3) => { G.scripts.difficulty = { variable: 60, rows: Array.from({ length: 12 }, () => [value]) }; };

test('critical multiplier follows the active parsed difficulty column and falls back to the base-game rule', t => {
  const e = environment(t); $data.actors[1].features.push(trait(22, 2, 1)); $data.skills[1].damage = critical();
  setMultiplier(); G.scripts.difficulty.rows[11] = [3, 4]; e.state.setV(60, 1);
  e.combat.playerHitEnemy(e.enemy, 1, true, new THREE.Vector3()); assert.equal(e.b.hp, 9600);
  e.state.setV(60, 0); e.combat.playerHitEnemy(e.enemy, 1, true, new THREE.Vector3()); assert.equal(e.b.hp, 9300);
  delete G.scripts.difficulty;
  e.combat.enemyStrikePlayer(e.enemy, action(9, { damage: critical() }));
  assert.equal(e.actor.hp, 9900, 'a noncritical enemy hit is not multiplied');
  e.b.gear.features.push(trait(22, 2, 1));
  e.combat.enemyStrikePlayer(e.enemy, action(9, { damage: critical() })); assert.equal(e.actor.hp, 9700);
  setMultiplier(); e.combat.enemyStrikePlayer(e.enemy, action(9, { damage: critical() })); assert.equal(e.actor.hp, 9400);
});

test('actual R skills and ordinary projectile landings roll native CRI and target CEV', t => {
  const e = environment(t); setMultiplier(); $data.actors[1].features.push(trait(22, 2, 1));
  const skill = $data.skills[10] = action(10, { damage: critical() }); e.actor.learnSkill(10);
  assert.equal(e.combat.useSkillFromMenu(skill), true); assert.equal(e.b.hp, 9700);
  e.b.gear.features.push(trait(22, 3, 1));
  e.combat.applyUsableToEnemy(e.enemy, { ...skill, hit_type: 2 }, null); assert.equal(e.b.hp, 9600);
  skill.damage.critical = false; e.b.gear.features.pop();
  e.combat.applyUsableToEnemy(e.enemy, skill, null); assert.equal(e.b.hp, 9500);
});

test('explicit gesture criticals still respect CEV and additive gesture probability rolls per recipient', t => {
  const e = environment(t); setMultiplier(); $data.skills[1].damage = critical();
  e.b.gear.features.push(trait(22, 3, 1));
  e.combat.playerHitEnemy(e.enemy, 1, true, null); assert.equal(e.b.hp, 9900);
  e.b.gear.features.pop(); Math.random.mock.mockImplementation(() => 0.2);
  e.combat.playerHitEnemy(e.enemy, 1, false, null, { critBonus: 0.35 }); assert.equal(e.b.hp, 9600);
  e.combat.playerHitEnemy(e.enemy, 1, false, null, { critBonus: 0.08 }); assert.equal(e.b.hp, 9500);
  $data.actors[1].features.push(trait(22, 2, 1.5)); e.b.gear.features.push(trait(22, 3, 0.5));
  Math.random.mock.mockImplementation(() => 0.7);
  e.combat.applyUsableToEnemy(e.enemy, $data.skills[1], null); assert.equal(e.b.hp, 9200, 'CEV multiplies the full native CRI before chance clamping');
});

test('normal repeats reroll critical evasion and remain independent after a first miss', t => {
  const e = environment(t); setMultiplier(); const skill = $data.skills[1]; skill.repeats = 3;
  let calls = 0; Math.random.mock.mockImplementation(() => ++calls === 2 ? 0.99 : 0.2);
  $data.classes[1].features[1].value = 0.5;
  e.combat.playerHitEnemy(e.enemy, 1, false, null); assert.equal(e.b.hp, 10000);
  e.advance(0.24); assert.equal(e.b.hp, 9800, 'later repeats land even though the first hit missed');
  $data.classes[1].features[1].value = 1; $data.actors[1].features.push(trait(22, 2, 1)); skill.damage = critical();
  e.combat.playerHitEnemy(e.enemy, 1, false, null); assert.equal(e.b.hp, 9500);
  e.b.gear.features.push(trait(22, 3, 1)); e.advance(0.24);
  assert.equal(e.b.hp, 9300, 'a first critical does not force later repetitions to be critical');
});

test('normal-attack count traits multiply normal hits but not an armed art', t => {
  const e = environment(t); $data.actors[1].features.push(trait(34, 0, 2));
  e.combat.playerHitEnemy(e.enemy, 1, false, null); e.advance(0.24); assert.equal(e.b.hp, 9700);
  const art = $data.skills[10] = action(10); e.actor.learnSkill(10); e.combat.skillArm = { skill: art };
  e.combat.playerHitEnemy(e.enemy, 1, false, null); e.advance(0.24); assert.equal(e.b.hp, 9600);
});

test('physical skills and ranged normal hits invoke one post-hit counter, including a missed attempt', t => {
  const e = environment(t); e.b.gear.features.push(trait(22, 6, 1));
  const skill = $data.skills[10] = action(10); e.actor.learnSkill(10);
  assert.equal(e.combat.useSkillFromMenu(skill), true);
  assert.deepEqual(e.counters, [{ id: 1, enemyHP: 9900 }]);
  e.combat.playerHitEnemy(e.enemy, 1, false, null, { one: true }); assert.equal(e.counters.length, 2);
  e.combat.applyUsableToEnemy(e.enemy, { ...skill, success_rate: 0 }, null);
  assert.equal(e.counters.length, 3); assert.equal(e.b.hp, 9800);
  e.combat.applyUsableToEnemy(e.enemy, { ...skill, note: '<反撃不可>' }, null); assert.equal(e.counters.length, 3);
});

test('counter selection precedes magic reflection and counter responses cannot recursively invoke either', t => {
  const e = environment(t); e.b.gear.features.push(trait(22, 6, 1), trait(22, 5, 1));
  const skill = action(10, { hit_type: 2, note: '<反撃可能>' });
  e.combat.applyUsableToEnemy(e.enemy, skill, null);
  assert.equal(e.b.hp, 9900); assert.equal(e.actor.hp, 10000); assert.equal(e.counters.length, 1);
  e.combat.applyUsableToEnemy(e.enemy, skill, null, { canCounter: false, canReflect: false });
  assert.equal(e.b.hp, 9800); assert.equal(e.counters.length, 1);
  $data.actors[1].features.push(trait(22, 6, 1), trait(22, 5, 1));
  e.combat.enemyStrikePlayer(e.enemy, { ...skill, _counterResponse: true });
  assert.equal(e.actor.hp, 9900); assert.equal(e.b.hp, 9800);
});

test('a repeated physical use makes a separate counter invocation for each actual hit', t => {
  const e = environment(t); e.b.gear.features.push(trait(22, 6, 1)); $data.skills[1].repeats = 3;
  e.combat.playerHitEnemy(e.enemy, 1, false, null); e.advance(0.24);
  assert.equal(e.counters.length, 3); assert.deepEqual(e.counters.map(x => x.enemyHP), [9900, 9800, 9700]);
});

test('native random follow-up scopes retain target count times repeats and pay their cost once', t => {
  const e = environment(t), source = action(9, { note: '<使用後追加行動:10,-1,100>' });
  const child = $data.skills[10] = action(10, { scope: 5, repeats: 2, mp_cost: 7 });
  e.combat.allTargets = () => [e.enemy];
  e.combat.playerFollowUp(source, e.enemy, null); e.advance(0.32); e.advance(0.16);
  assert.equal(e.b.hp, 9400); assert.equal(e.actor.mp, 993); assert.equal(child.repeats, 2);
});

test('scheduled repetitions and follow-ups pause with gameplay and do not survive their battle or map', t => {
  const e = environment(t); $data.skills[1].repeats = 3;
  e.combat.playerHitEnemy(e.enemy, 1, false, null); e.advance(10, true); assert.equal(e.b.hp, 9900);
  e.advance(0.12); assert.equal(e.b.hp, 9800); e.battle.done = true; e.advance(1); assert.equal(e.b.hp, 9800);
  e.battle.done = false; $data.skills[10] = action(10, { scope: 4 });
  e.combat.playerFollowUp(action(9, { note: '<使用後追加行動:10,-1,100>' }), e.enemy, null);
  G.map = { ...G.map, mapId: 2 }; e.advance(1); assert.equal(e.b.hp, 9800);
});

test('actual companion spells reflect to their own caster once, preserving resources and every effect', async t => {
  const e = environment(t), unit = await e.ally(); setMultiplier();
  $data.actors[2].features.push(trait(22, 2, 1), trait(22, 5, 1)); e.b.gear.features.push(trait(22, 5, 1));
  const skill = action(10, { hit_type: 2, damage: critical(), mp_cost: 7, tp_gain: 4,
    effects: [{ code: 12, data_id: 0, value1: 0, value2: -20 }] });
  unit.perform({ by: e.companion, skill, enemy: e.enemy }, { enemies: [e.enemy] }); e.advance(0.01);
  assert.equal(e.b.hp, 10000); assert.equal(e.actor.hp, 10000); assert.equal(e.companion.hp, 9700);
  assert.equal(e.companion.mp, 973); assert.equal(e.companion.tp, 4);
});

test('companion offensive hits roll their own criticals and enemy counters return to that caster', async t => {
  const e = environment(t), unit = await e.ally(); setMultiplier(); $data.actors[2].features.push(trait(22, 2, 1));
  e.b.gear.features.push(trait(22, 6, 1)); const skill = action(10, { damage: critical() });
  unit.perform({ by: e.companion, skill, enemy: e.enemy }, { enemies: [e.enemy] }); e.advance(0.01);
  assert.equal(e.b.hp, 9700); assert.equal(e.companion.hp, 10000);
  e.advance(0.2); assert.equal(e.companion.hp, 9900); assert.equal(e.actor.hp, 10000);
});

test('substitution uses only the chosen recipient accuracy and evasion, including original-player immunity', async t => {
  const e = environment(t), unit = await e.ally(); e.actor.hp = 100;
  $data.actors[1].features.push(trait(22, 1, 1)); e.combat.allies.substitute = () => unit;
  let hitChecks = 0; const hit = e.combat.hitLands;
  t.mock.method(e.combat, 'hitLands', function (...args) { hitChecks++; return hit.apply(this, args); });
  e.combat.enemyStrikePlayer(e.enemy, action());
  assert.equal(e.actor.hp, 100); assert.equal(e.companion.hp, 9900); assert.equal(hitChecks, 1);
  $data.actors[1].features = []; $data.actors[2].features.push(trait(22, 1, 1));
  e.combat.enemyStrikePlayer(e.enemy, action()); assert.equal(e.companion.hp, 9900); assert.equal(hitChecks, 2);
});

test('substitution retains original-target reflection selection and does not invoke substitute reflection again', async t => {
  const e = environment(t), unit = await e.ally(); e.actor.hp = 100; e.combat.allies.substitute = () => unit;
  const spell = action(10, { hit_type: 2 }); $data.actors[2].features.push(trait(22, 5, 1));
  e.combat.enemyStrikePlayer(e.enemy, spell); assert.equal(e.companion.hp, 9900); assert.equal(e.b.hp, 10000);
  $data.actors[1].features.push(trait(22, 5, 1));
  e.combat.enemyStrikePlayer(e.enemy, spell); assert.equal(e.companion.hp, 9900); assert.equal(e.b.hp, 9900);
  $data.actors[1].features = []; e.combat.enemyStrikePlayer(e.enemy, { ...spell, hit_type: 0 });
  assert.equal(e.actor.hp, 0, 'native sure-hit actions do not choose a substitute'); assert.equal(e.companion.hp, 9900);
});

test('a paired companion body substitutes with the member that actually owns the native trait', async t => {
  const e = environment(t), unit = await e.ally(); e.actor.hp = 100;
  $data.actors[2].features.push(trait(62, 0), trait(22, 1, 1));
  $data.actors[3] = { ...$data.actors[2], id: 3, features: [trait(62, 0), trait(62, 2)] };
  e.state.party.actors.push(3); unit.ids.push(3); const substitute = e.state.actor(3); substitute.hp = substitute.mhp;
  Math.random.mock.mockImplementation(() => 0);
  assert.equal(e.combat.allies.substitute(), unit);
  e.combat.enemyStrikePlayer(e.enemy, action());
  assert.equal(e.companion.hp, 10000); assert.equal(substitute.hp, 9900); assert.equal(e.actor.hp, 100);
});

function rampage(e) {
  $data.states[38] = { id: 38, name: 'Synthetic forced attack', note: '', features: [], restriction: 1 };
  e.actor.addState(38); e.combat.weapon = new THREE.Group(); e.combat.weapon.userData.length = 3;
  e.combat.weapon.position.set(5.25, 1.3, 6.75); e.combat.weapon.updateMatrixWorld(true);
}

test('Rampage blocks real manual action entries without spending resources or starting a skill', t => {
  const e = environment(t); const skill = $data.skills[10] = action(10, { mp_cost: 7 }); e.actor.learnSkill(10);
  const item = $data.items[1] = { ...action(1), __class: 'RPG::Item', consumable: true, scope: 11 };
  e.state.party.gainItem('item', 1, 2); rampage(e); const before = e.actor.toJSON();
  assert.equal(e.combat.skillUseStatus(skill).ok, false);
  for (const run of [() => e.combat.useSkillFromMenu(skill), () => e.combat.useQuickEntry({ kind: 'item', id: 1 }),
    () => e.combat.useItem(item, 'menu'), () => e.combat.performUsable(skill, 'skill', 'menu', { direct: true }),
    () => e.combat.readyUsable(skill, 'skill'), () => e.combat.armSkill(skill),
    () => e.combat.holdConsumable(item, 'mouth'), () => e.combat.fireRanged(), () => e.combat.fireGunBreak(skill)]) assert.equal(run(), false);
  G.input.block = () => true; e.combat.updateGuard(); e.combat.pressBreak();
  assert.equal(e.combat.guardUp, undefined); assert.equal(e.combat.breakArmed(), null);
  assert.deepEqual(e.actor.toJSON(), before); assert.equal(e.state.party.itemCount('item', 1), 2);
  assert.equal(e.b.hp, 10000); assert.deepEqual(e.combat.skillCD, {});
});

for (const vr of [false, true]) test(`Rampage ${vr ? 'VR' : 'PC'} forces an ordinary delayed melee attack and pauses it with gameplay`, t => {
  const e = environment(t); G.vr = vr; rampage(e); $data.skills[1].repeats = 2;
  const art = $data.skills[10] = action(10, { mp_cost: 7, damage: { ...critical(), formula: '1000' } });
  e.combat.skillArm = { skill: art }; e.combat.breakArm = { skill: art, until: 99 };
  const camera = G.three.camera.quaternion.clone();
  e.combat.updateConfusion(0.01, true); assert.equal(e.combat.skillArm, null); assert.equal(e.combat.breakArm, null);
  assert.equal(e.combat.delayedActions, undefined);
  e.combat.updateConfusion(0.01, false); assert.equal(e.b.hp, 10000);
  e.advance(5, true); assert.equal(e.b.hp, 10000);
  e.advance(0.112); assert.equal(e.b.hp, 9900); e.advance(0.12); assert.equal(e.b.hp, 9800);
  assert.equal(e.actor.mp, 1000); assert.ok(G.three.camera.quaternion.equals(camera));
});

test('Rampage normal gun volleys retain real projectiles, attack count, target direction and original held model', t => {
  const e = environment(t); rampage(e); e.combat.weapon.userData.ranged = true; e.combat.shotKind = 'gun';
  $data.actors[1].features.push(trait(34, 0, 2));
  const weapon = e.combat.weapon, camera = G.three.camera.quaternion.clone();
  assert.equal(e.combat.performConfusionAttack(e.enemy), true); assert.equal(e.combat.projectiles.length, 1);
  assert.equal(e.b.hp, 10000, 'a gun shot is not fabricated instantaneous damage');
  e.advance(0.16); assert.equal(e.combat.projectiles.length, 3);
  for (const p of e.combat.projectiles) {
    assert.equal(p.owner, 'player'); assert.equal(p.one, true); assert.equal(p.normalAttackOnly, true); assert.equal(p.target, e.enemy);
    const to = e.enemy.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, e.enemy.h * 0.6, 0)).sub(p.mesh.position).normalize();
    assert.ok(p.vel.clone().normalize().dot(to) > 0.999);
  }
  assert.equal(e.combat.weapon, weapon); assert.ok(G.three.camera.quaternion.equals(camera));
});

test('Rampage native gun follow-up keeps the original skill cost and stops unavailable or departed targets', t => {
  const e = environment(t); rampage(e); e.combat.weapon.userData.ranged = true; e.combat.shotKind = 'gun';
  $data.skills[1].note = '<使用後追加行動:10,-2,100>';
  const shot = $data.skills[10] = action(10, { mp_cost: 7, repeats: 2 });
  t.mock.method(e.combat, 'skillLook', obj => obj === shot ? 'gun' : 'melee');
  assert.equal(e.combat.performConfusionAttack(e.enemy), true); assert.equal(e.actor.mp, 993);
  assert.equal(e.combat.projectiles[0].usable, shot); e.battle.done = true; e.advance(1);
  assert.equal(e.combat.projectiles.length, 1, 'later native rounds do not cross battle ownership');
  assert.equal(e.combat.performConfusionAttack(e.enemy), false);
  e.battle.done = false; e.enemy.mesh.visible = false; assert.equal(e.combat.performConfusionAttack(e.enemy), false);
});

test('Rampage cannot attack through a blocked route and a cured state cancels a pending forced strike', t => {
  const e = environment(t); rampage(e); G.map.passableFor = () => false;
  assert.equal(e.combat.performConfusionAttack(e.enemy), false); assert.equal(e.b.hp, 10000);
  G.map.passableFor = () => true; clearEdgeCache(); assert.equal(e.combat.performConfusionAttack(e.enemy), true);
  e.actor.removeState(38); e.advance(1); assert.equal(e.b.hp, 10000); assert.equal(e.combat.manualConfusionBlocked(), false);
});

test('common gameplay updates dispatch Rampage automatically and an inspection menu freezes its attack', t => {
  const e = environment(t); rampage(e); e.battle.time = 0;
  Object.assign(G.map, { interpreter: { running: () => false }, reservedCommon: [] });
  Object.assign(G.input, { block: () => false, disarmPressed: () => false });
  e.combat.fadingMarkers = []; e.combat.staminaDelay = 0;
  for (const method of ['refreshEquipment', 'alignHeldToRay', 'updateDeskShield', 'updateDesktopEquipment', 'updateQuick',
    'updateReady', 'updateHeld', 'updateFx', 'updateAreaMarks', 'updateSymbols', 'updateWeaponGlow', 'updateBreakReady',
    'updateActorStates', 'updateGhost', 'updateWeaponFx', 'updateEnemies', 'updateProjectiles', 'updateWaves', 'updateHazards', 'updatePopups']) t.mock.method(e.combat, method, () => {});
  t.mock.method(e.combat.allies, 'update', () => {});
  G.ui.menuOpen = true; e.combat.update(0.01); assert.equal(e.b.hp, 10000); assert.equal(e.combat.delayedActions, undefined);
  assert.equal(e.combat.performConfusionAttack(e.enemy), false, 'direct dispatch cannot evade menu pause');
  G.ui.menuOpen = false; e.combat.update(0.01); assert.equal(e.b.hp, 10000);
  G.time += 0.112; e.combat.update(0.112); assert.equal(e.b.hp, 9900);
  e.actor.removeState(38); e.combat.updateConfusion(0.01, false); assert.equal(e.combat.confusionSwing, null);
});

test('the real Player retains locomotion and manual look during Rampage while dodge input is denied', t => {
  const e = environment(t); rampage(e);
  const map = G.map = new GameMap(); map.mapId = 1;
  map.grid = { w: 1000, h: 1000, valid: () => true, region: () => 0, terrainTag: () => 0, passable: () => true };
  map.playerEdgePassable = () => true;
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  rig.position.set(100.5 * T, 0, 100.5 * T);
  const player = G.player = new Player(rig, camera); G.three.camera = camera;
  Object.assign(map.playerChar, { x: 100, realX: 100, fx: 100, y: 100, realY: 100, fy: 100 }); player.lastTile = { x: 100, y: 100 };
  Object.assign(G.settings, { moveSpeed: 3, runMultiplier: 1.5, eyeHeight: 1.6, snapTurn: true });
  Object.assign(G.input, { mouse: { dx: 20, dy: 5 }, moveVector: () => ({ x: 0, y: -1 }), running: () => false,
    dodge: () => true, jumpPressed: () => false, interact: () => false, turnAxis: () => 0 });
  const before = player.headWorld(new THREE.Vector3()).clone(); player.update(0.1);
  assert.ok(player.headWorld(new THREE.Vector3()).distanceTo(before) > 0.1);
  assert.equal(player.dodge.t, 0); assert.equal(player.dodge.cooldown, 0); assert.notEqual(player.yaw, 0);
  e.actor.removeState(38); player.update(0.01); assert.ok(player.dodge.t > 0, 'the same actual dodge input works once confusion ends');
});
