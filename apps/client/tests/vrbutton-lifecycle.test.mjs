import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRManager } from 'three/src/renderers/webxr/WebXRManager.js';
import { createVRButton } from '../src/vr/vrbutton.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
class Session extends EventTarget {
  constructor() { super(); this.visibilityState = 'visible'; this.endCalls = 0; this.ended = false; }
  end() { this.endCalls++; if (this.endBehavior) return this.endBehavior(); this.emitEnd(); return Promise.resolve(); }
  emitEnd() { this.ended = true; this.dispatchEvent(new Event('end')); }
  visibility(value) { this.visibilityState = value; this.dispatchEvent(new Event('visibilitychange')); }
}
function environment(t, options = {}) {
  const events = [], attached = [], requests = [], visibility = [], statuses = [];
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
    isSessionSupported: () => options.support ? options.support() : Promise.resolve(true),
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
  const renderer = options.renderer || { xr, info: { render: { frame: 5 } },
    ...(options.context ? { getContext: () => options.context, domElement: new EventTarget() } : {}) };
  createVRButton(renderer, {
    onStatus(value) { statuses.push(value); }, waitForPose: options.waitForPose,
    restoreView() { restores++; events.push('failed restore'); assert.equal(xr.isPresenting, false); },
    onVisibility(value) { visibility.push(value); if (value === 'ended') events.push('raw end'); options.onVisibility?.(value, xr); },
    ...(options.reset ? { resetXr() { resets++; events.push('reset'); return options.reset(xr); } } : {}),
  });
  return { button, xr, platform, renderer, attached, requests, events, visibility, statuses,
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

test('a fifty-five-second native grant stays owned after soft feedback and enters VR without another request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), session = new Session();
  const e = environment(t, { request: () => grant.promise });
  await e.start(); assert.equal(e.button.textContent, 'CANCEL VR START');
  t.mock.timers.tick(20000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'permission-slow'); assert.equal(e.attached.length, 0);
  assert.equal(e.button.textContent.includes('ENTER VR'), false); assert.equal(e.requests.length, 1);
  t.mock.timers.tick(35000); grant.resolve(session); await flush();
  assert.equal(session.endCalls, 0); assert.deepEqual(e.attached, [session]);
  assert.equal(e.xr.getSession(), session); assert.equal(e.button.textContent, 'EXIT VR'); assert.equal(e.requests.length, 1);
  e.button.click(); await flush();
});

test('an uncancellable attachment timeout owns the attempt until it settles and is actually ended', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attachment = deferred();
  const e = environment(t, { attach: async (_session, xr) => { await attachment.promise; xr.isPresenting = true; } });
  await e.start(); t.mock.timers.tick(20000); await flush();
  assert.equal(e.button.textContent, 'EXITING...'); assert.equal(e.button.disabled, true);
  assert.equal(e.statuses.at(-1).stage, 'attachment-stalled');
  assert.equal(e.statuses.at(-1).needsReload, true); assert.equal(e.statuses.at(-1).canCancel, false);
  assert.equal(e.attached[0].endCalls, 0, 'do not reset while old setSession could still attach');
  e.button.click(); assert.equal(e.requests.length, 1); assert.equal(e.restores, 0);
  attachment.resolve(); await flush();
  assert.equal(e.attached[0].endCalls, 1); assert.equal(e.xr.isPresenting, false);
  assert.equal(e.restores, 1); assert.equal(e.button.textContent, 'ENTER VR');
});

