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
function environment(t) {
  const previous = { ...G }, system = $data.system;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, previous); $data.system = system;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  const document = {
    body: { appendChild(el) { el.parentNode = this; } },
    createElement(type) {
      if (type === 'canvas') return canvas();
      return { style: {}, focus() { document.activeElement = this; }, blur() { document.activeElement = null; } };
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  G.vr = false; G.settings = { ...G.settings }; G.state = null; G.map = null; G.combat = null; G.coop = null; G.scripts = {};
  G.theater = null; G.audio = null; G.arena = null; G.frame = 1;
  $data.system = { currency_unit: 'souls' };
  G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { buttons: 0, prevButtons: 0 }, pointerLocked: false,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
  });
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const ui = new UI(new THREE.Scene(), camera, new THREE.Group()); G.ui = ui;
  return { ui, input: G.input, document };
}
// Pointer hits use canvas coordinates, leaving the actual menu/input update logic intact.
function hit(panel, x, y) {
  panel.hit = () => new THREE.Vector2(x / panel.canvas.width, 1 - y / panel.canvas.height);
}
function click(input) { input.mouse.buttons = 1; input.mouse.prevButtons = 0; G.ui.pointerTarget = false; }
function release(input) { input.mouse.buttons = 0; input.mouse.prevButtons = 0; G.ui.pointerTarget = false; }

function captureEnvironment(t) {
  const env = environment(t), listeners = new Map(), requests = [];
  let focusCalls = 0, unlocks = 0;
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  for (const [key, value] of Object.entries({ addEventListener: listen, HTMLInputElement: class {} })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const dom = { style: {}, tabIndex: -1, addEventListener: listen,
    focus() { focusCalls++; env.document.activeElement = dom; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    requestPointerLock(options) { requests.push(options); return Promise.reject(Object.assign(new Error('Escape cooldown'), { name: 'SecurityError' })); },
  };
  env.document.addEventListener = listen; env.document.hasFocus = () => true; env.document.pointerLockElement = null;
  const input = G.input = new Input({}, dom);
  const emit = (type, values = {}) => { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, ...values }); };
  const lock = () => { env.document.pointerLockElement = dom; emit('pointerlockchange'); };
  env.document.exitPointerLock = () => { unlocks++; env.document.pointerLockElement = null; emit('pointerlockchange'); };
  return { ...env, input, dom, lock, emit, requests, get focusCalls() { return focusCalls; }, get unlocks() { return unlocks; } };
}

test('an explicit mouse click selects an initially unselected dialogue row without a hover jump', t => {
  const { ui, input } = environment(t), selected = [];
  ui.choice.open('Choose', [{ text: 'First' }, { text: 'Second' }], { index: -1, onSelect: i => selected.push(i) });
  hit(ui.choice.panel, 100, 100 + ui.choice.rowH * 1.5);
  ui.choice.update({}); assert.equal(ui.choice.index, -1, 'opening under the pointer must retain deliberate non-selection');
  click(input); ui.choice.update({});
  assert.equal(ui.choice.index, 1); assert.deepEqual(selected, [1]);
});

test('a complete down/up click between UI frames activates the hovered row exactly once', t => {
  const { ui, document } = environment(t), listeners = new Map(), selected = [];
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: listen });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'addEventListener', previous); else delete globalThis.addEventListener; });
  document.addEventListener = listen;
  const input = G.input = new Input({}, { addEventListener: listen });
  const emit = (type, values) => { for (const fn of listeners.get(type) || []) fn(values); };
  ui.menuOpen = true;
  ui.list.open('Menu', [{ text: 'Resume' }, { text: 'Map' }], { onSelect: index => selected.push(index) });
  hit(ui.list.panel, 100, 100 + ui.list.rowH * 1.5);
  emit('mousedown', { button: 0, clientX: 100, clientY: 196 }); emit('mouseup', { button: 0 });
  assert.equal(input.mouseHeld(0), false, 'the click has already completed before the game reads input');
  ui.list.update({}); assert.deepEqual(selected, [1], 'the hovered Map row must open on the next frame');
  input.endFrame(); ui.pointerTarget = false; ui.list.update({});
  assert.deepEqual(selected, [1], 'the completed click must not activate the row again');
});

