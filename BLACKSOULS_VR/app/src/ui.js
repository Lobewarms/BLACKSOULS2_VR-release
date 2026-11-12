// VR-friendly UI: message window (RPG Maker escape codes), choices, number input, HUD,
// notifications, pause menu, shop, bonfire warp.
import * as THREE from 'three';
import { G } from './globals.js';
import { fittingHeight, LINE, PAD } from './rmwindow.js';
import { cleanChat } from './coopchat.js';
import { FONT } from './fonts.js';
import { convertEscapes, stripEscapes, bannerOf, loadUiAssets, textColor, getIconSet, drawIcon } from './uitext.js';
import { CHAT_ROWS, DESK_HUD, GridPanel, HUD_M, HUD_W, KeyboardPanel, ListPanel, MS, MW,
  MenuScreen, PPM, Panel, VOICE_BADGE, clipChat } from './ui/common.js';
import { MessagePart } from './ui/messages.js';
import { CoopMenuPart } from './ui/coopmenu.js';
import { HudPart } from './ui/hud.js';
import { MenuPart } from './ui/menus.js';
import { HeldPart } from './ui/heldadjust.js';
import { MacroMenuPart } from './ui/macros.js';
export { FONT };              // (the game's font list - fonts.js; the others take it from here)
export { convertEscapes, stripEscapes, bannerOf, loadUiAssets, textColor, getIconSet, drawIcon };   // (uitext.js)

// ------------------------------------------------------------------ UI
export class UI {
  constructor(scene, camera, rig) {
    this.scene = scene; this.camera = camera; this.rig = rig;
    this.root = new THREE.Group();          // world-space anchor in front of the user
    scene.add(this.root);
    // the message windows, in the original's pixels (MW canvas pixels each, PPM a metre): the message window (Window_Message,
    // the screen's width x 4 lines), the speaker's name (ネームウィンドウ), the choices (Window_ChoiceList - its other
    // questions, this version's, in the list's own windows 760 wide) and the gold (Window_Gold, opened by \$)
    this.msgPanel = new Panel(640 * MW, fittingHeight(4) * MW, 640 * MW / PPM);
    this.root.add(this.msgPanel.mesh);
    this.namePanel = new Panel(320 * MW, 28 * MW, 320 * MW / PPM);
    this.namePanel.mesh.renderOrder = 3101;
    this.root.add(this.namePanel.mesh);
    this.choice = new ListPanel(640 * MW, 6, 640 * MW / PPM, { fit: true, drawW: 760 });
    this.root.add(this.choice.panel.mesh);
    this.goldPanel = new Panel(160 * MW, fittingHeight(1) * MW, 160 * MW / PPM);
    this.root.add(this.goldPanel.mesh);
    // the scrolling text (startScroll): its pieces rise inside the mover, cut to the window's inside by two planes
    this.scrollGroup = new THREE.Group();
    this.scrollGroup.visible = false;
    this.scrollMover = new THREE.Group();
    this.scrollGroup.add(this.scrollMover);
    this.root.add(this.scrollGroup);
    this.scrollClip = [new THREE.Plane(), new THREE.Plane()];
    this.scroll = null;
    this.list = new ListPanel(980, 8, 0.98);
    this.root.add(this.list.panel.mesh);
    this.grid = new GridPanel(1260, 3, 6, 1.2);
    this.root.add(this.grid.panel.mesh);
    this.menuScreen = new MenuScreen(1.2);
    this.root.add(this.menuScreen.panel.mesh);
    this.keyboard = new KeyboardPanel();
    this.root.add(this.keyboard.panel.mesh);
    this.chatKeyboard = new KeyboardPanel(CHAT_ROWS, clipChat, cleanChat);      // (a chat line: coopchat.js)
    this.root.add(this.chatKeyboard.panel.mesh);
    this.bannerPanel = new Panel(1600, 260, 2.2);
    this.root.add(this.bannerPanel.mesh);
    this.toastPanel = new Panel(900, 300, 0.75);
    this.root.add(this.toastPanel.mesh);
    // the status panel: over all the world (PC and VR) - a raised shield, a wall, the marks over heads, skill animations -,
    // under the screen's tone, flash and fade as before (screen.js: 2990-3000) and the windows
    this.hud = new Panel(HUD_W * MS, (PAD * 2 + LINE * 4.5) * MS, HUD_M * HUD_W);       // (as tall as it gets: with the icons' row)
    this.hud.mesh.renderOrder = 2989;
    // (co-op) the voice chat marks just right of it, at its top (voicemarks.js - drawVoiceBadge): with it wherever it goes
    this.voiceBadge = new Panel(VOICE_BADGE[0], VOICE_BADGE[1], HUD_M / MS * VOICE_BADGE[0]);
    this.voiceBadge.mesh.renderOrder = this.hud.mesh.renderOrder;
    this.voiceBadge.mesh.position.set((this.hud.widthM + this.voiceBadge.widthM) / 2 + HUD_M / MS * 10, (this.hud.heightM - this.voiceBadge.heightM) / 2 - HUD_M / MS * 6, 0);
    this.hud.mesh.add(this.voiceBadge.mesh);
    this.voiceBadgeKey = '';
    this.raycaster = new THREE.Raycaster();
    this.pointerLine = null;
    this.msg = null;
    this.menuOpen = false;
    this.sceneOpen = null;
    this.prompt = null;                     // (co-op) join the boss fight? - askBossJoin
    this.remote = null;                     // (co-op) the host's message, to read - showRemoteMessage
    this.toasts = [];
    this.banner = null;
    this.nameWindowEnabled = true;
    this.nextName = null;
    this.numberRange = null;
    this.consumedConfirm = false;
    this.anchorYaw = null;
    this.hudDirty = true;
    this.lastHud = '';
  }

