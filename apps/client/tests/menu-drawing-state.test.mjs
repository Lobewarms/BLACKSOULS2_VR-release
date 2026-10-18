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
  const record = { texts: [], dimensionWrites: 0 }, stack = [];
  const defaults = { textAlign: 'start', textBaseline: 'alphabetic', font: '10px sans-serif', globalAlpha: 1,
    lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', lineJoin: 'miter', imageSmoothingEnabled: true };
  const measure = text => Array.from(String(text)).length * (Number(ctx.font.match(/([\d.]+)px/)?.[1]) || 10) * 0.52;
  const ctx = new Proxy({ ...defaults,
    clearRect() { record.texts = []; }, measureText: text => ({ width: measure(text) }),
    fillText(text, x, y) {
      const width = measure(text), align = ctx.textAlign;
      const left = x - (align === 'right' || align === 'end' ? width : align === 'center' ? width / 2 : 0);
      record.texts.push({ text, x, y, left, right: left + width, align, alpha: ctx.globalAlpha });
    },
    save() { stack.push(Object.fromEntries(Object.keys(defaults).map(key => [key, ctx[key]]))); },
    restore() { if (stack.length) Object.assign(ctx, stack.pop()); },
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  let width = 0, height = 0;
  const reset = () => { Object.assign(ctx, defaults); stack.length = 0; record.texts = []; record.dimensionWrites++; };
  return { record, getContext: () => ctx,
    get width() { return width; }, set width(value) { width = value; reset(); },
    get height() { return height; }, set height(value) { height = value; reset(); } };
}
function environment(t) {
  const saved = { ...G }, data = { system: $data.system, classes: $data.classes, states: $data.states };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  $data.system = { currency_unit: 'Souls', terms: { params: ['MHP', 'MMP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'], etypes: [] } };
  $data.classes = []; $data.states = [];
  const actor = { name: 'Grimm', level: 24, classId: 1, hp: 1566, mhp: 1742, mp: 125, mmp: 125,
    states: [], buffs: [], equips: [], partners: [], param: () => 10 };
  Object.assign(G, { vr: false, scripts: { menuVar: { variable: 1, label: 'SEN' } }, settings: { ...G.settings },
    combat: null, coop: null, theater: null, arena: null, time: 0, frame: 1,
    map: { interpreter: { running: () => false } },
    state: { system: {}, sw: () => false, v: () => 97, party: { leader: () => actor, spirits: [], gold: 5860 } } });
  const input = G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0, wheel: 0 }, mousePresses: 0, pointerLocked: false,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    dom: { getBoundingClientRect: () => ({ width: 1676, height: 962 }) } });
  const camera = new THREE.PerspectiveCamera(75, 1676 / 962, 0.1, 100), scene = new THREE.Scene(); scene.add(camera);
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  return { ui, input };
}
function commandsVisible(ui) {
  const p = ui.list.panel, rows = p.canvas.record.texts;
  for (const [index, item] of ui.list.items.entries()) {
    const painted = rows.find(row => row.text === item.text && row.y > index * 64 && row.y < (index + 1) * 64 + 24);
    assert.ok(painted, `the full ${item.text} label must be painted`);
    assert.ok(painted.left >= 20 && painted.right <= p.canvas.width - 20,
      `${item.text} must fit inside the command frame: ${JSON.stringify(painted)}`);
  }
}

test('main-menu commands remain complete after economy painting and repeated selection redraws without resizing the GPU texture', t => {
  const { ui, input } = environment(t);
  ui.openMenu(); ui.update(0.01); commandsVisible(ui);
  const panel = ui.list.panel, texture = panel.tex, dimensions = panel.canvas.record.dimensionWrites;
  for (let i = 0; i < 6; i++) {
    input.keys.add('ArrowDown'); ui.update(0.01); input.endFrame(); commandsVisible(ui);
    input.keys.clear(); ui.update(0.01); input.endFrame();
    assert.equal(panel.tex, texture); assert.equal(panel.canvas.record.dimensionWrites, dimensions);
    assert.ok(panel.canvas.record.texts.some(row => row.text === '5,860' && row.align === 'right'));
  }
});

test('mouse hover and Main → Status → Back redraws keep text inside the original left command panel', t => {
  const { ui, input } = environment(t);
  ui.openMenu(); ui.update(0.01);
  let target = 0;
  ui.list.panel.hit = () => new THREE.Vector2(0.5, 1 - (ui.list.rowTop + target * ui.list.rowH + 32) / ui.list.panel.canvas.height);
  ui.list.update({}); target = 3; ui.list.update({}); commandsVisible(ui);
  input.mousePresses = 1; ui.list.update({}); input.endFrame();
  assert.equal(ui.list.classic, false); assert.equal(ui.list.panel.canvas.width, 980);
  ui.list.onCancel(); ui.update(0.01); commandsVisible(ui);
  ui.list.index = 1; ui.list.draw(); ui.paintMainOverview(); commandsVisible(ui);
  assert.equal(ui.list.panel.canvas.width, 320);
});

test('list drawing establishes left alignment even when a previous canvas consumer left another alignment', t => {
  const { ui } = environment(t); ui.openMenu();
  for (const align of ['right', 'center', 'end']) {
    ui.list.panel.ctx.textAlign = align; ui.list.draw(); commandsVisible(ui);
  }
});

test('classic economy rendering preserves the shared command canvas drawing state', t => {
  const { ui } = environment(t); ui.openMenu();
  const ctx = ui.list.panel.ctx;
  Object.assign(ctx, { textAlign: 'left', textBaseline: 'top', font: '37px GameFont', fillStyle: '#123456',
    strokeStyle: '#234567', lineWidth: 7, lineJoin: 'bevel', globalAlpha: 0.8 });
  const keys = ['textAlign', 'textBaseline', 'font', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'globalAlpha'];
  const before = Object.fromEntries(keys.map(key => [key, ctx[key]]));
  ui.lastMainOverview = ''; ui.paintMainOverview();
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, ctx[key]])), before);
});
