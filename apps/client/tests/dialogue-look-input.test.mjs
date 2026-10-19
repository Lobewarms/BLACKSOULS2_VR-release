import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { G } from '../src/core/globals.js';

function environment(t) {
  const old = { ...G }, globalEvents = new Map(), canvasEvents = new Map(), documentEvents = new Map();
  const listen = events => (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); };
  const emit = (events, name, values = {}) => { for (const fn of events.get(name) || []) fn({ preventDefault() {}, ...values }); };
  let allowed = true, busy = true, focused = true;
  const requests = [], dom = { style: { cursor: 'crosshair' }, tabIndex: 0, addEventListener: listen(canvasEvents),
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 810, bottom: 620 }),
    requestPointerLock(options) { requests.push(options); return Promise.resolve(); }, focus() { document.activeElement = dom; } };
  const document = { activeElement: null, pointerLockElement: null, hasFocus: () => focused, addEventListener: listen(documentEvents),
    exitPointerLock() { document.pointerLockElement = null; emit(documentEvents, 'pointerlockchange'); } };
  for (const [key, value] of Object.entries({ document, addEventListener: listen(globalEvents), HTMLInputElement: class {} })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  Object.assign(G, { vr: false, ui: { pointerBusy: () => busy, dialogueLookAllowed: () => allowed, pointerTarget: true } });
  t.after(() => Object.assign(G, old));
  const input = new Input({ xr: { getSession: () => null } }, dom);
  const canvas = (name, values = {}) => emit(canvasEvents, name, { target: dom, clientX: 200, clientY: 200, ...values });
  const global = (name, values = {}) => emit(globalEvents, name, { target: dom, clientX: 200, clientY: 200, ...values });
  const move = (values = {}) => global('mousemove', { movementX: 6, movementY: -3, buttons: 2, ...values });
  return { input, dom, document, requests, canvas, global, move,
    allowed(value) { allowed = value; }, busy(value) { busy = value; },
    focused(value) { focused = value; global(value ? 'focus' : 'blur'); },
    lock() { document.pointerLockElement = dom; emit(documentEvents, 'pointerlockchange'); } };
}

test('unlocked canvas RMB drag feeds normal look deltas while retaining the conversation cursor', t => {
  const e = environment(t), { input } = e;
  e.move(); assert.deepEqual([input.mouse.dx, input.mouse.dy], [0, 0], 'ordinary cursor hover is not camera movement');
  e.canvas('mousedown', { button: 2 });
  assert.equal(input.dialogueLooking(), true); assert.equal(input.pointerLocked, false);
  e.move(); assert.deepEqual([input.mouse.dx, input.mouse.dy], [6, -3]);
  assert.deepEqual(input.pointer, { x: 200, y: 200, seen: true });
  assert.equal(e.dom.style.cursor, 'crosshair'); assert.equal(e.requests.length, 0);
  assert.equal(input.block(), false); assert.equal(input.attackPressed(), false); assert.equal(input.confirm(), false);
  e.global('mouseup', { button: 2 });
  assert.equal(input.dialogueLooking(), false); assert.deepEqual([input.mouse.dx, input.mouse.dy], [6, -3], 'a fast drag/release survives until the render frame');
  assert.equal(input.mouse.buttons, 0); assert.equal(input.mousePresses, 0);
  input.endFrame(); assert.deepEqual([input.mouse.dx, input.mouse.dy], [0, 0]);
  e.canvas('mousedown', { button: 0 }); e.global('mouseup', { button: 0 });
  assert.equal(input.confirm(), true, 'a fresh choice click still works after the drag ends');
  assert.equal(e.requests.length, 0);
});

test('a drag requires a focused desktop conversation and a canvas-origin right click', t => {
  const e = environment(t), { input } = e;
  e.global('mousedown', { button: 2 }); assert.equal(input.dialogueLooking(), false, 'window mouse presses do not start a canvas drag');
  e.canvas('mousedown', { button: 2, target: {}, clientX: 200 }); assert.equal(input.dialogueLooking(), false);
  e.global('mouseup', { button: 2 }); input.releaseMouse();
  e.canvas('mousedown', { button: 2, clientX: 900 }); assert.equal(input.dialogueLooking(), false);
  e.global('mouseup', { button: 2 }); input.releaseMouse();
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    e.document.activeElement = { tagName }; e.canvas('mousedown', { button: 2 });
    assert.equal(input.dialogueLooking(), false, tagName); input.releaseMouse();
  }
  e.document.activeElement = { isContentEditable: true }; e.canvas('mousedown', { button: 2 });
  assert.equal(input.dialogueLooking(), false); input.releaseMouse(); e.document.activeElement = null;
  e.allowed(false); e.canvas('mousedown', { button: 2 }); assert.equal(input.dialogueLooking(), false); input.releaseMouse();
  e.allowed(true); G.vr = true; e.canvas('mousedown', { button: 2 }); assert.equal(input.dialogueLooking(), false); input.releaseMouse(); G.vr = false;
  e.focused(false); e.canvas('mousedown', { button: 2 }); assert.equal(input.dialogueLooking(), false); input.releaseMouse(); e.focused(true);
  delete G.ui.dialogueLookAllowed; e.canvas('mousedown', { button: 2 }); assert.equal(input.dialogueLooking(), false);
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [0, 0]); assert.equal(e.requests.length, 0);
});

