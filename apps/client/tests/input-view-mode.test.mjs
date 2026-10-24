import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRController } from 'three/src/renderers/webxr/WebXRController.js';
import { Input } from '../src/core/input.js';
import { G } from '../src/core/globals.js';

function environment(t) {
  const saved = { ...G }, listeners = new Map();
  t.after(() => { for (const key of Object.keys(G)) if (!(key in saved)) delete G[key]; Object.assign(G, saved); });
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
  const emit = (name, event = {}) => { for (const fn of listeners.get(name) || []) fn({ preventDefault() {}, ...event }); };
  let focused = true, busy = false, session = null, sources = [], requests = 0, unlocks = 0, focuses = 0;
  const dom = { style: {}, tabIndex: 0, addEventListener: listen, focus: () => focuses++,
    requestPointerLock: () => { requests++; return Promise.resolve(); },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }) };
  const document = { pointerLockElement: null, activeElement: null, addEventListener: listen, hasFocus: () => focused,
    exitPointerLock: () => { unlocks++; document.pointerLockElement = null; emit('pointerlockchange'); } };
  for (const [key, value] of Object.entries({ document, addEventListener: listen, HTMLInputElement: class {} })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (prior) Object.defineProperty(globalThis, key, prior); else delete globalThis[key]; });
  }
  Object.assign(G, { vr: false, xrAway: false, frame: 20, time: 1, ui: { pointerBusy: () => busy, pointerTarget: true }, onControllerConnected: null });
  const controllers = [new WebXRController(), new WebXRController()];
  const xr = Object.assign(new THREE.EventDispatcher(), {
    getSession: () => session, getController: i => controllers[i].getTargetRaySpace(), getControllerGrip: i => controllers[i].getGripSpace(),
  });
  const input = new Input({ xr }, dom); input.setupXR(new THREE.Scene(), new THREE.Group());
  const grant = () => { session = { inputSources: { [Symbol.iterator]: () => sources[Symbol.iterator]() } }; };
  const enter = () => { if (!session) grant(); G.vr = true; input.transitionViewMode(true); };
  const exit = () => { session = null; G.vr = false; input.transitionViewMode(false); xr.dispatchEvent({ type: 'sessionend' }); };
  const connect = (hand, held = [], axes = [0, 0]) => {
    const index = hand === 'left' ? 0 : 1, source = { handedness: hand, targetRayMode: 'tracked-pointer', profiles: ['synthetic-controller'],
      gamepad: { buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0, touched: false })), axes: [0, 0, ...axes] } };
    sources.push(source); controllers[index].connect(source); return source;
  };
  const button = (source, index, held) => Object.assign(source.gamepad.buttons[index], { pressed: held, value: held ? 1 : 0 });
  return { input, dom, document, emit, xr, enter, exit, grant, connect, button,
    lock() { document.pointerLockElement = dom; emit('pointerlockchange'); },
    squeeze(source, held) { controllers[source.handedness === 'left' ? 0 : 1].dispatchEvent({ type: held ? 'squeezestart' : 'squeezeend', data: source }); },
    busy(value) { busy = value; }, focused(value) { focused = value; emit(value ? 'focus' : 'blur'); },
    get requests() { return requests; }, get unlocks() { return unlocks; }, get focuses() { return focuses; } };
}

test('entering XR flushes keys, mouse attacks, scroll and original event cues, then scripted unlock never invents cancel', t => {
  const e = environment(t), { input } = e;
  e.lock(); e.emit('keydown', { code: 'KeyW' }); e.emit('keydown', { code: 'Enter' });
  e.emit('mousedown', { button: 0 }); e.emit('mousedown', { button: 2 }); input.mouse.wheel = 2;
  input.requestRmCancel(); input.rmXUntil = 99; e.enter();
  assert.equal(e.unlocks, 1); assert.equal(input.pointerLocked, false); assert.equal(input.desktopLookBeforeVr, true);
  assert.equal(input.rmCancelFrame, null); assert.equal(input.rmButton(12), false); assert.equal(input.rmButton(14), false);
  assert.deepEqual(input.mouse, { dx: 0, dy: 0, buttons: 0, prevButtons: 0, wheel: 0 });
  assert.deepEqual([...input.keys], []); assert.deepEqual([...input.keysPrev], []);
  e.emit('keyup', { code: 'KeyW' }); e.exit();
  assert.deepEqual(input.moveVector(), { x: 0, y: 0 }); assert.equal(input.attackPressed(), false); assert.equal(input.block(), false); assert.equal(input.confirm(), false);
  e.emit('keydown', { code: 'KeyW' }); assert.deepEqual(input.moveVector(), { x: 0, y: -1 }, 'a fresh desktop input still works');
});

