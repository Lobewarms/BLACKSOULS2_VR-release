// First-person player: free locomotion with grid-edge collision, event triggers, VR rig handling.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';
import { movementSpeedRate } from '../game/movement-speed.js';
import { eventActionPosition } from './event-position.js';
import { DialogueCamera } from './dialogue-camera.js';

const R = 0.22;          // body radius in tiles (~0.33 m)
const EVENT_R = 0.24;    // blocking event radius in tiles (about a person, like the player)
const STEP_IN = 0.2;     // how far (tiles) past a cell's edge the head must go before the cell counts as stepped on
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpTurn = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);

// Footsteps, as the original's 足音 script (misty_rain's プレイヤー足音) plays them once switch 25 (足音スイッチ, on
// from the opening) is on: by the terrain tag underfoot - 1 plain, 2 grass, 3 earth, 4 water, 5 acid, 6 iron
// plate, 7 snow; [walk foot 1, walk foot 2, run foot 1, run foot 2] as [SE, volume, pitch]. It steps every
// 20 frames walking and 16 running (a step on animation patterns 1 and 3); tag 0 is silent. Played a little
// quieter than the script's volume (STEP_VOLUME)
const STEP_VOLUME = 0.8;
const DODGE_BUFFER = 0.3;               // s a dodge pressed a moment early is kept (combat.js INPUT_BUFFER for a click)
const STEP_SE = {
  1: [['asioto', 75, 100], ['asioto', 75, 100], ['asioto', 75, 120], ['asioto', 75, 120]],
  2: [['足音・草歩', 75, 100], ['足音・草歩', 75, 100], ['足音・草歩', 75, 120], ['足音・草歩', 75, 120]],
  3: [['足音・土', 75, 100], ['足音・土', 75, 100], ['足音・土', 75, 120], ['足音・土', 75, 120]],
  4: [['Water10', 75, 100], ['Water10', 75, 100], ['Water10', 75, 120], ['Water10', 75, 120]],
  5: [['酸', 75, 180], ['酸', 75, 180], ['酸', 75, 200], ['酸', 75, 200]],
  6: [['足音・鉄板', 75, 100], ['足音・鉄板', 75, 100], ['足音・鉄板', 75, 120], ['足音・鉄板', 75, 120]],
  7: [['snow', 75, 50], ['snow2', 75, 60], ['snow', 75, 70], ['snow2', 75, 90]],
};

export class Player {
  constructor(rig, camera) {
    this.rig = rig;
    this.camera = camera;
    this.yaw = 0; this.pitch = 0;           // desktop look
    this.dialogueCamera = new DialogueCamera(this);
    this.lastTile = { x: -999, y: -999 };
    this.bumpCooldown = 0;
    this.dodge = { t: 0, dx: 0, dy: 0, cooldown: 0 };
    this.invuln = 0;
    this.knock = null;            // thrown by a heavy blow: { t, dur, dx, dy, dist } (knockback())
    this.knockedUntil = 0;
    this.velocity = new THREE.Vector2();
    this.frozenReason = '';
    this.snapReady = true;
  }

  // head position in world space
  headWorld(target = tmpV) {
    this.camera.updateMatrixWorld();
    return this.camera.getWorldPosition(target);
  }
  forward2D() {
    const q = this.camera.getWorldQuaternion(tmpQ);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const l = Math.hypot(f.x, f.z) || 1;
    return { x: f.x / l, z: f.z / l };
  }
  forwardVec() {
    const f = this.forward2D();
    return new THREE.Vector3(f.x, 0, f.z);
  }
  facingDir(f = this.forward2D()) {
    if (Math.abs(f.x) > Math.abs(f.z)) return f.x > 0 ? 6 : 4;
    return f.z > 0 ? 2 : 8;
  }

