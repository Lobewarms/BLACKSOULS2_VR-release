// VR: a blade held as a real one is - its grip fast in the fist, the blade turned after the hand by a wrist of limited
// strength (weaponSway): what it can do it does at once (a slow aim, a light weapon: no lag at all), a swing that asks
// more than it has leaves the blade behind, and stopped it carries on as far as the wrist can brake it - then back
// where it is held without swaying (damped all but critically: no spring's bounce). A heavier one is pulled down by
// its weight too (held out level it sags). All in the player's own space (the rig, the grip's parent): walking,
// running, turning and jumping carry it with the player and never swing it - only the arm does. A gun, bow or fist is
// held fast. What it hits is where its blade really is (combat.js weaponSegment reads the weapon's own place).
import * as THREE from 'three';

const STEP = 1 / 240;          // s: stepped at most this long at a time (a long frame: in several)
const ZETA = 0.8;              // the wrist's damping (1: critical): below 1 a moment's carry, too little to bounce
const BRAKE = 2;               // past where the hand holds it, the wrist brakes it this much harder than it can swing it
const BEND = 60 * Math.PI / 180;   // at most this far behind the hand or past it
// how heavy (the weapon's moment against a plain 1 m sword's): its weight (combat.js weaponPace - a light one less, a
// heavy one more) and length; 무기 무게감 (G.settings.weaponWeight) as if heavier or lighter - 0 off (held fast), 1 light,
// 2 as it is (the default), 3 heavy. Under RIGID: held fast (a light dagger)
export const WEIGHT_LEVELS = [0, 0.75, 1, 1.3];
const RIGID = 0.6;
const STRENGTH = 420;          // rad/s^2 the wrist can swing a plain sword at; a heavier one's: / heaviness^2
const STIFF = 40;              // 1/s: how tightly it is held (a plain sword); a heavier one's: / heaviness^1.2
const SAG = 0.25;              // rad a level blade sags per heaviness above a plain sword's - never more than SAG_MAX of the strength
const SAG_MAX = 0.7;