test('first held XR buttons and sticks stay neutral until release/centering, then fresh actions work normally', t => {
  const e = environment(t); e.enter();
  const left = e.connect('left', [0, 1, 3, 4, 5], [0, -1]), right = e.connect('right', [0, 1, 3, 4, 5], [1, -1]);
  e.input.update();
  const quiet = () => {
    for (const action of ['confirm', 'cancel', 'menu', 'quickHeld', 'quickPressed', 'dodge', 'disarmPressed', 'block', 'breakHeld', 'interact', 'jumpPressed']) assert.equal(e.input[action](), false, action);
    assert.equal(e.input.turnAxis(), 0); assert.deepEqual(e.input.moveVector(), { x: 0, y: 0 });
    assert.equal(e.input.grabPressed('left'), false); assert.equal(e.input.grabPressed('right'), false);
  };
  quiet(); e.input.update(); quiet();
  // An initially held stick must center as a whole, including when it moves sideways.
  left.gamepad.axes[2] = 1; e.input.update(); quiet();
  for (const source of [left, right]) { for (let i = 0; i < 6; i++) e.button(source, i, false); source.gamepad.axes = [0, 0, 0, 0]; }
  e.input.update(); e.button(right, 0, true); e.button(left, 5, true); left.gamepad.axes[3] = -1; e.input.update();
  assert.equal(e.input.confirm(), true); assert.equal(e.input.menu(), true); assert.deepEqual(e.input.moveVector(), { x: 0, y: -1 });
  e.input.update(); assert.equal(e.input.confirm(), false); assert.equal(e.input.menu(), false);
});

test('a genuine complete squeeze before the first XR frame survives transition initialization', t => {
  const e = environment(t); e.grant(); const right = e.connect('right'); e.enter();
  e.button(right, 1, true); e.squeeze(right, true); e.button(right, 1, false); e.squeeze(right, false); e.input.update();
  assert.equal(e.input.grabPressed('right'), true); assert.equal(e.input.xrPressed('right', 1), false);
  e.input.update(); assert.equal(e.input.grabPressed('right'), false);
});

test('returning from XR restores prior focused mouse look without requesting capture or stealing focus', t => {
  const e = environment(t); e.lock(); e.enter();
  for (let i = 0; i < 4; i++) e.input.syncPointerUi(false);
  e.exit();
  assert.equal(e.input.desktopLookWanted, true); assert.equal(e.input.softLook, true); assert.equal(e.input.pointerUiPaused, false);
  assert.equal(e.requests, 0); assert.equal(e.focuses, 0); assert.equal(e.dom.style.cursor, 'none');
  e.emit('mousemove', { target: e.dom, clientX: 100, clientY: 100, movementX: 4, movementY: -2 });
  assert.deepEqual([e.input.mouse.dx, e.input.mouse.dy], [4, -2]);
});

test('busy menus retain prior look for the existing handoff, while a focused name field keeps its cursor', t => {
  const e = environment(t); e.lock(); e.enter(); e.busy(true); e.exit();
  assert.equal(e.input.desktopLookWanted, true); assert.equal(e.input.pointerUiPaused, true); assert.equal(e.input.softLook, false);
  e.input.syncPointerUi(true); assert.equal(e.requests, 0); assert.equal(e.focuses, 0);
  e.busy(false); e.document.activeElement = { tagName: 'INPUT' }; e.input.syncPointerUi(false);
  assert.equal(e.input.softLook, false); assert.equal(e.focuses, 0, 'name entry cannot lose focus to mouse recapture');
  e.document.activeElement = null; e.input.syncPointerUi(false);
  assert.equal(e.input.softLook, true); assert.equal(e.requests, 1); assert.equal(e.focuses, 1);
});

test('unfocused exit and previously uncaptured desktop do not arm mouse look', t => {
  const e = environment(t); e.lock(); e.enter(); e.focused(false); e.exit();
  assert.equal(e.input.desktopLookWanted, false); assert.equal(e.input.softLook, false);
  e.focused(true); e.input.syncPointerUi(false); assert.equal(e.requests, 0); assert.equal(e.focuses, 0);
  e.enter(); e.exit(); assert.equal(e.input.desktopLookWanted, false); assert.equal(e.input.softLook, false);
});

test('delayed scripted unlock and stale desktop capture completion cannot cancel events or capture while XR is active', t => {
  const e = environment(t); e.lock(); e.document.exitPointerLock = () => {};
  e.enter(); e.input.syncPointerUi(false); e.exit();
  e.document.pointerLockElement = null; e.emit('pointerlockchange');
  assert.equal(e.input.rmButton(12), false); assert.equal(e.input.softLook, true); assert.equal(e.requests, 0);
  e.enter(); let releases = 0; e.document.exitPointerLock = () => { releases++; e.document.pointerLockElement = null; e.emit('pointerlockchange'); };
  e.document.pointerLockElement = e.dom; e.emit('pointerlockchange');
  assert.equal(releases, 1); assert.equal(e.input.pointerLocked, false); assert.equal(e.input.desktopLookWanted, false); assert.equal(e.input.rmButton(12), false);
});

test('repeated real transitions flush previous controllers and seed a new held controller without a phantom confirm', t => {
  const e = environment(t); e.enter(); const old = e.connect('right'); e.input.update();
  e.button(old, 4, true); e.input.update(); assert.equal(e.input.confirm(), true);
  e.exit(); e.emit('keydown', { code: 'Enter' }); e.emit('mousedown', { button: 0 }); e.enter();
  e.input.update(); assert.equal(e.input.confirm(), false); assert.equal(e.input.attackPressed(), false);
  e.button(old, 4, false); e.input.update(); e.button(old, 4, true); e.input.update(); assert.equal(e.input.confirm(), true);
  e.exit(); assert.equal(e.input.confirm(), false); assert.equal(e.input.attackPressed(), false);
});
