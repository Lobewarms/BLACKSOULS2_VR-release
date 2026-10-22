// Quick slots: hold the quick button (VR: X on the left controller, PC: Q) and a ring of 8 registered
// items / skills appears around the left hand (PC: in front of the camera). The game keeps running.
// Move the hand (PC: the mouse) toward a slot and release the button to use it; releasing near the
// middle cancels. Slots are registered from the item and skill menus and saved with the game.
import * as THREE from 'three';
import { G } from './globals.js';
import { tr } from './i18n.js';
import { $data } from './data.js';
import { FONT, drawIcon, stripEscapes } from './ui.js';

export const QUICK_SLOTS = 8;
const HEAL_ITEMS = [1, 3, 8];
const RING_R = 0.13;      // m from the centre to a slot
const DEAD = 0.045;       // hand closer than this to the centre = cancel
const SLOT_SIZE = 0.072;

export function quickSlots() {
  const st = G.state;
  if (!st) return [];
  if (!Array.isArray(st.quickSlots)) {
    st.quickSlots = new Array(QUICK_SLOTS).fill(null);
    // the old "drink a herb bottle" button lives on: the best heal item starts in slot 1
    const heal = HEAL_ITEMS.find(id => st.party.itemCount('item', id) > 0) || HEAL_ITEMS[0];
    st.quickSlots[0] = { kind: 'item', id: heal };
  }
  while (st.quickSlots.length < QUICK_SLOTS) st.quickSlots.push(null);
  return st.quickSlots;
}
export function entryData(e) {
  if (!e) return null;
  return (e.kind === 'skill' ? $data.skills[e.id] : $data.items[e.id]) || null;
}
export function quickSlotOf(entry) {
  return quickSlots().findIndex(s => s && s.kind === entry.kind && s.id === entry.id);
}
export function assignQuickSlot(index, entry) {
  const slots = quickSlots();
  if (entry) for (let i = 0; i < slots.length; i++) if (slots[i] && slots[i].kind === entry.kind && slots[i].id === entry.id) slots[i] = null;
  slots[index] = entry ? { kind: entry.kind, id: entry.id } : null;
}
// what a slot shows: name, icon, count or MP cost, and whether it can be used right now
export function entryStatus(e) {
  const d = entryData(e);
  if (!d) return null;
  const actor = G.state?.party.leader();
  if (e.kind === 'item') {
    const n = G.state.party.itemCount('item', d.id);
    return { name: stripEscapes(d.name), icon: d.icon_index, sub: `×${n}`, ok: n > 0 };
  }
  const cost = actor ? actor.skillMpCost(d) : d.mp_cost, hpCost = actor ? actor.skillHpCost(d) : 0;
  const known = !!actor && actor.allSkills().some(s => s.id === d.id);
  const cooling = G.combat?.skillCooling?.(d) || 0;
  const ok = known && actor.skillCostPayable(d) && !actor.skillSealed(d.id) && actor.skillTypeUsable(d) && cooling <= 0;
  return { name: stripEscapes(d.name), icon: d.icon_index, sub: cooling > 0 ? `${Math.ceil(cooling)}s` : (cost ? `MP ${cost}` : hpCost ? `HP ${hpCost}` : ''), ok };
}

// (also the emote ring's - src/emotes.js)
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function overlayMaterial(map) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
}