test('a grant racing the ninety-second hard stall is observed and closed without attachment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), session = new Session(), e = environment(t, { request: () => grant.promise });
  await e.start(); t.mock.timers.tick(90000); grant.resolve(session); await flush();
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

test('the native session request runs synchronously in the click activation before slow GPU preparation', async t => {
  const gpu = deferred(); let activation = false, compatible = false;
  const context = { getContextAttributes: () => ({ xrCompatible: compatible }), isContextLost: () => false,
    makeXRCompatible: () => gpu.promise.then(() => { compatible = true; }) };
  const e = environment(t, { context, request() { assert.equal(activation, true, 'permission must not be delayed past the click task'); return new Session(); } });
  await flush(); activation = true; e.button.click(); activation = false;
  assert.equal(e.requests.length, 1); await flush(); assert.equal(e.statuses.at(-1).stage, 'graphics');
  assert.equal(e.attached.length, 0); gpu.resolve(); await flush();
  assert.equal(e.button.textContent, 'EXIT VR'); e.button.click(); await flush();
});

test('cancelling permission owns its late grant until actual end and blocks any newer request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), late = new Session(), fresh = new Session();
  const e = environment(t, { request: index => index ? fresh : grant.promise });
  await e.start(); assert.equal(e.statuses.at(-1).stage, 'permission'); assert.equal(e.statuses.at(-1).canCancel, true);
  e.button.click(); await flush(); assert.equal(e.button.textContent, 'WAITING FOR VR...');
  assert.equal(e.statuses.at(-1).stage, 'permission-stalled');
  e.button.click(); assert.equal(e.requests.length, 1);
  late.endBehavior = () => new Promise(() => {}); grant.resolve(late); await flush();
  assert.equal(late.endCalls, 1); assert.deepEqual(e.attached, []); assert.equal(e.xr.getSession(), null);
  t.mock.timers.tick(8000); await flush(); assert.equal(e.button.textContent, 'EXIT VR');
  e.button.click(); await flush(); assert.equal(e.requests.length, 1, 'EXIT retries cleanup instead of starting another request');
  late.emitEnd(); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
  await e.start(); assert.equal(e.xr.getSession(), fresh); assert.deepEqual(e.attached, [fresh]);
  e.button.click(); await flush();
});

test('cancelling graphics preparation ends a granted session before Three attaches and cannot revive the cancelled attempt', async t => {
  const gpu = deferred(), session = new Session(); let compatible = false;
  const e = environment(t, { request: () => session, reset: async () => false,
    context: { getContextAttributes: () => ({ xrCompatible: compatible }), isContextLost: () => false,
      makeXRCompatible: () => gpu.promise.then(() => { compatible = true; }) } });
  await e.start(); assert.equal(e.statuses.at(-1).stage, 'graphics');
  e.button.cancelStartup(); await flush();
  assert.equal(session.endCalls, 1); assert.equal(e.attached.length, 0); assert.equal(e.resets, 0);
  assert.equal(e.button.textContent, 'ENTER VR'); gpu.resolve(); await flush();
  assert.equal(e.attached.length, 0); assert.equal(e.button.textContent, 'ENTER VR');
});

function nativeManager(t, { reference = () => Promise.resolve({}), beforeAttach = null } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XRWebGLLayer');
  Object.defineProperty(globalThis, 'XRWebGLLayer', { configurable: true, value: class {
    constructor() { this.framebufferWidth = 4096; this.framebufferHeight = 2048; }
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'XRWebGLLayer', previous); else delete globalThis.XRWebGLLayer; });
  let width = 1280, height = 720, ratio = 2, compatible = false, gpuCalls = 0;
  const context = { getContextAttributes: () => ({ xrCompatible: compatible, antialias: false, depth: false, stencil: false }),
    isContextLost: () => false, makeXRCompatible() { gpuCalls++; compatible = true; return gpuCalls === 1 ? Promise.resolve() : new Promise(() => {}); } };
  const originalGpu = context.makeXRCompatible;
  const renderer = { domElement: new EventTarget(), getContext: () => context,
    outputColorSpace: THREE.SRGBColorSpace, info: { render: { frame: 0 } },
    getRenderTarget: () => null, setRenderTarget() {}, getPixelRatio: () => ratio, getSize: target => target.set(width, height),
    setPixelRatio(value) { ratio = value; this.setSize(width, height, false); },
    setSize(w, h) { if (!this.xr?.isPresenting) { width = w; height = h; } } };
  const manager = renderer.xr = new WebXRManager(renderer, context), attach = manager.setSession;
  manager.setSession = async session => { await beforeAttach?.(session); return attach.call(manager, session); };
  class NativeSession extends THREE.EventDispatcher {
    constructor() { super(); this.renderState = {}; this.enabledFeatures = []; this.visibilityState = 'visible'; this.endCalls = 0; this.references = []; }
    updateRenderState(value) { Object.assign(this.renderState, value); }
    requestReferenceSpace(type) { assert.equal(this instanceof NativeSession, true); this.references.push(type); return reference(type, this); }
    requestAnimationFrame() { return 1; }
    cancelAnimationFrame() {}
    end() { this.endCalls++; this.dispatchEvent({ type: 'end' }); return Promise.resolve(); }
  }
  return { renderer, manager, context, originalGpu, NativeSession, dimensions: () => [width, height, ratio], get gpuCalls() { return gpuCalls; } };
}