  // place the player (head) at the center of tile (tx, ty)
  teleportTo(tx, ty, dir) {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    this.dodgeAskedAt = -99; this.wantDodge = false;
    this.dialogueCamera.cancel();
    const head = this.headWorld(new THREE.Vector3());
    if (!Number.isFinite(head.x) || !Number.isFinite(head.z)) {
      // no valid head pose yet (XR session starting): put the rig itself on the tile
      this.rig.position.set((tx + 0.5) * T, this.rig.position.y, (ty + 0.5) * T);
      head.copy(this.rig.position);
    }
    this.rig.position.x += (tx + 0.5) * T - head.x;
    this.rig.position.z += (ty + 0.5) * T - head.z;
    this.floorY = G.floorAt ? G.floorAt(tx, ty) : 0;
    this.fallV = 0; this.jumpY = 0; this.jumpV = 0;
    this.knock = null;
    this.rig.position.y = this.floorY;
    const pc = G.map.playerChar;
    pc.fx = tx; pc.fy = ty; pc.syncFromContinuous();
    this.lastTile = { x: pc.x, y: pc.y };     // (a teleport is not a step onto the cell)
    if (dir) this.faceDirection(dir);
  }
  // thrown by a heavy blow (setting 강한 공격에 밀려남): pushed dist metres along (dx, dy) in a moment, fast at
  // first and slowing - walls, the map's edge and a boss arena's fog stop it as they stop walking - and/or sent
  // up at `up` m/s (the cosmetic jump's way up; a jump goes up at 3.1)
  // Blown up into the sky by a boss's wind (윈터벨의 바람's 바람에 날리기 - combat.js / bossmoves.js liftInfo): up over a
  // moment and held there, swaying, no ground to walk on, out of the reach of blows; then dropped hard (dropDown: its fall's
  // blow lands as the feet touch the ground) or let down gently (floatDown: the wind gone). Not with 강한 공격에 밀려남 off:
  // the view stays on the ground (the fall still comes)
  liftUp(top = 5.5) {
    if (G.settings.hitKnockback === false || this.air) return false;
    this.air = { y: this.jumpY || 0, from: this.jumpY || 0, top, t: 0, phase: 'up' };
    this.jumpY = 0; this.jumpV = 0;
    return true;
  }
  aloft() { return !!this.air && this.air.y > 1; }
  dropDown(onLand) {
    if (!this.air) { onLand?.(); return; }
    Object.assign(this.air, { phase: 'drop', v: 0, onLand });
  }
  floatDown() { if (this.air && this.air.phase !== 'drop') this.air.phase = 'float'; }
  endAir() { this.air = null; }
  updateAir(dt) {
    const a = this.air;
    a.t += dt;
    if (a.phase === 'up') {
      const k = Math.min(1, a.t / 1.4);
      a.y = a.from + (a.top - a.from) * (1 - (1 - k) ** 3);
      if (k >= 1) { a.phase = 'hold'; a.t = 0; }
    } else if (a.phase === 'hold') a.y = a.top + Math.sin(a.t * 1.7) * 0.12;
    else if (a.phase === 'drop') { a.v += 22 * dt; a.y -= a.v * dt; }
    else a.y -= 2.4 * dt;
    if (a.y > 0 || a.phase === 'up' || a.phase === 'hold') return a.y;
    // down
    this.air = null;
    G.input.haptic('left', 0.5, 80); G.input.haptic('right', 0.5, 80);
    a.onLand?.();
    return 0;
  }
  knockback(dx, dy, dist, up = 0) {
    if (G.settings.hitKnockback === false) return;
    const l = Math.hypot(dx, dy);
    if (dist > 0 && l > 1e-6) {
      this.knock = { t: 0.35, dur: 0.35, dx: dx / l, dy: dy / l, dist };
      this.knockedUntil = G.time + 0.4;
    }
    if (up > 0) this.jumpV = Math.max(this.jumpV || 0, up);
  }
  faceDirection(dir) {
    const yaw = { 2: Math.PI, 4: Math.PI / 2, 6: -Math.PI / 2, 8: 0 }[dir];
    if (yaw === undefined) return;
    this.dialogueCamera.cancel();
    if (G.vr) {
      // rotate the rig around the head so the user faces `dir`
      const f = this.forward2D();
      const cur = Math.atan2(-f.x, -f.z);
      this.rotateRigAroundHead(yaw - cur);
    } else {
      this.yaw = yaw;
    }
  }
  rotateRigAroundHead(angle) {
    const head = this.headWorld(new THREE.Vector3());
    const p = this.rig.position;
    const dx = p.x - head.x, dz = p.z - head.z;
    const c = Math.cos(angle), s = Math.sin(angle);
    p.x = head.x + dx * c + dz * s;
    p.z = head.z - dx * s + dz * c;
    // about the world's up axis, whatever Euler angles the rig's pose happens to be written in
    this.rig.quaternion.premultiply(tmpTurn.setFromAxisAngle(UP, angle));
  }

