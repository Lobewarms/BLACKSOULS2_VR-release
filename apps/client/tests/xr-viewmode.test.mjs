import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebXRManager } from 'three/src/renderers/webxr/WebXRManager.js';
import { ViewMode } from '../src/vr/viewmode.js';
import { G } from '../src/core/globals.js';
import { T } from '../src/world/mapmesh.js';

const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
function fixture(t) {
  const saved = { ...G }, layer = Object.getOwnPropertyDescriptor(globalThis, 'XRWebGLLayer');
  t.after(() => {
    Object.assign(G, saved);
    if (layer) Object.defineProperty(globalThis, 'XRWebGLLayer', layer); else delete globalThis.XRWebGLLayer;
  });
  Object.defineProperty(globalThis, 'XRWebGLLayer', { configurable: true, value: class {
    constructor() { this.framebufferWidth = 4096; this.framebufferHeight = 2048; this.framebuffer = {}; }
    getViewport(view) { return { x: view.eye === 'left' ? 0 : 2048, y: 0, width: 2048, height: 2048 }; }
  } });
  const viewport = { width: 1280, height: 720, pixelRatio: 2 }, calls = [], style = {}, context = { gameplay: true };
  let width = viewport.width, height = viewport.height, ratio = viewport.pixelRatio, target = null;
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    getRenderTarget: () => target, setRenderTarget(value) { target = value; }, setRenderTargetFramebuffer() {},
    getPixelRatio: () => ratio, getSize: value => value.set(width, height),
    setPixelRatio(value) { ratio = value; this.setSize(width, height, false); },
    setSize(w, h, css = true) {
      calls.push(['size', w, h, this.xr?.isPresenting]);
      if (this.xr?.isPresenting) return;
      width = w; height = h;
      if (css) { style.width = `${w}px`; style.height = `${h}px`; }
    },
    setViewport(...values) { this.viewport = values; },
    setScissor(...values) { this.scissor = values; },
    setScissorTest(value) { this.scissorTest = value; },
  };
  const manager = renderer.xr = new WebXRManager(renderer, {
    getContextAttributes: () => ({ xrCompatible: true, antialias: false, depth: false, stencil: false }),
  });
  class Session extends THREE.EventDispatcher {
    constructor() { super(); this.renderState = {}; this.enabledFeatures = []; this.inputSources = []; }
    updateRenderState(value) { Object.assign(this.renderState, value); }
    requestReferenceSpace() { return Promise.resolve({}); }
    requestAnimationFrame(callback) { this.nextFrame = callback; return 1; }
    cancelAnimationFrame() {}
    end() { this.dispatchEvent({ type: 'end' }); }
    frame({ position = new THREE.Vector3(0.4, 1.7, -0.2), yaw = 0.35, pitch = 0.1, roll = 0.04, missing = false } = {}) {
      const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      const eye = new THREE.PerspectiveCamera(110, 1, 0.08, 300);
      const views = [-0.032, 0.032].map((x, i) => ({ eye: i ? 'right' : 'left',
        transform: { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0).applyQuaternion(orientation).add(position), orientation, new THREE.Vector3(1, 1, 1)).elements },
        projectionMatrix: eye.projectionMatrix.elements,
      }));
      this.nextFrame(16, { getViewerPose: () => missing ? null : { views } });
    }
  }
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, width / height, 0.08, 300);
  rig.position.set(3.75, 4.2, 5.25); camera.position.y = 1.6; camera.rotation.set(0.2, 0.8, 0, 'YXZ'); rig.add(camera);
  const scene = new THREE.Scene(); scene.add(rig); scene.updateMatrixWorld(true);
  const transitions = [], ui = [], spectator = [];
  Object.assign(G, {
    vr: false, xrAway: false, settings: { ...saved.settings, eyeHeight: 1.6 },
    player: { yaw: 0.8, pitch: 0.2, jumpY: 4.2, fallV: -0.1, snapReady: false },
    map: { mapId: 1, playerChar: { fx: 2, fy: 3, direction: 8 } },
    input: { transitionViewMode(value) { transitions.push([value, G.vr]); } },
    ui: { transitionViewMode(value) { ui.push(value); }, placeRoot() { ui.push('pose'); } },
    audio: null, combat: { equipKey: 'previous' },
  });
  let releases = 0;
  const mode = new ViewMode(renderer, camera, rig, { viewport: () => viewport, isGameplay: () => context.gameplay,
    spectator: { start() { spectator.push('start'); }, stop() { spectator.push('stop'); } }, releaseTarget() { releases++; } });
  manager.addEventListener('sessionstart', () => mode.enter());
  manager.addEventListener('sessionend', () => mode.restoreDesktop());
  manager.setAnimationLoop((_time, frame) => { mode.beforeFrame(frame); manager.updateCamera(camera); });
  return { camera, rig, mode, manager, renderer, viewport, context, calls, style, transitions, ui, spectator,
    async enter() { const session = new Session(); await manager.setSession(session); return session; },
    get size() { return [width, height, ratio]; }, get releases() { return releases; },
  };
}