test('the pinned manager uses preflight reference space and completed GPU work without repeating a stalled native call', async t => {
  const reference = {}, n = nativeManager(t, { reference: type => Promise.resolve(type === 'local-floor' ? reference : {}),
    async beforeAttach(session) {
      assert.deepEqual(session.references, ['local-floor'], 'tracking completes before the manager can own the session');
      await session.requestReferenceSpace('viewer');
    } });
  const session = new n.NativeSession(), nativeReference = session.requestReferenceSpace;
  Object.defineProperty(n.context, 'makeXRCompatible', { configurable: true, enumerable: false, writable: false, value: n.originalGpu });
  const gpuDescriptor = Object.getOwnPropertyDescriptor(n.context, 'makeXRCompatible');
  const e = environment(t, { renderer: n.renderer, request: () => session });
  await e.start(); assert.equal(n.manager.isPresenting, true); assert.equal(n.manager.getReferenceSpace(), reference);
  assert.equal(n.gpuCalls, 1, 'Three must not repeat a completed GPU switch using its cached false attribute');
  assert.deepEqual(session.references, ['local-floor', 'viewer'], 'other reference types retain their native receiver');
  assert.equal(Object.hasOwn(session, 'requestReferenceSpace'), false); assert.equal(session.requestReferenceSpace, nativeReference);
  assert.equal(n.context.makeXRCompatible, n.originalGpu, 'the temporary GPU method is restored after attach');
  assert.deepEqual(Object.getOwnPropertyDescriptor(n.context, 'makeXRCompatible'), gpuDescriptor);
  e.button.click(); await flush(); assert.deepEqual(n.dimensions(), [1280, 720, 2]);
});

test('a tracking timeout ends the grant before pinned-manager attachment and ignores its late reference result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tracking = deferred(), n = nativeManager(t, { reference: () => tracking.promise }), session = new n.NativeSession();
  const e = environment(t, { renderer: n.renderer, request: () => session, reset: async () => false });
  await e.start(); assert.equal(e.statuses.at(-1).stage, 'reference-space'); assert.equal(n.manager.getSession(), null);
  t.mock.timers.tick(12000); await flush();
  assert.equal(session.endCalls, 1); assert.equal(n.manager.getSession(), null); assert.equal(n.manager.isPresenting, false);
  assert.deepEqual(n.dimensions(), [1280, 720, 2]); assert.equal(e.button.textContent, 'ENTER VR');
  assert.equal(e.resets, 1, 'a failed granted start retains the existing bounded runtime recovery');
  tracking.resolve({}); await flush(); assert.equal(n.manager.getSession(), null);
});

test('non-writable native reference methods fail cleanly before attaching rather than risk an uncancellable manager await', async t => {
  const session = new Session();
  const original = () => Promise.resolve({});
  Object.defineProperty(session, 'requestReferenceSpace', { configurable: false, writable: false, value: original });
  const e = environment(t, { request: () => session }); await e.start();
  assert.equal(e.attached.length, 0); assert.equal(session.endCalls, 1); assert.equal(session.requestReferenceSpace, original);
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.statuses.at(-1).stage, 'failed');
});

