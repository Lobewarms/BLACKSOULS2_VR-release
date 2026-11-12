// Floor markers ("telegraphs") for attacks: where an enemy attack will land while it winds up, and
// where the player's readied spell will go. The outline shows the whole area at once; the fill grows
// from the centre as the attack charges (a ring: from its inner edge out). Orange = normal, purple = sure hit
// (cannot be dodged), pink with a pulsing edge = no plain guard stops it, crimson with a pulsing edge = both, blue =
// yours.
// A mark lies flat on the floor where its area begins; where the area runs on over a floor at another height - the stage
// and the house in front of it, 그랑・기뇰's play being fought on both - it is drawn on that floor too: a copy of it at each
// height its area covers, every copy showing only the part of it over its own floor (floorLevels; a blow's reach is the
// same on every floor, what it covers is where it is drawn).
import * as THREE from 'three';
import { G } from './globals.js';
import { T } from './mapmesh.js';

export const MARK = { enemy: 0xff5a1e, certain: 0xb050ff, heavy: 0xff66cc, certainHeavy: 0xff0a3c, player: 0x5ab4ff };
export const EDGE = 0.07;                           // m: the outline's width
const LIFT = 0.045;                                 // m: a mark over its floor

function mat(color, opacity) {
  return levelled(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
}

// ---- floors at more than one height ----
const LEVEL_GAP = 0.1;                              // m: floors this far apart are two floors
const MAX_LEVELS = 4;
// the floor's height in each cell of the map shown now (m) - as a texture too, for the copies to tell their own floor by
const FLOOR = { tex: { value: null }, size: { value: new THREE.Vector2(1, 1) } };
let floorMap = null;
function floorHeights() {
  const mesh = G.view?.mesh, g = G.map?.grid;
  if (!mesh || !g || !G.floorAt || G.view.mapId !== G.map.mapId) return null;
  if (floorMap?.mesh === mesh) return floorMap;
  floorMap?.tex.dispose();
  const w = g.w, h = g.h, data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[x + y * w] = G.floorAt(x, y);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;          // (a looping map: the cells past an edge are the other side's)
  tex.needsUpdate = true;
  FLOOR.tex.value = tex;
  FLOOR.size.value.set(w * T, h * T);
  floorMap = { mesh, data, tex, w, h };
  return floorMap;
}
// The heights of the floors a flat thing lying at (x, y, z) covers out to reach (m): y (its own) first, then each other floor
// there one can stand on, as high as its cells are (one floor within LEVEL_GAP of another counts as it)
export function floorLevels(x, y, z, reach) {
  const fm = floorHeights(), m = G.map;
  const levels = [y];
  if (!fm) return levels;
  const cx = x / T - 0.5, cz = z / T - 0.5, R = reach / T + 0.75;      // (to the far corner of a cell it touches)
  for (let j = Math.floor(cz - R); j <= Math.ceil(cz + R); j++) {
    for (let i = Math.floor(cx - R); i <= Math.ceil(cx + R); i++) {
      if (Math.hypot(i - cx, j - cz) > R) continue;
      const wi = m.wrapX(i), wj = m.wrapY(j);
      if (!m.grid.valid(wi, wj) || !m.walkable(wi, wj)) continue;
      const f = fm.data[wi + wj * fm.w];
      if (levels.length < MAX_LEVELS && levels.every(l => Math.abs(l - f) > LEVEL_GAP)) levels.push(Math.round(f * 1000) / 1000);
    }
  }
  return levels;
}
// a material of a flat thing lying lift over its floor that may be drawn on several floors: each copy of it keeps only what
// lies over the floor it is on - a fragment's floor (its cell's) nearest to that copy's of the floors it covers (setLevels)
export function levelled(material, lift = LIFT) {
  const u = { levels: { value: new THREE.Vector4() }, n: { value: 1 }, lift: { value: lift } };
  material.userData.levels = u;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uFloorTex: FLOOR.tex, uMapSize: FLOOR.size, uLevels: u.levels, uLevelN: u.n, uLift: u.lift });
    shader.vertexShader = 'varying vec3 vFloorW;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vFloorW;\nuniform sampler2D uFloorTex;\nuniform vec2 uMapSize;\nuniform vec4 uLevels;\nuniform int uLevelN;\nuniform float uLift;\n' +
      shader.fragmentShader.replace('void main() {', `void main() {
  if (uLevelN > 1) {
    float f = texture2D(uFloorTex, vFloorW.xz / uMapSize).r;
    float near = uLevels.x, d = abs(f - uLevels.x);
    if (abs(f - uLevels.y) < d) { near = uLevels.y; d = abs(f - uLevels.y); }
    if (uLevelN > 2 && abs(f - uLevels.z) < d) { near = uLevels.z; d = abs(f - uLevels.z); }
    if (uLevelN > 3 && abs(f - uLevels.w) < d) { near = uLevels.w; }
    if (abs(vFloorW.y - uLift - near) > 0.03) discard;
  }`);
  };
  material.customProgramCacheKey = () => 'floorLevels';
  return material;
}
function setLevels(material, levels) {
  const u = material.userData.levels;
  if (!u) return;
  u.n.value = levels.length;
  u.levels.value.set(levels[0], levels[1] ?? 0, levels[2] ?? 0, levels[3] ?? 0);
}
// a flat thing lying on the floor (a pool's glow: a mesh lying in its own XY plane, turned flat, scaled evenly; its
// material levelled) lying at (x, y, z), reach (m) round it: a copy of it on each other floor it covers, as a mark is
export function layOnFloors(mesh, x, y, z, reach) {
  const levels = floorLevels(x, y, z, reach);
  setLevels(mesh.material, levels);
  for (const l of levels.slice(1)) {
    const c = new THREE.Mesh(mesh.geometry, mesh.material);
    c.position.z = (l - y) / mesh.scale.z;            // (its z is up; in its parent's scale)
    c.renderOrder = mesh.renderOrder;
    mesh.add(c);
  }
}
// thin quad from (x0,y0) to (x1,y1) in the marker's plane
function bar(x0, y0, x1, y1, wdt) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l * wdt / 2, ny = dx / l * wdt / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x0 + nx, y0 + ny, 0, x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0, x1 + nx, y1 + ny, 0,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class FloorMarker {
  // spec: { shape: 'circle'|'ring'|'sector'|'line', r, r0 (a ring's hole), half, len, width, color, label,
  //         edgeColor / edgeW (the outline's own colour / width, if not the fill's / EDGE) }
  constructor(parent, spec) {
    this.spec = spec;
    this.outer = new THREE.Group();          // pose: position + heading about Y
    this.flat = new THREE.Group();           // lies on the floor; forward = local +X
    this.flat.rotation.x = -Math.PI / 2;
    this.outer.add(this.flat);
    const color = spec.color ?? MARK.enemy;
    this.edgeMat = mat(spec.edgeColor ?? color, 0.85);
    this.fillMat = mat(color, 0.28);
    const E = spec.edgeW ?? EDGE;
    if (spec.shape === 'circle') {
      this.flat.add(new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, spec.r - E), spec.r, 56), this.edgeMat));
      this.fill = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 56), this.fillMat);
    } else if (spec.shape === 'ring') {
      // (everything between the two edges; the hole in the middle is safe)
      this.flat.add(new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, spec.r - E), spec.r, 72), this.edgeMat));
      this.flat.add(new THREE.Mesh(new THREE.RingGeometry(spec.r0, spec.r0 + E, 56), this.edgeMat));
      this.fill = new THREE.Mesh(new THREE.RingGeometry(spec.r0, spec.r0 + 0.01, 72), this.fillMat);
    } else if (spec.shape === 'sector') {
      const h = spec.half;
      this.flat.add(new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, spec.r - E), spec.r, 40, 1, -h, 2 * h), this.edgeMat));
      this.flat.add(new THREE.Mesh(bar(0, 0, Math.cos(h) * spec.r, Math.sin(h) * spec.r, E), this.edgeMat));
      this.flat.add(new THREE.Mesh(bar(0, 0, Math.cos(-h) * spec.r, Math.sin(-h) * spec.r, E), this.edgeMat));
      this.fill = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 40, -h, 2 * h), this.fillMat);
    } else {
      // sides of unit length stretched to the line's length, which can change (setLength)
      const W = spec.width;
      this.sides = [-W / 2, W / 2].map(y => new THREE.Mesh(bar(0, y, 1, y, E), this.edgeMat));
      this.endBar = new THREE.Mesh(bar(0, -W / 2, 0, W / 2, E), this.edgeMat);
      for (const m of [...this.sides, this.endBar, new THREE.Mesh(bar(0, -W / 2, 0, W / 2, E), this.edgeMat)]) this.flat.add(m);
      const g = new THREE.PlaneGeometry(1, W);
      g.translate(0.5, 0, 0);                // grows from the start of the line
      this.fill = new THREE.Mesh(g, this.fillMat);
      this.lineLen = spec.len;
    }
    this.flat.add(this.fill);
    this.outer.renderOrder = 5;
    this.flat.traverse(o => { o.renderOrder = 5; });
    if (spec.label) this.addLabel(spec.label, color);
    this.fading = 0;
    if (spec.shape === 'line') this.setLength(spec.len);
    this.setProgress(0);
    parent.add(this.outer);
    this.parent = parent;
  }
  addLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    this.labelMat = levelled(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), this.labelMat);
    m.position.set(this.spec.shape === 'line' ? this.spec.len * 0.5 : 0, 0, 0.01);
    m.renderOrder = 6;
    this.flat.add(m);
    this.labelMesh = m;
  }
  // x, z: origin (circle centre / sector apex / line start); y: floor height; heading: world atan2(dz, dx)
  setPose(x, y, z, heading = 0) {
    this.outer.position.set(x, y + LIFT, z);
    this.outer.rotation.y = -heading;
    this.pose = [x, y, z];
    this.relevel();
  }
  // how far its area reaches from where it begins (m)
  reach() { return this.spec.shape === 'line' ? (this.lineLen ?? this.spec.len ?? 0) + (this.spec.width || 0) / 2 : this.spec.r || 0; }
  // drawn on each floor its area covers (floorLevels): a copy of it on each floor other than its own, every one showing
  // the part over its floor
  relevel() {
    const [x, y, z] = this.pose;
    const levels = floorLevels(x, y, z, this.reach());
    const key = levels.map(l => l.toFixed(3)).join(',');
    if (key === this.levelKey) return;
    this.levelKey = key;
    const copies = this.copies ||= [];
    while (copies.length > levels.length - 1) this.outer.remove(copies.pop());
    while (copies.length < levels.length - 1) { const c = this.flat.clone(); this.outer.add(c); copies.push(c); }
    copies.forEach((c, i) => { c.position.y = levels[i + 1] - y; });
    for (const m of [this.edgeMat, this.fillMat, this.labelMat]) if (m) setLevels(m, levels);
    this.syncCopies();
  }
  // (the copies as the mark is now: its fill grown, a line as long)
  syncCopies() {
    for (const c of this.copies || []) {
      c.children.forEach((o, i) => {
        const s = this.flat.children[i];
        if (s) { o.geometry = s.geometry; o.position.copy(s.position); o.scale.copy(s.scale); o.visible = s.visible; }
      });
    }
  }
  // a line's length (it follows its aim up to a wall)
  setLength(L) {
    if (this.spec.shape !== 'line') return;
    this.lineLen = Math.max(0.05, L);
    for (const m of this.sides) m.scale.x = this.lineLen;
    this.endBar.position.x = this.lineLen;
    if (this.labelMesh) this.labelMesh.position.x = this.lineLen * 0.5;
    this.setProgress(this.progress ?? 0);
    if (this.pose) this.relevel();
  }
  setProgress(k) {
    k = Math.max(0, Math.min(1, k));
    this.progress = k;
    if (this.spec.shape === 'line') this.fill.scale.x = Math.max(0.001, this.lineLen * k);
    else if (this.spec.shape === 'ring') {
      if (Math.abs(k - (this.ringK ?? -1)) > 0.01) {
        this.ringK = k;
        const r0 = this.spec.r0;
        this.fill.geometry.dispose();
        this.fill.geometry = new THREE.RingGeometry(r0, r0 + Math.max(0.01, (this.spec.r - r0) * k), 72);
      }
    } else this.fill.scale.setScalar(Math.max(0.001, k));
    this.fillMat.opacity = 0.18 + 0.3 * k;
    this.syncCopies();
  }
  setColor(color) { this.edgeMat.color.setHex(color); this.fillMat.color.setHex(color); }
  setVisible(v) { this.outer.visible = v; }
  // fade out over a moment; returns true when gone
  fadeOut(dt) {
    this.fading += dt;
    const a = Math.max(0, 1 - this.fading / 0.25);
    this.edgeMat.opacity = 0.85 * a;
    this.fillMat.opacity = 0.45 * a;
    if (a <= 0) { this.dispose(); return true; }
    return false;
  }
  dispose() {
    this.parent?.remove(this.outer);
    this.outer.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.map) o.material.map.dispose(); });
    this.edgeMat.dispose(); this.fillMat.dispose();
    this.parent = null;
  }
}
