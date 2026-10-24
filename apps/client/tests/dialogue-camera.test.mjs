import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Player } from '../src/entities/player.js';
import { Interpreter } from '../src/game/interpreter.js';
import { GameMap } from '../src/world/gamemap.js';
import { T } from '../src/world/mapmesh.js';
import { $data } from '../src/data/data.js';
import { CharacterSprite } from '../src/entities/sprites.js';

globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} != ${expected}`);
const message = () => ({ lines: ['A neutral conversation page.'], background: 0, position: 2, faceName: '' });
const savedEnvironments = new WeakSet();

function environment(t) {
  if (!savedEnvironments.has(t)) {
    const old = { ...G }, system = $data.system;
    t.after(() => { Object.assign(G, old); $data.system = system; }); savedEnvironments.add(t);
  }
  $data.system = { currency_unit: 'Souls' };
  Object.assign(G, { vr: false, time: 0, view: null, floorAt: () => 0, coop: null, emotes: null,
    settings: { eyeHeight: 1.6, moveSpeed: 3, runMultiplier: 1.5, snapTurn: true },
    input: { mouse: { dx: 0, dy: 0 }, pageFocused: true, dialogueLooking: () => false, textInputFocused: () => false,
      turnAxis: () => 0, running: () => false }, combat: { playerDead: false } });
  const map = G.map = new GameMap(); map.mapId = 1;
  Object.assign(map.playerChar, { fx: 10, fy: 10, x: 10, y: 10, realX: 10, realY: 10 });
  const event = { id: 1, eventId: 999, realX: 12, realY: 9, characterName: '$SyntheticNpc', opacity: 255,
    erased: false, transparent: false, tileId: 0 };
  map.events[1] = event;
  const owner = map.interpreter; owner.setup([command(230, [999]), command(0)], 1);
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  scene.add(rig); rig.add(camera); camera.position.y = 1.6;
  rig.position.set(10.5 * T, 0, 10.5 * T); scene.updateMatrixWorld(true);
  const player = G.player = new Player(rig, camera);
  // Exercise real Player.update rotation; unrelated collision/locomotion stays stationary.
  player.canMove = () => false; player.resolve = (x, y) => [x, y]; player.keepOnHiddenWay = (x, y) => [x, y];
  player.updateHeight = () => {}; player.updateFootsteps = () => {}; player.afterMove = () => {};
  const ui = G.ui = Object.assign(Object.create(UI.prototype), { dialogue: null, heldMessage: null, msg: null,
    keyboard: { visible: false }, backdrop: { visible: false }, msgPanel: { mesh: { visible: false } }, namePanel: { mesh: { visible: false } },
    placeRoot() {}, layoutMessage() {}, drawMessage() {}, speakerName: () => 'Synthetic NPC' });
  const begin = (source = owner) => { ui.showMessage(message(), source); return player.dialogueCamera.focus; };
  const finishTurn = () => { for (let i = 0; i < 4; i++) player.dialogueCamera.update(0.1); };
  return { map, event, owner, player, camera, rig, scene, ui, begin, finishTurn };
}

test('a source-owned NPC gets one smooth short turn instead of an instant snap or continuous tracking', t => {
  const e = environment(t), { player, event } = e;
  assert.ok(e.begin()); const finalYaw = Math.atan2(-2 * T, T);
  close(player.yaw, 0, 'opening a page cannot snap the view');
  player.dialogueCamera.update(0.1);
  assert.ok(player.yaw < 0 && player.yaw > finalYaw);
  e.finishTurn(); close(player.yaw, finalYaw); assert.equal(player.dialogueCamera.focus, null);
  const yaw = player.yaw, pitch = player.pitch;
  event.realX = 9; event.realY = 12;
  player.dialogueCamera.update(1);
  close(player.yaw, yaw); close(player.pitch, pitch, 'the finished introduction does not track a moving speaker');
});

test('yaw interpolation crosses the nearest side of the pi boundary', t => {
  const e = environment(t), { player, event, rig } = e;
  player.yaw = Math.PI - 0.08;
  const desired = -Math.PI + 0.08, origin = rig.position;
  event.viewPos = { x: origin.x - Math.sin(desired) * 3, z: origin.z - Math.cos(desired) * 3, y: 0 };
  assert.ok(e.begin()); player.dialogueCamera.update(0.1);
  assert.ok(player.yaw > Math.PI - 0.08 && player.yaw < Math.PI + 0.08, 'turn only 0.16 radians across the seam');
  e.finishTurn(); close(player.yaw, Math.PI + 0.08);
});

test('the local target respects a transformed rig and the visible displaced sprite upper body', t => {
  const e = environment(t), { event, rig, scene, player } = e;
  rig.position.set(5, 2, 8); rig.rotation.y = Math.PI / 2;
  const targetLocal = new THREE.Vector3(2, 1.1, -3); scene.updateMatrixWorld(true);
  const targetWorld = rig.localToWorld(targetLocal.clone());
  event.viewPos = { x: targetWorld.x, y: targetWorld.y - 1.1, z: targetWorld.z };
  event.realX = 500; event.realY = 500;
  const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial());
  group.add(mesh); scene.add(group); mesh.position.copy(targetWorld); mesh.position.y -= 1.75 * 0.5 * 0.82;
  mesh.scale.y = 0.5;
  G.view = { sprites: [{ ch: event, group, mesh, mode: 'stand', bodySize: [1, 2], headDrop: 0.25 }] };
  scene.updateMatrixWorld(true); t.after(() => { mesh.geometry.dispose(); mesh.material.dispose(); });
  assert.ok(e.begin(), 'visible displaced position wins over the remote original event coordinates');
  e.finishTurn(); close(player.yaw, Math.atan2(-2, 3));
  close(player.pitch, Math.atan2(targetLocal.y - 1.6, Math.hypot(2, 3)));
});

test('a looping map focuses the nearest visible copy rather than the far original cell', t => {
  const e = environment(t), { map, event, rig, player } = e;
  map.grid = { w: 100, h: 100 }; map.loopX = true;
  Object.assign(map.playerChar, { fx: 0, x: 0, fy: 10, y: 10 }); rig.position.set(0.5 * T, 0, 10.5 * T);
  event.realX = 99; event.realY = 9;
  assert.ok(e.begin()); e.finishTurn(); close(player.yaw, Math.PI / 4);
});

test('a real standing sprite still loading its sheet uses speaking height while a pending floor prop stays excluded', t => {
  const e = environment(t);
  Object.assign(e.event, { isEvent: true, priorityType: 1, x: 12, y: 9 });
  const sprite = new CharacterSprite(e.event, e.scene, { tilesetNames: [], isWall: () => false });
  G.view = { sprites: [sprite] }; t.after(() => sprite.dispose());
  assert.equal(sprite.mesh, null); assert.equal(sprite.mode, undefined); assert.equal(sprite.layMode(), 'stand');
  assert.ok(e.begin(), 'source classification is available before the asynchronous sheet arrives');
  e.finishTurn(); close(e.player.yaw, Math.atan2(-2 * T, T));
  e.event.priorityType = 0;
  assert.equal(sprite.layMode(), 'lie'); assert.equal(e.player.dialogueCamera.begin(e.owner), false);
});

test('child messages use the main owner and later pages never re-centre after a completed or manual turn', t => {
  const e = environment(t), { player, owner, ui } = e;
  let begins = 0; const begin = player.dialogueCamera.begin.bind(player.dialogueCamera);
  player.dialogueCamera.begin = source => { begins++; return begin(source); };
  e.begin(); e.finishTurn(); assert.equal(begins, 1);
  player.yaw = 0.72; ui.msg = null;
  const child = new Interpreter(1); child.setup([command(230, [50]), command(0)], 1); child.root = owner; owner.child = child;
  ui.showMessage(message(), child); player.dialogueCamera.update(0.1);
  assert.equal(begins, 1); close(player.yaw, 0.72);
  owner.child = null; owner.setup([command(230, [999]), command(0)], 1);
  ui.showMessage(message(), owner); assert.equal(begins, 2, 'a genuinely new event execution gets its own introduction');
  G.input.mouse.dx = 8; player.update(0);
  close(player.yaw, 0.72 - 8 * 0.0025, 'manual input cancels the turn before its own delta is applied');
  assert.equal(player.dialogueCamera.focus, null); G.input.mouse.dx = 0;
  ui.showMessage(message(), owner); player.dialogueCamera.update(0.1);
  assert.equal(begins, 2); close(player.yaw, 0.72 - 8 * 0.0025);
});

test('RMB look immediately cancels even before motion and vertical input wins before the real Player applies it', t => {
  const e = environment(t), { player } = e;
  e.begin(); G.input.dialogueLooking = () => true; player.update(0);
  assert.equal(player.dialogueCamera.focus, null); close(player.yaw, 0); close(player.pitch, 0);
  G.input.dialogueLooking = () => false; e.begin();
  G.input.mouse.dy = 10; player.update(0);
  assert.equal(player.dialogueCamera.focus, null); close(player.pitch, -0.025); close(player.yaw, 0);
});

test('narration, non-main events, foreign ownership and hidden or floor props cannot request focus', t => {
  const cases = [
    ['narration', e => { e.owner.eventId = 0; }],
    ['parallel event', e => { e.owner.main = false; }],
    ['foreign map', e => { e.owner.mapId = 2; }],
    ['stopped owner', e => { e.owner.terminate(); }],
    ['unowned event', e => { delete e.map.events[1]; }],
    ['distant speaker', e => { e.event.realX = 100; }],
    ['erased', e => { e.event.erased = true; }],
    ['transparent', e => { e.event.transparent = true; }],
    ['zero opacity', e => { e.event.opacity = 0; }],
    ['tile event', e => { e.event.tileId = 10; }],
    ['no character', e => { e.event.characterName = ''; }],
    ['hidden sprite', e => { G.view = { sprites: [{ ch: e.event, mode: 'stand', hiddenNow: true }] }; }],
    ['invisible sprite', e => { G.view = { sprites: [{ ch: e.event, mode: 'stand', group: { visible: false } }] }; }],
    ['floor prop', e => { G.view = { sprites: [{ ch: e.event, mode: 'lay' }] }; }],
  ];
  for (const [label, change] of cases) {
    const e = environment(t); change(e);
    assert.equal(e.player.dialogueCamera.begin(e.owner), false, label);
    assert.equal(e.player.dialogueCamera.focus, null, label);
  }
});

test('VR never receives an automatic turn, including a desktop focus pending when XR begins', t => {
  const e = environment(t), { player, owner } = e;
  G.vr = true; assert.equal(player.dialogueCamera.begin(owner), false);
  G.vr = false; e.begin(); G.vr = true;
  player.dialogueCamera.update(0.1);
  assert.equal(player.dialogueCamera.focus, null); close(player.yaw, 0); close(player.pitch, 0);
});

test('death, transfer, changed execution, ended ownership and invalid positions cancel without a partial turn', t => {
  const cases = [
    ['death', () => { G.combat.playerDead = true; }],
    ['transfer', e => { e.map.transferring = true; }],
    ['map replacement', () => { G.map = new GameMap(); G.map.mapId = 1; }],
    ['new execution', e => { e.owner.setup([command(230, [999])], 1); }],
    ['ended owner', e => { e.owner.terminate(); }],
    ['changed event identity', e => { e.map.events[1] = { ...e.event }; }],
    ['invalid position', e => { e.event.realX = NaN; }],
    ['hidden while turning', e => { e.event.transparent = true; }],
    ['focus loss', () => { G.input.pageFocused = false; }],
    ['text field', () => { G.input.textInputFocused = () => true; }],
    ['menu', e => { e.ui.menuOpen = true; }],
    ['dialogue ended', e => { e.ui.dialogue = null; }],
    ['invalid frame', () => {}],
  ];
  for (const [label, change] of cases) {
    const e = environment(t); e.begin(); assert.ok(e.player.dialogueCamera.focus, label); change(e);
    e.player.dialogueCamera.update(label === 'invalid frame' ? NaN : 0.1);
    assert.equal(e.player.dialogueCamera.focus, null, label); close(e.player.yaw, 0, label); close(e.player.pitch, 0, label);
  }
});
