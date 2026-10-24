import { combatMotion } from './helpers/combat-motion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Input } from '../src/core/input.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const visible = combat => !!combat.breakGlow?.visible;

function environment(t, vr = false) {
  const old = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, old); Object.assign($data, data); });
  const root = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  root.add(rig); rig.position.set(2, 0, 3); camera.position.set(0, 1.6, 0); rig.add(camera);
  const grip = new THREE.Group(); grip.position.set(0.3, 1.2, -0.4); rig.add(grip);
  const weapon = new THREE.Group(); (vr ? grip : camera).add(weapon);
  weapon.userData = { length: 2, visualLength: 0.5, ranged: false };
  const length = vr ? 2 : 0.5, geo = new THREE.BoxGeometry(0.04, 0.04, length); geo.translate(0, 0, -length / 2);
  const mat = new THREE.MeshLambertMaterial(); weapon.add(new THREE.Mesh(geo, mat));
  const input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0 }, mousePresses: 0, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, haptic() {} });
  const skill = { id: 13, name: 'Break', note: '', occasion: 0, effects: [{ code: 21, data_id: 8, value1: 1 }], damage: { type: 0 } };
  const actor = { hp: 100, cri: 0, featuresSet: () => [], featureObjects: () => [], allSkills: () => [skill],
    skillCostPayable: () => true, skillSealed: () => false, skillTypeUsable: () => true, isState: () => false };
  $data.skills = []; $data.skills[13] = skill; $data.system = { currency_unit: 'Souls' };
  Object.assign(G, { vr, time: 10, settings: { ...G.settings, fxBrightness: 0.5, swingLevel: 2 },
    state: { party: { leader: () => actor } }, input, scripts: {}, coop: null, emotes: null,
    map: { grid: {}, transferring: false, interpreter: { running: () => false }, reservedCommon: [] },
    ui: { menuOpen: false, sceneOpen: false, msg: null, pointerTarget: null, consumedConfirm: false },
    player: { rig, headWorld: out => camera.getWorldPosition(out), forwardVec: () => new THREE.Vector3(0, 0, -1) },
    three: { camera }, audio: { playSe() {}, playSystemSe() {} } });
  const glow = new THREE.Texture();
  const combat = Object.assign(Object.create(CombatSystem.prototype), { ...combatMotion(), root, weapon, battles: [], fadingMarkers: [],
    stamina: 1, staminaDelay: 0, rangedCooldown: 0, skillCD: {}, prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(), prevRel: new THREE.Vector3(),
    allies: { update() {} }, allTargets: () => [], glowTexture: () => glow, swingAtNpcs() {}, swingAtPlayers() {}, clashWithPlayers() {} });
  // Keep the real common update, equipment visibility, input, readiness and attack paths.
  for (const name of ['refreshEquipment', 'alignHeldToRay', 'updateGripAdjust', 'updateGuard', 'updateDeskShield',
    'updateQuick', 'updateReady', 'updateHeld', 'updateFx', 'updateAreaMarks', 'updateSymbols', 'updateActorStates',
    'updateGhost', 'updateWeaponFx', 'updateEnemies', 'updateProjectiles', 'updateWaves', 'updateHazards', 'updatePopups', 'setGhostly']) combat[name] = () => {};
  t.after(() => { geo.dispose(); mat.dispose(); glow.dispose(); combat.breakGlow?.material.dispose(); });
  const frame = (dt = 1 / 60) => {
    G.time += dt; combat.update(dt);
    input.keysPrev = new Set(input.keys); input.mouse.prevButtons = input.mouse.buttons; input.mousePresses = 0;
    input.btnPrev = { left: [...input.btn.left], right: [...input.btn.right] };
  };
  const hold = on => { if (vr) input.btn.left[0] = on; else if (on) input.keys.add('KeyF'); else input.keys.delete('KeyF'); };
  return { combat, input, weapon, grip, camera, actor, skill, frame, hold };
}

for (const vr of [false, true]) test(`${vr ? 'VR' : 'desktop'} common frames put the readiness cue at the drawn weapon tip independently of attacks`, t => {
  const { combat, weapon, frame, hold } = environment(t, vr);
  let attacks = 0; combat.updatePlayerAttack = () => { attacks++; };
  hold(true); frame();
  assert.equal(attacks, 1); assert.equal(visible(combat), true, 'the common frame owns readiness in either mode');
  const expected = new THREE.Vector3(0, 0, -(vr ? 2 : 0.5)).applyMatrix4(weapon.matrixWorld);
  assert.ok(combat.breakGlow.position.distanceTo(expected) < 1e-9);
  assert.equal(combat.breakGlow.parent, combat.root);
  const pulse = 0.75 + 0.25 * Math.sin(G.time * 12);
  assert.ok(Math.abs(combat.breakGlow.scale.x - (vr ? 0.16 : 0.09) * pulse) < 1e-9);
  if (!vr) {
    const gameplayTip = new THREE.Vector3(0, 0, -2).applyMatrix4(weapon.matrixWorld);
    assert.ok(combat.breakGlow.position.distanceTo(gameplayTip) > 1, 'desktop light follows visible art rather than the hidden full-length hit segment');
  }
  hold(false); frame(); assert.equal(visible(combat), false);
});

