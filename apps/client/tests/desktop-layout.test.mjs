import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');

function canvas() {
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, getContext: () => ctx };
}
function environment(t, width = 1280, height = 720) {
  const saved = { ...G }, data = { system: $data.system, states: $data.states };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas, addEventListener() {} } });
  const viewport = { width, height };
  const actor = { hp: 100, mhp: 100, mp: 20, mmp: 20, states: [], buffs: Array(8).fill(0) };
  $data.system = { currency_unit: 'souls' };
  $data.states = Array.from({ length: 10 }, (_, id) => ({ id, name: `Effect ${id}`, priority: 100 - id, icon_index: 0 }));
  G.vr = false; G.settings = { ...G.settings }; G.scripts = {}; G.coop = null; G.audio = null; G.arena = null; G.theater = null;
  G.state = { system: {}, party: { leader: () => actor, gold: 0, spirits: [] } }; G.combat = { stamina: 1 }; G.frame = 1; G.time = 0;
  G.map = { mapId: 1, grid: { w: 40, h: 30, valid: (x, y) => x >= 0 && x < 40 && y >= 0 && y < 30 },
    playerChar: { x: 2, y: 3, fx: 2, fy: 3, direction: 8 }, walkable: () => true, interpreter: { running: () => false } };
  G.view = { mapId: 1, analysis: { exits: [] } }; G.player = { forward2D: () => ({ x: 0, z: -1 }) };
  G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { buttons: 0, prevButtons: 0 }, pointerLocked: false,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    dom: { getBoundingClientRect: () => ({ ...viewport, left: 0, top: 0, right: viewport.width, bottom: viewport.height }) },
  });
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
  scene.add(rig); rig.add(camera); camera.position.y = 1.6;
  const ui = new UI(scene, camera, rig); G.ui = ui; ui.attachHud(null);
  const resize = (w, h) => { viewport.width = w; viewport.height = h; camera.aspect = w / h; camera.updateProjectionMatrix(); };
  return { ui, viewport, actor, resize };
}
function project(panel, camera, viewport, paintedHeight = panel.canvas.height) {
  camera.updateWorldMatrix(true, false); panel.mesh.updateWorldMatrix(true, false);
  const left = -panel.widthM / 2, right = panel.widthM / 2, top = panel.heightM / 2;
  const bottom = top - panel.heightM * paintedHeight / panel.canvas.height;
  const points = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([x, y]) => {
    const p = panel.mesh.localToWorld(new THREE.Vector3(x, y, 0)).project(camera);
    return { x: (p.x + 1) * viewport.width / 2, y: (1 - p.y) * viewport.height / 2 };
  });
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
function inViewport(box, viewport, marginX = 31, marginY = 39) {
  assert.ok(box.minX >= marginX && box.maxX <= viewport.width - marginX, JSON.stringify(box));
  assert.ok(box.minY >= marginY && box.maxY <= viewport.height - marginY, JSON.stringify(box));
}
function near(actual, expected, message = '') { assert.ok(Math.abs(actual - expected) < 0.1, `${message}: ${actual} != ${expected}`); }

test('PC main menu stays readable and centred at desktop resolutions instead of using a wrist-scale panel', t => {
  const { ui, viewport, resize } = environment(t);
  ui.openMenu();
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
    resize(w, h); ui.update(0.01);
    const box = project(ui.list.panel, ui.camera, viewport);
    inViewport(box, viewport); near(box.width, 882);
    assert.ok(36 * box.width / ui.list.panel.canvas.width > 30, 'menu row text should exceed 30 CSS pixels');
    near((box.minX + box.maxX) / 2, w / 2); near((box.minY + box.maxY) / 2, h / 2);
    assert.equal(ui.hud.mesh.visible, false, 'desktop menus take the screen without an overlapping HUD');
  }
});

