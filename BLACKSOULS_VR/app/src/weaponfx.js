// Light on the player's weapon, asked for every frame by src/combat.js:
//  - 'armed': a weapon art waits on the weapon (a physical skill on one enemy, picked from the quick slots) -
//    a red glow pulses along it until the next blow that lands;
//  - an element on the attack (a resin - 송진 - or any state that gives the attack an element): fire licks up
//    the blade, lightning crackles along it, ice frosts it, darkness smokes off it, light shimmers on it.
// Everything is drawn along the weapon (grip to tip) in world space, so it trails behind a swing.
import * as THREE from 'three';
import { G } from './globals.js';

const fxk = () => THREE.MathUtils.clamp(G.settings.fxBrightness ?? 0.5, 0.1, 1);
// attack elements (System elements) that have a look: 3 화염, 4 얼음, 5 번개, 9 빛, 10 어둠
export const ELEMENT_FX = { 3: 'fire', 4: 'ice', 5: 'thunder', 9: 'light', 10: 'dark' };
// the steady glow along the blade: colour, size, how fast and how deep it pulses
const GLOW = {
  armed:   { color: [1, 0.1, 0.06], size: 0.14, pulse: 8, depth: 0.45 },
  fire:    { color: [1, 0.42, 0.1], size: 0.1, pulse: 13, depth: 0.3 },
  ice:     { color: [0.5, 0.82, 1], size: 0.12, pulse: 2.2, depth: 0.25 },
  thunder: { color: [0.8, 0.82, 0.5], size: 0.08, pulse: 27, depth: 0.6 },
  light:   { color: [1, 0.88, 0.55], size: 0.13, pulse: 2.6, depth: 0.25 },
  dark:    { color: [0.45, 0.12, 0.7], size: 0.13, pulse: 3.5, depth: 0.3 },
};
const GLOW_AT = [0.15, 0.35, 0.55, 0.75, 0.95];
// particles off the blade: per second, life (s), size from / to (m), colour over life (0..1), drift (m/s)
const PARTS = {
  armed:   { rate: 14, life: [0.35, 0.6], size: [0.035, 0.012], color: u => [1, 0.18 - 0.1 * u, 0.1], rise: 0.12, drift: 0.05 },
  fire:    { rate: 60, life: [0.22, 0.48], size: [0.075, 0.018], color: u => [1, 0.85 - 0.62 * u, 0.42 - 0.4 * u], rise: 0.55, drift: 0.07 },
  ice:     { rate: 18, life: [0.6, 1.1], size: [0.034, 0.018], color: () => [0.78, 0.94, 1], rise: -0.05, drift: 0.03, twinkle: true },
  thunder: { rate: 32, life: [0.05, 0.11], size: [0.045, 0.02], color: () => [1, 1, 0.78], rise: 0, drift: 0.3 },
  light:   { rate: 14, life: [0.7, 1.1], size: [0.03, 0.014], color: () => [1, 0.95, 0.72], rise: 0.16, drift: 0.03, twinkle: true },
  dark:    { rate: 26, life: [0.6, 0.95], size: [0.05, 0.15], color: () => [0.16, 0.05, 0.24], rise: 0.15, drift: 0.06, smoke: true },
};
const MAX_PARTS = 240;
const EMPTY = new Set();
const rnd = (a, b) => a + Math.random() * (b - a);