test('real keyboard and middle-button holds show readiness without latching across release or cooldown', t => {
  const { combat, input, frame, hold } = environment(t);
  hold(true); frame(); assert.equal(visible(combat), true);
  hold(false); frame(); assert.equal(visible(combat), false); assert.equal(combat.breakArm, undefined);
  input.mouse.buttons = 2; frame(); assert.equal(visible(combat), true, 'middle mouse is the same held Break input');
  combat.breakCooldown = G.time + 0.5; frame(); assert.equal(visible(combat), false);
  frame(0.6); assert.equal(visible(combat), true, 'a still-held command becomes ready only after cooldown');
  input.mouse.buttons = 0; frame(); assert.equal(visible(combat), false);
});

test('a real quick-slot Break arms the cue for three seconds and expiry clears it without attacking', t => {
  const { combat, frame } = environment(t);
  let hits = 0; combat.breakOnHit = () => { hits++; };
  assert.equal(combat.useQuickEntry({ kind: 'skill', id: 13 }), true);
  frame(); assert.equal(visible(combat), true); assert.ok(combat.breakArm);
  frame(3.1); assert.equal(visible(combat), false); assert.equal(combat.breakArm, null);
  assert.equal(hits, 0); assert.equal(combat.swing, undefined); assert.equal(combat.stamina, 1);
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'desktop'} readiness disappears for paused scenes and unavailable hands, then returns safely`, t => {
  const { combat, weapon, actor, frame, hold } = environment(t, vr);
  hold(true); frame(); assert.equal(visible(combat), true);
  const cases = [
    ['menu', () => { G.ui.menuOpen = true; }, () => { G.ui.menuOpen = false; }],
    ['scene', () => { G.ui.sceneOpen = true; }, () => { G.ui.sceneOpen = false; }],
    ['dialogue', () => { G.ui.msg = {}; }, () => { G.ui.msg = null; }],
    ['transfer', () => { G.map.transferring = true; }, () => { G.map.transferring = false; }],
    ['disarmed', () => { combat.disarmed = true; }, () => { combat.disarmed = false; }],
    ['restrained', () => { combat.restrained = true; }, () => { combat.restrained = false; }],
    ['spectating', () => { combat.spectating = true; }, () => { combat.spectating = false; }],
    ['grip adjustment', () => { combat.gripAdjust = true; }, () => { combat.gripAdjust = false; }],
    ['readied spell', () => { combat.ready = {}; }, () => { combat.ready = null; }],
    ['held consumable', () => { combat.held = { how: 'rub' }; }, () => { combat.held = null; }],
    ['detached weapon', () => { weapon.removeFromParent(); }, () => { (vr ? G.player.rig : G.three.camera).add(weapon); }],
    ['missing weapon', () => { combat.weapon = null; }, () => { combat.weapon = weapon; }],
    ['death', () => { actor.hp = 0; combat.playerDead = true; }, () => { actor.hp = 100; combat.playerDead = false; }],
  ];
  for (const [name, enter, leave] of cases) {
    enter(); frame(); assert.equal(visible(combat), false, name);
    leave(); weapon.visible = true; frame(); assert.equal(visible(combat), true, `${name} ended`);
  }
  if (vr) weapon.visible = false; else G.ui.banner = {};
  frame(); assert.equal(visible(combat), false, 'hidden hands cannot leave a floating tip cue');
});

test('holding Break alone never hits; a real desktop click and release still supplies the attack', t => {
  const { combat, input, frame, hold } = environment(t);
  const target = { hr: 0.2, worldPos: out => out.set(2, 0, 1.8) };
  let breaks = 0, normal = 0;
  combat.allTargets = () => [target]; combat.breakOnHit = () => { breaks++; }; combat.playerHitEnemy = () => { normal++; };
  hold(true); frame(); frame(); frame();
  assert.equal(visible(combat), true); assert.equal(breaks, 0); assert.equal(normal, 0); assert.equal(combat.swing, undefined);
  input.mouse.buttons = 1; frame(); assert.notEqual(combat.deskCharge, null); assert.equal(breaks, 0);
  input.mouse.buttons = 0; frame(0.12);
  assert.equal(breaks, 1); assert.equal(normal, 0, 'the real swing routes its one target to the held Break action');
});
