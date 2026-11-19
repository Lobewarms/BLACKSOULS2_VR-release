// The player's attacks: swings and their hits, the Break (the original's battle command: an enemy preparing an action or
// guarding interrupted), and the NPCs that offer 살해한다 cut down directly.
import * as THREE from 'three';
import { commonEventList } from '../character.js';
import { lineOfSight } from '../collision.js';
import * as J from '../skilljudge.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { Interpreter } from '../interpreter.js';
import { T } from '../mapmesh.js';
import { BLOW_STAMINA, BLOW_STAMINA_VR, BREAK_WINDOW, BREAK_WINDOW_BOSS, CHARGED_STAMINA, DESK_SWING, ENEMY_TURN,
  GUN_BREAK_RANGE, GUN_PARRY, HIT_AGAIN, INPUT_BUFFER, SWING_LEVELS, blowRate, bodyRelative, fxk, tmpA, tmpB } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class AttackPart {
  // ---- player attacks -----------------------------------------------------------------------
  // (PC) how fast this player's blows come now (blowRate: the weapon's weight and the 민첩 buff on the player)
  blowRate() { return blowRate(this.weaponPace, G.state?.party?.leader()?.buffs?.[6]); }
  updatePlayerAttack(dt) {
    if (!this.weapon || this.gripAdjust || this.ready || this.held || this.disarmed || this.restrained || this.spectating) { this.charge = null; this.deskCharge = null; this.weaponLag.settle(); return; }
    const ranged = this.weapon.userData.ranged;
    if (G.vr) {
      // swing detection (the blade where its weight has it: weaponlag.js)
      this.weaponLag.update(dt);
      const base = tmpA, tip = tmpB;
      this.weaponSegment(base, tip);
      // recent tip positions: a hit needs a real swing (fast AND a long enough arc), not a flick. Speed
      // and arc count the arm's motion only (the tip seen from the body), so walking, running or turning
      // with the weapon held still never swings it; what it hits is still found along its real path
      const rel = bodyRelative(tip, new THREE.Vector3());
      // charging: the trigger held with a blade (not pointing at a menu) makes the next blow that lands heavier
      this.updateCharge(dt, !ranged && G.input.xrHeld('right', 0) && !G.ui.pointerTarget);
      const hist = this.tipHist || (this.tipHist = []);
      hist.push({ t: G.time, p: rel });
      while (hist.length > 2 && G.time - hist[0].t > 0.14) hist.shift();
      if (this.hasPrev) {
        const speed = rel.distanceTo(this.prevRel) / Math.max(dt, 1e-3);
        const travel = rel.distanceTo(hist[0].p);
        const level = SWING_LEVELS[G.settings.swingLevel ?? 2] || SWING_LEVELS[2];
        // a fist moves slower and shorter than a blade's tip
        const [needSpeed, needTravel] = this.weapon.userData.unarmed ? [level[0] * 0.65, level[1] * 0.6] : level;
        if (speed > needSpeed && travel > needTravel) this.swingingUntil = G.time + 0.25;      // (attacking - super armor)
        if (speed > needSpeed && travel > needTravel && !this.staggered()) {
          const power = THREE.MathUtils.clamp(0.6 + (speed - needSpeed) / 5, 0.6, 1.4) * (this.stamina > 0.1 ? 1 : 0.5);
          const charge = this.charge?.level || 0, strong = speed > needSpeed * 1.5;
          let landed = false;
          for (const e of this.allTargets()) {
            if (e.hitCooldown > 0) continue;
            if (this.segmentHitsEnemy(e, this.prevBase, this.prevTip, base, tip)) {
              e.hitCooldown = HIT_AGAIN;
              landed = true;
              const brk = this.breakArmed();
              if (brk) this.breakOnHit(e, brk, this.prevTip);
              else {
                const crit = speed > needSpeed + 4.5 && Math.random() < 0.35 + (G.state.party.leader()?.cri || 0);
                this.playerHitEnemy(e, power, crit, this.prevTip, { melee: true, strong, charge });
              }
              G.input.haptic('right', 0.9, 70);
              this.useStamina((charge >= 0.35 ? CHARGED_STAMINA : BLOW_STAMINA_VR) / this.weaponPace, 0.8);
            }
          }
          if (landed && this.charge && charge >= 0.35) { this.charge.spent = true; this.charge.level = 0; }
          const pb = this.prevBase.clone(), pt = this.prevTip.clone(), cb = base.clone(), ct = tip.clone();
          this.swingAtNpcs(c => this.segmentHitsCylinder(c, pb, pt, cb, ct));
          this.clashWithPlayers(pb, pt, cb, ct, { strong: strong || charge >= 0.35 });   // (PvP: another's weapon or shield first)
          this.swingAtPlayers(c => this.segmentHitsCylinder(c, pb, pt, cb, ct), { power, strong, charge, crit: speed > needSpeed + 4.5 });
        }
      }
      this.prevBase.copy(base); this.prevTip.copy(tip); this.prevRel.copy(rel); this.hasPrev = true;
      if (G.input.breakPressed() && !G.ui.consumedConfirm) this.pressBreak();
      this.showBreakReady(tip);
      if (ranged && G.input.xrPressed('right', 0) && this.rangedCooldown <= 0 && !G.ui.pointerTarget && !this.staggered()) this.fireRanged();
    } else {
      // desktop: click to swing - hold the click to charge, the swing comes on letting go (ranged weapons shoot)
      // (a click a moment early - the last blow or a stagger ending, a shot not ready - kept: INPUT_BUFFER)
      if (G.input.attackPressed()) this.attackAskedAt = G.time;
      if (G.time - (this.attackAskedAt ?? -99) <= INPUT_BUFFER && !this.swing && this.deskCharge == null && this.stamina > 0.05 && !this.staggered()) {
        if (ranged) { if (this.rangedCooldown <= 0) { this.attackAskedAt = -99; this.fireRanged(); } }
        else { this.attackAskedAt = -99; this.deskCharge = G.time; }
      }
      if (this.deskCharge != null && !G.input.mouseHeld(0)) {
        const charge = THREE.MathUtils.clamp((G.time - this.deskCharge - 0.15) / 1.0, 0, 1);
        this.deskCharge = null;
        if (!this.swing && this.stamina > 0.05 && !this.staggered()) {
          this.swing = { t: 0, hit: new Set(), charge };
          if (!this.weapon.userData.fist) this.deskSwing.begin(this.swing, G.time);      // (a cut in the chain, or charged: a thrust)
          this.useStamina((charge >= 0.35 ? CHARGED_STAMINA : BLOW_STAMINA) / this.weaponPace, 0.7);
          G.audio?.playSe(G.seAt('Wind7', 60, charge >= 0.35 ? 100 : 140));
        }
      }
      if (G.input.breakPressed()) this.pressBreak();
      if (this.swing) {
        const s = this.swing;
        s.t += dt;
        const k = Math.min(1, s.t * this.weaponPace * this.blowRate() / DESK_SWING);   // (a light weapon's blow quicker, a heavy one's slower)
        if (this.weapon.userData.fist) this.weapon.rotation.set(0.35 - Math.sin(k * Math.PI) * 1.3, 0.15 + (k - 0.5) * 1.8, -Math.sin(k * Math.PI) * 0.6);
        if (k > 0.25 && k < 0.7) {
          const head = G.player.headWorld(new THREE.Vector3());
          const f = G.player.forwardVec();
          const reach = this.weaponLength() + 0.9;
          for (const e of this.allTargets()) {
            if (s.hit.has(e)) continue;
            const wp = e.worldPos(new THREE.Vector3());
            const to = new THREE.Vector3(wp.x - head.x, 0, wp.z - head.z);
            const d = to.length() - e.hr * T;
            if (e.pair && this.partAt(e, head.clone().addScaledVector(f, to.length())) !== e) continue;
            if (d < reach && to.normalize().dot(f) > 0.45) {
              s.hit.add(e);
              const brk = this.breakArmed();
              if (brk) this.breakOnHit(e, brk, head);
              else this.playerHitEnemy(e, this.stamina > 0.1 ? 1 : 0.5, Math.random() < 0.08 + (G.state.party.leader()?.cri || 0), head, { melee: true, charge: s.charge || 0 });
            }
          }
        }
        if (k > 0.3 && k < 0.6 && !s.npcDone) {
          s.npcDone = true;
          const head = G.player.headWorld(new THREE.Vector3());
          const f = G.player.forwardVec();
          const reach = this.weaponLength() + 0.9;
          this.swingAtNpcs(c => {
            const to = new THREE.Vector3(c.x - head.x, 0, c.z - head.z);
            const d = to.length() - c.r;
            return d < reach && to.normalize().dot(f) > 0.5;
          });
          this.swingAtPlayers(c => {
            const to = new THREE.Vector3(c.x - head.x, 0, c.z - head.z);
            const d = to.length() - c.r;
            return d < reach && to.normalize().dot(f) > 0.5;
          }, { power: this.stamina > 0.1 ? 1 : 0.5, charge: s.charge || 0 });
        }
        if (k >= 1) { this.swing = null; if (this.weapon.userData.fist) this.weapon.rotation.set(0.35, 0.15, 0); }
      }
      // (any weapon but a fist: the blade where its blow - or the press, the charge's guard, or rest - has it now; a gun
      // or bow stays where it is held)
      if (!this.weapon.userData.fist) {
        this.deskSwing.update(this.weapon, dt, G.time, this.swing, this.swing ? Math.min(1, this.swing.t * this.weaponPace * this.blowRate() / DESK_SWING) : 0,
          this.deskCharge != null ? this.chargeLevel() : null, this.deskBody());
      }
    }
  }
  // charging a blow (VR: the trigger held): a rumble in the hand that grows, a tick and a rising sound when
  // full (~1 s); the next blow that lands takes it, then let go to charge again
  updateCharge(dt, held) {
    const c = this.charge || (this.charge = { t: 0, level: 0, spent: false, full: false, pulse: 0 });
    if (!held || this.stamina < 0.15) { c.t = 0; c.level = 0; c.spent = false; c.full = false; return; }
    if (c.spent) { c.level = 0; return; }
    c.t += dt;
    c.level = THREE.MathUtils.clamp((c.t - 0.15) / 1.0, 0, 1);
    if (c.level <= 0) return;
    c.pulse -= dt;
    if (c.pulse <= 0) { G.input.haptic('right', 0.12 + 0.45 * c.level, 30); c.pulse = 0.11 - 0.05 * c.level; }
    if (c.level >= 1 && !c.full) { c.full = true; G.input.haptic('right', 0.9, 70); G.audio?.playSe(G.seAt('Up4', 55, 130)); }
  }
  chargeLevel() {
    if (this.deskCharge != null) return THREE.MathUtils.clamp((G.time - this.deskCharge - 0.15) / 1.0, 0, 1);
    return this.charge?.level || 0;
  }
  // the weapon's own light: white-hot as a blow charges, a warm pulse while blows are strengthened (after a
  // perfect guard) - no words
  updateWeaponGlow() {
    if (!this.weapon) return;
    const ch = this.chargeLevel(), buff = (this.powerUntil || 0) > G.time;
    const k = 0.5 + 0.5 * Math.sin(G.time * 10);
    let r = Math.max(ch * 0.55, buff ? 0.4 + 0.2 * k : 0), g = Math.max(ch * 0.55, buff ? 0.15 + 0.08 * k : 0), b = Math.max(ch * 0.6, buff ? 0.03 : 0);
    if (this.skillArm) r = Math.max(r, 0.32 + 0.28 * (0.5 + 0.5 * Math.sin(G.time * 8)));     // a weapon art waits: red
    // (리포스트 of my own - blows slipped and answered: a pale flicker)
    if (this.slipStance(G.state.party.leader())) { const p = 0.18 + 0.16 * (0.5 + 0.5 * Math.sin(G.time * 13)); r = Math.max(r, p); g = Math.max(g, p); b = Math.max(b, p * 1.15); }
    const key = `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${this.weapon.uuid}`;
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.weapon.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(r, g, b); });
  }

  // ---- Break (original battle command): interrupt an enemy that is preparing an action or guarding
  breakImmune(e, stateId = 8) { return e.b.stateResist(stateId) || e.b.stateRate(stateId) === 0; }
  // Break's chance like the original: the skill's rate x the enemy's Break rate. Most enemies (rate 0.01 or
  // less) only open up while charging (x10000: 힘 모으기, 파고들기, 영창 ...) or guarding (x1000).
  // Setting 브레이크 판정 'easy': any attack wind-up works unless the enemy is immune.
  breakRoll(e, stateId = 8, value = 1) {
    if (e.state === 'stagger' || this.inDuel(e)) return 0;
    const chance = e.b.stateResist(stateId) ? 0 : THREE.MathUtils.clamp(value * this.breakRate(e, stateId), 0, 1);
    if ((G.settings.breakRule || 'original') !== 'easy' || chance <= 0) return chance;
    return e.state === 'windup' || e.state === 'guard' || chance >= 0.5 ? 1 : 0.001;
  }
  // a state that lets Break in (charging up, guarding, a counter stance: x10 ... x10000 on Break) does so only for
  // BREAK_WINDOW s from when it came; it stays on (its other effects - the stronger blow it charges for - stay)
  opensBreak(id) {
    const st = $data.states[id];
    if (!st) return false;
    if (st._opensBreak === undefined) st._opensBreak = (st.features || []).some(f => f.code === 13 && (f.data_id === 7 || f.data_id === 8) && f.value > 1);
    return st._opensBreak;
  }
  markBreakOpen(e, id) { if (this.opensBreak(id)) (e.breakOpen ||= {})[id] = G.time + (e.boss ? BREAK_WINDOW_BOSS : BREAK_WINDOW); }
  // the Break rate now: the states whose moment has passed count no more
  breakRate(e, id = 8) {
    let r = e.b.stateRate(id);
    const open = e.breakOpen;
    if (!open) return r;
    for (const s of e.b.states) {
      const until = open[s];
      if (until === undefined || G.time < until) continue;
      for (const f of $data.states[s]?.features || []) if (f.code === 13 && f.data_id === id && f.value > 0) r /= f.value;
    }
    return r;
  }
  // the enemy's own Break rate, without states
  baseBreakChance(e, stateId = 8) {
    const f = e.data?.features || [];
    if (f.some(x => x.code === 14 && x.data_id === stateId)) return 0;
    return Math.min(1, f.filter(x => x.code === 13 && x.data_id === stateId).reduce((r, x) => r * x.value, 1));
  }
  // 'open': a state (charging, guarding) dropped the Break immunity; 'locked': charging a big attack
  // that cannot be broken (브레이크 불가)
  breakCue(e) {
    if (!e.battle || !e.alive || e.hidden || e.state === 'stagger') return null;
    if (e.b.states.some(id => J.unbreakableState(id))) return 'locked';
    return !e.b.stateResist(8) && this.breakRate(e, 8) >= 0.5 && this.baseBreakChance(e) < 0.5 ? 'open' : null;
  }
  updateBreakCue(e) {
    if (!e.aura) return;
    const cue = e.group.visible ? this.breakCue(e) : null;
    if (cue !== e.cue) {
      const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
      if (cue === 'open') {
        G.audio?.playSe(G.seAt('Powerup', 85, 110), at);
        G.input.haptic('left', 0.25, 60); G.input.haptic('right', 0.25, 60);
      } else if (cue === 'locked') G.audio?.playSe(G.seAt('Darkness3', 70, 70), at);
      e.cue = cue;
    }
    const on = !!cue;
    e.aura.visible = on; e.cueRing.visible = on;
    for (const s of e.sparks) s.visible = on && cue === 'open';
    if (!on) return;
    const t = G.time, k = 0.7 + 0.3 * Math.sin(t * 9);
    const b = Math.max(0.6, fxk());            // a gameplay cue: never dimmed away
    const [r, g, bl] = cue === 'open' ? [1, 0.72, 0.18] : [0.85, 0.08, 0.06];
    e.aura.material.color.setRGB(r * b * k, g * b * k, bl * b * k);
    e.aura.scale.set(e.w * 1.9 * (0.94 + 0.12 * k), e.h * 1.45 * (0.94 + 0.12 * k), 1);
    e.cueRing.scale.setScalar((e.hr * T + 0.3) * (0.96 + 0.08 * k));
    e.cueRing.rotation.z = t * (cue === 'open' ? 1.6 : -0.8);
    e.cueRing.material.color.setRGB(r * b, g * b, bl * b);
    if (cue === 'open') {
      e.sparks.forEach((s, i) => {
        const f = (t * 0.7 + i / e.sparks.length) % 1, a = i * 2.4 + t * 1.3;
        s.position.set(Math.cos(a) * e.w * 0.42, f * e.h * 1.1, Math.sin(a) * e.w * 0.21);
        s.material.color.setRGB(b, 0.8 * b, 0.3 * b);
        s.material.opacity = Math.sin(f * Math.PI);
      });
    }
  }
  // an enemy's skill on itself (charging up, guarding, recovering) and the common event its skills call; a state
  // of its own that never wears off stays (귀신 무사's 할복, the marks its patterns count) - the 8 turns are for
  // what the player puts on it
  applySkillToSelf(e, skill) {
    // (one for all its allies - 의욕을 고취시켰다, a boss's war cry: every one of its side in this fight)
    const all = skill.scope === 8 && e.battle ? e.battle.enemies.filter(o => o.alive && !o.hidden) : [e];
    for (const t of all.includes(e) ? all : [e, ...all]) this.applySkillOn(t, skill);
  }
  applySkillOn(e, skill) {
    for (const ef of skill.effects || []) {
      if (ef.code === 21 && ef.data_id > 0) {
        if (!e.b.stateResist(ef.data_id) && Math.random() < ef.value1) this.addEnemyState(e, ef.data_id, true, true);
      } else if (ef.code === 22) {
        e.b.removeState(ef.data_id);
        if (e.stateTimers) delete e.stateTimers[ef.data_id];
        if (e.actionStates) delete e.actionStates[ef.data_id];
      } else if (ef.code === 11) {
        const v = e.b.healAmount(Math.floor(e.b.mhp * ef.value1 + ef.value2));
        if (v) { e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar(); }
        if (v < 0) this.checkEnemyDeath(e);
      } else if (ef.code === 41) this.enemyEscape(e);
    }
    if (this.applyBuffEffects(e.b, skill, ENEMY_TURN)) {
      const p = e.worldPos(new THREE.Vector3());
      this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), { color: 0xff7848, size: e.h * 0.9, life: 0.5, grow: 1.3 });
    }
  }
  // VX Ace's escape (a skill's escape effect: 도망친다 - the rabbits, 암흑 물질, 라스, 교활한 원숭이 low on HP, 하얀
  // 펭귄 -, 묘지기 이그조's 떠난다 while unhurt, the flea's 껑충껑충, and 메이벨's 당신의 승리 as her battle event forces it
  // once her three gods are down): it leaves the fight - it fades away, its states gone, with the game's escape
  // sound. Not beaten: nothing of it at the end (VX Ace's rewards are the fallen's); with none left standing the fight
  // is won (VX Ace: all_dead? counts the ones gone as well)
  enemyEscape(e) {
    if (!e.alive) return;
    this.dropMarker(e);
    e.escaped = true;
    e.b.clearStates(); this.pruneStateTimers(e);
    e.state = 'dying'; e.timer = 0; e.fadeOnly = true;
    if (e.bar) e.bar.visible = false;
    if (e.ring) e.ring.material.opacity = 0;
    G.audio?.playSystemSe(8);
  }
  runSkillCommonEvents(skill) {
    for (const ef of skill?.effects || []) {
      if (ef.code !== 44) continue;
      const list = commonEventList(ef.data_id);
      if (!list) continue;
      const it = new Interpreter(1);
      it.troop = true;
      it.setup(list, 0);
      this.sideInterps.push(it);
    }
  }
  // Script 170 防御状態無視: <防御状態無視率:n> on a skill, <パッシブ防御状態無視率:n> on its user's states, equipment, self
  // (and an actor's own skills) - added up, that % of the time its blow goes through a guard (VX Ace's guard? is
  // false for it): 찌르기, 갑옷 뚫기, 일섬, 짓밟기, 블레이드 워크 ...
  ignoresGuard(user, skill) {
    const rate = (o, key) => {
      if (!o) return 0;
      const k = key === 1 ? '_vgP' : '_vgA';
      if (o[k] === undefined) {
        const m = (key === 1 ? /<パッシブ防御状態無視率[：:]\s*(-?\d+(?:\.\d+)?)\s*>/ : /<防御状態無視率[：:]\s*(-?\d+(?:\.\d+)?)\s*>/).exec(o.note || '');
        o[k] = m ? +m[1] : 0;
      }
      return o[k];
    };
    let pec = rate(skill, 0);
    for (const o of user?.featureObjects?.() || []) pec += rate(o, 1);
    if (user?.allSkills) for (const s of user.allSkills()) pec += rate(s, 1);
    return pec > Math.floor(Math.random() * 100);
  }
  // Script 191 回避時発動スキル: <全回避時スキル:n[,p]> (or 物理- / 魔法- / 必中-, by the attack's hit type) on a battler's
  // states, equipment or self - an attack it slips, it answers with skill n (p % of the time): 흰 유니콘 유니스's
  // 리포스트 (a stance of evasion +100% for two of its actions, every slipped blow answered by a lunge, 판트), and the
  // player's own with 유니스의 자검. The port has no evasion roll of its own (the player dodges), so a battler slips
  // a blow only while it has such an answer: by its evasion (physical) or magic evasion (magical); a sure hit
  // (hit type 0) is never slipped
  evadeAnswers(b, hitType) {
    const out = [];
    for (const o of b?.featureObjects?.() || []) {
      if (!o) continue;
      if (o._evadeSk === undefined) {
        o._evadeSk = [];
        const W = { '必中': 0, '物理': 1, '魔法': 2, '全': 3 };
        for (const m of (o.note || '').matchAll(/<(必中|物理|魔法|全)回避時スキル[：:]\s*(\d+)\s*(?:,\s*(\d+))?\s*>/g)) o._evadeSk.push({ type: W[m[1]], id: +m[2], p: m[3] === undefined ? 100 : +m[3] });
      }
      for (const x of o._evadeSk) if (hitType === undefined || x.type === hitType || x.type === 3) out.push(x);
    }
    return out;
  }
  slipsWithAnswer(b, skill, user = null) {
    const ht = skill?.hit_type ?? 1;
    if (!b || ht === 0 || this.certainHit(user, skill)) return null;
    const answers = this.evadeAnswers(b, ht);
    if (!answers.length) return null;
    return Math.random() < (ht === 1 ? b.eva : b.mev) ? answers : null;
  }
  // (the stance shows while it lasts)
  slipStance(b) { return this.evadeAnswers(b).length > 0 && (b.eva > 0 || b.mev > 0); }
  // an enemy slips a blow (of the player's, or of a companion - by): a quick step aside with its evasion sound and
  // a pale streak, nothing of it lands; then its answer - at once on a companion, a quick lunge at the player
  enemySlips(e, answers, skill, from, by) {
    const p = e.worldPos(new THREE.Vector3());
    const se = $data.system.sounds?.[skill?.hit_type === 2 ? 19 : 18];
    if (se) G.audio?.playSe(se, p);
    const pc = G.map.playerChar, a = Math.atan2(e.fy - pc.fy, e.fx - pc.fx) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    if (!e.stationary) { e.knock.x += Math.cos(a) * 0.55 / T / 3.3; e.knock.y += Math.sin(a) * 0.55 / T / 3.3; }
    this.spawnGlow(p.clone().setY(p.y + e.h * 0.5), { color: 0xe8f0ff, size: 0.9, life: 0.18, grow: 1.6 });
    const ans = answers.find(x => x.p > Math.floor(Math.random() * 100) && $data.skills[x.id] && this.enemyCanUse(e, $data.skills[x.id]));
    if (!ans || this.playerDead) return;
    const s = $data.skills[ans.id];
    const al = by && by !== G.state.party.leader() ? this.allies.list.find(x => x.members().includes(by)) : null;
    if (al) {
      if (G.time < (e.counterReady || 0)) return;
      e.counterReady = G.time + 0.9;
      this.commitSkill(e, s); e.acted = null;
      this.later(200, () => {
        if (!e.alive || !al.alive) return;
        const ap = al.chest(new THREE.Vector3());
        if (s.animation_id > 0) G.screen.playAnimationOn(ap, s.animation_id, { world: true, size: 1.4 });
        al.takeHit(e, s);
      });
      return;
    }
    if (this.startCounter(e, s)) this.commitSkill(e, s);
  }
  // the player slips an enemy's blow (리포스트 of their own): the evasion sound and a light shake in both hands,
  // nothing of it lands; a moment later the answer goes into the one who struck
  playerSlips(e, answers, skill) {
    const actor = G.state.party.leader();
    G.audio?.playSystemSe(skill?.hit_type === 2 ? 19 : 18);
    G.input.haptic('left', 0.25, 40); G.input.haptic('right', 0.25, 40);
    if (!e || G.time - (this.answeredAt ?? -1) < 0.15) return;
    const ans = answers.find(x => x.p > Math.floor(Math.random() * 100) && $data.skills[x.id] && actor.skillCostPayable($data.skills[x.id]) && !actor.skillSealed($data.skills[x.id].id));
    if (!ans) return;
    this.answeredAt = G.time;
    const s = $data.skills[ans.id];
    this.later(150, () => {
      if (this.playerDead || !e.alive || e.hidden) return;
      this.actorPays(actor, s);
      if (s.scope >= 1 && s.scope <= 6) {
        this.applyUsableToEnemy(e, s, this.castOrigin());
        const wp = e.worldPos(new THREE.Vector3()); wp.y += e.h * 0.5;
        if (s.animation_id > 0) G.screen.playAnimationOn(wp, s.animation_id, { rate: 3, height: e.h });
      } else this.applyUsableToActor(s, 'self');
      G.input.haptic('right', 0.7, 70);
    });
  }
  // the timers of states it no longer has go (a state that stays through Recover All or death keeps its own)
  pruneStateTimers(e) {
    for (const t of [e.stateTimers, e.actionStates]) if (t) for (const k of Object.keys(t)) if (!e.b.isState(+k)) delete t[k];
  }
  // after each enemy action: the states that end with its actions and have had their turns run out
  expireActionStates(e) {
    const a = e.actionStates;
    if (!a) return;
    for (const id of Object.keys(a)) {
      if (e.turn - a[id].at < a[id].n) continue;
      e.b.removeState(+id); delete a[id];
      if (e.stateTimers) delete e.stateTimers[id];
    }
    this.checkEnemyDeath(e);
  }
  // Gun Break: the guns in the shield slot seal Break and add their own Gun Break skill
  gunBreakSkill() {
    const a = G.state.party.leader();
    if (!a) return null;
    for (const id of a.featuresSet(43)) {
      const s = $data.skills[id];
      if (s && J.isGunBreak(s) && this.isBreakSkill(s)) return s;
    }
    return null;
  }
  // Break. A shield-slot gun fires its Gun Break the moment the button goes down. Otherwise Break rides on
  // the weapon: a swing (or a shot) that lands while the button is held - or within 3 s of picking a Break
  // skill from the quick slots - tries to break what it hits instead of the plain blow
  pressBreak() {
    if (this.playerDead || this.held?.how === 'rub') return;        // (the left hand holds a resin, not the gun)
    const gun = this.gunBreakSkill();
    if (gun) { if ((this.breakCooldown || 0) <= G.time) this.fireGunBreak(gun); return; }
    G.input.haptic('right', 0.2, 30);
  }
  breakArmed() {
    if ((this.breakCooldown || 0) > G.time || this.playerDead) return null;
    if (this.breakArm) {
      if (this.breakArm.until > G.time) return this.breakArm.skill;
      this.breakArm = null;
    }
    return G.input.breakHeld() && !this.gunBreakSkill() ? $data.skills[13] : null;
  }
  // a Break landing on e: the original command has no damage of its own (only the break, by the skill's
  // rate x the enemy's); Break skills with a blow (weapon / armor / karma break) hit with it too
  breakOnHit(e, skill, src) {
    this.breakArm = null;
    this.breakCooldown = G.time + Math.max(0.9, this.coolSeconds(skill));
    this.useStamina(0.2, 0.8);
    if (this.heldBoss(e)) return;
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(x => x.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const at = this.hitPoint(e, src);
    const ef = (skill.effects || []).find(f => f.code === 21 && (f.data_id === 7 || f.data_id === 8));
    const stateId = ef?.data_id || (skill.id === 16 ? 7 : 8);
    const wasDown = e.state === 'stagger';
    const chance = this.breakRoll(e, stateId, ef?.value1 ?? 1);
    let broke = false;
    if (skill.damage?.type === 1 || skill.damage?.type === 5) {
      this.applyUsableToEnemy(e, skill, src, { knock: 0.12, mult: this.buffMult() });
      broke = !wasDown && e.state === 'stagger';
    } else if (chance > 0 && Math.random() < chance) {
      this.breakEnemy(e, stateId);
      broke = true;
    }
    if (broke) {
      // the original Break animation, a bit faster, where it struck - silent: the one sound of a Break that lands is
      // breakEnemy's (BREAK_SE; its own Wind7 -> Ice11 + Break made it two)
      if (skill.animation_id > 0) G.screen.playAnimationOn(at, skill.animation_id, { rate: 2, world: true, size: this.enemySize(e), mute: true });
      G.input.haptic('right', 1, 160);
    } else G.audio?.playSystemSe(17);
  }
  // while a swing would Break, a gold light sits on the weapon's tip
  showBreakReady(tip) {
    const on = !!this.weapon && !!this.breakArmed();
    if (!this.breakGlow) {
      if (!on) return;
      this.breakGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: 0xffc040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.breakGlow.renderOrder = 1401;
      this.root.add(this.breakGlow);
    }
    this.breakGlow.visible = on;
    if (!on) return;
    if (this.breakGlow.parent !== this.root) this.root.add(this.breakGlow);
    this.breakGlow.position.copy(tip);
    const k = 0.75 + 0.25 * Math.sin(G.time * 12), b = Math.max(0.7, fxk());
    this.breakGlow.scale.setScalar(0.16 * k);
    this.breakGlow.material.color.setRGB(b, 0.75 * b, 0.25 * b);
  }
  // fire the shield-slot gun: its own shot sounds (the skill's animation), muzzle flash, tracer;
  // damage by the skill's formula and Break / Hard Break on an enemy that is winding up or guarding.
  // The shot goes through enemies: everyone on its line is hit, up to a wall or the floor (GUN_BREAK_RANGE);
  // the cannon's shell bursts at each one it goes through and where it stops
  fireGunBreak(skill) {
    this.breakCooldown = G.time + Math.max(0.9, this.coolSeconds(skill));
    this.useStamina(0.2, 0.8);
    const gun = this.offGun;
    let from = null, dir;
    if (gun) {
      gun.updateWorldMatrix(true, true);
      from = new THREE.Vector3(0, 0, -(gun.userData.length || 0.3)).applyMatrix4(gun.matrixWorld);
    }
    // the shot leaves along where the left controller points, however the gun model is turned in the hand
    const ray = this.aimRay('left');
    if (ray) {
      dir = ray.dir;
      if (!from || from.distanceTo(ray.origin) > 0.45) from = ray.origin.clone().addScaledVector(dir, 0.12);
    } else dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    if (!from) from = G.player.headWorld(new THREE.Vector3()).addScaledVector(dir, 0.4);
    // walk the shot: through every enemy on the line, until a wall / the floor
    const range = GUN_BREAK_RANGE, step = 0.15;
    const p = new THREE.Vector3();
    const sx = from.x / T - 0.5, sy = from.z / T - 0.5;
    const targets = this.allTargets();
    const hits = [];                       // { e, at }: in the order the shot reaches them
    let endT = range;
    for (let t = 0; t <= range; t += step) {
      p.copy(from).addScaledVector(dir, t);
      const tx = p.x / T - 0.5, ty = p.z / T - 0.5;
      if (!G.map.validW(Math.round(tx), Math.round(ty)) || p.y < G.floorAt(tx, ty) - 0.05 ||
          (t > 0.6 && !lineOfSight(sx, sy, tx, ty))) { endT = t; break; }
      for (const e of targets) {
        if (hits.some(h => h.e === e)) continue;
        const wp = e.worldPos(tmpA);
        if (Math.hypot(p.x - wp.x, p.z - wp.z) < e.hr * T + 0.22 && p.y > wp.y - 0.1 && p.y < wp.y + e.h + 0.25 && this.partAt(e, p) === e) hits.push({ e, at: p.clone() });
      }
    }
    const end = from.clone().addScaledVector(dir, endT);
    const cannon = skill.scope === 2;
    const first = hits[0]?.e;
    const animAt = first ? first.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, first.h * 0.5, 0)) : end.clone();
    const shot = { from, end, cannon, points: hits.map(h => h.at), anim: skill.animation_id | 0, animAt, height: first?.h || 0 };
    this.gunBreakFx(shot);
    G.coop?.shareGunBreak?.(shot);
    G.input.haptic('left', 1, cannon ? 220 : 120);
    const victims = new Set(hits.map(h => h.e));
    if (cannon) {
      const blasts = hits.map(h => h.at).concat([end]);
      for (const e of this.allTargets()) if (blasts.some(b => e.worldPos(tmpA).distanceTo(b) < 2.6 + e.hr * T)) victims.add(e);
    }
    // the parry (these guns' perfect guard): shot as its blow is about to land on the player
    const parried = [...victims].filter(e => this.gunParryable(e));
    for (const e of victims) this.gunBreakHit(e, skill, from);
    if (parried.length) this.gunParry(parried, hits);
  }
  // what a Gun Break shot looks like: the muzzle's flash, its line (the cannon: none), the skill's animation where it
  // first struck (else where it stopped) and a spark - the cannon's shell: a burst - at each one it went through and where
  // it stopped (the others are shown it too - coop.js shareGunBreak)
  gunBreakFx({ from, end, cannon, points, anim, animAt, height }) {
    this.spawnGlow(from, { color: 0xffd890, size: cannon ? 0.6 : 0.3, life: cannon ? 0.16 : 0.09, grow: 1.8 });
    if (!cannon) this.spawnTracer(from, end);
    if (anim > 0) G.screen.playAnimationOn(animAt, anim, { rate: 1.5, sePos: from, height: height || undefined });
    else G.audio?.playSe(G.seAt('Gun1', 90, 100), from);
    const burst = { color: 0xff9040, size: 1.8, life: 0.45, grow: 2.2 };
    points.forEach((at, i) => { if (cannon || i > 0) this.spawnGlow(at, cannon ? burst : { color: 0xfff0c0, size: 0.3, life: 0.1, grow: 1.6 }); });
    this.spawnGlow(end, cannon ? burst : { color: 0xfff0c0, size: 0.35, life: 0.12, grow: 1.6 });
  }
  // an enemy winding up a blow a guard could stop (not a shot), the player inside its reach, GUN_PARRY s or less
  // before it lands
  gunParryable(e) {
    const plan = e.plan;
    return e.alive && e.state === 'windup' && !!plan && (!!plan.blockable || this.parryable(plan)) && !plan.shot && e.timer <= GUN_PARRY && this.playerInPlan(e, plan);
  }
  // what a perfect guard gives, and the blow never lands: an enemy the shot did not break stops its attack; the
  // perfect guard's high ringing "ting" with golden sparks where the shot struck, both hands
  gunParry(enemies, hits) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead) return;
    this.perfectGuardReward(actor);
    this.breakCooldown = 0;                        // (the next Gun Break is ready at once)
    const head = G.player.headWorld(new THREE.Vector3());
    for (const e of enemies) {
      if (e.alive && e.state === 'windup') { e.state = 'recover'; e.timer = 0.6; e.act = null; e.move = null; e.comboStep = 0; this.dropMarker(e); }
      const at = hits.find(h => h.e === e)?.at || e.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, e.h * 0.6, 0));
      G.audio?.playSe(G.seAt('Parry', 100, 150), at);
      G.audio?.playSe(G.seAt('Reflection', 75, 130), at);
      this.spawnSparks(at, new THREE.Vector3(at.x - head.x, 0, at.z - head.z), 18, 0xffd860);
    }
    G.input.haptic('left', 1, 110); G.input.haptic('right', 0.6, 90);
  }
  gunBreakHit(e, skill, from) {
    if (!e.alive) return;
    if (this.heldBoss(e)) return;
    const actor = G.state.party.leader();
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const bef = skill.effects.find(f => f.code === 21 && (f.data_id === 7 || f.data_id === 8));
    const stateId = bef?.data_id || 8;
    const chance = this.breakRoll(e, stateId, bef?.value1 ?? 1);
    const p = e.worldPos(new THREE.Vector3());
    const dmg = this.computeDamage(actor, e.b, skill, (e.state === 'stagger' ? 1.5 : 1) * this.buffMult());
    if (dmg > 0 || skill.damage?.type === 1) {
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), dmg > 0 ? '#ffe0a0' : '#9a9a9a');
      if (dmg > 0) this.damageRemovesStates(e);
    }
    const away = Math.atan2(p.z - from.z, p.x - from.x);
    e.knock.x += Math.cos(away) * 0.15; e.knock.y += Math.sin(away) * 0.15;
    this.checkEnemyDeath(e);
    if (!e.alive) return;
    if (chance > 0 && Math.random() < chance) {
      this.breakEnemy(e, stateId);
      G.input.haptic('right', 1, 160);
    }
  }
  aimFlat() {
    if (G.vr && this.weapon) {
      this.weapon.updateWorldMatrix(true, false);
      const f = new THREE.Vector3(0, 0, -1).transformDirection(this.weapon.matrixWorld);
      f.y = 0;
      if (f.lengthSq() > 0.05) return f.normalize();
    }
    return G.player.forwardVec();
  }
  weaponLength() { return this.weapon?.userData.length || 1; }

  // ---- NPCs that offer to be killed (BLACK SOULS II's "살해한다" - skilljudge.js, by the event's number and page) can be
  // cut down directly (two hits within 3 s, to avoid accidents)
  hasKillChoice(ev) {
    const page = ev.page && ev.event?.pages ? ev.event.pages.indexOf(ev.page) : -1;
    return page >= 0 && J.pageKills(G.map.mapId, ev.id, page);
  }
}