test('an uncacheable native GPU method restores the prepared session method and closes the unattached grant', async t => {
  const session = new Session(), reference = () => Promise.resolve({}); session.requestReferenceSpace = reference;
  const gpu = () => Promise.resolve(), context = { getContextAttributes: () => ({ xrCompatible: false }), isContextLost: () => false };
  Object.defineProperty(context, 'makeXRCompatible', { configurable: false, writable: false, value: gpu });
  const e = environment(t, { request: () => session, context }); await e.start();
  assert.equal(e.attached.length, 0); assert.equal(session.endCalls, 1);
  assert.equal(session.requestReferenceSpace, reference); assert.equal(context.makeXRCompatible, gpu);
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.statuses.at(-1).stage, 'failed');
});

test('a failed manager attachment restores the exact own native method descriptors', async t => {
  const session = new Session(), reference = () => Promise.resolve({}), gpu = () => Promise.resolve();
  Object.defineProperty(session, 'requestReferenceSpace', { configurable: true, enumerable: false, writable: false, value: reference });
  const context = { getContextAttributes: () => ({ xrCompatible: false }), isContextLost: () => false };
  Object.defineProperty(context, 'makeXRCompatible', { configurable: true, enumerable: true, writable: false, value: gpu });
  const descriptors = [Object.getOwnPropertyDescriptor(session, 'requestReferenceSpace'), Object.getOwnPropertyDescriptor(context, 'makeXRCompatible')];
  const e = environment(t, { request: () => session, context, attach: async () => { throw new Error('Synthetic layer failure'); } });
  await e.start();
  assert.equal(session.endCalls, 1); assert.equal(e.button.textContent, 'ENTER VR');
  assert.deepEqual(Object.getOwnPropertyDescriptor(session, 'requestReferenceSpace'), descriptors[0]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(context, 'makeXRCompatible'), descriptors[1]);
});

test('a sustained graphics context loss fails preflight before manager attachment and permits a restored-context retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let lost = true;
  const context = { getContextAttributes: () => ({ xrCompatible: false }), isContextLost: () => lost, makeXRCompatible: () => Promise.resolve() };
  const original = context.makeXRCompatible, e = environment(t, { context, reset: async () => false });
  await e.start(); assert.equal(e.statuses.at(-1).stage, 'graphics');
  t.mock.timers.tick(10000); await flush();
  assert.equal(e.attached.length, 0); assert.equal(e.requests[0].endCalls, 1); assert.equal(e.resets, 1);
  assert.equal(context.makeXRCompatible, original); assert.equal(e.button.textContent, 'ENTER VR');
  lost = false; const fresh = await e.start(); assert.equal(e.attached.length, 1); assert.equal(e.xr.getSession(), fresh);
  e.button.click(); await flush();
});

test('an already-compatible flag cannot bypass a currently lost graphics context', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = { getContextAttributes: () => ({ xrCompatible: true }), isContextLost: () => true,
    makeXRCompatible: () => Promise.reject(new Error('Context is lost')) };
  const e = environment(t, { context }); await e.start();
  assert.equal(e.attached.length, 0); assert.equal(e.statuses.at(-1).stage, 'graphics');
  t.mock.timers.tick(10000); await flush();
  assert.equal(e.attached.length, 0); assert.equal(e.requests[0].endCalls, 1); assert.equal(e.button.textContent, 'ENTER VR');
});

test('tracking without a viewer pose reports its stage and supports cancellation without treating a hidden dashboard as failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = environment(t, { waitForPose: true, reset: async () => false }), session = await e.start();
  assert.equal(e.statuses.at(-1).stage, 'viewer-pose'); session.visibility('hidden');
  t.mock.timers.tick(12000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'viewer-pose-slow'); assert.equal(session.endCalls, 0); assert.equal(e.resets, 0);
  e.button.notifyPose(new Session()); assert.equal(e.statuses.at(-1).stage, 'viewer-pose-slow', 'a stale session pose cannot complete the current start');
  e.button.notifyPose(session); assert.equal(e.statuses.at(-1).stage, 'ready');
  e.button.click(); await flush(); assert.equal(e.resets, 0);
  const next = await e.start(); e.button.cancelStartup(); await flush();
  assert.equal(next.endCalls, 1); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 0);
});

