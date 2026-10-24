import { combatMotion } from './helpers/combat-motion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState, GameActor, BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');

function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const params = [100, 50, 10, 10, 10, 10, 40, 5];
  Object.assign($data, {
    actors: [null, { id: 1, class_id: 1, initial_level: 1, features: [], equips: [], note: '' }],
    classes: [null, { features: [], learnings: [], params: { xsize: 8, ysize: 2, data: [...params, ...params] } }],
    weapons: [null, { id: 1, features: [{ code: 61, value: 0.3 }], params: Array(8).fill(0), note: '' }],
    armors: [null, { id: 1, features: [{ code: 61, value: 0.5 }], params: Array(8).fill(0), note: '' }],
    states: [null, { id: 1, features: [] }, { id: 2, features: [{ code: 61, value: 1 }] },
      { id: 3, features: [{ code: 21, data_id: 6, value: 0.5 }] }],
    skills: [null, { id: 1, repeats: 1, scope: 1, note: '', damage: { type: 1 } }],
  });
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); camera.position.y = 1.6;
  Object.assign(G, { state: new GameState(), scripts: {}, time: 10, vr: false, audio: null, coop: null,
    settings: { swingLevel: 2 }, ui: { pointerTarget: false, consumedConfirm: false }, three: { camera, rig },
    player: { rig, headWorld: target => camera.getWorldPosition(target), forwardVec: () => new THREE.Vector3(0, 0, -1) },
  });
  const actor = new GameActor(1); actor.equips = []; G.state.actorMap.set(1, actor); G.state.party.actors = [1];
  G.map = { mapId: 1, interpreter: { running: () => false } };
  let press = true, held = false;
  G.input = { attackPressed: () => press, mouseHeld: () => held, breakPressed: () => false,
    xrPressed: (hand, button) => press && hand === 'right' && button === 0, xrHeld: () => false, haptic() {} };
  const enemy = { hitCooldown: 0, hr: 0.2, alive: true, worldPos: target => target.set(0, 0, -1) };
  const hits = [], shots = [], scheduled = [], costs = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { ...combatMotion(),
    weapon: new THREE.Group(), stamina: 1, staminaDelay: 0, rangedCooldown: 0, skillCD: {},
    prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(), prevRel: new THREE.Vector3(),
    allTargets: () => [enemy], playerHitEnemy: (...args) => hits.push(args), breakArmed: () => null,
    pressBreak() {}, showBreakReady() {}, swingAtNpcs() {}, swingAtPlayers() {}, clashWithPlayers() {},
    fireShot: (...args) => shots.push(args), later: (ms, run) => scheduled.push({ ms, run }),
    actorPays: (...args) => costs.push(args), gunShotSkill: () => null, weaponLength: () => 1,
    readyAim: () => ({ enemy, point: new THREE.Vector3(0, 0, -1) }),
  });
  combat.weapon.userData.length = 1;
  return { actor, enemy, combat, hits, shots, scheduled, costs,
    press: value => { press = value; }, held: value => { held = value; } };
}

test('extra-action equipment does not passively accelerate player swing animation or AGI', t => {
  const { actor, combat } = environment(t);
  actor.equips = [{ kind: 'weapon', id: 1 }, { kind: 'armor', id: 1 }];
  actor.addState(2); assert.equal(combat.bonusStatus(), null, 'traits alone cannot mint a bonus before an action');
  combat.updatePlayerAttack(0); assert.equal(combat.swing.duration, 0.32);
  assert.equal(actor.agi, 40);
  actor.equips = []; actor.addBuff(6, 3); assert.equal(actor.agi, 50);
  assert.equal(combat.swing.duration, 0.32, 'AGI remains available to formulas without changing animation cadence');
});

