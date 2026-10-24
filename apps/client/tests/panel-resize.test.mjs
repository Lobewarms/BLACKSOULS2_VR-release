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
  const record = { texts: [], dimensionWrites: 0 };
  const ctx = new Proxy({
    clearRect() { record.texts = []; }, fillText(text) { record.texts.push(text); },
    measureText: text => ({ width: String(text).length * 15 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  let width = 0, height = 0;
  return { record, getContext: () => ctx,
    get width() { return width; }, set width(value) { width = value; record.dimensionWrites++; record.texts = []; },
    get height() { return height; }, set height(value) { height = value; record.dimensionWrites++; record.texts = []; } };
}
function environment(t) {
  const saved = { ...G }, data = { system: $data.system, classes: $data.classes, states: $data.states };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  $data.system = { currency_unit: 'Souls', terms: { params: ['MHP', 'MMP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'], etypes: [] } };
  $data.classes = []; $data.states = [];
  const actor = { name: 'Grimm', level: 12, classId: 1, hp: 100, mhp: 100, mp: 20, mmp: 20,
    states: [], buffs: [], equips: [], partners: [], param: () => 10 };
  Object.assign(G, { vr: false, scripts: {}, settings: { ...G.settings }, combat: null, coop: null, theater: null,
    arena: null, time: 0, frame: 1, map: { interpreter: { running: () => false } },
    state: { system: {}, party: { leader: () => actor, spirits: [], gold: 0 } } });
  G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0, wheel: 0 }, mousePresses: 0,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {} });
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const scene = new THREE.Scene(); scene.add(camera);
  const ui = new UI(scene, camera, new THREE.Group()); G.ui = ui;
  return ui;
}
function settings(texture) {
  return Object.fromEntries(['name', 'mapping', 'channel', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'format',
    'internalFormat', 'type', 'rotation', 'matrixAutoUpdate', 'generateMipmaps', 'premultiplyAlpha', 'flipY', 'unpackAlignment', 'colorSpace',
    'onUpdate', 'userData'].map(key => [key, texture[key]]).concat([
    ['offset', texture.offset.toArray()], ['repeat', texture.repeat.toArray()], ['center', texture.center.toArray()], ['matrix', texture.matrix.toArray()],
  ]));
}

test('canvas dimension changes replace and dispose GPU textures while preserving sampler settings and live panel objects', t => {
  const ui = environment(t), p = ui.list.panel, previous = p.tex, source = previous.source;
  Object.assign(previous, { name: 'original-panel', channel: 1, wrapS: THREE.RepeatWrapping, wrapT: THREE.MirroredRepeatWrapping,
    magFilter: THREE.NearestFilter, minFilter: THREE.LinearFilter, anisotropy: 4, premultiplyAlpha: true, flipY: false,
    unpackAlignment: 1, generateMipmaps: false, matrixAutoUpdate: false, rotation: 0.3, userData: { purpose: 'menu' }, onUpdate() {} });
  previous.offset.set(0.1, 0.2); previous.repeat.set(0.7, 0.8); previous.center.set(0.3, 0.4); previous.updateMatrix();
  const expected = settings(previous), mesh = p.mesh, material = mesh.material, geometry = mesh.geometry, canvas = p.canvas, ctx = p.ctx, parent = mesh.parent;
  mesh.visible = true; mesh.position.set(-0.4, 0.1, 0.02); mesh.rotation.y = 0.2;
  let disposed = 0, geometryDisposed = 0;
  previous.addEventListener('dispose', () => disposed++); geometry.addEventListener('dispose', () => geometryDisposed++);
  p.resize(320, 960, 0.32);
  assert.notEqual(p.tex, previous); assert.notEqual(p.tex.source, source, 'Texture.copy must not retain the old Source and its immutable GPU allocation');
  assert.equal(p.tex.isCanvasTexture, true); assert.equal(p.tex.image, canvas); assert.ok(p.tex.version > 0 && p.tex.source.version > 0);
  assert.deepEqual(settings(p.tex), expected); assert.equal(disposed, 1); assert.equal(geometryDisposed, 1);
  assert.equal(p.mesh, mesh); assert.equal(mesh.material, material); assert.equal(material.map, p.tex);
  assert.equal(mesh.parent, parent); assert.equal(p.canvas, canvas); assert.equal(p.ctx, ctx);
  assert.equal(mesh.visible, true); assert.deepEqual(mesh.position.toArray(), [-0.4, 0.1, 0.02]); assert.equal(mesh.rotation.y, 0.2);
  assert.equal(p.widthM, 0.32); assert.equal(p.heightM, 0.96);
});

