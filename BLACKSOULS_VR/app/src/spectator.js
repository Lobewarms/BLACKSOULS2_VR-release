// PC-monitor view while the headset is on. WebXR draws only into the headset, so the page itself shows
// nothing to the people around you. A second renderer draws the same scene from the player's head into a
// canvas covering the page. Horizon leveling, shake smoothing and the field of view are the player's
// settings (menu); by default it is the plain head view. Every other headset frame is enough for watching.
import * as THREE from 'three';
import { G } from './globals.js';

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
    this.n = 0;
    this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.fresh = true;
    addEventListener('resize', () => this.resize());
  }
  start() {
    if (G.settings.spectator === false) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
      } catch (e) { console.warn('spectator view unavailable', e); return; }
    }
    this.active = true;
    this.fresh = true;
    document.body.classList.add('spectating');
    this.resize();
  }
  stop() {
    this.active = false;
    document.body.classList.remove('spectating');
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }
  render() {
    if (!this.active || !this.renderer || !this.main.xr.isPresenting) return;
    if ((this.n++ & 1) === 1) return;
    const head = G.three.camera;
    head.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    head.matrixWorld.decompose(p, q, s);
    if (!Number.isFinite(p.x + p.y + p.z)) return;
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
    const r = this.renderer;
    r.toneMapping = this.main.toneMapping;
    r.toneMappingExposure = this.main.toneMappingExposure;
    r.outputColorSpace = this.main.outputColorSpace;
    try { r.render(this.scene, this.cam); } catch (err) { console.warn('spectator render', err); this.stop(); }
  }
}
