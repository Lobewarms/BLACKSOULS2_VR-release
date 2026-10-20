import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const skill = (id, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Synthetic skill ${id}`, note: '',
  occasion: 0, scope: 11, hit_type: 0, success_rate: 100, repeats: 1, stype_id: 0, animation_id: 0,
  mp_cost: 5, tp_cost: 0, tp_gain: 0, damage: { type: 0 },
  effects: [{ code: 11, data_id: 0, value1: 0, value2: 20 }], ...extra });

function environment(t, { chances = [0.5], inCombat = true } = {}) {
  const old = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, old); Object.assign($data, data); });
  const stats = [2000, 1000, 80, 30, 100, 30, 30, 30];
  Object.assign($data, {
    actors: [null, { id: 1, class_id: 1, initial_level: 1, equips: [], note: '', icon_index: 88,
      features: chances.map(value => ({ code: 61, value })) }],
    classes: [null, { note: '', features: [], learnings: [], exp_params: [30, 20, 30, 30],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [], armors: [], items: [], states: [], skills: [], animations: [], commonEvents: [], system: { sounds: [] },
  });
  $data.skills[1] = skill(1, { scope: 1, hit_type: 1, mp_cost: 0, effects: [],
    damage: { type: 1, formula: '10', variance: 0, element_id: 0 } });
  $data.skills[101] = skill(101);
  $data.skills[102] = skill(102, { mp_cost: 7 });
  $data.skills[103] = skill(103, { scope: 1, hit_type: 1, effects: [], damage: { type: 1, formula: '10' } });
  $data.skills[104] = skill(104, { scope: 1, hit_type: 2, effects: [], damage: { type: 1, formula: '10' } });
  $data.skills[105] = skill(105, { scope: 0, mp_cost: 3, effects: [{ code: 44, data_id: 1 }] });
  $data.skills[106] = skill(106, { note: '<クールタイム:2>' });
  $data.commonEvents[1] = { id: 1, trigger: 0, list: [{ code: 0, parameters: [], indent: 0 }] };
  const state = new GameState(), map = new GameMap(); map.mapId = 1;
  Object.assign(G, { state, map, scripts: {}, time: 10, vr: false, xrAway: false, settings: { swingLevel: 2 },
    audio: null, coop: null, screen: { playAnimationOn() {} }, floorAt: () => 0,
    ui: { menuOpen: false, sceneOpen: null, pointerTarget: false, consumedConfirm: false,
      messageBusy: () => false, dialogueActive: () => false, toast() {}, closeMenu() { this.menuOpen = false; } } });
  state.party.actors = [1]; const actor = state.party.leader(); actor.hp = 400; actor.mp = 500;
  for (const obj of $data.skills.filter(Boolean)) actor.learnSkill(obj.id);
  const root = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  root.add(rig); rig.add(camera); camera.position.y = 1.6;
  G.three = { camera, rig }; G.player = { rig, headWorld: out => camera.getWorldPosition(out),
    forwardVec: () => new THREE.Vector3(0, 0, -1) };
  G.input = { attackPressed: () => true, mouseHeld: () => false, breakPressed: () => false, haptic() {}, controllers: {} };
  const enemy = { alive: true, hr: 0.2, h: 1.6, worldPos: out => out.set(0, 0, -1) };
  const battle = { done: false, enemies: [enemy] }; enemy.battle = battle;
  let targets = [enemy], rolls = 0;
  const hits = [], shots = [], launches = [], scheduled = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, weapon: new THREE.Group(), stamina: 1, staminaDelay: 0, rangedCooldown: 0, skillCD: {},
    battles: inCombat ? [battle] : [], sideInterps: [], allies: { list: [], unitOf: () => null },
    allTargets: () => targets, pickTargets: () => [...targets],
    readyAim: () => ({ enemy: targets[0] || null, point: new THREE.Vector3(0, 0, -1), dir: new THREE.Vector3(0, 0, -1) }),
    playerHitEnemy: (...args) => hits.push(args), applyUsableToEnemy: (...args) => hits.push(args),
    fireShot: (...args) => shots.push(args), spawnProjectile: (...args) => launches.push(args),
    launchUsable: (...args) => launches.push(args),
    later: (ms, run) => scheduled.push({ at: G.time + ms / 1000, run }),
    playerFollowUp() {}, breakArmed: () => null, gunShotSkill: () => null, weaponLength: () => 1,
    showArms() {}, popupAtPlayer() {}, spawnGlow() {}, pressBreak() {},
    swingAtNpcs() {}, swingAtPlayers() {}, clashWithPlayers() {},
  });
  combat.weapon.userData.length = 1;
  combat.bonusManager().random = () => { rolls++; return 0; };
  const advance = (dt, { paused = false } = {}) => {
    G.time += dt;
    if (!paused) combat.rangedCooldown = Math.max(0, combat.rangedCooldown - dt);
    combat.updateBonusActions(dt, paused);
    for (const timer of scheduled.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= G.time + 1e-9) timer.run(); else scheduled.push(timer);
    }
  };
  const cast = id => combat.useSkillFromMenu($data.skills[id]);
  const ready = obj => {
    const fx = new THREE.Group(); root.add(fx);
    combat.ready = { obj, kind: 'skill', fx, aim: combat.readyAim(), marker: { dispose() {} } };
    const mp = actor.mp; combat.fireReady(); return actor.mp < mp;
  };
  return { actor, state, map, combat, battle, enemy, hits, shots, launches, cast, ready, advance,
    targets: next => { targets = next; }, count: () => combat.bonusStatus()?.count || 0, get rolls() { return rolls; } };
}

test('a guaranteed extra action waits for the active phase and the last follow-up retains normal recovery', t => {
  const e = environment(t, { chances: [1] });
  assert.equal(e.cast(101), true); assert.equal(e.actor.mp, 495);
  assert.equal(e.cast(102), false); assert.equal(e.actor.mp, 495);
  e.advance(0.299); assert.equal(e.cast(102), false); assert.equal(e.actor.mp, 495);
  e.advance(0.002); assert.equal(e.count(), 1); assert.equal(e.cast(102), true);
  assert.equal(e.actor.mp, 488); assert.equal(e.count(), 0);
  e.advance(0.301); assert.equal(e.cast(101), false, 'ending the bonus active phase cannot immediately restart a normal chain');
  assert.equal(e.actor.mp, 488); e.advance(0.6);
  assert.equal(e.cast(101), true); assert.equal(e.actor.mp, 483);
  assert.equal(e.rolls, 0, 'guaranteed traits and their bonus actions need no probability draws');
});

test('independent sources grant separate follow-ups without rerolling either extra action', t => {
  const e = environment(t, { chances: [0.5, 0.5] });
  assert.equal(e.cast(101), true); e.advance(0.301);
  assert.equal(e.count(), 2); assert.equal(e.rolls, 2);
  assert.equal(e.cast(101), true); assert.equal(e.count(), 1);
  e.advance(0.301); assert.equal(e.cast(102), true); assert.equal(e.count(), 0); assert.equal(e.rolls, 2);
  e.advance(0.301); assert.equal(e.cast(101), false); assert.equal(e.actor.mp, 483);
  e.advance(0.6); assert.equal(e.cast(101), true); e.advance(0.301);
  assert.equal(e.rolls, 4); assert.equal(e.count(), 2);
});

test('alternating skill IDs, common events and weapons cannot evade the shared normal action recovery', t => {
  const e = environment(t, { chances: [] }); assert.equal(e.cast(101), true);
  for (const dt of [0, 0.299, 0.002, 0.598]) {
    e.advance(dt); const mp = e.actor.mp;
    assert.equal(e.cast(102), false); assert.equal(e.cast(105), false); assert.equal(e.actor.mp, mp);
    assert.deepEqual(e.map.reservedCommon, [], 'rejected utility spam cannot dispatch common events');
    assert.equal(e.combat.sideInterps.length, 0);
    e.combat.shotKind = null; e.combat.updatePlayerAttack(0); assert.equal(e.combat.swing, undefined);
    e.combat.shotKind = 'bow'; assert.equal(e.combat.fireRanged(), false); assert.equal(e.shots.length, 0);
  }
  e.advance(0.002); assert.equal(e.cast(102), true); assert.equal(e.actor.mp, 488);
});

test('a combat common-event-only skill observes recovery without earning follow-ups', t => {
  const e = environment(t, { chances: [1] });
  assert.equal(e.cast(105), true); assert.equal(e.actor.mp, 497); assert.equal(e.combat.sideInterps.length, 1);
  assert.equal(e.combat.sideInterps[0].battleOwner, e.battle, 'the accepted common event keeps its actual fight owner');
  assert.equal(e.cast(101), false); e.advance(0.301);
  assert.equal(e.count(), 0); assert.equal(e.cast(101), false); assert.equal(e.actor.mp, 497);
  e.advance(0.6); assert.equal(e.cast(101), true); assert.equal(e.actor.mp, 492);
});

test('out-of-combat support cannot bank extra actions for a later fight', t => {
  const e = environment(t, { chances: [1], inCombat: false });
  assert.equal(e.cast(101), true); e.advance(12); assert.equal(e.count(), 0);
  e.combat.battles = [e.battle]; assert.equal(e.count(), 0);
  assert.equal(e.cast(101), true); e.advance(0.301); assert.equal(e.count(), 1);
});

test('follow-ups survive elapsed time within their fight, end with the fight and are absent from saves', t => {
  const e = environment(t, { chances: [1] }); assert.equal(e.cast(101), true); e.advance(0.301);
  assert.equal(e.count(), 1); e.advance(30); assert.equal(e.count(), 1, 'there is no three-second charge expiry');
  const saved = JSON.parse(JSON.stringify(e.state));
  assert.equal(saved.system.bonusActions, undefined); assert.equal(saved.system._bonusActions, undefined);
  assert.equal(saved.actors[0].bonusActions, undefined);
  e.battle.done = true; e.combat.updateBonusActions(0, false); assert.equal(e.count(), 0);
  e.combat.battles = [{ done: false, enemies: [e.enemy] }]; assert.equal(e.count(), 0);
});

test('support returns to gameplay and all action recovery freezes on reopening the menu', t => {
  const e = environment(t, { chances: [] }); G.ui.menuOpen = true;
  assert.equal(e.cast(101), true); assert.equal(G.ui.menuOpen, false); e.advance(0.301);
  G.ui.menuOpen = true;
  assert.equal(e.cast(102), false); assert.equal(e.actor.mp, 495);
  e.advance(30, { paused: true }); assert.equal(e.cast(102), false, 'inspection cannot finish the trailing support recovery');
  G.ui.menuOpen = false; e.advance(0.6); G.ui.menuOpen = true;
  assert.equal(e.cast(102), true); assert.equal(e.actor.mp, 488); assert.equal(G.ui.menuOpen, false);
  G.ui.menuOpen = false; e.advance(0.901); assert.equal(e.cast(103), true);
  G.ui.menuOpen = true; e.advance(30, { paused: true }); G.ui.menuOpen = false;
  assert.equal(e.cast(101), false, 'waiting in the menu cannot finish a protected field action');
  e.advance(0.901); assert.equal(e.cast(101), true);
});

for (const variant of ['single support', 'repeated support', 'single direct attack', 'repeated direct attack', 'single readied spell', 'repeated readied spell']) {
  test(`${variant} shares the minimum active phase and normal recovery without multiplying costs`, t => {
    const e = environment(t, { chances: [] }), repeated = variant.startsWith('repeated');
    const obj = variant.includes('support') ? $data.skills[101] : variant.includes('readied') ? $data.skills[104] : $data.skills[103];
    obj.repeats = repeated ? 3 : 1;
    const fire = () => variant.includes('readied') ? e.ready(obj) : e.cast(obj.id);
    assert.equal(fire(), true); assert.equal(e.actor.mp, 495);
    assert.equal(e.cast(102), false); e.advance(0.299); assert.equal(e.cast(102), false);
    e.advance(0.002); assert.equal(e.cast(102), false); assert.equal(e.actor.mp, 495);
    if (variant.includes('support')) assert.equal(e.actor.hp, 400 + 20 * obj.repeats);
    else if (variant.includes('direct')) assert.equal(e.hits.length, obj.repeats);
    else { assert.equal(e.launches.length, 1); assert.equal(e.launches[0][2].usable.repeats, obj.repeats); }
    e.advance(0.6);
    if (repeated && variant.includes('direct')) {
      assert.equal(e.cast(102), false, 'the two spaced repeat hits retain their extra protected tail');
      assert.equal(e.actor.mp, 495); e.advance(0.24);
    }
    assert.equal(e.cast(102), true); assert.equal(e.actor.mp, 488);
  });
}

test('failed costs, cooldowns and missing targets neither spend a follow-up nor restart its recovery', t => {
  const e = environment(t, { chances: [1] }); assert.equal(e.cast(101), true); e.advance(0.301);
  e.actor.mp = 0; assert.equal(e.cast(102), false); assert.equal(e.count(), 1);
  e.actor.mp = 100; e.combat.skillCD[106] = G.time + 10;
  assert.equal(e.cast(106), false); assert.equal(e.actor.mp, 100); assert.equal(e.count(), 1);
  e.targets([]); assert.equal(e.cast(103), false); assert.equal(e.actor.mp, 100); assert.equal(e.count(), 1);
  e.targets([e.enemy]); assert.equal(e.cast(102), true); assert.equal(e.actor.mp, 93); assert.equal(e.count(), 0);
});

function planning(e) {
  assert.equal(e.cast(101), true); e.advance(0.301);
  G.ui.menuOpen = true; G.ui.menuSection = 'skills';
}

test('R skill selection reserves only earned actions and never pays, rolls or saves a planning draft', t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  const before = JSON.stringify(e.state), mp = e.actor.mp;
  for (let i = 0; i < 30; i++) assert.equal(e.combat.menuSkillChainStatus($data.skills[102]).remaining, 2);
  assert.equal(e.combat.queueMenuSkill($data.skills[101]), true);
  assert.equal(e.combat.queueMenuSkill($data.skills[102]), true);
  assert.equal(e.combat.queueMenuSkill($data.skills[103]), false, 'a third selection cannot borrow a future random roll');
  assert.deepEqual(e.combat.menuSkillChainStatus().skills.map(s => s.id), [101, 102]);
  assert.equal(e.combat.menuSkillChainStatus().capacity, 2); assert.equal(e.count(), 2);
  assert.equal(e.actor.mp, mp); assert.equal(e.rolls, 0); assert.equal(JSON.stringify(e.state), before);
  assert.equal(e.combat.removeMenuSkill(), true); assert.equal(e.combat.menuSkillChainStatus().queued, 1);
  e.combat.clearMenuSkillChain(); assert.equal(e.combat.menuSkillChainStatus().queued, 0); assert.equal(e.count(), 2);
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'PC'} released R skills cast in order, spend one bonus each and retain the final recovery`, t => {
  const e = environment(t, { chances: [1, 1] }); G.vr = vr; planning(e);
  e.combat.queueMenuSkill($data.skills[101]); e.combat.queueMenuSkill($data.skills[102]);
  e.advance(50, { paused: true }); assert.equal(e.actor.mp, 495); assert.equal(e.count(), 2);
  assert.equal(e.combat.releaseMenuSkillChain(), true); G.ui.menuOpen = false;
  e.advance(0.001); assert.equal(e.actor.mp, 490); assert.equal(e.count(), 1);
  assert.deepEqual(e.combat.menuSkillChainStatus().skills.map(s => s.id), [102]);
  e.advance(0.299); assert.equal(e.actor.mp, 490, 'active animation cannot be skipped by queued skills');
  e.advance(0.002); assert.equal(e.actor.mp, 483); assert.equal(e.count(), 0);
  assert.equal(e.combat.menuSkillChain, null); assert.equal(e.rolls, 0);
  e.advance(0.301); assert.equal(e.cast(101), false, 'the final bonus still owns its full trailing recovery');
  e.advance(0.6); assert.equal(e.cast(101), true);
});

