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
    createLinearGradient: () => ({ addColorStop() {} }), measureText: text => ({ width: String(text).length * 14 }),
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

async function realUiEnvironment(t) {
  const e = await environment(t), { UI } = await import('../src/ui/ui.js');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  camera.position.y = 1.6; scene.add(camera);
  const actor = { name: 'Synthetic player', level: 12, classId: 1, hp: 100, mhp: 100, mp: 30, mmp: 50, states: [], buffs: Array(8).fill(0), equips: [] };
  Object.assign(G.state.party, { leader: () => actor, gold: 100, spirits: [] });
  $data.system = { currency_unit: 'Souls', terms: { basic: ['Level', 'Lv', 'Health', 'HP', 'Magic', 'MP'] } };
  $data.states = []; $data.classes = []; $data.skills = []; $data.weapons = []; $data.armors = [];
  G.player = { headWorld: out => out.copy(camera.position), forward2D: () => ({ x: 0, z: -1 }) };
  G.settings = { ...G.settings, minimap: true }; G.three = { scene, camera };
  Object.assign(e.input.dom, { focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }) });
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  e.pictures.ui = ui; ui.root.add(e.pictures.mesh);
  const frame = async (logic = true) => {
    if (logic) { e.map.update(); G.frame++; }
    await Promise.resolve(); await Promise.resolve(); e.pictures.render(); ui.update(1 / 60); e.input.endFrame(); G.time += 1 / 60;
  };
  const view = async () => {
    assert.equal(e.map.events[1].start(), true); await frame();
    for (let i = 0; i < 30 && ui.msg?.state !== 'choice'; i++) await frame();
    assert.equal(ui.msg?.state, 'choice'); e.emit('keydown', { code: 'Enter' }); await frame(); e.emit('keyup', { code: 'Enter' });
    await frame(); await frame(); assert.equal(G.state.sw(7), true); assert.equal(e.pictures.pics.has(1), true);
  };
  return { ...e, ui, frame, view };
}

function waitingViewer(e, trigger = 4, frames = 2) {
  const event = e.map.events[2], list = [command(230, [frames]), ...event.list];
  event.event.pages = [page(list, trigger, 7)]; event.refresh();
  const interpreter = trigger === 4 ? event.interpreter : e.map.interpreter;
  interpreter.setup(list, event.id); interpreter.update();
  return { event, interpreter, list };
}

for (const trigger of [3, 4]) test(`menu cancellation advances only the waiting native ${trigger === 3 ? 'autorun' : 'parallel'} viewer`, async t => {
  const e = await realUiEnvironment(t); await e.view(); const owner = waitingViewer(e, trigger);
  assert.equal(owner.interpreter.waitCount, 1);
  let routes = 0, unrelated = 0;
  e.map.playerChar.update = () => routes++;
  e.map.eventList.push({ page: null, update: () => unrelated++ });
  e.map.commonParallel.push({ ce: { switch_id: 7 }, interp: { running: () => true, update: () => unrelated++ } });
  G.state.system.timer = { working: true, count: 60 };
  e.ui.openMenu(); await e.frame();
  assert.equal(owner.interpreter.waitCount, 0); assert.equal(e.pictures.pics.has(1), true);
  assert.equal(e.pictures.viewerCancelPending(), true);
  await e.frame();
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false);
  assert.equal(e.pictures.viewerCancelPending(), false); assert.equal(e.input.rmButton(12), false);
  for (let i = 0; i < 4; i++) await e.frame();
  assert.equal(e.ui.menuOpen, true); assert.equal(routes, 0); assert.equal(unrelated, 0);
  assert.equal(G.state.system.timer.count, 60);
});

for (const reason of ['map', 'state', 'page', 'execution']) test(`a waiting viewer cancel cannot advance a replaced ${reason} owner`, async t => {
  const e = await realUiEnvironment(t); await e.view(); const owner = waitingViewer(e);
  e.ui.openMenu(); await e.frame(); assert.equal(owner.interpreter.waitCount, 0);
  if (reason === 'map') e.map.mapId++;
  else if (reason === 'state') G.state = { ...G.state };
  else if (reason === 'page') owner.event.page = { ...owner.event.page };
  else owner.interpreter.setup([command(235, [1]), command(0)], owner.event.id);
  await e.frame();
  assert.equal(e.pictures.viewerCancelPending(), false); assert.equal(e.pictures.pics.has(1), true);
  assert.equal(e.input.rmButton(12), false); assert.equal(e.ui.menuOpen, true);
});

