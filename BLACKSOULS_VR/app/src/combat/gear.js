// What the player holds, as it looks: the equipped weapon and shield (or gun) in the hands, and the VR hold-pose adjustment
// (a grip pressed and let go leaves the item floating where it is; gripped again, that pose is kept for the item).
import * as THREE from 'three';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { weaponSway } from '../weaponlag.js';
import { buildIconModel, getAdjust, setAdjust } from '../weapons.js';
import { DESK_SHIELD_DOWN, DESK_SHIELD_UP, DODGE_STAMINA, EMPTY_STAMINA, EMPTY_WAIT, PITCH_AXIS, WTYPE, _shP, _shQ,
  makeShieldMesh, makeWeaponMesh, shieldSpan, shotStyle, weaponPace } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class GearPart {
  // ---- player equipment visuals ------------------------------------------------------
  // what each hand holds: the weapon, and the shield-slot item (a shield, or one of the guns that sit in that slot)
  heldSpecs() {
    const leader = G.state.party.leader();
    const w = leader?.weapons()[0] || null;
    const off = leader?.armors().find(a => a && a.etype_id === 1) || null;
    const offGun = !!off && (off.features || []).some(f => f.code === 43);   // guns add their shot skill
    // (a bow filed with the swords is made and held as a bow)
    const wtype = w ? (shotStyle(w) === 'bow' ? WTYPE.BOW : w.wtype_id || WTYPE.SWORD) : 0;
    return {
      weapon: w ? { item: w, key: `w${w.id}`, kind: 'weapon', wtype, hand: 'right' } : null,
      offhand: off ? { item: off, key: `a${off.id}`, kind: offGun ? 'weapon' : 'shield', wtype: offGun ? WTYPE.GUN : 0, hand: 'left', gun: offGun, large: off.atype_id === 6,
        span: offGun ? 0 : shieldSpan(off) } : null,
    };
  }
  refreshEquipment() {
    if (this.gripAdjust) return;                     // the items are being moved by hand
    const { weapon: ws, offhand: os } = this.heldSpecs();
    const wtype = ws?.wtype || WTYPE.SWORD;
    const key = `${ws?.key || '-'}|${os?.key || '-'}|${G.vr}`;
    if (key === this.equipKey) return;
    this.equipKey = key;
    this.wtype = wtype;
    if (this.weapon) this.weapon.parent?.remove(this.weapon);
    if (this.shield) this.shield.parent?.remove(this.shield);
    const ctrl = G.input.controllers;
    const vr = G.vr && ctrl.right;
    // the held models are built from the equipped items' own icons (fallback: simple shapes)
    const adjOf = spec => spec && getAdjust(spec.key, spec.kind, spec.wtype, spec.hand, spec.item.icon_index);
    const model = spec => spec && buildIconModel(spec.item.icon_index, {
      kind: spec.kind, wtype: spec.wtype, hand: spec.hand, large: spec.large, span: spec.span, adjust: adjOf(spec) });
    // (what the weapon shoots on the trigger / a click, if anything: a gun's bullet, a bow's arrow - shotStyle)
    this.shotKind = shotStyle(ws?.item);
    this.weaponPace = weaponPace(ws?.item); this.poiseWear = 0;          // (super armor: whole again for the new one)
    // a hold pose set by hand (grip adjust mode) replaces the default placement in VR
    const handPose = (obj, spec) => {
      const g = adjOf(spec)?.grip;
      if (!g) return false;
      obj.position.fromArray(g.p); obj.quaternion.fromArray(g.q);
      return true;
    };
    const wrapDesktop = (m, roll) => {
      // on the flat screen the camera looks down at the hands: turn the flat side up so it is visible
      if (vr || !m) return m;
      const g = new THREE.Group(); g.add(m); g.rotation.z = roll; g.scale.setScalar(0.6); return g;
    };
    const wModel = model(ws);
    this.weapon = new THREE.Group();
    if (ws) {
      const wInner = wrapDesktop(wModel, -Math.PI / 2) || makeWeaponMesh(wtype);
      this.weapon.add(wInner);
      this.weapon.userData.length = (wModel || wInner).userData.length;
      this.weapon.userData.ranged = !!this.shotKind;
    } else {
      // bare hands: nothing to draw (VR shows the hand), the fist is what hits
      this.weapon.userData.unarmed = true;
      this.weapon.userData.length = 0.11;
    }
    this.weapon.userData.fist = !ws || !!wModel?.userData.fist;      // (claws, knuckles, bare hands)
    if (vr) {
      // WebXR grip space: -Z runs out of the top of the fist -> blade along -Z
      ctrl.right.grip.add(this.weapon);
      this.weapon.rotation.set(0, 0, 0);
      this.weapon.position.set(0, 0, 0.03);
      if (!handPose(this.weapon, ws) && this.weapon.userData.ranged) this.weapon.userData.alignRay = 'right';
      if (this.shotKind === 'gun') this.addLaser(this.weapon);
      // (a blade swung after the hand as its weight has it; a gun or bow, aimed, and a fist held fast)
      this.weaponLag.reset(this.weapon, this.weaponSway());
    } else {
      this.weaponLag.reset(null, null);
      G.three.camera.add(this.weapon);
      // (a blade is held and swung as deskswing.js has it - at rest at the hip, the point down, its blows cuts and a
      // thrust; a fist keeps its own swing, a gun or bow its place low right)
      this.deskSwing.reset(this.weapon, !this.weapon.userData.fist && !this.weapon.userData.ranged);
    }
    this.shield = null;
    this.offGun = null;
    if (os) {
      const sModel = model(os);
      this.shield = new THREE.Group();
      if (os.gun) {
        // pistol in the left hand: held like a weapon (cannot guard with it)
        const gunModel = sModel || makeWeaponMesh(WTYPE.GUN);
        this.shield.add(wrapDesktop(sModel, Math.PI / 2) || gunModel);
        this.shield.userData.length = gunModel.userData.length || 0.3;
        this.offGun = this.shield;
        if (G.vr && ctrl.left) {
          ctrl.left.grip.add(this.shield); this.shield.position.set(0, 0, 0.03);
          if (!handPose(this.shield, os)) this.shield.userData.alignRay = 'left';
          this.addLaser(this.shield);
        }
        else { G.three.camera.add(this.shield); this.shield.position.set(-0.28, -0.3, -0.45); this.shield.rotation.set(0.35, -0.15, 0); }
      } else {
        this.shield.add(sModel || makeShieldMesh(os.large));
        if (G.vr && ctrl.left) {
          // the holder's +Z (shield front) turns to -X = the back of the left hand
          ctrl.left.grip.add(this.shield);
          this.shield.position.set(-0.07, 0.0, 0.02);
          this.shield.rotation.set(0, -Math.PI / 2, 0);
          handPose(this.shield, os);
        } else {
          G.three.camera.add(this.shield);
          this.shield.position.copy(DESK_SHIELD_DOWN.p); this.shield.quaternion.copy(DESK_SHIELD_DOWN.q);    // (updateDeskShield)
        }
      }
    }
    this.hasShield = !!os && !os.gun;
    this.hasPrev = false;
    this.showArms();
  }
  // the weapon / shield in the hands - unless they are put away (무장해제), or the hand holds something else.
  // (PC: a shield comes into view only while the guard is up - updateDeskShield; held before the eyes all the time it
  // hid the status window and part of the view - and is down at the left side otherwise, out of view but still held)
  showArms() {
    if (this.weapon) this.weapon.visible = !this.disarmed && !this.ready && !(this.held && this.held.how !== 'rub');
    this.shieldOut = !!this.shield && !this.disarmed && !(this.held && this.held.how === 'rub');
    if (this.shield) this.shield.visible = this.shieldOut;
  }
  // PC: the shield comes up from the left side into its place before the eyes while the guard is up, and goes down to
  // the side again - out of view there, still held (others see it so; it stops nothing there: deskShieldUp)
  updateDeskShield(dt) {
    if (G.vr || !this.shield || !this.hasShield) return;
    const t = this.deskShieldT = THREE.MathUtils.clamp((this.deskShieldT || 0) + (this.guardUp && this.shieldOut ? dt : -dt) / 0.12, 0, 1);
    const k = t * t * (3 - 2 * t), body = this.deskBody();
    _shP.copy(DESK_SHIELD_DOWN.p).applyQuaternion(body); _shQ.copy(body).multiply(DESK_SHIELD_DOWN.q);
    this.shield.position.lerpVectors(_shP, DESK_SHIELD_UP.p, k);
    this.shield.quaternion.slerpQuaternions(_shQ, DESK_SHIELD_UP.q, k);
    this.shield.visible = this.shieldOut;
  }
  // (PC) the shield up, or on its way up: what stops a shot (VR: the shield wherever the hand holds it)
  deskShieldUp() { return this.shieldOut && (this.deskShieldT || 0) > 0.01; }
  // in a fight: with the enemies (inCombat), or struck at by another player not long ago (PvP - PVP_FIGHT s)
  fighting() { return this.inCombat || G.time < (this.pvpFightUntil ?? -99); }
  // (player.js) the speed the player walks at in an event's fight - the one it had as that event began (interpreter.js
  // c301); null: its own
  battleWalkSpeed() { return this.battles.find(b => !b.done && b.walkSpeed > 0)?.walkSpeed ?? null; }
  // (player.js) running: always, but in a fight not while winded - stamina run out, until RUN_AGAIN has come back
  canRun() { return !this.winded; }
  // (player.js) a dodge takes DODGE_STAMINA; none when there is not enough left for one (as a swing)
  takeDodge() {
    if (this.stamina <= 0.05) return false;
    this.useStamina(DODGE_STAMINA, 0.6);
    return true;
  }
  // stamina spent - a blow, a guard, a dodge, running, a Break -, coming back again after wait s; a spend that runs it
  // out (more than EMPTY_STAMINA left before it, no more after) after EMPTY_WAIT s - once, as it runs out: one while it
  // is out (a VR swing lands at any stamina, running goes on to nothing) waits only its own. None spent in 흑기사
  // 린다메아's duel, where it is unlimited (duelStamina)
  useStamina(n, wait) {
    if (this.duelStamina()) return;
    const had = this.stamina;
    this.stamina = Math.max(0, had - n);
    if (had > EMPTY_STAMINA && this.stamina <= EMPTY_STAMINA) wait = Math.max(wait, EMPTY_WAIT);
    this.staminaDelay = Math.max(this.staminaDelay, wait);
  }
  // 흑기사 린다메아's duel on (inDuel - neither she nor the player can die while it lasts): the player's stamina unlimited
  duelStamina() { return this.enemies.some(e => e.alive && this.inDuel(e)); }
  // (PC) the turn from the body's own space - where the eyes are, turned as the body is but not tipped as they look up
  // or down - to the camera's: what is held still at the side (deskswing.js DESK_REST, DESK_SHIELD_DOWN) stays there as
  // one looks about
  deskBody() { return (this._deskBody ||= new THREE.Quaternion()).setFromAxisAngle(PITCH_AXIS, -(G.player?.pitch || 0)); }
  // (VR) how the blade in hand is swung after the hand (weaponlag.js weaponSway - by its weight, length and the setting
  // 무기 무게감); a gun, bow or fist held fast (null)
  weaponSway() {
    const w = this.weapon;
    if (!G.vr || !w || w.userData.ranged || w.userData.fist) return null;
    return weaponSway(this.weaponPace, w.userData.length, G.settings.weaponWeight ?? 2);
  }
  // 무장해제 (VR: right stick click, PC: H): the weapon and shield go away with the sound of gear coming off,
  // the bare hands show, and nothing the hands do hits - no swing, Break, shot or weapon art, so no one is cut
  // down by accident; the guard is down too. Again: they are taken up. The equipment itself stays on
  toggleDisarm(on = !this.disarmed) {
    if (on === this.disarmed) return;
    this.disarmed = on;
    // what the hands were doing with them ends (a weapon art is paid only when it lands: nothing is lost)
    this.hasPrev = false; this.charge = null; this.deskCharge = null; this.breakArm = null;
    if (this.swing) { this.swing = null; if (this.weapon && !G.vr) this.deskSwing.reset(this.weapon, this.deskSwing.blade); }
    if (on) this.skillArm = null;
    if (this.breakGlow) this.breakGlow.visible = false;
    this.showArms();
    if (on) {
      G.audio?.playSe(G.seAt('布擦れ', 90, 100));
      G.audio?.playSe(G.seAt('soubi-01', 60, 70));
    } else G.audio?.playSystemSe(4);
    G.input.haptic('left', 0.35, 50); G.input.haptic('right', 0.35, 50);
  }
  // ---- hold-pose adjustment (VR): press+release a grip and that hand's item stays floating where it
  //      is; grip it again and it is held at the new pose (saved per item); gripping away from it
  //      brings it back as before. B / Y ends the mode.
  startGripAdjust() {
    if (!G.vr || !G.input.controllers.right) { G.ui.toast(tr('VR에서만 쓸 수 있어요')); return false; }
    if (this.battles.some(b => !b.done)) { G.ui.toast(tr('전투 중에는 할 수 없어요')); return false; }
    this.toggleDisarm(false);
    this.equipKey = null;
    this.refreshEquipment();
    const specs = this.heldSpecs();
    const ga = {};
    const add = (hand, obj, spec) => {
      if (!obj || !spec || !G.input.controllers[hand]) return;
      ga[hand] = { obj, spec, state: 'held', ignoreRelease: false, pos: obj.position.clone(), quat: obj.quaternion.clone(), box: this.localBox(obj) };
    };
    add('right', this.weapon, specs.weapon);
    add('left', this.shield, specs.offhand);
    if (!ga.right && !ga.left) { G.ui.toast(tr('장비한 무기·방패가 없어요')); return false; }
    this.gripAdjust = ga;
    G.ui.setHint(tr('그립 눌렀다 떼기: 놓기 · 다시 쥐기: 고정 · B: 끝'));
    return true;
  }
  endGripAdjust(save = true) {
    const ga = this.gripAdjust;
    if (!ga) return;
    for (const hand of ['right', 'left']) {
      const h = ga[hand];
      if (!h) continue;
      this.highlight(h.obj, 0);
      if (h.state === 'free') {
        // never picked up again: back to the hand as it was
        G.input.controllers[hand]?.grip.add(h.obj);
        h.obj.position.copy(h.pos); h.obj.quaternion.copy(h.quat);
      }
    }
    this.gripAdjust = null;
    this.hasPrev = false;
    G.ui.setHint(null);
    if (save) G.ui.toast(tr('손에 든 자세를 저장했어요'));
  }
  updateGripAdjust() {
    const ga = this.gripAdjust;
    const input = G.input;
    if (!G.vr || G.ui.menuOpen || G.map?.transferring || input.cancel()) { this.endGripAdjust(); return; }
    const handPos = new THREE.Vector3();
    for (const hand of ['right', 'left']) {
      const h = ga[hand];
      const grip = input.controllers[hand]?.grip;
      if (!h || !grip) continue;
      if (h.state === 'held') {
        if (input.xrReleased(hand, 1)) {
          if (h.ignoreRelease) { h.ignoreRelease = false; continue; }
          G.three.scene.attach(h.obj);                 // stays floating where it is
          h.state = 'free';
          input.haptic(hand, 0.3, 40);
          G.audio?.playSystemSe(0);
        }
        continue;
      }
      grip.getWorldPosition(handPos);
      const near = h.box.distanceToPoint(h.obj.worldToLocal(handPos.clone())) < 0.08;
      this.highlight(h.obj, near ? 0.45 : 0.12 + 0.08 * Math.sin(G.time * 5));
      if (input.xrPressed(hand, 1)) {
        if (near) {
          grip.attach(h.obj);                          // held exactly as it floats now
          delete h.obj.userData.alignRay;              // a hand-set pose wins over the pointing-ray default
          const adj = getAdjust(h.spec.key, h.spec.kind, h.spec.wtype, h.spec.hand, h.spec.item.icon_index);
          adj.grip = { p: h.obj.position.toArray().map(v => +v.toFixed(4)), q: h.obj.quaternion.toArray().map(v => +v.toFixed(5)) };
          setAdjust(h.spec.key, adj);
          h.pos.copy(h.obj.position); h.quat.copy(h.obj.quaternion);
          G.audio?.playSystemSe(1);
        } else {
          grip.add(h.obj);                             // called back unchanged
          h.obj.position.copy(h.pos); h.obj.quaternion.copy(h.quat);
          G.audio?.playSystemSe(2);
        }
        this.highlight(h.obj, 0);
        h.state = 'held'; h.ignoreRelease = true;
        input.haptic(hand, 0.6, 60);
      }
    }
  }
  // bounding box of an item in its own (holder) space, for the "is the hand on it" test
  localBox(obj) {
    obj.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const box = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    return box;
  }
  highlight(obj, k) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material?.emissive) return;
      const mat = o.material;
      if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.clone();
      if (k > 0) mat.emissive.setRGB(0.55 * k, 0.6 * k, 0.75 * k);
      else mat.emissive.copy(mat.userData.baseEmissive);
    });
  }
  // rotation from a controller's grip space to its pointing ray (constant per device; cached once tracked)
  rayOffset(hand) {
    if (this._rayOff?.[hand]) return this._rayOff[hand];
    const c = G.input.controllers[hand];
    if (!c || !c.grip.visible || !c.ray.visible) return null;
    c.grip.updateWorldMatrix(true, false); c.ray.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), sc = new THREE.Vector3();
    const qg = new THREE.Quaternion(), qr = new THREE.Quaternion();
    c.grip.matrixWorld.decompose(p, qg, sc);
    c.ray.matrixWorld.decompose(p, qr, sc);
    const off = qg.invert().multiply(qr);
    (this._rayOff ||= {})[hand] = off;
    return off;
  }
  alignHeldToRay() {
    if (!G.vr || this.gripAdjust) return;
    for (const holder of [this.weapon, this.shield]) {
      const hand = holder?.userData.alignRay;
      if (!hand) continue;
      const off = this.rayOffset(hand);
      if (off) holder.quaternion.copy(off);
    }
    // the aiming lasers show where shots go: out of the muzzle along the controller's pointing ray,
    // however the model has been turned in the hand
    for (const [holder, hand] of [[this.weapon, 'right'], [this.offGun, 'left']]) {
      const laser = holder?.userData.laser;
      const c = G.input.controllers[hand];
      if (!laser || !c) continue;
      holder.updateWorldMatrix(true, false); c.ray.updateWorldMatrix(true, false);
      const hq = new THREE.Quaternion(), rq = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      holder.matrixWorld.decompose(v, hq, sc);
      c.ray.matrixWorld.decompose(v, rq, sc);
      laser.quaternion.copy(hq.invert().multiply(rq));
    }
  }
  // where a hand's controller points (VR): shots follow this, not the held model
  aimRay(hand) {
    const c = G.vr ? G.input.controllers[hand] : null;
    if (!c) return null;
    c.ray.updateWorldMatrix(true, false);
    return { origin: new THREE.Vector3().setFromMatrixPosition(c.ray.matrixWorld), dir: new THREE.Vector3(0, 0, -1).transformDirection(c.ray.matrixWorld) };
  }
  // a faint aiming laser out of the muzzle
  addLaser(holder) {
    const len = holder.userData.length || 0.4;
    const geo = new THREE.CylinderGeometry(0.0025, 0.0025, 6, 4, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const laser = new THREE.Mesh(geo, mat);
    laser.position.set(0, 0, -len);
    holder.add(laser);
    holder.userData.laser = laser;
  }
  weaponSegment(base, tip) {
    if (!this.weapon) return false;
    this.weapon.updateWorldMatrix(true, false);
    base.set(0, 0, this.weapon.userData.unarmed ? -0.02 : -0.12).applyMatrix4(this.weapon.matrixWorld);
    tip.set(0, 0, -this.weapon.userData.length).applyMatrix4(this.weapon.matrixWorld);
    return true;
  }
}
