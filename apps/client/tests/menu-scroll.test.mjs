import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';
import { setWindowSkin } from '../src/ui/window-skin.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');

function canvas() {
  const record = { images: [], texts: [] };
  const ctx = new Proxy({
    clearRect() { record.images.length = 0; record.texts.length = 0; },
    drawImage(...args) { record.images.push(args); },
    fillText(text, x, y) { record.texts.push({ text, x, y, align: ctx.textAlign }); },
    measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
function environment(t) {
  const before = { ...G }, system = $data.system, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, before); $data.system = system; setWindowSkin(null);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  G.vr = false; G.settings = { ...G.settings }; G.map = null; G.state = null; G.player = null;
  G.combat = null; G.coop = null; G.scripts = {}; G.theater = null; G.audio = null; G.arena = null; G.time = 0;
  $data.system = { currency_unit: 'souls' };
  const input = G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { buttons: 0, prevButtons: 0, wheel: 0, dx: 0, dy: 0 },
    mousePresses: 0, pointerLocked: false, pointer: { seen: false }, navReady: true, navReadyX: true,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
  });
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const ui = G.ui = new UI(new THREE.Scene(), camera, new THREE.Group());
  return { ui, input };
}
const items = count => Array.from({ length: count }, (_, index) => ({ text: 'Item ' + index, right: '×99' }));
// Cast through the real Three.js menu plane at a canvas coordinate.
function ray(panel, x, y) {
  panel.mesh.updateWorldMatrix(true, false);
  const target = panel.mesh.localToWorld(new THREE.Vector3((x / panel.canvas.width - 0.5) * panel.widthM,
    (0.5 - y / panel.canvas.height) * panel.heightM, 0));
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(panel.mesh.matrixWorld);
  return new THREE.Raycaster(target.clone().add(normal), normal.negate());
}
function frame(input) { input.endFrame(); G.ui.pointerTarget = false; }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should equal ${expected}`);

test('overflow scrollbars use game cursor art, reflect first/middle/last positions and leave text clear', t => {
  const { ui } = environment(t), skin = { width: 128, height: 128 };
  setWindowSkin(skin);
  ui.list.open('Long list', items(40));
  const list = ui.list, bar = () => list.scrollbar.geometry;
  near(bar().thumbY, bar().y); near(bar().thumbHeight, bar().height * list.rows / 40);
  assert.ok(list.panel.canvas.record.images.some(([source, sx, sy, sw, sh, dx, dy]) =>
    source === skin && sx === 64 && sy === 64 && sw === 4 && sh === 4 && dx === bar().x + 2 && dy === bar().thumbY),
  'the scrollbar thumb uses the original window cursor corner');
  assert.ok(list.panel.canvas.record.texts.filter(entry => entry.align === 'right' && entry.y > 100)
    .every(entry => entry.x < bar().x), 'right-side counts stay outside the scrolling gutter');
  list.scrollTo(16); list.draw(); near(bar().thumbY, bar().y + bar().travel / 2);
  list.scrollTo(1000); list.draw(); near(bar().thumbY + bar().thumbHeight, bar().y + bar().height);
  list.open('Short list', items(list.rows)); assert.equal(bar(), null);
  ui.grid.open('Inventory', [{ label: 'Items', items: items(80) }]);
  assert.ok(ui.grid.scrollbar.geometry);
  assert.ok(30 + ui.grid.cols * ui.grid.cellWidth < ui.grid.scrollbar.geometry.x,
    'inventory cells reserve space for the scrollbar');
  ui.grid.open('Small inventory', [{ label: 'Items', items: items(4) }]);
  assert.equal(ui.grid.scrollbar.geometry, null);
});

test('PC wheel scrolls only a focused long menu, clamps rows and cannot use disabled items', t => {
  const { ui, input } = environment(t), selected = [], rows = items(30); rows[5].enabled = false;
  ui.menuOpen = true; ui.list.open('Items', rows, { onSelect: index => selected.push(index) });
  input.mouse.wheel = 5; ui.update(0.01);
  assert.equal(ui.list.top, 5); assert.equal(ui.list.index, 5); assert.equal(input.mouse.wheel, 0);
  frame(input); input.keys.add('Enter'); ui.update(0.01); assert.deepEqual(selected, []);
  frame(input); input.keys.clear(); input.mouse.wheel = 100; ui.update(0.01);
  assert.equal(ui.list.top, 22); assert.ok(ui.list.index >= 22 && ui.list.index < 30);
  frame(input); input.mouse.wheel = -100; ui.update(0.01); assert.equal(ui.list.top, 0);
  ui.closeMenu(); frame(input); input.mouse.wheel = 3; ui.update(0.01);
  assert.equal(input.mouse.wheel, 3, 'gameplay does not route wheel events into a closed menu');
});

test('dragging and clicking a list scrollbar reaches the end without selecting adjacent items', t => {
  const { ui, input } = environment(t), selected = [];
  ui.menuOpen = true; ui.list.open('Items', items(40), { onSelect: index => selected.push(index) });
  const list = ui.list; let bar = list.scrollbar.geometry;
  input.mouse.buttons = 1;
  list.update(ray(list.panel, bar.x + bar.width / 2, bar.thumbY + bar.thumbHeight / 2));
  frame(input);
  list.update(ray(list.panel, bar.x + bar.width / 2, bar.y + bar.height - bar.thumbHeight / 2));
  assert.equal(list.top, 32); assert.deepEqual(selected, []);
  bar = list.scrollbar.geometry; near(bar.thumbY + bar.thumbHeight, bar.y + bar.height);
  frame(input); input.mouse.buttons = 0;
  list.update(ray(list.panel, 100, 132)); frame(input);
  list.update(ray(list.panel, 100, 132)); assert.deepEqual(selected, [], 'releasing a drag over an item must not use it');
  list.scrollTo(0); list.draw(); bar = list.scrollbar.geometry;
  input.mousePresses = 1; // A complete click occurred between frames.
  list.update(ray(list.panel, bar.x + bar.width / 2, bar.y + bar.height - 1));
  assert.equal(list.top, 32); assert.deepEqual(selected, []);
  frame(input); list.update(ray(list.panel, bar.x + bar.width / 2, bar.y + bar.height - 1));
  assert.deepEqual(selected, []);
});

test('inventory wheel preserves the selected column and its scrollbar handles a partial final row', t => {
  const { ui, input } = environment(t), selected = [];
  ui.grid.open('Inventory', [{ label: 'Items', items: items(80) }], { index: 1, onSelect: item => selected.push(item) });
  const grid = ui.grid;
  input.mouse.wheel = 3; grid.update(null);
  assert.equal(grid.top, 3); assert.equal(grid.index, 10); assert.equal(grid.index % 3, 1);
  frame(input); let bar = grid.scrollbar.geometry; input.mousePresses = 1;
  grid.update(ray(grid.panel, bar.x + bar.width / 2, bar.y + bar.height - 1));
  assert.equal(grid.top, 21); assert.equal(grid.index % 3, 1); assert.deepEqual(selected, []);
  bar = grid.scrollbar.geometry; near(bar.thumbY + bar.thumbHeight, bar.y + bar.height);
  grid.index = 79; grid.draw(); assert.equal(grid.top, 21); assert.equal(grid.index, 79);
  frame(input); input.mouse.wheel = -100; grid.update(null);
  assert.equal(grid.top, 0); assert.ok(grid.index < 18); assert.deepEqual(selected, []);
});

test('initially unselected choices stay unselected through passive hover, wheel and scrollbar movement', t => {
  const { ui, input } = environment(t), selected = [], choice = ui.choice;
  choice.open('Choose', items(24), { index: -1, onSelect: index => selected.push(index) });
  choice.update(ray(choice.panel, 100, 132)); assert.equal(choice.index, -1);
  input.mouse.wheel = 2; choice.update(null); assert.equal(choice.top, 2); assert.equal(choice.index, -1);
  frame(input); choice.update(ray(choice.panel, 100, 132)); choice.update(ray(choice.panel, 100, 132));
  assert.equal(choice.index, -1, 'a stationary pointer over a newly visible row must not pick it');
  let bar = choice.scrollbar.geometry; input.mousePresses = 1;
  choice.update(ray(choice.panel, bar.x + bar.width / 2, bar.y + bar.height - 1));
  assert.equal(choice.top, 18); assert.equal(choice.index, -1); assert.deepEqual(selected, []);
  frame(input); input.keys.add('Enter'); choice.update(null); assert.deepEqual(selected, []);
  frame(input); input.keys.clear(); input.mousePresses = 1;
  choice.update(ray(choice.panel, 100, 132)); assert.deepEqual(selected, [18], 'an explicit item click still selects once');
});

test('VR retains stick navigation, ignores PC wheel events and cannot click an item through the scrollbar', t => {
  const { ui, input } = environment(t), selected = [];
  G.vr = true; ui.list.open('Items', items(40), { onSelect: index => selected.push(index) });
  input.axes.right[1] = 0.8; input.mouse.wheel = 3; ui.list.update(null);
  assert.equal(ui.list.index, 1); assert.equal(ui.list.top, 0); assert.equal(input.mouse.wheel, 3);
  const bar = ui.list.scrollbar.geometry; input.btn.right[0] = true; ui.pointerTarget = false;
  ui.list.update(ray(ui.list.panel, bar.x + bar.width / 2, bar.y + 50));
  assert.equal(ui.pointerTarget, false); assert.deepEqual(selected, []);
});

test('wheel input cannot swallow Escape, Backspace or Tab when closing list and inventory menus', t => {
  const { ui, input } = environment(t), sounds = []; let cancelled = 0;
  G.audio = { playSystemSe: id => sounds.push(id) }; ui.pointerRay = () => null;
  for (const panel of [ui.list, ui.grid]) for (const key of ['Escape', 'Backspace', 'Tab']) {
    input.keys.clear(); frame(input); ui.menuOpen = true;
    const callbacks = { onCancel: () => { cancelled++; ui.closeMenu(); } };
    if (panel === ui.list) panel.open('Items', items(40), callbacks);
    else panel.open('Inventory', [{ label: 'Items', items: items(80) }], callbacks);
    const before = cancelled;
    input.mouse.wheel = 3; input.keys.add(key); ui.update(0.01);
    assert.equal(cancelled, before + 1, `${key} must close the focused menu during wheel input`);
    assert.equal(ui.menuOpen, false); assert.equal(panel.visible, false);
    assert.equal(panel.top, 0, 'cancellation takes precedence over the queued scroll');
    assert.equal(sounds.at(-1), 2);
  }
});

test('Escape closes an actively dragged list or inventory scrollbar through the real UI frame', t => {
  const { ui, input } = environment(t); let selected = 0, cancelled = 0;
  for (const panel of [ui.list, ui.grid]) {
    input.keys.clear(); input.mouse.buttons = 0; frame(input); ui.menuOpen = true;
    const callbacks = { onSelect: () => selected++, onCancel: () => { cancelled++; ui.closeMenu(); } };
    if (panel === ui.list) panel.open('Items', items(40), callbacks);
    else panel.open('Inventory', [{ label: 'Items', items: items(80) }], callbacks);
    const bar = panel.scrollbar.geometry;
    ui.pointerRay = () => ray(panel.panel, bar.x + bar.width / 2, bar.thumbY + bar.thumbHeight / 2);
    input.mouse.buttons = 1; ui.update(0.01);
    assert.notEqual(panel.scrollbar.drag, null, 'the pointer must have started a real thumb drag');
    frame(input); input.keys.add('Escape'); const before = cancelled; ui.update(0.01);
    assert.equal(cancelled, before + 1); assert.equal(ui.menuOpen, false); assert.equal(panel.visible, false);
    assert.equal(panel.scrollbar.drag, null, 'closing must release scrollbar capture while the mouse is still held');
    assert.equal(selected, 0);
  }
});

test('optional cancellation callbacks still swallow the cancel edge without scrolling or activating items', t => {
  const { ui, input } = environment(t); let selected = 0;
  for (const panel of [ui.list, ui.grid]) {
    input.keys.clear(); frame(input); ui.menuOpen = true;
    const callbacks = { onCancel: null, onSelect: () => selected++ };
    if (panel === ui.list) panel.open('Items', items(40), callbacks);
    else panel.open('Inventory', [{ label: 'Items', items: items(80) }], callbacks);
    input.mouse.wheel = 3; input.keys.add('Escape');
    assert.equal(panel.update(null), true);
    assert.equal(panel.visible, true); assert.equal(panel.top, 0); assert.equal(selected, 0);
    panel.close();
  }
});
