import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { G } from '../src/core/globals.js';

function browser(t) {
  const listeners = new Map();
  const listen = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  for (const [key, value] of Object.entries({
    addEventListener: listen,
    HTMLInputElement: class {},
    document: { addEventListener: listen, pointerLockElement: null },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const dom = { addEventListener: listen };
  const input = new Input({}, dom);
  const emit = (name, values = {}) => {
    for (const fn of listeners.get(name) || []) fn({ preventDefault() {}, ...values });
  };
  return { input, dom, emit };
}

function captureBrowser(t) {
  const saved = { ui: G.ui, vr: G.vr }; t.after(() => Object.assign(G, saved));
  const env = browser(t), { input, dom, emit } = env;
  let busy = false, focused = true, focusCalls = 0, unlocks = 0;
  const requests = [];
  G.vr = false; G.ui = { pointerBusy: () => busy };
  dom.style = {}; dom.focus = () => focusCalls++;
  dom.getBoundingClientRect = () => ({ left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600 });
  dom.requestPointerLock = options => { requests.push(options); return Promise.resolve(); };
  document.hasFocus = () => focused;
  const lock = () => { document.pointerLockElement = dom; emit('pointerlockchange'); };
  const unlock = () => { document.pointerLockElement = null; emit('pointerlockchange'); };
  document.exitPointerLock = () => { unlocks++; unlock(); };
  return { ...env, lock, unlock, requests, busy: value => { busy = value; },
    focused: value => { focused = value; emit(value ? 'focus' : 'blur'); },
    get focusCalls() { return focusCalls; }, get unlocks() { return unlocks; } };
}

test('Alt+Tab releases mouse attacks, guard and movement without a mouseup', t => {
  const { input, emit } = browser(t);
  emit('keydown', { code: 'KeyW' });
  emit('mousedown', { button: 0 });
  emit('mousedown', { button: 2 });
  input.endFrame();
  input.mouse.dx = 12; input.mouse.dy = 5; input.mouse.wheel = 1;
  emit('blur');
  assert.deepEqual(input.moveVector(), { x: 0, y: 0 });
  assert.equal(input.mouseHeld(0), false);
  assert.equal(input.block(), false);
  assert.deepEqual(input.mouse, { dx: 0, dy: 0, buttons: 0, prevButtons: 0, wheel: 0 });
  emit('mousedown', { button: 0 });
  assert.equal(input.attackPressed(), true, 'the next click must work normally');
});

test('unlocking the mouse releases held buttons without swallowing Escape', t => {
  const { input, dom, emit } = browser(t);
  document.pointerLockElement = dom;
  emit('pointerlockchange');
  emit('mousedown', { button: 2 });
  emit('keydown', { code: 'Escape' });
  document.pointerLockElement = null;
  emit('pointerlockchange');
  assert.equal(input.pointerLocked, false);
  assert.equal(input.block(), false);
  assert.equal(input.cancel(), true);
});

test('menu mouse clicks keep the pointer free and confirm only a hit target', t => {
  const saved = { ui: G.ui, vr: G.vr }; t.after(() => Object.assign(G, saved));
  const { input, emit } = browser(t); G.vr = false;
  let locks = 0; input.lockPointer = () => locks++;
  G.ui = { sceneBusy: () => true, messageBusy: () => false, pointerTarget: false };
  emit('mousedown', { button: 0, clientX: 321, clientY: 234 });
  assert.equal(locks, 0); assert.deepEqual(input.pointer, { x: 321, y: 234, seen: true });
  assert.equal(input.confirm(), false, 'clicks outside an interactive hit cannot activate a menu row');
  G.ui.pointerTarget = true; assert.equal(input.confirm(), true);
  emit('mousemove', { clientX: 400, clientY: 250 }); assert.deepEqual(input.pointer, { x: 400, y: 250, seen: true });
  emit('mouseup', { button: 0 }); G.ui.sceneBusy = () => false;
  emit('mousedown', { button: 0, clientX: 400, clientY: 250 }); assert.equal(locks, 1, 'gameplay still captures the mouse normally');
});

test('a mouse click completed between frames remains a single press without becoming held', t => {
  const saved = { ui: G.ui, vr: G.vr }; t.after(() => Object.assign(G, saved));
  const { input, emit } = browser(t); G.vr = false;
  G.ui = { pointerBusy: () => true, pointerTarget: true };
  emit('mousedown', { button: 0 }); emit('mouseup', { button: 0 });
  assert.equal(input.mouseHeld(0), false); assert.equal(input.confirm(), true, 'fast completed clicks must reach the next UI frame');
  assert.equal(input.attackPressed(), true, 'all mouse press actions share the buffered edge');
  input.endFrame();
  assert.equal(input.confirm(), false); assert.equal(input.attackPressed(), false, 'a completed click cannot repeat in later frames');
  emit('mousedown', { button: 0 }); assert.equal(input.mousePressed(0), true);
  input.endFrame();
  assert.equal(input.mouseHeld(0), true); assert.equal(input.attackPressed(), false, 'holding a button must not generate repeated press edges');
  emit('mouseup', { button: 0 }); emit('mousedown', { button: 0 });
  assert.equal(input.attackPressed(), true, 'a release and new press between frames must register even when the previous frame was held');
});

test('blur and pointer unlock discard completed clicks before they reach another scene', t => {
  const { input, dom, emit } = browser(t);
  emit('mousedown', { button: 0 }); emit('mouseup', { button: 0 }); emit('blur');
  assert.equal(input.mousePressed(0), false, 'blur cancels queued clicks');
  document.pointerLockElement = dom; emit('pointerlockchange');
  emit('mousedown', { button: 0 }); emit('mouseup', { button: 0 });
  document.pointerLockElement = null; emit('pointerlockchange');
  assert.equal(input.mousePressed(0), false, 'unlock cancels queued clicks');
  emit('mousedown', { button: 0 }); emit('mouseup', { button: 0 });
  assert.equal(input.mousePressed(0), true, 'fresh clicks work normally after the flush');
});

test('dialogue handoff resumes mouse look once when Escape closes an unlocked UI', async t => {
  const env = captureBrowser(t), { input, dom, emit, requests } = env;
  env.lock(); env.busy(true); input.syncPointerUi(true);
  assert.equal(input.pointerLocked, false); assert.equal(env.unlocks, 1);
  assert.equal(input.pointerUiPaused, true); assert.equal(input.softLook, false);
  emit('keydown', { code: 'Escape' });
  assert.equal(input.cancel(), true, 'Escape remains available to the real UI close path');
  env.busy(false); input.syncPointerUi(false);
  assert.equal(requests.length, 1); assert.equal(env.focusCalls, 1);
  assert.equal(input.softLook, true, 'mouse look works while the browser considers recapture');
  assert.equal(dom.style.cursor, 'none');
  emit('mousemove', { target: dom, clientX: 200, clientY: 200, movementX: 6, movementY: -3 });
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [6, -3]);
  await Promise.resolve();
  for (let i = 0; i < 20; i++) input.syncPointerUi(false);
  assert.equal(requests.length, 1, 'render frames cannot repeatedly request pointer lock');
  env.lock(); assert.equal(input.softLook, false); assert.equal(dom.style.cursor, '');
});

test('browser Escape cooldown keeps in-canvas control and a fresh movement key can capture without a click', async t => {
  const env = captureBrowser(t), { input, dom, emit, requests } = env;
  dom.requestPointerLock = options => { requests.push(options); return Promise.reject(Object.assign(new Error('Unlock cooldown'), { name: 'SecurityError' })); };
  env.lock(); env.busy(true); input.syncPointerUi(true); env.busy(false); input.syncPointerUi(false);
  await Promise.resolve();
  assert.equal(input.lockPending, false); assert.equal(input.softLook, true); assert.equal(requests.length, 1);
  emit('mousemove', { target: dom, clientX: 200, clientY: 200, movementX: 4, movementY: 2 });
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [4, 2]);
  emit('mousemove', { target: {}, clientX: 200, clientY: 200, movementX: 8, movementY: 8 });
  emit('mousemove', { target: dom, clientX: 900, clientY: 200, movementX: 8, movementY: 8 });
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [4, 2], 'fallback look cannot follow the pointer outside the game canvas');
  for (let i = 0; i < 20; i++) input.syncPointerUi(false);
  assert.equal(requests.length, 1);
  dom.requestPointerLock = options => { requests.push(options); return Promise.resolve(); };
  emit('keydown', { code: 'KeyW' });
  assert.equal(requests.length, 2); assert.deepEqual(input.moveVector(), { x: 0, y: -1 });
  emit('keydown', { code: 'KeyW', repeat: true });
  assert.equal(requests.length, 2, 'held movement cannot cause repeated requests');
  env.lock(); assert.equal(input.pointerLocked, true); assert.equal(input.softLook, false);
});

