// Damage in the fights: blows dealt and taken, guards and parries, and the groggy gauge (the stun the original's weapons give).
import * as THREE from 'three';
import { SHIELD_SOUND } from '../audio.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { evalFormula } from '../rubyexpr.js';
import { MARK } from '../telegraph.js';
import { BREAK_SE, BURST_GAP, GROGGY, GUARD_BUFF, GUARD_COOLDOWN, GUARD_STAMINA, PERFECT_GUARD,
  PERFECT_STAMINA, POWER_BUFF, STUN, TURN_SECONDS } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class DamagePart {
  // ---- damage --------------------------------------------------------------------------
  computeDamage(attacker, target, skill, mult = 1) {
    if (!skill?.damage || skill.damage.type === 0) return 0;
    let v = evalFormula(skill.damage.formula, attacker.solo ? attacker.solo() : attacker, target);
    // element
    const el = skill.damage.element_id;
    if (el > 0) v *= target.elementRate(el);
    else if (el < 0) {
      const els = attacker.atkElements();
      if (els.length) v *= Math.max(...els.map(e => target.elementRate(e)));
    }
    if (skill.hit_type === 1) v *= target.pdr;
    if (skill.hit_type === 2) v *= target.mdr;
    const variance = skill.damage.variance || 0;
    const amp = Math.floor(Math.max(Math.abs(v) * variance / 100, 0));
    v += Math.floor(Math.random() * (amp + 1)) + Math.floor(Math.random() * (amp + 1)) - amp;
    v = Math.round(v * mult);
    return Math.max(0, v);
  }
  // 攻撃ID変更 (script 203): equipment / states can swap the normal attack (skill 1) for their own skill;
  // with several, the highest <攻撃ID優先度変更:n> on the skill wins, then the highest id
  playerAttackSkill(actor = G.state.party.leader()) {
    if (!actor) return $data.skills[1];
    const ids = [];
    for (const o of actor.featureObjects()) {
      if (o._atkId === undefined) { const m = /<攻撃ID変更[：:]\s*(\d+)\s*>/.exec(o.note || ''); o._atkId = m ? +m[1] : 0; }
      if (o._atkId && $data.skills[o._atkId]) ids.push(o._atkId);
    }
    if (!ids.length) return $data.skills[1];
    const prio = id => {
      const s = $data.skills[id];
      if (s._atkPrio === undefined) { const m = /<攻撃ID優先度変更[：:]\s*(-?\d+)\s*>/.exec(s.note || ''); s._atkPrio = m ? +m[1] : 0; }
      return s._atkPrio;
    };
    const uniq = [...new Set(ids)].sort((a, b) => a - b);
    const top = Math.max(...uniq.map(prio));
    return $data.skills[uniq.filter(id => prio(id) === top).pop()] || $data.skills[1];
  }
  // hits per blow: the skill's repeats (+ attack-count features) times its random-target count
  attackHits(skill, actor) {
    const n = (skill.repeats || 1) + Math.max(0, Math.round(actor?.featuresSum(34) || 0));
    return THREE.MathUtils.clamp(n * ({ 3: 1, 4: 2, 5: 3, 6: 4 }[skill.scope] || 1), 1, 6);
  }
  // a weapon blow (VR swing, desktop click, arrow / bullet): the attack skill's formula, element, hits,
  // drain and states (Raiden's axes hit by the wielder's HP, the youtou drains, daggers hit twice...)
  // opts.melee: a swing (counts toward flailing); opts.strong: swung very hard; opts.charge: how charged (0-1); opts.one:
  // one hit of the blow's (a bullet of a burst - fireRanged)
  playerHitEnemy(e, power, crit, sourcePos, { melee = false, strong = false, charge = 0, one = false } = {}) {
    const actor = G.state.party.leader();
    // a weapon art on the weapon (red): this blow is that skill - its formula, hits, element and animation -
    // at least at full strength
    const art = this.takeArmedSkill(actor);
    const skill = art || this.skillByState(actor, this.playerAttackSkill(actor));
    let mult = (art ? Math.max(1, power) : power) * this.buffMult();
    // a charged blow hits up to twice as hard; a hard or charged blow on a broken enemy is the big attack
    // the Break opened: twice again, and the opening is over
    const heavy = charge >= 0.35;
    if (heavy) mult *= 1 + charge;
    const big = e.state === 'stagger' && (strong || heavy);
    if (big) mult *= 2;
    // (blow after blow, each one at full strength: stamina and the weapon's pace hold the pace now - the falloff of the third
    // and later swings within 1.5 s, from before there were either, is gone)
    if (e.state === 'idle' || (e.alertTime > 0 && e.state === 'chase' && !e.battle)) mult *= 2;     // (a backstab)
    if (e.state === 'guard' && !this.ignoresGuard(actor, skill)) mult *= 0.3;
    if (skill.damage?.critical === false) crit = false;
    if (crit) mult *= 2;
    const p = e.worldPos(new THREE.Vector3());
    const hits = one ? 1 : this.attackHits(skill, actor);
    const blow = {};                                     // (its hits are one attack for the groggy gauge)
    if (this.applyUsableToEnemy(e, skill, sourcePos, { mult, crit, knock: 0.12 * power * (heavy ? 2 : 1) * (big ? 1.6 : 1), color: big ? '#ffb030' : null, blow }) < 0) {
      this.afterPlayerAction(skill, e, sourcePos, !!art);                // (slipped: nothing of the blow lands)
      return;
    }
    for (let i = 1; i < hits; i++) this.later(i * 120, () => { if (e.alive) this.applyUsableToEnemy(e, skill, sourcePos, { mult, knock: 0.04, blow }); });
    if (skill.scope === 2) {
      // an "all enemies" attack (the giant iron ball): the blow reaches everyone around the one struck
      const op = new THREE.Vector3();
      for (const o of this.allTargets()) {
        if (o === e || o.worldPos(op).distanceTo(p) > 2.6 + o.hr * T) continue;
        this.applyUsableToEnemy(o, skill, p, { mult: power, knock: 0.1, blow });
      }
    }
    // the attack's own animation (a plain attack uses the weapon's) brings its sounds; otherwise a slash.
    // It plays where the weapon met the enemy, as big as the enemy
    const anim = skill.animation_id < 0 ? (actor?.weapons()[0]?.animation_id || 0) : skill.animation_id;
    const at = this.hitPoint(e, sourcePos);
    if (anim > 0) G.screen.playAnimationOn(at, anim, { rate: 2, attack: skill.id === 1, world: true, size: this.enemySize(e) * (big ? 1.6 : heavy ? 1.3 : 1) });
    else G.audio?.playSe(G.seAt(crit ? 'Slash11' : 'Slash1', 90, 90 + Math.random() * 20), at);
    G.audio?.playSystemSe(10);
    const way = new THREE.Vector3(p.x - (sourcePos?.x ?? p.x), 0, p.z - (sourcePos?.z ?? p.z));
    if (big) {
      // the big attack: a heavy crunch, a long shake in the hand, gold sparks; the enemy gets up
      G.audio?.playSe(G.seAt('Blow8', 100, 75), at);
      G.audio?.playSe(G.seAt('Explosion1', 55, 140), at);
      G.input.haptic('right', 1, 260); G.input.haptic('left', 0.6, 160);
      this.spawnSparks(at, way.lengthSq() > 1e-4 ? way : new THREE.Vector3(0, 0, 1), 16, 0xffc070);
      this.endStagger(e);
    } else if (heavy) {
      G.audio?.playSe(G.seAt('Blow3', 95, 85), at);
      G.input.haptic('right', 1, 160);
    }
    this.afterPlayerAction(skill, e, sourcePos, !!art);
    if (melee) this.maybeCounter(e, skill);
  }
  // after a blow of mine (once a swing, however many it met): what the attack leaves on me (script 113 - 쌍검's stacks,
  // 쉴드 뱅커's guard; an art's came as it was paid for) and the skill it goes on with (script 189)
  afterPlayerAction(s, e, from, art) {
    if (this.lastAct?.s === s && G.time - this.lastAct.t < 0.12) return;
    this.lastAct = { s, t: G.time };
    if (!art) this.actorUserEffect(s);
    this.playerFollowUp(s, e, from);
  }
  // a skill of mine that goes on with another (script 189 使用後追加行動 - 거룩한 총검's cut or thrust and then its gun
  // break, 글라키의 묵시록 and its thorns, 사자선풍 or 잭 슈트룸 again half the time): that one comes by itself a moment
  // later, on the same enemy (else the nearest; all around for an "all" skill), or on me - as many hits as it has (풀
  // 버스트's 7); a shot from the gun in the right hand when there is one (거룩한 총검), else from the left
  playerFollowUp(s, e, from, depth = 0) {
    const actor = G.state.party.leader();
    if (!s || !actor || depth > 8) return;
    for (const a of this.afterActions(s)) {
      if (a.p < Math.floor(Math.random() * 100)) continue;
      const next = a.id > 0 ? this.skillByState(actor, $data.skills[a.id]) : null;
      if (!next) continue;
      this.later(320, () => {
        if (this.playerDead || !actor.skillCostPayable(next) || actor.skillSealed(next.id) || this.skillCooling(next) > 0) return;
        let targets = [];
        if (next.scope >= 1 && next.scope <= 6) {
          const head = G.player.headWorld(new THREE.Vector3()), op = new THREE.Vector3();
          const near = this.allTargets().map(o => ({ o, d: o.worldPos(op).distanceTo(head) - o.hr * T })).filter(x => x.d < 8).sort((x, y) => x.d - y.d).map(x => x.o);
          targets = next.scope === 2 ? near : e?.alive && !e.hidden ? [e] : near.slice(0, 1);
          if (!targets.length) return;
        }
        this.actorPays(actor, next);
        this.skillCD[next.id] = G.time + this.coolSeconds(next);
        const at = from || this.castOrigin();
        const gun = this.skillLook(next) === 'gun', reps = THREE.MathUtils.clamp(next.repeats || 1, 1, 8);
        for (const t of targets) {
          const wp = t.worldPos(new THREE.Vector3()); wp.y += t.h * 0.5;
          if (next.animation_id > 0) { G.screen.playAnimationOn(wp, next.animation_id, { rate: 3, height: t.h }); G.coop?.shareAnim?.(wp, next.animation_id, t.h); }
          for (let r = 0; r < reps; r++) this.later(r * BURST_GAP * 1000, () => {
            if (!t.alive) return;
            this.applyUsableToEnemy(t, next, at);
            if (!gun) return;
            const f = this.shotKind === 'gun' && this.weapon && !this.disarmed ? this.muzzle() : this.castOrigin();
            this.spawnTracer(f, wp, 0xfff0c0);
            G.coop?.shareLine?.(f, wp, 0xfff0c0);
          });
        }
        if (!targets.length) this.applyUsableToActor(next, 'self');
        this.actorUserEffect(next);
        this.playerFollowUp(next, targets[0] || e, from, depth + 1);
      });
      return;
    }
  }
  // 반격 (script 173 攻撃を受けてから反撃): an enemy in a counter stance (CNT - 반격 자세, 잔심, 화내기...) answers a
  // physical blow at once - after taking it - with its counter skill (<反撃スキル n> on its states or itself, the
  // highest; else its attack): a quick blow at the player, laid down and gone in a moment
  maybeCounter(e, skill) {
    if (!e.alive || !e.battle || e.hidden || this.playerDead || !skill) return;
    if (/<反撃不可>/.test(skill.note || '') || (skill.hit_type !== 1 && !/<反撃可能>/.test(skill.note || ''))) return;
    if (e.state === 'stagger' || e.state === 'windup' || e.state === 'act' || e.state === 'dying' || this.enemyRestricted(e)) return;
    if (G.time < (e.counterReady || 0) || !(e.b.cnt > 0) || Math.random() >= e.b.cnt) return;
    let id = 0;
    for (const o of e.b.featureObjects()) { const m = /<\s*反撃スキル\s*(\d+)\s*>/.exec(o?.note || ''); if (m) id = Math.max(id, +m[1]); }
    this.startCounter(e, $data.skills[id] || $data.skills[1]);
  }
  // a counter (反撃) or an answer to a slipped blow (回避時スキル): a quick blow at the player, 0.35 s to see it
  // coming; not a turn of the enemy's own (as in the original, it comes inside the player's action)
  startCounter(e, s) {
    if (e.puppet) return false;                    // (the host's enemy: what it does is the host's to decide)
    if (!e.alive || e.hidden || this.playerDead || e.state === 'stagger' || e.state === 'windup' || e.state === 'act' || e.state === 'dying' || this.enemyRestricted(e)) return false;
    if (G.time < (e.counterReady || 0)) return false;
    e.counterReady = G.time + 0.9;
    e.move = null; e.act = null; e.comboStep = 0; e.pending = null;
    e.skill = s; e.style = this.skillStyle(s);
    if (!['melee', 'area', 'projectile', 'debuff'].includes(e.style)) e.style = 'melee';
    const pc = G.map.playerChar;
    e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);
    e.state = 'windup'; e.timer0 = e.timer = 0.35; e.countering = true;
    this.beginTelegraph(e);
    e.timer0 = e.timer = 0.35;                       // (no beat: a counter comes at once)
    if (e.plan) e.plan.t0 = e.timer0;
    G.audio?.playSe(G.seAt('Sword4', 90, 120), e.worldPos(new THREE.Vector3()));
    return true;
  }
  // after a perfect guard: stronger blows for a few seconds
  buffMult() { return (this.powerUntil || 0) > G.time ? POWER_BUFF.mult : 1; }
  // after a perfect guard: DEF and MDF two buff levels up while it lasts (only while a blow's damage is worked
  // out - the actor's own buffs are left as they were)
  withGuardBuff(actor, fn) {
    if (!((this.guardUntil || 0) > G.time) || !actor?.buffs) return fn();
    const b = actor.buffs, def = b[3], mdf = b[5];
    b[3] = Math.max(def, GUARD_BUFF.level); b[5] = Math.max(mdf, GUARD_BUFF.level);
    try { return fn(); } finally { b[3] = def; b[5] = mdf; }
  }
  // an enemy's own counter rate (CNT, its features - not what its states give it)
  ownCounter(e) {
    if (e.ownCnt === undefined || e.ownCntOf !== e.b.enemyId) {
      e.ownCntOf = e.b.enemyId;
      e.ownCnt = ($data.enemies[e.b.enemyId]?.features || []).filter(f => f.code === 22 && f.data_id === 6).reduce((s, f) => s + f.value, 0);
    }
    return e.ownCnt;
  }
  // the opening a Break made is over (the big attack used it)
  endStagger(e) {
    if (e.state !== 'stagger') return;
    e.b.removeState(8); e.b.removeState(7);
    e.state = 'recover'; e.timer = 0.6;
    this.groggyRefill(e);
    e.drawBar();
  }
  // ---- the groggy gauge (GROGGY) -------------------------------------------------------------------------------
  // how big it is (0: none - it cannot be stunned); worked out again when the enemy changes into another
  groggyMax(e) {
    const id = e.b?.enemyId;
    if (e.grogId === id) return e.grogMax;
    const d = e.b?.data, f = d?.features || [];
    const s = f.some(x => x.code === 14 && x.data_id === STUN) ? 0 : f.filter(x => x.code === 13 && x.data_id === STUN).reduce((r, x) => r * x.value, 1);
    let max = 0;
    if (d && s > 0) {
      const avg = (e.b.paramBase(2) + e.b.paramBase(3) + e.b.paramBase(5)) / 3, k = e.b.coopK || 1;
      const big = THREE.MathUtils.clamp(Math.pow(e.b.paramBase(0) / k / 1000, 0.25), 0.5, 8);
      max = Math.max(1, Math.round(GROGGY.k * avg * big / Math.sqrt(s) * k));       // (a co-op boss: as many times more)
    }
    const frac = e.grogMax ? THREE.MathUtils.clamp(e.grog / e.grogMax, 0, 1) : 1;
    e.grogId = id; e.grogMax = max; e.grog = max * frac;
    if (!max) e.grogDown = false;
    return max;
  }
  // a blow that carries the attacker's weapon states takes groggy away (blow: one attack - its hits, and the enemies an
  // "all" blow reaches, each share one cap)
  groggyHit(e, actor, obj, mult, blow) {
    const max = this.groggyMax(e);
    if (!max || !actor || !e.alive || e.state === 'stagger' || e.grogDown || this.inDuel(e)) return;     // (her duel: no groggy)
    const stun = THREE.MathUtils.clamp(actor.featuresSum(32, STUN), 0, 1);
    let g = (obj?.hit_type === 2 ? actor.mat : actor.atk) * (1 + GROGGY.stun * stun) * Math.max(0, mult);
    const used = blow?.grog?.get(e) || 0;
    g = Math.min(g, GROGGY.cap * max - used);
    if (!(g > 0)) return;
    if (blow) (blow.grog ||= new Map()).set(e, used + g);
    e.grog = Math.max(0, e.grog - g);
    e.grogT = G.time;
    if (e.grog <= 0) e.grogDown = true;
    e.drawBar();
  }
  groggyRefill(e) {
    if (!this.groggyMax(e)) return;
    e.grog = e.grogMax; e.grogDown = false;
  }
  // it fills again a little at a time once the blows stop; emptied, the enemy is broken as soon as it can be - not in
  // the middle of a big attack nothing breaks (the red ring), then right after it
  tickGroggy(e, dt) {
    if (!this.groggyMax(e)) return;
    // (흑기사 린다메아's duel - inDuel: she is never stunned in it; her gauge stays full)
    if (this.inDuel(e)) { if (e.grogDown || e.grog < e.grogMax) { this.groggyRefill(e); e.drawBar(); } return; }
    if (e.grogDown) {
      if (e.state === 'stagger' || e.state === 'dying' || e.hidden || this.breakCue(e) === 'locked') return;
      e.grogDown = false;
      const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
      this.breakEnemy(e, 8);
      // (as a Break that lands: its animation - silent, the sound is breakEnemy's - and the hand shakes)
      const brk = $data.skills[13];
      if (brk?.animation_id > 0) G.screen.playAnimationOn(at, brk.animation_id, { rate: 2, world: true, size: this.enemySize(e), mute: true });
      G.input.haptic('right', 1, 160);
      return;
    }
    if (e.state === 'stagger' || e.grog >= e.grogMax || G.time - (e.grogT || 0) < GROGGY.delay) return;
    const px = Math.round(e.grog / e.grogMax * 124);
    e.grog = Math.min(e.grogMax, e.grog + GROGGY.regen * e.grogMax * dt);
    if (Math.round(e.grog / e.grogMax * 124) !== px) e.drawBar();
  }
  // where a blow meets an enemy: on its side toward where the blow came from, at the blow's height
  hitPoint(e, src) {
    const p = e.worldPos(new THREE.Vector3());
    p.y += e.hover || 0;
    const from = src || G.player.headWorld(new THREE.Vector3());
    const dx = from.x - p.x, dz = from.z - p.z, d = Math.hypot(dx, dz) || 1;
    const r = e.hr * T * 0.8;
    const y = THREE.MathUtils.clamp(src ? src.y : p.y + e.h * 0.5, p.y + e.h * 0.15, p.y + e.h * 0.95);
    return new THREE.Vector3(p.x + dx / d * r, y, p.z + dz / d * r);
  }
  enemySize(e) { return THREE.MathUtils.clamp(Math.max(e.h, e.w || 0) * 1.1, 0.9, 3.5); }
  reviveEnemy(e) {
    if (!this.enemies.includes(e)) this.enemies.push(e);
    if (!e.group.parent) { e.group = new THREE.Group(); this.root.add(e.group); e.ready = e.build(); }
    e.state = 'recover'; e.timer = 0.8; e.fadeOnly = false; e.alertTime = 0.4;
    e.group.visible = true;
    if (e.mat) { e.mat.opacity = 1; e.mat.color.setRGB(1, 1, 1); }
    if (e.mesh) e.mesh.position.y = 0;
    if (e.bar) e.bar.visible = true;
  }
  breakEnemy(e, stateId = 8) {
    if (this.inDuel(e)) return;                       // (흑기사 린다메아's duel: nothing breaks her in it - inDuel)
    this.dropMarker(e);
    e.state = 'stagger'; e.timer = stateId === 7 ? 3.2 : 2.2;
    const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
    G.audio?.playSe(BREAK_SE, at);
    if (e.ring) e.ring.material.opacity = 0;          // (its body can still be loading)
    // (its bar turns yellow while it is broken - shown now, even before any blow of the player's has landed on it: a
    // Break does no harm of itself)
    if (e.bar) e.bar.visible = true;
    e.drawBar();
    e.b.addState(stateId);
    // being unable to act ends charging and guarding (states removed by restriction)
    for (const id of [...e.b.states]) {
      if (!$data.states[id]?.remove_by_restriction) continue;
      e.b.removeState(id);
      if (e.stateTimers) delete e.stateTimers[id];
      if (e.actionStates) delete e.actionStates[id];
    }
  }
  killEnemy(e) {
    if (e.state === 'dying' || e.state === 'dead') return;
    this.dropMarker(e);
    e.state = 'dying'; e.timer = 0;
    if (e.bar) e.bar.visible = false;               // (its body can still be loading)
    if (e.ring) e.ring.material.opacity = 0;
    // as VX Ace's die: its other states go (a fallen 거울의 그림자 is no longer broken - 반상의 고왕's count of its
    // broken shadows counted it again every turn, and the king fell after three of six)
    e.b.die(); this.pruneStateTimers(e);
    const big = e.b.solo().mhp >= 3000;
    G.audio?.playSystemSe(big ? 12 : 11);
    if (!e.battle) {
      // killed while dormant (one-shot) -> start its event so the win branch runs
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
  }
  // (a co-op guest: the host's enemies' moves, played out here, strike it here - each player judges the blows on
  // itself by what it sees; the host is told how it went, to show it - reportStruck)
  // (shot: the enemy's shot that struck - a spell turned back turns it round: reflectOntoEnemy)
  enemyStrikePlayer(e, skill, { blockable = true, kind = 'melee', certain = false, shieldHit = false, mult = 1, delayed = false, parry = false, dodged = false, shot = null } = {}) {
    if (this.playerDead || this.outOfFight(e)) return;    // (co-op: a boss fight this player is out of - never its)
    if (!delayed && G.player.aloft?.()) return;              // (blown up into the sky by the wind: out of reach - liftInfo)
    const actor = G.state.party.leader();
    const head = G.player.headWorld(new THREE.Vector3());
    const ep = e ? e.worldPos(new THREE.Vector3()) : head.clone();
    // slipped past it in the dodge (dodged: while a wave went over - passOver): the game's own evasion sound, no words
    if ((G.player.invuln > 0 || dodged) && !certain) {
      G.audio?.playSystemSe(18);
      G.input.haptic('left', 0.2, 30); G.input.haptic('right', 0.2, 30);
      return;
    }
    // what the player always evades (script 220)
    if (e && skill && !this.certainHit(e.b, skill) && actor.certainty(1, skill.hit_type ?? 1)) { G.audio?.playSystemSe(18); return; }
    // a spell turned back (magic reflection - mirrorRates): what always reflects (겨울 마도사의 코트, 당밀의 반지, a
    // reflecting state) wherever the spell meets the player; the shield's own (거울의 대방패) only when the shield stops
    // it - a shot that meets it, a blow its guard holds, one only a perfect guard stops met just so - with the guard's
    // cost or a perfect guard's reward (the user's wish: it reflected whether guarded or not). It flies back to its
    // caster (reflectOntoEnemy)
    const mirror = e && skill?.hit_type === 2 ? this.mirrorRates(actor) : null;
    if (mirror && mirror.always > Math.random()) { this.reflectOntoEnemy(e, skill, { shot }); return; }
    if (mirror?.shield > 0) {
      const guarded = shieldHit || ((blockable || parry) && this.isBlocking(ep));
      const perfect = guarded && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD;
      if ((perfect || (guarded && (shieldHit || blockable))) && mirror.shield > Math.random()) {
        if (perfect) { this.perfectGuardReward(actor); this.guardFree = true; } else this.useStamina(GUARD_STAMINA, 1);
        this.guardTing(ep, perfect);
        this.reportStruck(e, perfect ? 2 : 1);
        this.reflectOntoEnemy(e, skill, { shot, shield: true });
        return;
      }
    }
    // slipped in a stance that answers it (the player's own 리포스트, script 191): nothing lands, it is answered
    const slip = e && this.slipsWithAnswer(actor, skill, e.b);
    if (slip) { this.playerSlips(e, slip, skill); return; }
    if (!delayed && e && skill && !e.puppet) this.scheduleDelayed(e, skill);
    // near death, a companion who stands in for others (身代わり) takes a blow that is not a sure hit, as the
    // original's substitute does
    if (!certain && actor.hp < actor.mhp / 4) {
      const sub = this.allies.substitute();
      if (sub) { sub.takeHit(e, skill); return; }
    }
    let dmg = this.withGuardBuff(actor, () => this.computeDamage(e ? e.b : actor, actor, skill, mult));
    dmg = Math.round(dmg * G.settings.difficulty);
    // a share of the HP / MP the skill takes away besides (HP / MP recovery with a minus - 조커 -100%, 하얀 충격
    // -99%, 황산 -25%, 톱니바퀴 MP -8%: VX Ace's item_effect_recover_hp, by the target's recovery rate); no guard
    // lessens it, a perfect guard still stops it
    let share = 0, mpShare = 0;
    for (const ef of skill?.effects || []) {
      if (ef.code === 11 && (ef.value1 < 0 || ef.value2 < 0)) share += -(actor.mhp * ef.value1 + ef.value2) * actor.rec;
      if (ef.code === 12 && (ef.value1 < 0 || ef.value2 < 0)) mpShare += -(actor.mmp * ef.value1 + ef.value2) * actor.rec;
    }
    share = Math.floor(share * G.settings.difficulty * mult);
    let blocked = false, perfect = false;
    // (parry: a blow no plain guard stops - a heavy one, or one through a guard - which a perfect guard still does)
    const guarded = shieldHit || ((blockable || parry) && this.isBlocking(ep));
    if (guarded && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD) {
      // a perfect guard (raised just before it landed): nothing gets through, a fifth of the HP comes back,
      // and for a few seconds blows hit harder and DEF / MDF are up
      blocked = true; dmg = 0; perfect = true;
      this.perfectGuardReward(actor);
      this.guardFree = true;                     // (no cool-down after it: lowered, it may come up again at once)
      this.guardTing(ep, true);
      this.reportStruck(e, 2);
    } else if (guarded && (shieldHit || blockable)) {
      blocked = true;
      dmg = Math.round(dmg * (this.hasShield ? 0.25 : 0.5) / Math.max(0.5, actor.grd));      // (방어 효과율)
      this.useStamina(GUARD_STAMINA, 1);
      this.guardTing(ep);
      this.reportStruck(e, 1);
    } else {
      // a blow that lands is felt even when it does no damage: the edges of the view flush red, both hands
      // shake (and the view, if 피격 흔들림 is on), the game's own hurt sound
      G.screen.hurtFlash(1);
      G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 1);
      G.input.haptic('left', 1, 120); G.input.haptic('right', 1, 120);
      G.audio?.playSystemSe(14);
      this.reportStruck(e, 0);
    }
    if (perfect) return;                              // (nothing got through)
    dmg += share;
    if (mpShare > 0) actor.mp = Math.max(0, actor.mp - Math.floor(mpShare * G.settings.difficulty));
    if (dmg > 0) {
      if (blocked) G.screen.hurtFlash(0.3);            // some of it still got through the guard
      if (e && this.skillLook(skill) === 'drain') this.drainStream(e, head, skill);
      actor.hp = Math.max(0, actor.hp - dmg);
      this.damageRemovesActorStates(actor);
    }
    // the rest of it lands with no damage too (a sleep spell, a curse - the states only came with damage before)
    for (const ef of skill?.effects || []) {
      if (ef.code !== 21 || ef.data_id <= 1 || actor.stateResist(ef.data_id)) continue;
      // (blown up by the wind: always, as in the original, and up into the sky it goes - bossmoves.js liftInfo)
      const lift = !delayed && this.liftInfo().states.has(ef.data_id);
      if (lift || Math.random() < ef.value1 * 0.6 * actor.stateRate(ef.data_id)) {
        actor.addState(ef.data_id); this.timeActorState(ef.data_id);
        if (lift) this.liftPlayer(e);
      }
    }
    this.applyBuffEffects(actor, skill, TURN_SECONDS, 0.6);
    if (actor.hp <= 0) this.playerFalls(e?.battle);
  }
  // the player's magic reflection (MRF), VX Ace's sum of it split in two: the share of the shield in the hand (거울의
  // 대방패 50% - only when that shield stops the spell) and the rest, always (겨울 마도사의 코트 15%, 당밀의 반지 10%, a
  // reflecting state). What takes reflection away (fallen, broken: -100%) takes the shield's share too
  mirrorRates(actor) {
    const all = actor.mrf;
    const held = this.hasShield ? actor.armors().find(a => a && a.etype_id === 1) : null;
    const own = (held?.features || []).reduce((s, f) => s + (f.code === 22 && f.data_id === 5 ? f.value : 0), 0);
    return { always: all - own, shield: Math.max(0, Math.min(own, all)) };
  }
  // (a co-op guest struck by the host's enemy: how it went - 0 it landed, 1 guarded, 2 a perfect guard - is shown on
  // this player as the host sees it)
  reportStruck(e, how) { if (e?.puppet) G.coop?.onStruck?.(e, how); }
  // the blows only a perfect guard (or a perfect Gun Break) stops: the pink ones - heavy, or through a guard - and the
  // crimson ones, but a grab, which no guard stops at all: out of its band, or through it in a dodge
  parryable(plan) { return !!plan && plan.move !== 'grab' && !!(plan.heavy || plan.pierce || this.noPlainGuard(plan)); }
  // what no plain guard stops - a bottle thrown onto where the player stands, a death spell's circle, a lance, a spell's
  // circle at the player's feet, lines / blasts / rings / waves / pools laid round them, the chessboard: a perfect guard
  // stops it. (A sure hit among them was purple, as one a plain guard stops; the others were orange - the colour of a blow
  // that is guarded or dodged - and no guard did anything: 그랑・기뇰's waves, 리펀 대성당's circles at the feet)
  noPlainGuard(plan) { return !!plan && !plan.blockable && !plan.shot; }
  // no plain guard stops it, a perfect one does - heavy, through a guard, or such a blow: pink on the floor (a sure hit
  // among them: crimson - markLook); its border blinks, a low warning sounds
  unguardable(plan) { return !!plan && !!(plan.heavy || plan.pierce || this.noPlainGuard(plan)); }
  // how a mark looks: orange; pink = no plain guard; purple = a sure hit (no dodging through it) a plain guard
  // stops; crimson = a sure hit no plain guard stops either
  markLook(plan) {
    const noGuard = this.unguardable(plan), certain = !!plan?.certain;
    return { color: certain && noGuard ? MARK.certainHeavy : noGuard ? MARK.heavy : certain ? MARK.certain : MARK.enemy };
  }
  // whether a blow landing now from ep would meet a perfect guard (the shield up toward it, raised just now)
  parryNow(ep) { return this.isBlocking(ep) && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD; }
  // a perfect guard's reward: a fifth of the HP back, then for a few seconds stronger blows and DEF / MDF up
  perfectGuardReward(actor) {
    this.powerUntil = this.guardUntil = G.time + POWER_BUFF.time;
    this.stamina = Math.min(1, this.stamina + PERFECT_STAMINA);
    if (actor.hp > 0) actor.hp = Math.min(actor.mhp, actor.hp + Math.round(actor.mhp * GUARD_BUFF.heal));
  }
  // a grab winding up: dark red motes drawn in along its band, from its far end to the one reaching out - a
  // pull before anything is caught
  grabMotes(e, plan) {
    if (G.time < (e.grabMoteAt || 0)) return;
    e.grabMoteAt = G.time + 0.07;
    const ux = Math.cos(plan.aim), uz = Math.sin(plan.aim), wx = -uz, wz = ux;
    const hand = new THREE.Vector3(plan.ox + ux * (e.r * T * 0.6), plan.oy + Math.min(1.3, e.h * 0.55), plan.oz + uz * (e.r * T * 0.6));
    for (let i = 0; i < 2; i++) {
      const k = 0.35 + Math.random() * 0.65, side = (Math.random() - 0.5) * (plan.width || 1.5);
      const x = plan.ox + ux * plan.len * k + wx * side, z = plan.oz + uz * plan.len * k + wz * side;
      const at = new THREE.Vector3(x, G.floorAt(x / T - 0.5, z / T - 0.5) + 0.2 + Math.random() * 1.2, z);
      this.spawnGlow(at, { color: Math.random() < 0.6 ? 0xff1a40 : 0x9a2cff, size: 0.16 + Math.random() * 0.1, life: 0.45 + 0.25 * k, grow: 0.5, arc: { from: at, to: hand, h: 0.15 + Math.random() * 0.25, trail: 0x8a1030 } });
    }
  }
  // a drain: what it took flows from the player back into the one who drew it
  drainStream(e, head, skill) {
    const to = e.worldPos(new THREE.Vector3()); to.y += e.h * 0.55;
    const from = head.clone(); from.y -= 0.35;
    const c = this.skillFlavor(skill) || 0xff5fd0;
    for (let i = 0; i < 9; i++) {
      const at = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5));
      this.later(i * 45, () => this.spawnGlow(at, { color: c, size: 0.12, life: 0.5, grow: 0.6, arc: { from: at, to, h: 0.5 + Math.random() * 0.4 } }));
    }
  }
  // a guard that holds: a bright metal "ting" where the blow met the shield (or the weapon held up), a
  // spray of sparks flying off it and a knock in that hand - no words
  // (perfect: a higher, ringing "ting" with a shimmer, more and golden sparks, both hands)
  guardTing(fromPos, perfect = false) {
    const at = new THREE.Vector3();
    const left = !!(this.shield && this.hasShield);
    const piece = left ? this.shield : this.weapon;
    if (G.vr && piece) piece.getWorldPosition(at);
    else { G.player.headWorld(at).addScaledVector(G.player.forwardVec(), 0.55); at.y -= 0.3; }
    G.audio?.playSe(G.seAt('Parry', 100, perfect ? 150 : 116 + Math.random() * 14), at);
    if (perfect) G.audio?.playSe(G.seAt('Reflection', 75, 130), at);
    const blow = new THREE.Vector3(at.x - fromPos.x, 0, at.z - fromPos.z);
    if (blow.lengthSq() < 1e-4) blow.copy(G.player.forwardVec()).negate();
    this.spawnSparks(at, blow, perfect ? 18 : 10, perfect ? 0xffd860 : 0xfff0c0);
    G.input.haptic(left ? 'left' : 'right', perfect ? 1 : 0.9, perfect ? 110 : 80);
    if (perfect) G.input.haptic(left ? 'right' : 'left', 0.6, 90);
  }
  // the guard (the block button, held): up while it is held, a shield coming up with a clank. Once lowered it comes
  // up again only GUARD_COOLDOWN s later (at once after a perfect guard: guardFree) - held through that, it comes up
  // then, but not as a perfect guard's moment (guardRaisedAt: when a press raised it). A shield-slot gun with Gun
  // Break cannot guard (its parry: fireGunBreak). PC: never with the hands busy otherwise (handsBusy) - held through
  // that, it comes up after it the same way
  updateGuard() {
    const held = G.input.block() && !this.playerDead && !this.gripAdjust && !this.disarmed && !this.restrained && !this.noGuard();
    const want = held && !this.handsBusy() && !this.staggered();      // (staggered - PvP: nor then; held, it comes up after)
    if (want && !this.guardUp && G.time >= (this.guardDownAt ?? -99) + GUARD_COOLDOWN) {
      this.guardUp = true;
      if (!this.guardWanted) this.guardRaisedAt = G.time;
      if (this.hasShield && this.shieldOut) {
        const at = new THREE.Vector3();
        if (G.vr) this.shield.getWorldPosition(at);
        else G.player.headWorld(at).addScaledVector(G.player.forwardVec(), 0.45);
        this.playShieldSound(at);
      }
    } else if (!want && this.guardUp) { this.guardUp = false; this.guardDownAt = this.guardFree ? -99 : G.time; this.guardFree = false; }
    this.guardWanted = held;
  }
  // (PC) the hands busy with something else - a blow being charged or swung, a shot, a cast or a throw just let go, a
  // spell or a throwable held ready, a drink: no guard meanwhile (attacking and guarding never at once). A weapon art
  // waiting on the weapon (skillArm) or a Break armed leaves them free. VR: the hands are the player's own
  handsBusy() {
    return !G.vr && (this.deskCharge != null || !!this.swing || !!this.ready || !!this.healing || G.time < (this.deskActUntil ?? -99));
  }
  // the shield coming up: a buckle's clink, a little different each time
  playShieldSound(at = null) {
    const v = Math.random() * 6 - 3;
    for (const se of SHIELD_SOUND) G.audio?.playSe({ ...se, pitch: se.pitch + v }, at);
  }
  noGuard() { return !!this.offGun && !!this.gunBreakSkill(); }
  isBlocking(fromPos) {
    if (!this.guardUp || this.stamina <= 0.05 || this.gripAdjust || this.disarmed) return false;
    const head = G.player.headWorld(new THREE.Vector3());
    const to = new THREE.Vector3(fromPos.x - head.x, 0, fromPos.z - head.z).normalize();
    let facing;
    if (G.vr && this.shield && this.hasShield) {
      this.shield.updateWorldMatrix(true, false);
      facing = new THREE.Vector3(0, 0, -1).transformDirection(this.shield.matrixWorld);
      // shield face normal points away from the palm: use whichever side faces the attacker
      facing.y = 0; facing.normalize();
      return Math.abs(facing.dot(to)) > 0.35;
    }
    facing = G.player.forwardVec();
    return facing.dot(to) > 0.25;
  }

  // ---- death ------------------------------------------------------------------------------
  onPlayerDeath(killer) {
    G.player.endAir?.();
    if (this.playerDead) return;
    this.playerDead = true;
    const active = this.battles.filter(b => !b.done);
    const main = active.find(b => b.interpreter === G.map.interpreter);
    const primary = main || killer || active[0];
    for (const b of active) {
      if (b === primary) b.finish(2);
      else {
        b.done = true; b.result = 1;
        if (b.symbol?.interp) b.symbol.interp.terminate();
      }
    }
    for (const e of this.enemies) if (e.alive) { e.state = 'dying'; e.timer = 0; e.fadeOnly = true; }
    if (!primary) this.onPartyDead();
  }
  onPartyDead() {
    if (this.deathHandled || G.coop?.phantom) return;          // (a co-op guest's fall: by the server's rules - coop.js)
    this.playerDead = true;
    this.deathHandled = true;
    G.map.reserveCommonEvent(11);
  }
  onDeathCommonEvent() { this.deathHandled = true; }
  gameOver() { this.onPartyDead(); }
}