test('a native end promise that never resolves permits retry only for its owned session and cannot start a competing one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = environment(t), session = await e.start(); session.endBehavior = () => new Promise(() => {});
  e.button.click(); await flush(); t.mock.timers.tick(8000); await flush();
  assert.equal(e.button.textContent, 'EXIT VR'); assert.equal(e.button.disabled, false);
  assert.equal(e.statuses.at(-1).stage, 'ending-slow'); assert.equal(e.requests.length, 1); assert.equal(e.xr.getSession(), session);
  session.endBehavior = null; e.button.click(); await flush();
  assert.equal(session.endCalls, 2); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.xr.getSession(), null);
});

test('late tracking and its watchdog cannot erase an exit already requested during startup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = environment(t, { waitForPose: true }), session = await e.start();
  session.endBehavior = () => new Promise(() => {});
  e.button.click(); await flush();
  e.button.notifyPose(session); assert.equal(e.statuses.at(-1).stage, 'ending');
  t.mock.timers.tick(8000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'ending-slow');
  t.mock.timers.tick(4000); await flush(); e.button.notifyPose(session);
  assert.equal(e.statuses.at(-1).stage, 'ending-slow');
  assert.equal(e.requests.length, 1); assert.equal(e.xr.getSession(), session);
  session.endBehavior = null; e.button.click(); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
});

test('a hung initial support query times out to a usable retry and cannot overwrite its later successful check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const query = deferred(); let calls = 0;
  const e = environment(t, { support: () => ++calls === 1 ? query.promise : Promise.resolve(true) });
  await flush(); assert.equal(e.button.textContent, 'CHECKING VR...'); assert.equal(e.statuses.at(-1).stage, 'checking');
  t.mock.timers.tick(8000); await flush();
  assert.equal(e.button.textContent, 'CHECK VR AGAIN'); assert.equal(e.button.disabled, false);
  assert.equal(e.statuses.at(-1).stage, 'check-failed'); assert.equal(e.requests.length, 0);
  e.button.click(); await flush(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(calls, 2);
  query.resolve(false); await flush(); assert.equal(e.button.textContent, 'ENTER VR', 'late unsupported result cannot replace the fresh ready result');
  await e.start(); assert.equal(e.button.textContent, 'EXIT VR'); e.button.click(); await flush();
});

test('a hung recovery support query respects the total fifteen-second deadline and its late result cannot affect a new live session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const query = deferred(); let calls = 0, failAttach = true;
  const e = environment(t, { support: () => ++calls === 2 ? query.promise : Promise.resolve(true), reset: async () => true,
    attach: async (_session, xr) => { if (failAttach) throw new Error('Synthetic attachment failure'); xr.isPresenting = true; } });
  await e.start(); assert.equal(e.resets, 1); assert.equal(e.button.disabled, true); assert.equal(calls, 1);
  t.mock.timers.tick(400); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(14600); await flush();
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.button.disabled, false); assert.equal(calls, 3);
  assert.equal(e.restores, 1); failAttach = false; const session = await e.start();
  assert.equal(e.button.textContent, 'EXIT VR'); query.resolve(false); await flush();
  assert.equal(e.xr.getSession(), session); assert.equal(e.button.textContent, 'EXIT VR');
  e.button.click(); await flush(); assert.equal(e.resets, 1, 'healthy exit must not reset after recovery query timed out');
});

test('ninety-second permission stall keeps native ownership and offers only explicit recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), e = environment(t, { request: () => grant.promise, reset: async () => false });
  await e.start(); t.mock.timers.tick(20000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'permission-slow'); assert.equal(e.statuses.at(-1).canRecover, false);
  t.mock.timers.tick(70000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'permission-stalled'); assert.equal(e.statuses.at(-1).canRecover, true);
  assert.equal(e.button.textContent.includes('ENTER VR'), false); assert.equal(e.resets, 0);
  e.button.click(); e.platform.dispatchEvent(new Event('devicechange')); await flush(); assert.equal(e.requests.length, 1);
  grant.reject(new DOMException('Native request ended', 'AbortError')); await flush();
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 0, 'a rejected permission request needs no automatic runtime stop');
});