test('native Escape from gameplay or fallback stops capture until a deliberate new click', async t => {
  const env = captureBrowser(t), { input, dom, emit, requests } = env;
  env.lock(); emit('keydown', { code: 'Escape' }); env.unlock(); input.syncPointerUi(false);
  assert.equal(input.cancel(), true); assert.equal(input.desktopLookWanted, false);
  emit('keydown', { code: 'KeyW' }); assert.equal(requests.length, 0);
  emit('mousedown', { button: 0 }); await Promise.resolve();
  assert.equal(requests.length, 1, 'an explicit gameplay click can start capturing again');
  input.enableSoftLook(); assert.equal(dom.style.cursor, 'none');
  emit('keydown', { code: 'Escape' }); input.syncPointerUi(false);
  assert.equal(input.softLook, false); assert.equal(dom.style.cursor, '');
});

test('a delayed unlock during UI close resumes once and duplicate unlocked events keep the fallback usable', t => {
  const env = captureBrowser(t), { input, emit, requests } = env;
  env.lock();
  document.exitPointerLock = () => {}; // browser dispatches the unlock asynchronously
  env.busy(true); input.syncPointerUi(true); emit('keydown', { code: 'Escape' });
  env.busy(false); input.syncPointerUi(false);
  assert.equal(requests.length, 0, 'wait for the outstanding scripted release before requesting capture');
  env.unlock(); assert.equal(requests.length, 1); assert.equal(input.softLook, true);
  env.unlock(); assert.equal(requests.length, 1); assert.equal(input.softLook, true);
});