test('mouse clicks respect disabled menu rows and the visible Back button', t => {
  const { ui, input } = environment(t); let selected = 0, cancelled = 0;
  ui.menuOpen = true;
  ui.list.open('Menu', [{ text: 'Unavailable', enabled: false }, { text: 'Available' }], {
    onSelect: () => selected++, onCancel: () => cancelled++,
  });
  hit(ui.list.panel, 100, 132); click(input); ui.list.update({}); assert.equal(selected, 0);
  hit(ui.list.panel, ui.list.panel.canvas.width - 100, 50); click(input); ui.list.update({});
  assert.equal(cancelled, 1); assert.equal(selected, 0, 'Back must not activate the highlighted item');
});

test('same-frame tab navigation and a mouse click select the current inventory instead of stale items', t => {
  const { ui, input } = environment(t), selected = [];
  const oldItem = { text: 'Old potion' }, newItems = [{ text: 'New first' }, { text: 'New second' }];
  ui.grid.open('Inventory', [{ label: 'Old', items: [oldItem] }, { label: 'New', items: newItems }], {
    tab: 0, onSelect: item => selected.push(item),
  });
  ui.grid.focusTabs = true;
  const cw = (ui.grid.panel.canvas.width - 60) / ui.grid.cols;
  hit(ui.grid.panel, 30 + cw * 1.5, ui.grid.gridTop + ui.grid.cellH / 2);
  input.keys.add('ArrowRight'); click(input); ui.grid.update({});
  assert.equal(ui.grid.tab, 1); assert.equal(ui.grid.index, 1); assert.deepEqual(selected, [newItems[1]]);
});

test('clicking inventory tabs changes categories without using an item', t => {
  const { ui, input } = environment(t), selected = [];
  const next = { text: 'Next category item' };
  ui.grid.open('Inventory', [{ label: 'Old', items: [{ text: 'Old item' }] }, { label: 'Next', items: [next] }], {
    tab: 0, onSelect: item => selected.push(item),
  });
  hit(ui.grid.panel, 30 + (ui.grid.panel.canvas.width - 60) * 0.75, 107);
  click(input); ui.grid.update({}); assert.equal(ui.grid.tab, 1); assert.deepEqual(selected, []);
  hit(ui.grid.panel, 100, ui.grid.gridTop + ui.grid.cellH / 2);
  click(input); ui.grid.update({}); assert.deepEqual(selected, [next]);
});

test('PC on-screen name keys, Backspace, Done and Cancel respond to their clicked positions', t => {
  const { ui, input } = environment(t), finished = []; let cancelled = 0;
  ui.keyboard.open('Name', 'Hero', 20, { onDone: name => finished.push(name), onCancel: () => cancelled++ });
  const press = key => {
    const rect = ui.keyboard.rects.find(r => r.key === key);
    hit(ui.keyboard.panel, rect.x + rect.w / 2, rect.y + rect.h / 2);
    click(input); ui.keyboard.update({});
  };
  press('q'); assert.equal(ui.keyboard.text, 'Heroq');
  press('back'); assert.equal(ui.keyboard.text, 'Hero');
  press('done'); assert.deepEqual(finished, ['Hero']);
  press('cancel'); assert.equal(cancelled, 1);
  hit(ui.keyboard.panel, 10, 20); click(input); ui.keyboard.update({});
  assert.equal(ui.pointerTarget, false, 'clicking blank keyboard space must not press the current key');
});

test('scripted scenes and dialogue release PC pointer lock through the real UI frame', t => {
  const env = captureEnvironment(t), { ui, input } = env;
  env.lock(); ui.sceneOpen = 'bonfire'; ui.update(0.01);
  assert.equal(env.unlocks, 1); assert.equal(input.pointerLocked, false);
  ui.sceneOpen = null;
  env.document.pointerLockElement = env.dom; input.pointerLocked = true;
  ui.showMessage({ lines: ['A dialogue choice'], choices: [{ text: 'Yes' }] }); ui.update(0.01);
  assert.equal(env.unlocks, 2, 'event dialogues must make the cursor available without pressing Escape');
  ui.msg = null; G.vr = true; ui.sceneOpen = 'shop'; input.pointerLocked = true; ui.update(0.01);
  assert.equal(env.unlocks, 2, 'headset menus must not alter desktop pointer lock');
});