test('left clicks during a drag never confirm, advance, attack or leak into the closed dialogue', t => {
  const e = environment(t), { input } = e;
  e.canvas('mousedown', { button: 0 });
  assert.equal(input.confirm(), true, 'normal choice clicks still use existing confirm semantics');
  e.canvas('mousedown', { button: 2 });
  assert.equal(input.mouse.buttons, 0, 'starting look flushes a previously held choice click');
  e.canvas('mousedown', { button: 0 }); e.global('mouseup', { button: 0 });
  assert.equal(input.confirm(), false); assert.equal(input.advance(), false); assert.equal(input.attackPressed(), false); assert.equal(input.block(), false);
  e.move(); e.allowed(false); e.busy(false); input.update(); input.syncPointerUi(false);
  assert.equal(input.dialogueLooking(), false); assert.deepEqual(input.mouse, { dx: 0, dy: 0, buttons: 0, prevButtons: 0, wheel: 0 });
  assert.equal(input.confirm(), false); assert.equal(input.advance(), false); assert.equal(input.attackPressed(), false); assert.equal(input.block(), false);
  e.global('mouseup', { button: 2 }); input.endFrame(); assert.equal(input.block(), false);
  e.canvas('mousedown', { button: 0 }); assert.equal(input.attackPressed(), true, 'only a fresh gameplay click can attack');
});

test('dialogue drags keep the existing finite-motion and isolated-spike filter', t => {
  const e = environment(t), { input } = e;
  e.canvas('mousedown', { button: 2 });
  e.move({ movementX: 4, movementY: 1 });
  e.move({ movementX: 3000, movementY: 0, timeStamp: 10 });
  e.move({ movementX: 4, movementY: 1 });
  e.move({ movementX: NaN, movementY: 1 });
  assert.deepEqual([input.mouse.dx, input.mouse.dy], [8, 2]); assert.equal(input.mouseSpikes.length, 1);
  assert.equal(input.dialogueLooking(), true); assert.equal(e.requests.length, 0);
});

for (const exit of ['leave', 'outside', 'other target', 'missed release', 'blur', 'text field', 'UI close', 'VR']) {
  test(`${exit} cancels dialogue drag and clears pending mouse actions`, t => {
    const e = environment(t), { input } = e;
    e.canvas('mousedown', { button: 2 }); e.move();
    assert.equal(input.dialogueLooking(), true);
    if (exit === 'leave') e.canvas('mouseleave');
    if (exit === 'outside') e.move({ clientX: 900 });
    if (exit === 'other target') e.move({ target: {} });
    if (exit === 'missed release') e.move({ buttons: 0 });
    if (exit === 'blur') e.focused(false);
    if (exit === 'text field') { e.document.activeElement = { tagName: 'INPUT' }; input.update(); }
    if (exit === 'UI close') { e.allowed(false); input.update(); }
    if (exit === 'VR') { G.vr = true; input.transitionViewMode(true); }
    assert.equal(input.dialogueLooking(), false); assert.deepEqual([input.mouse.dx, input.mouse.dy], [0, 0]);
    assert.equal(input.mouse.buttons, 0); assert.equal(input.mousePresses, 0);
    assert.equal(input.mousePressed(0), false); assert.equal(input.mouseHeld(2), false);
    assert.equal(input.confirm(), false); assert.equal(input.attackPressed(), false); assert.equal(input.block(), false);
    assert.equal(e.requests.length, 0);
  });
}

test('conversation drag preserves the existing one-time gameplay recapture and soft-look fallback', t => {
  const e = environment(t), { input } = e;
  e.allowed(false); e.busy(false); e.lock();
  e.allowed(true); e.busy(true); input.syncPointerUi(true);
  assert.equal(input.pointerLocked, false); assert.equal(input.pointerUiPaused, true);
  e.canvas('mousedown', { button: 2 }); e.move();
  e.global('keydown', { code: 'KeyW' }); input.lockPointer();
  assert.equal(e.requests.length, 0); assert.equal(e.dom.style.cursor, 'crosshair');
  e.global('mouseup', { button: 2 }); e.allowed(false); e.busy(false); input.syncPointerUi(false);
  assert.equal(e.requests.length, 1); assert.equal(input.softLook, true); assert.equal(e.dom.style.cursor, 'none');
  for (let i = 0; i < 10; i++) input.syncPointerUi(false);
  assert.equal(e.requests.length, 1, 'dialogue look cannot create a recapture loop');
  assert.equal(input.attackPressed(), false); assert.equal(input.block(), false);
});
