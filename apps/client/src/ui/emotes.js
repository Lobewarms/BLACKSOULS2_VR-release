// Emotes: hold the emote button (VR: B on the right controller - outside menus and messages it does nothing else;
// PC: T) and a ring of the game's balloon icons (Graphics/System/Balloon: ! ? ♪ ♥ and the rest) appears round the
// right hand (PC: in front of the camera). Move the hand (PC: the mouse) onto one and let go: it comes up over this
// player's head as the original's balloons do, its last frame held a while - over its own head in its own view too
// (looking up shows it - main.js updatePlayerBalloon), and playing together, over its figure for the others (coop.js
// poseMsg: the player's balloon). Letting go near the middle puts up nothing. Never in an event, a message or a menu.
// Playing together, a chat slot (a speech balloon) stands under the ring, outside it - the balloons keep their places:
// let go on it, the chat keyboard opens (coopchat.js - VR has no button left for it; PC has its / key too).
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { BALLOON_TIME, balloonSheetNow } from './balloons.js';
import { roundRect, overlayMaterial } from './quickslots.js';

const MOST = 10;             // balloons offered: the sheet's rows, this many at most (the RTP's ten)
const RING_R = 0.14;         // m from the centre to a slot
const DEAD = 0.045;          // the hand closer than this to the centre: nothing
const SLOT_SIZE = 0.066;
const HOLD = 2;              // s its last frame stays up once it has come up (the coming up itself: BALLOON_TIME)
const AGAIN = 0.2;           // s with none up before the same one comes up again (so the others see it come anew)
const LAST = 12;             // balloon ticks left that show its last frame (balloons.js balloonFrame)
const CHAT_AT = -(RING_R + 0.085);   // m: the chat slot's place, under the ring

export class EmoteRing {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'emote-ring';
    this.group.visible = false;
    this.slots = [];
    this.sheet = null;
    // where the hand (PC: the mouse) is
    this.cursor = new THREE.Mesh(new THREE.CircleGeometry(0.009, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
    this.cursor.renderOrder = 1102;
    this.group.add(this.cursor);
    this.isOpen = false;
    this.sel = -1;
    this.cur = new THREE.Vector2();
    this.vrMode = false;
    this.chat = null;          // the chat slot (made the first time it is wanted)
  }
  // the chat slot under the ring, shown while playing together
  chatSlot() {
    if (!this.chat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SLOT_SIZE, SLOT_SIZE), overlayMaterial(tex));
      mesh.renderOrder = 1100;
      mesh.position.set(0, CHAT_AT, 0);
      this.group.add(mesh);
      this.chat = { canvas, tex, mesh, chat: true };
    }
    return this.chat;
  }
  // a slot for each balloon of the sheet (made once it has come)
  build(sheet) {
    const n = Math.min(MOST, sheet.rows);
    for (let i = 0; i < n; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SLOT_SIZE, SLOT_SIZE), overlayMaterial(tex));
      mesh.renderOrder = 1100;
      const a = Math.PI / 2 - i * 2 * Math.PI / n;      // the first on top, then clockwise
      mesh.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0);
      this.group.add(mesh);
      this.slots.push({ canvas, tex, mesh, id: i + 1 });
    }
    this.sheet = sheet;
  }
  // false: no balloons to offer (the sheet has not come yet, or there is none - it comes with the RPG Maker VX Ace RTP)
  open() {
    const sheet = balloonSheetNow();
    if (!sheet) return false;
    if (!this.slots.length) this.build(sheet);
    const together = !!G.chat?.on;
    if (together || this.chat) this.chatSlot().mesh.visible = together;
    const right = G.vr ? G.input.controllers.right : null;
    this.vrMode = !!right;
    if (right) {
      // centred on the right hand, facing the eyes, carried along with the player
      G.three.rig.add(this.group);
      const hand = right.grip.getWorldPosition(new THREE.Vector3());
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
    return true;
  }
  close() {
    this.isOpen = false;
    this.group.visible = false;
    this.group.parent?.remove(this.group);
  }
  // follows the hand / mouse; the slot under it (-1: none)
  update() {
    if (!this.isOpen) return -1;
    if (this.vrMode) {
      const grip = G.input.controllers.right?.grip;
      if (grip) {
        this.group.updateWorldMatrix(true, false);
        const p = this.group.worldToLocal(grip.getWorldPosition(new THREE.Vector3()));
        this.cur.set(p.x / this.group.scale.x, p.y / this.group.scale.y);
      }
    } else {
      this.cur.x += G.input.mouse.dx * 0.0006;
      this.cur.y -= G.input.mouse.dy * 0.0006;
      // (down to the chat slot too, while it is there)
      const reach = this.chat?.mesh.visible && this.cur.y < -RING_R * 0.6 ? -CHAT_AT + 0.02 : RING_R + 0.03;
      if (this.cur.length() > reach) this.cur.setLength(reach);
    }
    const lim = RING_R + 0.05;
    this.cursor.position.set(THREE.MathUtils.clamp(this.cur.x, -lim, lim), THREE.MathUtils.clamp(this.cur.y, this.chat?.mesh.visible ? CHAT_AT - 0.03 : -lim, lim), 0.001);
    const n = this.slots.length;
    let sel = -1;
    if (this.chat?.mesh.visible && Math.hypot(this.cur.x, this.cur.y - CHAT_AT) < SLOT_SIZE * 0.8) sel = 'chat';
    else if (n && this.cur.length() > DEAD) {
      const step = 2 * Math.PI / n;
      sel = ((Math.round((Math.PI / 2 - Math.atan2(this.cur.y, this.cur.x)) / step) % n) + n) % n;
    }
    if (sel !== this.sel) {
      this.sel = sel;
      this.redraw();
      if (sel !== -1) { G.input.haptic('right', 0.25, 18); G.audio?.playSystemSe(0); }
    }
    this.slots.forEach((s, i) => s.mesh.scale.setScalar(i === this.sel ? 1.3 : 1));
    this.chat?.mesh.scale.setScalar(this.sel === 'chat' ? 1.3 : 1);
    return this.sel;
  }
  redraw() { this.slots.forEach((s, i) => this.drawSlot(s, i === this.sel)); if (this.chat?.mesh.visible) this.drawSlot(this.chat, this.sel === 'chat'); }
  drawSlot(s, on) {
    const ctx = s.canvas.getContext('2d'), sh = this.sheet;
    ctx.clearRect(0, 0, 128, 128);
    roundRect(ctx, 6, 6, 116, 116, 18);
    ctx.fillStyle = on ? 'rgba(78,60,26,0.94)' : 'rgba(12,10,8,0.8)';
    ctx.fill();
    ctx.lineWidth = on ? 7 : 3;
    ctx.strokeStyle = on ? '#ffd27a' : 'rgba(200,180,140,0.55)';
    ctx.stroke();
    if (s.chat) {
      // Native silence balloon (ellipsis) is the chat affordance, matching the
      // other ring assets instead of introducing replacement artwork.
      ctx.imageSmoothingEnabled = false;
      const row = Math.min(7, sh.rows - 1);
      ctx.drawImage(sh.canvas, Math.min(7, sh.cols - 1) * 32, row * 32, 32, 32, 16, 16, 96, 96);
      s.tex.needsUpdate = true;
      return;
    }
    // the balloon as it stands once it has come up: its row's last frame, its pixels kept sharp
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sh.canvas, Math.min(7, sh.cols - 1) * 32, (s.id - 1) * 32, 32, 32, 16, 16, 96, 96);
    s.tex.needsUpdate = true;
  }
}

