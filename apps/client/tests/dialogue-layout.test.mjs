import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');
function environment(t, width = 1280, height = 720) {
  const saved = { ...G }, data = $data.system, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); $data.system = data;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const record = { texts: [] }, ctx = new Proxy({ measureText: s => ({ width: String(s).length * 18 }),
      clearRect() { record.texts = []; }, fillText(text, x, y) { record.texts.push({ text, x, y }); },
      createLinearGradient: () => ({ addColorStop() {} }),
    }, { get: (o, k) => k in o ? o[k] : () => {} });
    return { width: 0, height: 0, record, getContext: () => ctx };
  } } });
  $data.system = { currency_unit: 'Souls' };
  Object.assign(G, { vr: false, scripts: { fontSize: 19, screen: [640, 480] }, state: null,
    map: null, combat: null, coop: null, theater: null, arena: null, time: 0, frame: 1 });
  const input = G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0, wheel: 0 }, mousePresses: 0, pointerLocked: false,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    dom: { getBoundingClientRect: () => ({ width, height }) },
  });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
  scene.add(camera); camera.position.y = 1.6;
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  return { ui, input, camera, width, height };
}
function box(panel, { camera, width, height }) {
  camera.updateWorldMatrix(true, false); panel.mesh.updateWorldMatrix(true, false);
  const points = [-1, 1].flatMap(x => [-1, 1].map(y => panel.mesh.localToWorld(new THREE.Vector3(x * panel.widthM / 2,
    y * panel.heightM / 2, 0)).project(camera)));
  return { left: Math.min(...points.map(p => (p.x + 1) * width / 2)), right: Math.max(...points.map(p => (p.x + 1) * width / 2)),
    top: Math.min(...points.map(p => (1 - p.y) * height / 2)), bottom: Math.max(...points.map(p => (1 - p.y) * height / 2)) };
}
test('short shop choices fit their actual content and stay to the side above bottom-anchored dialogue', t => {
  const env = environment(t), { ui } = env;
  ui.nextName = 'Reception';
  ui.showMessage({ lines: ['What a fine morning we have today.'], choices: [
    { text: 'Buy Medicine' }, { text: 'Kill' }, { text: 'Leave' },
  ], position: 2 });
  ui.msg.state = 'done-typing'; ui.update(0.01);
  const message = box(ui.msgPanel, env), choices = box(ui.choice.panel, env);
  assert.equal(ui.choice.rows, 3); assert.ok(ui.choice.panel.canvas.height < 300, 'three options do not reserve six empty rows');
  assert.ok(ui.choice.panel.canvas.width < 760, 'short options do not reserve a full-width menu');
  assert.ok(choices.left > env.width / 2, 'short shop choices leave the central NPC view clear');
  assert.ok(choices.bottom < message.top);
  assert.ok(message.bottom >= env.height - 46 && message.bottom <= env.height - 39, JSON.stringify(message));
  assert.ok(ui.namePanel.canvas.width < 512, 'speaker names do not reserve a large empty strip');
  assert.equal(ui.choice.index, 0); assert.equal(ui.backdrop.material.opacity, 0.08);
});
test('compact choices keep first, last and disabled mouse targets aligned with their painted rows', t => {
  const { ui, input } = environment(t), selected = [];
  ui.choice.open('', [{ text: 'First' }, { text: 'Disabled', enabled: false }, { text: 'Last' }], { onSelect: index => selected.push(index) });
  const point = row => { ui.choice.panel.hit = () => new THREE.Vector2(0.5,
    1 - (ui.choice.rowTop + ui.choice.rowH * (row + 0.5)) / ui.choice.panel.canvas.height);
    input.mousePresses = 1; ui.choice.update({}); input.endFrame(); ui.pointerTarget = false; };
  point(0); point(1); point(2); assert.deepEqual(selected, [0, 2]);
  assert.ok(ui.choice.panel.canvas.record.texts.some(r => r.text === '03'));
});
test('long choices remain scrollable and PC/VR changes restore the correct canvas without losing selection', t => {
  const { ui } = environment(t);
  const rows = Array.from({ length: 12 }, (_, i) => ({ text: 'A longer option ' + i }));
  ui.choice.open('', rows, { index: 8 }); ui.choice.draw();
  assert.equal(ui.choice.index, 8); assert.equal(ui.choice.rows, 6); assert.ok(ui.choice.scrollbar.geometry);
  G.vr = true; ui.attachHud(new THREE.Group());
  assert.equal(ui.choice.panel.canvas.width, 760); assert.equal(ui.choice.rowTop, 100); assert.equal(ui.choice.index, 8);
  G.vr = false; ui.attachHud(null); assert.equal(ui.choice.rowTop, 24); assert.equal(ui.choice.index, 8);
});
test('dialogue background conventions survive polish and notices cannot move an open conversation', t => {
  const env = environment(t), { ui } = env;
  ui.showMessage({ lines: ['A quiet room.'], background: 2, position: 2 }); ui.update(0.01);
  const before = box(ui.msgPanel, env);
  ui.toast('Not enough MP'); ui.update(0.01);
  assert.deepEqual(box(ui.msgPanel, env), before, 'a peripheral notice must not rescale or recenter dialogue');
  assert.equal(ui.toastPanel.mesh.parent, ui.camera);
  assert.equal(ui.msg.background, 2, 'transparent scripted dialogue remains transparent');
});