test('focus loss cancels suspended capture and an old raw-input failure cannot recapture after blur', async t => {
  const env = captureBrowser(t), { input, dom, requests } = env;
  env.lock(); env.busy(true); input.syncPointerUi(true); env.focused(false);
  env.busy(false); input.syncPointerUi(false); env.focused(true); input.syncPointerUi(false);
  assert.equal(requests.length, 0); assert.equal(env.focusCalls, 0); assert.equal(input.desktopLookWanted, false);
  let rejectRaw;
  dom.requestPointerLock = options => { requests.push(options); return new Promise((resolve, reject) => { rejectRaw = reject; }); };
  input.lockPointer(); env.focused(false);
  rejectRaw(Object.assign(new Error('Raw input unavailable'), { name: 'NotSupportedError' }));
  await Promise.resolve();
  assert.equal(requests.length, 1, 'a stale raw failure cannot issue its normal-input retry after focus loss');
  assert.equal(input.softLook, false); assert.equal(input.desktopLookWanted, false);
});

test('unsupported raw input retries normal capture but other failures fall back without retry loops', async t => {
  const env = captureBrowser(t), { input, dom, requests, emit } = env;
  dom.requestPointerLock = options => {
    requests.push(options);
    return options ? Promise.reject(Object.assign(new Error('Raw unavailable'), { name: 'NotSupportedError' })) : Promise.resolve();
  };
  input.lockPointer(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(requests, [{ unadjustedMovement: true }, undefined]);
  env.lock(); env.busy(true); input.syncPointerUi(true); env.busy(false);
  dom.requestPointerLock = options => { requests.push(options); }; // legacy void-return API
  input.syncPointerUi(false); assert.equal(input.lockPending, true);
  emit('pointerlockerror'); assert.equal(input.lockPending, false); assert.equal(input.softLook, true);
  input.syncPointerUi(false); assert.equal(requests.length, 3);
});

test('UI opened without gameplay capture and headset UI never acquire desktop pointer lock', t => {
  const env = captureBrowser(t), { input, requests } = env;
  env.busy(true); input.syncPointerUi(true); env.busy(false); input.syncPointerUi(false);
  assert.equal(requests.length, 0); assert.equal(env.focusCalls, 0); assert.equal(input.softLook, false);
  env.lock(); G.vr = true; env.busy(true); input.syncPointerUi(true); input.lockPointer();
  assert.equal(env.unlocks, 0); assert.equal(requests.length, 0); assert.equal(input.softLook, false);
});
