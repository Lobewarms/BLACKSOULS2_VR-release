import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';
import { GameMap } from '../src/world/gamemap.js';
import { MapGrid } from '../src/world/mapmesh.js';
import { $data } from '../src/data/data.js';

globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
const message = text => [command(101, ['', 0, 0, 2]), command(401, [text])];
const end = () => command(0);

function canvas() {
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * (Number.parseFloat(ctx.font) || 28) * 0.55 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, getContext: () => ctx };
}

function environment(t) {
  const saved = { ...G }, data = { ...$data }, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { createElement: canvas, hasFocus: () => true } });
  Object.assign($data, { system: { currency_unit: 'Souls', terms: { basic: [] } }, states: [], commonEvents: [], mapInfos: new Map() });
  const actor = { name: 'Synthetic actor', level: 1, hp: 100, mhp: 100, mp: 30, mmp: 50, states: [], buffs: Array(8).fill(0) };
  Object.assign(G, { vr: false, scripts: { fontSize: 19, screen: [640, 480] }, settings: {},
    state: { party: { leader: () => actor, gold: 100 }, system: { timer: { working: false } }, sw: () => false, v: () => 0 },
    combat: { stamina: 1, playerDead: false }, coop: null, arena: null, theater: null, audio: null, view: null, frame: 1, time: 0 });
  const input = G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { dx: 0, dy: 0, wheel: 0, buttons: 0, prevButtons: 0 }, mousePresses: 0,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    pointer: { x: 0, y: 0, seen: false }, pointerLocked: false, desktopLookWanted: false, softLook: false,
    pointerUiPaused: false, pageFocused: true,
    dom: { style: {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }) },
    lockPointer() {},
  });
  const map = G.map = new GameMap(); map.mapId = 1;
  map.map = { width: 4, height: 4, display_name: 'Synthetic room', data: { data: new Uint16Array(64) } };
  map.grid = new MapGrid(map.map, { flags: { data: new Uint16Array(8192) }, tileset_names: [] });
  Object.assign(map.playerChar, { x: 1, y: 1, realX: 1, realY: 1, fx: 1, fy: 1 });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  camera.position.y = 1.6; scene.add(camera);
  G.player = { headWorld: out => out.copy(camera.position), forward2D: () => ({ x: 0, z: -1 }) };
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  const frame = (keys = [], { logic = true } = {}) => {
    input.keys = new Set(keys);
    if (logic) map.update();
    ui.update(1 / 60); input.endFrame();
    input.btnPrev = { left: [...input.btn.left], right: [...input.btn.right] };
    G.frame++; G.time += 1 / 60;
  };
  const until = predicate => {
    for (let i = 0; i < 240; i++) { if (predicate()) return; frame(); }
    assert.fail('message did not reach its expected state');
  };
  const pointAtMessage = () => {
    scene.updateMatrixWorld(true);
    const center = ui.msgPanel.mesh.getWorldPosition(new THREE.Vector3());
    if (G.vr) {
      const ray = input.controllers.right.ray;
      ray.position.copy(camera.position);
      ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), center.sub(ray.position).normalize());
      ray.updateMatrixWorld(true);
    } else {
      center.project(camera);
      Object.assign(input.pointer, { seen: true, x: (center.x + 1) * 640, y: (1 - center.y) * 360 });
    }
  };
  return { ui, input, map, scene, camera, frame, until, pointAtMessage };
}

test('an acknowledged page is removed when the next original message becomes a banner, including the following transfer', t => {
  const { ui, map, frame, until } = environment(t);
  map.interpreter.setup([...message('A neutral introduction.'), ...message('\\{\\{VICTORY ACHIEVED'),
    command(201, [0, 2, 1, 1, 2, 2]), end()]);
  frame(); until(() => ui.msg?.state === 'waitInput'); frame(['Enter']);
  assert.equal(ui.msg, null); assert.ok(ui.heldMessage); assert.equal(ui.msgPanel.mesh.visible, true);
  frame();
  assert.equal(ui.banner?.blocking, true); assert.equal(ui.msg, null); assert.equal(ui.heldMessage, null);
  assert.equal(ui.msgPanel.mesh.visible, false); assert.equal(ui.namePanel.mesh.visible, false);
  until(() => map.transferring);
  map.mapId = 2; map.transferring = false; map.transfer = null; frame();
  assert.equal(ui.dialogueActive(), false); assert.equal(ui.messageBusy(), false);
  assert.equal(ui.msgPanel.mesh.visible, false); assert.equal(ui.hud.mesh.visible, true);
});