// how a blade is swung after the hand: null (held fast) or { w0 (1/s, how tightly), amax (rad/s^2, the wrist's
// strength), grav (rad/s^2, its weight's pull held level) }
export function weaponSway(pace, length, level = 2) {
  const k = WEIGHT_LEVELS[level] ?? 1;
  if (!k || !(pace > 0)) return null;
  const J = k * Math.sqrt(Math.max(0.3, length || 1)) / (pace * pace);
  if (J < RIGID) return null;
  const w0 = THREE.MathUtils.clamp(STIFF * J ** -1.2, 9, 80), amax = Math.max(40, STRENGTH / (J * J));
  return { w0, amax, grav: Math.min(SAG * Math.max(0, J - 1) * w0 * w0, SAG_MAX * amax) };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Vector3(), _a = new THREE.Vector3();
const _g = new THREE.Vector3(), _wt = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _iq = new THREE.Quaternion();

export class WeaponLag {
  constructor() {
    this.b = new THREE.Vector3(); this.w = new THREE.Vector3();          // where the blade points, how fast it turns (the rig's space)
    this.D0 = new THREE.Vector3();                                       // where the hand pointed it a frame ago
    this.mine = { p: new THREE.Vector3(), q: new THREE.Quaternion(), set: false };
    this.d0 = new THREE.Vector3(0, 0, -1);
    this.weapon = null; this.grip = null; this.sway = null; this.live = false;
  }
  // the weapon as it is put in the grip (that pose kept as how it is held), and how it is swung (weaponSway; null:
  // held fast)
  reset(weapon, sway) {
    this.weapon = weapon; this.grip = weapon?.parent || null;
    this.sway = sway || null; this.live = false; this.mine.set = false;
    this.base = weapon ? { p: weapon.position.clone(), q: weapon.quaternion.clone() } : null;
    if (weapon) this.d0.set(0, 0, -1).applyQuaternion(this.base.q);
  }
  // still in its grip; nothing put on it here yet, or held another way since (the grip adjust: moved by hand) - that
  // taken as how it is held
  held() {
    const w = this.weapon;
    if (!w || !this.grip || w.parent !== this.grip) { this.live = false; return false; }
    if (!this.mine.set || !w.position.equals(this.mine.p) || !w.quaternion.equals(this.mine.q)) {
      this.base.p.copy(w.position); this.base.q.copy(w.quaternion);
      this.d0.set(0, 0, -1).applyQuaternion(this.base.q);
      if (this.mine.set) { this.mine.set = false; this.live = false; }
    }
    return true;
  }
  put(q) {
    const w = this.weapon;
    w.position.copy(this.base.p); w.quaternion.copy(q);
    this.mine.p.copy(w.position); this.mine.q.copy(w.quaternion); this.mine.set = true;
  }
  // (not swung meanwhile - put away, something else in hand) straight in the hand, and from there again
  settle() {
    this.live = false;
    if (this.sway && this.mine.set && this.held()) this.put(this.base.q);
  }
  // (the setting changed) how it is swung from now on - straight in the hand till swung
  setSway(sway) { this.settle(); this.sway = sway || null; }
  // every frame, before the blade is read
  update(dt) {
    const sw = this.sway;
    if (!sw || !this.held() || !(dt > 0)) return;
    const grip = this.grip;
    // where the hand points the blade, in the player's own space (the grip's parent - the rig: its down the world's)
    const D = _d.copy(this.d0).applyQuaternion(grip.quaternion);
    if (!this.live || dt > 0.25 || D.dot(this.D0) < 0) {
      // (just put in hand, after a stop, or the hand's tracking jumped: where it is held)
      this.b.copy(D); this.w.set(0, 0, 0); this.live = true;
    } else {
      const n = Math.ceil(dt / STEP), h = dt / n, { w0, amax, grav } = sw;
      // (how fast the hand turns it, over the frame)
      _wt.crossVectors(this.D0, D);
      const turn = Math.atan2(_wt.length(), this.D0.dot(D));
      if (turn > 1e-9) _wt.setLength(turn / dt); else _wt.set(0, 0, 0);
      for (let i = 1; i <= n; i++) {
        const t = _t.copy(this.D0).lerp(D, i / n).normalize();
        // the wrist: turned toward where the hand holds it, damped against the hand's own turn - as hard as it can
        _e.crossVectors(this.b, t);
        const sin = _e.length(), off = Math.atan2(sin, this.b.dot(t));
        if (sin > 1e-9) _e.multiplyScalar(off / sin); else _e.set(0, 0, 0);
        _a.copy(_e).multiplyScalar(w0 * w0).addScaledVector(_v.copy(_wt).sub(this.w), 2 * ZETA * w0);
        const most = _e.dot(this.w) < 0 ? amax * BRAKE : amax;
        if (_a.lengthSq() > most * most) _a.setLength(most);
        // and its weight pulling it down
        _a.add(_g.crossVectors(this.b, DOWN).multiplyScalar(grav));
        this.w.addScaledVector(_a, h);
        this.w.addScaledVector(this.b, -this.w.dot(this.b));            // (its twist the hand's own)
        const spin = this.w.length();
        if (spin > 1e-9) this.b.applyQuaternion(_q.setFromAxisAngle(_v.copy(this.w).divideScalar(spin), spin * h)).normalize();
        // never further behind or past than BEND: held there - dragged along, none of the hand's own speed given it
        const far = this.b.angleTo(t);
        if (far > BEND) {
          _iq.identity().slerp(_q.setFromUnitVectors(t, this.b), BEND / far);
          this.b.copy(t).applyQuaternion(_iq);
          const away = _v.crossVectors(t, this.b).normalize(), wa = this.w.dot(away);
          if (wa > 0) this.w.addScaledVector(away, -wa);
          this.w.addScaledVector(this.b, -this.w.dot(this.b));
        }
      }
      if (!Number.isFinite(this.b.x + this.b.y + this.b.z + this.w.x + this.w.y + this.w.z)) { this.b.copy(D); this.w.set(0, 0, 0); }
    }
    this.D0.copy(D);
    // turned from where the hand points it to where the blade is (in the grip's space), about the grip
    _p.copy(this.b).applyQuaternion(_iq.copy(grip.quaternion).invert());
    this.put(_q.setFromUnitVectors(this.d0, _p).multiply(this.base.q));
  }
}
