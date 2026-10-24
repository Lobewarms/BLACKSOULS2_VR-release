import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRController } from 'three/src/renderers/webxr/WebXRController.js';
import { Input } from '../src/core/input.js';
import { G } from '../src/core/globals.js';

function environment(t) {
  const previous = { vr: G.vr, xrAway: G.xrAway, ui: G.ui, onControllerConnected: G.onControllerConnected };
  t.after(() => Object.assign(G, previous));
  for (const [key, value] of Object.entries({ addEventListener() {}, HTMLInputElement: class {},
    document: { addEventListener() {}, hasFocus: () => true } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  let busy = false, sources = [];
  // XRInputSourceArray is iterable but does not provide Array.prototype.includes.
  const sourceArray = { [Symbol.iterator]: () => sources[Symbol.iterator]() };
  let session = { inputSources: sourceArray };
  const controllers = [new WebXRController(), new WebXRController()];
  const xr = Object.assign(new THREE.EventDispatcher(), {
    getController: i => controllers[i].getTargetRaySpace(),
    getControllerGrip: i => controllers[i].getGripSpace(),
    getSession: () => session,
  });
  G.vr = true; G.xrAway = false; G.ui = { pointerBusy: () => busy }; G.onControllerConnected = null;
  const input = new Input({ xr }, { addEventListener() {} }); input.setupXR(new THREE.Scene(), new THREE.Group());
  const connect = (i, hand = 'right', held = false, gamepad = true) => {
    const source = { handedness: hand, targetRayMode: 'tracked-pointer', profiles: ['synthetic-controller'],
      gamepad: gamepad ? { buttons: Array.from({ length: 6 }, (_, b) => ({ pressed: b === 1 && held, value: b === 1 && held ? 1 : 0, touched: false })), axes: [0, 0, 0, 0] } : null };
    sources = [...sources, source]; controllers[i].connect(source); return source;
  };
  const poll = (source, held) => { Object.assign(source.gamepad.buttons[1], { pressed: held, value: held ? 1 : 0 }); };
  const squeeze = (i, source, held) => controllers[i].dispatchEvent({ type: held ? 'squeezestart' : 'squeezeend', data: source });
  const disconnect = (i, source) => { sources = sources.filter(s => s !== source); controllers[i].disconnect(source); };
  return { input, controllers, xr, connect, disconnect, squeeze, poll, frame: () => input.update(),
    busy: value => { busy = value; },
    endSession() { session = null; xr.dispatchEvent({ type: 'sessionend' }); },
    newSession() { session = { inputSources: sourceArray }; },
    removeSource(source) { sources = sources.filter(s => s !== source); },
  };
}

test('a complete between-frame squeeze reaches world grabbing once, even with delayed gamepad polling', t => {
  const e = environment(t), source = e.connect(0); e.frame();
  e.squeeze(0, source, true); e.squeeze(0, source, false); e.frame();
  assert.equal(e.input.grabPressed('right'), true); assert.equal(e.input.grabPressed('right'), true, 'all readers in this frame observe the same edge');
  assert.equal(e.input.xrPressed('right', 1), false, 'buffering must not change sampled combat/UI button edges');
  assert.equal(e.input.xrHeld('right', 1), false);
  e.frame(); assert.equal(e.input.grabPressed('right'), false);
  e.poll(source, true); e.frame(); assert.equal(e.input.grabPressed('right'), false, 'late polling cannot replay the completed squeeze');
  e.poll(source, false); e.frame();
  e.squeeze(0, source, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
  e.frame(); assert.equal(e.input.grabPressed('right'), false, 'holding the grip cannot repeat pickup');
});

test('a squeeze before the first rendered frame survives session initialization', t => {
  const e = environment(t), source = e.connect(0);
  e.poll(source, true); e.squeeze(0, source, true); e.squeeze(0, source, false); e.poll(source, false); e.frame();
  assert.equal(e.input.grabPressed('right'), true);
});

test('analog-only squeeze uses the same hysteresis as controller UI without repeating a world pickup', t => {
  const e = environment(t), source = e.connect(0); e.frame();
  const analog = value => { Object.assign(source.gamepad.buttons[1], { pressed: false, value }); e.frame(); };
  analog(0.61); assert.equal(e.input.grabPressed('right'), true); assert.equal(e.input.xrPressed('right', 1), true);
  analog(0.5); assert.equal(e.input.grabPressed('right'), false); assert.equal(e.input.xrHeld('right', 1), true);
  analog(0.36); assert.equal(e.input.grabPressed('right'), false);
  analog(0.34); assert.equal(e.input.xrReleased('right', 1), true);
  analog(0.61); assert.equal(e.input.grabPressed('right'), true);
});

test('an analog grip held during connect or a menu needs release before it can pick up', t => {
  const e = environment(t), source = e.connect(0);
  Object.assign(source.gamepad.buttons[1], { pressed: false, value: 0.8 });
  e.busy(true); e.frame(); e.busy(false); e.frame();
  assert.equal(e.input.grabPressed('right'), false);
  Object.assign(source.gamepad.buttons[1], { value: 0.2 }); e.frame();
  Object.assign(source.gamepad.buttons[1], { value: 0.8 }); e.frame();
  assert.equal(e.input.grabPressed('right'), true);
});

test('poll-only controllers retain normal squeeze edges without duplicating a later start event', t => {
  const e = environment(t), source = e.connect(0); e.frame();
  e.poll(source, true); e.frame();
  assert.equal(e.input.grabPressed('right'), true); assert.equal(e.input.xrPressed('right', 1), true);
  e.squeeze(0, source, true); e.frame();
  assert.equal(e.input.grabPressed('right'), false); assert.equal(e.input.xrHeld('right', 1), true);
  e.poll(source, false); e.squeeze(0, source, false); e.frame();
  assert.equal(e.input.xrReleased('right', 1), true);
  e.squeeze(0, source, true); e.poll(source, true); e.frame();
  assert.equal(e.input.grabPressed('right'), true);
});

for (const events of [false, true]) test(`${events ? 'event' : 'polling'} grip held through a menu needs release and a new squeeze`, t => {
  const e = environment(t), source = e.connect(0); e.frame(); e.busy(true);
  e.poll(source, true); if (events) e.squeeze(0, source, true); e.frame();
  assert.equal(e.input.grabPressed('right'), false);
  e.busy(false); e.frame(); assert.equal(e.input.grabPressed('right'), false);
  e.frame(); assert.equal(e.input.grabPressed('right'), false);
  e.poll(source, false); if (events) e.squeeze(0, source, false); e.frame();
  e.poll(source, true); if (events) e.squeeze(0, source, true); e.frame();
  assert.equal(e.input.grabPressed('right'), true);
});

test('opening UI flushes both queued and current-frame grabs, including script prompts', t => {
  const e = environment(t), right = e.connect(0), left = e.connect(1, 'left'); e.frame();
  e.squeeze(0, right, true); e.squeeze(1, left, true); e.busy(true); e.frame();
  e.busy(false); e.frame();
  assert.equal(e.input.grabPressed('right'), false); assert.equal(e.input.grabPressed('left'), false);
  e.squeeze(0, right, false); e.squeeze(0, right, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
  G.ui.prompt = { shown: true }; assert.equal(e.input.grabPressed('right'), false);
  G.ui.prompt.shown = false; assert.equal(e.input.grabPressed('right'), false, 'a late UI close cannot replay a flushed frame edge');
  e.squeeze(0, right, false); G.ui.remote = { shown: true }; e.squeeze(0, right, true); e.frame();
  G.ui.remote.shown = false; e.frame(); assert.equal(e.input.grabPressed('right'), false);
});

test('PC mode and the headset system overlay discard grabs without changing combat polling', t => {
  const e = environment(t), source = e.connect(0); e.frame(); G.vr = false;
  e.poll(source, true); e.squeeze(0, source, true); e.frame(); assert.equal(e.input.grabPressed('right'), false);
  assert.equal(e.input.xrHeld('right', 1), true, 'the dedicated world gate does not rewrite the combat snapshot');
  G.vr = true; e.frame(); assert.equal(e.input.grabPressed('right'), false);
  e.poll(source, false); e.squeeze(0, source, false); e.frame(); G.xrAway = true;
  e.poll(source, true); e.squeeze(0, source, true); e.frame(); G.xrAway = false; e.frame();
  assert.equal(e.input.grabPressed('right'), false);
  e.poll(source, false); e.squeeze(0, source, false); e.frame();
  e.poll(source, true); e.squeeze(0, source, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
});

test('disconnect and XR session loss immediately clear buffered and already exposed grabs', t => {
  const e = environment(t), source = e.connect(0); e.frame();
  e.squeeze(0, source, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
  e.disconnect(0, source); assert.equal(e.input.grabPressed('right'), false); assert.equal(e.input.controllers.right, undefined);
  e.squeeze(0, source, false); e.squeeze(0, source, true); e.frame(); assert.equal(e.input.grabPressed('right'), false);
  const next = e.connect(0); e.frame(); e.squeeze(0, next, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
  e.endSession(); assert.equal(e.input.grabPressed('right'), false); e.frame();
  e.poll(next, true); e.newSession(); e.frame(); assert.equal(e.input.grabPressed('right'), false, 'entering a session with a held grip cannot pick something up');
  e.poll(next, false); e.frame(); e.poll(next, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
});

test('source disappearance without a disconnect event flushes stale grabs and rearms only after release', t => {
  const e = environment(t), source = e.connect(0); e.frame();
  e.squeeze(0, source, true); e.removeSource(source); e.frame(); assert.equal(e.input.grabPressed('right'), false);
  const next = e.connect(0, 'right', true); e.frame(); assert.equal(e.input.grabPressed('right'), false);
  e.poll(next, false); e.frame(); e.poll(next, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
});

test('unhanded sources and stale disconnect events cannot overwrite a current right controller', t => {
  const e = environment(t), right = e.connect(0); e.frame();
  const none = e.connect(1, 'none');
  assert.equal(e.input.controllers.right.ray, e.controllers[0].getTargetRaySpace());
  assert.equal(e.input.hands.right.source, right); e.disconnect(1, none);
  const replacement = e.connect(1, 'right'); e.frame(); e.squeeze(1, replacement, true);
  e.disconnect(0, right);
  assert.equal(e.input.controllers.right.ray, e.controllers[1].getTargetRaySpace());
  assert.equal(e.input.hands.right.source, replacement); e.frame(); assert.equal(e.input.grabPressed('right'), true);
  e.squeeze(0, right, true); e.frame(); assert.equal(e.input.grabPressed('right'), false, 'old controllers cannot queue edges for a replacement source');
});

test('reusing a controller slot clears old source edges and ignores its late disconnect', t => {
  const e = environment(t), old = e.connect(0); e.frame(); e.squeeze(0, old, true);
  const next = e.connect(0); e.disconnect(0, old); e.frame();
  assert.equal(e.input.hands.right.source, next); assert.equal(e.input.grabPressed('right'), false);
  e.squeeze(0, next, true); e.frame(); assert.equal(e.input.grabPressed('right'), true);
});

test('squeeze events work without a gamepad and never invent analog combat presses', t => {
  const e = environment(t), source = e.connect(0, 'right', false, false); e.frame();
  e.squeeze(0, source, true); e.squeeze(0, source, false); e.frame();
  assert.equal(e.input.grabPressed('right'), true); assert.equal(e.input.xrHeld('right', 1), false);
  assert.equal(e.input.xrPressed('right', 1), false); assert.equal(e.input.xrValue('right', 1), 0);
});
