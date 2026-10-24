// The weapon's blows on the flat screen (PC), moved as Western swordsmanship moves a sword: the hand travels and the
// blade turns about it, its edge first through each cut - not the hand tipping the weapon where it is.
// At rest it is carried in the relaxed hand at the right hip, the point down.
// A click: a cut, the next one taking up where the last left off while the clicks come quickly - from above right down
// across to the left (Oberhau), back up from below left (Unterhau), across from the right (Zwerchhau), back from the
// left (Mittelhau), and round again. Pressed, the blade is already drawn back to where its cut starts. Held long enough
// for a charged blow, it is raised beside the head instead, the point to the front (Ochs), and let go it thrusts out
// (Stich). Only how it looks: what a blow hits, when and how far, is combat.js's as before (the blow's 0.32 s; its hits
// from a quarter of it on). Fists keep their own swing, guns and bows their hold (combat.js).
// Poses are in the camera's space (rest in the body's - DESK_REST): the hand where the weapon's group is, the blade
// along the group's -Z, the flats of the blade along its ±Y (combat.js wrapDesktop turns the model so) - turned toward
// the eyes through the blows, so the blade (a flat cut-out of its icon) is seen as a blade and not a line.
import * as THREE from 'three';

const V = a => new THREE.Vector3(...a);
const _m = new THREE.Matrix4(), ZERO = new THREE.Vector3(), _up = new THREE.Vector3(), _back = new THREE.Vector3();
// the blade pointing along d, its flat toward up
function orient(d, up, q = new THREE.Quaternion()) {
  _m.lookAt(ZERO, d, up);              // (lookAt puts -Z toward the target: the blade)
  return q.setFromRotationMatrix(_m);
}
// a pose held still: the hand at p, the blade pointing along d, its flat toward up (when not given: to the eyes)
const pose = (p, d, up) => {
  const pp = V(p), dd = V(d).normalize();
  if (!up) _up.copy(pp).addScaledVector(dd, 0.25).negate();
  return { p: pp, q: orient(dd, up ? V(up) : _up) };
};

// held still: in the relaxed hand at the right hip, the point down and a little forward, the flat out (a little
// forward). This one is in the body's own space - where the eyes are, turned as the body is but not tipped as they look
// up or down (update()'s body): it stays at the hip as one looks about, out of view ahead and seen looking down, where
// the others see it
export const DESK_REST = pose([0.23, -0.8, -0.04], [0.05, -0.78, -0.62], [0.87, 0, -0.5]);
// a fist, a gun or a bow: held out low right (their own swing / shot)
export const DESK_HOLD = { p: V([0.28, -0.3, -0.45]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.15, 0)) };
const WIND = 0.25, FINISH = 0.62;      // of a blow's time: drawn back to the cut's start until WIND, cut until FINISH, then through
const CHAIN = 0.6;                     // s after a blow ends within which a click takes up the chain
const RECOVER = 12;                    // 1/s: how fast the blade comes back to rest
const DRAW = 16;                       // 1/s: how fast a press draws it back to its cut's start (or the charge, into Ochs)
const TILT = 0.6;                      // the flat turned this much toward the eyes through a cut (seen as a blade, not a line)
const CHARGED = 0.35;                  // a blow charged this much (combat.js's 'strong' charge) is the thrust

