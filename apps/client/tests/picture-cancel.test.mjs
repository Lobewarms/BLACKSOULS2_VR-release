import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/core/input.js';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { GameMap } from '../src/world/gamemap.js';
import { MapGrid } from '../src/world/mapmesh.js';
import { GameEvent } from '../src/entities/character.js';
import { PictureLayer } from '../src/ui/pictures.js';

const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const show = number => command(231, [number, 'SyntheticMoonViewer', 0, 0, 0, 0, 100, 100, 255, 0], 1);
function page(list, trigger, switchId = 0) {
  return { graphic: { tile_id: 0, character_name: '', character_index: 0, direction: 2, pattern: 0 },
    condition: { switch1_valid: !!switchId, switch1_id: switchId }, list, trigger,
    move_type: 0, move_speed: 3, move_frequency: 3, walk_anime: true, step_anime: false,
    direction_fix: true, through: true, priority_type: 0, move_route: { list: [command(0)], repeat: true } };
}

async function environment(t) {
  const saved = { ...G }, data = { ...$data }, listeners = new Map();
  const listen = (name, callback) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); };
  const emit = (name, value = {}) => { for (const callback of listeners.get(name) || []) callback({ preventDefault() {}, ...value }); };
  const ctx = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) },
  { get: (object, key) => key in object ? object[key] : () => {} });
  let focused = true;
  const document = { addEventListener: listen, hasFocus: () => focused, pointerLockElement: null,
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  for (const [name, value] of Object.entries({ document, addEventListener: listen, HTMLInputElement: class {},
    Image: class { width = 640; height = 480; set src(_url) { queueMicrotask(() => this.onload()); } } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: ['Graphics/Pictures/SyntheticMoonViewer.png'] }));
  await initAssets();
  const dom = { style: {}, addEventListener: listen, tabIndex: 0 };
  const input = new Input({}, dom), ui = { root: new THREE.Group(), placeRoot() {}, msg: null,
    pointerBusy: () => !!ui.msg, messageBusy: () => !!ui.msg, showMessage: message => { ui.msg = message; } };
  Object.assign(G, { input, ui, vr: false, combat: null, coop: null, audio: null, theater: null, arena: null,
    frame: 100, time: 0, scripts: {}, player: { forward2D: () => ({ x: 0, z: -1 }) } });
  const switches = new Map();
  G.state = { sw: id => switches.get(id) || false, setSw(id, value) { switches.set(id, value); G.map.requestRefresh(); },
    v: () => 0, selfSw: () => false, system: { timer: { working: false } }, party: { actors: [], steps: 0 } };
  $data.commonEvents = []; $data.mapInfos = new Map();
  const map = G.map = new GameMap(); map.mapId = 9;
  map.map = { width: 4, height: 4, data: { data: new Uint16Array(64) } };
  map.grid = new MapGrid(map.map, { flags: { data: new Uint16Array(8192) }, tileset_names: [] });
  const pictures = G.pictures = new PictureLayer(ui, new THREE.PerspectiveCamera());
  G.screen = { showPicture: p => pictures.show(p), erasePicture: n => pictures.erase(n) };
  // Synthetic counterpart of the original interaction: an action event enables
  // a separate autorun; that autorun, rather than the action event, owns B/erase.
  const telescope = [command(102, [['View', 'Leave'], 2]), command(402, [0, 'View']), show(1),
    command(121, [7, 7, 0], 1), command(0, [], 1), command(402, [1, 'Leave']), command(0, [], 1), command(404), command(0)];
  const viewer = [command(111, [11, 12]), command(121, [7, 7, 1], 1), command(235, [1], 1), command(0, [], 1),
    command(411), show(1), command(0, [], 1), command(412), command(0)];
  map.loading = true;
  for (const [id, list, trigger, switchId] of [[1, telescope, 0, 0], [2, viewer, 3, 7]]) {
    const event = new GameEvent(9, { id, x: id, y: 1, pages: [page(list, trigger, switchId)] });
    map.events[id] = event; map.eventList.push(event);
  }
  map.loading = false;
  const lock = () => { document.pointerLockElement = dom; emit('pointerlockchange'); };
  const unlock = () => { document.pointerLockElement = null; emit('pointerlockchange'); };
  document.exitPointerLock = unlock;
  const frame = async (logic = true) => {
    if (logic) { map.update(); G.frame++; }
    await Promise.resolve(); await Promise.resolve(); pictures.render(); input.endFrame();
  };
  const view = async (choice = 0) => {
    assert.equal(map.events[1].start(), true); await frame(); assert.ok(ui.msg?.choices);
    ui.msg.onChoice(choice); ui.msg = null; await frame(); await frame();
  };
  return { input, map, pictures, ui, lock, unlock, emit, frame, view,
    focus: value => { focused = value; emit(value ? 'focus' : 'blur'); } };
}

