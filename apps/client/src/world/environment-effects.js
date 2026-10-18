// The original's rich fog, sunshine and leaf atlases, adapted to depth-tested world space.
// Cue settings persist like Game_System; every generated GPU resource belongs to this class.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { loadImage } from '../data/assets.js';
import { normalizeEnvironmentState } from '../game/environment-state.js';

const SPAN = 24, RADIUS = 12, LEAF_COUNT = 48, ATLAS = 18, PIXEL = 1.5 / 32;
const wrap = (value, size) => ((value % size) + size) % size;
const clamp = THREE.MathUtils.clamp;

export function parseMapFog(note = '') {
  const m = /==マップフォグ([^\r\n]*?)\[\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*(\d+)\s*,\s*(\d)\s*\]==/.exec(note);
  if (!m) return null;
  const file = m[1].trim();
  if (!file || /[\\/]|\.\./.test(file)) return null;
  const blend = clamp(+m[6], 0, 2);
  return { file, xspeed: clamp(+m[2], -1000, 1000), yspeed: clamp(+m[3], -1000, 1000),
    z: clamp(+m[4], -1000, 1000), opacity: clamp(+m[5], 0, 255), blend,
    darkness: blend === 2 && /kurayami|darkness|暗闇/i.test(file) };
}

function texture(image, repeat = false) {
  const tex = new THREE.Texture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function material(tex, head, blend = 0, leaves = false) {
  return new THREE.ShaderMaterial({
    uniforms: { image: { value: tex }, alpha: { value: 0 }, head: { value: head },
      uvOffset: { value: new THREE.Vector2() }, uvRepeat: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      ${leaves ? 'attribute vec2 leafFrame;' : 'uniform vec2 uvOffset; uniform vec2 uvRepeat;'}
      void main() {
        ${leaves ? `vUv = (uv + vec2(leafFrame.x, 17.0 - leafFrame.y)) / 18.0;
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);`
          : 'vUv = uv * uvRepeat + uvOffset; vec4 world = modelMatrix * vec4(position, 1.0);'}
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform sampler2D image;
      uniform float alpha;
      uniform vec3 head;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec4 pixel = texture2D(image, vUv);
        float distanceToHead = distance(vWorld, head);
        float fade = smoothstep(0.9, 2.0, distanceToHead) * (1.0 - smoothstep(10.0, 15.0, distanceToHead));
        gl_FragColor = vec4(pixel.rgb, pixel.a * alpha * fade);
        ${blend === 2 ? 'gl_FragColor.rgb *= gl_FragColor.a;' : ''}
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: blend === 1 ? THREE.AdditiveBlending : blend === 2 ? THREE.SubtractiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
}

export class EnvironmentEffects {
  constructor(scene, options = {}) {
    this.scene = scene; this.loadImage = options.loadImage || loadImage;
    this.random = options.random || Math.random;
    this.root = new THREE.Group(); this.root.name = 'Original region effects'; scene.add(this.root);
    this.head = new THREE.Vector3(); this.entries = new Map(); this.pending = new Map();
    this.signatures = new Map(); this.versions = new Map(); this.time = 0; this.map = null; this.disposed = false;
    this.cues = normalizeEnvironmentState();
    this.dummy = new THREE.Object3D();
  }

  setMap(map) {
    if (this.disposed) return Promise.resolve();
    this.clear(); this.map = map; this.root.visible = !!map;
    this.cues = normalizeEnvironmentState(G.state?.system?.environmentEffects);
    this.mapFog = parseMapFog(map?.note);
    return this.sync();
  }

  effectHook(name, args = []) {
    if (this.disposed) return false;
    const next = { ...this.cues };
    switch (name) {
      case 'rich_fog_start': next.richFog = true; break;
      case 'rich_fog_stop': next.richFog = false; break;
      case 'rich_sunshine_start': next.sunshineType = args[0]; next.sunshinePosition = args[1]; break;
      case 'rich_sunshine_stop': next.sunshineType = 0; break;
      case 'start_fallen_leaves': next.leavesType = args[0]; break;
      case 'end_fallen_leaves': next.leavesType = 0; break;
      default: return false;
    }
    this.cues = normalizeEnvironmentState(next);
    if (G.state?.system) G.state.system.environmentEffects = { ...this.cues };
    this.sync();
    return true;
  }

  sync() {
    if (!this.map || this.disposed) return Promise.resolve();
    return Promise.all([
      this.cues.richFog ? this.ensure('richFog', { name: 'RichFog' }, image => this.buildFog(image)) : this.remove('richFog'),
      this.mapFog && !this.mapFog.darkness && this.mapFog.opacity > 0
        ? this.ensure('mapFog', this.mapFog, image => this.buildFog(image, this.mapFog), 'Graphics/Parallaxes') : this.remove('mapFog'),
      this.cues.sunshineType ? this.ensure('sunshine', { name: `Sunshine_${this.cues.sunshineType}`, position: this.cues.sunshinePosition },
        image => this.buildSunshine(image, this.cues.sunshinePosition)) : this.remove('sunshine'),
      this.cues.leavesType ? this.ensure('leaves', { name: `fallen_leaves${String(Math.ceil(this.cues.leavesType / 3)).padStart(2, '0')}`, type: this.cues.leavesType },
        image => this.buildLeaves(image, this.cues.leavesType)) : this.remove('leaves'),
    ]);
  }

  ensure(key, spec, build, folder = 'Graphics/System') {
    const signature = JSON.stringify(spec);
    if (this.signatures.get(key) === signature) return this.pending.get(key) || Promise.resolve();
    this.remove(key); this.signatures.set(key, signature);
    const version = this.versions.get(key);
    const pending = Promise.resolve().then(() => this.loadImage(folder, spec.name || spec.file)).then(image => {
      if (this.disposed || this.versions.get(key) !== version) return;
      if (!image || !(image.width > 0 && image.height > 0)) { this.signatures.delete(key); return; }
      const entry = build(image); this.entries.set(key, entry); this.root.add(entry.group);
      this.place(entry);
    }).catch(() => {
      if (this.versions.get(key) === version) this.signatures.delete(key);
    }).finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }

  remove(key) {
    this.versions.set(key, (this.versions.get(key) || 0) + 1);
    this.signatures.delete(key); this.pending.delete(key);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.group.removeFromParent();
    for (const tex of entry.textures) tex.dispose();
    for (const mat of entry.materials) mat.dispose();
    entry.mesh?.dispose();   // InstancedMesh owns an instance-matrix GPU buffer as well as its geometry.
    entry.geometry.dispose(); this.entries.delete(key);
  }

  buildFog(image, spec = null) {
    const group = new THREE.Group(), geometry = new THREE.PlaneGeometry(SPAN, SPAN);
    const tex = texture(image, true), mats = [], meshes = [];
    const repeats = new THREE.Vector2(SPAN / (image.width * PIXEL), SPAN / (image.height * PIXEL));
    for (let i = 0; i < (spec ? 2 : 3); i++) {
      const mat = material(tex, this.head, spec?.blend || 0); mat.uniforms.uvRepeat.value.copy(repeats);
      const mesh = new THREE.Mesh(geometry, mat); mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.2 + i * 0.35; group.add(mesh); mats.push(mat); meshes.push(mesh);
    }
    return { kind: spec ? 'mapFog' : 'richFog', group, geometry, textures: [tex], materials: mats, meshes,
      width: image.width, height: image.height, spec, repeats };
  }

  buildSunshine(image, position) {
    const group = new THREE.Group(), geometry = new THREE.PlaneGeometry(8, 8 * image.height / image.width);
    const tex = texture(image), mats = [], meshes = [];
    for (let i = 0; i < 3; i++) {
      const mat = material(tex, this.head, 1), mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set((position - 2) * 3 + (i - 1) * 2, 3.7, (i - 1) * 3);
      mesh.rotation.set(-0.25, i * Math.PI / 3, (position - 2) * -0.3);
      group.add(mesh); mats.push(mat); meshes.push(mesh);
    }
    return { kind: 'sunshine', group, geometry, textures: [tex], materials: mats, meshes };
  }

  buildLeaves(image, type) {
    const group = new THREE.Group(), geometry = new THREE.PlaneGeometry(1, 1);
    const tex = texture(image), mat = material(tex, this.head, 0, true);
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(LEAF_COUNT * 2), 2);
    frames.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('leafFrame', frames);
    const mesh = new THREE.InstancedMesh(geometry, mat, LEAF_COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; group.add(mesh);
    const particles = Array.from({ length: LEAF_COUNT }, () => ({ position: new THREE.Vector3(),
      size: 0.1 + this.random() * 0.14, fall: 0.25 + this.random() * 0.3,
      seed: this.random() * Math.PI * 2, frameX: Math.floor(this.random() * ATLAS), frameY: Math.floor(this.random() * ATLAS),
      frameDx: this.random() < 0.5 ? -1 : 1, frameDy: this.random() < 0.5 ? -1 : 1 }));
    const entry = { kind: 'leaves', group, geometry, textures: [tex], materials: [mat], mesh, particles, frames, type, frame: -1 };
    for (const p of particles) this.spawnLeaf(p, true);
    return entry;
  }

  floor() { return Number.isFinite(G.player?.floorY) ? G.player.floorY : 0; }

  spawnLeaf(p, initial = false) {
    const angle = this.random() * Math.PI * 2, radius = 2 + this.random() * (RADIUS - 2);
    p.position.set(this.head.x + Math.cos(angle) * radius, this.floor() + (initial ? this.random() * 6 : 5 + this.random() * 2),
      this.head.z + Math.sin(angle) * radius);
  }

  place(entry) {
    if (entry.kind === 'leaves') return;
    entry.group.position.set(Math.floor(this.head.x / 4) * 4, this.floor(), Math.floor(this.head.z / 4) * 4);
  }

  update(dt, head) {
    if (this.disposed || !this.map) return;
    if (!head || ![head.x, head.y, head.z].every(Number.isFinite)) return;
    this.head.copy(head);
    const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    this.time += elapsed;
    const bright = clamp(G.settings?.fxBrightness ?? 0.5, 0.1, 1);
    for (const entry of this.entries.values()) {
      this.place(entry);
      if (entry.kind === 'richFog' || entry.kind === 'mapFog') {
        const speedX = entry.spec ? entry.spec.xspeed * 3 : 12;
        const speedY = entry.spec ? entry.spec.yspeed * 3 : 12;
        for (const [i, mat] of entry.materials.entries()) {
          mat.uniforms.uvOffset.value.set(wrap(entry.group.position.x / (entry.width * PIXEL) + this.time * speedX / entry.width + i / 3, 1),
            wrap(-entry.group.position.z / (entry.height * PIXEL) + this.time * speedY / entry.height + i / 3, 1));
          mat.uniforms.alpha.value = entry.spec ? entry.spec.opacity / 255 * 0.55
            : (0.5 + 0.5 * Math.sin(this.time * 2.5 + i * Math.PI * 2 / 3)) * 0.1;
          if (entry.spec?.blend === 1) mat.uniforms.alpha.value *= bright;
        }
      } else if (entry.kind === 'sunshine') {
        entry.materials.forEach((mat, i) => { mat.uniforms.alpha.value = (0.065 + 0.035 * Math.sin(this.time * 0.6 + i * 2)) * bright; });
      } else {
        const frame = Math.floor(this.time * 12), wind = [0, 0.3, -0.3][(entry.type - 1) % 3];
        for (const [i, p] of entry.particles.entries()) {
          p.position.x += wind * elapsed + (Math.sin(this.time + p.seed) - Math.sin(this.time - elapsed + p.seed)) * 0.15;
          p.position.y -= p.fall * elapsed;
          if (p.position.y < this.floor() + 0.03 || Math.hypot(p.position.x - head.x, p.position.z - head.z) > RADIUS + 2) this.spawnLeaf(p);
          this.dummy.position.copy(p.position); this.dummy.lookAt(head); this.dummy.rotateZ(p.seed); this.dummy.scale.setScalar(p.size);
          this.dummy.updateMatrix(); entry.mesh.setMatrixAt(i, this.dummy.matrix);
          if (frame !== entry.frame) entry.frames.setXY(i, wrap(p.frameX + frame * p.frameDx, ATLAS), wrap(p.frameY + frame * p.frameDy, ATLAS));
        }
        entry.mesh.instanceMatrix.needsUpdate = true;
        if (frame !== entry.frame) { entry.frames.needsUpdate = true; entry.frame = frame; }
        entry.materials[0].uniforms.alpha.value = 0.9;
      }
    }
  }

  clear() {
    for (const key of ['richFog', 'mapFog', 'sunshine', 'leaves']) this.remove(key);
    this.map = null; this.mapFog = null; this.root.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.clear(); this.root.removeFromParent(); this.disposed = true;
  }
}
