// Floor markers for map exits (Transfer Player events and region exits): a soft glowing ring,
// a faint light column, and the destination name when the player comes close.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from './mapmesh.js';
import { FONT } from '../ui/ui.js';
import { transferOf } from './mapanalysis.js';
import { exitEventPosition } from './exit-routes.js';
import { $data } from '../data/data.js';

// Native command lists are static records. Reuse their structural analysis while
// watching page/list replacements, appended commands and referenced common-event
// data. Keep transfer parameters live, including the unresolved variable mode.
function exitRoute(markers, page) {
  const cached = markers.routes.get(page);
  let current = !!cached;
  if (cached) for (const check of cached.checks) {
    if (check.object?.[check.key] !== check.value) { current = false; break; }
  }
  if (current) return cached.route;
  const checks = [], seen = new WeakMap();
  const watch = (object, key) => {
    const value = object?.[key]; checks.push({ object, key, value }); return value;
  };
  const commonEvents = watch($data, 'commonEvents');
  watch(G, 'map'); watch(G.map, 'exitRevision');
  const inspect = (list, depth) => {
    if (!Array.isArray(list) || (seen.get(list) ?? Infinity) <= depth) return;
    seen.set(list, depth); watch(list, 'length');
    for (let i = 0; i < list.length; i++) {
      const command = list[i], code = command.code;
      if (![102, 117, 201, 205].includes(code)) continue;
      watch(list, i); watch(command, 'code');
      const parameters = watch(command, 'parameters');
      if (code === 201) for (let p = 0; p < 4; p++) watch(parameters, p);
      else if (code === 117 && depth < 3) {
        // transferOf checks one called event; its fall guard can inspect two
        // further levels of common events before deciding it is a usable exit.
        const id = watch(parameters, 0), event = watch(commonEvents, id);
        inspect(watch(event, 'list'), depth + 1);
      } else if (code === 205) {
        watch(parameters, 0);
        const route = watch(parameters, 1), steps = watch(route, 'list');
        if (!Array.isArray(steps)) continue;
        watch(steps, 'length');
        for (let step = 0; step < steps.length; step++) {
          const move = watch(steps, step); watch(move, 'code');
          const args = watch(move, 'parameters'); watch(args, 'length');
          for (let p = 0; p < (args?.length || 0); p++) watch(args, p);
        }
      }
    }
  };
  inspect(watch(page, 'list'), 0);
  const route = transferOf(page.list);
  markers.routes.set(page, { checks, route });
  return route;
}

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
    this.routes = new WeakMap();
    this.ringTex = ringTexture();
    this.colTex = columnTexture();
  }
  clear() {
    for (const it of this.items) {
      this.group.remove(it.root);
      it.root.traverse(object => {
        if (object.isMesh) object.geometry.dispose();
        if (!object.material) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material.map && material.map !== this.ringTex && material.map !== this.colTex) material.map.dispose();
          material.dispose();
        }
      });
    }
    this.items = [];
    this.routes = new WeakMap();
  }
  build(exits) {
    this.clear();
    this.mapId = G.map?.mapId;
    this.group.visible = !G.arena?.active;
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
      const item = { ex: { ...ex }, root, ring, column: null, label: null, phase: Math.random() * 6 };
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
    if (!this.items.length) return false;
    this.group.visible = !G.arena?.active && this.mapId === G.map?.mapId;     // closed arenas and the old map have no usable exits
    if (!this.group.visible) return false;
    const t = G.time;
    const pc = G.map?.playerChar;
    let changed = false;
    for (const it of this.items) {
      // hide exits whose event page no longer leads anywhere (e.g. a door that got locked)
      if (it.ex.kind === 'event') {
        const ev = G.map.events[it.ex.eventId], position = exitEventPosition(G.map, ev);
        const route = ev && !ev.erased && ev.page?.trigger <= 2 ? exitRoute(this, ev.page) : null;
        it.root.visible = !!position && !!route && route.mapId === it.ex.mapId;
        if (!it.root.visible || ev.page.trigger !== it.ex.trigger) changed = true;
        if (position && (position.x !== it.ex.x || position.y !== it.ex.y)) {
          it.ex.x = position.x; it.ex.y = position.y; changed = true;
        }
        if (!it.root.visible) continue;
      }
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.2 + it.phase);
      it.ring.material.opacity = 0.7 + 0.3 * pulse;
      it.ring.rotation.z = t * 0.25;
      if (it.column) it.column.material.opacity = 0.45 + 0.25 * pulse;
      // Runtime events can move without changing page. Follow their current cell
      // and its floor; looping copies stay the nearest one to the player.
      const x = pc ? G.map.nearX(it.ex.x, pc.fx) : it.ex.x, y = pc ? G.map.nearY(it.ex.y, pc.fy) : it.ex.y;
      it.root.position.set((x + 0.5) * T, (G.floorAt?.(it.ex.x, it.ex.y) ?? 0) + 0.06, (y + 0.5) * T);
      if (it.label && pc) {
        const d = Math.hypot(G.map.nearX(it.ex.x, pc.fx) - pc.fx, G.map.nearY(it.ex.y, pc.fy) - pc.fy);
        it.label.visible = d < 4.5;
        it.label.material.opacity = Math.max(0, Math.min(1, (4.5 - d) / 1.5));
      }
    }
    void head; void dt;
    return changed;
  }
}