test('speed equipment and expiring AGI effects change real damage formulas and enemy windups', t => {
  const { actor, combat } = environment(t);
  class Target extends BattlerBase { paramBase(i) { return i === 0 ? 100 : 10; } }
  const target = new Target(), skill = { hit_type: 1, speed: 0, damage: { type: 1, element_id: 0, variance: 0, formula: 'a.atk * 2 + a.agi * 2 - b.def * 2' } };
  const normalDamage = combat.computeDamage(actor, target, skill);
  const normalWindup = combat.windupTime({ b: actor }, skill, 'melee');
  $data.armors[1].features = [{ code: 21, data_id: 6, value: 1.5 }]; $data.armors[1].params[6] = 20;
  actor.equips = [{ kind: 'armor', id: 1 }];
  assert.equal(actor.agi, 90); assert.equal(combat.computeDamage(actor, target, skill) - normalDamage, 100);
  assert.ok(combat.windupTime({ b: actor }, skill, 'melee') < normalWindup);
  actor.equips = []; actor.addState(3);
  assert.ok(combat.windupTime({ b: actor }, skill, 'melee') > normalWindup);
  actor.removeState(3); actor.addBuff(6, 1); assert.equal(actor.agi, 50);
  actor.tickBuffs(1); assert.equal(actor.agi, 40); assert.equal(combat.computeDamage(actor, target, skill), normalDamage);
  assert.ok(combat.windupTime({ b: actor }, { ...skill, speed: -40 }, 'melee') > normalWindup);
});

test('a desktop swing crosses its hit window at low frame rates, pays once and keeps guard down until recovery ends', t => {
  const e = environment(t); e.actor.addState(2); $data.states[2].features.push({ code: 61, value: 1 });
  let npcActions = 0; e.combat.swingAtNpcs = () => npcActions++;
  e.combat.updatePlayerAttack(0); e.press(false);
  assert.equal(e.combat.swing.duration, 0.32);
  assert.equal(e.combat.stamina, 0.9); assert.equal(e.combat.handsBusy(), true);
  G.time += 0.2; e.combat.updatePlayerAttack(0.2);
  assert.equal(e.hits.length, 1); assert.equal(npcActions, 1, 'the short active window cannot vanish between frames');
  G.time += 0.2; e.combat.updatePlayerAttack(0.2);
  assert.equal(e.combat.swing, null); assert.equal(e.combat.handsBusy(), false);
  assert.equal(e.hits.length, 1); assert.equal(npcActions, 1); assert.equal(e.combat.stamina, 0.9);
});