test('manual recovery after cancelling permission keeps its late grant owned until both native end and reset settlement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), reset = deferred(), late = new Session(); late.endBehavior = () => new Promise(() => {});
  const e = environment(t, { request: () => grant.promise, reset: () => reset.promise });
  await e.start(); e.button.cancelStartup(); assert.equal(e.statuses.at(-1).canRecover, true);
  assert.equal(e.button.recoverConnection(), true); assert.equal(e.button.recoverConnection(), false); await flush();
  assert.equal(e.resets, 1); grant.resolve(late); await flush();
  assert.equal(late.endCalls, 1); assert.equal(e.attached.length, 0);
  t.mock.timers.tick(8000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'recovering'); assert.equal(e.button.disabled, true);
  late.emitEnd(); await flush(); assert.notEqual(e.button.textContent, 'ENTER VR');
  e.button.click(); assert.equal(e.requests.length, 1);
  reset.resolve(false); await flush(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 1);
});

test('failed recovery cannot free a cancelled native permission request before its actual rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const grant = deferred(), e = environment(t, { request: () => grant.promise, reset: async () => false });
  await e.start(); e.button.cancelStartup(); e.button.recoverConnection(); await flush();
  assert.equal(e.statuses.at(-1).stage, 'recovery-stalled'); assert.equal(e.statuses.at(-1).needsReload, true);
  assert.equal(e.statuses.at(-1).canRecover, false); assert.notEqual(e.button.textContent, 'ENTER VR');
  e.button.click(); assert.equal(e.requests.length, 1); assert.equal(e.resets, 1);
  grant.reject(new DOMException('Runtime disconnected', 'AbortError')); await flush();
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 1);
});

test('explicit stuck-exit recovery preserves pinned Three cleanup and cannot unlock a new session while reset is pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reset = deferred(), n = nativeManager(t), session = new n.NativeSession();
  const e = environment(t, { renderer: n.renderer, request: () => session, reset: () => reset.promise });
  await e.start(); session.end = function () { this.endCalls++; return new Promise(() => {}); };
  e.button.click(); t.mock.timers.tick(8000); await flush();
  assert.equal(e.statuses.at(-1).canRecover, true); assert.equal(e.button.recoverConnection(), true);
  assert.equal(e.button.recoverConnection(), false); await flush(); assert.equal(e.resets, 1);
  session.dispatchEvent({ type: 'end' }); await flush();
  assert.equal(n.manager.isPresenting, false); assert.equal(n.manager.getSession(), null);
  assert.deepEqual(n.dimensions(), [1280, 720, 2], 'the native manager, not a fabricated end, restores its framebuffer and DPR');
  assert.notEqual(e.button.textContent, 'ENTER VR'); assert.equal(e.button.disabled, true);
  e.button.click(); assert.equal(e.requests.length, 1);
  reset.resolve(true); await flush(); t.mock.timers.tick(400); await flush();
  assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 1);
});

test('failed or rejected explicit exit recovery retains the live session instead of fabricating cleanup', async t => {
  for (const throws of [false, true]) await t.test(throws ? 'rejected operation' : 'no process ended', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const e = environment(t, { reset: async () => { if (throws) throw new Error('Reset unavailable'); return false; } });
    const session = await e.start(); session.endBehavior = () => new Promise(() => {});
    e.button.click(); t.mock.timers.tick(8000); await flush(); e.button.recoverConnection(); await flush();
    assert.equal(e.statuses.at(-1).stage, 'recovery-stalled'); assert.equal(e.statuses.at(-1).needsReload, true);
    assert.equal(e.xr.getSession(), session); assert.equal(e.xr.isPresenting, true); assert.equal(e.restores, 0);
    assert.equal(e.button.recoverConnection(), false); e.button.click(); assert.equal(e.requests.length, 1); assert.equal(e.resets, 1);
    session.emitEnd(); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
  });
});