test('desktop panels follow full camera pitch, yaw, roll, FOV and zoom without changing their CSS size', t => {
  const { ui, viewport } = environment(t);
  ui.openMenu(); ui.update(0.01);
  const original = project(ui.list.panel, ui.camera, viewport);
  ui.rig.position.set(14, 2, -7); ui.rig.rotation.y = 0.7; ui.camera.rotation.set(-0.85, 0.4, 0.25, 'YXZ');
  for (const [fov, zoom] of [[45, 1], [110, 1], [80, 1.7]]) {
    ui.camera.fov = fov; ui.camera.zoom = zoom; ui.camera.updateProjectionMatrix(); ui.update(0.01);
    const box = project(ui.list.panel, ui.camera, viewport); inViewport(box, viewport);
    near(box.width, original.width); near(box.height, original.height);
    assert.ok(ui.root.quaternion.angleTo(ui.camera.getWorldQuaternion(new THREE.Quaternion())) < 1e-7);
  }
});

test('inventory, title menu and full map fit narrow windows immediately after resize', t => {
  const { ui, viewport, resize } = environment(t);
  for (const [w, h] of [[800, 600], [480, 800], [900, 500]]) {
    resize(w, h); ui.openMenu(); ui.update(0.01); inViewport(project(ui.list.panel, ui.camera, viewport), viewport);
    ui.list.close(); ui.grid.open('Inventory', [{ label: 'Items', items: [{ text: 'Potion' }] }]);
    ui.update(0.01); inViewport(project(ui.grid.panel, ui.camera, viewport), viewport);
    ui.showMap(); ui.update(0.01);
    assert.equal(ui.navigation.full.mesh.visible, true, 'hiding the PC HUD must not hide its full map');
    inViewport(project(ui.navigation.full, ui.camera, viewport), viewport);
    ui.closeMenu(); ui.list.open('Title', [{ text: 'Continue' }, { text: 'New game' }]); ui.placeRoot();
    inViewport(project(ui.list.panel, ui.camera, viewport), viewport);
    ui.list.close();
  }
});

test('dialogue and choices fit together while preserving their original relative layout', t => {
  const { ui, viewport, resize } = environment(t);
  for (const [w, h] of [[1280, 720], [800, 600], [480, 800]]) {
    resize(w, h);
    ui.showMessage({ lines: ['Where should we go?'], position: 2,
      choices: [{ text: 'North' }, { text: 'South' }, { text: 'Stay' }] });
    ui.msg.state = 'done-typing'; ui.update(0.01);
    assert.equal(ui.choice.visible, true);
    const message = project(ui.msgPanel, ui.camera, viewport), choices = project(ui.choice.panel, ui.camera, viewport);
    inViewport(message, viewport); inViewport(choices, viewport);
    assert.ok(choices.maxY < message.minY, 'choices remain above the dialogue instead of covering it');
    assert.equal(ui.hud.mesh.visible, false);
    ui.closeMessage();
  }
});

test('PC HUD anchors its painted bottom and minimap uses readable CSS dimensions after effects and resize', t => {
  const { ui, viewport, actor, resize } = environment(t);
  for (const [w, h] of [[1280, 720], [1920, 1080], [800, 600]]) {
    resize(w, h);
    for (const effects of [[], [2, 3, 4, 5, 6, 7, 8, 9]]) {
      actor.states = effects; ui.update(0.1);
      const hud = project(ui.hud, ui.camera, viewport, ui.hudPaintHeight);
      near(hud.width, 320); near(hud.minX, 20); near(hud.maxY, h - 20);
      assert.ok(hud.minY >= 20, 'effect rows must not move the painted HUD outside the screen');
      const mini = project(ui.navigation.mini, ui.camera, viewport);
      near(mini.width, 220); near(mini.maxX, w - 24); near(mini.minY, 24);
      assert.equal(ui.hud.mesh.visible, true); assert.equal(ui.navigation.mini.mesh.visible, true);
    }
  }
});