export class QuickRing {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'quick-ring';
    this.group.visible = false;
    this.slots = [];
    for (let i = 0; i < QUICK_SLOTS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SLOT_SIZE, SLOT_SIZE), overlayMaterial(tex));
      mesh.renderOrder = 1100;
      const a = Math.PI / 2 - i * Math.PI / 4;      // slot 1 on top, then clockwise
      mesh.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0);
      this.group.add(mesh);
      this.slots.push({ canvas, tex, mesh });
    }
    // the name of the slot under the hand, in the middle
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 512; this.labelCanvas.height = 128;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.0425), overlayMaterial(this.labelTex));
    this.label.renderOrder = 1101;
    this.group.add(this.label);
    // where the hand (PC: the mouse) is
    this.cursor = new THREE.Mesh(new THREE.CircleGeometry(0.009, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
    this.cursor.renderOrder = 1102;
    this.group.add(this.cursor);
    this.isOpen = false;
    this.sel = -1;
    this.cur = new THREE.Vector2();
    this.vrMode = false;
  }
  open() {
    const left = G.vr ? G.input.controllers.left : null;
    this.vrMode = !!left;
    if (left) {
      // centred on the left hand, facing the eyes, carried along with the player
      G.three.rig.add(this.group);
      const hand = left.grip.getWorldPosition(new THREE.Vector3());
      G.three.rig.updateWorldMatrix(true, false);
      this.group.position.copy(G.three.rig.worldToLocal(hand));
      this.group.scale.setScalar(1);
      this.group.lookAt(G.three.camera.getWorldPosition(new THREE.Vector3()));
    } else {
      G.three.camera.add(this.group);
      this.group.position.set(0, -0.03, -0.5);
      this.group.rotation.set(0, 0, 0);
      this.group.scale.setScalar(1.1);
    }
    this.cur.set(0, 0);
    this.sel = -1;
    this.isOpen = true;
    this.group.visible = true;
    this.redraw();
  }
  close() {
    this.isOpen = false;
    this.group.visible = false;
    this.group.parent?.remove(this.group);
  }
  // follows the hand / mouse and returns the slot under it (-1 = none)
  update() {
    if (!this.isOpen) return -1;
    if (this.vrMode) {
      const grip = G.input.controllers.left?.grip;
      if (grip) {
        this.group.updateWorldMatrix(true, false);
        const p = this.group.worldToLocal(grip.getWorldPosition(new THREE.Vector3()));
        this.cur.set(p.x / this.group.scale.x, p.y / this.group.scale.y);
      }
    } else {
      this.cur.x += G.input.mouse.dx * 0.0006;
      this.cur.y -= G.input.mouse.dy * 0.0006;
      if (this.cur.length() > RING_R + 0.03) this.cur.setLength(RING_R + 0.03);
    }
    const lim = RING_R + 0.05;
    this.cursor.position.set(THREE.MathUtils.clamp(this.cur.x, -lim, lim), THREE.MathUtils.clamp(this.cur.y, -lim, lim), 0.001);
    let sel = -1;
    if (this.cur.length() > DEAD) {
      const a = Math.atan2(this.cur.y, this.cur.x);
      sel = ((Math.round((Math.PI / 2 - a) / (Math.PI / 4)) % QUICK_SLOTS) + QUICK_SLOTS) % QUICK_SLOTS;
    }
    if (sel !== this.sel) {
      this.sel = sel;
      this.redraw();
      if (sel >= 0) { G.input.haptic('left', 0.25, 18); G.audio?.playSystemSe(0); }
    } else if (G.frame % 15 === 0) this.redraw();     // counts / MP / cooldowns change while it is open
    this.slots.forEach((s, i) => s.mesh.scale.setScalar(i === this.sel ? 1.3 : 1));
    return this.sel;
  }
  redraw() {
    const slots = quickSlots();
    for (let i = 0; i < QUICK_SLOTS; i++) this.drawSlot(i, slots[i]);
    this.drawLabel(this.sel >= 0 ? slots[this.sel] : null);
  }
  drawSlot(i, entry) {
    const s = this.slots[i];
    const ctx = s.canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const st = entry ? entryStatus(entry) : null;
    const on = i === this.sel;
    roundRect(ctx, 6, 6, 116, 116, 18);
    ctx.fillStyle = on ? 'rgba(78,60,26,0.94)' : 'rgba(12,10,8,0.8)';
    ctx.fill();
    ctx.lineWidth = on ? 7 : 3;
    ctx.strokeStyle = on ? '#ffd27a' : 'rgba(200,180,140,0.55)';
    ctx.stroke();
    if (st) {
      ctx.globalAlpha = st.ok ? 1 : 0.4;
      drawIcon(ctx, st.icon, 28, 20, 72);
      ctx.globalAlpha = 1;
      if (st.sub) {
        ctx.font = `bold 25px ${FONT}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(st.sub, 116, 114);
        ctx.fillStyle = st.ok ? '#ffffff' : '#ff9a9a';
        ctx.fillText(st.sub, 116, 114);
        ctx.textAlign = 'left';
      }
    }
    ctx.font = `bold 24px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,240,200,0.75)';
    ctx.fillText(String(i + 1), 16, 36);
    s.tex.needsUpdate = true;
  }
  drawLabel(entry) {
    const ctx = this.labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    const st = entry ? entryStatus(entry) : null;
    const text = st ? st.name : (this.sel >= 0 ? tr('(비어 있음)') : tr('놓으면 취소'));
    let size = 46;
    ctx.font = `bold ${size}px ${FONT}`;
    while (ctx.measureText(text).width > 490 && size > 22) { size -= 2; ctx.font = `bold ${size}px ${FONT}`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = st && !st.ok ? '#ff9a9a' : (st ? '#fff3d6' : 'rgba(255,255,255,0.7)');
    ctx.fillText(text, 256, 64);
    this.labelTex.needsUpdate = true;
  }
}