test('reset timeout retains ownership even after native end until its late operation truly settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reset = deferred(), e = environment(t, { reset: () => reset.promise }), session = await e.start();
  session.endBehavior = () => new Promise(() => {}); e.button.click(); t.mock.timers.tick(8000); await flush();
  e.button.recoverConnection(); await flush(); t.mock.timers.tick(10000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'recovery-stalled'); assert.equal(e.statuses.at(-1).canRecover, false);
  session.emitEnd(); await flush(); assert.equal(e.xr.isPresenting, false); assert.notEqual(e.button.textContent, 'ENTER VR');
  assert.equal(e.statuses.at(-1).stage, 'recovery-stalled'); e.button.click(); assert.equal(e.requests.length, 1);
  reset.resolve(false); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
  const fresh = await e.start(); session.emitEnd(); session.visibility('hidden'); await flush();
  assert.equal(e.xr.getSession(), fresh); assert.equal(e.resets, 1); e.button.click(); await flush();
});

test('a positive reset result without native end remains blocked and later real cleanup alone permits reentry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = environment(t, { reset: async () => true }), session = await e.start();
  session.endBehavior = () => new Promise(() => {}); e.button.click(); t.mock.timers.tick(8000); await flush();
  e.button.recoverConnection(); await flush(); assert.notEqual(e.button.textContent, 'ENTER VR');
  t.mock.timers.tick(10000); await flush(); assert.equal(e.statuses.at(-1).stage, 'recovery-stalled');
  assert.equal(e.xr.isPresenting, true); assert.equal(e.xr.getSession(), session); assert.equal(e.restores, 0);
  session.emitEnd(); await flush(); t.mock.timers.tick(400); await flush(); assert.equal(e.button.textContent, 'ENTER VR');
});

test('healthy hidden sessions and unknown Three attachments never authorize runtime recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attachment = deferred(); let block = false;
  const e = environment(t, { reset: async () => false, attach: async (_session, xr) => { if (block) await attachment.promise; xr.isPresenting = true; } });
  const session = await e.start(); session.visibility('hidden');
  assert.equal(e.button.recoverConnection(), false); assert.equal(e.resets, 0);
  e.button.click(); await flush(); block = true; await e.start();
  assert.equal(e.button.recoverConnection(), false); e.button.cancelStartup();
  t.mock.timers.tick(20000); await flush();
  assert.equal(e.statuses.at(-1).stage, 'attachment-stalled'); assert.equal(e.statuses.at(-1).canRecover, false);
  assert.equal(e.button.recoverConnection(), false); assert.equal(e.resets, 0);
  attachment.resolve(); await flush(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 0);
});

test('manual recovery of a failed granted start is not repeated by its automatic ended-start recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reset = deferred(), session = new Session(); session.endBehavior = () => new Promise(() => {});
  const e = environment(t, { request: () => session, reset: () => reset.promise, attach: async () => { throw new Error('Attachment failed'); } });
  await e.start(); t.mock.timers.tick(8000); await flush(); assert.equal(e.button.recoverConnection(), true); await flush();
  session.emitEnd(); await flush(); assert.equal(e.restores, 1); assert.notEqual(e.button.textContent, 'ENTER VR');
  reset.resolve(false); await flush(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.resets, 1);
});

test('a synchronous native permission rejection clears pending ownership and permits an intentional retry', async t => {
  let calls = 0;
  const e = environment(t, { reset: async () => false, request: () => {
    if (++calls === 1) throw new DOMException('Permission denied', 'NotAllowedError'); return new Session();
  } });
  await e.start(); assert.equal(e.button.textContent, 'ENTER VR'); assert.equal(e.statuses.at(-1).stage, 'failed');
  assert.equal(e.button.recoverConnection(), false); assert.equal(e.resets, 0); assert.equal(e.restores, 1);
  const session = await e.start(); assert.equal(calls, 2); assert.equal(e.xr.getSession(), session);
  e.button.click(); await flush();
});
