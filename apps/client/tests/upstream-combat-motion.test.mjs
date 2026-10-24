import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { DeskSwing, DESK_REST } from '../src/combat/deskswing.js';
import { WeaponLag, weaponSway } from '../src/combat/weaponlag.js';
import { combatMotion } from './helpers/combat-motion.mjs';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
function environment(t) {
  const saved = { ...G }, data = { ...$data }; t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  const stats = [500, 100, 30, 20, 30, 20, 30, 20];
  Object.assign($data, { actors: [null, { id: 1, class_id: 1, initial_level: 1, features: [], equips: [], note: '' }],
    classes: [null, { features: [], learnings: [], exp_params: [30, 20, 30, 30], params: { xsize: 8, ysize: 2, data: [...stats, ...stats] } }],
    skills: [null, { id: 1, scope: 1, damage: { type: 1 }, effects: [], note: '' }], states: [], weapons: [], armors: [], system: {} });
  const root = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  root.add(rig); rig.add(camera); camera.position.y = 1.6;
  const state = G.state = new GameState(); state.party.actors = [1]; const actor = state.party.leader();
  let pressed = true;
  Object.assign(G, { state, scripts: {}, time: 10, vr: false, xrAway: false, coop: null, audio: null, settings: { swingLevel: 2, weaponWeight: 2 },
    ui: {}, map: { mapId: 1, interpreter: { running: () => false } }, three: { camera, rig },
    player: { rig, pitch: 0, headWorld: out => camera.getWorldPosition(out), forwardVec: () => new THREE.Vector3(0, 0, -1) },
    screen: { hitShake() {} }, input: { controllers: { right: { grip: new THREE.Group() } }, haptic() {}, attackPressed: () => pressed, mouseHeld: () => false, breakPressed: () => false } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), combatMotion(), { root, battles: [], symbols: new Map(),
    stamina: 1, staminaDelay: 0, skillCD: {}, allTargets: () => [], swingAtNpcs() {}, swingAtPlayers() {}, pressBreak() {} });
  const equip = (id, agility, rate = 1) => {
    $data.weapons[id] = { id, name: 'Synthetic weapon', etype_id: 0, wtype_id: 4, icon_index: -1, note: '',
      params: [0, 0, 0, 0, 0, 0, agility, 0], features: [{ code: 21, data_id: 6, value: rate }] };
    actor.equips = [{ kind: 'weapon', id }]; G.time += 2; combat.stamina = 1; combat.refreshEquipment();
    pressed = true;
  };
  t.after(() => combat.retireHeldEquipment());
  return { combat, actor, equip, release: () => { pressed = false; } };
}

test('actual equipped weapon weight changes PC swing duration and stamina once while actor AGI remains its native stat', t => {
  const { combat, actor, equip } = environment(t);
  for (const [id, agi, rate, pace] of [[1, 0, 1, 1], [2, 100, 1, 1.35], [3, -100, 1, 0.65], [4, 0, 1.44, 1.2]]) {
    equip(id, agi, rate); assert.ok(Math.abs(combat.weaponPace - pace) < 1e-12);
    const nativeAGI = actor.agi, mp = actor.mp;
    combat.updatePlayerAttack(0);
    assert.ok(Math.abs(combat.swing.duration - 0.32 / pace) < 1e-12);
    assert.ok(Math.abs(1 - combat.stamina - 0.1 / pace) < 1e-12);
    assert.equal(actor.agi, nativeAGI); assert.equal(actor.mp, mp);
  }
});

test('desktop cuts chain from their prior pose, reset after idle and distinguish the charged thrust', () => {
  const motion = new DeskSwing(), weapon = new THREE.Group(), body = new THREE.Quaternion();
  motion.reset(weapon, true); assert.ok(weapon.position.equals(DESK_REST.p));
  const first = { charge: 0 }; motion.begin(first, 10); assert.equal(first.style, 0);
  motion.update(weapon, 0.32, 10.32, first, 1, null, body);
  const ended = weapon.position.clone(); motion.update(weapon, 0, 10.32, null, 0, null, body);
  const second = { charge: 0 }; motion.begin(second, 10.4); assert.equal(second.style, 1);
  assert.ok(motion.start.p.equals(ended), 'a chained cut must not jump back to its initial carry pose');
  motion.update(weapon, 0.32, 10.72, second, 1, null, body); motion.update(weapon, 0, 10.72, null, 0, null, body);
  const afterIdle = { charge: 0 }; motion.begin(afterIdle, 11.4); assert.equal(afterIdle.style, 0);
  const charged = { charge: 0.5 }; motion.begin(charged, 12); assert.equal(charged.style, 'thrust');
  motion.update(weapon, 0.1, 12.1, charged, 0.4, null, body);
  assert.ok([...weapon.position, ...weapon.quaternion].every(Number.isFinite));
});

test('VR weight responds to wrist motion without treating rig travel as arm motion and settles to the real held pose', () => {
  const rig = new THREE.Group(), grip = new THREE.Group(), weapon = new THREE.Group(); rig.add(grip); grip.add(weapon);
  const sway = weaponSway(0.65, 1.6, 2); assert.ok(sway); assert.equal(weaponSway(1.35, 0.3, 2), null); assert.equal(weaponSway(0.65, 1.6, 0), null);
  const fixedGrip = new THREE.Group(), fixedWeapon = new THREE.Group(); fixedGrip.add(fixedWeapon);
  const fixedLag = new WeaponLag(); fixedLag.reset(fixedWeapon, sway); fixedLag.update(1 / 60);
  const lag = new WeaponLag(); lag.reset(weapon, sway); lag.update(1 / 60);
  const held = weapon.quaternion.clone(); rig.position.set(10, 2, 5); rig.rotation.y = Math.PI / 2; lag.update(1 / 60);
  fixedLag.update(1 / 60);
  assert.ok(weapon.quaternion.angleTo(fixedWeapon.quaternion) < 1e-7, 'rig travel leaves exactly the same gravity response as a stationary body');
  grip.rotation.y = 0.7; lag.update(1 / 60);
  assert.ok(weapon.quaternion.angleTo(held) > 0.1, 'a heavy blade follows the wrist with physical lag');
  for (let frame = 0; frame < 120; frame++) lag.update(1 / 120);
  assert.ok([...weapon.position, ...weapon.quaternion].every(Number.isFinite));
  lag.settle(); assert.ok(weapon.quaternion.angleTo(held) < 1e-7);
});

test('heavy-weapon attack poise survives one plain hit, then staggers, with a protected interval preventing stun lock', t => {
  const { combat, equip } = environment(t); equip(1, -100);
  combat.swing = {}; assert.ok(combat.poiseMax() > 0.9);
  combat.poiseHit(0.5, null); assert.equal(combat.staggered(), false);
  combat.poiseHit(0.5, null); assert.equal(combat.staggered(), true); assert.equal(combat.swing, null);
  const until = combat.staggerUntil; combat.poiseHit(5, null); assert.equal(combat.staggerUntil, until);
  G.time = until + 0.1; combat.poiseHit(5, null); assert.equal(combat.staggerUntil, until);
  G.time = until + 0.5; combat.poiseHit(0.5, null); assert.ok(combat.staggerUntil > until);
});
