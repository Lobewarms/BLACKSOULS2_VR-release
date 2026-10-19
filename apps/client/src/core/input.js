// Unified input: Quest Touch controllers (WebXR, xr-standard mapping) + keyboard/mouse fallback.
import * as THREE from 'three';
import { G } from './globals.js';

const DEAD = 0.18;
const dz = v => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
const grabState = source => ({ source, events: false, held: !!source?.gamepad?.buttons[1]?.pressed, pending: false, pressed: false });
const hasGrabSource = (session, source) => !!source && Array.from(session?.inputSources || []).includes(source);

export class Input {
  constructor(renderer, dom) {
    this.renderer = renderer;
    this.dom = dom;
    this.keys = new Set();
    this.keysPrev = new Set();
    this.rmCancelFrame = null;                      // native Escape unlock, for the next original event logic tick
    this.mouse = { dx: 0, dy: 0, buttons: 0, prevButtons: 0, wheel: 0 };
    this.mousePresses = 0;                         // clicks completed between rendered frames still count once
    this.pointer = { x: 0, y: 0, seen: false };
    this.pointerLocked = false;
    this.desktopLookWanted = false;
    this.pointerUiPaused = false;
    this.softLook = false;
    this.dialogueDrag = false;
    this.lockPending = false;
    this.scriptUnlockPending = false;
    this.pageFocused = document.hasFocus?.() ?? true;
    this.normalCursor = dom.style?.cursor || '';
    if (dom.tabIndex < 0) dom.tabIndex = 0;
    this.lockFresh = 0;                              // movements right after the lock still to be checked
    this.lastMoves = [];                             // sizes of the last few movements taken
    this.dropNext = true;                            // (never two drops in a row: a fast flick is many big movements)
    this.mouseSpikes = [];                           // (developer checks: the last movements dropped)
    this.hands = { left: null, right: null };       // {source, gamepad}
    this.btn = { left: [], right: [] };              // current pressed booleans
    this.btnPrev = { left: [], right: [] };
    this.axes = { left: [0, 0], right: [0, 0] };
    this.controllers = {};                           // three.js controller spaces
    this.grabs = { left: grabState(null), right: grabState(null) };
    this.grabSession = null;
    this.runToggle = false;
    this.snapReady = true;
    this.viewVr = !!G.vr;
    this.desktopLookBeforeVr = false;
    this.modeUnlockPending = false;
    this.viewInputGuard = false;
    this.viewXrSources = { left: null, right: null };
    this.viewButtonBlocks = { left: [], right: [] };
    this.viewAxisBlocks = { left: false, right: false };

    addEventListener('keydown', e => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;     // (typing a name: ui.js keyboard)
      this.keys.add(e.code);
      if (e.code === 'Escape' && !this.pointerBusy() && !this.pointerLocked) this.stopDesktopLook();
      else if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) &&
        this.desktopLookWanted && !this.pointerUiPaused && !this.pointerLocked && !this.pointerBusy()) this.lockPointer();
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) || e.code === 'F1' && G.ui?.menuOpen) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.pageFocused = false;
      this.stopDesktopLook();
      this.keys.clear(); this.keysPrev.clear();
      this.rmCancelFrame = null;
      this.releaseMouse();
    });
    addEventListener('focus', () => { this.pageFocused = true; });
    dom.addEventListener('mousedown', e => {
      this.trackPointer(e);
      if (this.dialogueLooking()) { e.preventDefault?.(); return; }
      if (e.button === 2 && this.dialogueLookAllowed() && this.onCanvas(e)) {
        this.suspendPointerForUi();
        this.releaseMouse();
        this.dialogueDrag = true;
        this.lockFresh = 2;
        this.updateCursor();
        e.preventDefault?.();
        return;
      }
      const button = 1 << e.button;
      if (!(this.mouse.buttons & button)) this.mousePresses |= button;
      this.mouse.buttons |= button;
      const busy = this.pointerBusy();
      if (!this.pointerLocked && !G.vr && !busy) this.lockPointer();
    });
    addEventListener('mouseup', e => {
      if (this.dialogueLooking() && e.button === 2) { this.endDialogueLook(true); return; }
      this.mouse.buttons &= ~(1 << e.button);
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => this.onMouseMove(e));
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const hadLock = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === dom;
      this.lockPending = false;
      if (!this.pointerLocked) {
        this.releaseMouse();
        const modeUnlock = this.modeUnlockPending;
        const scripted = this.scriptUnlockPending || modeUnlock;
        this.scriptUnlockPending = false;
        this.modeUnlockPending = false;
        // Escape can unlock the browser without a keyboard event. Original
        // picture-view autoruns still need their B condition to run its own
        // switch/Erase Picture commands. Keep this until logic advances, not
        // merely until a high-refresh render ends; scripted UI releases and
        // focus loss must never synthesize an event cancel.
        if (!scripted && hadLock && !G.vr && !this.pointerBusy() && this.pageFocused && document.hasFocus?.() !== false) {
          this.requestRmCancel();
        }
        if (!scripted && hadLock && this.pointerBusy() && this.pageFocused && document.hasFocus?.() !== false) {
          this.desktopLookWanted = true; this.pointerUiPaused = true; this.softLook = false;
        } else if (!scripted && hadLock) this.stopDesktopLook();
        else if (scripted && !modeUnlock && this.desktopLookWanted && !this.pointerUiPaused && this.pageFocused && !this.pointerBusy()) this.lockPointer();
      } else {
        this.scriptUnlockPending = false;
        if (G.vr) {
          // A desktop capture request can complete after XR has started.
          // Release that late lock without manufacturing original event B.
          this.stopDesktopLook(); this.modeUnlockPending = true;
          document.exitPointerLock?.();
        } else {
          this.desktopLookWanted = true; this.softLook = false;
          if (this.pointerBusy()) this.suspendPointerForUi();
        }
      }
      this.lockFresh = this.pointerLocked || this.softLook ? 2 : 0;
      this.lastMoves = []; this.dropNext = true;
      this.updateCursor();
    });
    document.addEventListener('pointerlockerror', () => { this.lockPending = false; this.enableSoftLook(); });
    dom.addEventListener('mouseleave', () => {
      if (!this.pointerLocked) {
        if (this.dialogueDrag) this.endDialogueLook();
        this.mouse.dx = this.mouse.dy = 0; this.lockFresh = 2;
      }
    });
  }

  pointerBusy() { return !!(G.ui?.pointerBusy?.() ?? (G.ui?.sceneBusy?.() || G.ui?.messageBusy?.())); }
  textInputFocused() { const active = document.activeElement; return !!active?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || ''); }
  onCanvas(e) {
    const rect = this.dom?.getBoundingClientRect?.();
    return !!rect && (!e.target || e.target === this.dom) && Number.isFinite(e.clientX) && Number.isFinite(e.clientY) &&
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  }
  dialogueLookAllowed() {
    return !!(!G.vr && !this.pointerLocked && this.pageFocused !== false && document.hasFocus?.() !== false &&
      !this.textInputFocused() && G.ui?.dialogueLookAllowed?.());
  }
  dialogueLooking() {
    if (!this.dialogueDrag) return false;
    if (!this.dialogueLookAllowed()) { this.endDialogueLook(); return false; }
    return true;
  }
  endDialogueLook(keepMotion = false) {
    const { dx, dy } = this.mouse;
    this.releaseMouse();
    if (keepMotion) { this.mouse.dx = dx; this.mouse.dy = dy; }
    this.updateCursor();
  }
  updateCursor() { if (this.dom?.style) this.dom.style.cursor = this.softLook && !this.pointerUiPaused && !this.dialogueDrag ? 'none' : this.normalCursor || ''; }
  stopDesktopLook() {
    this.lockEpoch = (this.lockEpoch || 0) + 1;
    this.desktopLookWanted = false; this.pointerUiPaused = false; this.softLook = false;
    this.lockPending = false; this.scriptUnlockPending = false;
    this.updateCursor();
  }
  enableSoftLook() {
    this.softLook = !!(!G.vr && this.desktopLookWanted && !this.pointerUiPaused && this.pageFocused !== false && !this.pointerBusy() && !this.textInputFocused());
    this.updateCursor();
  }
  suspendPointerForUi() {
    if (G.vr || !(this.pointerLocked || this.desktopLookWanted || this.softLook)) return;
    if (!this.pointerUiPaused) this.releaseMouse();
    this.desktopLookWanted = true; this.pointerUiPaused = true; this.softLook = false;
    this.updateCursor();
    if (this.pointerLocked && !this.scriptUnlockPending) {
      this.scriptUnlockPending = true;
      document.exitPointerLock?.();
    }
  }
  // Resume once per UI transition. A denied lock keeps in-canvas mouse look
  // available until a fresh movement-key gesture can obtain pointer lock.
  syncPointerUi(busy) {
    this.dialogueLooking();
    if (G.vr) { this.stopDesktopLook(); return; }
    if (busy || this.textInputFocused()) { this.suspendPointerForUi(); return; }
    if (!this.pointerUiPaused) return;
    this.pointerUiPaused = false;
    if (!this.desktopLookWanted || this.pageFocused === false || document.hasFocus?.() === false) return;
    this.dom?.focus?.({ preventScroll: true });
    this.enableSoftLook();
    this.lockFresh = 2;
    if (!this.scriptUnlockPending) this.lockPointer();
  }

  releaseMouse() {
    this.dialogueDrag = false;
    this.mouse.buttons = 0; this.mouse.prevButtons = 0;
    this.mousePresses = 0;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.lockFresh = 0; this.lastMoves = []; this.dropNext = true;
  }
  // Called once after G.vr changes on a genuine XR session boundary. A view
  // switch is not an action, and an already-held controller needs a fresh pull.
  transitionViewMode(vr) {
    vr = !!vr;
    if (vr === this.viewVr) return;
    if (vr) this.desktopLookBeforeVr = !!(this.pointerLocked || this.desktopLookWanted || this.softLook || this.pointerUiPaused);
    this.viewVr = vr;
    this.stopDesktopLook();
    this.keys.clear(); this.keysPrev.clear(); this.releaseMouse();
    this.rmCancelFrame = null; this.rmXUntil = 0;
    this.btn = { left: [], right: [] }; this.btnPrev = { left: [], right: [] };
    this.axes = { left: [0, 0], right: [0, 0] };
    this.rFlick = 0; this.rFlickReady = false; this.navReady = false; this.navReadyX = false; this.runToggle = false;
    const session = vr ? this.renderer.xr?.getSession?.() : null;
    this.grabSession = session;
    for (const hand of ['left', 'right']) {
      const source = this.hands[hand]?.source;
      this.grabs[hand] = grabState(hasGrabSource(session, source) ? source : null);
    }
    this.viewInputGuard = vr;
    this.viewXrSources = { left: null, right: null };
    this.viewButtonBlocks = { left: [], right: [] }; this.viewAxisBlocks = { left: false, right: false };
    this.pointer.seen = false;
    if (vr) {
      if (this.pointerLocked || document.pointerLockElement === this.dom) {
        this.modeUnlockPending = true;
        document.exitPointerLock?.();
      }
      return;
    }
    const wanted = this.desktopLookBeforeVr;
    this.desktopLookBeforeVr = false;
    if (!wanted || this.pageFocused === false || document.hasFocus?.() === false) return;
    this.desktopLookWanted = true;
    this.pointerUiPaused = this.pointerBusy() || this.textInputFocused();
    this.enableSoftLook();
    this.lockFresh = 2;
  }
  // PC mouse look: raw movement where the browser gives it (unadjustedMovement - the mouse's own counts, no Windows
  // pointer acceleration). Chrome on Windows otherwise works the movement out from its hidden cursor, which it keeps
  // putting back in the window's middle - at a 125 / 150 % display scale that goes wrong now and then, and one
  // movement comes as a jump of the cursor: the view whipped round. Where raw movement is not supported, the usual lock
  lockPointer() {
    const dom = this.dom;
    if (G.vr || this.dialogueLookAllowed() || this.lockPending || this.pageFocused === false || document.hasFocus?.() === false || !dom?.requestPointerLock) return;
    this.desktopLookWanted = true; this.lockPending = true;
    const epoch = this.lockEpoch = (this.lockEpoch || 0) + 1;
    const failed = () => { if (epoch === this.lockEpoch) { this.lockPending = false; this.enableSoftLook(); } };
    const request = raw => {
      if (epoch !== this.lockEpoch || this.pageFocused === false || G.vr) return;
      if (this.pointerUiPaused) { this.lockPending = false; return; }
      this.lockPending = true;
      try {
        const p = raw ? dom.requestPointerLock({ unadjustedMovement: true }) : dom.requestPointerLock();
        p?.then?.(() => { if (epoch === this.lockEpoch) this.lockPending = false; }, error => {
          if (raw && error?.name === 'NotSupportedError') request(false); else failed();
        });
      } catch (error) { if (raw && error?.name === 'NotSupportedError') request(false); else failed(); }
    };
    request(true);
  }
  // and a movement that looks like the cursor jumping rather than the hand is dropped: a big one right after the lock,
  // or one far bigger than all of the last few (a jump comes alone between small ones; a fast flick grows over several
  // movements and goes on, so after one drop the next is always taken)
  onMouseMove(e) {
    this.trackPointer(e);
    let dialogue = this.dialogueLooking();
    if (dialogue && Number.isFinite(e.buttons) && !(e.buttons & 2)) { this.endDialogueLook(); dialogue = false; }
    if (!this.pointerLocked) {
      if (!(dialogue || this.softLook) || G.vr || this.pageFocused === false || document.hasFocus?.() === false || !dialogue && this.pointerBusy()) return;
      const rect = this.dom?.getBoundingClientRect?.();
      if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom ||
        e.target && e.target !== this.dom) { if (dialogue) this.endDialogueLook(); return; }
    }
    if (!Number.isFinite(e.movementX) || !Number.isFinite(e.movementY)) return;
    const m = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
    const recent = this.lastMoves.length ? Math.max(...this.lastMoves) : 0;
    const fresh = this.lockFresh > 0;
    if (fresh) this.lockFresh--;
    if (this.dropNext && ((fresh && m > 40) || (m > 250 && m > 8 * Math.max(recent, 12)))) {
      this.dropNext = false;
      this.mouseSpikes.push([Math.round(e.timeStamp), e.movementX, e.movementY, recent]);
      if (this.mouseSpikes.length > 20) this.mouseSpikes.shift();
      return;
    }
    this.dropNext = true;
    this.lastMoves.push(m);
    if (this.lastMoves.length > 3) this.lastMoves.shift();
    this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
  }

  setupXR(scene, rig) {
    const xr = this.renderer.xr;
    xr.addEventListener?.('sessionend', () => {
      this.grabSession = null;
      this.grabs = { left: grabState(null), right: grabState(null) };
    });
    for (let i = 0; i < 2; i++) {
      const ctrl = xr.getController(i);
      const grip = xr.getControllerGrip(i);
      ctrl.userData.index = i;
      ctrl.addEventListener('connected', e => {
        this.syncGrabSession(xr.getSession?.());
        const old = ctrl.userData.inputSource;
        if (old && old !== e.data) this.disconnectGrabSource(ctrl, grip, old);
        const hand = e.data.handedness;
        if (hand !== 'left' && hand !== 'right') return;
        ctrl.userData.hand = hand; grip.userData.hand = hand;
        ctrl.userData.inputSource = e.data;
        this.controllers[hand] = { ray: ctrl, grip };
        this.hands[hand] = { source: e.data };
        this.grabs[hand] = grabState(e.data);
        const gp = e.data.gamepad, va = gp?.vibrationActuator;
        console.info('[xr]', hand, 'controller:', e.data.profiles?.[0] || '?', '| vibration:',
          gp?.hapticActuators?.length ? 'hapticActuators' : va ? `vibrationActuator (${(va.effects || []).join(', ') || 'no effect list'})` : 'none');
        G.onControllerConnected?.(hand, ctrl, grip);
      });
      ctrl.addEventListener('disconnected', e => this.disconnectGrabSource(ctrl, grip, e.data || ctrl.userData.inputSource));
      ctrl.addEventListener('squeezestart', e => this.recordGrab(ctrl, e.data, true));
      ctrl.addEventListener('squeezeend', e => this.recordGrab(ctrl, e.data, false));
      rig.add(ctrl);
      rig.add(grip);
    }
  }

  disconnectGrabSource(ctrl, grip, source) {
    const hand = ctrl.userData.hand;
    if (hand && this.hands[hand]?.source === source && this.controllers[hand]?.ray === ctrl) {
      this.hands[hand] = null; delete this.controllers[hand]; this.grabs[hand] = grabState(null);
    }
    if (ctrl.userData.inputSource === source) {
      delete ctrl.userData.inputSource; delete ctrl.userData.hand; delete grip.userData.hand;
    }
  }
  syncGrabSession(session) {
    if (session === this.grabSession) return;
    this.grabSession = session;
    for (const hand of ['left', 'right']) {
      const source = this.hands[hand]?.source;
      this.grabs[hand] = grabState(hasGrabSource(session, source) ? source : null);
    }
  }
  grabAllowed() {
    return !!G.vr && !G.xrAway && !this.pointerBusy() && !G.ui?.prompt?.shown && !G.ui?.remote?.shown;
  }
  clearGrabEdges() {
    for (const grab of Object.values(this.grabs || {})) { grab.pending = false; grab.pressed = false; }
  }
  recordGrab(ctrl, source, held) {
    const session = this.renderer.xr.getSession?.();
    this.syncGrabSession(session);
    const hand = ctrl.userData.hand, grab = this.grabs[hand];
    if (!grab || !source || grab.source !== source || this.controllers[hand]?.ray !== ctrl || !hasGrabSource(session, source)) return;
    const pressed = held && !grab.held;
    // Once a source emits squeeze events, they define its grip edges. Polling
    // may arrive a frame later, and must not replay the same physical squeeze.
    grab.events = true; grab.held = held;
    if (!this.grabAllowed()) this.clearGrabEdges();
    else if (pressed) grab.pending = true;
  }
  updateGrabs(session) {
    this.syncGrabSession(session);
    const allowed = this.grabAllowed();
    for (const hand of ['left', 'right']) {
      const source = this.hands[hand]?.source;
      if (!hasGrabSource(session, source)) { this.grabs[hand] = grabState(null); continue; }
      let grab = this.grabs[hand];
      if (grab.source !== source) grab = this.grabs[hand] = grabState(source);
      if (!grab.events) {
        const held = !!source.gamepad?.buttons[1]?.pressed;
        if (held && !grab.held) grab.pending = true;
        grab.held = held;
      }
      grab.pressed = allowed && grab.pending;
      grab.pending = false;
    }
  }
  // Dedicated world-grab edge; combat and menu button semantics stay sampled.
  grabPressed(hand) {
    if (!this.grabAllowed()) { this.clearGrabEdges(); return false; }
    return !!this.grabs?.[hand]?.pressed;
  }

  // call once per rendered frame before game logic
  update() {
    this.dialogueLooking();
    this.btnPrev.left = this.btn.left; this.btnPrev.right = this.btn.right;
    this.btn = { left: [], right: [] };
    this.axes = { left: [0, 0], right: [0, 0] };
    const session = this.renderer.xr.getSession?.();
    if (session) {
      for (const src of session.inputSources) {
        if (!src.gamepad || !src.handedness || src.handedness === 'none') continue;
        const hand = src.handedness;
        if (hand !== 'left' && hand !== 'right') continue;
        const gp = src.gamepad;
        const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
        if (this.viewInputGuard && this.viewXrSources[hand] !== src) {
          this.viewXrSources[hand] = src;
          this.viewButtonBlocks[hand] = gp.buttons.map(b => !!b.pressed);
          this.viewAxisBlocks[hand] = ax.some(v => Math.abs(v) > DEAD);
        }
        const blocked = this.viewInputGuard ? this.viewButtonBlocks[hand] : [];
        for (let i = 0; i < gp.buttons.length; i++) if (!gp.buttons[i].pressed) blocked[i] = false;
        this.btn[hand] = gp.buttons.map((b, i) => !!b.pressed && !blocked[i]);
        this.btn[hand].values = gp.buttons.map((b, i) => blocked[i] ? 0 : b.value);
        this.btn[hand].touched = gp.buttons.map(b => !!b.touched);
        if (ax.every(v => Math.abs(v) <= DEAD)) this.viewAxisBlocks[hand] = false;
        this.axes[hand] = this.viewInputGuard && this.viewAxisBlocks[hand] ? [0, 0] : ax.map(dz);
        if (this.hands[hand]) this.hands[hand].gamepad = gp;
      }
    }
    // a left stick click turns running on and off; it stays until the next click (decided here once per frame:
    // running() is read several times a frame)
    if (G.vr && this.xrPressed('left', 3)) this.runToggle = !this.runToggle;
    // right stick vertical flicks: up = jump, down = interact (edge-triggered, mostly vertical)
    const [rx, ry] = this.axes.right;
    this.rFlick = 0;
    if (Math.abs(ry) > 0.7 && Math.abs(ry) > Math.abs(rx) * 1.3) {
      if (this.rFlickReady) { this.rFlick = ry < 0 ? -1 : 1; this.rFlickReady = false; }
    } else if (Math.abs(ry) < 0.35) this.rFlickReady = true;
    this.updateGrabs(session);
  }
  // call at end of frame
  endFrame() {
    this.keysPrev = new Set(this.keys);
    this.mouse.prevButtons = this.mouse.buttons;
    this.mousePresses = 0;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  key(code) { return this.keys.has(code); }
  keyPressed(code) { return this.keys.has(code) && !this.keysPrev.has(code); }
  mouseHeld(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  mousePressed(b) { return !!(this.mousePresses & (1 << b)) || this.mouseHeld(b) && !(this.mouse.prevButtons & (1 << b)); }
  xrHeld(hand, i) { return !!this.btn[hand][i]; }
  xrPressed(hand, i) { return !!this.btn[hand][i] && !this.btnPrev[hand][i]; }
  xrReleased(hand, i) { return !this.btn[hand][i] && !!this.btnPrev[hand][i]; }
  xrValue(hand, i) { return this.btn[hand].values?.[i] || 0; }
  xrTouched(hand, i) { return !!this.btn[hand].touched?.[i]; }

  // ---- semantic actions ----
  moveVector() {
    if (G.vr) {
      const [x, y] = this.axes.left;
      return { x, y };
    }
    let x = 0, y = 0;
    if (this.key('KeyW') || this.key('ArrowUp')) y -= 1;
    if (this.key('KeyS') || this.key('ArrowDown')) y += 1;
    if (this.key('KeyA') || this.key('ArrowLeft')) x -= 1;
    if (this.key('KeyD') || this.key('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  running() {
    if (G.vr) return this.runToggle;
    return this.key('ShiftLeft') || this.key('ShiftRight');
  }
  // returns -1/1 for a snap turn this frame, or a smooth turn rate in [-1,1]
  turnAxis() {
    if (!G.vr) return 0;
    const [x, y] = this.axes.right;
    return Math.abs(x) > Math.abs(y) ? x : 0;
  }
  trackPointer(e) {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.seen = true;
  }
  // menu navigation (up/down) for UI lists: -1, 0, 1 edge-triggered
  navY() {
    if (G.vr) {
      const y = this.axes.right[1] || this.axes.left[1];
      if (Math.abs(y) > 0.6) { if (this.navReady) { this.navReady = false; return Math.sign(y); } }
      else this.navReady = true;
      return 0;
    }
    if (this.keyPressed('ArrowUp') || this.keyPressed('KeyW')) return -1;
    if (this.keyPressed('ArrowDown') || this.keyPressed('KeyS')) return 1;
    return 0;
  }
  navX() {
    if (G.vr) {
      const x = this.axes.right[0] || this.axes.left[0];
      if (Math.abs(x) > 0.6) { if (this.navReadyX) { this.navReadyX = false; return Math.sign(x); } }
      else this.navReadyX = true;
      return 0;
    }
    if (this.keyPressed('ArrowLeft') || this.keyPressed('KeyA')) return -1;
    if (this.keyPressed('ArrowRight') || this.keyPressed('KeyD')) return 1;
    return 0;
  }
  confirm() {
    if (G.vr) return this.xrPressed('right', 4) || this.xrPressed('right', 0) && G.ui?.pointerTarget;
    return this.keyPressed('KeyE') || this.keyPressed('Enter') || this.keyPressed('Space') || this.keyPressed('KeyZ') ||
      !this.pointerLocked && !!G.ui?.pointerTarget && this.mousePressed(0);
  }
  // world interaction (talk / examine): VR = right stick down
  interact() {
    if (G.vr) return this.rFlick === 1;
    return this.keyPressed('KeyE') || this.keyPressed('Enter') || this.keyPressed('KeyZ');
  }
  // advance a message window: confirm buttons or the same flick used to start talking
  advance() { return this.confirm() || (G.vr && this.rFlick === 1); }
  // jump: VR = right stick up, PC = C
  jumpPressed() {
    if (G.vr) return this.rFlick === -1;
    return this.keyPressed('KeyC');
  }
  // Break (original battle command): VR = left trigger, PC = F / middle mouse. Held while swinging, the swing
  // Breaks; a shield-slot gun (in the left hand) fires on the pull
  breakPressed() {
    if (G.vr) return this.xrPressed('left', 0);
    return this.keyPressed('KeyF') || this.mousePressed(1);
  }
  breakHeld() {
    if (G.vr) return this.xrHeld('left', 0);
    return this.key('KeyF') || this.mouseHeld(1);
  }
  cancel() {
    if (G.vr) return this.xrPressed('right', 5);
    return this.keyPressed('Escape') || this.keyPressed('Backspace') || this.keyPressed('KeyX');
  }
  menu() {
    if (G.vr) return this.xrPressed('left', 5);
    return this.keyPressed('Tab') || this.keyPressed('KeyM');
  }
  // quick slots: VR = X (left) held, PC = Q held; PC number keys 1-8 use a slot directly
  quickHeld() { return G.vr ? this.xrHeld('left', 4) : this.key('KeyQ'); }
  mapPressed() { return !G.vr && this.keyPressed('KeyN'); }
  skillMenuPressed() { return !G.vr && this.pageFocused !== false && !this.textInputFocused() && this.keyPressed('KeyR'); }
  quickPressed() { return G.vr ? this.xrPressed('left', 4) : this.keyPressed('KeyQ'); }
  // emotes (src/emotes.js): VR = B (right) held - the cancel button, nothing outside menus and messages, nor
  // any of the game's events but three scenes (which an emote never opens in); PC = T held
  emoteHeld() { return G.vr ? this.xrHeld('right', 5) : this.key('KeyT'); }
  emotePressed() { return G.vr ? this.xrPressed('right', 5) : this.keyPressed('KeyT'); }
  digitPressed() {
    if (G.vr) return 0;
    for (let i = 1; i <= 8; i++) if (this.keyPressed('Digit' + i)) return i;
    return 0;
  }
  // dodge: VR = A (also the confirm button while a message or menu is open), PC = Space
  dodge() {
    if (G.vr) return this.xrPressed('right', 4);
    return this.keyPressed('Space');
  }
  // 무장해제 (put the weapon and shield away / take them up): VR = right stick click, PC = H
  disarmPressed() {
    if (G.vr) return this.xrPressed('right', 3);
    return this.keyPressed('KeyH');
  }
  block() {
    if (G.vr) return this.xrHeld('left', 1);
    return this.mouseHeld(2);
  }
  attackPressed() { return !G.vr && this.mousePressed(0); }
  // RPG Maker's own buttons, held down (events check them with "Button is being pressed"): the
  // opening's "press down to get out of bed", "B closes the picture", the date talk on X...
  requestRmCancel() { this.rmCancelFrame = G.frame; }
  rmButton(code) {
    // Semantic menu opening can also finish an active original picture viewer.
    // This feeds event B only, including VR, without closing the new port menu.
    if (code === 12) {
      if (this.rmCancelFrame != null && this.rmCancelFrame === G.frame) return true;
      this.rmCancelFrame = null;
    }
    // (down also counts when the stick is simply pulled back / S is held, like a pad's down button:
    // in VR nobody knows which way the map's "down" is right after a cutscene)
    if (code === 2 && (G.vr ? this.axes.left[1] > 0.6 : this.key('KeyS') || this.key('ArrowDown'))) return true;
    if (code === 2 || code === 4 || code === 6 || code === 8) return this.rmDir() === code;
    if (G.vr) {
      switch (code) {
        case 11: return this.xrHeld('left', 3);                                 // A (dash): left stick click
        case 12: return this.xrHeld('right', 5);                                // B (cancel)
        case 13: return this.xrHeld('right', 4) || this.xrHeld('right', 0);     // C (decide): A / trigger
        case 14: return G.time < (this.rmXUntil || 0);                         // X (A key): see pressRmButton
        case 15: return this.xrHeld('left', 5);                                 // Y
        default: return false;
      }
    }
    switch (code) {
      case 11: return this.key('ShiftLeft') || this.key('ShiftRight');
      case 12: return this.key('Escape') || this.key('Backspace') || this.key('KeyX');
      case 13: return this.key('Enter') || this.key('Space') || this.key('KeyZ') || this.key('KeyE');
      case 14: return G.time < (this.rmXUntil || 0);
      case 15: return this.key('Tab');
      case 17: return this.key('PageUp');
      case 18: return this.key('PageDown');
      default: return false;
    }
  }
  // the original's X button (the A key on its keyboard) for a moment: in the whole game only Prickett's date asks
  // for it (to hear her talk), so it is talking to the one walking along with the player (allies.js talkTo) -
  // not the X button, which opens the quick slots
  pressRmButton(code) { if (code === 14) this.rmXUntil = G.time + 0.15; }
  // the map direction the player is pushing toward, like the 2D arrow keys (2 down = south, 4 west,
  // 6 east, 8 north): the stick (or WASD) turned by where the player faces
  rmDir() {
    const mv = this.moveVector();
    if (Math.hypot(mv.x, mv.y) < 0.5) return 0;
    const f = G.player?.forward2D?.() ?? { x: 0, z: -1 };
    const fwd = -mv.y, side = mv.x;
    const wx = f.x * fwd - f.z * side, wy = f.z * fwd + f.x * side;
    if (Math.abs(wy) >= Math.abs(wx)) return wy > 0 ? 2 : 8;
    return wx > 0 ? 6 : 4;
  }

  // A short vibration in that hand's controller. gamepad.hapticActuators[0].pulse() is the Quest Browser /
  // Firefox API, vibrationActuator the Gamepad API's. Chrome / Edge on PC give a VR controller neither (their
  // WebXR has no haptics at all): then the server asks SteamVR for it (POST /api/haptic, see server.py /
  // the launcher), which works while SteamVR is the VR runtime
  haptic(hand, intensity = 0.5, ms = 60) {
    const gp = this.hands[hand]?.gamepad;
    if (!gp) return;
    const v = Math.max(0, Math.min(1, intensity));
    try {
      const old = gp.hapticActuators?.[0];
      if (old?.pulse) { old.pulse(v, ms); return; }
      if (gp.vibrationActuator?.playEffect) {
        gp.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: v, weakMagnitude: v })
          ?.catch?.(() => { /* this controller cannot vibrate */ });
        return;
      }
    } catch { /* this controller cannot vibrate */ }
    this.hapticViaServer(hand, v, ms);
  }
  hapticViaServer(hand, v, ms) {
    if (this.hapticServerOff || v <= 0) return;
    fetch(`/api/haptic?h=${hand === 'left' ? 'l' : 'r'}&v=${v.toFixed(2)}&ms=${Math.round(ms)}`, { method: 'POST', keepalive: true })
      .then(r => {
        if (r.status === 404) { this.hapticServerOff = true; return null; }      // (a server without it)
        return r.json();
      })
      .then(j => {
        if (j && j.status !== this.hapticStatus) { this.hapticStatus = j.status; console.info('[xr] vibration through SteamVR:', j.status); }
      })
      .catch(() => {});
  }

  handPose(hand, target = new THREE.Matrix4()) {
    const c = this.controllers[hand];
    if (!c) return null;
    return target.copy(c.grip.matrixWorld);
  }
}