export class WeaponFx {
  constructor(root, glowTexture) {
    this.root = root;
    this.glowTexture = glowTexture;
    this.t = 0;
    this.glows = {};             // kind -> sprites along the blade
    this.acc = {};               // kind -> particles owed (fractional)
    this.parts = [];
    this.pool = { add: [], smoke: [] };
    this.arcs = [];
    this.arcWait = 0;
  }
  smokeTexture() {
    if (!this._smoke) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      this._smoke = new THREE.CanvasTexture(c);
    }
    return this._smoke;
  }
  takeSprite(smoke) {
    const pool = smoke ? this.pool.smoke : this.pool.add;
    let s = pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke ? this.smokeTexture() : this.glowTexture(), transparent: true,
        blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      s.renderOrder = smoke ? 1398 : 1399;
      s.userData.smoke = smoke;
      this.root.add(s);
    }
    s.visible = true;
    return s;
  }
  dropSprite(s) {
    s.visible = false;
    (s.userData.smoke ? this.pool.smoke : this.pool.add).push(s);
  }

  // seg: { base, tip } (world) - or null when no weapon shows; kinds: a Set of 'armed' / 'fire' / 'ice' / ...
  update(dt, seg, kinds) {
    this.t += dt;
    const on = seg ? kinds : EMPTY;
    const k = fxk();
    // steady glows
    for (const kind of Object.keys(GLOW)) {
      let g = this.glows[kind];
      if (!on.has(kind)) {
        if (g) { for (const s of g) this.dropSprite(s); delete this.glows[kind]; }
        continue;
      }
      if (!g) g = this.glows[kind] = GLOW_AT.map(() => this.takeSprite(false));
      const spec = GLOW[kind];
      g.forEach((s, i) => {
        s.position.lerpVectors(seg.base, seg.tip, GLOW_AT[i]);
        const p = 1 - spec.depth + spec.depth * (0.5 + 0.5 * Math.sin(this.t * spec.pulse + i * 1.7));
        s.material.color.setRGB(spec.color[0] * k * p, spec.color[1] * k * p, spec.color[2] * k * p);
        s.material.opacity = 1;
        s.scale.setScalar(spec.size * (0.85 + 0.3 * p));
      });
    }
    // new particles
    for (const kind of on) {
      const spec = PARTS[kind];
      if (!spec) continue;
      this.acc[kind] = (this.acc[kind] || 0) + spec.rate * dt;
      while (this.acc[kind] >= 1) { this.acc[kind]--; if (this.parts.length < MAX_PARTS) this.spawn(spec, seg); }
    }
    for (const kind of Object.keys(this.acc)) if (!on.has(kind)) delete this.acc[kind];
    // particles move and fade
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.dropSprite(p.s); this.parts.splice(i, 1); continue; }
      const u = p.age / p.life;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * u);
      const c = p.spec.color(u);
      let a = 1 - u * u;
      if (p.spec.twinkle) a *= 0.45 + 0.55 * Math.abs(Math.sin(p.age * 14 + p.phase));
      if (p.spec.smoke) { p.s.material.color.setRGB(c[0], c[1], c[2]); p.s.material.opacity = 0.55 * a; }
      else { p.s.material.color.setRGB(c[0] * k, c[1] * k, c[2] * k); p.s.material.opacity = a; }
    }
    this.updateArcs(dt, on.has('thunder') ? seg : null, k);
  }
  spawn(spec, seg) {
    const s = this.takeSprite(!!spec.smoke);
    s.position.lerpVectors(seg.base, seg.tip, rnd(0.12, 1));
    s.position.x += rnd(-0.012, 0.012); s.position.y += rnd(-0.012, 0.012); s.position.z += rnd(-0.012, 0.012);
    const vel = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spec.drift);
    vel.y += spec.rise;
    this.parts.push({ s, spec, vel, age: 0, life: rnd(spec.life[0], spec.life[1]), size0: spec.size[0] * rnd(0.8, 1.2), size1: spec.size[1], phase: Math.random() * 6 });
    s.scale.setScalar(spec.size[0]);
    s.material.opacity = 0;
  }
  // lightning: short jagged arcs between points of the blade (now and then out into the air)
  updateArcs(dt, seg, k) {
    for (const a of this.arcs) { a.life -= dt; if (a.life <= 0) a.line.visible = false; }
    if (!seg) return;
    this.arcWait -= dt;
    if (this.arcWait > 0) return;
    this.arcWait = rnd(0.05, 0.13);
    let a = this.arcs.find(x => !x.line.visible);
    if (!a && this.arcs.length < 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      line.frustumCulled = false;
      line.renderOrder = 1399;
      this.root.add(line);
      a = { line, life: 0 };
      this.arcs.push(a);
    }
    if (!a) return;
    const t0 = rnd(0.12, 1), t1 = THREE.MathUtils.clamp(t0 + rnd(-0.3, 0.3), 0.1, 1);
    const p0 = new THREE.Vector3().lerpVectors(seg.base, seg.tip, t0), p1 = new THREE.Vector3().lerpVectors(seg.base, seg.tip, t1);
    if (Math.random() < 0.4 || p0.distanceTo(p1) < 0.05) p1.add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).setLength(rnd(0.04, 0.08)));
    const pos = a.line.geometry.attributes.position;
    const n = pos.count, q = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      q.lerpVectors(p0, p1, i / (n - 1));
      if (i > 0 && i < n - 1) { q.x += rnd(-0.018, 0.018); q.y += rnd(-0.018, 0.018); q.z += rnd(-0.018, 0.018); }
      pos.setXYZ(i, q.x, q.y, q.z);
    }
    pos.needsUpdate = true;
    a.line.material.color.setRGB(0.92 * k + 0.08, 0.95 * k + 0.05, k);
    a.line.visible = true;
    a.life = rnd(0.045, 0.09);
  }
  // a burst along the blade when something new comes onto the weapon (a resin rubbed on, a weapon art)
  burst(seg, kind) {
    const spec = PARTS[kind];
    if (!seg || !spec) return;
    for (let i = 0; i < 26 && this.parts.length < MAX_PARTS; i++) this.spawn({ ...spec, drift: spec.drift * 4 + 0.1, life: [spec.life[0] * 1.3, spec.life[1] * 1.5] }, seg);
  }
}