  canMove() {
    const m = G.map;
    if (!m || m.transferring) return false;
    if (this.air) return false;                          // (blown up into the sky: no ground to walk on - liftUp)
    if (G.ui.messageBusy() || G.ui.menuOpen || G.ui.prompt?.shown) return false;     // (prompt: join the co-op boss fight?)
    if (G.chat?.typing) return false;                    // (PC: a chat line being typed)
    if (m.playerChar.moveRouteForcing) return false;
    if (G.combat?.playerDead) return false;
    if (m.interpreter.running() && m.interpreter.waitMode !== 'battle') return false;
    if (G.coop?.heldByScene?.()) return false;          // (co-op guest: the host's scene holds it too)
    if (G.combat?.restrained) return false;            // (asleep, stunned... - setting 행동 불가 상태이상)
    return true;
  }

  update(dt) {
    const input = G.input;
    const s = G.settings;
    const pc = G.map.playerChar;
    // never let a NaN (e.g. from a broken head pose) stick to the rig: go back to the last good spot
    const rp = this.rig.position;
    if (!Number.isFinite(rp.x) || !Number.isFinite(rp.y) || !Number.isFinite(rp.z) || !Number.isFinite(this.rig.rotation.y)) {
      const g = this.lastGood || { x: pc.x, y: pc.y };
      console.warn('player rig was not finite; restoring', g);
      rp.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
      if (!Number.isFinite(pc.fx) || !Number.isFinite(pc.fy)) { pc.fx = g.x; pc.fy = g.y; }
      this.teleportTo(g.x, g.y);
      return;
    }
    if (Number.isFinite(pc.fx) && Number.isFinite(pc.fy)) this.lastGood = { x: pc.fx, y: pc.fy };
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.dodge.cooldown = Math.max(0, this.dodge.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.dodging = false;             // (moving in a dodge this frame - its last step too: enemies let it through)
    this.runningNow = false;          // (running this frame, moving: what costs stamina in a fight - combat.js)
    const dodgeAllowed = this.canMove() && !G.ui.consumedConfirm && !G.combat?.manualConfusionBlocked?.()
      && !G.state?.party?.leader()?.skillSealed?.(12);
    if (!dodgeAllowed) { this.dodgeAskedAt = -99; this.wantDodge = false; }

    // ---- view rotation ----
    this.dialogueCamera.update(dt);
    if (G.vr) {
      const t = G.ui.blocksTurning?.() ? 0 : input.turnAxis();
      if (s.snapTurn) {
        if (Math.abs(t) > 0.7 && this.snapReady) { this.rotateRigAroundHead(-Math.sign(t) * THREE.MathUtils.degToRad(s.snapAngle)); this.snapReady = false; }
        else if (Math.abs(t) < 0.3) this.snapReady = true;
      } else if (t) this.rotateRigAroundHead(-t * THREE.MathUtils.degToRad(s.smoothTurnSpeed) * dt);
    } else {
      if (!G.combat?.quick?.isOpen && !G.emotes?.ring.isOpen) {     // the mouse picks a quick slot / an emote instead
        this.yaw -= input.mouse.dx * 0.0025;
        this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouse.dy * 0.0025, -1.45, 1.45);
      }
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.position.set(0, s.eyeHeight, 0);
    }

    // scripted fall (RPG Maker slides the player down the screen): drop straight down into darkness
    if (this.scriptedFall) {
      const f = this.scriptedFall;
      f.t += dt;
      this.fallV += 9.8 * dt;
      this.rig.position.y -= this.fallV * dt;
      G.screen.setBrightness(Math.max(0, 255 - f.t * 300));
      if (!pc.moveRouteForcing && !pc.moving()) {
        this.scriptedFall = null;
        this.fallV = 0;
        this.teleportTo(pc.x, pc.y);
        // stay dark a moment: the event usually goes on to "YOU DIED" or a landing scene
        setTimeout(() => { if (G.screen.brightness < 1 && !G.map.transferring) G.screen.fadeIn(30); }, 800);
      }
      return;
    }
    // forced move routes (cutscenes) move the camera along the grid
    if (pc.moveRouteForcing || pc.moving() || pc.jumping()) {
      this.placeHeadAtTiles(pc.fx, pc.fy);
      const floorY = G.floorAt ? G.floorAt(pc.fx, pc.fy) : 0;
      const hop = pc.jumping() ? pc.jumpHeight() / 32 * T : 0;
      if (!hop && !G.lift?.riding && this.floorY !== undefined && floorY < this.floorY - 0.3) {
        // carried over an edge (a fall's first step): drop, do not teleport down (a lift going down its slope: on it - lift.js)
        this.fallV = (this.fallV || 0) + 9.8 * dt;
        this.floorY = Math.max(floorY, this.floorY - this.fallV * dt);
      } else {
        this.fallV = 0;
        this.floorY = floorY;
      }
      this.rig.position.y = this.floorY + hop;
      // (no steps while a lift carries the player - lift.js -, nor on a move with its walking turned off - 린다메아's blow
      // sliding the player back: the original's steps come on the walking's frames)
      if (!G.lift?.riding && pc.walkAnime) this.updateFootsteps(dt, pc.realMoveSpeed?.() > 4 || input.running(), !!hop);
      this.afterMove();
      return;
    }

    // ---- locomotion ----
    const head = this.headWorld(new THREE.Vector3());
    let fx = head.x / T - 0.5, fy = head.z / T - 0.5;  // current continuous tile coords (from head)
    const startFx = fx, startFy = fy;
    let mvx = 0, mvy = 0;
    if (this.canMove()) {
      const mv = input.moveVector();
      const f = this.forward2D();
      // stick y negative = forward
      const fwd = -mv.y, side = mv.x;
      // (running - in a fight it costs stamina, and with none left one walks till some is back: combat.js canRun)
      const run = input.running() && G.combat?.canRun?.() !== false;
      this.runningNow = run && (fwd !== 0 || side !== 0);
      let speed = s.moveSpeed * movementSpeedRate(pc, G.combat?.inCombat ? G.combat.battles : null) * (run ? s.runMultiplier : 1);
      if (G.vr) speed *= s.vrSpeed ?? 2;
      if (G.combat?.inCombat && G.combat.guardUp) speed *= 0.55;
      mvx = (f.x * fwd - f.z * side) * speed * dt / T;
      mvy = (f.z * fwd + f.x * side) * speed * dt / T;
      // (not the press that just closed a message - A is both; a dodge takes stamina - none without it: combat.js
      // takeDodge; none while staggered - PvP. A press a moment early - the last dodge's cooldown or a stagger still
      // running - is kept DODGE_BUFFER s and taken as soon as it can be)
      if (input.dodge() && dodgeAllowed) this.dodgeAskedAt = G.time;
      const asked = this.wantDodge || G.time - (this.dodgeAskedAt ?? -99) <= DODGE_BUFFER;
      if (asked && dodgeAllowed && this.dodge.cooldown <= 0 && !G.combat?.staggered?.() && (G.combat?.takeDodge?.() ?? true)) {
        this.wantDodge = false; this.dodgeAskedAt = -99;
        let dx = f.x * fwd - f.z * side, dy = f.z * fwd + f.x * side;
        const l = Math.hypot(dx, dy);
        if (l < 0.2) { dx = -f.x; dy = -f.z; } else { dx /= l; dy /= l; }   // default: backstep
        this.dodge = { t: 0.22, dx, dy, cooldown: 0.75 };
        this.invuln = 0.35;
        G.audio?.playSystemSe?.(17);
      }
    }
    this.wantDodge = false;           // a quick-slot Evade only counts for the frame it was asked for
    this.dodging = this.dodge.t > 0;
    if (this.dodge.t > 0) {
      const step = Math.min(this.dodge.t, dt);
      this.dodge.t -= step;
      mvx += this.dodge.dx * (3.2 / 0.22) * step / T;
      mvy += this.dodge.dy * (3.2 / 0.22) * step / T;
    }
    const intentX = mvx, intentY = mvy;            // (where the player means to go - a knock is not a step)
    // thrown: the speed falls off evenly to nothing over the knock's time (it covers dist metres; the speed at the
    // middle of this frame's slice)
    if (this.knock) {
      const k = this.knock, step = Math.min(k.t, dt);
      const v = 2 * k.dist / k.dur * ((k.t - step / 2) / k.dur);
      k.t -= step;
      mvx += k.dx * v * step / T; mvy += k.dy * v * step / T;
      if (k.t <= 0) this.knock = null;
    }
    const wanted = Math.hypot(mvx, mvy);
    if (wanted > 0) {
      // sub-step to avoid tunnelling (through walls, and through the enemies' bodies)
      const steps = Math.ceil(wanted / 0.2);
      const bodies = G.combat?.allTargets?.();
      for (let i = 0; i < steps; i++) {
        fx += mvx / steps; fy += mvy / steps;
        [fx, fy] = this.resolve(fx, fy);
        if (bodies?.length) [fx, fy] = G.combat.blockPlayer(fx, fy, this, bodies);
      }
      if (G.time >= this.knockedUntil) this.checkBump(mvx, mvy, fx, fy);
    } else {
      // physical (room-scale) movement still has to respect walls
      [fx, fy] = this.resolve(fx, fy);
    }
    [fx, fy] = this.keepOnHiddenWay(fx, fy, intentX, intentY);
    // apply correction to the rig so the head ends up at (fx, fy)
    this.rig.position.x += (fx - startFx) * T;
    this.rig.position.z += (fy - startFy) * T;
    if (G.combat) G.combat.pushPlayer?.(this);

    const head2 = this.headWorld(new THREE.Vector3());
    pc.fx = head2.x / T - 0.5; pc.fy = head2.z / T - 0.5;
    pc.syncFromContinuous();
    // the logical facing follows the view, except while an event runs: it keeps facing what was talked to
    // (an event's "move forward" must go there, not where the head happens to turn)
    if (!G.map.interpreter.running()) pc.direction = this.facingDir();
    this.updateHeight(dt);
    this.updateFootsteps(dt, this.runningNow, this.jumpY > 0.05 || this.dodge.t > 0);
    this.afterMove();
  }

