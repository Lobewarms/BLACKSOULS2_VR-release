// What a blow covers on the floor: the hazards a boss's move leaves for a while (eruptions, pools) and the attack areas
// (circles, rings, sectors, lines, multi-part marks) - telegraphed, then struck.
import * as THREE from 'three';
import * as J from '../skilljudge.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { evalFormula } from '../rubyexpr.js';
import { FloorMarker, MARK, layOnFloors, levelled } from '../telegraph.js';
import { BOSS_AREA, BOSS_MOVE_REST, DUEL_PACE, FOLLOW_REST, FORWARD, GUN_SPEED, LOB_FLIGHT, MarkerSet, PERFECT_GUARD,
  POOL, PURSUIT, TUMBLE_AXIS, fxk, tmpA, tmpB } from './common.js';
import { shotStyleOf } from './shotlooks.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class AreaPart {
  // ---- hazards: what a boss's move leaves on the floor for a while - eruptions under the player (pursuit) and
  // pools of poison (field) ----
  addEruption(e, s, x, z, cap) {
    const y = G.floorAt(x / T - 0.5, z / T - 0.5);
    // (no plain guard stops it, a perfect one does: pink - noPlainGuard)
    const mk = new FloorMarker(this.root, { shape: 'circle', r: PURSUIT.r, color: MARK.heavy });
    mk.setPose(x, y, z, 0);
    this.hazards.push({ kind: 'erupt', e, s, x, y, z, t: 0, mk, cap });
    G.audio?.playSe(G.seAt('Magic2', 55, 140), new THREE.Vector3(x, y + 0.5, z));
  }
  addPool(e, s, p, plan) {
    const color = new THREE.Color(this.poolColor(s)).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(this.poolGeometry(), levelled(new THREE.MeshBasicMaterial({ map: this.glowTexture(), color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), 0.06));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, p.y + 0.06, p.z);
    mesh.scale.setScalar(p.r * 1.25);
    mesh.renderOrder = 4;
    mesh.userData.transient = true;
    layOnFloors(mesh, p.x, p.y, p.z, p.r * 1.25);       // (over the stage's edge: on the stage and in the house - telegraph.js)
    this.root.add(mesh);
    const mk = new FloorMarker(this.root, { shape: 'circle', r: p.r, color: plan.certain ? MARK.certainHeavy : MARK.heavy });
    mk.setPose(p.x, p.y, p.z, 0);
    mk.setProgress(1);
    this.hazards.push({ kind: 'pool', e, s, x: p.x, y: p.y, z: p.z, r: p.r, t: 0, tick: 0.35, mesh, mk, color: this.poolColor(s), certain: plan.certain,
      cap: { left: Math.max(2, plan.hits) * 2 } });
  }
  // a pool's colour: poison green, fire orange, dark violet, else the spell's own
  poolColor(s) {
    if ((s.effects || []).some(ef => ef.code === 21 && [2, 3].includes(ef.data_id))) return 0x58ff5a;
    return { 3: 0xff7a30, 10: 0xa040ff }[s.damage?.element_id] || this.skillColor(s);
  }
  poolGeometry() { return this._poolGeo || (this._poolGeo = new THREE.CircleGeometry(1, 40)); }
  updateHazards(dt, paused) {
    if (!this.hazards.length || paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    this.hazards = this.hazards.filter(h => {
      h.t += dt;
      if (h.kind === 'erupt') {
        h.mk.setProgress(h.t / PURSUIT.fuse);
        if (h.t < PURSUIT.fuse) return true;
        // it bursts
        const at = new THREE.Vector3(h.x, h.y + 0.8, h.z);
        if (h.s.animation_id > 0) this.playAreaAnim(h.s.animation_id, { x: h.x, z: h.z, w: PURSUIT.r * 2 });
        else G.audio?.playSe(G.seAt('Explosion1', 60, 120), at);
        this.spawnGlow(at.clone().setY(h.y + 0.25), { color: this.skillColor(h.s), size: PURSUIT.r * 2.2, life: 0.3, grow: 1.2 });
        if (h.cap.left > 0 && !this.playerDead && Math.hypot(head.x - h.x, head.z - h.z) <= PURSUIT.r + 0.38) { h.cap.left--; this.enemyStrikePlayer(h.e, h.s, { blockable: false, parry: true }); }
        this.strikeAlliesNear(h.e, h.s, h.x, h.z, PURSUIT.r, 1);
        this.fadingMarkers.push(h.mk);
        return false;
      }
      // a pool: it comes up, stays, fades; whoever stands in it is hurt every POOL.tick s (half the skill's blow)
      const k = h.t / POOL.time;
      h.mesh.material.opacity = Math.min(1, h.t / 0.35) * Math.min(1, (1 - k) / 0.2) * (0.6 + 0.15 * Math.sin(G.time * 5 + h.x));
      if (Math.random() < dt * 4) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * h.r * 0.9;
        this.spawnGlow(new THREE.Vector3(h.x + Math.cos(a) * r, h.y + 0.15, h.z + Math.sin(a) * r), { color: h.color, size: 0.25 + Math.random() * 0.3, life: 0.9, grow: 1.6, vel: new THREE.Vector3(0, 0.9, 0) });
      }
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = POOL.tick;
        if (h.cap.left > 0 && !this.playerDead && Math.hypot(head.x - h.x, head.z - h.z) <= h.r + 0.38) { h.cap.left--; this.enemyStrikePlayer(h.e, h.s, { blockable: false, certain: h.certain, mult: 0.5, parry: true }); }
        for (const al of this.allies.struckable()) {
          if (al.remote) continue;
          const ap = al.worldPos(new THREE.Vector3());
          if (Math.hypot(ap.x - h.x, ap.z - h.z) <= h.r + al.r) al.takeHit(h.e, h.s, { push: 0 });
        }
      }
      if (h.t < POOL.time) return true;
      this.root.remove(h.mesh); h.mesh.material.dispose();
      this.fadingMarkers.push(h.mk);
      return false;
    });
  }
  endMove(e, rest) {
    this.dropMarker(e);
    e.move = null; e.act = null;
    if (e.state === 'dying' || e.state === 'dead') return;        // (felled by its own move - a self-destruct)
    // (a co-op guest's copy: what comes next is the host's to say)
    if (e.puppet) { if (e.state === 'act' || e.state === 'windup') { e.state = 'recover'; e.timer = 0.5; } return; }
    const more = this.actionDone(e);
    if (e.state === 'dying' || e.state === 'dead') return;
    const pace = this.actionPace(e);
    e.state = 'recover';
    if (more) { e.timer = FOLLOW_REST; return; }
    e.timer = Math.max(0.25, (rest + Math.random() * 0.3) / pace);
    if (e.boss) e.nextMove = G.time + (BOSS_MOVE_REST[0] + Math.random() * (BOSS_MOVE_REST[1] - BOSS_MOVE_REST[0])) / pace;
  }
  // An enemy's action is over: the one its skill goes on with comes next, in the same turn (script 189
  // 使用後追加行動: <使用後追加行動:id,target,p> - skill id, p % of the time; 0 or less = one of its own actions) -
  // 귀신 무사's sword arts one after another, 지옥의 왕자's string of guns, 겔다's ice, a bear's roar and then its
  // fangs, 빙폭의 비스트 leaping up and melting away. Not when it can no longer act (fallen, asleep, broken) or
  // cannot use it. Else its turn is over (VX Ace's on_action_end: the turn count, states that end with an action).
  // True when it goes on.
  actionDone(e) {
    if (e.counterDone) { e.counterDone = false; e.acted = null; return false; }     // (a counter / an answer: no turn of its own)
    const s = e.acted; e.acted = null;
    const self = this.userEffectSkill(s);
    if (self && e.alive) this.applySkillToSelf(e, self);
    if (!e.alive) return false;                                  // (its own end - 인간 폭탄's 죽음의 씨앗)
    const next = this.followUp(e, s);
    if (next) {
      e.forcedSkill = next; e.pending = null;
      e.quick = true; e.cooldown = 0; e.alertTime = 0; e.nextMove = 0;
      return true;
    }
    e.turn++;
    this.expireActionStates(e);
    return false;
  }
  // Script 113 使用者効果: <使用者効果 n> - the one who used the skill takes skill n's effects as well, once it is
  // done (the next cut's mark of 삼단 베기, each stage of 씩성난 분노, 아기토's sure critical, a guard after
  // 카나키's cuts, 유니스's regeneration, 인간 폭탄 blowing itself up)
  userEffectSkill(s) {
    if (!s) return null;
    if (s._userFx === undefined) { const m = /<使用者効果\s*(\d+)\s*>/.exec(s.note || ''); s._userFx = m ? +m[1] : 0; }
    return s._userFx ? $data.skills[s._userFx] || null : null;
  }
  // Script 195 ステートでスキル変化: <ステート変化:id,state> - while the one using it has that state, the skill is
  // skill id instead (the last such line that holds): 삼단 베기 going on to its second and third cut, 씩성난 분노
  // growing stage by stage, 푸주한's rites after 도살, 십자 절단 with a bullet loaded
  skillByState(b, s) {
    if (!s || !b) return s;
    if (s._byState === undefined) s._byState = [...(s.note || '').matchAll(/<ステート変化:(\d+),(\d+)>/g)].map(m => ({ id: +m[1], state: +m[2] }));
    let id = s.id;
    for (const c of s._byState) if (b.isState(c.state)) id = c.id;
    return id === s.id ? s : $data.skills[id] || s;
  }
  // a skill's <使用後追加行動:id,target,p> notes: [{ id, p }] (companions go on with theirs too - allies.js)
  afterActions(s) {
    if (s._after === undefined) {
      s._after = [...(s.note || '').matchAll(/<使用後追加行動[：:]\s*(-?\d+)\s*,\s*-?\d+\s*(?:,\s*(\d+))?\s*>/g)]
        .map(m => ({ id: +m[1], p: m[2] === undefined ? 100 : +m[2] }));
    }
    return s._after;
  }
  followUp(e, s) {
    if (!s || !e.alive || e.hidden || e.state === 'stagger' || this.enemyRestricted(e) || this.playerDead || e.battle?.done) return null;
    for (const a of this.afterActions(s)) {
      if (a.p < Math.floor(Math.random() * 100)) continue;
      const next = a.id > 0 ? $data.skills[a.id] : this.chooseAction(e);
      if (next && this.enemyCanUse(e, next)) return next;
    }
    return null;
  }
  endFlurry(e) {
    e.comboStep = 0; e.move = null;
    if (e.boss) e.nextMove = G.time + (BOSS_MOVE_REST[0] + Math.random() * (BOSS_MOVE_REST[1] - BOSS_MOVE_REST[0])) / this.actionPace(e);
  }
  // the extra actions (feature 61) states give an enemy - 노・페이스's stances one after another, 가속 (haste): it
  // rests that much less between its actions (its own, from its data, are in its usual pace already)
  actionPace(e) {
    let n = 0;
    for (const id of e.b.states) for (const f of $data.states[id]?.features || []) if (f.code === 61) n += f.value;
    return (1 + n) * this.duelPace(e);
  }
  // (in her duel 흑기사 린다메아 does everything quicker - inDuel)
  duelPace(e) { return this.inDuel(e) ? DUEL_PACE : 1; }
  // ---- attack areas ------------------------------------------------------------------------
  // What an enemy action covers, decided as the wind-up starts:
  //  physical single -> a cone in front of the enemy; physical "all" -> a ring around it;
  //  magic "all" -> a circle where the player stands (move out of it); magic single -> a line (a shot).
  //  Several hits (repeats / random targets) hit that many times. Sure-hit (hit type 0) is purple (crimson when no
  //  plain guard stops it either): it stays locked on the player and the dodge's invincibility does not help.
  // where an enemy's attack goes: the player's head, or the companion it went for (its chest)
  targetHead(e) {
    const a = e?.tgt;
    if (a && a.stands && a.alive) return a.chest(new THREE.Vector3());
    return G.player.headWorld(new THREE.Vector3());
  }
  planAttack(e, skill, style) {
    const certain = skill.hit_type === 0;
    const hits = this.skillHits(skill);
    const ep = e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);
    const dist = Math.hypot(head.x - ep.x, head.z - ep.z);
    const magic = skill.hit_type === 2 || (certain && style !== 'melee');
    // thrown in an arc onto where the player stands as it winds up (step out of it); a death spell's dark circle
    // keeps to the player until a moment before it strikes (get out then)
    const look = this.skillLook(skill);
    if (look === 'lob' && ['melee', 'area', 'projectile', 'debuff'].includes(style)) {
      return { shape: 'circle', r: (e.boss ? 2.4 : 1.7) + (skill.scope === 2 ? 1 : 0), cx: head.x, cz: head.z, ground: true, lob: true, hits, certain, blockable: false };
    }
    if (look === 'death' && ['area', 'projectile', 'debuff'].includes(style)) {
      return { shape: 'circle', r: e.boss ? 2.2 : 1.6, cx: head.x, cz: head.z, ground: true, lockAt: 0.6, death: true, hits, certain, blockable: false };
    }
    // a gun fires along a line even when it cannot miss (a sure-hit shot homes in hard)
    if ((look === 'gun' || look === 'knife') && style === 'projectile' && skill.scope === 1) {
      return { shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + e.h * 0.6, 20), full: 20, width: e.boss ? 1.6 : 1.1, hits, certain, shot: true };
    }
    // (a boss's are bigger all round - BOSS_AREA)
    const B = !!e.boss, R = e.r * T;
    // a sure-hit counter or answer (리포스트's 판트): a quick, narrow lunge at the player
    if (e.countering && certain && ['melee', 'area', 'projectile', 'debuff'].includes(style)) return { shape: 'sector', r: R + (B ? 4.5 : 3.2), half: 0.45, hits, certain, blockable: true };
    // sure-hit attacks (the dodge's invincibility does not help) cover a wide circle around the enemy:
    // run out of it while it charges, or take it on the shield
    if (certain && ['melee', 'area', 'projectile', 'debuff'].includes(style)) return { shape: 'circle', r: (B ? BOSS_AREA.certain : 8.0) + R, around: true, hits, certain, blockable: true };
    const heavy = this.isHeavySkill(skill);
    // a plain blow reaches far in a long, narrow fan (about 57 degrees, as wide at its far edge as a 132-degree
    // fan 2.4 m long): backing away does not get out of it, stepping aside does; a heavy blow is the wide
    // sweep close in
    if (style === 'melee' && !heavy) return { shape: 'sector', r: R + (B ? BOSS_AREA.reach : 5.5), half: B ? 0.55 : 0.5, hits, certain, blockable: true };
    if (style === 'melee') return { shape: 'sector', r: R + (B ? 3.6 : 2.4), half: B ? 1.3 : 1.15, hits, certain, blockable: false, heavy };
    if (style === 'area' && !magic) return { shape: 'circle', r: (B ? 6.5 : 4.0) + R, around: true, hits, certain, blockable: !heavy, heavy };
    if (style === 'area' || ((style === 'projectile' || style === 'debuff') && skill.scope === 2)) {
      return { shape: 'circle', r: B ? 4.6 : 3.2, cx: head.x, cz: head.z, ground: true, follow: certain, hits, certain, blockable: false };
    }
    // a shot: its line shows the whole way it can fly, up to the first wall (shots do not go through walls)
    if (style === 'projectile' || style === 'debuff') return { shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + e.h * 0.6, 20), full: 20, width: B ? 2.0 : 1.4, hits, certain, shot: true };
    return null;
  }
  beginTelegraph(e) {
    this.dropMarker(e);
    const plan = e.move ? this.planBossMove(e) : this.planAttack(e, e.skill, e.style);
    e.plan = plan;
    e.moveT = 0;
    // a blow that goes through a guard (script 170 <防御状態無視率:n>, decided as it winds up): no plain guard stops it,
    // only a perfect one (or a perfect Gun Break), as with a heavy blow - pink, its border blinking, the same low warning
    if (plan && (plan.blockable || plan.shot) && this.ignoresGuard(e.b, e.skill)) { plan.blockable = false; plan.pierce = true; }
    // the beat: every attack fills its mark at a speed of its own - quick, even or slow (a late blow) - and the
    // fill ends as the blow lands, never pausing, so there is no fixed rhythm to swing to: watch the fill (in a
    // string of blows most come quick, now and then one is held back)
    const r = Math.random();
    const beat = !plan || plan.certain ? 0.88 + r * 0.24 : e.comboStep ? (r < 0.3 ? 1.75 : 1) : (r < 0.3 ? 0.7 : r < 0.72 ? 1 : 1.5) * (0.92 + Math.random() * 0.16);
    e.timer0 *= beat; e.timer = e.timer0;
    if (!plan) return;
    // (a move's own tempo: a lance comes quick, an execution slow)
    if (plan.tempo) { e.timer0 *= plan.tempo; e.timer = e.timer0; }
    if (plan.tmin) { e.timer0 = THREE.MathUtils.clamp(e.timer0, plan.tmin, plan.tmax); e.timer = e.timer0; }
    // area spells need a moment to get out of
    if (plan.certain && plan.around) { e.timer0 *= 1.3; e.timer = e.timer0; }      // time to get out of the big circle
    else if (plan.ground) { e.timer0 *= 1.25; e.timer = e.timer0; }
    else if (plan.shot) { e.timer0 *= 1.1; e.timer = e.timer0; }
    if (plan.heavy && !e.comboStep) { e.timer0 *= 1.2; e.timer = e.timer0; }
    // (a leap: over a second in the air to get out from under it, never hanging there long)
    if (plan.move === 'leap') { e.timer0 = plan.dive ? THREE.MathUtils.clamp(e.timer0, 1.2, 1.6) : THREE.MathUtils.clamp(e.timer0, 1.5, 2.6); e.timer = e.timer0; }
    // (in 흑기사 린다메아's duel: quicker, the waves of a move in parts a shorter while apart too - duelPace)
    const dp = this.duelPace(e);
    if (dp > 1) {
      e.timer0 /= dp; e.timer = e.timer0;
      if (plan.gap) plan.gap /= dp;
      for (const p of plan.parts || []) if (p.at) p.at /= dp;
    }
    // laid down where the enemy stands, facing where it aims, and it stays there (it follows no one)
    const ep = e.worldPos(new THREE.Vector3());
    // (on the floor under it, also when it is up in the air: a mark up there is out of sight)
    plan.ox = ep.x; plan.oy = ep.y - (e.lift || 0); plan.oz = ep.z; plan.aim = e.aim;
    plan.t0 = e.timer0;
    const look = this.markLook(plan);
    if (plan.shape === 'multi') {
      e.marker = new MarkerSet(this.root, plan.parts.map(p => ({ ...p, ...look })));
      plan.parts.forEach((p, i) => e.marker.list[i].setPose(p.x, p.y, p.z, p.aim || 0));
    } else if (plan.move !== 'leap' && plan.shape !== 'none') e.marker = new FloorMarker(this.root, { ...plan, ...look, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    // (a leap marks the spot it comes down on once it is in the air - updateLeap)
    if (plan.move === 'grab') {
      // (a grab: its own warning - an eerie sting and a creak, not the heavy blow's low note; motes drawn in along
      // its band all through the wind-up - grabMotes)
      G.audio?.playSe(G.seAt('Stare', 90, 100), ep);
      G.audio?.playSe(G.seAt('Twine', 70, 60), ep);
    } else if (this.unguardable(plan) && !e.comboStep) G.audio?.playSe(G.seAt('Darkness3', 70, 140), ep);
    this.updateTelegraph(e);
    G.coop?.onTelegraph?.(e);
  }
  // (a co-op guest) the mark of a move the host's enemy is winding up, as the host laid it down: drawn and filled here
  // as there (mine: aimed at this guest - a mark that follows follows me; other: at another guest, as seen here; else
  // at the host). The skill and a boss's move come with it: its body winds up as the host's does (bossBody)
  puppetTelegraph(e, plan, t0, mine, skill = null, other = null) {
    this.dropMarker(e);
    this.hideBlade(e);
    e.plan = plan; e.timer0 = e.timer = t0;
    plan.t0 = t0; plan.cap ||= { left: plan.hits || 1 };
    e.tgt = mine ? null : other || this.hostTarget;
    if (skill) { e.skill = skill; e.style = this.skillStyle(skill); }
    e.move = plan.move || null; e.act = null; e.moveT = 0; e.glinted = false; e.comboStep = 0;
    if (e.alive) e.state = 'windup';
    const look = this.markLook(plan);
    if (plan.shape === 'multi') {
      e.marker = new MarkerSet(this.root, plan.parts.map(p => ({ ...p, ...look })));
      plan.parts.forEach((p, i) => e.marker.list[i].setPose(p.x, p.y, p.z, p.aim || 0));
    } else if (plan.move !== 'leap' && plan.shape !== 'none') e.marker = new FloorMarker(this.root, { ...plan, ...look, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    if (plan.move === 'grab') {
      G.audio?.playSe(G.seAt('Stare', 90, 100), e.worldPos(new THREE.Vector3()));
      G.audio?.playSe(G.seAt('Twine', 70, 60), e.worldPos(new THREE.Vector3()));
    } else if (this.unguardable(plan)) G.audio?.playSe(G.seAt('Darkness3', 70, 140), e.worldPos(new THREE.Vector3()));
    this.updateTelegraph(e);
  }
  updateTelegraph(e) {
    const plan = e.plan, mk = e.marker;
    if (!plan || !mk) return;
    if (plan.shape === 'multi') { this.updateMulti(e); return; }
    if (plan.ground) {
      if (plan.follow || (plan.lockAt !== undefined && e.timer > plan.lockAt)) { const head = this.targetHead(e); plan.cx = head.x; plan.cz = head.z; }
      mk.setPose(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5), plan.cz, 0);
    } else if (plan.move === 'spin') {
      mk.setPose((e.fx + 0.5) * T, G.floorAt(e.fx, e.fy), (e.fy + 0.5) * T, 0);       // (a whirl goes with the boss)
    } else mk.setPose(plan.ox, plan.oy, plan.oz, plan.aim);
    // (a leap's mark fills from the moment it was laid down, in the air, to the landing)
    const from = plan.move === 'leap' ? plan.jumpAt || 0 : 0;
    mk.setProgress(e.state === 'act' ? 1 : e.timer0 ? (e.timer0 - e.timer - from) / Math.max(0.1, e.timer0 - from) : 1);
    if (this.unguardable(plan)) mk.edgeMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(G.time * 9));
    if (plan.move === 'grab' && e.state === 'windup') this.grabMotes(e, plan);
    // what it carries, rising from where it will land; the thing thrown leaves the hand to land as it strikes
    if (e.state === 'windup') {
      this.flavorMotes(e, plan);
      if (plan.lob && !plan.thrown && e.timer <= LOB_FLIGHT) this.throwLob(e, plan);
    }
  }
  flavorMotes(e, plan) {
    const c = this.skillFlavor(e.skill);
    if (!c || (plan.shape !== 'line' && !(plan.r > 0))) return;
    const area = plan.shape === 'circle' || plan.shape === 'ring' ? Math.PI * plan.r * plan.r : plan.shape === 'sector' ? plan.half * plan.r * plan.r : (plan.len || 4) * (plan.width || 1.4);
    if (Math.random() > Math.min(0.9, 0.12 + area * 0.012)) return;
    let x, z;
    if (plan.shape === 'line') {
      const t = Math.random() * (plan.len || 4), w = (Math.random() - 0.5) * (plan.width || 1.4), a = plan.aim ?? 0;
      x = plan.ox + Math.cos(a) * t - Math.sin(a) * w; z = plan.oz + Math.sin(a) * t + Math.cos(a) * w;
    } else {
      const ox = plan.ground ? plan.cx : plan.ox, oz = plan.ground ? plan.cz : plan.oz;
      const half = plan.shape === 'sector' ? plan.half : Math.PI;
      const r0 = plan.shape === 'ring' ? plan.r0 : 0;
      const a = (plan.shape === 'sector' ? plan.aim ?? 0 : 0) + (Math.random() * 2 - 1) * half;
      const r = Math.sqrt(r0 * r0 + Math.random() * (plan.r * plan.r - r0 * r0));
      x = ox + Math.cos(a) * r; z = oz + Math.sin(a) * r;
    }
    const y = G.floorAt(x / T - 0.5, z / T - 0.5) + 0.05;
    this.spawnGlow(new THREE.Vector3(x, y, z), { color: c, size: 0.07 + Math.random() * 0.07, life: 0.7 + Math.random() * 0.4, grow: 0.7,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.2), grav: plan.death ? 0.6 : -0.3 });
  }
  // the bottle / jar / mud leaves the thrower's hand to land on the marked spot as the wind-up ends
  throwLob(e, plan) {
    plan.thrown = true;
    const ep = e.worldPos(new THREE.Vector3());
    const from = new THREE.Vector3(ep.x, ep.y + e.h * 0.75, ep.z);
    const to = new THREE.Vector3(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5) + 0.15, plan.cz);
    const c = this.skillFlavor(e.skill) || 0xd8c8a0;
    const h = 1.2 + from.distanceTo(to) * 0.25;
    this.spawnGlow(from, { color: c, size: 0.22, life: Math.max(0.15, e.timer), grow: 1, arc: { from, to, h, trail: c } });
    G.audio?.playSe(G.seAt('Wind7', 60, 140), from);
  }
  dropMarker(e) {
    if (!e?.marker) return;
    G.coop?.onTelegraphEnd?.(e);
    this.fadingMarkers.push(e.marker);
    e.marker = null;
  }
  // is the player inside an attack area right now (world x/z) - never in one of a boss fight it did not join (co-op)
  playerInPlan(e, plan) {
    if (this.outOfFight(e)) return false;
    const head = G.player.headWorld(new THREE.Vector3());
    return this.pointInPlan(e, plan, head, 0.38);
  }
  // the companions standing in an attack area take it too (cap: how many times each may be hit by this move)
  strikeAlliesInPlan(e, s, plan, n = 1, cap = null) {
    for (const a of this.allies.struckable()) {
      if (!this.pointInPlan(e, plan, a.worldPos(new THREE.Vector3()), a.r)) continue;
      if (cap) { const k = cap.get(a) || 0; if (k >= (plan.hits || 1)) continue; cap.set(a, k + 1); }
      this.hitAlly(a, e, s, n, plan.ground ? { from: { x: plan.cx, z: plan.cz } } : {});
    }
  }
  // the companions near a point (a blow coming down on a spot)
  strikeAlliesNear(e, s, x, z, r, n = 1) {
    for (const a of this.allies.struckable()) {
      const p = a.worldPos(new THREE.Vector3());
      if (Math.hypot(p.x - x, p.z - z) > r + a.r) continue;
      this.hitAlly(a, e, s, n, { from: { x, z } });
    }
  }
  // a companion struck n times by one blow (thrown back by the first only - takeHit)
  hitAlly(al, e, s, n = 1, opts = {}) {
    if (al.remote) return;               // (a co-op guest judges the blows on itself, on its own side - coop.js)
    for (let i = 0; i < (n || 1); i++) this.later(i * 140, () => al.takeHit(e, s, i ? { push: 0 } : opts));
  }
  // is a point (world x/z, a body that wide) inside an attack area
  pointInPlan(e, plan, head, body) {
    // (where the area was laid down - it does not move with the enemy; a boss's whirl does)
    const ep = plan.ox !== undefined && plan.move !== 'spin' ? new THREE.Vector3(plan.ox, plan.oy, plan.oz) : e.worldPos(new THREE.Vector3());
    const aim = plan.aim ?? e.aim;
    if (plan.shape === 'ring') {
      const d = Math.hypot(head.x - ep.x, head.z - ep.z);
      return d >= plan.r0 - body && d <= plan.r + body;
    }
    if (plan.shape === 'multi') return (plan.parts || []).some(p => this.pointInPart(p, head, body));
    if (plan.shape === 'circle') {
      const c = plan.ground ? [plan.cx, plan.cz] : [ep.x, ep.z];
      return Math.hypot(head.x - c[0], head.z - c[1]) <= plan.r + body;
    }
    if (plan.shape === 'sector') {
      const d = Math.hypot(head.x - ep.x, head.z - ep.z);
      if (d > plan.r + body) return false;
      if (d < 0.7) return true;
      const a = Math.atan2(head.z - ep.z, head.x - ep.x);
      if (Math.abs(Math.atan2(Math.sin(a - aim), Math.cos(a - aim))) > plan.half + body / d) return false;
      // (a wall between them stops it)
      return this.clearRun(ep.x, ep.z, a, ep.y + 0.8, d) >= d - 0.4;
    }
    if (plan.shape === 'line') {
      // along the band, within its width
      const ux = Math.cos(aim), uz = Math.sin(aim), rx = head.x - ep.x, rz = head.z - ep.z;
      const along = rx * ux + rz * uz, side = Math.abs(rx * uz - rz * ux);
      return along >= -body && along <= plan.len + body && side <= plan.width / 2 + body;
    }
    return false;
  }
  // one part of a move laid down in several (a circle of a rain, an arm of a cross)
  pointInPart(p, head, body) {
    if (p.shape === 'circle') return Math.hypot(head.x - p.x, head.z - p.z) <= p.r + body;
    const ux = Math.cos(p.aim), uz = Math.sin(p.aim), rx = head.x - p.x, rz = head.z - p.z;
    const along = rx * ux + rz * uz, side = Math.abs(rx * uz - rz * ux);
    return along >= -body && along <= p.len + body && side <= p.width / 2 + body;
  }
  executeAttack(e, distM, dx, dy) {
    const skill = e.skill;
    G.coop?.onEnemyAct?.(e, skill);
    // (a co-op guest's copy of the host's enemy only shows its move: what it does is done on the host's side)
    if (!e.puppet && !(e.move === 'flurry' && e.comboStep > 0)) this.runSkillCommonEvents(skill);     // (a flurry is one use of it)
    const plan = e.plan || this.planAttack(e, skill, e.style);
    // (from where its area was laid down)
    const ep = plan?.ox !== undefined ? new THREE.Vector3(plan.ox, plan.oy, plan.oz) : e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);
    const hits = plan?.hits || 1;
    const certain = !!plan?.certain;
    if (skill.animation_id > 0) this.playEnemyActionAnim(e, skill, plan, ep);
    switch (e.style) {
      case 'melee': case 'area': case 'projectile': case 'debuff': {
        if (plan && !plan.shot) {
          if (plan.ground) this.spawnGlow(new THREE.Vector3(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5) + 0.3, plan.cz), { color: plan.death ? 0x6a20c0 : (plan.lob && this.skillFlavor(skill)) || (certain ? 0xb050ff : 0xff7030), size: plan.r * 2.2, life: 0.35, grow: 1.1 });
          if (this.playerInPlan(e, plan)) {
            for (let i = 0; i < hits; i++) this.later(i * 160, () => this.enemyStrikePlayer(e, skill, { blockable: plan.blockable, certain, parry: this.parryable(plan) }));
          } else G.audio?.playSe(G.seAt(plan.ground ? 'Explosion1' : 'Wind7', 60, 120), plan.ground ? new THREE.Vector3(plan.cx, head.y, plan.cz) : ep);
          this.strikeAlliesInPlan(e, skill, plan, hits);
          if (e.style === 'area' && !plan.ground) G.audio?.playSe(G.seAt('Earth4', 80, 100), ep);
          break;
        }
        // a shot: flies fast along the telegraphed line (sure-hit shots home in hard)
        const from = ep.clone(); from.y = ep.y + e.h * 0.6;
        const aim = plan?.aim ?? e.aim;
        const look = this.skillLook(skill), gun = look === 'gun', fast = gun || look === 'knife';
        for (let i = 0; i < hits; i++) {
          this.later(i * 180, () => {
            if (!e.alive) return;
            const dir = new THREE.Vector3(Math.cos(aim), 0, Math.sin(aim));
            const to = this.targetHead(e); to.y -= 0.25;
            dir.y = (to.y - from.y) / Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
            this.spawnProjectile(from, dir, { speed: fast ? GUN_SPEED : 13, color: certain ? 0xb050ff : fast ? 0xfff0c0 : this.skillColor(skill), enemy: e, skill, homing: certain ? 4 : fast ? 0.05 : 0.15, certain, aimAt: e.tgt || null, pierce: !!plan?.pierce, ghost: !!e.puppet,
              style: shotStyleOf(skill, look), tint: certain ? 0xb050ff : null });
            // (a gun: the flash at the muzzle; a gun or a thrown knife: the streak along its line)
            if (gun) this.spawnGlow(from.clone().addScaledVector(dir, 0.3), { color: 0xffd890, size: 0.45, life: 0.09, grow: 1.8 });
            if (fast) this.spawnTracer(from, from.clone().addScaledVector(dir.clone().normalize(), Math.min(plan?.len || 12, 12)), 0xfff0c0);
          });
        }
        if (!fast) G.audio?.playSe(G.seAt('Magic1', 70, 110), ep);
        break;
      }
      case 'buff':
        if (e.puppet) break;
        this.applySkillToSelf(e, skill);
        // a boss's quick step (BLACK SOULS II's 회피, 절영, 롤링 회피... - skilljudge.js, by number): gone, and there again
        // beside or behind the player
        if (e.boss && J.bossBlinks(skill)) this.blink(e);
        break;
      case 'heal': {
        if (e.puppet) break;
        this.applySkillToSelf(e, skill);
        // (after the recovery rules on it: 허약 - a 반불사 버섯 thrown at it - stops it, 천수 영역 turns it)
        const v = e.b.healAmount(Math.max(1, Math.floor(evalFormula(skill.damage.formula, e.b, e.b))));
        e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar();
        this.popup(new THREE.Vector3(ep.x, ep.y + e.h, ep.z), v > 0 ? `+${v}` : String(v), v > 0 ? '#60ff80' : '#9a9a9a');
        if (v < 0) this.checkEnemyDeath(e);
        break;
      }
      default: break;
    }
  }

  // An enemy action's animation plays where it lands, once, as big as its area (the marker on the floor - playAreaAnim):
  // over the cone in front of the enemy, over its circle; a spell cast on itself on the enemy. A shot's plays where
  // the shot ends (updateProjectiles)
  playEnemyActionAnim(e, skill, plan, ep) {
    const id = skill.animation_id;
    if (plan?.shot) return;
    if (!plan || !['melee', 'area', 'projectile', 'debuff'].includes(e.style)) {
      G.screen.playAnimationOn(new THREE.Vector3(ep.x, ep.y + e.h * 0.5, ep.z), id, { world: true, size: this.enemySize(e) * 1.2 });
      return;
    }
    this.playAreaAnim(id, this.areaSpan(plan, ep, plan.aim ?? e.aim));
  }
  // An attack's animation over its area: one drawing, as wide as the area, played on a body standing in its middle and
  // grown from there - one standing in it is in it (screen.js area)
  playAreaAnim(id, span, opts = {}) {
    if (!(id > 0) || !span) return;
    const ground = G.floorAt(span.x / T - 0.5, span.z / T - 0.5);
    G.screen.playAnimationOn(new THREE.Vector3(span.x, ground + 1, span.z), id, { world: true, area: true, size: Math.max(1.2, span.w), ground, ...opts });
  }
  // an attack area's middle (x, z) and how wide it is (w): a circle's or a ring's width, a line's length (or its width,
  // the wider), a cone's bounds along it and across it, the bounds of its parts
  areaSpan(plan, ep, aim = plan.aim ?? 0) {
    const ox = plan.ox ?? ep.x, oz = plan.oz ?? ep.z;
    switch (plan.shape) {
      case 'circle': case 'ring': return plan.ground ? { x: plan.cx, z: plan.cz, w: 2 * plan.r } : { x: ox, z: oz, w: 2 * plan.r };
      case 'line': return { x: ox + Math.cos(aim) * plan.len / 2, z: oz + Math.sin(aim) * plan.len / 2, w: Math.max(plan.len, plan.width || 0) };
      case 'sector': {
        const back = Math.min(0, plan.r * Math.cos(plan.half)), side = plan.r * Math.sin(Math.min(plan.half, Math.PI / 2)), mid = (back + plan.r) / 2;
        return { x: ox + Math.cos(aim) * mid, z: oz + Math.sin(aim) * mid, w: Math.max(plan.r - back, 2 * side) };
      }
      case 'multi': return this.partsSpan(plan.parts || []);
    }
    return null;
  }
  partsSpan(parts) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x, z, m) => { x0 = Math.min(x0, x - m); x1 = Math.max(x1, x + m); z0 = Math.min(z0, z - m); z1 = Math.max(z1, z + m); };
    for (const p of parts) {
      if (p.shape === 'circle') { add(p.x, p.z, p.r); continue; }
      // (a band: its four corners)
      const ca = Math.cos(p.aim), sa = Math.sin(p.aim), m = (p.width || 0) / 2;
      for (const k of [0, p.len]) for (const sd of [-m, m]) add(p.x + ca * k - sa * sd, p.z + sa * k + ca * sd, 0);
    }
    return x1 > x0 ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: Math.max(x1 - x0, z1 - z0) } : null;
  }

  updateProjectiles(dt, paused) {
    if (paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    // (enemy shots come round toward the upper chest, as they are aimed, not the middle of the head: a sure-hit shot
    // homing in hard on the head went over a shield held in front of the chest)
    const chest = head.clone(); chest.y -= 0.25;
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.owner === 'enemy' && p.homing) {
        const to = p.aimAt?.stands && p.aimAt.alive ? p.aimAt.chest(new THREE.Vector3()) : chest;
        const want = to.clone().sub(p.mesh.position).normalize().multiplyScalar(p.speed);
        p.vel.lerp(want, Math.min(1, p.homing * dt));
      }
      // (an orb sets off slowly, gathering speed, and comes round after its target turning at most steer rad/s -
      // from 1.3 m off it goes straight on: a step aside at the last moment lets it by)
      if (p.owner === 'enemy' && p.steer && !p.committed) {
        const to = p.aimAt?.stands && p.aimAt.alive ? p.aimAt.chest(new THREE.Vector3()) : chest;
        const want = to.clone().sub(p.mesh.position);
        if (p.accel) p.speed = Math.min(p.maxSpeed, p.speed + p.accel * dt);
        if (want.length() < 1.3) { p.committed = true; p.vel.setLength(p.speed); }
        else {
          const v = p.vel.clone().normalize(), w = want.normalize(), ang = Math.acos(THREE.MathUtils.clamp(v.dot(w), -1, 1));
          if (ang > 1e-4) {
            const q = new THREE.Quaternion().setFromUnitVectors(v, w);
            v.applyQuaternion(new THREE.Quaternion().slerp(q, Math.min(1, p.steer * dt / ang)));
          }
          p.vel.copy(v.multiplyScalar(p.speed));
        }
      }
      if (p.target && p.target.alive) {
        // a spell aimed at someone bends a little toward them
        const aim = p.target.worldPos(new THREE.Vector3()); aim.y += p.target.h * 0.6;
        p.vel.lerp(aim.sub(p.mesh.position).normalize().multiplyScalar(p.speed), Math.min(1, 3 * dt));
      }
      if (p.gravity) {
        p.vel.y -= p.gravity * dt;
        const left = p.landAt - G.time;
        if (p.track?.alive && left > 0.05) {
          const at = p.track.worldPos(tmpB);
          p.vel.x = (at.x - p.mesh.position.x) / left;
          p.vel.z = (at.z - p.mesh.position.z) / left;
        }
      }
      if (p.dest && p.mesh.position.distanceTo(p.dest) < 0.45) p.life = 0;   // an area spell reached its spot
      if (p.mesh.userData.spin) p.mesh.material.rotation += dt * 12;
      const steps = p.fine ? Math.max(1, Math.ceil(p.vel.length() * dt / 0.15)) : 1;
      for (let k = 0; k < steps; k++) {
        p.mesh.position.addScaledVector(p.vel, dt / steps);
        this.projectileStep(p, head);
        if (p.life <= 0) break;
      }
      if (p.align && p.vel.lengthSq() > 1e-6) p.mesh.quaternion.setFromUnitVectors(FORWARD, tmpA.copy(p.vel).normalize());
      if (p.tumble) p.mesh.rotateOnAxis(TUMBLE_AXIS, dt * 9);
      if (p.life > 0) p.mesh.userData.animate?.(dt, p);             // (its look: flicker, spin, trail - shotlooks.js)
    }
    this.finishProjectiles();
  }
  // a projectile at its new spot: walls, the floor, and whoever it meets
  projectileStep(p, head) {
    {
      const pos = p.mesh.position;
      // walls
      const tx = pos.x / T - 0.5, ty = pos.z / T - 0.5;
      const g = G.map.grid;
      if (!g.valid(Math.round(tx), Math.round(ty)) || pos.y < G.floorAt(tx, ty) - 0.05) { p.life = 0; p.landed = true; }
      // walls: nothing flies through them (the cell it was fired from does not count)
      const cx = Math.round(tx), cy = Math.round(ty);
      if (p.startCell === undefined) p.startCell = cx + cy * g.w;
      if (cx + cy * g.w !== p.startCell && pos.y < (G.solidTopAt?.(cx, cy) ?? -Infinity) * T - 0.05) { p.life = 0; p.landed = true; }
      // (a co-op guest's copy of a shot of the host's enemy strikes this player as any shot does - below; at the other
      // player it went for - the host, another guest - it is gone: what it does there is that player's to judge)
      const away = p.ghost && p.aimAt?.away && p.aimAt.stands ? p.aimAt.chest(new THREE.Vector3()) : null;
      if (p.owner === 'enemy' && away && pos.distanceTo(away) < 0.5) {
        p.life = 0; p.struck = true;
        this.spawnGlow(pos, { color: p.certain ? 0xb050ff : this.skillColor(p.skill), size: 0.4, life: 0.15, grow: 1.6 });
      } else if (p.owner === 'enemy') {
        // a shot is stopped only where it actually meets the shield (one that goes through a guard passes it)
        let shielded = false;
        if (this.shield && this.hasShield && (G.vr || this.deskShieldUp()) && (!p.pierce || (this.guardUp && !this.disarmed && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD))) {
          this.shield.getWorldPosition(tmpA);
          if (pos.distanceTo(tmpA) < 0.32) shielded = true;
        }
        // (the shots of a fan hit no more times than their skill does)
        const spent = p.cap && p.cap.left <= 0;
        if (shielded) {
          p.life = 0; p.struck = true;
          if (!spent) { if (p.cap) p.cap.left--; this.enemyStrikePlayer(p.enemy, p.skill, { kind: 'projectile', certain: p.certain, shieldHit: true, shot: p }); }
          // (turned back by the shield: it flies on, and its burst comes where it lands)
          if (p.skill?.animation_id > 0 && !p.reflected) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, visual: false });
        } else if (pos.distanceTo(head) < 0.5 || (Math.hypot(pos.x - head.x, pos.z - head.z) < 0.42 && pos.y < head.y && pos.y > G.floorAt(tx, ty) + 0.2)) {
          p.life = 0; p.struck = true;
          // PC: no hands to hold a shield up, so the old facing-based guard still works there
          if (!spent) { if (p.cap) p.cap.left--; this.enemyStrikePlayer(p.enemy, p.skill, { blockable: !G.vr && !p.pierce, parry: !G.vr && !!p.pierce, kind: 'projectile', certain: p.certain, shot: p }); }
          // on the player: its sounds, and a burst where it struck rather than its drawing in the eyes (turned back: none)
          if (!p.reflected) {
            if (p.skill?.animation_id > 0) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, visual: false });
            this.spawnGlow(pos, { color: p.certain ? 0xb050ff : this.skillColor(p.skill), size: 0.5, life: 0.18, grow: 1.8 });
          }
        } else {
          // a companion it meets (a co-op guest: it flies on - the guest judges it on its own side)
          for (const al of this.allies.struckable()) {
            if (al.remote) continue;
            const ap = al.chest(new THREE.Vector3());
            if (Math.hypot(pos.x - ap.x, pos.z - ap.z) < al.r + 0.15 && pos.y > ap.y - al.h * 0.6 && pos.y < ap.y + al.h * 0.5) {
              p.life = 0; p.struck = true;
              if (!spent) { if (p.cap) p.cap.left--; al.takeHit(p.enemy, p.skill, { dir: [p.vel.x, p.vel.z] }); }
              if (p.skill?.animation_id > 0) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, size: 1.4 });
              break;
            }
          }
        }
      } else if (p.owner === 'peer') {
        // (another player's shot, as shown here: it stops at one of this world's enemies - or, PvP, at this player - and
        // its animation plays there; what it does was judged on its own side)
        if ((p.by ? !!G.coop?.pvpWithId?.(p.by) : !!G.coop?.pvpAny) && pos.distanceTo(tmpB.copy(head).setY(head.y - 0.25)) < 0.35) { p.life = 0; p.hit = true; return; }
        for (const e of this.allTargets()) {
          const wp = e.worldPos(tmpA); wp.y += e.hover || 0;
          if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < e.hr * T + 0.1 && pos.y > wp.y && pos.y < wp.y + e.h) {
            p.life = 0; p.hit = true;
            if (p.anim > 0 && !p.aoe) G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + e.h * 0.5, wp.z), p.anim, { rate: 3, height: e.h });
            break;
          }
        }
      } else if (p.owner === 'mirror') {
        // (a spell turned back - reflectOntoEnemy: the first enemy it meets, its caster or another in its way, takes it;
        // companions and players it passes by)
        for (const e0 of this.allTargets()) {
          const wp = e0.worldPos(tmpA); wp.y += e0.hover || 0;
          if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < e0.hr * T + 0.1 && pos.y > wp.y && pos.y < wp.y + e0.h) {
            p.life = 0; p.hit = true;
            this.reflectLands(p.enemy, this.partAt(e0, pos), p.skill);
            break;
          }
        }
      } else {
        // (PvP: another player in its way - a weapon's shot, a spell, a thrown thing (an area one bursts there); not a
        // Break)
        if (!p.breakSkill && G.coop?.pvpAny) {
          const t = G.coop.pvpTargets().find(c => Math.hypot(pos.x - c.x, pos.z - c.z) < c.r + 0.1 && pos.y > c.y && pos.y < c.y + c.h);
          if (t) {
            p.life = 0; p.hit = true;
            if (!p.usable) this.strikePlayer(t, { power: p.power });
            else if (!p.aoe) this.strikePlayerWith(t, p.usable, { one: p.one });
            return;
          }
        }
        for (const e0 of this.allTargets()) {
          const wp = e0.worldPos(tmpA); wp.y += e0.hover || 0;
          if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < e0.hr * T + 0.1 && pos.y > wp.y && pos.y < wp.y + e0.h) {
            const e = this.partAt(e0, pos);              // (a picture shared by a mount and its rider: the part it strikes)
            p.life = 0;
            p.hit = true;
            if (p.aoe) break;                         // area spells burst below
            if (p.usable) {
              // (a round of a skill's shot is one hit of it, and the skill's animation comes once for all its rounds)
              const n = p.one ? 1 : Math.max(1, Math.min(5, p.usable.repeats || 1));
              for (let r = 0; r < n; r++) this.later(r * 120, () => this.applyUsableToEnemy(e, p.usable, pos));
              if (p.usable.animation_id > 0 && !p.volley?.shown) G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + e.h * 0.5, wp.z), p.usable.animation_id, { rate: 3, height: e.h });
              if (p.volley) p.volley.shown = true;
            } else if (p.breakSkill && (this.breakCooldown || 0) <= G.time) this.breakOnHit(e, p.breakSkill, pos);
            else {
              this.playerHitEnemy(e, p.power, false, pos, { one: p.one });
              if (p.staff) p.burstAt = e.worldPos(new THREE.Vector3());       // (its blow and its reach landed there: staffBurst shows it)
            }
            break;
          }
        }
      }
    }
  }
  finishProjectiles() {
    this.projectiles = this.projectiles.filter(p => {
      if (p.life > 0) return true;
      if (p.staff && !p.burst) { p.burst = true; this.staffBurst(p); }
      if (p.aoe && p.usable && !p.burst) { p.burst = true; this.burstUsable(p.usable, p.mesh.position.clone(), p.aoe); }
      else if (p.gravity && p.usable && !p.hit && !p.aoe) this.landThrown(p);
      else if (p.owner === 'player' && p.usable && !p.hit && !p.aoe) this.spellMissed(p);
      else if (p.owner === 'peer') this.peerShotEnds(p);
      // an enemy's shot that missed: its animation where it ended (a wall, the floor, out of range)
      // (and one turned back that met no enemy - a wall stopped it, it flew out of range)
      if (((p.owner === 'enemy' && !p.struck) || (p.owner === 'mirror' && !p.hit)) && p.skill?.animation_id > 0) G.screen.playAnimationOn(p.mesh.position.clone(), p.skill.animation_id, { world: true, size: 1.6 });
      this.root.remove(p.mesh);
      if (p.mesh.isSprite) { p.mesh.material.map?.dispose(); p.mesh.material.dispose(); }
      else if (p.mesh.userData.thrown) p.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      else p.mesh.userData.dispose?.();
      return false;
    });
  }
  allTargets() {
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean), [...this.puppets.values()])
      .filter(e => e.mesh && e.alive && !e.hidden && !e.untargetable && !this.outOfFight(e));
  }
  // (co-op) fallen and watching a boss fight: what this player holds, and its hands, as a shade
  setGhostly(on) {
    for (const root of [this.weapon, this.shield, G.hands?.models?.left?.root, G.hands?.models?.right?.root]) {
      root?.traverse?.(o => {
        if (!o.material) return;
        for (const m of [].concat(o.material)) {
          if (on) { if (m.userData.ghostOf === undefined) m.userData.ghostOf = [m.transparent, m.opacity]; m.transparent = true; m.opacity = 0.3; }
          else if (m.userData.ghostOf) { [m.transparent, m.opacity] = m.userData.ghostOf; delete m.userData.ghostOf; }
          m.needsUpdate = true;
        }
      });
    }
  }
  // (co-op) an enemy of a boss fight this player is out of - never joined, or watching it fallen: it and this player
  // never touch each other (a guest's copy is told so by the host; the host's own, by who is in the fight)
  outOfFight(e) {
    if (!e) return false;
    if (e.puppet) return !!e.outOfFight;
    return !!e.battle?.coopIn && !!G.coop?.hostOutOf?.(e.battle);
  }
}