test('real Three session end restores the full desktop lens and the current window, after framebuffer cleanup', async t => {
  const e = fixture(t), session = await e.enter();
  session.frame(); assert.notEqual(e.camera.fov, 75);
  assert.ok(Math.abs(e.camera.projectionMatrix.elements[5] / e.camera.projectionMatrix.elements[0] - 1) < 0.001, 'stereo union retains the near-square headset frustum');
  Object.assign(e.viewport, { width: 800, height: 1000, pixelRatio: 1.25 });
  const count = e.calls.length;
  assert.equal(e.mode.fitDesktop(), false); assert.equal(e.mode.restoreDesktop(), false);
  assert.equal(e.calls.length, count, 'raw end must not resize the active XR framebuffer');
  session.end();
  assert.deepEqual(e.size, [800, 1000, 1.25]); assert.deepEqual(e.style, { width: '800px', height: '1000px' });
  assert.deepEqual(e.renderer.viewport, [0, 0, 800, 1000]); assert.deepEqual(e.renderer.scissor, e.renderer.viewport);
  assert.equal(e.renderer.scissorTest, false); assert.equal(e.renderer.getRenderTarget(), null);
  close(e.camera.fov, 75); close(e.camera.aspect, 0.8);
  const expected = new THREE.PerspectiveCamera(75, 0.8, 0.08, 300);
  e.camera.projectionMatrix.elements.forEach((v, i) => close(v, expected.projectionMatrix.elements[i]));
  e.camera.projectionMatrixInverse.elements.forEach((v, i) => close(v, expected.projectionMatrixInverse.elements[i]));
  assert.equal(G.vr, false); assert.equal(e.releases, 1);
  assert.deepEqual(e.transitions, [[true, true], [false, false]]);
});

test('repeated sessions retain custom desktop lens values rather than capturing the last headset projection', async t => {
  const e = fixture(t);
  Object.assign(e.camera, { fov: 68, zoom: 1.1, near: 0.07, far: 250, filmGauge: 40, filmOffset: 0.2, focus: 11 });
  e.camera.setViewOffset(1280, 720, 20, 10, 1240, 700);
  const lens = e.camera.view;
  for (let i = 0; i < 3; i++) {
    const session = await e.enter(); session.frame(); session.end();
    for (const [key, value] of Object.entries({ fov: 68, zoom: 1.1, near: 0.07, far: 250, filmGauge: 40, filmOffset: 0.2, focus: 11 })) close(e.camera[key], value, key);
    assert.deepEqual(e.camera.view, lens); assert.notEqual(e.camera.view, lens);
  }
  assert.deepEqual(e.spectator, ['start', 'stop', 'start', 'stop', 'start', 'stop']);
});