  // footsteps (STEP_SE): one about every third of a second walking and a quarter quicker running, slower when
  // creeping; feet take turns. Not in the air, not in the dodge's dash, not when carried across the map
  updateFootsteps(dt, running, airborne) {
    const head = this.headWorld(tmpV);
    const last = this.stepLast;
    this.stepLast = { x: head.x, z: head.z };
    if (!last || !G.state?.sw(25)) return;
    const d = Math.hypot(head.x - last.x, head.z - last.z);
    if (d > 1.5 || airborne || (this.fallV || 0) > 1) return;
    const speed = d / Math.max(dt, 1e-3);
    if (speed < 0.4) { this.stepPhase = Math.min(this.stepPhase ?? 0.7, 0.7); return; }  // stopped: the next step comes soon
    const s = G.settings;
    const full = s.moveSpeed * movementSpeedRate(G.map.playerChar, G.combat?.inCombat ? G.combat.battles : null)
      * (G.vr ? s.vrSpeed ?? 2 : 1) * (running ? s.runMultiplier : 1);
    const rate = (running ? 60 / 16 : 60 / 20) * THREE.MathUtils.clamp(speed / full, 0.45, 1);
    this.stepPhase = (this.stepPhase ?? 0.7) + dt * rate;
    if (this.stepPhase < 1) return;
    this.stepPhase -= Math.floor(this.stepPhase);
    this.stepFoot = (this.stepFoot ?? 1) ^ 1;
    const pc = G.map.playerChar;
    const set = STEP_SE[G.map.grid?.terrainTag(pc.x, pc.y)];
    if (!set) return;
    const [name, volume, pitch] = set[(running ? 2 : 0) + this.stepFoot];
    G.audio?.playSe({ name, volume: Math.round(volume * STEP_VOLUME), pitch });
  }