test('native pointer unlock without Escape keydown reaches the original autorun B branch and erases only the viewer picture', async t => {
  const e = await environment(t); e.pictures.show([2, '', 0, 0, 10, 10, 100, 100, 255, 0]);
  await e.view(); assert.equal(G.state.sw(7), true); assert.equal(e.pictures.mesh.visible, true);
  e.lock(); e.unlock(); assert.equal(e.input.keys.has('Escape'), false, 'browser native unlock can omit keydown');
  await e.frame();
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false); assert.equal(e.pictures.mesh.visible, false);
  assert.equal(e.pictures.pics.has(2), true, 'unrelated persistent pictures are not wiped');
  assert.equal(e.pictures.backdrop.visible, false); assert.equal(e.input.cancel(), false, 'native unlock does not become a generic UI close edge');
});

test('render-only high-refresh frames cannot consume native B before the next map logic tick', async t => {
  const e = await environment(t); await e.view(); e.lock(); e.unlock();
  const logicFrame = G.frame;
  for (let i = 0; i < 5; i++) { await e.frame(false); assert.equal(G.frame, logicFrame); assert.equal(G.state.sw(7), true); }
  await e.frame(); assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false);
  assert.equal(e.input.rmButton(12), false, 'the native edge expires when that logic frame finishes');
});

test('scripted dialogue/menu pointer release never triggers the original B branch', async t => {
  const e = await environment(t); await e.view(); e.lock();
  e.ui.msg = {}; e.input.suspendPointerForUi(); e.ui.msg = null;
  assert.equal(e.input.pointerLocked, false); assert.equal(e.input.rmButton(12), false);
  await e.frame(); assert.equal(G.state.sw(7), true); assert.equal(e.pictures.pics.has(1), true);
});

test('Leave does not display a picture; ordinary persistent pictures survive event completion and native pointer release', async t => {
  const e = await environment(t); await e.view(1);
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false);
  e.pictures.show([3, 'SyntheticMoonViewer', 0, 0, 0, 0, 100, 100, 255, 0]); await e.frame();
  e.lock(); e.unlock(); await e.frame(); await e.frame();
  assert.equal(e.pictures.pics.has(3), true); assert.equal(e.pictures.mesh.visible, true);
});

test('blur and unfocused unlock flush native B, while the actual keyboard and VR cancel controls still erase through event logic', async t => {
  const e = await environment(t); await e.view(); e.lock(); e.unlock(); e.focus(false); e.focus(true);
  await e.frame(); assert.equal(G.state.sw(7), true);
  e.lock(); e.focus(false); e.unlock(); e.focus(true); await e.frame(); assert.equal(G.state.sw(7), true);
  e.emit('keydown', { code: 'Escape' }); await e.frame(); e.emit('keyup', { code: 'Escape' });
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false);
  await e.view(); G.vr = true; e.input.btn.right[5] = true; await e.frame();
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false);
});
