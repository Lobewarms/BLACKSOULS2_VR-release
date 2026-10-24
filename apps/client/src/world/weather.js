// VX weather adapted to physical world space: simple white primitives, ten
// particles per power level, and strength transitions counted in logic frames.
import * as THREE from 'three';
import { T } from './mapmesh.js';

const CAPACITY = 128, RADIUS = 11, HEIGHT = 6, STEP = 1 / 60;
const kind = value => ['rain', 'storm', 'snow'].includes(String(value).replace(/^:/, '').toLowerCase())
  ? String(value).replace(/^:/, '').toLowerCase() : 'none';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export class WorldWeather {
  constructor(scene = null, { random = Math.random } = {}) {
    this.random = random;
    this.type = 'none'; this.power = 0; this.target = 0; this.duration = 0; this.count = 0;
    this.group = new THREE.Group(); this.group.name = 'world-weather'; this.group.visible = false;
    this.positions = new Float32Array(CAPACITY * 3);
    this.seeded = new Uint8Array(CAPACITY);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(this.rainGeometry, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 192 / 255, depthWrite: false, fog: true, toneMapped: false,
    }));
    this.snowGeometry = new THREE.BufferGeometry();
    this.snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(this.snowGeometry, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.018, sizeAttenuation: true, transparent: true, opacity: 192 / 255,
      depthWrite: false, fog: true, toneMapped: false,
    }));
    this.rain.frustumCulled = false; this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
    this.attach(scene);
    this.refreshCount();
  }
  attach(scene) { if (scene && this.group.parent !== scene) scene.add(this.group); }
  // Original weather dims viewport2 by six RGB levels per power. The owning
  // atmosphere controller can compose this once rather than stack black veils.
  get dimness() { return Math.floor(this.power * 6); }
  set(type, power = 0, frames = 0) {
    if (this.disposed) return;
    const next = kind(type), target = next === 'none' ? 0 : THREE.MathUtils.clamp(finite(power), 0, 9);
    const duration = THREE.MathUtils.clamp(Math.floor(finite(frames)), 0, 36000);
    if (next !== 'none' && next !== this.type) { this.type = next; this.seeded.fill(0); }
    this.target = target; this.duration = duration;
    if (duration === 0) {
      this.power = target;
      if (next === 'none' || target === 0) this.type = 'none';
    }
    this.refreshCount();
  }
  refreshCount() {
    this.count = this.type === 'none' ? 0 : Math.min(CAPACITY, Math.floor(this.power * 10));
    this.rain.visible = this.count > 0 && this.type !== 'snow';
    this.snow.visible = this.count > 0 && this.type === 'snow';
    this.rainGeometry.setDrawRange(0, this.rain.visible ? this.count * 2 : 0);
    this.snowGeometry.setDrawRange(0, this.snow.visible ? this.count : 0);
    if (!this.count) { this.group.visible = false; this.seeded.fill(0); }
  }
  updateLogic() {
    if (this.disposed) return;
    if (this.duration > 0) {
      this.power = (this.power * (this.duration - 1) + this.target) / this.duration;
      if (--this.duration === 0) { this.power = this.target; if (this.target === 0) this.type = 'none'; }
      this.refreshCount();
    }
    const snow = this.type === 'snow', wind = this.type === 'storm' ? 4 : snow ? 0.35 : 4 / 3;
    const fall = snow ? 1.2 : 8;
    for (let i = 0; i < this.count; i++) if (this.seeded[i]) {
      this.positions[i * 3] -= wind * STEP;
      this.positions[i * 3 + 1] -= fall * STEP;
    }
  }
  floor(x, z, head, floorAt) {
    const value = floorAt?.(x / T - 0.5, z / T - 0.5);
    return Number.isFinite(value) ? value : head.y - 1.6;
  }
  seed(i, head, floorAt, top = false) {
    const angle = this.random() * Math.PI * 2, radius = 1 + this.random() * (RADIUS - 1);
    const x = head.x + Math.cos(angle) * radius, z = head.z + Math.sin(angle) * radius;
    const floor = this.floor(x, z, head, floorAt), ceiling = Math.max(floor + 1, head.y + HEIGHT);
    this.positions.set([x, top ? ceiling : floor + 0.05 + this.random() * (ceiling - floor - 0.05), z], i * 3);
    this.seeded[i] = 1;
  }
  // Called after the player moves, once per render. Position changes above use
  // logic time; extra headset renders cannot speed the weather up.
  update(head, floorAt = null) {
    if (this.disposed || !head || ![head.x, head.y, head.z].every(Number.isFinite) || !this.count) {
      this.group.visible = false; return;
    }
    this.group.visible = true;
    const rain = this.rainGeometry.attributes.position.array, snow = this.snowGeometry.attributes.position.array;
    const storm = this.type === 'storm', length = storm ? 0.75 : 0.4;
    for (let i = 0; i < this.count; i++) {
      if (!this.seeded[i]) this.seed(i, head, floorAt);
      let at = i * 3, x = this.positions[at], y = this.positions[at + 1], z = this.positions[at + 2];
      const distance = Math.hypot(x - head.x, z - head.z);
      if (distance > RADIUS || distance < 0.55 || y <= this.floor(x, z, head, floorAt) + 0.05 || y > head.y + HEIGHT + 1) {
        this.seed(i, head, floorAt, true);
        x = this.positions[at]; y = this.positions[at + 1]; z = this.positions[at + 2];
      }
      snow[at] = x; snow[at + 1] = y; snow[at + 2] = z;
      at = i * 6;
      rain[at] = x; rain[at + 1] = y; rain[at + 2] = z;
      rain[at + 3] = x + length * (storm ? 0.5 : 1 / 6); rain[at + 4] = y + length; rain[at + 5] = z;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
    this.snowGeometry.attributes.position.needsUpdate = true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.group.visible = false;
    this.rainGeometry.dispose(); this.snowGeometry.dispose(); this.rain.material.dispose(); this.snow.material.dispose();
    this.count = 0;
  }
}