for (const code of ['Escape', 'KeyX']) test(`NPC dialogue closed with ${code} restores gameplay look through the real UI frame`, async t => {
  const env = captureEnvironment(t), { ui, input, dom, emit, requests } = env;
  env.lock(); ui.showMessage({ lines: ['Hello, traveler.'] }); ui.msg.state = 'waitInput';
  ui.update(0.01);
  assert.equal(input.pointerLocked, false); assert.equal(requests.length, 0);
  assert.equal(input.pointerUiPaused, true); assert.equal(dom.style.cursor, '');
  input.endFrame(); emit('keydown', { code }); ui.update(0.01);
  assert.equal(ui.msg, null); assert.equal(env.focusCalls, 1); assert.equal(requests.length, 1);
  await Promise.resolve();
  assert.equal(input.softLook, true, 'a browser refusal after Escape must not require an extra click for mouse look');
  emit('mousemove', { target: dom, clientX: 640, clientY: 360, movementX: 5, movementY: 2 });
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [5, 2]);
  input.endFrame(); emit('keyup', { code });
  for (let i = 0; i < 5; i++) ui.update(0.01);
  assert.equal(requests.length, 1, 'subsequent gameplay frames must not keep requesting browser capture');
});

for (const [code, selected] of [['Enter', 0], ['Escape', -1], ['KeyX', -1]]) test(`NPC choice ${code} restores gameplay control after its callback`, async t => {
  const env = captureEnvironment(t), { ui, input, emit, requests } = env, choices = [];
  env.lock(); ui.showMessage({ lines: [], choices: [{ text: 'Talk' }, { text: 'Leave' }], cancelable: true, onChoice: i => choices.push(i) });
  ui.update(0.01); input.endFrame();
  assert.equal(ui.msg.state, 'choice'); assert.equal(input.pointerUiPaused, true);
  emit('keydown', { code }); ui.update(0.01); await Promise.resolve();
  assert.deepEqual(choices, [selected]); assert.equal(ui.msg, null); assert.equal(ui.choice.visible, false);
  assert.equal(input.pointerUiPaused, false); assert.equal(input.softLook, true); assert.equal(requests.length, 1);
});

test('menu cancellation resumes capture but nested UI transitions keep the cursor available', async t => {
  const env = captureEnvironment(t), { ui, input, emit, requests } = env;
  env.lock(); ui.menuOpen = true;
  ui.list.open('Menu', [{ text: 'Resume' }], { onCancel: () => ui.closeMenu() }); ui.update(0.01);
  assert.equal(input.pointerUiPaused, true); assert.equal(requests.length, 0);
  ui.list.close(); ui.sceneOpen = 'shop'; ui.update(0.01);
  assert.equal(input.pointerUiPaused, true); assert.equal(requests.length, 0, 'closing one panel cannot capture while another UI is active');
  ui.sceneOpen = null; ui.list.open('Menu', [{ text: 'Resume' }], { onCancel: () => ui.closeMenu() });
  input.endFrame(); emit('keydown', { code: 'Escape' }); ui.update(0.01); await Promise.resolve();
  assert.equal(ui.menuOpen, false); assert.equal(input.pointerUiPaused, false); assert.equal(requests.length, 1); assert.equal(input.softLook, true);
});

test('clicking quantity Maximum and Zero edits the amount before explicit confirmation', t => {
  const { ui, input } = environment(t), values = [];
  ui.pointerRay = () => ({});
  ui.msg = { lines: [], state: 'number', number: { digits: 3, value: 15, range: [0, 200], onDone: value => values.push(value) } };
  ui.drawNumber();
  const row = i => { hit(ui.choice.panel, 100, 100 + ui.choice.rowH * (i + 0.5)); click(input); ui.updateNumber(); };
  row(1); assert.equal(ui.msg.number.value, 200); assert.deepEqual(values, [], 'Maximum must not close the prompt');
  row(2); assert.equal(ui.msg.number.value, 0); assert.deepEqual(values, [], 'Zero must not close the prompt');
  row(3); assert.deepEqual(values, [0]); assert.equal(ui.msg, null);
  release(input);
});