test('unchanged sizes and geometry-only width changes retain texture storage, canvas pixels and input targets', t => {
  const ui = environment(t), p = ui.list.panel, tex = p.tex, source = tex.source, geometry = p.mesh.geometry;
  p.mesh.visible = true; p.ctx.fillText('Live menu pixels', 20, 30);
  const writes = p.canvas.record.dimensionWrites, version = tex.version, input = G.input;
  const width = p.canvas.width, height = p.canvas.height;
  let disposed = 0; tex.addEventListener('dispose', () => disposed++);
  p.resize(width, height, 0.98);
  assert.equal(p.mesh.geometry, geometry); assert.equal(p.tex, tex); assert.equal(tex.version, version);
  p.resize(width, height, 0.7);
  assert.notEqual(p.mesh.geometry, geometry); assert.equal(p.tex, tex); assert.equal(p.tex.source, source); assert.equal(tex.version, version);
  assert.equal(p.canvas.record.dimensionWrites, writes, 'changing world width must not reset the canvas bitmap');
  assert.deepEqual(p.canvas.record.texts, ['Live menu pixels']); assert.equal(disposed, 0); assert.equal(G.input, input);
  p.mesh.updateWorldMatrix(true, false);
  const target = p.mesh.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 0, 1)), new THREE.Vector3(0, 0, -1));
  const hit = p.hit(ray); assert.ok(hit && Math.abs(hit.x - 0.5) < 1e-6 && Math.abs(hit.y - 0.5) < 1e-6);
});

test('real Main → Status → Back → Equip → Back transitions refresh storage for every pixel size and preserve menu controls', t => {
  const ui = environment(t), textures = new Set(), sources = new Set();
  const verify = (classic, width, height) => {
    const p = ui.list.panel;
    assert.equal(ui.list.classic, classic); assert.equal(p.canvas.width, width); assert.equal(p.canvas.height, height);
    assert.equal(p.mesh.material.map, p.tex);
    assert.ok(!textures.has(p.tex)); assert.ok(!sources.has(p.tex.source)); textures.add(p.tex); sources.add(p.tex.source);
  };
  ui.openMenu(); ui.update(0.01); verify(true, 320, 960);
  assert.equal(ui.menuOverview.mesh.visible, true);
  let old = ui.list.panel.tex, disposed = 0; old.addEventListener('dispose', () => disposed++);
  ui.onMenu('status'); ui.update(0.01); verify(false, 980, 714);
  assert.equal(disposed, 1); assert.equal(ui.menuOverview.mesh.visible, false); assert.ok(ui.list.items.some(item => item.text === 'ATK'));
  G.input.keys.add('Escape'); ui.update(0.01); verify(true, 320, 960);
  assert.equal(ui.menuOverview.mesh.visible, true); assert.equal(ui.list.items[ui.list.index].id, 'status');
  G.input.keys.clear(); G.input.endFrame();
  ui.onMenu('equip'); ui.update(0.01); verify(false, 980, 714);
  assert.equal(ui.menuOverview.mesh.visible, false);
  ui.list.onCancel(); ui.update(0.01); verify(true, 320, 960);
  assert.equal(ui.list.items[ui.list.index].id, 'equip');
});

test('adaptive dialogue choice widths and speaker-name changes also replace texture sources', t => {
  const ui = environment(t), choice = ui.choice;
  choice.open('', [{ text: 'Yes' }, { text: 'No' }]);
  let texture = choice.panel.tex, source = texture.source, disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  choice.open('', [{ text: 'A long translated answer that requires a wider choice window than Yes or No' }, { text: 'Leave' }]);
  assert.notEqual(choice.panel.tex, texture); assert.notEqual(choice.panel.tex.source, source); assert.equal(disposed, 1);
  assert.equal(choice.panel.mesh.material.map, choice.panel.tex);
  ui.nextName = 'Alice'; ui.showMessage({ lines: ['Hello'], position: 2 });
  texture = ui.namePanel.tex; source = texture.source; disposed = 0; texture.addEventListener('dispose', () => disposed++);
  ui.nextName = 'A much longer speaker name'; ui.showMessage({ lines: ['Hello again'], position: 2 });
  assert.notEqual(ui.namePanel.tex, texture); assert.notEqual(ui.namePanel.tex.source, source); assert.equal(disposed, 1);
});
