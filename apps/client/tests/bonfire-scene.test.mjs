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
  const record = { images: [], texts: [] };
  const ctx = new Proxy({
    clearRect() { record.images = []; record.texts = []; },
    drawImage(...args) { record.images.push(args); },
    fillText(text, x, y) { record.texts.push({ text, x, y }); },
    measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (obj, key) => key in obj ? obj[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
function environment(t) {
  const saved = { ...G }, system = $data.system;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); $data.system = system;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas, hasFocus: () => true } });
  const switches = new Set([20]), transfers = [], commons = [];
  const actor = { name: 'Synthetic player', characterName: 'Synthetic character', characterIndex: 1 };
  const destinations = [
    { index: 1, name: 'Hidden destination', switchId: 999, selectSw: 0, mapId: 1, x: 1, y: 1, dir: 2, desc: ['Hidden', ''], commons: [] },
    { index: 7, name: 'First visible destination', switchId: 0, selectSw: 0, mapId: 12, x: 3, y: 4, dir: 6,
      desc: ['First source line', 'Second source line'], commons: [4, 8] },
    { index: 42, name: 'Second visible destination', switchId: 0, selectSw: 20, mapId: 16, x: 8, y: 9, dir: 4,
      desc: ['Another first line', 'Another second line'], commons: [9] },
  ];
  const map = { mapId: 10, interpreter: { running: () => false },
    reserveTransfer: (...args) => transfers.push(args), reserveCommonEvent: id => commons.push(id) };
  Object.assign(G, { vr: false, settings: {}, time: 0, combat: null, coop: null, audio: null, arena: null, player: null,
    map, state: { party: { leader: () => actor }, actor: () => actor, sw: id => switches.has(id) },
    scripts: { bonfires: destinations, bonfireMap: { picture: 'Synthetic map', players: {
      7: { type: 0, x: 110, y: 140 }, 42: { type: 0, x: 220, y: 250 },
    }, icons: [] } } });
  const input = G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { buttons: 0, prevButtons: 0, wheel: 0, dx: 0, dy: 0 },
    mousePresses: 0, pointerLocked: false, pointer: { seen: false }, navReady: true, navReadyX: true,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    dom: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) },
  });
  $data.system = { currency_unit: 'S' };
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const ui = G.ui = new UI(new THREE.Scene(), camera, new THREE.Group());
  const mapArt = { width: 476, height: 360 }, characterArt = { width: 384, height: 256 };
  ui.bonfireTravel.load = folder => Promise.resolve(folder === 'Graphics/Pictures' ? mapArt : characterArt);
  return { ui, input, switches, transfers, commons, map, mapArt, characterArt };
}
const settled = () => new Promise(resolve => setImmediate(resolve));
function press(input, code) { input.keysPrev.clear(); input.keys = new Set([code]); input.navReady = true; }

test('real bonfire scene loads the original map and follows keyboard selection with both source description lines', async t => {
  const { ui, input, mapArt, transfers } = environment(t);
  ui.openScene('Scene_ShortMove'); await settled(); ui.bonfireTravel.update();
  assert.equal(ui.sceneOpen, 'bonfire'); assert.equal(ui.list.items.length, 2);
  assert.ok(ui.list.panel.canvas.record.texts.some(row => row.text.includes('Enter: Confirm') && row.text.includes('Esc: Back')),
    'the compact command column retains both confirmation and cancellation guidance');
  assert.ok(ui.bonfireTravel.panel.canvas.record.images.some(args => args[0] === mapArt));
  let labels = ui.bonfireTravel.panel.canvas.record.texts.map(row => row.text);
  assert.ok(labels.includes('First source line')); assert.ok(labels.includes('Second source line'));
  press(input, 'ArrowDown'); ui.list.update(null); ui.bonfireTravel.update();
  assert.equal(ui.list.index, 1);
  labels = ui.bonfireTravel.panel.canvas.record.texts.map(row => row.text);
  assert.ok(labels.includes('Another first line')); assert.ok(labels.includes('Another second line'));
  assert.equal(transfers.length, 0, 'highlighting the map must not travel');
});

for (const phantom of [false, true]) test(`bonfire confirmation travels once and preserves ${phantom ? 'guest' : 'host'} common-event authority`, t => {
  const { ui, input, transfers, commons } = environment(t); G.coop = { phantom };
  ui.openBonfireWarp();
  const select = ui.list.onSelect;
  press(input, 'Enter'); ui.list.update(null); select(0);
  assert.deepEqual(transfers, [[12, 3, 4, 6, 0]]);
  assert.deepEqual(commons, phantom ? [] : [4, 8]);
  assert.equal(ui.sceneOpen, null); assert.equal(ui.list.visible, false);
  assert.equal(ui.bonfireTravel.panel.mesh.visible, false);
});

test('cancel closes list and map without traveling, and ordinary menu placement is restored', t => {
  const { ui, input, transfers, commons } = environment(t);
  ui.list.panel.mesh.position.x = -0.484;
  ui.openBonfireWarp(); press(input, 'Escape'); ui.list.update(null);
  assert.equal(ui.sceneOpen, null); assert.equal(ui.list.visible, false); assert.equal(ui.bonfireTravel.panel.mesh.visible, false);
  assert.deepEqual(transfers, []); assert.deepEqual(commons, []);
  assert.equal(ui.list.panel.mesh.position.x, 0);
  ui.list.open('Other menu', [{ text: 'Normal option' }]);
  assert.equal(ui.list.panel.canvas.width, ui.list.base.widthPx);
});

test('a destination locked after opening cannot transfer or close the current map preview', t => {
  const { ui, switches, transfers } = environment(t); ui.openBonfireWarp();
  switches.delete(20); ui.list.onSelect(1);
  assert.equal(transfers.length, 0); assert.equal(ui.sceneOpen, 'bonfire'); assert.equal(ui.list.visible, true);
});

test('an old confirmation cannot act on replacement state or a map that is already transferring', t => {
  const { ui, transfers, map } = environment(t); ui.openBonfireWarp();
  const select = ui.list.onSelect;
  map.transferring = true; select(0); assert.equal(transfers.length, 0);
  map.transferring = false; G.state = { ...G.state }; select(0); assert.equal(transfers.length, 0);
  ui.updateBonfireTravel(); assert.equal(ui.bonfireTravel.panel.mesh.visible, false);
  assert.equal(ui.sceneOpen, null); assert.equal(ui.list.visible, false);
});

test('missing map artwork leaves travel usable and closing the menu hides the preview immediately', async t => {
  const { ui, transfers } = environment(t); ui.bonfireTravel.load = async () => null;
  ui.openBonfireWarp(); await settled(); ui.bonfireTravel.update();
  assert.equal(ui.list.visible, true);
  assert.ok(ui.bonfireTravel.panel.canvas.record.texts.some(row => row.text === 'Map preview unavailable'));
  ui.closeMenu(); assert.equal(ui.sceneOpen, null); assert.equal(ui.bonfireTravel.panel.mesh.visible, false);
  assert.deepEqual(transfers, []);
});
