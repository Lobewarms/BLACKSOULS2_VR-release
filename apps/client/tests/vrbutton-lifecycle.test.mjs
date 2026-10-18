import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRManager } from 'three/src/renderers/webxr/WebXRManager.js';
import { createVRButton } from '../src/vr/vrbutton.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class Session extends EventTarget {
  constructor() { super(); this.visibilityState = 'visible'; this.endCalls = 0; this.ended = false; }
  end() { this.endCalls++; if (this.endBehavior) return this.endBehavior(); this.emitEnd(); return Promise.resolve(); }
  emitEnd() { this.ended = true; this.dispatchEvent(new Event('end')); }
  visibility(value) { this.visibilityState = value; this.dispatchEvent(new Event('visibilitychange')); }
}
function environment(t, options = {}) {
  const events = [], attached = [], requests = [], visibility = [];
  let session = null, restores = 0, resets = 0;
  const xr = options.renderer?.xr || Object.assign(new EventTarget(), {
    isPresenting: false, getSession: () => session,
    async setSession(value) {
      attached.push(value); session = value;
      value.addEventListener('end', () => {
        if (session !== value) return;
        events.push('manager cleanup'); session = null; xr.isPresenting = false;
        xr.dispatchEvent(new Event('sessionend'));
      });
      if (options.attach) await options.attach(value, xr);
      else xr.isPresenting = true;
    },
  });
  const platform = Object.assign(new EventTarget(), {
    isSessionSupported: async () => true,
    requestSession() {
      const value = options.request ? options.request(requests.length) : new Session();
      requests.push(value); return Promise.resolve(value);
    },
  });
  const button = Object.assign(new EventTarget(), { disabled: false, classList: { toggle() {} },
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); } });
  for (const [key, value] of Object.entries({ navigator: { xr: platform }, window: { isSecureContext: true },
    document: { createElement: () => button } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {});
  const renderer = options.renderer || { xr, info: { render: { frame: 5 } } };
  createVRButton(renderer, {
    restoreView() { restores++; events.push('failed restore'); assert.equal(xr.isPresenting, false); },
    onVisibility(value) { visibility.push(value); if (value === 'ended') events.push('raw end'); options.onVisibility?.(value, xr); },
    ...(options.reset ? { resetXr() { resets++; events.push('reset'); return options.reset(xr); } } : {}),
  });
  return { button, xr, platform, attached, requests, events, visibility,
    get restores() { return restores; }, get resets() { return resets; },
    async start() { await flush(); button.click(); await flush(); return xr.getSession(); },
  };
}

test('healthy raw end completes manager cleanup and permits immediate reentry without restarting the runtime', async t => {
  const reset = deferred(), e = environment(t, { reset: () => reset.promise });
  const session = await e.start(); assert.equal(e.button.textContent, 'EXIT VR');
  e.xr.addEventListener('sessionend', () => e.events.push('desktop restored'));
  e.button.click();
  assert.equal(session.endCalls, 1); assert.equal(e.xr.isPresenting, false);
  assert.deepEqual(e.events, ['raw end', 'manager cleanup', 'desktop restored']);
  await flush(); assert.equal(e.button.disabled, false); assert.equal(e.resets, 0); assert.equal(e.restores, 0);
  assert.equal(e.button.textContent, 'ENTER VR');
  const fresh = await e.start(); assert.notEqual(fresh, session); assert.equal(e.requests.length, 2);
  assert.equal(e.button.textContent, 'EXIT VR'); e.button.click(); await flush(); assert.equal(e.resets, 0);
});

test('a rejected exit keeps the actual presenting session and lets EXIT VR retry it', async t => {
  const e = environment(t, { reset: async () => false }), session = await e.start();
  session.endBehavior = () => Promise.reject(new Error('runtime refused end'));
  e.button.click(); await flush();
  assert.equal(e.xr.isPresenting, true); assert.equal(e.xr.getSession(), session);
  assert.equal(e.button.textContent, 'EXIT VR'); assert.equal(e.button.disabled, false);
  assert.equal(e.requests.length, 1); assert.equal(e.resets, 0); assert.equal(e.restores, 0);
  session.endBehavior = null; e.button.click(); await flush();
  assert.equal(session.endCalls, 2); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 0);
});

test('old session end and visibility cannot reset or hide a newer session across repeated start and stop', async t => {
  const e = environment(t, { reset: async () => false });
  for (let round = 0; round < 3; round++) {
    const old = await e.start(); old.visibility('visible-blurred');
    e.button.click(); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
    const fresh = await e.start(), count = e.visibility.length;
    old.emitEnd(); old.visibility('hidden'); await flush();
    assert.equal(e.visibility.length, count); assert.equal(e.xr.getSession(), fresh);
    assert.equal(e.button.textContent, 'EXIT VR'); assert.equal(e.xr.isPresenting, true);
    e.button.click(); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
  }
  assert.equal(e.resets, 0, 'clean repeated exits must preserve the ready runtime');
});

test('a failed granted start restores the desktop before asynchronous runtime recovery and blocks overlapping starts', async t => {
  const reset = deferred(), e = environment(t, { attach: async () => { throw new Error('runtime attachment failed'); },
    reset: xr => { assert.equal(xr.isPresenting, false); return reset.promise; } });
  await e.start();
  assert.deepEqual(e.events, ['raw end', 'manager cleanup', 'failed restore', 'reset']);
  assert.equal(e.restores, 1); assert.equal(e.resets, 1); assert.equal(e.button.disabled, true);
  e.button.click(); assert.equal(e.requests.length, 1);
  reset.resolve(false); await flush(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.button.disabled, false);
});