test('the deliberate charge and active swing time remain unchanged by extra-action traits', t => {
  const e = environment(t); e.actor.addState(2); e.held(true);
  e.combat.updatePlayerAttack(0.01); assert.equal(e.combat.swing, undefined);
  G.time += 0.65; e.press(false); e.held(false); e.combat.updatePlayerAttack(0);
  assert.ok(Math.abs(e.combat.swing.charge - 0.5) < 1e-12); assert.equal(e.combat.stamina, 0.8);
  assert.equal(e.combat.swing.duration, 0.32);
  e.actor.removeState(2); G.time += 0.32; e.combat.updatePlayerAttack(0.32); assert.equal(e.combat.swing, null);
  e.press(true); e.combat.updatePlayerAttack(0);
  assert.equal(e.combat.swing.duration, 0.32, 'neither a state nor its removal changes the active animation');
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'PC'} ranged recovery observes cooldown and still requires a fresh attack input`, t => {
  const e = environment(t); G.vr = vr; e.actor.addState(2);
  e.combat.weapon.userData.ranged = true; e.combat.shotKind = 'gun';
  e.combat.updatePlayerAttack(0.01);
  assert.equal(e.shots.length, 1); assert.equal(e.combat.rangedCooldown, 0.6);
  assert.equal(e.combat.handsBusy(), !vr);
  e.combat.updatePlayerAttack(0.01); assert.equal(e.shots.length, 1, 'an active cooldown blocks another trigger edge');
  e.press(false); G.time += 0.61; e.combat.rangedCooldown = 0; e.combat.updateBonusActions(0.61, false); e.combat.updatePlayerAttack(0.01);
  assert.equal(e.shots.length, 1, 'bonus actions cannot auto-fire when the player supplies no new input');
  e.press(true); e.combat.updatePlayerAttack(0.01); assert.equal(e.shots.length, 2);
});

test('burst recovery keeps the original hit count and spacing rather than multiplying attacks', t => {
  const e = environment(t); e.actor.addState(2); e.combat.shotKind = 'gun'; e.combat.attackHits = () => 3;
  e.combat.fireRanged();
  assert.ok(Math.abs(e.combat.rangedCooldown - 0.76) < 1e-12);
  assert.ok(Math.abs(e.combat.deskActUntil - (G.time + 0.46)) < 1e-12);
  assert.deepEqual(e.scheduled.map(s => s.ms), [80, 160]);
  e.scheduled.forEach(s => s.run()); assert.equal(e.shots.length, 3); assert.equal(e.costs.length, 0);
});

test('skill-shot recovery stays at its base while payment and skill turn cooldown remain unchanged', t => {
  const e = environment(t); e.actor.addState(2);
  const skill = { id: 9, repeats: 3, scope: 1, mp_cost: 0, tp_cost: 0, note: '<クールタイム:3>' };
  e.combat.fireSkillShot(e.actor, skill);
  assert.ok(Math.abs(e.combat.rangedCooldown - 0.76) < 1e-12);
  assert.equal(e.costs.length, 1); assert.equal(e.combat.skillCD[9], G.time + e.combat.coolSeconds(skill));
  e.scheduled.forEach(s => s.run()); assert.equal(e.shots.length, 3); assert.equal(e.costs.length, 1);
  e.combat.fireSkillShot(e.actor, skill); assert.equal(e.combat.rangedCooldown, 0.25); assert.equal(e.costs.length, 1);
});

test('skill-shot bursts keep guard down through their tail while preserving the full default guard duration', t => {
  const e = environment(t), skill = { id: 9, repeats: 7, scope: 1, mp_cost: 0, tp_cost: 0, note: '' };
  e.combat.shotKind = 'gun'; e.combat.gunShotSkill = () => skill;
  for (const extra of [0, 1, 2]) {
    const expected = 0.9;
    $data.states[2].features = Array.from({ length: extra }, () => ({ code: 61, value: 1 }));
    e.actor.addState(2); e.combat.deskActUntil = undefined; e.combat.rangedCooldown = 0;
    e.combat.playerRecoveryUntil = e.combat.playerActiveUntil = 0; e.combat.fireRanged();
    assert.ok(Math.abs(e.combat.deskActUntil - (G.time + expected)) < 1e-12);
    G.time += 0.48; assert.equal(e.combat.handsBusy(), true, 'the last scheduled bullet cannot overlap an active guard');
    G.time += expected - 0.48 + 0.001; assert.equal(e.combat.handsBusy(), false);
    e.actor.removeState(2);
  }
  assert.equal(e.costs.length, 3, 'recovery adjustment cannot create another skill payment');
});

test('physical VR melee retains its real motion and one-stroke debounce with extra actions', t => {
  const e = environment(t); G.vr = true; e.press(false); e.actor.addState(2);
  let tipX = 0;
  e.combat.weaponSegment = (base, tip) => { base.set(0, 0, 0); tip.set(tipX, 0, -1); return true; };
  e.combat.segmentHitsEnemy = () => true;
  const position = e.combat.weapon.position.clone(), orientation = e.combat.weapon.quaternion.clone();
  e.combat.updatePlayerAttack(0.01); tipX = 1; G.time += 0.01; e.combat.updatePlayerAttack(0.01);
  assert.equal(e.hits.length, 1); assert.equal(e.enemy.hitCooldown, 0.45);
  tipX = 2; G.time += 0.01; e.combat.updatePlayerAttack(0.01); assert.equal(e.hits.length, 1);
  assert.ok(e.combat.weapon.position.equals(position)); assert.ok(e.combat.weapon.quaternion.equals(orientation));
});
