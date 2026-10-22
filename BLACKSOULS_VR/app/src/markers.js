// Floor markers for map exits (Transfer Player events and region exits): a soft glowing ring,
// a faint light column, and the destination name when the player comes close.
import * as THREE from 'three';
import { G } from './globals.js';
import { T } from './mapmesh.js';
import { FONT } from './ui.js';

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(200,235,255,0.6)');
  g.addColorStop(0.55, 'rgba(150,210,255,0.3)');
  g.addColorStop(0.8, 'rgba(170,220,255,0.7)');
  g.addColorStop(1, 'rgba(170,220,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(235,248,255,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(64, 64, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
    ctx.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
function columnTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(190,230,255,0.6)');
  g.addColorStop(1, 'rgba(190,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}
function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = `40px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(`▸ ${text}`, 256, 48);
  ctx.fillStyle = '#dff1ff';
  ctx.fillText(`▸ ${text}`, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(1.4, 0.26, 1);
  s.renderOrder = 1200;
  return s;
}

export class TransferMarkers {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'exit-markers';
    scene.add(this.group);
    this.items = [];
    this.ringTex = ringTexture();
    this.colTex = columnTexture();
  }
  clear() {
    for (const it of this.items) {
      this.group.remove(it.root);
      it.label?.material.map.dispose();
    }
    this.items = [];
  }
  build(exits) {
    this.clear();
    const floor = (x, y) => (G.floorAt ? G.floorAt(x, y) : 0);
    // region exits: one glow per cell, one label per destination cluster
    const clusters = new Map();
    for (const ex of exits) {
      const root = new THREE.Group();
      root.position.set((ex.x + 0.5) * T, floor(ex.x, ex.y) + 0.06, (ex.y + 0.5) * T);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.95, T * 0.95), new THREE.MeshBasicMaterial({
        map: this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 900;
      root.add(ring);
      this.group.add(root);
      const item = { ex, root, ring, column: null, label: null, phase: Math.random() * 6 };
      this.items.push(item);
      if (ex.label) {
        const key = ex.kind === 'event' ? `e${ex.eventId}` : `r${ex.mapId}`;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key).push(item);
      }
    }
    // a faint light column: on every event exit, and once in the middle of each region exit strip
    const addColumn = it => {
      if (it.column) return;
      it.column = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.36, T * 0.42, 2.2, 20, 1, true), new THREE.MeshBasicMaterial({
        map: this.colTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
      }));
      it.column.position.y = 1.1;
      it.column.renderOrder = 901;
      it.root.add(it.column);
    };
    for (const it of this.items) if (it.ex.kind === 'event') addColumn(it);
    for (const list of clusters.values()) {
      const it = list[Math.floor(list.length / 2)];
      addColumn(it);
      it.label = labelSprite(it.ex.label);
      it.label.position.y = 1.9;
      it.label.visible = false;
      it.root.add(it.label);
    }
  }
  update(dt, head) {
    if (!this.items.length) return;
    this.group.visible = !G.arena?.active;     // a closed boss arena: the ways out are fog, not exits
    if (!this.group.visible) return;
    const t = G.time;
    const pc = G.map?.playerChar;
    for (const it of this.items) {
      // hide exits whose event page no longer leads anywhere (e.g. a door that got locked)
      if (it.ex.kind === 'event') {
        const ev = G.map.events[it.ex.eventId];
        it.root.visible = !!ev && !!ev.page && !ev.erased;
      }
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.2 + it.phase);
      it.ring.material.opacity = 0.7 + 0.3 * pulse;
      it.ring.rotation.z = t * 0.25;
      if (it.column) it.column.material.opacity = 0.45 + 0.25 * pulse;
      // (a looping map: at its copy nearest to the player)
      if (pc && (G.map.loopX || G.map.loopY)) {
        const b = it.base || (it.base = it.root.position.clone());
        it.root.position.x = b.x + (G.map.nearX(it.ex.x, pc.fx) - it.ex.x) * T;
        it.root.position.z = b.z + (G.map.nearY(it.ex.y, pc.fy) - it.ex.y) * T;
      }
      if (it.label && pc) {
        const d = Math.hypot(G.map.nearX(it.ex.x, pc.fx) - pc.fx, G.map.nearY(it.ex.y, pc.fy) - pc.fy);
        it.label.visible = d < 4.5;
        it.label.material.opacity = Math.max(0, Math.min(1, (4.5 - d) / 1.5));
      }
    }
    void head; void dt;
  }
}
