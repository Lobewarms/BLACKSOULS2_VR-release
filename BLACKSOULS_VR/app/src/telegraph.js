// Floor markers ("telegraphs") for attacks: where an enemy attack will land while it winds up, and
// where the player's readied spell will go. The outline shows the whole area at once; the fill grows
// from the centre as the attack charges (a ring: from its inner edge out). Orange = normal, purple = sure hit
// (cannot be dodged), pink with a pulsing edge = no plain guard stops it, crimson with a pulsing edge = both, blue =
// yours.
import * as THREE from 'three';

export const MARK = { enemy: 0xff5a1e, certain: 0xb050ff, heavy: 0xff66cc, certainHeavy: 0xff0a3c, player: 0x5ab4ff };
export const EDGE = 0.07;                           // m: the outline's width

function mat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    m.position.set(this.spec.shape === 'line' ? this.spec.len * 0.5 : 0, 0, 0.01);
    m.renderOrder = 6;
    this.flat.add(m);
    this.labelMesh = m;
  }
  // x, z: origin (circle centre / sector apex / line start); y: floor height; heading: world atan2(dz, dx)
  setPose(x, y, z, heading = 0) {
    this.outer.position.set(x, y + 0.045, z);
    this.outer.rotation.y = -heading;
  }
  // a line's length (it follows its aim up to a wall)
  setLength(L) {
    if (this.spec.shape !== 'line') return;
    this.lineLen = Math.max(0.05, L);
    for (const m of this.sides) m.scale.x = this.lineLen;
    this.endBar.position.x = this.lineLen;
    if (this.labelMesh) this.labelMesh.position.x = this.lineLen * 0.5;
    this.setProgress(this.progress ?? 0);
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