test('first real headset pose preserves the PC facing and map position, then desktop preserves physical movement and look', async t => {
  const e = fixture(t), session = await e.enter();
  session.frame({ missing: true }); assert.equal(e.mode.awaitingPose, true);
  session.frame(); assert.equal(e.mode.awaitingPose, false);
  let p = e.camera.getWorldPosition(new THREE.Vector3()), angles = new THREE.Euler().setFromQuaternion(e.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  close(p.x, (2 + 0.5) * T); close(p.z, (3 + 0.5) * T); close(angles.y, 0.8);
  session.frame({ position: new THREE.Vector3(0.7, 1.6, 0.1), yaw: 0.65, pitch: 0.25, roll: 0.2 });
  p = e.camera.getWorldPosition(new THREE.Vector3()); angles.setFromQuaternion(e.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  const floor = e.rig.position.y;
  session.end();
  const restored = e.camera.getWorldPosition(new THREE.Vector3());
  close(restored.x, p.x); close(restored.z, p.z); close(restored.y, floor + 1.6);
  close(G.player.yaw, angles.y); close(G.player.pitch, angles.x); close(e.camera.rotation.z, 0);
  close(e.rig.rotation.y, 0); close(e.rig.position.y, 4.2);
  assert.equal(G.player.jumpY, 4.2); assert.equal(G.player.fallV, -0.1); assert.equal(G.player.snapReady, true);
});

test('an immediate exit without tracking retains PC look and never schedules a later recenter', async t => {
  const e = fixture(t), session = await e.enter();
  session.frame({ missing: true }); session.end();
  close(G.player.yaw, 0.8); close(G.player.pitch, 0.2);
  close(e.rig.position.x, 3.75); close(e.rig.position.z, 5.25);
  assert.equal(e.mode.beforeFrame({ getViewerPose: () => { throw new Error('ended frame must be ignored'); } }), false);
  assert.equal(e.mode.active, false); assert.equal(e.mode.awaitingPose, false);
});

test('a map change while awaiting tracking uses the current map character and direction', async t => {
  const e = fixture(t), session = await e.enter();
  G.map.mapId = 2; G.map.playerChar = { fx: 8, fy: 9, direction: 6 };
  session.frame();
  const p = e.camera.getWorldPosition(new THREE.Vector3()), angles = new THREE.Euler().setFromQuaternion(e.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  close(p.x, 8.5 * T); close(p.z, 9.5 * T); close(angles.y, -Math.PI / 2);
  session.end(); close(G.player.yaw, -Math.PI / 2);
  const next = await e.enter();
  G.map = { mapId: 3, playerChar: { fx: 11, fy: 12, direction: 4 } }; next.end();
  close(G.player.yaw, Math.PI / 2); close(e.rig.position.x, 11.5 * T); close(e.rig.position.z, 12.5 * T);
});

test('a failed start repairs partial size and projection changes without resetting gameplay or input', t => {
  const e = fixture(t), position = e.rig.position.clone(), player = { ...G.player };
  e.camera.fov = 110; e.camera.zoom = 1; e.camera.aspect = 1; e.camera.updateProjectionMatrix();
  e.renderer.setSize(4096, 2048); e.renderer.setPixelRatio(1);
  Object.assign(e.viewport, { width: 1600, height: 900, pixelRatio: 3 });
  assert.equal(e.mode.restoreDesktop(), true);
  close(e.camera.fov, 75); close(e.camera.aspect, 16 / 9); assert.deepEqual(e.size, [1600, 900, 2]);
  assert.deepEqual(e.rig.position, position); assert.deepEqual(G.player, player); assert.deepEqual(e.transitions, []);
});

test('title entry with no map retains its world location and current desktop resize keeps the chosen lens', async t => {
  const e = fixture(t); G.map = null; e.context.gameplay = false;
  const position = e.camera.getWorldPosition(new THREE.Vector3());
  e.camera.fov = 82; e.mode.fitDesktop(); close(e.camera.fov, 82);
  const session = await e.enter(); session.end();
  const after = e.camera.getWorldPosition(new THREE.Vector3()); close(after.x, position.x); close(after.z, position.z); close(e.camera.fov, 82);
});

test('title entry after returning from gameplay ignores the retained old map character', async t => {
  const e = fixture(t); e.context.gameplay = false;
  e.rig.position.set(0, 0, 0); G.map.playerChar = { fx: 90, fy: 70, direction: 2 };
  const session = await e.enter(); session.frame();
  const head = e.camera.getWorldPosition(new THREE.Vector3());
  close(head.x, 0); close(head.z, 0);
  session.end();
  const again = await e.enter(); again.end();
  close(e.rig.position.x, head.x); close(e.rig.position.z, head.z);
});