test('a viewer cleanup gets a finite interpreter budget without unpausing the world or manufacturing Erase', async t => {
  const e = await realUiEnvironment(t); await e.view(); const owner = waitingViewer(e, 4, 1000);
  let routes = 0; e.map.playerChar.update = () => routes++;
  G.state.system.timer = { working: true, count: 60 }; e.ui.openMenu();
  for (let i = 0; i < 605; i++) await e.frame();
  assert.equal(e.pictures.viewerCancelPending(), false); assert.equal(e.pictures.pics.has(1), true);
  assert.ok(owner.interpreter.waitCount > 0, 'the native long wait is neither skipped nor force-completed');
  assert.equal(routes, 0); assert.equal(G.state.system.timer.count, 60); assert.equal(e.input.rmButton(12), false);
});

for (const key of ['Tab', 'KeyM', 'KeyN']) test(`real UI ${key} opening cancels only a B-controlled viewer through its original autorun`, async t => {
  const e = await realUiEnvironment(t); e.pictures.show([2, '', 0, 0, 0, 0, 100, 100, 255, 0]); await e.view();
  e.lock(); e.emit('keydown', { code: key }); await e.frame(); e.emit('keyup', { code: key });
  assert.equal(e.ui.menuOpen, true); assert.equal(e.input.pointerLocked, false);
  assert.equal(e.input.cancel(), false, 'opening the menu does not create a generic UI cancel edge');
  for (let i = 0; i < 3; i++) await e.frame(false);
  await e.frame();
  assert.equal(e.ui.menuOpen, true, 'original viewer cleanup must not close or reopen the chosen menu');
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false); assert.equal(e.pictures.pics.has(2), true);
  assert.equal(key === 'KeyN' ? e.ui.sceneOpen : e.ui.menuSection, key === 'KeyN' ? 'map' : 'main');
});

test('real headset left-Y menu cancels a B-controlled picture without inventing right-B or cancelling the menu', async t => {
  const e = await realUiEnvironment(t); await e.view(); G.vr = true;
  e.input.btn.left[5] = true; await e.frame(); e.input.btn.left[5] = false;
  assert.equal(e.ui.menuOpen, true); assert.equal(e.input.xrHeld('right', 5), false);
  await e.frame(); assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false); assert.equal(e.ui.menuOpen, true);
});

test('menu opening preserves decorative pictures when no active matching B/erase controller owns them', async t => {
  const e = await realUiEnvironment(t); await e.view();
  // The page still has B/erase for picture1; it must not own picture3 merely
  // because an image exists, nor an inactive event with a different picture id.
  e.pictures.erase(1); e.pictures.show([3, 'SyntheticMoonViewer', 0, 0, 0, 0, 100, 100, 255, 0]);
  e.map.events[2].list = [command(230, [60]), command(0)];
  e.ui.openMenu(); await e.frame();
  assert.equal(e.pictures.pics.has(3), true); assert.equal(G.state.sw(7), true); assert.equal(e.input.rmButton(12), false);
});

test('viewer cancellation requires an active auto/parallel page and matching erase inside the true B branch', async t => {
  const e = await environment(t); await e.view(); const controller = e.map.events[2], originalPage = controller.page;
  const valid = [command(111, [11, 12]), command(235, [1], 1), command(411), command(0)];
  let requests = 0; t.mock.method(e.input, 'requestRmCancel', () => requests++);
  for (const list of [
    [command(111, [11, 13]), command(235, [1], 1), command(0)],
    [command(111, [11, 12]), command(230, [1], 1), command(235, [1]), command(0)],
    [command(111, [11, 12]), command(230, [1], 1), command(411), command(235, [1], 1), command(0)],
    [command(111, [11, 12]), command(235, [9], 1), command(0)],
  ]) { controller.list = list; assert.equal(e.pictures.requestViewerCancel(), false); }
  controller.list = valid;
  for (const change of [{ page: null }, { erased: true }, { trigger: 0 }]) {
    Object.assign(controller, { page: originalPage, erased: false, trigger: 3 }, change);
    assert.equal(e.pictures.requestViewerCancel(), false);
  }
  Object.assign(controller, { page: originalPage, erased: false, trigger: 3 });
  e.pictures.pics.get(1).opacity = 0; assert.equal(e.pictures.requestViewerCancel(), false);
  e.pictures.pics.get(1).opacity = 255; assert.equal(requests, 0);
  assert.equal(e.pictures.requestViewerCancel(), true); controller.trigger = 4; assert.equal(e.pictures.requestViewerCancel(), true);
  assert.equal(requests, 2);
});

