// PC-monitor view while the headset is on. WebXR draws only into the headset, so the page itself shows
// nothing to the people around you. A second renderer draws the same scene from the player's head into a
// canvas covering the page. Horizon leveling, shake smoothing and the field of view are the player's
// settings (menu); by default it is the plain head view. Every other headset frame is enough for watching.
import * as THREE from 'three';
import { G } from '../core/globals.js';

const idle = () => new Promise(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 1000 });
  else setTimeout(resolve, 0);
});

export class Spectator {
  constructor(main, scene) {
    this.main = main;
    this.scene = scene;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'spectator';
    document.body.appendChild(this.canvas);
    this.cam = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 400);
    this.renderer = null;
    this.active = false;
    this.wanted = false;
    this.ready = false;
    this.failed = false;
    this.deferred = false;
    this.revision = 0;
    this.preparing = null;
    this.n = 0;
    this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.fresh = true;
    addEventListener('resize', () => this.resize());
  }
  start() {
    if (G.settings.spectator === false) return;
    this.wanted = true;
    this.failed = false;
    this.fresh = true;
    if (!this.ready) this.deferred = true;
    // sessionstart runs on the headset's startup path. Context creation,
    // shader compilation and uploads belong to prepare's idle work instead.
    if (this.ready) this.activate();
  }
  activate() {
    if (!this.wanted || !this.ready || !this.main.xr.isPresenting || G.settings.spectator === false) return;
    this.active = true;
    document.body.classList.add('spectating');
    this.resize();
  }
  stop() {
    this.wanted = false;
    this.active = false;
    document.body.classList.remove('spectating');
  }
  createRenderer() {
    return new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
  }
  prepare() {
    if (G.settings.spectator === false) return Promise.resolve(false);
    this.revision++;
    this.ready = false;
    this.failed = false;
    if (this.main.xr.isPresenting) return Promise.resolve(this.deferPreparation());
    this.deferred = false;
    if (!this.preparing) {
      this.preparing = this.prepareLatest().finally(() => { this.preparing = null; });
    }
    return this.preparing;
  }
  deferPreparation() {
    this.deferred = true;
    this.ready = false;
    this.active = false;
    document.body.classList.remove('spectating');
    return false;
  }
  resumePreparation() {
    if (G.settings.spectator === false || this.main.xr.isPresenting) return Promise.resolve(false);
    if (this.ready) return Promise.resolve(true);
    if (!this.deferred) return Promise.resolve(false);
    // An already-started compile cannot be cancelled. Its next checkpoint
    // settles before desktop work resumes; no idle polling runs in XR.
    if (this.preparing) return this.preparing.then(() => this.resumePreparation());
    return this.prepare();
  }
  async prepareLatest() {
    try {
      for (;;) {
        const revision = this.revision;
        await idle();
        if (G.settings.spectator === false) return false;
        if (this.main.xr.isPresenting) return this.deferPreparation();
        if (revision !== this.revision) continue;
        this.renderer ||= this.createRenderer();
        this.resize();
        this.updateCamera();
        this.copyRendererSettings();
        await this.renderer.compileAsync(this.scene, this.cam);
        if (G.settings.spectator === false) return false;
        if (this.main.xr.isPresenting) return this.deferPreparation();
        if (revision !== this.revision) continue;
        await idle();
        if (G.settings.spectator === false) return false;
        if (this.main.xr.isPresenting) return this.deferPreparation();
        if (revision !== this.revision) continue;
        // compileAsync prepares programs, but not geometry/texture uploads.
        // Warm those with the canvas still hidden before exposing this view.
        this.updateCamera();
        this.copyRendererSettings();
        this.warmRenderer();
        this.ready = true;
        this.deferred = false;
        this.activate();
        return true;
      }
    } catch (e) {
      this.failed = true;
      this.active = false;
      document.body.classList.remove('spectating');
      console.warn('spectator view unavailable', e);
      return false;
    }
  }
  warmRenderer() {
    // Upload the whole visible scene, including objects outside the desktop
    // camera's frustum that the headset may face on its very first frame.
    const culled = [];
    this.scene.traverseVisible(object => {
      if (object.frustumCulled) { culled.push(object); object.frustumCulled = false; }
    });
    try { this.renderer.render(this.scene, this.cam); }
    finally { for (const object of culled) object.frustumCulled = true; }
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    const ratio = Math.min(devicePixelRatio, 1.25), size = `${w}:${h}:${ratio}`;
    if (this.size === size) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.size = size;
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }
  updateCamera() {
    const head = G.three.camera;
    head.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    head.matrixWorld.decompose(p, q, s);
    if (!Number.isFinite(p.x + p.y + p.z)) return false;
    const st = G.settings;
    if (st.spectatorLevel) {
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      e.z = 0;
      q.setFromEuler(e);
    }
    const k = [1, 0.5, 0.25, 0.12][st.spectatorSmooth | 0] ?? 1;
    if (this.fresh) { this.p.copy(p); this.q.copy(q); this.fresh = false; }
    this.p.lerp(p, Math.min(1, k * 2.4));
    this.q.slerp(q, k);
    const fov = st.spectatorFov || 80;
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.position.copy(this.p);
    this.cam.quaternion.copy(this.q);
    this.cam.updateMatrixWorld();
    return true;
  }
  copyRendererSettings() {
    const r = this.renderer;
    r.toneMapping = this.main.toneMapping;
    r.toneMappingExposure = this.main.toneMappingExposure;
    r.outputColorSpace = this.main.outputColorSpace;
  }
  render() {
    if (!this.wanted || !this.main.xr.isPresenting || G.settings.spectator === false) return;
    if (!this.ready) {
      // An idle callback still runs on the main thread. A cold monitor view
      // waits until desktop instead of uploading a second copy of the map
      // between headset frames.
      if (!this.failed) this.deferred = true;
      return;
    }
    if (!this.active || !this.renderer || (this.n++ & 1) === 1 || !this.updateCamera()) return;
    this.copyRendererSettings();
    const r = this.renderer;
    try { r.render(this.scene, this.cam); } catch (err) { console.warn('spectator render', err); this.stop(); }
  }
}