test('R can plan during an active cast but a released chain waits for that actual cast to finish', t => {
  const e = environment(t, { chances: [1, 1] }); assert.equal(e.cast(101), true);
  G.ui.menuOpen = true; G.ui.menuSection = 'skills';
  assert.equal(e.combat.menuSkillChainStatus().ready, false);
  assert.equal(e.combat.queueMenuSkill($data.skills[102]), true);
  e.advance(30, { paused: true }); assert.equal(e.actor.mp, 495);
  assert.equal(e.combat.releaseMenuSkillChain(), true); G.ui.menuOpen = false;
  e.advance(0.299); assert.equal(e.actor.mp, 495);
  e.advance(0.002); assert.equal(e.actor.mp, 488); assert.equal(e.count(), 1);
});

test('reopening R or headset-away pauses remaining released casts without changing order or costs', t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  e.combat.queueMenuSkill($data.skills[101]); e.combat.queueMenuSkill($data.skills[102]);
  e.combat.releaseMenuSkillChain(); G.ui.menuOpen = false; e.advance(0.001);
  G.ui.menuOpen = true; const active = e.combat.menuSkillChainStatus().activeRemaining;
  e.advance(40, { paused: true }); assert.equal(e.actor.mp, 490);
  assert.ok(Math.abs(e.combat.menuSkillChainStatus().activeRemaining - active) < 1e-9);
  assert.equal(e.combat.queueMenuSkill($data.skills[101]), false, 'an executing chain cannot be extended with normal casts');
  G.ui.menuOpen = false; G.xrAway = true; e.advance(40); assert.equal(e.actor.mp, 490);
  G.xrAway = false; e.advance(0.301); assert.equal(e.actor.mp, 483);
});