const smooth = t => t * t * (3 - 2 * t);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
// a point along a curve from a through b (passed half way) to c
function through(a, b, c, t, out = new THREE.Vector3()) {
  const ctrl = b.clone().multiplyScalar(2).addScaledVector(a, -0.5).addScaledVector(c, -0.5);
  const u = 1 - t;
  return out.copy(a).multiplyScalar(u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(c, t * t);
}
// where a cut's blade points a radians on from the front (f) toward the way its tip goes (s)
const bladeAt = (c, a) => c.f.clone().multiplyScalar(Math.cos(a)).addScaledVector(c.s, Math.sin(a));

// a cut: the blade turning in one plane - f where it points as it passes the front, s the way its tip goes then -
// from a0 to a1 (radians from f toward s, a0 behind the side it starts from), the hand from `from` through `mid` to `to`
const CUTS = [
  { name: 'Oberhau', f: [-0.14, -0.2, -1], s: [-1, -1, 0], a0: -1.6, a1: 1.3, from: [0.3, -0.02, -0.4], mid: [0.06, -0.18, -0.6], to: [-0.18, -0.36, -0.46] },
  { name: 'Unterhau', f: [0.14, 0.02, -1], s: [1, 1, 0], a0: -1.45, a1: 1.35, from: [-0.2, -0.36, -0.44], mid: [0.04, -0.18, -0.6], to: [0.28, -0.04, -0.44] },
  { name: 'Zwerchhau', f: [0, -0.06, -1], s: [-1, 0, 0], a0: -1.6, a1: 1.4, from: [0.32, -0.16, -0.38], mid: [0.04, -0.16, -0.62], to: [-0.28, -0.18, -0.44] },
  { name: 'Mittelhau', f: [0, -0.04, -1], s: [1, 0, 0], a0: -1.55, a1: 1.4, from: [-0.28, -0.18, -0.44], mid: [0.02, -0.16, -0.62], to: [0.32, -0.15, -0.4] },
].map(c => {
  const f = V(c.f).normalize(), s0 = V(c.s);
  const s = s0.addScaledVector(f, -s0.dot(f)).normalize();
  const up = new THREE.Vector3().crossVectors(f, s).addScaledVector(new THREE.Vector3(0, 0, 1), TILT).normalize();
  const cut = { ...c, f, s, up, from: V(c.from), mid: V(c.mid), to: V(c.to) };
  cut.q0 = orient(bladeAt(cut, c.a0), up);          // (drawn back: where the cut starts)
  return cut;
});
// the charge's guard (Ochs: raised beside the head, the point to the front - at what is before the eyes) and the
// thrust's end (Stich: the arm out, the point on into it)
const OCHS = pose([0.2, -0.08, -0.26], [-0.24, -0.02, -0.97]);
const STICH = pose([0.08, -0.22, -0.58], [-0.1, 0.14, -0.985], [-0.7, 0.7, 0.1]);

// a cut's pose at k (0-1 of the blow), drawn back from `start` (where the blade was as it began)
function cutPose(c, k, start, out) {
  if (k < WIND) {
    const t = easeOut(k / WIND);
    out.p.lerpVectors(start.p, c.from, t);
    out.q.slerpQuaternions(start.q, c.q0, t);
    return out;
  }
  // the cut itself, then through: the blade runs on a little past its end and settles there
  const t = k < FINISH ? easeInOut((k - WIND) / (FINISH - WIND)) : 1 + 0.06 * Math.sin(Math.PI * (k - FINISH) / (1 - FINISH));
  through(c.from, c.mid, c.to, Math.min(t, 1), out.p);
  orient(bladeAt(c, c.a0 + (c.a1 - c.a0) * t), c.up, out.q);
  return out;
}
// the thrust's pose at k, from `start` (the guard the charge drew it back to) - drawn half way back to `rest` at the end
function thrustPose(k, start, out, rest = DESK_REST) {
  if (k < 0.1) {                        // a little further back first
    const t = smooth(k / 0.1);
    out.p.copy(start.p).add(_back.set(0.01, 0.01, 0.04).multiplyScalar(t));
    out.q.copy(start.q);
  } else if (k < 0.38) {                // out, fast
    const t = easeOut((k - 0.1) / 0.28);
    out.p.copy(start.p).add(_back.set(0.01, 0.01, 0.04)).lerp(STICH.p, t);
    out.q.slerpQuaternions(start.q, STICH.q, t);
  } else if (k < 0.65) {                // held there
    out.p.copy(STICH.p); out.q.copy(STICH.q);
  } else {                              // drawn half way back (the rest of the way after the blow)
    const t = smooth((k - 0.65) / 0.35) * 0.5;
    out.p.lerpVectors(STICH.p, rest.p, t);
    out.q.slerpQuaternions(STICH.q, rest.q, t);
  }
  return out;
}
// (tests, pictures) a blow's pose: `cut` 0-3 or 'thrust', at k, begun from `start` (when not given: rest - the charge's
// guard for the thrust)
export function deskBlowPose(which, k, start = which === 'thrust' ? OCHS : DESK_REST) {
  const out = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  return which === 'thrust' ? thrustPose(k, start, out) : cutPose(CUTS[which], k, start, out);
}
export const DESK_CUTS = CUTS.map(c => c.name);
const _rest = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

// one player's blade on the flat screen: begin() as a blow starts, update() every frame (the blow's own time, the press
// or charge held, or rest), reset() when the weapon changes (blade: false - a fist, gun or bow - held as DESK_HOLD)
export class DeskSwing {
  constructor() { this.reset(); }
  reset(weapon = null, blade = true) {
    this.blade = blade;
    this.next = 0; this.endedAt = -99; this.blow = null; this.coming = null;
    const rest = blade ? DESK_REST : DESK_HOLD;
    this.pose = { p: rest.p.clone(), q: rest.q.clone() };
    if (weapon) { weapon.position.copy(rest.p); weapon.quaternion.copy(rest.q); }
  }
  // the cut a click now makes: the chain's next one - its first again when the last blow ended a while ago
  cutNow(now) { return now - this.endedAt > CHAIN ? 0 : this.next; }
  // a blow begins (combat.js's swing, its charge): a thrust if charged, else the cut the press drew back for
  begin(swing, now) {
    const thrust = (swing.charge || 0) >= CHARGED;
    const cut = this.coming ?? this.cutNow(now);
    swing.style = thrust ? 'thrust' : cut;
    if (!thrust) this.next = (cut + 1) % CUTS.length;
    this.blow = swing; this.coming = null;
    this.start = { p: this.pose.p.clone(), q: this.pose.q.clone() };
  }
  // the blade where it is now: the blow's pose (k: 0-1 of it); else, pressed (charge: 0-1 held, or null), drawn back to
  // where its cut starts - or raised into Ochs once it is charged enough for the thrust; else back to rest. body: the
  // turn from the body's own space to the camera's (DESK_REST)
  update(weapon, dt, now, swing, k, charge, body) {
    if (!this.blade) return;
    const pose = this.pose, rest = _rest;
    rest.p.copy(DESK_REST.p).applyQuaternion(body); rest.q.copy(body).multiply(DESK_REST.q);
    if (swing && swing === this.blow) {
      const out = { p: pose.p, q: pose.q };
      if (swing.style === 'thrust') thrustPose(k, this.start, out, rest); else cutPose(CUTS[swing.style], k, this.start, out);
    } else {
      if (this.blow) { this.blow = null; this.endedAt = now; }
      if (charge != null) {
        this.coming ??= this.cutNow(now);
        const a = 1 - Math.exp(-dt * DRAW);
        if (charge < CHARGED) {
          const c = CUTS[this.coming];
          pose.p.lerp(c.from, a); pose.q.slerp(c.q0, a);
        } else {
          // a tremble as the charge fills
          const p = OCHS.p.clone();
          p.x += Math.sin(now * 53) * 0.003 * charge; p.y += Math.sin(now * 41 + 1) * 0.003 * charge;
          pose.p.lerp(p, a); pose.q.slerp(OCHS.q, a);
        }
      } else {
        this.coming = null;
        const a = 1 - Math.exp(-dt * RECOVER);
        pose.p.lerp(rest.p, a); pose.q.slerp(rest.q, a);
      }
    }
    weapon.position.copy(pose.p);
    weapon.quaternion.copy(pose.q);
  }
}
