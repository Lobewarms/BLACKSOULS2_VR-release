// Unified input: Quest Touch controllers (WebXR, xr-standard mapping) + keyboard/mouse fallback.
import * as THREE from 'three';
import { G } from './globals.js';
import { lockPointerRaw, MouseFilter } from './mouselook.js';

const DEAD = 0.18;
const dz = v => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
// the trigger and the grip count as pressed this far in (and up to RELEASE once pressed - no chatter): each runtime
// sets its own 'pressed' at its own depth, some only at the very end of the pull
const PRESS = 0.6, RELEASE = 0.35;
const SKIP_HOLD = 0.4;           // s the advance button is held before the messages skip (skipHeld)
// a controller's stick (the xr-standard layout: axes 2-3, its touchpad 0-1): a controller with a touchpad and no stick
// (Vive wands) steers with the touchpad; one not in the standard layout, with whichever pair is pushed further
function stickOf(gp) {
  const a = gp.axes, pad = [a[0] || 0, a[1] || 0], stick = [a[2] || 0, a[3] || 0];
  if (a.length < 4) return pad;
  if (gp.mapping === 'xr-standard') return stick;
  return Math.hypot(stick[0], stick[1]) >= Math.hypot(pad[0], pad[1]) ? stick : pad;
}
// of two sticks, the one pushed further (a little drift on one does not take the other's place)
const further = (a, b) => (Math.abs(a) >= Math.abs(b) ? a : b);

export class Input {
  constructor(renderer, dom) {
    this.renderer = renderer;
    this.dom = dom;
    this.keys = new Set();
    this.keysPrev = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, prevButtons: 0, wheel: 0 };
    this.pointerLocked = false;
    this.look = new MouseFilter();                   // (a jump of the hidden cursor dropped - mouselook.js)
    this.hands = { left: null, right: null };       // {source, gamepad}
    this.btn = { left: [], right: [] };              // current pressed booleans
    this.btnPrev = { left: [], right: [] };
    this.axes = { left: [0, 0], right: [0, 0] };
    this.controllers = {};                           // three.js controller spaces
    this.runToggle = false;
    this.snapReady = true;

    addEventListener('keydown', e => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;     // (typing a name: ui.js keyboard)
      this.keys.add(e.code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', e => {
      this.mouse.buttons |= 1 << e.button;
      if (!this.pointerLocked && !G.vr) this.lockPointer();
    });
    addEventListener('mouseup', e => { this.mouse.buttons &= ~(1 << e.button); });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => this.onMouseMove(e));
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === dom;
      this.look.reset(this.pointerLocked);
    });
  }
  // PC mouse look: raw movement where the browser gives it, a jump of the hidden cursor dropped (mouselook.js - the
  // map editor's too)
  lockPointer() { lockPointerRaw(this.dom); }
  onMouseMove(e) {
    if (!this.pointerLocked || !this.look.take(e)) return;
    this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
  }

  setupXR(scene, rig) {
    const xr = this.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const ctrl = xr.getController(i);
      const grip = xr.getControllerGrip(i);
      ctrl.userData.index = i;
      ctrl.addEventListener('connected', e => {
        // (a source held in neither hand - a tracker, a gaze - is not taken for the right controller)
        if (e.data.handedness !== 'left' && e.data.handedness !== 'right') return;
        const hand = e.data.handedness;
        ctrl.userData.hand = hand; grip.userData.hand = hand;
        this.controllers[hand] = { ray: ctrl, grip };
        this.hands[hand] = { source: e.data };
        const gp = e.data.gamepad, va = gp?.vibrationActuator;
        console.info('[xr]', hand, 'controller:', e.data.profiles?.[0] || '?', '| vibration:',
          gp?.hapticActuators?.length ? 'hapticActuators' : va ? `vibrationActuator (${(va.effects || []).join(', ') || 'no effect list'})` : 'none');
        G.onControllerConnected?.(hand, ctrl, grip);
      });
      ctrl.addEventListener('disconnected', () => {
        const hand = ctrl.userData.hand;
        if (hand) { this.hands[hand] = null; delete this.controllers[hand]; }
      });
      rig.add(ctrl);
      rig.add(grip);
    }
  }

  // call once per rendered frame before game logic
  update() {
    this.btnPrev.left = this.btn.left; this.btnPrev.right = this.btn.right;
    this.btn = { left: [], right: [] };
    this.axes = { left: [0, 0], right: [0, 0] };
    const session = this.renderer.xr.getSession?.();
    if (session) {
      for (const src of session.inputSources) {
        if (!src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        const hand = src.handedness;
        const gp = src.gamepad, was = this.btnPrev[hand];
        this.btn[hand] = gp.buttons.map((b, i) => b.pressed || (i < 2 && b.value >= (was[i] ? RELEASE : PRESS)));
        this.btn[hand].values = gp.buttons.map(b => b.value);
        this.btn[hand].touched = gp.buttons.map(b => !!b.touched);
        const ax = stickOf(gp);
        this.axes[hand] = [dz(ax[0]), dz(ax[1])];
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
  }
  // call at end of frame
  endFrame() {
    this.keysPrev = new Set(this.keys);
    this.mouse.prevButtons = this.mouse.buttons;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  key(code) { return this.keys.has(code); }
  keyPressed(code) { return this.keys.has(code) && !this.keysPrev.has(code); }
  mouseHeld(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  mousePressed(b) { return this.mouseHeld(b) && !(this.mouse.prevButtons & (1 << b)); }
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
  // menu navigation (up/down) for UI lists: -1, 0, 1 edge-triggered
  navY() {
    if (G.vr) {
      const y = further(this.axes.right[1], this.axes.left[1]);
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
      const x = further(this.axes.right[0], this.axes.left[0]);
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
    return this.keyPressed('KeyE') || this.keyPressed('Enter') || this.keyPressed('Space') || this.keyPressed('KeyZ');
  }
  // world interaction (talk / examine): VR = right stick down
  interact() {
    if (G.vr) return this.rFlick === 1;
    return this.keyPressed('KeyE') || this.keyPressed('Enter') || this.keyPressed('KeyZ');
  }
  // advance a message window: confirm buttons or the same flick used to start talking
  advance() { return this.confirm() || (G.vr && this.rFlick === 1); }
  // メッセージスキップ (the original's Ctrl held: the messages one after another, none waited on): PC Ctrl; VR the
  // advance button held a moment - A, or the trigger with the laser on the window (a tap still moves on by one)
  skipHeld() {
    if (!G.vr) return this.key('ControlLeft') || this.key('ControlRight');
    const held = this.xrHeld('right', 4) || (this.xrHeld('right', 0) && !!G.ui?.pointerTarget);
    if (!held) { this.skipSince = null; return false; }
    this.skipSince ??= G.time;
    return G.time - this.skipSince >= SKIP_HOLD;
  }
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
  rmButton(code) {
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
