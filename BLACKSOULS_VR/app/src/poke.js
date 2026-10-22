// 무장해제 bare hands on people (VR): put a hand on someone's head from above and push down - they squash a
// little and come back up as the hand lifts; take hold of them (grip) and pull - they stretch toward the pull
// and lean that way, and when let go they spring back (one small give, no jelly wobble). Map people (event pictures standing up,
// not objects, doors, tile pictures, what lies on the floor or is set on a wall) and companions. Only how they
// look changes: nobody is moved, talked to or hurt (nor are the dead: corpses and fallen people are left alone)
import * as THREE from 'three';
import { G } from './globals.js';

// the spring back: damped near to still (damping ratio ~0.65 - one small give past rest, then still in about 0.4 s).
// It was 170 / 7.5 (ratio 0.29: 40 % past rest and a second of wobbling) with a deeper squash that bulged out -
// the user found people like pudding
const K = 200, DAMP = 18.5;
const SQUASH_MIN = 0.86;                // a press squashes to this much of the height at most
const STRETCH_MAX = 1.16;               // a pull stretches to this much at most
const BULGE = 0.3;                      // how much wider a squashed one gets (width = height ^ -BULGE; 0.5 kept the volume)
const PULL_MAX = 0.6, PULL_GAIN = 0.9;   // m of hand travel that counts / how much of it the head follows
const R_HEAD = 0.3, R_BODY = 0.38;      // m from the middle of a person that a hand counts as on them
const LET_GO = 0.9;                     // m: a hand pulled this far loses its hold
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Poke {
  constructor() {
    this.wob = new Map();                 // target key -> its spring state
    this.holds = { left: null, right: null };
    this.armed = { left: new Set(), right: new Set() };   // people a hand is just above (a press starts there)
    this.handsOverride = null;            // (tests: () => [{ hand, pos, held, pressed, released }])
  }
  // the bare hands this frame
  hands() {
    if (this.handsOverride) return this.handsOverride();
    const out = [];
    if (!G.vr || !G.combat?.disarmed) return out;
    for (const hand of ['left', 'right']) {
      const c = G.input.controllers[hand];
      if (!c?.grip || G.combat.held?.hand === hand || (hand === 'right' && G.combat.ready?.kind === 'item')) continue;
      out.push({ hand, pos: c.grip.getWorldPosition(new THREE.Vector3()), held: G.input.xrHeld(hand, 1), pressed: G.input.xrPressed(hand, 1), released: G.input.xrReleased(hand, 1) });
    }
    return out;
  }
  // who can be touched, where their feet are and how tall they stand
  targets(sprites) {
    const out = [];
    for (const s of sprites || []) {
      const m = s.mesh;
      if (!m || s.hiddenNow !== false || s.mode !== 'stand' || s.facade || s.tp || s.translucent || !s.info || s.info.object || s.info.tile || s.isCorpseGraphic()) continue;
      if (s.spot && s.spot.side !== 'top') continue;
      const h = (m.geometry.parameters?.height || 0) * m.scale.y;
      if (!h) continue;
      const base = s.group.position.clone().add(_v.set(0, m.position.y, 0));
      out.push({ key: s, obj: m, base, top: base.y + h - (s.headDrop || 0) * m.scale.y, h, yaw: m.rotation.y, multiply: true });
    }
    for (const a of G.combat?.allies?.list || []) {
      const b = a.bodyGroup;
      if (!b || !a.group.visible || !a.stands || !a.parts.length || a.fallen > 0.2) continue;
      const base = a.group.position.clone().add(_v.set(b.position.x, b.position.y, b.position.z));
      out.push({ key: a, obj: b, base, top: base.y + a.h * 0.96, h: a.h, yaw: b.rotation.y, multiply: false });
    }
    return out;
  }
  update(dt, sprites) {
    const hands = this.hands();
    if (!hands.length && !this.wob.size && !this.holds.left && !this.holds.right) return;   // (nothing to do: no bare hands, all still)
    const list = this.targets(sprites);
    const byKey = new Map(list.map(t => [t.key, t]));
    const press = new Map();              // target -> how deep a hand pushes its head down (m)
    for (const hd of hands) {
      const hold = this.holds[hd.hand];
      // a hold: lasts while the grip is held and the hand stays near
      if (hold) {
        const t = byKey.get(hold.key);
        if (!t || !hd.held || hd.pos.distanceTo(hold.start) > LET_GO) {
          this.holds[hd.hand] = null;
          G.input.haptic?.(hd.hand, 0.15, 25);
        } else {
          hold.pull = _w.copy(hd.pos).sub(hold.start).clone();
          continue;
        }
      }
      // taking hold: the grip pressed with the hand on someone (the nearest)
      if (hd.pressed) {
        let best = null, bd = Infinity;
        for (const t of list) {
          const d = Math.hypot(hd.pos.x - t.base.x, hd.pos.z - t.base.z);
          if (d > R_BODY || hd.pos.y < t.base.y + 0.1 || hd.pos.y > t.top + 0.15) continue;
          if (d < bd) { bd = d; best = t; }
        }
        if (best && ![...Object.values(this.holds)].some(o => o?.key === best.key)) {
          this.holds[hd.hand] = { key: best.key, start: hd.pos.clone(), pull: new THREE.Vector3() };
          G.input.haptic?.(hd.hand, 0.35, 40);
          continue;
        }
      }
      // a press: the hand comes down onto the head from above
      const armed = this.armed[hd.hand];
      for (const t of list) {
        const d = Math.hypot(hd.pos.x - t.base.x, hd.pos.z - t.base.z);
        if (d > R_HEAD + (armed.has(t.key) ? 0.06 : 0)) { armed.delete(t.key); continue; }
        if (hd.pos.y >= t.top - 0.02) { armed.add(t.key); continue; }
        if (!armed.has(t.key) || hd.pos.y < t.base.y + t.h * 0.3) continue;
        const depth = t.top - hd.pos.y;
        if (depth > (press.get(t.key) || 0)) {
          if (!press.has(t.key) && !this.wob.get(t.key)?.pressed) G.input.haptic?.(hd.hand, 0.25, 30);
          press.set(t.key, depth);
        }
      }
    }
    // (a hand that is gone - armed again, the controller asleep - lets go)
    for (const hand of ['left', 'right']) if (!hands.some(hd => hd.hand === hand)) { this.holds[hand] = null; this.armed[hand].clear(); }
    for (const k of this.armed.left) if (!byKey.has(k)) this.armed.left.delete(k);
    for (const k of this.armed.right) if (!byKey.has(k)) this.armed.right.delete(k);
    // what each one is pulled or pushed to, and the spring toward it
    for (const t of list) {
      const hold = Object.values(this.holds).find(o => o?.key === t.key);
      let sy = 1, roll = 0, lean = 0;
      if (hold) {
        const p = hold.pull.clone();
        if (p.length() > PULL_MAX) p.setLength(PULL_MAX);
        p.multiplyScalar(PULL_GAIN);
        // the head goes where the pull takes it: the stick from the feet to the head turns and stretches
        const rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw), fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
        const aR = p.x * rx + p.z * rz, aF = p.x * fx + p.z * fz, aU = t.h + p.y;
        roll = -Math.atan2(aR, aU);
        lean = Math.atan2(aF, aU);
        sy = THREE.MathUtils.clamp(Math.hypot(aR, aF, aU) / t.h, SQUASH_MIN, STRETCH_MAX);
      } else if (press.has(t.key)) {
        sy = THREE.MathUtils.clamp(1 - press.get(t.key) / (t.h * 0.75), SQUASH_MIN, 1);
      }
      let w = this.wob.get(t.key);
      const busy = hold || press.has(t.key);
      if (!w) {
        if (!busy) continue;
        w = { sy: 1, vy: 0, roll: 0, vr: 0, lean: 0, vl: 0 };
        this.wob.set(t.key, w);
      }
      w.pressed = press.has(t.key);
      const step = Math.min(dt, 0.05);
      w.vy += (-K * (w.sy - sy) - DAMP * w.vy) * step; w.sy += w.vy * step;
      w.vr += (-K * (w.roll - roll) - DAMP * w.vr) * step; w.roll += w.vr * step;
      w.vl += (-K * (w.lean - lean) - DAMP * w.vl) * step; w.lean += w.vl * step;
      const sx = Math.pow(Math.max(0.3, w.sy), -BULGE);
      const o = t.obj;
      if (t.multiply) { o.scale.x *= sx; o.scale.y *= w.sy; } else o.scale.set(sx, w.sy, 1);
      o.rotation.order = 'YXZ';
      o.rotation.z = w.roll; o.rotation.x = w.lean;
      // still again: back to as it was
      if (!busy && Math.abs(w.sy - 1) < 0.002 && Math.abs(w.vy) < 0.01 && Math.abs(w.roll) < 0.002 && Math.abs(w.lean) < 0.002 && Math.abs(w.vr) + Math.abs(w.vl) < 0.02) {
        if (!t.multiply) o.scale.set(1, 1, 1);
        o.rotation.z = 0; o.rotation.x = 0;
        this.wob.delete(t.key);
      }
    }
    // those that went away mid-wobble (the map changed, they were hidden): left as they were set
    for (const k of [...this.wob.keys()]) if (!byKey.has(k)) {
      const o = k.mesh || k.bodyGroup;
      if (o) { o.rotation.z = 0; o.rotation.x = 0; if (k.bodyGroup) o.scale.set(1, 1, 1); }
      this.wob.delete(k);
    }
    for (const hand of ['left', 'right']) if (this.holds[hand] && !byKey.has(this.holds[hand].key)) this.holds[hand] = null;
  }
  reset() { this.wob.clear(); this.holds.left = this.holds.right = null; this.armed.left.clear(); this.armed.right.clear(); }
}