test('failed attachment restores only after raw end and the manager saved-size cleanup', async t => {
  const e = environment(t, { attach: async () => { throw new Error('reference space unavailable'); } });
  await e.start();
  assert.deepEqual(e.events, ['raw end', 'manager cleanup', 'failed restore']);
  assert.equal(e.restores, 1); assert.equal(e.button.textContent, 'ENTER VR');
  assert.equal(e.attached[0].endCalls, 1);
});

test('failed start whose end rejects remains retryable until its actual end even if it is not presenting', async t => {
  const session = new Session(); session.endBehavior = () => Promise.reject(new Error('end refused'));
  const e = environment(t, { request: () => session, attach: async () => { throw new Error('no reference space'); } });
  await e.start();
  assert.equal(e.button.textContent, 'EXIT VR'); assert.equal(e.restores, 0);
  assert.equal(session.endCalls, 1, 'a failed start must not automatically repeat a rejected end');
  session.endBehavior = null; e.button.click(); await flush();
  assert.equal(e.restores, 1); assert.equal(e.button.textContent, 'ENTER VR');
});

test('a timed-out request ends its late grant without attaching it over the next live session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), late = new Session(), fresh = new Session();
  const e = environment(t, { request: index => index === 0 ? grant.promise : fresh });
  await e.start(); assert.equal(e.button.textContent, 'STARTING...');
  t.mock.timers.tick(20000); await flush();
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.attached.length, 0);
  await e.start(); assert.equal(e.xr.getSession(), fresh);
  grant.resolve(late); await flush();
  assert.equal(late.endCalls, 1); assert.deepEqual(e.attached, [fresh]);
  assert.equal(e.xr.getSession(), fresh); assert.equal(e.button.textContent, 'EXIT VR');
  late.visibility('hidden'); late.emitEnd(); await flush();
  assert.equal(e.xr.getSession(), fresh); assert.equal(e.visibility.length, 0);
  e.button.click(); await flush();
});

test('an uncancellable attachment timeout owns the attempt until it settles and is actually ended', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attachment = deferred();
  const e = environment(t, { attach: async (_session, xr) => { await attachment.promise; xr.isPresenting = true; } });
  await e.start(); t.mock.timers.tick(20000); await flush();
  assert.equal(e.button.textContent, 'EXITING...'); assert.equal(e.button.disabled, true);
  assert.equal(e.attached[0].endCalls, 0, 'do not reset while old setSession could still attach');
  e.button.click(); assert.equal(e.requests.length, 1); assert.equal(e.restores, 0);
  attachment.resolve(); await flush();
  assert.equal(e.attached[0].endCalls, 1); assert.equal(e.xr.isPresenting, false);
  assert.equal(e.restores, 1); assert.equal(e.button.textContent, 'ENTER VR');
});

test('a request grant racing its timeout in the same turn is still closed without attachment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), session = new Session(), e = environment(t, { request: () => grant.promise });
  await e.start(); t.mock.timers.tick(20000); grant.resolve(session); await flush();
  assert.equal(session.endCalls, 1); assert.equal(e.attached.length, 0);
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.restores, 1);
});

test('the pinned Three manager can repeatedly complete button exits and clean up an attachment that reports failure', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XRWebGLLayer');
  Object.defineProperty(globalThis, 'XRWebGLLayer', { configurable: true, value: class {
    constructor() { this.framebufferWidth = 4096; this.framebufferHeight = 2048; }
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'XRWebGLLayer', previous); else delete globalThis.XRWebGLLayer; });
  let width = 1280, height = 720, ratio = 2;
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace, info: { render: { frame: 0 } },
    getRenderTarget: () => null, setRenderTarget() {}, getPixelRatio: () => ratio,
    getSize: target => target.set(width, height),
    setPixelRatio(value) { ratio = value; this.setSize(width, height, false); },
    setSize(w, h) { if (!this.xr?.isPresenting) { width = w; height = h; } },
  };
  const manager = renderer.xr = new WebXRManager(renderer, {
    getContextAttributes: () => ({ xrCompatible: true, antialias: false, depth: false, stencil: false }),
  });
  let failAfterAttach = false;
  const attach = manager.setSession;
  manager.setSession = async function (session) {
    await attach.call(this, session);
    if (failAfterAttach) throw new Error('attachment completion rejected');
  };
  class RealManagerSession extends THREE.EventDispatcher {
    constructor() { super(); this.renderState = {}; this.enabledFeatures = []; this.visibilityState = 'visible'; this.endCalls = 0; }
    updateRenderState(value) { Object.assign(this.renderState, value); }
    requestReferenceSpace() { return Promise.resolve({}); }
    requestAnimationFrame() { return 1; }
    cancelAnimationFrame() {}
    end() { this.endCalls++; this.dispatchEvent({ type: 'end' }); return Promise.resolve(); }
  }
  const rawPresentations = [];
  const e = environment(t, { renderer, request: () => new RealManagerSession(),
    onVisibility(value, xr) { if (value === 'ended') rawPresentations.push(xr.isPresenting); }, reset: async xr => {
    assert.equal(xr.isPresenting, false); assert.equal(width, 1280); assert.equal(height, 720); assert.equal(ratio, 2);
    return false;
  } });
  for (let round = 0; round < 2; round++) {
    const session = await e.start(); assert.equal(manager.isPresenting, true);
    assert.equal(width, 4096); assert.equal(e.button.textContent, 'EXIT VR');
    // The button listener was attached before Three; its callback must observe
    // presentation until Three's later native-session listener clears it.
    e.button.click(); await flush();
    assert.equal(rawPresentations[round], true); assert.equal(session.endCalls, 1);
    assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(manager.getSession(), null);
  }
  failAfterAttach = true; await e.start();
  assert.equal(e.restores, 1); assert.equal(e.resets, 1); assert.equal(manager.isPresenting, false);
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(width, 1280); assert.equal(height, 720);
});