test('switching PC to VR restores unit-scale wrist panels and VR menus, then restores desktop anchors', t => {
  const { ui, viewport } = environment(t);
  ui.openMenu(); ui.update(0.1); assert.notEqual(ui.root.scale.x, 1); assert.equal(ui.hud.mesh.visible, false);
  G.vr = true;
  const grip = new THREE.Group(); grip.position.set(0.1, 1.1, -0.4); ui.scene.add(grip);
  ui.attachHud(grip); ui.update(0.1);
  assert.deepEqual(ui.root.scale.toArray(), [1, 1, 1]); assert.deepEqual(ui.hud.mesh.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(ui.navigation.mini.mesh.scale.toArray(), [1, 1, 1]); assert.equal(ui.navigation.mini.mesh.parent, ui.hud.mesh);
  assert.equal(ui.hud.mesh.visible, true, 'VR retains its wrist HUD while a menu is open');
  near(ui.hud.mesh.position.y, 1.21);
  near(ui.navigation.mini.mesh.position.y, ui.hud.heightM / 2 + ui.navigation.mini.heightM / 2 + 0.02);
  G.vr = false; ui.attachHud(null); ui.closeMenu(); ui.update(0.1);
  assert.equal(ui.hud.mesh.parent, ui.camera); assert.equal(ui.navigation.mini.mesh.parent, ui.camera);
  near(project(ui.hud, ui.camera, viewport, ui.hudPaintHeight).width, 320);
  near(project(ui.navigation.mini, ui.camera, viewport).width, 220);
});

test('PC title menu clicks keep the cursor free and activate the pointed row through real input', t => {
  const { ui, viewport } = environment(t), handlers = new Map(); let locks = 0, selected = '';
  const dom = { getBoundingClientRect: G.input.dom.getBoundingClientRect,
    addEventListener: (type, fn) => handlers.set(type, fn), requestPointerLock: () => { locks++; } };
  G.input = new Input({}, dom);
  G.state = null; G.map = null;
  ui.list.open('BLACK SOULS II', [{ text: 'Continue', id: 'continue' }, { text: 'New game', id: 'new' }], {
    onSelect: (_i, item) => { selected = item.id; },
  });
  ui.list.panel.mesh.position.set(0, -0.15, 0); ui.placeRoot();
  assert.equal(ui.sceneBusy(), false); assert.equal(ui.messageBusy(), false);
  const panel = ui.list.panel;
  const p = panel.mesh.localToWorld(new THREE.Vector3((180 / panel.canvas.width - 0.5) * panel.widthM,
    (0.5 - 190 / panel.canvas.height) * panel.heightM, 0)).project(ui.camera);
  handlers.get('mousedown')({ button: 0, clientX: (p.x + 1) * viewport.width / 2, clientY: (1 - p.y) * viewport.height / 2 });
  assert.equal(locks, 0, 'title screens must not request mouse look when clicking a visible menu');
  ui.list.update(ui.pointerRay()); assert.equal(selected, 'new');
  ui.list.close(); G.input.mouse.buttons = 0;
  handlers.get('mousedown')({ button: 0, clientX: 100, clientY: 100 });
  assert.equal(locks, 1, 'clicking unobstructed gameplay must still enable mouse look');
});

test('standalone PC banners and toasts fit without requiring a player or game state', t => {
  const { ui, viewport, resize } = environment(t);
  G.state = null; G.map = null;
  for (const [w, h] of [[1280, 720], [480, 800]]) {
    resize(w, h);
    ui.showBanner('VICTORY ACHIEVED'); ui.update(0.01);
    inViewport(project(ui.bannerPanel, ui.camera, viewport), viewport);
    assert.equal(ui.hud.mesh.visible, false);
    ui.banner = null; ui.drawBanner();
    ui.toast('Controller disconnected'); ui.update(0.01);
    inViewport(project(ui.toastPanel, ui.camera, viewport), viewport);
    ui.toasts = []; ui.drawToasts();
  }
});