  // follow the floor (stairs, slopes, pits) and the cosmetic jump
  updateHeight(dt) {
    const pc = G.map.playerChar;
    const target = G.floorAt ? G.floorAt(pc.fx, pc.fy) : 0;
    if (this.floorY === undefined) this.floorY = target;
    if (target < this.floorY - 0.3) {            // stepped off an edge: fall
      this.fallV = (this.fallV || 0) + 9.8 * dt;
      this.floorY = Math.max(target, this.floorY - this.fallV * dt);
    } else {
      this.fallV = 0;
      this.floorY += (target - this.floorY) * Math.min(1, dt * 14);
    }
    // jump (A / C): only a feel thing, collision stays on the grid
    if (this.jumpY === undefined) { this.jumpY = 0; this.jumpV = 0; }
    if (this.jumpY <= 0 && this.canMove() && G.input.jumpPressed() && !G.ui.consumedConfirm) {
      this.jumpV = 3.1;
      G.audio?.playSe(G.seAt('Jump1', 60, 100));
    }
    if (this.jumpV !== 0 || this.jumpY > 0) {
      this.jumpV -= 9.8 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.jumpV = 0; G.input.haptic('left', 0.2, 40); G.input.haptic('right', 0.2, 40); }
    }
    this.rig.position.y = this.floorY + (this.air ? this.updateAir(dt) : this.jumpY);
  }
  startScriptedFall() {
    if (this.scriptedFall) return;
    this.scriptedFall = { t: 0 };
    this.fallV = 1.5;
    G.audio?.playSe(G.seAt('Wind7', 70, 60));
  }

  placeHeadAtTiles(tx, ty) {
    const head = this.headWorld(new THREE.Vector3());
    this.rig.position.x += (tx + 0.5) * T - head.x;
    this.rig.position.z += (ty + 0.5) * T - head.z;
  }

  afterMove() {
    const pc = G.map.playerChar;
    // a new cell counts as stepped on once the head is STEP_IN tiles past the edge of the last one: a head
    // swaying on a cell edge must not step on and off it again and again (in 2D a touch is one deliberate step;
    // the croquet hoops of 홍성 프릿셀 6 start the run over when one is touched twice)
    const out = Math.max(Math.abs(pc.fx - G.map.nearX(this.lastTile.x, pc.fx)), Math.abs(pc.fy - G.map.nearY(this.lastTile.y, pc.fy)));
    if ((pc.x !== this.lastTile.x || pc.y !== this.lastTile.y) && (out >= 0.5 + STEP_IN || pc.moveRouteForcing)) {
      this.lastTile = { x: pc.x, y: pc.y };
      G.state.party.steps++;
      // (a cell the player is thrown onto is not stepped on: no door or trap goes off by a knockback)
      // (nor by a co-op phantom: the world it walks is another player's - only its traps, a boss fight by the rules and,
      // the guests going their own way, its ways out - coop.js phantomTouch)
      if (!pc.moveRouteForcing && G.time >= this.knockedUntil) {
        if (!G.coop?.phantom) G.map.onPlayerTile(pc.x, pc.y);
        else G.coop.phantomTouch(G.map.eventsXy(pc.x, pc.y).filter(ev => ev.triggerIn([1, 2]) && !ev.normalPriority()), 'touch');
      }
      G.combat?.onPlayerStep?.();
    }
    // action button
    if (this.canMove() && G.input.interact() && !G.ui.consumedConfirm) { if (G.coop?.phantom) this.askBossAction(); else this.tryAction(); }
  }
  // (a co-op phantom) the action button on an event of the host's world (a boss fight by the rules, a door when the
  // guests go their own way): under the player, or in front of it
  askBossAction() {
    return this.tryAction();
  }

  tryAction() {
    const pc = G.map.playerChar;
    const aim = this.interactionAim(), f = aim.direction;
    const d = G.vr ? this.facingDir(f) : this.facingDir();
    const dx = d === 4 ? -1 : d === 6 ? 1 : 0, dy = d === 8 ? -1 : d === 2 ? 1 : 0;
    let best = G.vr ? this.actionCone(f, undefined, aim.origin) : null;
    if (best) return this.startActionEvent(best.ev);
    if (G.vr || G.coop?.phantom) {
      // Keep the original underfoot/front/counter order, using the same aim as
      // the cone. Dispatch through the shared locks and co-op authority checks.
      const groups = [G.map.eventsXy(pc.x, pc.y).filter(ev => ev.triggerIn([0]) && !ev.normalPriority()),
        G.map.eventsXy(pc.x + dx, pc.y + dy).filter(ev => ev.triggerIn([0, 1, 2]) && ev.normalPriority())];
      if (G.map.grid.isCounter(pc.x + dx, pc.y + dy))
        groups.push(G.map.eventsXy(pc.x + dx * 2, pc.y + dy * 2).filter(ev => ev.triggerIn([0, 1, 2]) && ev.normalPriority()));
      for (const group of groups) for (const target of group)
        if (this.actionEventReady(target) && this.startActionEvent(target)) return true;
    } else if (G.map.actionAt(pc.x, pc.y, pc.x + dx, pc.y + dy)) return true;
    // forgiving cone search for 3D: nearest action event in front
    if (!G.vr) best = this.actionCone(f);
    if (best) return this.startActionEvent(best.ev);
    if (!best && !G.coop?.phantom && !G.map.interpreter.running() && G.combat?.allies?.talkTo(f)) return true;
    return false;
  }
  // World grabs use the same event and co-op authority path as the action button.
  // Never grant inventory directly or report an event that refused to start.
  startActionEvent(ev) {
    const map = G.map, pc = map?.playerChar;
    if (!pc || !this.canMove() || G.ui?.sceneOpen || G.combat?.gripAdjust || map.interpreter.running()) return false;
    if (!this.actionEventReady(ev) || map.eventList.some(other => other.starting)) return false;
    const position = eventActionPosition(ev, map, pc);
    if (!position) return false;
    // Scripted "move forward" commands must face the chosen visible target.
    const previousDirection = pc.direction, ex = position.x - pc.fx, ey = position.y - pc.fy;
    if (Math.hypot(ex, ey) > 1e-6) pc.direction = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 6 : 4) : (ey > 0 ? 2 : 8);
    const started = G.coop?.phantom ? G.coop.phantomTouch([ev], 'action') : ev.start();
    if (!started) pc.direction = previousDirection;
    return !!started;
  }
  actionEventReady(ev) {
    return !!ev && G.map.eventList.includes(ev) && !!ev.page && !ev.erased && !ev.starting && !ev.locked && !ev.empty()
      && [0, 1, 2].includes(ev.trigger) && !G.combat?.hidesEvent?.(ev) && !G.arena?.blocksTrigger?.(ev)
      && !(G.coop?.phantom && (ev.net?.hidden || ev.net?.gone));
  }
  // Only the original cardinal counter tile permits reaching a second cell.
  // An ordinary wall, floor or a counter off to the side never extends reach.
  actionAcrossCounter(ev) {
    const map = G.map, pc = map.playerChar;
    if (!ev.normalPriority()) return false;
    const dx = map.nearX(ev.x, pc.x) - pc.x, dy = map.nearY(ev.y, pc.y) - pc.y;
    return (Math.abs(dx) === 2 && dy === 0 || dx === 0 && Math.abs(dy) === 2)
      && map.grid.isCounter(pc.x + dx / 2, pc.y + dy / 2);
  }
  // the action event nearest in front (f: the way the player points), { ev, score } or null
  actionCone(f, ok = () => true, origin = this.interactionAim().origin) {
    const pc = G.map.playerChar;
    let best = null;
    for (const ev of G.map.eventList) {
      if (ev.trigger !== 0 || !this.actionEventReady(ev) || !ok(ev)) continue;
      const position = eventActionPosition(ev);
      if (!position) continue;
      const ex = position.x - pc.fx, ey = position.y - pc.fy;
      const dist = Math.hypot(ex, ey);
      const maxD = this.actionAcrossCounter(ev) ? 2.7 : ev.normalPriority() ? 1.7 : 1.1;
      if (dist > maxD) continue;
      // VR points from the hand, which may be beside or past an event underfoot.
      // That event must not beat the object the controller is actually aiming at.
      const ax = origin ? G.map.nearX(position.x, origin.x) - origin.x : ex;
      const ay = origin ? G.map.nearY(position.y, origin.y) - origin.y : ey;
      const aimDist = Math.hypot(ax, ay);
      const dot = !origin && dist < 0.4 ? 1 : (ax * f.x + ay * f.z) / (aimDist || 1);
      if (dot < 0.55) continue;
      const score = dist - dot;
      if (!best || score < best.score) best = { ev, score };
    }
    return best;
  }
  // VR: point with the right controller; desktop: view direction
  aimDirection() {
    return this.interactionAim().direction;
  }
  interactionAim() {
    const ray = G.vr && G.input.controllers.right?.ray;
    if (ray && ray.visible !== false) {
      const position = ray.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
      const horizontal = Math.hypot(forward.x, forward.z);
      // Three hides an untracked target ray but retains its old transform.
      // Near-vertical pointing also has no useful horizontal world target.
      if ([position.x, position.y, position.z, forward.x, forward.y, forward.z].every(Number.isFinite) && horizontal >= 0.2) {
        return { direction: { x: forward.x / horizontal, z: forward.z / horizontal },
          origin: { x: position.x / T - 0.5, y: position.z / T - 0.5 } };
      }
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const horizontal = Math.hypot(forward.x, forward.z), d = G.map?.playerChar?.direction;
    const direction = Number.isFinite(horizontal) && horizontal >= 0.2
      ? { x: forward.x / horizontal, z: forward.z / horizontal }
      : { x: d === 4 ? -1 : d === 6 ? 1 : 0, z: d === 2 ? 1 : d === 8 ? -1 : 0 };
    return { direction, origin: null };
  }

  // a way nobody can see (병든 시계탑 3's bridge - mapmesh.js hiddenWay): in 2D the player goes along it a tile at a time and
  // steps off only by turning to its side, so here a walk along it never drifts off it either - the head stays on the
  // way unless the move goes more to its side than along it
  keepOnHiddenWay(fx, fy, ix, iy) {
    const pc = G.map.playerChar;
    const axis = G.view?.mesh?.hiddenWay?.(pc.x, pc.y);   // (the cell stood on before this move)
    if (!axis) return [fx, fy];
    const along = axis === 'x' ? Math.abs(ix) : Math.abs(iy), across = axis === 'x' ? Math.abs(iy) : Math.abs(ix);
    if (across > along) return [fx, fy];
    const KEEP = 0.45;                                       // tiles from the way's middle line
    if (axis === 'x') { const c = G.map.nearY(pc.y, fy); fy = Math.min(c + KEEP, Math.max(c - KEEP, fy)); }
    else { const c = G.map.nearX(pc.x, fx); fx = Math.min(c + KEEP, Math.max(c - KEEP, fx)); }
    return [fx, fy];
  }

  // ---- collision: circle (fx,fy,R) vs blocked tile edges and blocking events ----
  resolve(fx, fy) {
    const m = G.map;
    let px = fx + 0.5, py = fy + 0.5; // corner coordinates
    for (let iter = 0; iter < 3; iter++) {
      const cx = Math.floor(px), cy = Math.floor(py);
      let moved = false;
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (let i = cx - 1; i <= cx + 1; i++) {
          // vertical edge on the right side of cell (i,j)
          if (this.edgeBlocked(i, j, 6, px, py)) [px, py, moved] = pushFromSegment(px, py, i + 1, j, i + 1, j + 1, moved);
          // horizontal edge below cell (i,j)
          if (this.edgeBlocked(i, j, 2, px, py)) [px, py, moved] = pushFromSegment(px, py, i, j + 1, i + 1, j + 1, moved);
        }
      }
      // blocking events
      for (const ev of m.eventList) {
        if (ev.through || !ev.normalPriority() || ev.erased || !ev.page) continue;
        if (G.combat?.hidesEvent(ev)) continue;
        if (ev.net?.hidden && G.coop?.phantom && !G.coop.leadsNow) continue;      // (gone in the host's world - coop.js)
        const ex = m.nearX(ev.realX, px - 0.5) + 0.5, ey = m.nearY(ev.realY, py - 0.5) + 0.5;
        const dx = px - ex, dy = py - ey;
        const d = Math.hypot(dx, dy), min = R + EVENT_R;
        if (d < min) {
          if (d < 1e-4) { px += min; continue; }
          px = ex + dx / d * min; py = ey + dy / d * min; moved = true;
        }
      }
      if (!moved) break;
    }
    return [px - 0.5, py - 0.5];
  }
  // is the edge between cell (i,j) and its neighbour in dir (6 or 2) blocked for the player,
  // considering which side the player is on (one-way passages)
  edgeBlocked(i, j, d, px, py) {
    const m = G.map;
    const ni = d === 6 ? i + 1 : i, nj = d === 2 ? j + 1 : j;
    // (on a looping map the cells past an edge are those on the other side)
    const inA = m.validW(i, j), inB = m.validW(ni, nj);
    if (!inA && !inB) return false;
    if (!inA || !inB) return true;
    const onA = d === 6 ? px < i + 1 : py < j + 1;
    return onA ? !m.playerEdgePassable(i, j, d) : !m.playerEdgePassable(ni, nj, 10 - d);
  }

  checkBump(mvx, mvy, fx, fy) {
    const phantom = !!G.coop?.phantom;
    if (this.bumpCooldown > 0 || G.map.interpreter.running()) return;
    const l = Math.hypot(mvx, mvy);
    if (l < 1e-5) return;
    const ux = mvx / l, uy = mvy / l;
    for (const ev of G.map.eventList) {
      if (ev.through || !ev.normalPriority() || !ev.page || !ev.triggerIn([1, 2]) || G.combat?.hidesEvent(ev) || G.arena?.blocksTrigger(ev)) continue;
      if (phantom && !G.coop.leadsNow && ev.net?.hidden) continue;
      const dx = G.map.nearX(ev.realX, fx) - fx, dy = G.map.nearY(ev.realY, fy) - fy;
      const d = Math.hypot(dx, dy);
      if (d < R + EVENT_R + 0.08 && (dx * ux + dy * uy) / d > 0.6) {
        this.bumpCooldown = 0.6;
        // (a co-op phantom: a boss fight there may be begun, a trap hurts it, a way out may take it - coop.js phantomTouch)
        if (phantom) G.coop.phantomTouch([ev], 'bump');
        else G.map.touchAt(ev.x, ev.y);
        return;
      }
    }
  }
}

function pushFromSegment(px, py, ax, ay, bx, by, moved) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const qx = ax + abx * t, qy = ay + aby * t;
  const dx = px - qx, dy = py - qy;
  const d = Math.hypot(dx, dy);
  if (d >= R) return [px, py, moved];
  if (d < 1e-6) return [px, py, moved];
  return [qx + dx / d * R, qy + dy / d * R, true];
}