for (const rejection of ['cost', 'cooldown', 'target']) test(`a queued ${rejection} rejection stops the remainder without spending a follow-up`, t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  const first = rejection === 'target' ? 103 : 106;
  assert.equal(e.combat.queueMenuSkill($data.skills[first]), true);
  assert.equal(e.combat.queueMenuSkill($data.skills[102]), true);
  if (rejection === 'cost') e.actor.mp = 0;
  if (rejection === 'cooldown') e.combat.skillCD[106] = G.time + 10;
  if (rejection === 'target') e.targets([]);
  const mp = e.actor.mp;
  e.combat.releaseMenuSkillChain(); G.ui.menuOpen = false; e.advance(0.01); e.advance(10);
  assert.equal(e.actor.mp, mp); assert.equal(e.count(), 2); assert.equal(e.combat.menuSkillChain, null);
  assert.equal(e.hits.length, 0); assert.equal(e.rolls, 0);
});

for (const invalidation of ['fight', 'death', 'transfer', 'map', 'world', 'sources']) test(`a queued chain cannot survive ${invalidation} ownership loss`, t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  e.combat.queueMenuSkill($data.skills[102]); e.combat.releaseMenuSkillChain(); G.ui.menuOpen = false;
  if (invalidation === 'fight') e.battle.done = true;
  if (invalidation === 'death') e.combat.playerDead = true;
  if (invalidation === 'transfer') e.map.transferring = true;
  if (invalidation === 'map') e.map.mapId++;
  if (invalidation === 'world') G.state = new GameState();
  if (invalidation === 'sources') $data.actors[1].features = [];
  e.advance(1);
  assert.equal(e.actor.mp, 495); assert.equal(e.combat.menuSkillChain, null);
});

