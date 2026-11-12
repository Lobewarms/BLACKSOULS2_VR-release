// A spell or a throwable in the right hand: readied, aimed (its landing marked), cast or thrown, what it does where it lands.
import * as THREE from 'three';
import { commonEventList } from '../character.js';
import { lineOfSight } from '../collision.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { Interpreter } from '../interpreter.js';
import { T } from '../mapmesh.js';
import { FloorMarker, MARK } from '../telegraph.js';
import { drawIcon, stripEscapes } from '../ui.js';
import { buildIconModel, defaultAdjust } from '../weapons.js';
import { DESK_ACT, ENEMY_TURN, FORWARD, KNIFE_SCALE, KNIFE_SPEED, STUN, THROWN_SCALE, THROWN_SPLASH, THROW_GRAVITY,
  TURN_SECONDS, fxk, tmpA, tmpB } from './common.js';
import { HELD_SCALE, heldPoint, makeShotLook, shotStyleOf } from './shotlooks.js';

// a spell turned back flies at least this fast (m/s; an enemy's own shot flies at 14), at most this far (m)
const MIRROR_SPEED = 16, MIRROR_RANGE = 40;

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class SpellPart {
  // ---- spell / throwable in the right hand ----------------------------------------------------
  // throwing knives (투척 나이프, 수술칼): the items thrown with the original's knife animation
  isKnife(obj) {
    const anim = $data.animations?.[obj?.animation_id]?.name || '';
    return /ナイフ|knife/i.test(anim) || /나이프|수술칼|ナイフ|メス|knife|scalpel|飞刀|手术刀/i.test(obj?.name || '');
  }
  // a thrown item made like the held weapons (every pixel of its icon a small block): a knife held like a dagger,
  // blade forward; anything else (a bottle, a pot, a dung ball) in the fist
  thrownModel(obj, knife) {
    const model = buildIconModel(obj.icon_index, knife
      ? { kind: 'weapon', wtype: 7, hand: 'right', adjust: { ...defaultAdjust('weapon', 7, 'right', obj.icon_index), scale: KNIFE_SCALE } }
      : { kind: 'weapon', wtype: 0, hand: 'right', adjust: { rot: 0, flip: false, offset: 4, scale: THROWN_SCALE } });
    if (!model) return null;
    // (in a holder of its own: a throw turns the holder, the model keeps its own turn - icon blade to -Z)
    const holder = new THREE.Group();
    holder.add(model);
    holder.userData.thrown = true;
    holder.userData.icon = obj.icon_index; holder.userData.knife = !!knife;
    return holder;
  }
  readyUsable(obj, kind) {
    this.cancelReady();
    const fx = new THREE.Group();
    if (kind === 'item') {
      // VR: the item itself in the hand; the flat screen keeps the icon (seen from behind a model is only an edge)
      const model = G.vr ? this.thrownModel(obj, this.isKnife(obj)) : null;
      fx.add(model || this.iconSprite(obj.icon_index));
      fx.userData.model = !!model;
    } else {
      // a spell: in the look it will fly in (shotlooks.js - a fireball, an ice shard, a rune circle...), its trail shed as the
      // hand moves (updateReady)
      const look = makeShotLook(shotStyleOf(obj), { scale: HELD_SCALE, held: true, bright: 0.45 + 0.55 * fxk(), emit: (at, o) => this.spawnGlow(at, o),
        busy: () => this.projectiles.length > 12 });
      fx.add(look);
      fx.userData.look = look;
    }
    const right = G.vr ? G.input.controllers.right : null;
    if (right) { right.grip.add(fx); if (fx.userData.model) fx.position.set(0, 0, 0.03); else fx.position.set(0, 0.02, -0.08); }
    else { G.three.camera.add(fx); fx.position.set(0.22, -0.22, -0.5); }
    const physicalArea = obj.scope === 2 && obj.hit_type === 1 && kind === 'skill';
    const area = obj.scope === 2;
    const marker = new FloorMarker(this.root, area
      ? { shape: 'circle', r: physicalArea ? 3.5 : 2.5, color: MARK.player }
      : { shape: 'circle', r: 0.45, color: MARK.player, label: '' });
    this.ready = { obj, kind, fx, marker, physicalArea, area, t: 0 };
    G.audio?.playSe(G.seAt(kind === 'item' ? 'Equip1' : 'Magic1', 60, 120));
    G.input.haptic('right', 0.4, 50);
    if (!this.readyHintShown) { this.readyHintShown = true; G.ui.toast(G.vr ? tr('오른손으로 겨누고 트리거로 발사 · X로 취소') : tr('겨누고 좌클릭으로 발사 · Q로 취소')); }
    return true;
  }
  // (co-op) what this player has ready, as it aims it - an area spell, a throwable: where it would land and how wide
  // ([x, floor y, z, r]); the others see it all the while (coop.js poseMsg rk), to step out of it before it comes
  readyMark() {
    const r = this.ready;
    if (!r?.marker?.outer?.visible) return null;
    const p = r.marker.outer.position;
    return [p.x, p.y - 0.045, p.z, r.marker.spec.r];
  }
  cancelReady(sound = false) {
    const r = this.ready;
    if (!r) return;
    r.fx.parent?.remove(r.fx);
    if (r.fx.userData.look) r.fx.userData.look.userData.dispose();      // (a spell's look: its own pieces - the shared ones kept)
    else r.fx.traverse(o => {
      if (!o.isSprite) o.geometry?.dispose();          // sprites share one geometry
      if (o.material) { if (o.material.map && o.material.map !== this._glowTex) o.material.map.dispose(); o.material.dispose(); }
    });
    r.marker.dispose();
    this.ready = null;
    this.showArms();
    if (sound) G.audio?.playSystemSe(2);
  }
  // where the right hand (PC: the view) points: first enemy on the line, and where it meets floor / wall
  readyAim() {
    const right = G.vr ? G.input.controllers.right : null;
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    if (right) {
      right.ray.updateWorldMatrix(true, false);
      origin.setFromMatrixPosition(right.ray.matrixWorld);
      dir.set(0, 0, -1).transformDirection(right.ray.matrixWorld);
    } else {
      G.three.camera.getWorldPosition(origin);
      dir.set(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    }
    const range = 15, step = 0.2;
    const p = new THREE.Vector3();
    const sx = origin.x / T - 0.5, sy = origin.z / T - 0.5;
    let enemy = null, point = origin.clone().addScaledVector(dir, range);
    march: for (let t = 0.3; t <= range; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      const tx = p.x / T - 0.5, ty = p.z / T - 0.5;
      if (!G.map.validW(Math.round(tx), Math.round(ty)) || (t > 0.6 && !lineOfSight(sx, sy, tx, ty))) { point = p.clone().addScaledVector(dir, -step); break; }
      const fl = G.floorAt(tx, ty);
      if (p.y <= fl) { point = p.clone(); point.y = fl; break; }
      for (const e of this.allTargets()) {
        const wp = e.worldPos(tmpA);
        if (Math.hypot(p.x - wp.x, p.z - wp.z) < e.hr * T + 0.3 && p.y > wp.y - 0.2 && p.y < wp.y + e.h + 0.3) { enemy = this.partAt(e, p); point = new THREE.Vector3(wp.x, wp.y, wp.z); break march; }
      }
    }
    // a spot in the air drops to the floor below it
    point.y = G.floorAt(point.x / T - 0.5, point.z / T - 0.5);
    return { origin, dir, enemy, point };
  }
  updateReady(dt, paused) {
    const r = this.ready;
    if (!r) return;
    if (this.playerDead || this.spectating || G.ui.menuOpen || G.map?.transferring) { this.cancelReady(); return; }
    if (this.weapon) this.weapon.visible = false;
    r.t += dt;
    const look = r.fx.userData.look;
    if (look) { if (!paused) look.userData.animate(dt, (this._heldPt = heldPoint(r.fx, this._heldPt))); }
    else {
      const pulse = 1 + Math.sin(r.t * 8) * 0.12;
      if (!r.fx.userData.model) r.fx.scale.setScalar(pulse);
      r.fx.children.forEach(c => { if (c.userData.spin || c.isSprite) c.material.rotation += dt * 3; });
    }
    if (paused) { r.marker.setVisible(false); return; }
    const aim = this.readyAim();
    r.aim = aim;
    r.marker.setVisible(true);
    if (r.physicalArea) {
      const head = G.player.headWorld(new THREE.Vector3());
      r.marker.setPose(head.x, G.floorAt(head.x / T - 0.5, head.z / T - 0.5), head.z, 0);
    } else {
      r.marker.setPose(aim.point.x, aim.point.y, aim.point.z, 0);
      if (!r.area) r.marker.setColor(aim.enemy ? 0xffd060 : MARK.player);
    }
    r.marker.setProgress(1);
    const fire = G.vr ? G.input.xrPressed('right', 0) : G.input.attackPressed();
    if (fire && !this.staggered()) this.fireReady();
  }
  fireReady() {
    const r = this.ready;
    if (!r) return;
    const { obj, kind } = r;
    const actor = G.state.party.leader();
    const name = stripEscapes(obj.name);
    // costs are paid when it actually goes
    if (kind === 'item' && G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name }), obj.icon_index); this.cancelReady(); return; }
    if (kind === 'skill' && !actor.skillCostPayable(obj)) {
      const hpShort = actor.mp >= actor.skillMpCost(obj) && actor.tp >= (obj.tp_cost || 0);
      G.ui.toast(hpShort ? tr('{name}: HP가 부족합니다', { name }) : tr('{name}: MP가 부족합니다', { name }), obj.icon_index); this.cancelReady(); return;
    }
    if (!G.vr) this.deskActUntil = G.time + DESK_ACT;          // (PC: the cast / throw keeps the hands a moment - handsBusy)
    const aim = r.aim || this.readyAim();
    const from = new THREE.Vector3(); r.fx.getWorldPosition(from);
    // throwing knives stay in the hand - one throw per pull, no waiting - until they run out or X puts them away
    const knife = kind === 'item' && this.isKnife(obj);
    if (!knife) this.cancelReady();
    this.payUsable(obj, kind);
    this.readyFired = (this.readyFired || 0) + 1;      // (let go: a macro's step done - combat/macros.js)
    if (kind === 'skill') this.playerFollowUp(obj, aim.enemy || null, from);
    if (knife && G.state.party.itemCount('item', obj.id) <= 0) this.cancelReady();
    G.input.haptic('right', 0.8, 70);
    if (kind === 'item') G.audio?.playSe(G.seAt('Wind7', 70, knife ? 165 : 120));
    else G.audio?.playSe(G.seAt('Magic1', 70, 100));
    if (kind === 'item') { this.throwItem(obj, from, aim, knife); return; }
    if (r.physicalArea) {
      const head = G.player.headWorld(new THREE.Vector3());
      head.y = G.floorAt(head.x / T - 0.5, head.z / T - 0.5);
      this.burstUsable(obj, head, 3.5);
      this.areaMark(head, 3.5, G.time + 0.6);
      G.coop?.shareBurst?.(head, 3.5, this.skillColor(obj), obj.animation_id);
      return;
    }
    const opts = { speed: kind === 'item' ? 12 : 20, owner: 'player', usable: obj, homing: 0, life: 2.5 };
    if (r.area) {
      const to = aim.point.clone(); to.y += 0.2;
      this.spawnProjectile(from, to.clone().sub(from), { ...opts, aoe: 2.5, dest: to, mesh: kind === 'item' ? this.iconSprite(obj.icon_index) : null, color: this.skillColor(obj),
        style: kind === 'item' ? null : shotStyleOf(obj) });
      return;
    }
    const n = { 3: 1, 4: 2, 5: 3, 6: 4 }[obj.scope] || 1;
    for (let k = 0; k < n; k++) {
      this.later(k * 130, () => {
        const dir = aim.dir.clone();
        if (n > 1) dir.add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12)).normalize();
        this.spawnProjectile(from, dir, { ...opts, target: aim.enemy, mesh: kind === 'item' ? this.iconSprite(obj.icon_index) : null, color: this.skillColor(obj),
          style: kind === 'item' ? null : shotStyleOf(obj) });
      });
    }
  }
  // a knife flies straight and fast where the hand points; anything else goes in an arc onto the spot aimed at - onto
  // the enemy aimed at, keeping on it as it moves (its course across the floor bends, its height is the throw's)
  throwItem(obj, from, aim, knife) {
    const model = this.thrownModel(obj, knife);
    const mesh = model || this.iconSprite(obj.icon_index);
    const base = { owner: 'player', usable: obj, homing: 0, mesh, color: this.skillColor(obj) };
    if (knife) {
      if (model) model.quaternion.setFromUnitVectors(FORWARD, aim.dir.clone().normalize());
      this.spawnProjectile(from, aim.dir, { ...base, speed: KNIFE_SPEED, life: 1.2, align: true, fine: true });
      return;
    }
    const area = obj.scope === 2;
    const dest = aim.enemy ? aim.enemy.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, aim.enemy.h * 0.5, 0))
      : aim.point.clone().add(new THREE.Vector3(0, area ? 0.2 : 0.05, 0));
    const flight = THREE.MathUtils.clamp(0.25 + Math.hypot(dest.x - from.x, dest.z - from.z) / 12, 0.3, 1.4);
    const v0 = dest.clone().sub(from).divideScalar(flight);
    v0.y += 0.5 * THROW_GRAVITY * flight;
    if (model) {
      // its picture faces back at the thrower, upright, and spins in that face as it flies (the model's front is its
      // holder's -X, the icon's top its -Z)
      const f = new THREE.Vector3(v0.x, 0, v0.z);
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      const z = new THREE.Vector3(0, -1, 0), y = new THREE.Vector3().crossVectors(z, f);
      model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, y, z));
    }
    this.spawnProjectile(from, v0, { ...base, speed: v0.length(), life: flight + 1.5, gravity: THROW_GRAVITY, track: aim.enemy || null,
      landAt: G.time + flight, tumble: !!model, aoe: area ? 2.5 : 0, dest: area ? dest : null });
  }
  // a thrown pot that met no enemy: it breaks where it fell (its own animation there), and an enemy right beside
  // that spot still takes it
  landThrown(p) {
    const at = p.mesh.position.clone();
    at.y = Math.max(at.y, G.floorAt(at.x / T - 0.5, at.z / T - 0.5));
    let best = null, bd = THROWN_SPLASH;
    for (const e of this.allTargets()) {
      const wp = e.worldPos(tmpB);
      const d = Math.hypot(wp.x - at.x, wp.z - at.z) - e.hr * T;
      if (d < bd) { bd = d; best = e; }
    }
    if (p.usable.animation_id > 0) G.screen.playAnimationOn(at.clone().add(new THREE.Vector3(0, 0.3, 0)), p.usable.animation_id, { rate: 3 });
    // (PvP: another player right beside where it broke takes it too)
    const pt = (G.coop?.pvpTargets?.() || []).find(c => Math.hypot(c.x - at.x, c.z - at.z) - c.r < THROWN_SPLASH);
    if (pt) this.strikePlayerWith(pt, p.usable);
    if (!best) return;
    const n = Math.max(1, Math.min(5, p.usable.repeats || 1));
    for (let r = 0; r < n; r++) this.later(r * 120, () => { if (best.alive) this.applyUsableToEnemy(best, p.usable, at); });
  }
  // an area spell / thrown item bursting at a spot: everything within the radius takes it
  burstUsable(obj, at, radius) {
    this.burstFx(this.skillColor(obj), obj.animation_id, at, radius);
    const n = Math.max(1, Math.min(5, obj.repeats || 1));
    for (const e of this.allTargets()) {
      const wp = e.worldPos(tmpB);
      if (Math.hypot(wp.x - at.x, wp.z - at.z) > radius + e.hr * T) continue;
      for (let k = 0; k < n; k++) this.later(k * 120, () => this.applyUsableToEnemy(e, obj, at));
    }
    // (PvP: the other players in it take it too)
    for (const t of G.coop?.pvpTargets?.() || []) if (Math.hypot(t.x - at.x, t.z - at.z) <= radius + t.r) this.strikePlayerWith(t, obj);
  }
  // 메리의 지팡이's orb over (STAFF_BURST): it bursts where it met an enemy (its blow and the reach of it around landed
  // with the hit - playerHitEnemy) or struck the floor or a wall (its blow then on all within the reach, PvP players as
  // well); a blue glow, the reach marked on the floor a moment, the others in co-op shown the same. One that flew out of
  // its life in the air does nothing
  staffBurst(p) {
    const r = p.staff;
    let at = p.burstAt;
    if (!at) {
      if (!p.landed) return;
      at = p.mesh.position.clone();
      at.y = G.floorAt(at.x / T - 0.5, at.z / T - 0.5);
      const actor = G.state.party.leader(), skill = actor && this.skillByState(actor, this.playerAttackSkill(actor));
      if (skill) {
        const blow = {};                               // (one attack for the groggy gauge)
        for (const e of this.allTargets()) if (e.worldPos(tmpB).distanceTo(at) <= r + e.hr * T) this.applyUsableToEnemy(e, skill, at, { mult: p.power, knock: 0.1, blow });
        for (const t of G.coop?.pvpTargets?.() || []) if (Math.hypot(t.x - at.x, t.z - at.z) <= r + t.r) this.strikePlayer(t, { power: p.power });
      }
    }
    this.burstFx(p.color, 0, at, r);
    this.areaMark(at, r, G.time + 0.6, null, true);
    G.coop?.shareBurst?.(at, r, p.color, 0);
  }
  // what a burst looks like: its colour's glow over the spot and its animation over all of it (the others are shown it
  // too - peerShotEnds, coop.js shareBurst)
  // a spell of this player's that met no one (a wall, the floor, out of reach): its animation and sound where it ended, as
  // an enemy's that misses - not gone without a trace (a volley's once)
  spellMissed(p) {
    const s = p.usable;
    if (!s || s.__class === 'RPG::Item' || p.volley?.missShown) return;
    const id = s.animation_id < 0 ? G.state.party.leader()?.weapons()[0]?.animation_id | 0 : s.animation_id | 0;
    if (id <= 0) return;
    if (p.volley) p.volley.missShown = true;
    G.screen.playAnimationOn(p.mesh.position.clone(), id, { world: true, size: 1.4 });
  }
  burstFx(color, anim, at, radius) {
    this.spawnGlow(at.clone().add(new THREE.Vector3(0, 0.4, 0)), { color, size: radius * 1.6, life: 0.35, grow: 1.2 });
    this.playAreaAnim(anim, { x: at.x, z: at.z, w: 2 * radius }, { rate: 3 });
  }
  // (co-op) another player's shot over, as shown here: an area one bursts where it ended, a pot that met no one breaks
  // where it fell (its animation there)
  peerShotEnds(p) {
    const at = p.mesh.position.clone();
    if (p.aoe && !p.burst) { p.burst = true; this.burstFx(p.color, p.anim, at, p.aoe); return; }
    // (a spell of theirs that met no one: its animation where it ended - spellMissed)
    if (p.look === 'o' && !p.hit && !p.gravity && p.anim > 0) { G.screen.playAnimationOn(at, p.anim, { world: true, size: 1.4 }); return; }
    if (!p.gravity || p.hit || p.anim <= 0) return;
    at.y = Math.max(at.y, G.floorAt(at.x / T - 0.5, at.z / T - 0.5));
    G.screen.playAnimationOn(at.add(new THREE.Vector3(0, 0.3, 0)), p.anim, { rate: 3 });
  }

  // targets in front of the player's gaze: single / random scopes take the best aligned enemy
  pickTargets(obj, kind) {
    const head = G.player.headWorld(new THREE.Vector3());
    const look = G.player.forwardVec();
    const melee = kind === 'skill' && obj.hit_type === 1;
    const range = melee ? 4.5 : 15;
    const pc = G.map.playerChar;
    const cands = [];
    for (const e of this.allTargets()) {
      const wp = e.worldPos(new THREE.Vector3());
      const to = new THREE.Vector3(wp.x - head.x, 0, wp.z - head.z);
      const d = to.length();
      if (d - e.hr * T > range) continue;
      if (!lineOfSight(pc.fx, pc.fy, e.fx, e.fy)) continue;
      cands.push({ e, d, ang: d > 1e-3 ? to.normalize().angleTo(look) : 0 });
    }
    if (obj.scope === 2) return cands.filter(c => c.ang < 1.7 || c.d < 3).map(c => c.e);
    const front = cands.filter(c => c.ang < 0.6).sort((a, b) => (a.ang * 4 + a.d * 0.08) - (b.ang * 4 + b.d * 0.08));
    if (!front.length) return [];
    if (obj.scope === 1) return [front[0].e];
    const n = { 3: 1, 4: 2, 5: 3, 6: 4 }[obj.scope] || 1;
    const pool = front.slice(0, 4).map(c => c.e);
    return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
  }
  // where thrown items and spells leave from: the left hand (PC: low left of the view)
  castOrigin() {
    const left = G.vr ? G.input.controllers.left : null;
    if (left) return left.grip.getWorldPosition(new THREE.Vector3());
    const head = G.player.headWorld(new THREE.Vector3());
    const f = G.player.forwardVec();
    return head.addScaledVector(f, 0.45).add(new THREE.Vector3(f.z * 0.18, -0.25, -f.x * 0.18));
  }
  launchUsable(obj, kind, from, e) {
    const to = e.worldPos(new THREE.Vector3()); to.y += e.h * 0.6;
    const opts = { speed: kind === 'item' ? 11 : 19, owner: 'player', target: e, usable: obj, homing: 0 };
    if (kind === 'item') opts.mesh = this.iconSprite(obj.icon_index);
    else { opts.color = this.skillColor(obj); opts.style = shotStyleOf(obj); }
    this.spawnProjectile(from, to.sub(from), opts);
  }
  iconSprite(iconIndex) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    drawIcon(ctx, iconIndex, 4, 4, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false }));
    s.scale.setScalar(0.22);
    s.userData.spin = true;
    s.userData.icon = iconIndex;                     // (co-op: what the others are shown flying - shareShot)
    return s;
  }
  // an item / skill landing on an enemy: damage formula, drain, added / removed states.
  // mult scales the damage (swing power, back stab, critical); 0 damage stays 0 like the original
  applyUsableToEnemy(e, obj, sourcePos, { mult = 1, crit = false, knock = 0.1, color = null, by = null, blow = null } = {}) {
    if (!e.alive) return 0;
    if (this.heldBoss(e)) return -1;
    const actor = by || G.state.party.leader();          // (by: a companion using its skill)
    // what it always evades (script 220 - 흰 유니콘 유니스 and every sure hit): its evasion sound, nothing lands
    if (!this.certainHit(actor, obj) && e.b.certainty(1, obj.hit_type ?? 1)) { this.missOn(e, obj); return -1; }
    // a spell turned back (magic reflection - an enemy chanting, 영창): it lands on the one who cast it
    if (!by && obj.hit_type === 2 && e.b.mrf > Math.random()) { this.reflectOntoPlayer(e, obj); return -1; }
    // slipped in a stance that answers it (리포스트, script 191): nothing lands
    const slip = this.slipsWithAnswer(e.b, obj, actor);
    if (slip) { this.enemySlips(e, slip, obj, sourcePos, by); return -1; }
    const p = e.worldPos(new THREE.Vector3());
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const type = obj.damage?.type || 0;
    let dmg = 0;
    if (type === 1 || type === 5) {
      dmg = this.computeDamage(actor, e.b, obj, mult * (e.state === 'stagger' ? 1.5 : 1));
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), dmg <= 0 ? '#9a9a9a' : color || (crit ? '#ffd040' : '#ffffff'));
      const heal = (type === 5 ? dmg : 0) + this.convertDrain(actor, obj, dmg);
      if (heal > 0 && actor) {
        actor.hp = Math.min(actor.mhp, actor.hp + heal);
        if (by) this.allies.healActor(by, heal); else this.popupAtPlayer(`+${heal}`, '#60ff80');
      }
      if (sourcePos && knock) {
        const away = Math.atan2(p.z - sourcePos.z, p.x - sourcePos.x);
        e.knock.x += Math.cos(away) * knock; e.knock.y += Math.sin(away) * knock;
      }
      if (dmg > 0) this.damageRemovesStates(e);
    }
    for (const ef of obj.effects || []) {
      if (ef.code === 11) {                              // HP by a share of max HP (negative: a cut), by its recovery rate
        const v = Math.floor((e.b.mhp * ef.value1 + ef.value2) * e.b.rec);
        if (v < 0) {
          e.b.hp = Math.max(0, e.b.hp + v);
          e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
          this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), String(-v), '#ffb0b0');
        } else if (v > 0) { e.b.hp = Math.min(e.b.mhp, e.b.hp + v); e.drawBar(); }
      } else if (ef.code === 21 && ef.data_id === 0) {   // "normal attack" states: the attacker's own (poison blades...)
        for (const f of actor?.featuresWith(32) || []) {
          if (f.data_id <= 1 || f.data_id === STUN || e.b.stateResist(f.data_id)) continue;   // (stun: the groggy gauge instead)
          if (Math.random() < ef.value1 * f.value * e.b.stateRate(f.data_id)) this.addEnemyState(e, f.data_id);
        }
        this.groggyHit(e, actor, obj, mult, blow);
      } else if (ef.code === 21 && ef.data_id === 1) {   // instant death (ouija board etc.)
        if (!e.b.stateResist(1) && Math.random() < ef.value1 * e.b.stateRate(1)) e.b.hp = 0;
      } else if (ef.code === 21 && ef.data_id > 1) {
        const id = ef.data_id;
        if (id === 7 || id === 8) {
          if (Math.random() < this.breakRoll(e, id, ef.value1)) this.breakEnemy(e, id);
          continue;
        }
        if (e.b.stateResist(id)) continue;
        if (Math.random() < ef.value1 * e.b.stateRate(id)) this.addEnemyState(e, id);
      } else if (ef.code === 22) {
        e.b.removeState(ef.data_id);
        if (e.stateTimers) delete e.stateTimers[ef.data_id];
      } else if (ef.code === 12) {                       // MP by a share (a minus: taken away)
        const v = Math.floor((e.b.mmp * ef.value1 + ef.value2) * e.b.rec);
        e.b.mp = Math.max(0, Math.min(e.b.mmp, e.b.mp + v));
      } else if (ef.code === 44) this.fightCommonEvent(ef.data_id);
    }
    // buffs / debuffs (a curse on its weapon, its legs shot): a cold glow as it goes down, a warm one up
    const before = e.b.buffs.reduce((a, v) => a + v, 0);
    if (this.applyBuffEffects(e.b, obj, ENEMY_TURN)) {
      const after = e.b.buffs.reduce((a, v) => a + v, 0);
      if (after !== before) this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), { color: after < before ? 0x5878ff : 0xff7848, size: e.h * 0.9, life: 0.5, grow: 1.3 });
    }
    this.checkEnemyDeath(e);
    return dmg;
  }
  // script 220: an item / skill that lands whatever the target evades - <絶対命中> on it, or its user's features
  certainHit(user, obj) { return /<絶対命中>/.test(obj?.note || '') || !!user?.certainty?.(0, obj?.hit_type ?? 1); }
  missOn(e, obj) {
    const p = e.worldPos(new THREE.Vector3());
    G.audio?.playSystemSe(obj?.hit_type === 2 ? 19 : 18);
    this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), { color: 0xe8f0ff, size: e.h * 0.6, life: 0.25, grow: 1.6 });
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
  }
  // the player's spell turned back by an enemy: it lands on the player (its damage as from the player, its states
  // and buffs), with the original's reflection sound
  reflectOntoPlayer(e, obj) {
    const actor = G.state.party.leader();
    const p = e.worldPos(new THREE.Vector3());
    G.audio?.playSystemSe(20);
    this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), { color: 0xc8f0ff, size: e.h * 0.9, life: 0.35, grow: 1.5 });
    if (!actor || this.playerDead) return;
    const t = obj.damage?.type || 0;
    const dmg = t === 1 || t === 5 ? this.computeDamage(actor, actor, obj) : 0;
    if (dmg > 0) {
      actor.hp = Math.max(0, actor.hp - dmg);
      G.screen.hurtFlash(1);
      G.input.haptic('left', 0.8, 90); G.input.haptic('right', 0.8, 90);
      this.popupAtPlayer(`-${dmg}`, '#ffb0b0');
    }
    for (const ef of obj.effects || []) {
      if (ef.code === 21 && ef.data_id > 1 && !actor.stateResist(ef.data_id) && Math.random() < ef.value1 * actor.stateRate(ef.data_id)) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); }
    }
    this.applyBuffEffects(actor, obj, TURN_SECONDS);
    if (actor.hp <= 0) this.playerFalls(e.battle);
  }
  // an enemy's spell turned back by the player (magic reflection - damage.js enemyStrikePlayer): with the original's
  // reflection sound it flies back the way it came, straight on - not after its caster (the user's wish): the shot
  // itself, turned round where it met the shield (거울의 대방패) or the player, back along its own line; else the spell's
  // own look, from the shield or the player's chest toward where its caster stands. The first enemy it meets takes it as
  // its caster's spell (areas.js, reflectLands); a wall stops it, and one that stepped aside it passes by
  reflectOntoEnemy(e, skill, { shot = null, shield = false } = {}) {
    const from = shot ? shot.mesh.position.clone()
      : shield && this.shield ? this.shield.getWorldPosition(new THREE.Vector3())
        : G.player.headWorld(new THREE.Vector3()).add(new THREE.Vector3(0, -0.3, 0));
    G.audio?.playSystemSe(20);
    this.spawnGlow(from, { color: 0xc8f0ff, size: 0.8, life: 0.35, grow: 1.6 });
    const dir = shot ? shot.vel.clone().negate() : e ? this.reflectAim(e).sub(from) : null;
    if (!dir || dir.lengthSq() < 1e-8) { if (shot) shot.life = 0; return; }
    const speed = Math.max(MIRROR_SPEED, shot?.speed || 0), life = MIRROR_RANGE / speed;
    if (shot) {
      Object.assign(shot, { owner: 'mirror', enemy: e || shot.enemy, target: null, skill, reflected: true, struck: false, hit: false, life, speed,
        fine: true, homing: 0, steer: 0, accel: 0, committed: true, gravity: 0, track: null, dest: null, aoe: 0, cap: null, pierce: false, ghost: false, aimAt: null });
      shot.vel.copy(dir.normalize().multiplyScalar(speed));
    } else {
      this.spawnProjectile(from, dir, { speed, owner: 'mirror', enemy: e, skill, homing: 0, life, fine: true,
        color: this.skillColor(skill), style: shotStyleOf(skill, this.skillLook(skill)) });
    }
  }
  // where its caster stands (the middle of it): whence a spell that came with no shot came
  reflectAim(e) { const at = e.worldPos(new THREE.Vector3()); at.y += (e.hover || 0) + e.h * 0.55; return at; }
  // a turned-back spell striking an enemy - its caster, or another in its way: it lands there as its caster's spell (VX
  // Ace's reflection lands it on the caster by the caster's own stats; on another, the caster's power against that one's
  // defence) - its damage, states and buffs - and its animation plays there
  reflectLands(caster, e, skill) {
    if (!e?.alive || this.heldBoss(e)) return;
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const p = e.worldPos(new THREE.Vector3()); p.y += e.hover || 0;
    if (skill.animation_id > 0) G.screen.playAnimationOn(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), skill.animation_id, { rate: 3, height: e.h });
    const t = skill.damage?.type || 0;
    const dmg = t === 1 || t === 5 ? this.computeDamage(caster?.b || e.b, e.b, skill) : 0;
    if (dmg > 0) {
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), '#c8f0ff');
    }
    for (const ef of skill.effects || []) {
      if (ef.code === 21 && ef.data_id > 1 && !e.b.stateResist(ef.data_id) && Math.random() < ef.value1 * e.b.stateRate(ef.data_id)) this.addEnemyState(e, ef.data_id);
    }
    this.applyBuffEffects(e.b, skill, ENEMY_TURN);
    this.checkEnemyDeath(e);
  }
  // a common event a skill that strikes calls (effect 44) runs at once beside the fight, as VX Ace runs it in the
  // battle - 비전・귀섬 calls 最期の太刀, and 귀신 무사's last stand ends in 할복 (once a use, however many it hits)
  fightCommonEvent(id) {
    if (G.coop?.phantom) return;                   // (another player's world: its events are run there)
    const list = commonEventList(id);
    if (!list) return;
    if (this.ceAt?.[id] !== undefined && G.time - this.ceAt[id] < 0.3) return;
    (this.ceAt ||= {})[id] = G.time;
    const it = new Interpreter(1);
    it.troop = true;
    it.setup(list, 0);
    this.sideInterps.push(it);
  }
  // 変換攻撃 (script 199): <変換攻撃判定:chance> on the skill, then <HP変換攻撃:percent,chance> on it or on
  // the attacker's equipment / states turns that share of the damage dealt into HP (the youtou's drain)
  convertDrain(actor, obj, dmg) {
    if (!actor || dmg <= 0) return 0;
    const gate = /<変換攻撃判定[：:]\s*([\d.]+)\s*>/.exec(obj.note || '');
    if (!gate || !(parseFloat(gate[1]) > Math.floor(Math.random() * 100))) return 0;
    let pct = 0;
    for (const o of [...actor.featureObjects(), obj]) {
      const m = /<HP変換攻撃[：:]([^>\s]+)>/.exec(o?.note || '');
      if (!m) continue;
      const [a, b = '100'] = m[1].split(/\s*,\s*/);
      if (parseFloat(b) > Math.floor(Math.random() * 100)) pct += parseFloat(a) || 0;
    }
    return Math.floor(dmg * pct / 100);
  }
  // VX Ace: at 0 HP an enemy gets the death state unless it resists it (불사신 and other gimmicks); then
  // it stays standing at 0 HP until the gimmick takes the resistance away
  checkEnemyDeath(e) {
    if (e.puppet) return;                          // (it falls when the host's falls - coop.js)
    if (!e.alive || e.b.hp > 0) return;
    if (!e.b.stateResist(1) && e.battle && this.autoReviveEnemy(e)) return;
    if (!e.b.stateResist(1)) { this.killEnemy(e); return; }
    if (!e.deathlessAt || G.time - e.deathlessAt > 2) {
      e.deathlessAt = G.time;
      // (it does not go down yet: the shimmer the player's own deathless state makes - no words over it)
      const p = e.worldPos(new THREE.Vector3()); p.y += e.h * 0.6;
      G.audio?.playSe(G.seAt('Saint3', 60, 130), p);
    }
  }
  autoReviveEnemy(e) {
    const r = e.b.autoRevive();
    if (!r) return false;
    e.b.die(); e.b.removeState(1); this.pruneStateTimers(e);
    e.b.hp = Math.min(e.b.mhp, r.hp); e.drawBar();
    const p = e.worldPos(new THREE.Vector3());
    if (r.anim) G.screen.playAnimationOn(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), r.anim, { world: true, size: this.enemySize(e) });
    G.audio?.playSystemSe(16);
    if (r.breakRate > Math.random() * 100) this.breakSaver(e.b, r.source);
    return true;
  }
  // lasting: one that never wears off in the original stays (a state a running-out one brings - 노・페이스's last
  // stance); else it lasts 8 turns here
  addEnemyState(e, id, quiet = false, lasting = false) {
    const st = $data.states[id];
    if (!st || !e.alive) return;
    // death (a skill of its own - 빙폭의 비스트 melting away, a self-destruct -, or one that strikes it): it falls as from
    // any blow, unless it cannot die
    if (id === 1) { if (!e.b.stateResist(1)) { e.b.hp = 0; this.killEnemy(e); } return; }
    e.b.addState(id);
    if (!e.b.isState(id)) return;                    // (it resists it)
    this.markBreakOpen(e, id);
    if (lasting && !st.auto_removal_timing) { if (e.stateTimers) delete e.stateTimers[id]; }
    else if (st.auto_removal_timing === 1 && st.restriction < 4) {
      // removed at the end of an action (charging up, chanting): its turns count down as the enemy's own actions
      // end (the ATB, script 148) - a charge (2) lasts through the attack it was charging for, 기사의 긍지 (10)
      // through ten of them
      const n = Math.max(1, st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1)));
      (e.actionStates ||= {})[id] = { at: e.turn, n };
      (e.stateTimers ||= {})[id] = Math.max(20, n * 6);           // safety net
    } else {
      const turns = st.auto_removal_timing ? st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1)) : 8;
      // (one a troop's event puts on the party as well, at the same moment - 흑기사 린다메아's 린다메아영역2, the duel neither side
      // can die in: the original counts it in the same turns on both, so it lasts as long on her as on the player - an enemy's
      // turn here is a third of the player's, and it was over on her side long before the player's)
      const party = G.state?.system?.stateTimers?.[id];
      (e.stateTimers ||= {})[id] = st.auto_removal_timing && party > 0 && G.state.party.leader()?.isState(id) ? party : Math.max(2, turns * 2);
    }
    // knocked out of its wind-up (or its move): the attack is off, and so is its mark on the floor
    if (st.restriction >= 4 && (e.state === 'windup' || e.state === 'act')) { e.state = 'recover'; e.timer = 0.4; e.act = null; e.move = null; this.dropMarker(e); }
  }
  // 흑기사 린다메아's duel: a state that keeps both her and the player from dying, put on both at once for a while (린다메아영역2):
  // she stands her ground under the player's blows while it lasts - no knockback
  inDuel(e) {
    const a = G.state?.party?.leader();
    return !!a && e.b.states.some(id => {
      const st = $data.states[id];
      return !!st?.auto_removal_timing && a.isState(id) && (st.features || []).some(f => f.code === 14 && f.data_id === 1);
    });
  }
  damageRemovesStates(e) {
    for (const id of [...e.b.states]) {
      const st = $data.states[id];
      if (st?.remove_by_damage && Math.random() * 100 < st.chance_by_damage && id !== 1) {
        e.b.removeState(id);
        if (e.stateTimers) delete e.stateTimers[id];
      }
    }
  }
  enemyRestricted(e) {
    return e.b.states.some(id => id !== 7 && id !== 8 && ($data.states[id]?.restriction || 0) >= 4);
  }
  // timed states on enemies (turns = 2 s) and slip damage (poison) every 2 s
  tickEnemyStates(e, dt) {
    if (e.alive) e.b.tickBuffs(dt);
    const timers = e.stateTimers;
    if (!timers || !e.alive) return;
    let removed = false;
    for (const k of Object.keys(timers)) {
      timers[k] -= dt;
      if (timers[k] <= 0) {
        delete timers[k]; e.b.removeState(+k); removed = true;
        for (const s of this.stateExpired(e.b, +k)) this.addEnemyState(e, s, true, true);
      }
    }
    if (removed) this.checkEnemyDeath(e);
    e.slipT = (e.slipT || 0) + dt;
    if (e.slipT < 2) return;
    e.slipT = 0;
    if (e.b.mrg > 0 && e.b.mp < e.b.mmp) e.b.mp = Math.min(e.b.mmp, e.b.mp + Math.max(1, Math.floor(e.b.mmp * e.b.mrg)));
    const hrg = e.b.hrg;
    if (hrg < 0) {
      const v = Math.max(1, Math.floor(e.b.mhp * -hrg));
      e.b.hp = Math.max(0, e.b.hp - v);
      if (e.bar) e.bar.visible = true; e.drawBar();
      const p = e.worldPos(new THREE.Vector3());
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.8, p.z), String(v), '#c070ff');
      this.checkEnemyDeath(e);
    }
  }
}