export class Emotes {
  constructor() {
    this.ring = new EmoteRing();
    this.up = 0;               // the balloon this player put up (0: none)
    this.until = 0;            // (G.time) its last frame held till then
    this.again = null;         // { id, at }: the same one again, after a moment with none
  }
  // every frame (combat.js update): the ring - opened, followed, let go of - and the balloon put up
  update(paused) {
    const input = G.input, ring = this.ring, C = G.combat;
    const blocked = paused || !!C?.playerDead || !!C?.gripAdjust || !!C?.quick?.isOpen || G.ui.menuOpen || !!G.ui.msg || !!G.ui.sceneOpen;
    balloonSheetNow();                               // (the balloons on hand before the button is first pressed)
    this.keepUp();
    if (ring.isOpen) {
      if (blocked) { ring.close(); return; }
      ring.update();
      if (!input.emoteHeld()) {                      // let go: what is under the hand comes up
        const sel = ring.sel;
        ring.close();
        if (sel === 'chat') G.chat?.openKeyboard();
        else if (sel >= 0) this.put(ring.slots[sel].id);
      }
      return;
    }
    if (!blocked && input.emotePressed()) ring.open();
  }
  // a balloon over this player's head - the original's own way, the player's balloon (an event's Show Balloon Icon
  // puts one up there too); the same one again comes up anew
  put(id) {
    const pc = G.map?.playerChar;
    if (!pc) return;
    if (pc.balloonId === id) { pc.balloonId = 0; pc.balloonTime = 0; this.up = 0; this.again = { id, at: G.time + AGAIN }; return; }
    this.again = null;
    pc.balloonId = id; pc.balloonTime = BALLOON_TIME;
    this.up = id; this.until = G.time + BALLOON_TIME / 60 + HOLD;
  }
  // (its last frame held till its time is up - unless an event put a balloon of its own on the player meanwhile)
  keepUp() {
    const pc = G.map?.playerChar;
    if (this.again && G.time >= this.again.at) { const { id } = this.again; this.again = null; this.put(id); }
    if (!this.up || !pc) return;
    if (pc.balloonId !== this.up || G.time >= this.until) { this.up = 0; return; }
    if (pc.balloonTime < LAST) pc.balloonTime = LAST;
  }
}