test('draft cancellation keeps bonuses and ordinary use without earned extras retains the single-cast path', t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  e.combat.queueMenuSkill($data.skills[102]);
  G.ui.menuSection = 'main'; e.advance(0, { paused: true });
  assert.equal(e.combat.menuSkillChain, null); assert.equal(e.count(), 2); assert.equal(e.actor.mp, 495);
  e.combat.clearBonusActions(); G.ui.menuSection = 'skills';
  assert.equal(e.combat.queueMenuSkill($data.skills[102]), false);
  assert.equal(e.combat.releaseMenuSkillChain(), false); assert.equal(e.actor.mp, 495);
});

test('a queued native stage that becomes utility cannot execute without spending a follow-up', t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  assert.equal(e.combat.queueMenuSkill($data.skills[101]), true);
  const byState = e.combat.skillByState.bind(e.combat);
  e.combat.skillByState = (actor, object) => object?.id === 101 ? $data.skills[105] : byState(actor, object);
  assert.equal(e.combat.releaseMenuSkillChain(), true); G.ui.menuOpen = false; e.advance(0.01);
  assert.equal(e.actor.mp, 495); assert.equal(e.count(), 2); assert.equal(e.combat.sideInterps.length, 0);
  assert.equal(e.combat.menuSkillChain, null);
});

test('a cooldown started by the first queued cast blocks a duplicate without paying for or skipping the failed cast', t => {
  const e = environment(t, { chances: [1, 1] }); planning(e);
  assert.equal(e.combat.queueMenuSkill($data.skills[106]), true);
  assert.equal(e.combat.queueMenuSkill($data.skills[106]), true);
  e.combat.releaseMenuSkillChain(); G.ui.menuOpen = false; e.advance(0.01); e.advance(0.301);
  assert.equal(e.actor.mp, 490); assert.equal(e.count(), 1); assert.equal(e.combat.menuSkillChain, null);
  assert.ok(e.combat.skillCooling($data.skills[106]) > 0);
});