test('replacing the source execution releases its active choice without answering or terminating the new execution', t => {
  const { ui, map } = environment(t); let answers = 0;
  map.interpreter.setup([command(230, [20]), end()]);
  ui.showMessage({ lines: [], choices: [{ text: 'A neutral answer' }], onChoice: () => answers++ }, map.interpreter);
  ui.updateMessage(); assert.equal(ui.choice.visible, true);
  map.interpreter.setup([command(230, [40]), end()]);
  ui.updateDialoguePresentation();
  assert.equal(ui.msg, null); assert.equal(ui.choice.visible, false); assert.equal(ui.msgPanel.mesh.visible, false);
  assert.equal(ui.dialogueActive(), false); assert.equal(answers, 0); assert.equal(map.interpreter.running(), true);
});

test('a transfer invalidates its active local page while a valid waiting page never expires by elapsed time', t => {
  const { ui, map, frame, until } = environment(t);
  map.interpreter.setup([...message('A page awaiting acknowledgement.'), end()]); frame();
  until(() => ui.msg?.state === 'waitInput');
  const pending = ui.msg; G.time += 100000; ui.updateDialoguePresentation();
  assert.equal(ui.msg, pending); assert.equal(ui.messageBusy(), true); assert.equal(ui.msgPanel.mesh.visible, true);
  map.transferring = true; ui.updateDialoguePresentation();
  assert.equal(ui.msg, null); assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false);
});

test('a valid original death-scene message remains interactive while the death presentation flag is set', t => {
  const { ui, map, frame, until } = environment(t);
  G.combat.playerDead = true;
  map.interpreter.setup([...message('A neutral defeat-scene page.'), end()]); frame();
  until(() => ui.msg?.state === 'waitInput');
  assert.equal(ui.messageBusy(), true); assert.equal(ui.msgPanel.mesh.visible, true);
  frame(['Enter']); assert.equal(ui.msg, null);
  frame(); assert.equal(ui.msgPanel.mesh.visible, false);
});

test('clicking plain text first reveals it, then a fresh click acknowledges it through real input', t => {
  const { ui, input, map, frame, pointAtMessage } = environment(t);
  map.interpreter.setup([...message('A deliberately long neutral message that is still typing when the reader clicks it.'), end()]); frame();
  assert.equal(ui.msg.state, 'typing'); pointAtMessage(); input.mousePresses = 1; frame([], { logic: false });
  assert.ok(ui.msg); assert.equal(ui.msg.reveal, ui.msg.total); assert.equal(ui.msg.state, 'done-typing');
  frame([], { logic: false }); assert.equal(ui.msg.state, 'waitInput');
  input.mousePresses = 1; frame([], { logic: false }); assert.equal(ui.msg, null);
  frame(); assert.equal(ui.msgPanel.mesh.visible, false); assert.equal(ui.messageBusy(), false);
});

test('clicking outside a plain message cannot dismiss it and clicking its text cannot choose an answer', t => {
  const { ui, input, map, frame, until, pointAtMessage } = environment(t);
  map.interpreter.setup([...message('A neutral page.'), end()]); frame(); until(() => ui.msg?.state === 'waitInput');
  input.pointer = { x: 5, y: 5, seen: true }; input.mousePresses = 1; frame([], { logic: false });
  assert.equal(ui.msg.state, 'waitInput'); assert.equal(ui.pointerTarget, false);
  ui.closeMessage(); map.interpreter.clear(); ui.updateDialoguePresentation();
  let selected = null;
  ui.showMessage({ lines: ['A neutral question.'], choices: [{ text: 'Yes' }, { text: 'No' }], onChoice: i => { selected = i; } });
  ui.msg.state = 'done-typing'; frame([], { logic: false });
  pointAtMessage(); input.mousePresses = 1; frame([], { logic: false });
  assert.equal(ui.msg.state, 'choice'); assert.equal(selected, null);
  frame(['Enter'], { logic: false }); assert.equal(selected, 0); assert.equal(ui.msg, null);
});

test('a tracked VR trigger can acknowledge plain text with a visible pointer without becoming a world action', t => {
  const { ui, input, map, scene, frame, until, pointAtMessage } = environment(t);
  G.vr = true; const ray = new THREE.Group(), grip = new THREE.Group(); scene.add(ray, grip);
  input.controllers.right = { ray, grip };
  map.interpreter.setup([...message('A neutral headset page.'), end()]); frame(); until(() => ui.msg?.state === 'waitInput');
  pointAtMessage(); frame([], { logic: false });
  assert.equal(ui.pointerLine.visible, true); assert.equal(ui.pointerTarget, true);
  input.btn.right[0] = true; frame([], { logic: false });
  assert.equal(ui.msg, null); assert.equal(ui.consumedConfirm, true); assert.equal(input.interact(), false);
  frame(); assert.equal(ui.msgPanel.mesh.visible, false); assert.equal(ui.pointerLine.visible, false);
});
