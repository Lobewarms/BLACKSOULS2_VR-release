import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const usable = (id, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Synthetic action ${id}`, note: '',
  occasion: 0, scope: 11, hit_type: 0, success_rate: 100, repeats: 1, stype_id: 0, animation_id: 0,
  mp_cost: 5, tp_cost: 0, tp_gain: 0, damage: { type: 0 }, effects: [{ code: 11, data_id: 0, value1: 0, value2: 20 }], ...extra });

function environment(t) {
  const saved = { ...G }, old = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, old); });
  const stats = [1000, 200, 80, 30, 100, 30, 30, 30];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1, equips: [], icon_index: 88,
      note: '', features: [{ code: 61, value: 0.5 }] }],
    classes: [null, { note: '', features: [], learnings: [], exp_params: [30, 20, 30, 30],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [], armors: [], items: [], states: [], animations: [], commonEvents: [],
    system: { sounds: [] }, skills: [],
  });
  $data.skills[1] = usable(1, { scope: 1, hit_type: 1, mp_cost: 0, effects: [],
    damage: { type: 1, formula: '10', variance: 0, element_id: 0 } });
  $data.skills[101] = usable(101);
  $data.commonEvents[4] = { id: 4, trigger: 0, list: [{ code: 0, parameters: [], indent: 0 }] };
  const state = new GameState(), map = new GameMap(); map.mapId = 1;
  Object.assign(G, { state, map, time: 10, vr: false, xrAway: false, scripts: {}, settings: { swingLevel: 2 },
    audio: null, coop: null, screen: { playAnimationOn() {} },
    ui: { pointerTarget: false, consumedConfirm: false, menuOpen: false, sceneOpen: null,
      messageBusy: () => false, dialogueActive: () => false, toast() {}, closeMenu() { this.menuOpen = false; } } });
  state.party.actors = [1]; const actor = state.party.leader(); actor.learnSkill(101); actor.hp = 400; actor.mp = 100;
  const root = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  root.add(rig); rig.add(camera); camera.position.y = 1.6;
  G.three = { camera, rig }; G.player = { rig, headWorld: out => camera.getWorldPosition(out),
    forwardVec: () => new THREE.Vector3(0, 0, -1) };
  let press = true, held = false, targets;
  G.input = { attackPressed: () => press, mouseHeld: () => held, breakPressed: () => false, haptic() {}, controllers: {},
    xrPressed: (hand, index) => press && hand === 'right' && index === 0, xrHeld: () => false };
  const enemy = { alive: true, hr: 0.2, h: 1.6, hitCooldown: 0, worldPos: out => out.set(0, 0, -1) };
  const battle = { done: false, enemies: [enemy] }; enemy.battle = battle;
  targets = [enemy];
  const hits = [], shots = [], scheduled = [], launches = [], followups = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, weapon: new THREE.Group(), stamina: 1, staminaDelay: 0, skillCD: {}, rangedCooldown: 0,
    battles: [battle], sideInterps: [], prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(), prevRel: new THREE.Vector3(),
    allTargets: () => targets, pickTargets: () => [...targets],
    readyAim: () => ({ enemy: targets[0] || null, point: new THREE.Vector3(0, 0, -1), dir: new THREE.Vector3(0, 0, -1) }),
    playerHitEnemy: (...args) => hits.push(args), applyUsableToEnemy: (...args) => hits.push(args),
    fireShot: (...args) => shots.push(args), spawnProjectile: (...args) => launches.push(args),
    launchUsable: (...args) => launches.push(args), later: (ms, run) => scheduled.push({ ms, run }),
    breakArmed: () => null, pressBreak() {}, swingAtNpcs() {}, swingAtPlayers() {}, clashWithPlayers() {},
    weaponLength: () => 1, gunShotSkill: () => null, showArms() {}, popupAtPlayer() {}, spawnGlow() {},
    playerFollowUp: (...args) => followups.push(args), allies: { list: [], unitOf: () => null },
  });
  combat.weapon.userData.length = 1;
  let rolls = 0; combat.bonusManager().random = () => { rolls++; return 0; };
  const advance = (dt, { attack = false, paused = false } = {}) => {
    G.time += dt;
    if (!paused) { combat.rangedCooldown = Math.max(0, combat.rangedCooldown - dt); enemy.hitCooldown = Math.max(0, enemy.hitCooldown - dt); }
    combat.updateBonusActions(dt, paused);
    if (attack && !paused) combat.updatePlayerAttack(dt);
  };
  const prime = () => {
    assert.equal(combat.useSkillFromMenu($data.skills[101]), true); advance(0.301);
    assert.equal(combat.bonusStatus()?.count, 1);
  };
  const ready = (obj, kind = 'skill') => {
    const fx = new THREE.Group(); root.add(fx);
    combat.ready = { obj, kind, fx, aim: combat.readyAim(), marker: { dispose() {} } };
  };
  return { combat, actor, state, map, enemy, hits, shots, scheduled, launches, followups, advance, prime, ready,
    press: value => { press = value; }, held: value => { held = value; }, targets: value => { targets = value; }, get rolls() { return rolls; } };
}

test('PC melee awards once after its active window and the final follow-up retains its own normal recovery', t => {
  const e = environment(t);
  e.combat.updatePlayerAttack(0); e.press(false);
  assert.equal(e.combat.swing.duration, 0.32); assert.equal(e.combat.bonusStatus(), null);
  e.advance(0.1, { attack: true }); assert.equal(e.hits.length, 1); assert.equal(e.rolls, 0);
  e.advance(0.13, { attack: true }); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
  const firstStamina = e.combat.stamina;
  e.press(true); e.combat.updatePlayerAttack(0); e.press(false);
  assert.equal(e.combat.swing.action.ticket.bonus, true); assert.equal(e.combat.bonusStatus(), null);
  assert.ok(Math.abs(firstStamina - e.combat.stamina - 0.12) < 1e-9); assert.equal(e.combat.swing.duration, 0.32);
  e.advance(0.23, { attack: true }); assert.equal(e.combat.swing, null); assert.equal(e.rolls, 1);
  const bonusStamina = e.combat.stamina;
  e.press(true); e.combat.updatePlayerAttack(0);
  assert.equal(e.combat.swing, null, 'finishing the follow-up active animation does not finish its trailing recovery');
  assert.equal(e.combat.stamina, bonusStamina);
  e.press(false); e.advance(0.1, { attack: true }); assert.equal(e.combat.swing, null);
  e.press(true); e.combat.updatePlayerAttack(0);
  assert.ok(e.combat.swing); assert.equal(e.combat.swing.action.ticket.bonus, false);
});

test('a held melee pose, missing target and failed stamina cannot consume a banked charge', t => {
  const e = environment(t); e.prime(); e.targets([]);
  e.combat.updatePlayerAttack(0); assert.equal(e.combat.swing, undefined); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.targets([e.enemy]); e.combat.stamina = 0; e.combat.updatePlayerAttack(0);
  assert.equal(e.combat.swing, undefined); assert.equal(e.combat.bonusStatus()?.count, 1);
});

test('VR bonus hits require another physical stroke and never repeat a continuous arc or stationary pose', t => {
  const e = environment(t); G.vr = true; e.press(false);
  let tip = 0;
  e.combat.weaponSegment = (base, out) => { base.set(0, 0, 0); out.set(tip, 0, -1); return true; };
  e.combat.segmentHitsEnemy = () => true;
  e.advance(0.01, { attack: true }); tip = 1; e.advance(0.01, { attack: true });
  assert.equal(e.hits.length, 1); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
  tip = 2; e.advance(0.01, { attack: true }); assert.equal(e.hits.length, 1); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.advance(0.02, { attack: true }); assert.equal(e.hits.length, 1);
  tip = 3; e.advance(0.01, { attack: true });
  assert.equal(e.hits.length, 2); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 1);
  tip = 4; e.advance(0.01, { attack: true }); e.advance(0.02, { attack: true });
  assert.equal(e.hits.length, 2); assert.equal(e.rolls, 1);
  tip = 5; e.advance(0.01, { attack: true });
  assert.equal(e.hits.length, 2); assert.equal(e.rolls, 1, 'a fresh gesture still waits for the final follow-up recovery');
  e.advance(0.46, { attack: true }); tip = 6; e.advance(0.01, { attack: true });
  assert.equal(e.hits.length, 3); assert.equal(e.rolls, 2);
});

test('a ranged burst rolls once, preserves every bullet and its tail, and a bonus burst cannot generate another charge', t => {
  const e = environment(t); e.combat.shotKind = 'gun'; e.combat.attackHits = () => 3;
  assert.equal(e.combat.fireRanged(), true); assert.equal(e.shots.length, 1);
  assert.deepEqual(e.scheduled.map(s => s.ms), [80, 160]); assert.equal(e.combat.bonusStatus(), null);
  e.advance(0.2); assert.equal(e.combat.fireRanged(), false, 'the protected burst/animation window cannot be skipped');
  e.advance(0.26); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
  assert.equal(e.combat.fireRanged(), true, 'the earned follow-up bypasses the first burst trailing recovery');
  assert.ok(Math.abs(e.combat.rangedCooldown - 0.76) < 1e-9);
  assert.equal(e.combat.bonusStatus(), null); e.scheduled.forEach(s => s.run());
  assert.equal(e.shots.length, 6); assert.equal(e.combat.bonusStatus(), null);
  e.advance(0.46); assert.equal(e.rolls, 1); assert.equal(e.combat.fireRanged(), false);
  e.advance(0.3); assert.equal(e.combat.fireRanged(), true);
});

test('air shots and rejected skill-shot costs or cooldowns retain available bonus charges', t => {
  const e = environment(t); e.prime(); e.combat.shotKind = 'gun'; e.targets([]);
  assert.equal(e.combat.fireRanged(), false); assert.equal(e.shots.length, 0); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.advance(0.6); assert.equal(e.combat.fireRanged(), true); e.advance(0.31);
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1, 'free firing without a valid aim target cannot roll traits');
  e.targets([e.enemy]); const shot = usable(102, { scope: 1, mp_cost: 10, effects: [], damage: { type: 1 } });
  e.actor.mp = 0; assert.equal(e.combat.fireSkillShot(e.actor, shot), false);
  assert.equal(e.combat.bonusStatus()?.count, 1); e.actor.mp = 100; e.combat.skillCD[102] = G.time + 10;
  assert.equal(e.combat.fireSkillShot(e.actor, shot), false); assert.equal(e.actor.mp, 100); assert.equal(e.combat.bonusStatus()?.count, 1);
});

test('a skill-based gun burst pays and rolls once for the original action rather than for each bullet', t => {
  const e = environment(t), shot = usable(102, { scope: 1, repeats: 3, note: '<クールタイム:2>', effects: [], damage: { type: 1 } });
  e.combat.shotKind = 'gun'; e.combat.gunShotSkill = () => shot;
  assert.equal(e.combat.fireRanged(), true); assert.equal(e.actor.mp, 95); assert.equal(e.combat.bonusPending.length, 1);
  e.scheduled.forEach(s => s.run()); assert.equal(e.shots.length, 3); assert.equal(e.actor.mp, 95); assert.equal(e.rolls, 0);
  e.advance(0.46); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
  assert.equal(e.combat.fireRanged(), false); assert.equal(e.actor.mp, 95); assert.equal(e.combat.bonusStatus()?.count, 1);
});

test('readied spells consume charges only on valid paid release and retain original per-skill cooldowns', t => {
  const e = environment(t); e.prime();
  const spell = $data.skills[102] = usable(102, { scope: 1, hit_type: 2, note: '<クールタイム:2>',
    effects: [], damage: { type: 1 } });
  e.targets([]); e.ready(spell); e.combat.fireReady();
  assert.equal(e.actor.mp, 95); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.targets([e.enemy]); e.ready(spell); e.combat.fireReady();
  assert.equal(e.actor.mp, 90); assert.equal(e.combat.bonusStatus(), null);
  assert.equal(e.combat.skillCD[102], G.time + e.combat.coolSeconds(spell));
  e.scheduled.forEach(s => s.run()); assert.equal(e.launches.length, 1); assert.equal(e.rolls, 1);
  e.ready(spell); e.combat.fireReady(); assert.equal(e.actor.mp, 90); assert.equal(e.rolls, 1);
});

test('direct menu support pays every cast, uses one bonus to bypass recovery and never rerolls a bonus cast', t => {
  const e = environment(t); G.ui.menuOpen = true;
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true);
  assert.deepEqual([e.actor.hp, e.actor.mp], [420, 95]); assert.equal(e.combat.bonusStatus()?.count, 1);
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), false); assert.equal(e.actor.mp, 95);
  e.advance(0.301, { paused: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true);
  assert.deepEqual([e.actor.hp, e.actor.mp], [440, 90]); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 1);
  e.advance(0.301, { paused: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), false, 'the final extra support action retains its normal trailing recovery');
  assert.equal(e.actor.mp, 90); e.advance(0.6, { paused: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true); assert.equal(e.actor.mp, 85);
});

test('ordinary support can be used again after normal recovery while the same menu remains open', async t => {
  for (const source of ['none', 'failed roll']) await t.test(source, t => {
    const e = environment(t); G.ui.menuOpen = true;
    if (source === 'none') $data.actors[1].features = [];
    else e.combat.bonusManager().random = () => 1;
    assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true);
    assert.deepEqual([e.actor.hp, e.actor.mp], [420, 95]); assert.equal(e.combat.bonusStatus(), null);
    e.advance(0.2, { paused: true });
    assert.equal(e.combat.useSkillFromMenu($data.skills[101]), false, 'the normal short recovery still prevents immediate repeats');
    assert.deepEqual([e.actor.hp, e.actor.mp], [420, 95]);
    e.advance(0.11, { paused: true });
    assert.equal(e.combat.useSkillFromMenu($data.skills[101]), false, 'a normal combat skill keeps its full 0.9-second recovery');
    e.advance(0.591, { paused: true });
    assert.equal(G.ui.menuOpen, true); assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true);
    assert.deepEqual([e.actor.hp, e.actor.mp], [440, 90]); assert.equal(e.combat.bonusStatus(), null);
  });
});

test('direct offensive repeats and an additional common event form one eligible action without charging absent targets', t => {
  const e = environment(t), attack = usable(102, { scope: 1, hit_type: 1, repeats: 3,
    effects: [{ code: 44, data_id: 4 }], damage: { type: 1 } });
  e.targets([]); assert.equal(e.combat.performUsable(attack, 'skill', 'menu', { direct: true }), false);
  assert.equal(e.actor.mp, 100); assert.equal(e.combat.bonusStatus(), null);
  e.targets([e.enemy]); assert.equal(e.combat.performUsable(attack, 'skill', 'menu', { direct: true }), true);
  assert.equal(e.actor.mp, 95); assert.equal(e.combat.sideInterps.length, 1); assert.equal(e.hits.length, 1);
  assert.equal(e.combat.sideInterps[0].battleOwner, e.enemy.battle);
  e.scheduled.forEach(s => s.run()); assert.equal(e.hits.length, 3); assert.equal(e.combat.bonusStatus(), null);
  e.advance(0.24); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
  e.advance(0.3); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
  e.combat.applyUsableToActor($data.skills[101], 'self'); assert.equal(e.rolls, 1); assert.equal(e.combat.bonusStatus()?.count, 1);
});

test('pure common events, field utility and items cannot consume or generate charges', t => {
  const e = environment(t); e.prime();
  const ritual = usable(102, { scope: 0, effects: [{ code: 44, data_id: 4 }] });
  assert.equal(e.combat.performUsable(ritual, 'skill', 'menu'), false, 'an ineligible ritual cannot spend a follow-up to bypass ordinary recovery');
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.combat.sideInterps.length, 0);
  e.advance(0.6);
  assert.equal(e.combat.performUsable(ritual, 'skill', 'menu'), true);
  assert.equal(e.combat.sideInterps.length, 1); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.combat.battles = []; assert.equal(e.combat.bonusStatus(), null);
  assert.equal(e.combat.performUsable(usable(103, { occasion: 2 }), 'skill', 'menu'), true);
  assert.equal(e.combat.performUsable(usable(105, { effects: [{ code: 42, data_id: 2, value1: 1 },
    { code: 43, data_id: 101 }] }), 'skill', 'menu'), true);
  const potion = usable(104, { __class: 'RPG::Item', consumable: true });
  assert.equal(e.combat.performUsable(potion, 'item'), true); assert.ok(e.combat.healing);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 1, 'out-of-combat utility cannot farm follow-ups for another fight');
});

test('a long menu or headset pause cannot finish pending burst actions or wait out recovery', t => {
  const e = environment(t); e.combat.shotKind = 'gun'; e.combat.attackHits = () => 3;
  e.combat.fireRanged(); e.advance(0.1);
  G.ui.menuOpen = true; e.advance(100, { paused: true });
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
  assert.ok(e.combat.playerActiveUntil > G.time); assert.ok(e.combat.playerRecoveryUntil > G.time);
  G.ui.menuOpen = false; assert.equal(e.combat.handsBusy(), true, 'resuming cannot raise guard through the remaining ranged active window');
  e.advance(0.35); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.combat.handsBusy(), true);
  e.advance(0.011); assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1); assert.equal(e.combat.handsBusy(), false);
  G.xrAway = true; e.advance(100, { paused: true }); assert.equal(e.combat.bonusStatus()?.count, 1);
  G.xrAway = false; e.advance(10); assert.equal(e.combat.bonusStatus()?.count, 1, 'earned follow-ups stay available until the fight ends');
});

test('PC active swing work does not complete while a menu pauses gameplay', t => {
  const e = environment(t); e.combat.updatePlayerAttack(0); e.press(false); e.advance(0.1, { attack: true });
  G.ui.menuOpen = true; e.advance(100, { paused: true });
  assert.equal(e.combat.swing.t, 0.1); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
  G.ui.menuOpen = false; e.advance(0.13, { attack: true }); assert.equal(e.combat.bonusStatus()?.count, 1);
});

test('dialogue continuity pauses pending actions even when the caller reports an otherwise unpaused frame', t => {
  const e = environment(t); e.combat.shotKind = 'gun'; e.combat.fireRanged();
  G.ui.dialogueActive = () => true; e.advance(100);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
  assert.ok(e.combat.playerActiveUntil > G.time);
  G.ui.dialogueActive = () => false; e.advance(0.3);
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
});

test('a target leaving before the melee hit window cannot farm normal-action rolls', t => {
  const e = environment(t); e.combat.updatePlayerAttack(0); e.press(false); e.targets([]);
  e.advance(0.23, { attack: true });
  assert.equal(e.hits.length, 0); assert.equal(e.rolls, 0); assert.equal(e.combat.bonusStatus(), null);
});

test('a cooling armed skill cannot spend a bonus charge or pay an unusable skill', t => {
  const e = environment(t); e.prime();
  const art = usable(102, { scope: 1, hit_type: 1, effects: [], damage: { type: 1 } });
  e.combat.skillArm = { skill: art }; e.combat.skillCD[102] = G.time + 10;
  e.combat.updatePlayerAttack(0);
  assert.equal(e.combat.swing, undefined); assert.equal(e.combat.bonusStatus()?.count, 1);
  assert.equal(e.combat.takeArmedSkill(e.actor), null); assert.equal(e.actor.mp, 95);
});

test('status clears dead, transferred and superseded ownership without needing another gameplay frame', t => {
  const e = environment(t); e.prime(); e.combat.playerDead = true;
  assert.equal(e.combat.bonusStatus(), null); e.combat.playerDead = false;
  e.advance(0.901); e.prime(); e.map.transferring = true;
  assert.equal(e.combat.bonusStatus(), null); e.map.transferring = false;
  e.advance(0.901); e.prime(); G.map = { mapId: 1 };
  assert.equal(e.combat.bonusStatus(), null);
});