test('repeated original Show Picture renders its already-loaded image in the same logic/render frame', async t => {
  const e = await environment(t), parameters = [1, 'SyntheticMoonViewer', 0, 0, 0, 0, 100, 100, 255, 0];
  e.pictures.show(parameters);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  e.pictures.render(); assert.equal(e.pictures.mesh.visible, true);
  const image = e.pictures.pics.get(1).img;
  assert.ok(image);
  for (let tick = 0; tick < 12; tick++) {
    const previous = e.pictures.pics.get(1);
    previous.angle = 20; previous.d = 10; previous.target = { opacity: 0 };
    // Actual 60Hz order has no await/microtask between original commands and
    // this frame's render. A cached load promise alone is too late for that.
    e.pictures.show([1, parameters[1], 1, 0, tick, tick + 1, 90, 80, 200, 1]);
    e.pictures.render();
    const current = e.pictures.pics.get(1);
    assert.notEqual(current, previous, 'Show Picture still resets the original state');
    assert.equal(current.img, image); assert.equal(e.pictures.mesh.visible, true);
    assert.deepEqual([current.origin, current.x, current.y, current.zx, current.zy, current.opacity, current.blend, current.angle, current.d, current.target],
      [1, tick, tick + 1, 90, 80, 200, 1, 0, 0, null]);
  }
});

test('a different Show Picture image cannot reuse old art or be resurrected by replaced/erased asynchronous loads', async t => {
  const e = await environment(t), names = ['SyntheticPendingPictureA', 'SyntheticPendingPictureB', 'SyntheticPendingPictureC'];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: names.map(name => `Graphics/Pictures/${name}.png`) }));
  await initAssets(); const pending = new Map();
  globalThis.Image = class { width = 640; height = 480;
    set src(url) { pending.set(decodeURIComponent(url).split('/').at(-1).replace(/\.png$/, ''), this); } };
  const show = name => e.pictures.show([1, name, 0, 0, 0, 0, 100, 100, 255, 0]);
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  show(names[0]); await settle(); const a = pending.get(names[0]); a.onload(); await settle(); e.pictures.render();
  assert.equal(e.pictures.pics.get(1).img, a); assert.equal(e.pictures.mesh.visible, true);
  show(names[1]); e.pictures.render();
  assert.equal(e.pictures.pics.get(1).img, null); assert.equal(e.pictures.mesh.visible, false, 'old A must not leak into new B');
  await settle(); show(names[2]); await settle(); pending.get(names[1]).onload(); await settle();
  assert.equal(e.pictures.pics.get(1).name, names[2]); assert.equal(e.pictures.pics.get(1).img, null, 'late B cannot replace C');
  e.pictures.erase(1); e.pictures.render(); pending.get(names[2]).onload(); await settle(); e.pictures.render();
  assert.equal(e.pictures.pics.has(1), false); assert.equal(e.pictures.mesh.visible, false); assert.equal(e.pictures.backdrop.visible, false);
});

test('opening the real menu cancels a viewer whose image is still loading and a late load cannot restore it', async t => {
  const e = await realUiEnvironment(t), name = 'SyntheticPendingMenuViewer';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [`Graphics/Pictures/${name}.png`] }));
  await initAssets(); let pending;
  globalThis.Image = class { width = 640; height = 480; set src(_url) { pending = this; } };
  for (const event of e.map.eventList) for (const page of event.event.pages) for (const command of page.list) if (command.code === 231) command.parameters[1] = name;
  await e.view();
  assert.ok(pending); assert.equal(e.pictures.pics.get(1).img, null); assert.equal(e.pictures.mesh.visible, false);
  e.emit('keydown', { code: 'Tab' }); await e.frame(); e.emit('keyup', { code: 'Tab' }); await e.frame();
  assert.equal(G.state.sw(7), false); assert.equal(e.pictures.pics.has(1), false); assert.equal(e.ui.menuOpen, true);
  pending.onload(); for (let i = 0; i < 4; i++) await Promise.resolve(); e.pictures.render();
  assert.equal(e.pictures.pics.has(1), false); assert.equal(e.pictures.mesh.visible, false); assert.equal(e.pictures.backdrop.visible, false);
});
