import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Spectator } from '../src/vr/spectator.js';
import { G } from '../src/core/globals.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function environment(t, options = {}) {
  const previous = { ...G }, idle = [], classes = new Set(), calls = [], listeners = {};
  t.after(() => Object.assign(G, previous));
  for (const [key, value] of Object.entries({
    document: { createElement: () => ({}), body: { appendChild() {}, classList: { add: value => classes.add(value), remove: value => classes.delete(value) } } },
    requestIdleCallback: callback => { idle.push(callback); return idle.length; },
    addEventListener: (name, callback) => { listeners[name] = callback; }, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  t.mock.method(console, 'warn', () => {});
  G.settings = { spectator: true, spectatorFov: 80, spectatorSmooth: 0, spectatorLevel: false };
  const scene = new THREE.Scene(), rig = new THREE.Group(), head = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  rig.add(head); scene.add(rig); head.position.set(1, 1.7, 2); scene.updateMatrixWorld(true);
  G.three = { camera: head };
  const world = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  world.name = 'world'; scene.add(world);
  const hidden = world.clone(); hidden.name = 'hidden'; hidden.visible = false; scene.add(hidden);
  const main = { xr: { isPresenting: false }, toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.2, outputColorSpace: THREE.SRGBColorSpace };
  let creates = 0;
  const renderer = {
    setPixelRatio(value) { calls.push(['ratio', value]); }, setSize(...value) { calls.push(['size', ...value]); },
    compileAsync(...args) { calls.push(['compile', ...args]); return options.compile ? options.compile() : Promise.resolve(); },
    render(_scene, camera) { calls.push(['render', camera.position.clone(), camera.quaternion.clone(), camera.fov, world.frustumCulled, hidden.frustumCulled]);
      options.render?.(); },
  };
  class TestSpectator extends Spectator {
    createRenderer() { creates++; calls.push(['create']); if (options.create) options.create(); return renderer; }
  }
  const spectator = new TestSpectator(main, scene);
  return { spectator, scene, main, head, world, hidden, classes, calls, renderer, idle,
    get creates() { return creates; }, count: kind => calls.filter(call => call[0] === kind).length,
    async idleStep() { assert.ok(idle.length, 'an idle preparation step should be pending'); idle.shift()(); await flush(); },
    resize() { listeners.resize(); },
  };
}

test('PC preparation warms shaders and all visible geometry before ENTER VR, reusing the context across sessions', async t => {
  const e = environment(t), prepared = e.spectator.prepare();
  assert.equal(e.creates, 0, 'prepare must yield before allocating the second context');
  await e.idleStep(); assert.equal(e.creates, 1); assert.equal(e.count('compile'), 1); assert.equal(e.count('render'), 0);
  await e.idleStep(); assert.equal(await prepared, true); assert.equal(e.count('render'), 1);
  assert.equal(e.spectator.active, false); assert.equal(e.classes.has('spectating'), false);
  const warm = e.calls.find(call => call[0] === 'render');
  assert.equal(warm[4], false, 'offscreen visible geometry is included in the hidden warm draw');
  assert.equal(warm[5], true, 'intentionally hidden objects retain their culling flags');
  assert.equal(e.world.frustumCulled, true); assert.equal(e.hidden.visible, false);
  const allocations = e.calls.length;
  e.main.xr.isPresenting = true; e.spectator.start();
  assert.equal(e.calls.length, allocations, 'sessionstart must not create, compile, render or resize a prepared context');
  assert.equal(e.classes.has('spectating'), true);
  e.spectator.render(); assert.equal(e.count('render'), 2);
  e.spectator.render(); assert.equal(e.count('render'), 2, 'monitor retains its alternate-frame cadence');
  e.spectator.stop(); e.main.xr.isPresenting = false;
  e.main.xr.isPresenting = true; e.spectator.start(); e.spectator.render();
  assert.equal(e.creates, 1); assert.equal(e.count('compile'), 1); assert.equal(e.count('render'), 3);
});

test('unprepared startup and the first headset frame never create a context or block on shader preparation', async t => {
  const compile = deferred(), e = environment(t, { compile: () => compile.promise });
  e.main.xr.isPresenting = true; e.spectator.start();
  assert.equal(e.creates, 0); assert.equal(e.spectator.active, false);
  e.calls.push(['headset draw']); e.spectator.render();
  assert.deepEqual(e.calls, [['headset draw']]); assert.equal(e.classes.has('spectating'), false);
  await e.idleStep(); assert.equal(e.creates, 1); assert.equal(e.count('compile'), 1);
  e.spectator.render(); assert.equal(e.count('render'), 0); assert.equal(e.classes.has('spectating'), false);
  compile.resolve(); await flush(); await e.idleStep();
  assert.equal(e.spectator.active, true); assert.equal(e.classes.has('spectating'), true);
  assert.equal(e.count('render'), 1);
});

test('a newer map preparation invalidates pending scene work without exposing an obsolete warm view', async t => {
  const first = deferred(), second = deferred(); let compilation = 0;
  const e = environment(t, { compile: () => (++compilation === 1 ? first : second).promise });
  const prepared = e.spectator.prepare(); await e.idleStep();
  const shared = e.spectator.prepare(); assert.equal(shared, prepared);
  first.resolve(); await flush(); assert.equal(e.count('render'), 0);
  await e.idleStep(); assert.equal(e.count('compile'), 2); assert.equal(e.creates, 1);
  second.resolve(); await flush(); await e.idleStep();
  assert.equal(await prepared, true); assert.equal(e.count('render'), 1);
});

test('stop during preparation does not reopen the monitor and disabled spectator allocates nothing', async t => {
  const e = environment(t); G.settings.spectator = false;
  assert.equal(await e.spectator.prepare(), false); e.main.xr.isPresenting = true; e.spectator.start(); e.spectator.render();
  assert.equal(e.creates, 0); assert.equal(e.idle.length, 0);
  G.settings.spectator = true; e.spectator.start(); const preparation = e.spectator.prepare();
  await e.idleStep(); e.spectator.stop(); await e.idleStep(); await preparation;
  assert.equal(e.spectator.ready, true); assert.equal(e.spectator.active, false); assert.equal(e.classes.has('spectating'), false);
});

test('a failed warm draw restores original culling and stays off the headset draw path until retry', async t => {
  let failure = true;
  const e = environment(t, { render: () => { if (failure) throw new Error('monitor context unavailable'); } });
  e.main.xr.isPresenting = true; e.spectator.start(); e.spectator.render();
  const preparation = e.spectator.preparing; await e.idleStep(); await e.idleStep();
  assert.equal(await preparation, false); assert.equal(e.world.frustumCulled, true);
  assert.equal(e.spectator.active, false); assert.equal(e.classes.has('spectating'), false);
  e.spectator.render(); assert.equal(e.idle.length, 0, 'a failing monitor must not retry GPU work on every headset frame');
  failure = false; e.spectator.stop(); e.spectator.start(); e.spectator.render();
  await e.idleStep(); await e.idleStep(); assert.equal(e.spectator.ready, true); assert.equal(e.creates, 1);
});

test('prepared monitor preserves its independent FOV, head leveling, smoothing, viewport and renderer settings', async t => {
  const e = environment(t); G.settings.spectatorFov = 100; G.settings.spectatorLevel = true;
  e.head.rotation.set(0.1, 0.2, 0.6, 'YXZ'); e.scene.updateMatrixWorld(true);
  const prepared = e.spectator.prepare(); await e.idleStep(); await e.idleStep(); await prepared;
  e.main.xr.isPresenting = true; e.spectator.start(); e.spectator.render();
  assert.equal(e.spectator.cam.fov, 100); assert.equal(e.head.fov, 75);
  const rotation = new THREE.Euler().setFromQuaternion(e.spectator.cam.quaternion, 'YXZ');
  assert.ok(Math.abs(rotation.z) < 1e-10);
  assert.equal(e.renderer.toneMapping, e.main.toneMapping); assert.equal(e.renderer.toneMappingExposure, 1.2);
  assert.equal(e.renderer.outputColorSpace, THREE.SRGBColorSpace);
  globalThis.innerWidth = 800; globalThis.innerHeight = 1000; e.resize();
  assert.equal(e.spectator.cam.aspect, 0.8); assert.deepEqual(e.calls.findLast(call => call[0] === 'size'), ['size', 800, 1000, false]);
  G.settings.spectatorSmooth = 3; const before = e.spectator.cam.position.clone();
  e.head.position.x += 10; e.scene.updateMatrixWorld(true); e.spectator.render(); e.spectator.render();
  assert.ok(e.spectator.cam.position.x > before.x); assert.ok(e.spectator.cam.position.x < before.x + 10);
});
