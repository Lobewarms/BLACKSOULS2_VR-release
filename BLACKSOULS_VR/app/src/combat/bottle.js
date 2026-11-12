// A herb bottle or a syringe in the right hand (VR): taken out, drunk or jabbed, put away.
import * as THREE from 'three';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { stripEscapes } from '../ui.js';
import { ELEMENT_FX } from '../weaponfx.js';
import { buildIconModel } from '../weapons.js';
import { ELEMENT_SE, HERB_ICONS, RESIN_RUB, SYRINGE_ICON, TURN_SECONDS, bodyRelative } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class BottlePart {
  // ---- a herb bottle / syringe in the right hand (VR) ----------------------------------------
  // The herb bottles go to the mouth, the syringes (수혈액) into the body: the item is used when it
  // gets there. X (the quick button) puts it away.
  handUse(obj) {
    if (!G.vr || !obj) return null;
    if (this.isResin(obj)) return G.input.controllers.left && this.weapon ? 'rub' : null;
    if (!G.input.controllers.right) return null;
    if (HERB_ICONS.includes(obj.icon_index)) return 'mouth';
    if (obj.icon_index === SYRINGE_ICON) return 'stab';
    return null;
  }
  // a resin (송진): an item that gives the attack an element for a while
  isResin(obj) {
    return (obj?.effects || []).some(e => e.code === 21 && ($data.states[e.data_id]?.features || []).some(f => f.code === 31));
  }
  resinElements(obj) {
    const out = [];
    for (const e of obj?.effects || []) if (e.code === 21) for (const f of $data.states[e.data_id]?.features || []) if (f.code === 31 && ELEMENT_FX[f.data_id]) out.push(ELEMENT_FX[f.data_id]);
    return out;
  }
  holdConsumable(obj, how) {
    if (G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name: stripEscapes(obj.name) }), obj.icon_index); return false; }
    this.cancelReady();
    this.cancelHeld();
    const stab = how === 'stab', rub = how === 'rub';
    const hand = rub ? 'left' : 'right';
    // the icon as a solid model held like a weapon (the hand hides behind it); its -Z end is the
    // bottle's neck / the needle / the resin's lump
    const model = buildIconModel(obj.icon_index, {
      kind: 'weapon', wtype: 0, hand,
      adjust: stab ? { rot: 225, flip: false, offset: 6, scale: 0.13 } : rub ? { rot: 0, flip: false, offset: 7, scale: 0.1 } : { rot: 0, flip: false, offset: 9, scale: 0.11 } });
    const wrap = new THREE.Group();
    if (model) wrap.add(model); else wrap.add(this.iconSprite(obj.icon_index));
    const tip = new THREE.Object3D();
    tip.position.set(0, 0, -(model?.userData.length || 0.1));
    wrap.add(tip);
    // the bottle's neck out of the top of the fist; the syringe the other way round, needle out of the
    // bottom of the fist (a downward stab)
    if (stab) wrap.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(wrap);
    holder.position.set(0, 0, 0.03);
    G.input.controllers[hand].grip.add(holder);
    wrap.userData.holder = holder;
    this.held = { obj, how, hand, fx: wrap, tip, t: 0, near: 0, hist: null, wasInside: null, rub: 0, along: null, buzz: 0, rubbing: false };
    G.audio?.playSe(G.seAt('Equip1', 60, 120));
    G.input.haptic(hand, 0.4, 50);
    return true;
  }
  cancelHeld(sound = false) {
    const h = this.held;
    if (!h) return;
    const holder = h.fx.userData.holder;
    holder?.parent?.remove(holder);
    h.fx.parent?.remove(h.fx);
    h.fx.traverse(o => {
      if (!o.isSprite) o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.held = null;
    this.showArms();
    if (sound) G.audio?.playSystemSe(2);
  }
  // just below the eyes, a little in front of them
  mouthPoint(out) {
    return G.three.camera.localToWorld(out.set(0, -0.075, -0.06));
  }
  // the body under the head (a capsule from the neck to the knees), the other hand and its forearm
  insideBody(p) {
    const cam = G.three.camera;
    const head = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const axisX = head.x - fwd.x * 0.08, axisZ = head.z - fwd.z * 0.08;   // the neck is behind the eyes
    const top = head.y - 0.18, bottom = head.y - 1.25;
    const y = THREE.MathUtils.clamp(p.y, bottom, top);
    if (Math.hypot(p.x - axisX, p.z - axisZ) + Math.abs(p.y - y) < 0.2) return true;
    const left = G.input.controllers.left?.grip;
    if (left) {
      const a = left.getWorldPosition(new THREE.Vector3());
      if (a.distanceTo(p) < 0.09) return true;
      // the forearm runs back from the hand toward the body
      const elbow = new THREE.Vector3(0, 0, 0.26).applyMatrix4(left.matrixWorld);
      const seg = new THREE.Line3(a, elbow);
      if (seg.closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p) < 0.055) return true;
    }
    return false;
  }
  updateHeld(dt, paused) {
    const h = this.held;
    if (!h) return;
    if (this.playerDead || this.spectating || G.ui.menuOpen || G.map?.transferring || !G.vr) { this.cancelHeld(); return; }
    if (h.how === 'rub') { if (this.shield) this.shield.visible = false; }   // the resin is in the shield hand
    else if (this.weapon) this.weapon.visible = false;      // the item is in the weapon hand
    h.t += dt;
    if (paused) { h.hist = null; h.wasInside = null; h.near = 0; h.along = null; return; }
    const tip = h.tip.getWorldPosition(new THREE.Vector3());
    if (h.how === 'rub') this.rubResin(h, tip, dt);
    else if (h.how === 'mouth') {
      // held at the lips for a moment: drunk
      h.near = tip.distanceTo(this.mouthPoint(new THREE.Vector3())) < 0.1 ? h.near + dt : 0;
      if (h.near > 0.25) this.consumeHeld();
    } else {
      // pushed into the body from outside (not resting against it, not pulled out of it); the speed
      // is taken over the last few frames so one jittery frame does not count as a thrust
      const inside = this.insideBody(tip);
      const hist = h.hist || (h.hist = []);
      hist.push({ t: h.t, p: bodyRelative(tip, new THREE.Vector3()) });
      while (hist.length > 2 && h.t - hist[0].t > 0.07) hist.shift();
      const span = h.t - hist[0].t;
      const speed = span > 0.02 ? hist[hist.length - 1].p.distanceTo(hist[0].p) / span : 0;
      const entering = inside && h.wasInside === false;
      h.wasInside = inside;
      if (entering && speed > 0.45 && h.t > 0.3) this.consumeHeld();
    }
  }
  consumeHeld() {
    const h = this.held;
    if (!h) return;
    const { obj, how } = h;
    this.cancelHeld();
    if (G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name: stripEscapes(obj.name) }), obj.icon_index); return; }
    const used = this.useItem(obj, 'quick');
    if (!used) { G.ui.toast(tr('{name}: 효과가 없었다', { name: stripEscapes(obj.name) }), obj.icon_index); return; }
    if (how === 'rub') {
      // the resin is on: its element flares up along the weapon
      const els = this.resinElements(obj), seg = this.weaponSeg();
      for (const el of els) this.weaponFx.burst(seg, el);
      G.audio?.playSe(G.seAt(ELEMENT_SE[els[0]] || 'Magic1', 75, 110), seg?.tip);
      G.input.haptic('left', 0.7, 140); G.input.haptic('right', 0.7, 140);
      return;
    }
    if (how === 'stab') G.audio?.playSe(G.seAt('Damage1', 55, 140));
    G.input.haptic('right', how === 'stab' ? 0.8 : 0.5, how === 'stab' ? 90 : 160);
  }
  // the resin in the left hand rubbed along the weapon in the right: what counts is how far the touching spot
  // slides along the blade (moving either hand does it); a short touch or a tap is not enough
  rubResin(h, resinTip, dt) {
    const seg = this.weaponSeg();
    if (!seg) { h.along = null; return; }
    const holder = h.fx.userData.holder;
    const grip = holder ? holder.getWorldPosition(new THREE.Vector3()) : resinTip.clone();
    const line = new THREE.Line3(seg.base, seg.tip), q = new THREE.Vector3();
    let best = null;
    for (const p of [resinTip, grip.clone().lerp(resinTip, 0.5), grip]) {
      const t = line.closestPointToPointParameter(p, true);
      const d = line.at(t, q).distanceTo(p);
      if (!best || d < best.d) best = { d, t, at: q.clone() };
    }
    const touching = best.d < 0.06;
    const along = best.t * line.distance();
    if (touching && h.along != null) {
      const step = Math.abs(along - h.along);
      if (step < 0.15) h.rub += step;            // (a jump between frames is not a rub)
      if (step > 0.002) {
        h.buzz -= dt;
        if (h.buzz <= 0) {
          h.buzz = 0.06;
          G.input.haptic('left', 0.25, 25); G.input.haptic('right', 0.2, 25);
          const els = this.resinElements(h.obj);
          const color = { fire: 0xff9040, ice: 0xa0e0ff, thunder: 0xfff0a0, dark: 0xa040ff, light: 0xffe8a0 }[els[0]] || 0xffe0a0;
          this.spawnGlow(best.at, { color, size: 0.08, life: 0.18, grow: 1.4 });
        }
      }
      if (!h.rubbing) { h.rubbing = true; G.audio?.playSe(G.seAt('Sand', 45, 120), best.at); }
    } else if (!touching) h.rubbing = false;
    h.along = touching ? along : null;
    if (h.rub >= RESIN_RUB && h.t > 0.3) this.consumeHeld();
  }
  // the weapon's grip-to-tip line (world), while it is drawn
  weaponSeg() {
    if (!this.weapon || !this.weapon.visible || !this.weapon.parent) return null;
    const base = new THREE.Vector3(), tip = new THREE.Vector3();
    if (!this.weaponSegment(base, tip)) return null;
    if (!G.vr && !this.weapon.userData.unarmed) tip.lerp(base, 0.4);   // (the flat-screen model is drawn at 0.6)
    return { base, tip };
  }
  // A state an event gives the party during a fight (Change State, 313 - a boss's rules: 그랑・기뇰's 악랄영역 that
  // goes round atk -> def -> mat -> mdf): its turns run as any state's do in a battle, and one VX Ace takes away
  // when a battle ends goes with this fight
  eventStateAdded(actor, id, interp) {
    if (!this.inCombat || !actor.isState(id)) return;
    if (actor === G.state.party.leader()) this.timeActorState(id);
    if ($data.states[id]?.remove_at_battle_end) {
      const b = this.battleOf(interp);
      if (b) (b.eventStates ||= []).push([actor, id]);
    }
  }
  // an event's own blow on the player during a fight (Change HP / Change State - 가짜 바다거북's wrong answer, a
  // trap's 9999): they fall as from any blow, the fight lost (its lose branch, or the death common event)
  eventDeathCheck(interp) {
    const a = G.state.party.leader();
    if (this.spectating) return true;                       // (co-op: watching a boss fight fallen - none of its blows land)
    if (!this.inCombat || this.playerDead || !a || (a.hp > 0 && !a.isState(1))) return false;
    if (!a.isState(1) && a.stateResist(1)) return false;       // (진혼가, 불사신: it stays up at 0 HP)
    a.hp = 0;
    this.onPlayerDeath(this.battleOf(interp));
    return true;
  }
  // the player's own buffs wear off after their turns (TURN_SECONDS each); the time left is kept in
  // system.stateTimers, so a save keeps it too
  // a state my own skill / item gave me in a fight that the original takes away as a battle ends and that has no turns
  // to run out (거룩한 총검's bullet loaded, the cut 삼단 베기 is at): it goes when the fighting is over (onBattleEnd) -
  // the next fight starts again from the first bullet, the first cut
  fightState(id) {
    const st = $data.states[id];
    if (this.inCombat && st?.remove_at_battle_end && !st.auto_removal_timing) (this.fightStates ||= new Set()).add(id);
  }
  timeActorState(id) {
    const st = $data.states[id];
    if (!st?.auto_removal_timing) return;
    const turns = st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1));
    if (turns > 0) (G.state.system.stateTimers ||= {})[id] = turns * TURN_SECONDS;
  }
  updateActorStates(dt, paused) {
    const timers = G.state?.system?.stateTimers, actor = G.state?.party?.leader();
    if (!actor || paused) return;
    this.regenerate(actor, dt);
    actor.tickBuffs(dt);
    this.restrainCheck(actor);
    if (!timers) return;
    for (const k of Object.keys(timers)) {
      if (!actor.isState(+k)) { delete timers[k]; continue; }
      timers[k] -= dt;
      if (timers[k] <= 0) {
        delete timers[k]; actor.removeState(+k);
        for (const s of this.stateExpired(actor, +k)) { actor.addState(s); this.timeActorState(s); }
        // (an angel's sentence run out; 진혼가 over at 0 HP)
        if (actor.hp <= 0 && !this.playerDead) this.playerFalls(null);
      }
    }
  }
  // 행동 불가 (setting, off by default): asleep, stunned, broken (a state that cannot act, restriction 4) the player
  // cannot walk, swing, guard or use anything; the states a restriction takes away go (a guard, a charge)
  playerRestrained() {
    if (G.settings.restrainStates !== true || this.playerDead) return false;
    const a = G.state?.party?.leader();
    return !!a && a.states.some(id => id !== 1 && ($data.states[id]?.restriction || 0) >= 4);
  }
  // (held by a state: what the player tries does not happen - a dull buzz in both hands, the original's buzzer)
  restrainedBuzz() {
    G.audio?.playSystemSe(3);
    G.input.haptic('left', 0.5, 120); G.input.haptic('right', 0.5, 120);
  }
  restrainCheck(actor) {
    const on = this.playerRestrained();
    const mv = on ? G.input.moveVector() : null;
    if (on && Math.hypot(mv.x, mv.y) > 0.5 && G.time > (this.restrainBuzzAt || 0)) {
      this.restrainBuzzAt = G.time + 0.8;
      G.input.haptic('left', 0.35, 60); G.input.haptic('right', 0.35, 60);
    }
    if (on && !this.restrained) {
      for (const id of [...actor.states]) if ($data.states[id]?.remove_by_restriction) { actor.removeState(id); if (G.state.system.stateTimers) delete G.state.system.stateTimers[id]; }
      this.guardUp = false; this.charge = null; this.deskCharge = null;
    }
    this.restrained = on;
  }
  // (a blow taken: the states it shakes off - sleep - go, VX Ace's remove_states_by_damage)
  damageRemovesActorStates(actor) {
    for (const id of [...actor.states]) {
      const st = $data.states[id];
      if (st?.remove_by_damage && id !== 1 && Math.random() * 100 < st.chance_by_damage) {
        actor.removeState(id);
        if (G.state.system.stateTimers) delete G.state.system.stateTimers[id];
      }
    }
  }
  // the states a state brings as it runs out (its turns over), by its note - the original's script ステート解除時:
  // <自然解除時ステート:n> / <強制自然解除時ステート:n> (and <解除時ステート:n> / <強制解除時ステート:n>, as on any
  // removal); "forced" ones whatever the rate. The meat shield's 20 turns end in its death, the angel's sentence in
  // the player's, a boss's stances go round
  stateExpired(b, id) {
    const note = $data.states[id]?.note || '';
    const out = [];
    for (const [word, forced] of [['解除時ステート', false], ['強制解除時ステート', true], ['自然解除時ステート', false], ['強制自然解除時ステート', true]]) {
      const m = new RegExp(`<${word}[：:]([^>]+)>`).exec(note);
      if (!m) continue;
      for (const s of m[1].split(/\s*,\s*/).map(Number)) {
        if (!$data.states[s] || b.stateResist?.(s)) continue;
        if (!forced && (b.stateRate?.(s) ?? 1) <= 0) continue;
        out.push(s);
      }
    }
    return out;
  }
  // HP / MP regeneration (rings, oaths) and slip damage (poison, bleeding, burning, 발광) - VX Ace's regenerate_all: in a
  // fight a turn's worth every TURN_SECONDS, on the map every 20 steps (onPlayerStep). Slip damage leaves at least 1
  // HP (the game does not let it kill) and is felt as a blow is: the edges of the view flush red (no shake)
  regenerate(actor, dt) {
    if (this.playerDead || actor.hp <= 0 || !this.inCombat) { this.regenT = 0; return; }
    this.regenT = (this.regenT || 0) + dt;
    if (this.regenT < TURN_SECONDS) return;
    this.regenT -= TURN_SECONDS;
    this.regenerateNow(actor);
  }
  regenerateNow(actor) {
    if (this.playerDead || actor.hp <= 0) return;
    const hp = Math.trunc(actor.mhp * actor.hrg), mp = Math.trunc(actor.mmp * actor.mrg);
    if (hp > 0) actor.hp = Math.min(actor.mhp, actor.hp + hp);
    else if (hp < 0) {
      const v = Math.min(-hp, Math.max(0, actor.hp - 1));
      if (v > 0) { actor.hp -= v; this.slipHurt(v); }
    }
    if (mp > 0) actor.mp = Math.min(actor.mmp, actor.mp + mp);
    else if (mp < 0) actor.mp = Math.max(0, actor.mp + mp);
  }
  // HP lost to poison, a damage floor...: the red edges of a blow taken, a little buzz, the number - no shake
  slipHurt(v) {
    G.screen.hurtFlash(0.7);
    G.input.haptic('left', 0.3, 50); G.input.haptic('right', 0.3, 50);
    this.popupAtPlayer(`-${v}`, '#c070ff');
  }
  // light on the weapon: a weapon art waiting (red), the elements its attack has from states (resins)
  updateWeaponFx(dt) {
    const kinds = new Set();
    if (this.skillArm) kinds.add('armed');
    for (const id of G.state?.party?.leader()?.states || []) {
      for (const f of $data.states[id]?.features || []) if (f.code === 31 && ELEMENT_FX[f.data_id]) kinds.add(ELEMENT_FX[f.data_id]);
    }
    this.weaponFx.update(dt, this.weaponSeg(), kinds);
  }
}
