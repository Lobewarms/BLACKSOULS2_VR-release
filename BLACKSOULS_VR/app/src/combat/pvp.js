// PvP (co-op, the server's rule pvp): players striking players, and super armor (강인도) while attacking.
import * as THREE from 'three';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { BODY_R, BOUNCE_T, BURST_GAP, COOL_TURN, DESK_ACT, GUARD_STAMINA, HIT_AGAIN, PERFECT_GUARD, POISE_ATTACK,
  POISE_HIT, POISE_IDLE, POISE_REGEN, PVP_FIGHT, STAFF_BURST, STAGGER_GUARD, STAGGER_T, TURN_SECONDS, bladeMeets,
  ghostify, tmpC } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class PvpPart {
  // ---- PvP (co-op, the server's rule pvp - in the developer's world each player's own, two who both turned it on:
  // coop.js pvpWith): everyone may strike everyone. The one swinging finds the hit (its own
  // blade against the others' bodies as it sees them); the one struck judges the rest on its own side - its dodge,
  // guard and perfect guard, and the damage by the striker's own numbers against its own (pvpStruck)
  swingAtPlayers(hitTest, opts) {
    if (!G.coop?.pvpAny || !G.coop.active || this.spectating || this.playerDead) return;
    // (a swung blow wears the other's super armor down by its weapon's weight - more charged)
    const poise = POISE_HIT / this.weaponPace * ((opts?.charge || 0) >= 0.35 ? 1.5 : 1);
    for (const t of G.coop.pvpTargets()) if (hitTest(t)) this.strikePlayer(t, { ...opts, poise });
  }
  // (PvP, VR) this blade's path meets another player's weapon or shield as this world shows them (coop avatars'
  // heldShapes) - bladeMeets says how: held off ('block', 'guard': this swing does not go through to that one - a
  // clang, sparks, this hand jolts, some stamina), turned aside by a shield's slant ('deflect': nor does it - a scrape),
  // its parry beaten aside ('beat': the blow goes on at half strength), or sliding along it ('slide': the blow goes on).
  // It is told how (its hand jolts as it would). strong: a hard swing (fast, or charged)
  clashWithPlayers(b0, t0, b1, t1, { strong = false } = {}) {
    if (!G.coop?.pvpAny || !G.coop.active || this.spectating || this.playerDead) return;
    const hits = (this.pvpHits ||= new Map()), slid = (this.pvpSlid ||= new Map()), beat = (this.pvpBeat ||= new Map());
    for (const p of G.coop.pvpPeers()) {
      if (G.time - (hits.get(p.id) || -9) < 0.45 || G.time - (beat.get(p.id) || -9) < 0.45) continue;
      for (const s of p.avatar.heldShapes()) {
        const c = bladeMeets(s, b0, t0, b1, t1, strong);
        if (!c) continue;
        this.lastClash = { id: p.id, how: c.how };
        if (c.how === 'slide') {
          if (G.time - (slid.get(p.id) || -9) > 0.3) {
            slid.set(p.id, G.time);
            G.audio?.playSe(G.seAt('Sword1', 80, 150), c.at);      // (the slipping cue's sound)
            this.spawnSparks(c.at, c.dir, 4, 0xfff0c0);
            G.input.haptic('right', 0.35, 40);
            G.coop.sendClash(p.id, s.side, 5);
          }
          continue;
        }
        if (c.how === 'deflect') {
          hits.set(p.id, G.time);
          G.audio?.playSe(G.seAt('Sword1', 80, 150), c.at);
          this.spawnSparks(c.at, c.dir, 4, 0xfff0c0);
          G.input.haptic('right', 0.45, 50);
          G.coop.sendClash(p.id, s.side, 4);
          break;
        }
        if (c.how === 'beat') {
          beat.set(p.id, G.time);
          G.audio?.playSe(G.seAt('Parry', 95, 100), c.at);
          this.spawnSparks(c.at, c.dir, 8, 0xffe8b0);
          G.input.haptic('right', 0.7, 70);
          G.coop.sendClash(p.id, s.side, 3);
          break;
        }
        hits.set(p.id, G.time);
        G.audio?.playSe(G.seAt('Parry', 95, s.kind === 'shield' ? 110 : 130), c.at);
        this.spawnSparks(c.at, c.dir, 12, 0xffe8b0);
        G.input.haptic('right', 1, 100);
        this.useStamina(0.1, 0.8);
        G.coop.sendClash(p.id, s.side, s.kind === 'shield' ? 1 : 2);
        if (s.kind === 'shield') this.bounce();
        break;
      }
    }
  }
  // (PvP) another player's blade met what this player holds (coop.js onClash) - k: 1 taken on the shield (some
  // stamina), 2 held off by its blade, 3 its blade beaten aside (the blow comes on), 4 turned aside by the shield's
  // slant (a little stamina), 5 a blade sliding along its own: that hand jolts as it would, with the sound of it
  clashed(side, k) {
    if (this.playerDead || this.spectating) return false;
    const obj = side === 'right' ? this.weapon : this.shield, at = new THREE.Vector3();
    if (obj?.parent) obj.getWorldPosition(at); else G.player.headWorld(at);
    if (k <= 3) {
      G.audio?.playSe(G.seAt('Parry', 90, k === 1 ? 110 : k === 3 ? 100 : 130), at);
      this.spawnSparks(at, new THREE.Vector3(0, 1, 0), 8, 0xffe8b0);
    } else G.audio?.playSe(G.seAt('Sword1', 70, 150), at);
    G.input.haptic(side, [0, 1, 1, 0.8, 0.45, 0.3][k], k <= 3 ? 90 : 50);
    this.pvpFightUntil = G.time + PVP_FIGHT;
    const cost = k === 1 ? GUARD_STAMINA / 2 : k === 4 ? GUARD_STAMINA / 5 : 0;
    if (cost) this.useStamina(cost, 0.8);
    return true;
  }
  // (PvP) a spell or a thrown thing of this player's - one aimed at foes - reached another player (t: its body as seen
  // here): what it is - the skill or item, this player's numbers - goes to it, once a hit for as many hits as it makes;
  // that one takes it as it would (pvpStruck: a dodge, a guard; its damage, its states)
  strikePlayerWith(t, obj, { one = false } = {}) {
    if (!obj || !(obj.scope >= 1 && obj.scope <= 6)) return false;
    const hits = (this.pvpUseHits ||= new Map());
    if (G.time - (hits.get(t.id) || -9) < 0.25) return false;
    hits.set(t.id, G.time);
    const actor = G.state.party.leader();
    if (!actor) return false;
    const n = one ? 1 : Math.max(1, Math.min(5, obj.repeats || 1)), mult = this.buffMult(), item = obj.__class === 'RPG::Item';
    for (let r = 0; r < n; r++) this.later(r * 120, () => G.coop?.sendPvp(t.id, obj.id, mult, false, actor, item));
    if (obj.animation_id > 0) G.screen.playAnimationOn(new THREE.Vector3(t.x, t.y + 0.9, t.z), obj.animation_id, { rate: 3, height: t.h });
    G.input.haptic('left', 0.5, 50);
    return true;
  }
  // a blow of this player's reached another one (t: its body as seen here): what it is - the attack skill, how hard,
  // this player's numbers - goes to it
  strikePlayer(t, { power = 1, charge = 0, crit = false, poise = 0 } = {}) {
    const hits = (this.pvpHits ||= new Map());
    if (G.time - (hits.get(t.id) || -9) < HIT_AGAIN) return;            // (one swing passing through counts once)
    hits.set(t.id, G.time);
    const actor = G.state.party.leader();
    if (!actor) return;
    const skill = this.skillByState(actor, this.playerAttackSkill(actor));
    let mult = power * this.buffMult();
    if (charge >= 0.35) mult *= 1 + charge;
    if (G.time - (this.pvpBeat?.get(t.id) || -9) < 0.45) mult *= 0.5;       // (its parry beaten aside: weaker)
    const critical = !!crit && skill.damage?.critical !== false && Math.random() < 0.35 + (actor.cri || 0);
    if (critical) mult *= 2;
    G.coop.sendPvp(t.id, skill.id, mult, critical, actor, false, poise);
    const at = new THREE.Vector3(t.x, t.y + 1.2, t.z);
    G.audio?.playSe(G.seAt(critical ? 'Slash11' : 'Slash1', 90, 95), at);
    G.input.haptic('right', 0.9, 70);
  }
  // (PvP) another player's blow reached this one: judged here. by: a stand-in for the striker (its numbers as sent);
  // from: where it stands. What came of it: 'dodge' | 'perfect' | 'guard' | 'hit' | '' (nothing: fallen, watching)
  pvpStruck(by, skill, mult, from, sa = 0) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead || this.spectating || !skill) return '';
    this.pvpFightUntil = G.time + PVP_FIGHT;            // (struck at - dodged, guarded or not: in a fight)
    const head = G.player.headWorld(new THREE.Vector3());
    if (G.player.invuln > 0) { G.audio?.playSystemSe(18); G.input.haptic('left', 0.2, 30); G.input.haptic('right', 0.2, 30); return 'dodge'; }
    let dmg = 0;
    try { dmg = this.withGuardBuff(actor, () => this.computeDamage(by, actor, skill, mult)); } catch (e) { console.warn('[coop] pvp damage', e); }
    dmg = Math.round(dmg * G.settings.difficulty);
    const ep = from || head;
    let how = 'hit';
    if (this.isBlocking(ep) && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD) {
      this.perfectGuardReward(actor); this.guardFree = true; this.guardTing(ep, true);
      return 'perfect';
    } else if (this.isBlocking(ep)) {
      how = 'guard';
      dmg = Math.round(dmg * (this.hasShield ? 0.25 : 0.5) / Math.max(0.5, actor.grd));
      this.useStamina(GUARD_STAMINA, 1);
      this.guardTing(ep);
    } else {
      G.screen.hurtFlash(1);
      G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 1);
      G.input.haptic('left', 1, 120); G.input.haptic('right', 1, 120);
      G.audio?.playSystemSe(14);
    }
    const t = skill.damage?.type || 0;
    if (t === 3 || t === 4) dmg = 0;                     // (a recovery aimed at a foe: nothing taken)
    if (dmg > 0 && (t === 2 || t === 6)) {               // (MP damage, an MP drain)
      actor.mp = Math.max(0, actor.mp - dmg);
      this.popupAtPlayer(`MP -${dmg}`, '#a0b8ff');
    } else if (dmg > 0) {
      actor.hp = Math.max(0, actor.hp - dmg);
      this.damageRemovesActorStates(actor);
      this.popupAtPlayer(`-${dmg}`, '#ff9a9a');
    }
    // (what else it does to a foe: the states it adds or takes away, its debuffs - by this player's rates)
    if (skill.scope >= 1 && skill.scope <= 6) {
      for (const ef of skill.effects || []) {
        if (ef.code === 21 && ef.data_id > 0 && !actor.stateResist(ef.data_id) && Math.random() < ef.value1 * actor.stateRate(ef.data_id)) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); }
        else if (ef.code === 22) actor.removeState(ef.data_id);
      }
      this.applyBuffEffects(actor, skill, TURN_SECONDS);
    }
    if (how === 'hit' && sa > 0) this.poiseHit(sa, ep);             // (a blow that landed - not a guarded or dodged one)
    if (actor.hp <= 0) this.playerFalls(null);
    return how;
  }
  // ---- (PvP) super armor (강인도 - POISE_HIT) ----
  // attacking: a blow swung or being charged (PC), the blade swung a moment ago or a charge held (VR)
  attacking() { return !!this.swing || this.deskCharge != null || (this.charge?.level || 0) > 0 || G.time < (this.swingingUntil ?? -99); }
  poiseMax() { return this.attacking() ? POISE_ATTACK / Math.pow(this.weaponPace, 2.2) : POISE_IDLE; }
  // a player's blow that landed wears it by sa (its weapon's - swingAtPlayers); worn through: staggered
  poiseHit(sa, from) {
    if (G.time < (this.staggerGuardUntil ?? -99)) return;                  // (staggered a moment ago: nothing wears it)
    if (G.time - (this.poiseAt ?? -99) > POISE_REGEN) this.poiseWear = 0;    // (not struck a while: whole again)
    this.poiseAt = G.time;
    this.poiseWear = (this.poiseWear || 0) + sa;
    if (this.poiseWear < this.poiseMax()) return;
    this.poiseWear = 0;
    this.stagger(from);
  }
  // staggered: the blow, charge or drink in hand cut off; no attack, guard (updateGuard), dodge (player.js), item or
  // skill (useQuickEntry, useItem) for STAGGER_T s - a harder jolt than a plain blow's
  stagger(from, t = STAGGER_T, guarded = true) {
    this.staggerUntil = G.time + t;
    if (guarded) this.staggerGuardUntil = this.staggerUntil + STAGGER_GUARD;
    if (this.swing) { this.swing = null; if (this.weapon && !G.vr && this.weapon.userData.fist) this.weapon.rotation.set(0.35, 0.15, 0); }
    this.deskCharge = null; this.charge = null; this.healing = null;      // (a drink cut off: the item not used)
    const head = G.player.headWorld(new THREE.Vector3()), at = from || head;
    G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), guarded ? 1.8 : 1);
    G.input.haptic('left', 1, 220); G.input.haptic('right', 1, 220);
  }
  staggered() { return G.time < (this.staggerUntil ?? -99); }
  // a swung blow of this player's taken square on another's shield (VR: met there - clashWithPlayers; else told -
  // coop.js onBounced): a light weapon bounces off it (BOUNCE_T)
  bounce() { if (this.weaponPace > 1 && !this.weapon?.userData.ranged && !this.playerDead) this.stagger(null, BOUNCE_T, false); }
  swingAtNpcs(hitTest) {
    if (G.map.interpreter.running() || G.coop?.phantom) return;
    for (const ev of G.map.eventList) {
      if (!ev.page || ev.erased || ev.trigger !== 0 || ev.transparent || this.controlsEvent(ev)) continue;
      if (!this.hasKillChoice(ev)) continue;
      const c = ev.viewPos
        ? { x: ev.viewPos.x, z: ev.viewPos.z, r: 0.38, h: 1.75, y: ev.viewPos.y }
        : { x: (G.map.nearX(ev.realX, G.map.playerChar.fx) + 0.5) * T, z: (G.map.nearY(ev.realY, G.map.playerChar.fy) + 0.5) * T, r: 0.38, h: 1.75, y: G.floorAt ? G.floorAt(ev.realX, ev.realY) : 0 };
      if (!hitTest(c)) continue;
      // one swing passing through counts once (VR checks the blade every frame)
      if (ev._npcHitAt && G.time - ev._npcHitAt < 0.5) return;
      ev._npcHitAt = G.time;
      const pos = new THREE.Vector3(c.x, c.y + 1.3, c.z);
      G.audio?.playSe(G.seAt('Slash1', 90, 100), pos);
      G.input.haptic('right', 0.8, 80);
      ev.hitFlash = 0.25;
      if (ev._killWarn && G.time - ev._killWarn < 3) {
        ev._killWarn = 0;
        this.startNpcKill(ev);
      } else ev._killWarn = G.time;
      return;
    }
  }
  segmentHitsCylinder(c, b0, t0, b1, t1) {
    for (let s = 0; s <= 3; s++) {
      const k = s / 3;
      const bx = b0.x + (b1.x - b0.x) * k, by = b0.y + (b1.y - b0.y) * k, bz = b0.z + (b1.z - b0.z) * k;
      const tx = t0.x + (t1.x - t0.x) * k, ty = t0.y + (t1.y - t0.y) * k, tz = t0.z + (t1.z - t0.z) * k;
      const ax = tx - bx, az = tz - bz;
      const l2 = ax * ax + az * az;
      const u = l2 > 1e-6 ? THREE.MathUtils.clamp(((c.x - bx) * ax + (c.z - bz) * az) / l2, 0, 1) : 0;
      const qx = bx + ax * u, qz = bz + az * u, qy = by + (ty - by) * u;
      if (Math.hypot(qx - c.x, qz - c.z) < c.r && qy > c.y + 0.1 && qy < c.y + c.h) return true;
    }
    return false;
  }
  startNpcKill(ev) {
    const m = G.map;
    if (m.interpreter.running()) return;
    ev.lock?.();
    m.interpreter.setup(ev.list, ev.id);
    m.interpreter.killMode = true;   // skip the small talk and pick "살해한다" at the choice
  }

  // the trigger (PC: a click) with a weapon that shoots (shotStyle): a bow's arrow, a gun's bullet, a staff's magic (the
  // whole blow where it lands). A gun whose normal attack hits several times (한스의 기관총: its attack count) fires as
  // many bullets in a burst, each of them one hit. A gun whose blow goes on with a shot of its own fires that shot
  // instead (gunShotSkill - 거룩한 총검)
  fireRanged() {
    const kind = this.shotKind, actor = G.state.party.leader();
    const shot = kind === 'gun' && actor ? this.gunShotSkill(actor) : null;
    if (shot) { if (!G.vr) this.deskActUntil = G.time + DESK_ACT + 0.6; this.fireSkillShot(actor, shot); return; }
    const n = kind !== 'gun' || !actor ? 1 : this.attackHits(this.skillByState(actor, this.playerAttackSkill(actor)), actor);
    if (!G.vr) this.deskActUntil = G.time + DESK_ACT + (n - 1) * BURST_GAP;     // (PC: the hands busy while it goes - handsBusy)
    this.rangedCooldown = kind === 'magic' ? 0.9 : 0.6 + (n - 1) * BURST_GAP;
    const brk = this.breakArmed();                 // (fired with Break held: the first shot carries the Break)
    this.fireShot(kind, n > 1, brk);
    for (let i = 1; i < n; i++) this.later(i * BURST_GAP * 1000, () => this.fireShot(kind, true, null));
  }
  // the shot a gun's blow goes on with (script 189 使用後追加行動), by the state the one holding it is in (script 195):
  // 거룩한 총검's stab goes on with the shot of the bullet loaded (총탄 장전 - states 190 / 191 / 192) - Ⅰ 총검 건
  // 브레이크, Ⅱ 하드 건 브레이크, Ⅲ 풀 버스트. Its other hits (attack count) are the stab's, not more shots
  gunShotSkill(actor) {
    const stab = this.skillByState(actor, this.playerAttackSkill(actor));
    for (const a of stab ? this.afterActions(stab) : []) {
      const s = a.id > 0 ? this.skillByState(actor, $data.skills[a.id]) : null;
      if (s && this.skillLook(s) === 'gun') return s;
    }
    return null;
  }
  // that shot fired: as many rounds as it hits (풀 버스트: 7 in a burst, each one hit of it), each landing as the skill
  // does - its damage, its Break / Hard Break, its animation once; paid and cooling as the skill is (Ⅱ, Ⅲ: 3 turns). Cooling
  // (or unpaid), nothing fires: the original's stab goes on without its shot then
  fireSkillShot(actor, s) {
    if (this.skillCooling(s) > 0 || !actor.skillCostPayable(s) || actor.skillSealed(s.id)) {
      this.rangedCooldown = 0.25;
      G.audio?.playSystemSe(3);
      G.input.haptic('right', 0.25, 30);
      return;
    }
    this.actorPays(actor, s);
    this.skillCD[s.id] = G.time + this.coolSeconds(s);
    const n = THREE.MathUtils.clamp((s.repeats || 1) * ({ 4: 2, 5: 3, 6: 4 }[s.scope] || 1), 1, 8);
    this.rangedCooldown = 0.6 + (n - 1) * BURST_GAP;
    const volley = { shown: false };
    this.fireShot('gun', true, null, { skill: s, volley });
    for (let i = 1; i < n; i++) this.later(i * BURST_GAP * 1000, () => this.fireShot('gun', true, null, { skill: s, volley }));
  }
  // one round of kind 'gun' | 'bow' | 'magic' (skill: a skill's shot, one hit of it - fireSkillShot)
  fireShot(kind, one, breakSkill, { skill = null, volley = null } = {}) {
    if (!this.weapon || this.disarmed) return;
    const bow = kind === 'bow', magic = kind === 'magic';
    const from = this.muzzle();
    const ray = this.aimRay('right');
    const dir = ray ? ray.dir : new THREE.Vector3(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.spawnProjectile(from, dir, { speed: bow ? 18 : 16, color: magic ? 0x6688ff : 0xffe0a0, owner: 'player', power: 0.9, homing: 0, breakSkill, one, usable: skill, volley,
      staff: magic && !skill ? STAFF_BURST : 0, ...(bow ? { mesh: this.arrowMesh(), align: true } : { style: magic ? 'arcane' : 'bullet', tint: magic ? 0x6688ff : null }) });
    // (a gun: the flash at its muzzle, as an enemy's has)
    if (!bow && !magic) this.spawnGlow(from.clone().addScaledVector(dir, 0.06), { color: 0xffd890, size: 0.3, life: 0.07, grow: 1.6 });
    G.audio?.playSe(G.seAt(bow ? 'Bow1' : magic ? 'Magic1' : 'Gun1', 80, 100));
    G.input.haptic('right', 0.6, one ? 30 : 50);
  }
  // where what the right hand holds shoots from: its tip
  muzzle() {
    this.weapon.updateWorldMatrix(true, false);
    return new THREE.Vector3(0, 0, -this.weapon.userData.length).applyMatrix4(this.weapon.matrixWorld);
  }
  // a bow's arrow: a shaft, its head ahead (-Z: the way it flies - align) and its feathers behind (made once, shared)
  arrowMesh() {
    if (!this.arrowProto) {
      const g = new THREE.Group(), mat = color => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.6, 6), mat(0x9a7448));
      shaft.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), mat(0xd8dde2));
      head.rotation.x = -Math.PI / 2; head.position.z = -0.33;
      g.add(shaft, head);
      for (const a of [0, Math.PI / 2]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.1), mat(0xf0ece0));
        f.rotation.x = Math.PI / 2;
        const turn = new THREE.Group(); turn.rotation.z = a; turn.position.z = 0.25; turn.add(f);
        g.add(turn);
      }
      g.userData.look = 'arrow';                     // (co-op: shareShot)
      this.arrowProto = g;
    }
    return this.arrowProto.clone();
  }
  segmentHitsEnemy(e, b0, t0, b1, t1) {
    const wp = e.worldPos(new THREE.Vector3());
    wp.y += e.hover || 0;                            // (a body floating over the stage)
    const r = e.hr * T + 0.05;
    for (let s = 0; s <= 3; s++) {
      const k = s / 3;
      const bx = b0.x + (b1.x - b0.x) * k, by = b0.y + (b1.y - b0.y) * k, bz = b0.z + (b1.z - b0.z) * k;
      const tx = t0.x + (t1.x - t0.x) * k, ty = t0.y + (t1.y - t0.y) * k, tz = t0.z + (t1.z - t0.z) * k;
      // closest point on segment to the enemy axis (XZ)
      const ax = tx - bx, az = tz - bz;
      const l2 = ax * ax + az * az;
      const u = l2 > 1e-6 ? THREE.MathUtils.clamp(((wp.x - bx) * ax + (wp.z - bz) * az) / l2, 0, 1) : 0;
      const qx = bx + ax * u, qz = bz + az * u, qy = by + (ty - by) * u;
      if (Math.hypot(qx - wp.x, qz - wp.z) < r && qy > wp.y + 0.05 && qy < wp.y + e.h + 0.1 && (!e.pair || this.partAt(e, tmpC.set(qx, qy, qz)) === e)) return true;
    }
    return false;
  }

  // keep the player out of enemies
  // the enemies stand in the player's way like walls (and the player in theirs, updateEnemies); a dodge slips
  // through them, and the player walks out of one they ended up in. Put out of a body - one come out of hiding or
  // grown on the player, a co-op host's enemy walking into it -, never through a wall: the way out in short steps the
  // walls hold (player.slideTo)
  pushPlayer(player) {
    const head = player.headWorld(new THREE.Vector3());
    const fx = head.x / T - 0.5, fy = head.z / T - 0.5;
    const targets = this.allTargets();
    for (const e of this.passing) if (!targets.includes(e) || Math.hypot(fx - e.fx, fy - e.fy) >= e.r + BODY_R) this.passing.delete(e);
    const [bx, by] = this.blockPlayer(fx, fy, player, targets);
    if (bx === fx && by === fy) return;
    const [x, y] = player.slideTo(fx, fy, bx, by);
    player.rig.position.x += (x + 0.5) * T - head.x;
    player.rig.position.z += (y + 0.5) * T - head.z;
  }

  // a player position (tiles) against the enemies' bodies: out to their edge (not one the player is slipping
  // through in a dodge). Also each step of the player's own move (player.js), so a quick one does not go
  // through a body in one frame
  blockPlayer(fx, fy, player, targets = this.allTargets()) {
    const dodging = player.dodging;
    for (const e of targets) {
      if ((e.state === 'act' && e.act?.kind === 'dash') || (e.lift || 0) > 0.3) continue;    // (it runs / comes down through)
      const dx = fx - e.fx, dy = fy - e.fy;
      const d = Math.hypot(dx, dy), min = e.r + BODY_R;
      if (!(d < min)) continue;
      if (dodging) { this.passing.add(e); continue; }
      if (this.passing.has(e)) continue;
      if (d > 1e-4) { fx = e.fx + dx / d * min; fy = e.fy + dy / d * min; }
    }
    return [fx, fy];
  }

  updatePopups(dt) {
    for (const p of this.popups) {
      p.t += dt;
      p.sprite.position.y += dt * 0.5;
      p.sprite.material.opacity = Math.max(0, 1 - p.t / 1.1);
    }
    this.popups = this.popups.filter(p => {
      if (p.t < 1.1) return true;
      this.root.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose();
      return false;
    });
  }
  // a step on the map (player.js) - VX Ace's on_player_walk: a damage floor (a poison swamp) takes 10 HP (times the floor
  // damage rate; not the last one); every 20 steps HP / MP regenerate or slip away (in a fight it goes by time);
  // states that wear off by walking count down; the stealth counts down
  onPlayerStep() {
    const actor = G.state?.party?.leader();
    if (!actor || this.playerDead) return;
    const pc = G.map.playerChar;
    if (G.map.grid?.isDamage(pc.x, pc.y)) {
      const v = Math.min(Math.trunc(10 * actor.fdr), Math.max(0, actor.hp - 1));
      if (v > 0) { actor.hp -= v; this.slipHurt(v); }
    }
    if (!this.inCombat && G.state.party.steps % 20 === 0) this.regenerateNow(actor);
    const timers = G.state.system.stateTimers;
    for (const id of actor.walkStep()) if (timers) delete timers[id];
    if (G.state.system.stealthSteps > 0) G.state.system.stealthSteps--;
  }
  // script 141's cool-down shortened from an event ($game_temp.actor_loss_cool_time(n) - 토끼의 회중시계 5 turns,
  // 정신 통일 all of them, 리로드 one): n turns (COOL_TURN each) off the player's / the enemies'
  lossCoolTime(kind, n) {
    if (kind === 'actor') { for (const k of Object.keys(this.skillCD)) this.skillCD[k] -= n * COOL_TURN; }
    else for (const e of this.enemies) for (const k of Object.keys(e.cool || {})) e.cool[k] -= n * COOL_TURN;
  }
  // the stealth (안 보이는 후추, 보이지 않는 몸): the hands and what they hold are half see-through while it lasts
  updateGhost() {
    const on = (G.state?.system?.stealthSteps || 0) > 0;
    const objs = [this.weapon, this.shield, this.held?.fx, this.ready?.fx, ...(G.hands?.roots?.() || [])].filter(Boolean);
    const key = on ? objs.map(o => o.uuid).join(',') : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    for (const o of this.ghosted || []) if (!objs.includes(o) || !on) ghostify(o, false);
    this.ghosted = on ? objs : [];
    for (const o of this.ghosted) ghostify(o, true);
  }
  randomEncounterTroop() { return 0; }
  enemyParam(index, param, interp) {
    const b = this.battleOf(interp);
    const e = b?.enemies.find(x => x.memberIndex === index);
    if (!e) return 0;
    return param === 0 ? e.b.hp : param === 1 ? e.b.mp : e.b.param(param - 2);
  }
}