  // ---------------------------------------------------------------- placement
  // keep UI in front of the user; re-centre when they look away
  placeRoot(force = false) {
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const yaw = Math.atan2(-f.x, -f.z);
    if (this.anchorYaw === null || force) this.anchorYaw = yaw;
    let d = yaw - this.anchorYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.75) this.anchorYaw += d * 0.08;
    const dist = G.vr ? 1.35 : 1.15;
    const a = this.anchorYaw;
    this.root.position.set(head.x - Math.sin(a) * dist, head.y, head.z - Math.cos(a) * dist);
    this.root.rotation.set(0, a, 0);
  }

  attachHud(target) {
    if (this.hud.mesh.parent) this.hud.mesh.parent.remove(this.hud.mesh);
    this.hudFollow = target || null;
    if (target) {
      // VR: small panel floating just above the left controller, turned toward the eyes
      this.scene.add(this.hud.mesh);
      this.hud.mesh.scale.setScalar(1);
    } else {
      // PC: in the screen's bottom left corner (placeDeskHud: kept there as the window's shape changes)
      this.camera.add(this.hud.mesh);
      this.hud.mesh.rotation.set(0, 0, 0);
      this.placeDeskHud();
    }
    this.hud.mesh.visible = true;
  }
  // PC: the status panel in the bottom left corner of the screen, the window it draws a little in from both edges
  placeDeskHud() {
    const cam = this.camera, d = 0.6, p = this.hud;
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d, w = h * cam.aspect, gap = 0.025 * h;
    const k = DESK_HUD * HUD_W * h / p.widthM, drawn = p.heightM * (this.hudDrawn || p.canvas.height) / p.canvas.height;
    p.mesh.scale.setScalar(k);
    p.mesh.position.set(-w / 2 + gap + p.widthM * k / 2, -h / 2 + gap + (drawn - p.heightM / 2) * k, -d);
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.consumedConfirm = false;
    this.pointerTarget = false;
    if (this.actionLockUntil && G.time < this.actionLockUntil) this.consumedConfirm = true;
    const anyPanel = this.msg || this.menuOpen || this.sceneOpen || this.banner || this.toasts.length || this.remote?.shown || this.prompt?.shown;
    if (anyPanel) this.placeRoot();
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.dur) {
        const b = this.banner;
        this.banner = null;
        if (b.blocking) G.arena?.onBannerEnd();          // VICTORY ACHIEVED after a boss: back to where it began
      }
      this.drawBanner();
    }
    if (this.msg) this.updateMessage(dt);
    else if (this.menuOpen || this.sceneOpen) {
      if (this.keyboard.visible) this.keyboard.update(this.pointerRay());
      else if (this.chatKeyboard.visible) this.chatKeyboard.update(this.pointerRay());
      else if (this.grid.visible) this.grid.update(this.pointerRay());
      else if (this.menuScreen.visible) this.menuScreen.update(this.pointerRay());
      else if (this.list.visible) this.list.update(this.pointerRay());
      this.consumedConfirm = true;
    } else if (G.input.menu() && G.map && (!G.map.interpreter.running() || G.map.interpreter.waitMode === 'battle') && !G.combat?.playerDead) {
      // (an event holding the map for its fight - 그랑・기뇰's play: the menu opens as in any fight, as walking goes on)
      this.openMenu();
    }
    this.updateBossPrompt(dt);
    this.updateRemote(dt);
    if (this.toasts.length) {
      for (const t of this.toasts) t.t += dt;
      const before = this.toasts.length;
      this.toasts = this.toasts.filter(t => t.sticky || t.t < (t.life || 3.5));
      if (before !== this.toasts.length || G.frame % 6 === 0) this.drawToasts();
    }
    this.drawHud();
    this.updateHudFollow();
    this.updatePointerLine();
  }
  updateHudFollow() {
    if (!this.hudFollow) { if (this.hud.mesh.parent === this.camera) this.placeDeskHud(); return; }
    const p = new THREE.Vector3();
    this.hudFollow.getWorldPosition(p);
    p.y += 0.11;
    this.hud.mesh.position.copy(p);
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    this.hud.mesh.lookAt(head);
  }
  // snap turning stays off while a menu / choice uses the right stick
  blocksTurning() { return this.menuOpen || !!this.sceneOpen || this.msg?.state === 'choice' || this.msg?.state === 'number' || !!this.prompt?.shown; }
  updatePointerLine() {
    const c = G.input.controllers.right;
    const need = G.vr && c && ((this.msg && this.msgPanel.mesh.visible) || this.msg?.state === 'choice' || this.menuOpen || this.sceneOpen || this.prompt?.shown);
    if (!this.pointerLine && c) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]);
      this.pointerLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe8d8a8, transparent: true, opacity: 0.6 }));
      this.pointerLine.renderOrder = 3050;      // seen on a dark screen too, under the panels it points at
      c.ray.add(this.pointerLine);
    }
    if (this.pointerLine) this.pointerLine.visible = !!need;
  }
}
// UI's methods, kept by what they are about in ui/*.js: each its own
for (const part of [MessagePart, CoopMenuPart, HudPart, MenuPart, HeldPart, MacroMenuPart]) {
  for (const k of Object.getOwnPropertyNames(part.prototype)) {
    if (k !== 'constructor') Object.defineProperty(UI.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k));
  }
}
