import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

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
