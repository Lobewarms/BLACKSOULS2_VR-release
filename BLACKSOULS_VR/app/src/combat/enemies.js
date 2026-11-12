// The enemies in a fight: chasing, keeping their distance, choosing an action as the original's battle does, winding up and
// striking, being knocked back, standing in the player's way.
import * as THREE from 'three';
import { BALLOON_SIZE, BalloonIcon } from '../balloons.js';
import { lineOfSight, nextStep, resolveCircle } from '../collision.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { BODY_R, BOSS_AREA, BOSS_HEAL_PASS, BOSS_HEAL_REST, COOL_TURN, FOLLOW_REST, coolTurns, fxk,
  tmpA } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class EnemyPart {
  // ---- active enemies -------------------------------------------------------------------------
  updateEnemies(dt, paused) {
    const pc = G.map.playerChar;
    const head = G.player.headWorld(new THREE.Vector3());
    const all = this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean), [...this.puppets.values()]);
    let attacking = this.enemies.filter(e => e.state === 'windup' || e.state === 'act').length;
    for (const e of all) {
      if (!e.mesh) continue;
      // (a co-op guest's copy of the host's enemy: it goes where the host's is, eased; the host thinks for it. What it
      // winds up and lets go is played here as the host's goes (coop.js: 'tg', 'lp', 'bx', 'ax') - a leap through the
      // air and a charge carry it on their own meanwhile)
      if (e.puppet) {
        if (!this.puppetMoves(e)) {
          const dx = e.netX - e.fx, dy = e.netY - e.fy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { e.fx = e.netX; e.fy = e.netY; }
          else { const k = 1 - Math.exp(-dt * 14); e.fx += dx * k; e.fy += dy * k; }
        }
        e.knock.x = 0; e.knock.y = 0;
        if (!paused && e.alive && e.state === 'windup' && e.plan) {
          e.timer = Math.max(0, e.timer - dt);
          e.moveT = (e.moveT || 0) + dt;
          if (e.move === 'leap') this.updateLeap(e);
          this.updateTelegraph(e);
        } else if (!paused && e.alive && e.state === 'act' && e.act && e.move) this.updateBossAct(e, dt);
      }
      // a looping map: an enemy is where its copy nearest to the player is (it only jumps when far off)
      if (G.map.loopX) e.fx = G.map.nearX(e.fx, pc.fx);
      if (G.map.loopY) e.fy = G.map.nearY(e.fy, pc.fy);
      e.flash = Math.max(0, e.flash - dt);
      e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      if (!paused && e.alive && !e.puppet) this.tickEnemyStates(e, dt);
      if (!paused && e.alive && e.battle && !e.puppet) this.tickGroggy(e, dt);
      if (e.alive && e.b.hp <= 0) this.checkEnemyDeath(e);
      this.updateBreakCue(e);
      // (it goes for the player or for a companion that fights - in a co-op boss fight, only for those in it: with
      // nobody left to go for it holds, but a move already going on goes on)
      if (!paused && e.battle && e.alive && !e.hidden && !e.puppet) {
        const tg = this.allies.pickTarget(e) || (this.outOfFight(e) ? (e.state === 'windup' || e.state === 'act' ? e.lastTg || null : null) : pc);
        if (tg) { e.lastTg = tg; attacking = this.enemyAI(e, dt, tg, attacking); }
      }
      // an attack that is off (stunned, broken, fallen, the fight over) leaves no mark on the floor, and a boss
      // knocked out of its leap comes down
      if (e.marker && e.state !== 'windup' && e.state !== 'act') this.dropMarker(e);
      if (e.sky && !paused) this.skyHold(e, dt);           // (gone up into the sky: stays up there - bossmoves.js)
      else if (e.landing || e.diving) this.skyLand(e);
      if (e.lift > 0 && !e.sky && !(e.diving && e.alive) && !(e.state === 'windup' && (e.move === 'leap' || e.move === 'farOrb')) && !(e.state === 'act' && ['recoil', 'farOrb', 'cloakLeap'].includes(e.act?.kind))) e.lift = Math.max(0, e.lift - (this.skyDrop(e) || 16) * dt);
      // (a far orb's: gone with the move it was for - cut short, the boss fallen)
      if (e.orb && !(e.state === 'windup' && e.move === 'farOrb')) this.dropOrb(e);
      if (e.act?.orb && !e.act.burst && e.state !== 'act') { this.root.remove(e.act.orb); e.act.orb.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); e.act.orb = null; e.act.burst = true; }
      // dying / fade
      if (e.state === 'dying') {
        e.timer += dt;
        const k = Math.min(1, e.timer / (e.fadeOnly ? 0.6 : 1.1));
        e.mat.opacity = 1 - k;
        e.mesh.position.y = -k * (e.fadeOnly ? 0 : e.h * 0.25);
        e.mat.color.setRGB(1, 1 - k * 0.6, 1 - k * 0.6);
        if (k >= 1) { e.state = 'dead'; e.group.visible = false; }
      }
      // knockback: a hit never sends an enemy through a wall (chasing through walls is a separate
      // setting); one that is inside a wall already (chasing through it) is not pushed at all
      if (e.stationary || this.inDuel(e)) { e.knock.x = 0; e.knock.y = 0; }      // (in the duel she stands her ground - inDuel)
      if (Math.abs(e.knock.x) + Math.abs(e.knock.y) > 0.001) {
        const nx = e.fx + e.knock.x, ny = e.fy + e.knock.y;
        const inWall = !G.map.walkable(G.map.wrapX(Math.round(e.fx)), G.map.wrapY(Math.round(e.fy)));     // (a cell a boss arena opened is no wall)
        if (!inWall && lineOfSight(e.fx, e.fy, nx, ny)) [e.fx, e.fy] = resolveCircle(nx, ny, Math.min(e.r, 0.45));
        else { e.knock.x = 0; e.knock.y = 0; }
        e.knock.x *= 0.7; e.knock.y *= 0.7;
      }
      // visuals (hidden a moment by an animation - hideUntil - or floating over the floor - hover)
      e.group.visible = e.state !== 'dead' && !e.hidden && !(e.hideUntil > G.time) && !e.offStage && !this.skyHidden(e);
      const wp = e.worldPos(tmpA);
      e.group.position.copy(wp);
      e.group.position.y += e.hover || 0;
      e.mesh.rotation.y = Math.atan2(head.x - wp.x, head.z - wp.z);
      e.mesh.rotation.z = 0; e.mesh.position.x = 0; e.mesh.position.z = 0;
      // (one hanging high over the player - the stage machine in the flies - leans its face down toward them)
      e.mesh.rotation.x = (e.hover || 0) > 2 ? 0.75 * Math.atan2(e.group.position.y + e.h * 0.5 - head.y, Math.max(0.5, Math.hypot(head.x - wp.x, head.z - wp.z))) : 0;
      if (e.ghosts && !(e.state === 'act' && e.act?.kind === 'spin')) for (const gh of e.ghosts) gh.g.visible = false;
      // a symbol's body shows its event's balloon icon over its head
      if (e.balloonOf?.balloonId > 0 && e.state !== 'dying' && e.state !== 'dead') (e.balloon ||= new BalloonIcon(e.group, BALLOON_SIZE)).update(e.balloonOf.balloonId, e.balloonOf.balloonTime, (e.h || 1.8) + 0.05);
      else e.balloon?.update(0);
      const dashing = e.state === 'act' && e.act?.kind === 'dash';
      const bob = (e.state === 'chase') ? Math.abs(Math.sin(G.time * 7 + e.fx)) * 0.04 : dashing ? Math.abs(Math.sin(G.time * 18)) * 0.07 : 0;
      if (e.state !== 'dying') e.mesh.position.y = bob;
      const wind = e.state === 'windup' ? Math.min(1, e.timer0 ? 1 - e.timer / e.timer0 : 0) : 0;
      if (e.state !== 'dying') {
        const fl = e.flash > 0 ? 0.9 * fxk() : 0;
        e.mat.emissive.setRGB(fl + wind * 0.6, fl, fl);
        // (a counter stance it took up - a skill gave it a counter rate it has none of by nature: a cold shimmer over it
        // while it lasts; one that counters by nature does not shimmer)
        if (e.b.cnt > 0 && !(this.ownCounter(e) > 0) && e.state !== 'stagger' && e.alive) { const k = 0.5 + 0.5 * Math.sin(G.time * 6); e.mat.emissive.r += 0.08 * k; e.mat.emissive.g += 0.16 * k; e.mat.emissive.b += 0.3 * k; }
        // (a stance that slips blows and answers them - 리포스트: a pale, quick flicker, and a ring of steel as it begins)
        const slipping = e.alive && e.state !== 'stagger' && this.slipStance(e.b);
        if (slipping) { const k = 0.5 + 0.5 * Math.sin(G.time * 13); e.mat.emissive.r += 0.24 * k; e.mat.emissive.g += 0.24 * k; e.mat.emissive.b += 0.28 * k; }
        if (slipping && !e.slipCue) G.audio?.playSe(G.seAt('Sword1', 80, 150), wp.clone());
        e.slipCue = slipping;
        e.mesh.scale.setScalar(1 + wind * 0.06 + (e.state === 'stagger' ? Math.sin(G.time * 30) * 0.01 : 0));
        // a boss's own moves show in its body
        if (e.boss && (e.move || e.bodyT)) this.bossBody(e, wind, fl, head);
        e.mat.opacity = e.battle || e.alertTime > 0 ? 1 : 0.92;
        if (e.blinkAt && G.time - e.blinkAt < 0.3) e.mat.opacity *= (G.time - e.blinkAt) / 0.3;     // (coming out of a quick step)
      }
      e.ring.material.opacity = 0;          // replaced by the floor telegraphs
    }
    // (a mount drawn in its rider's picture: one body with it - bossmoves.js)
    this.updateMounts(all, head, paused);
    // keep enemies apart (a charging or leaping boss goes over and through)
    const loose = x => (x.state === 'act' && x.act?.kind === 'dash') || (x.lift || 0) > 0.3 || x.stationary || x.puppet;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.mesh || !a.alive || loose(a)) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.mesh || !b.alive || loose(b) || (b.pair && b.pair === a.pair)) continue;
        const dx = b.fx - a.fx, dy = b.fy - a.fy;
        const d = Math.hypot(dx, dy), min = (a.r + b.r) * 0.85;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.fx -= dx / d * push; a.fy -= dy / d * push;
          b.fx += dx / d * push; b.fy += dy / d * push;
        }
      }
    }
    // the meat shield stands where it was summoned and the enemies do not get through it
    for (const w of this.allies.walls()) {
      for (const a of all) {
        if (!a.mesh || !a.alive || loose(a)) continue;
        const dx = a.fx - w.fx, dy = a.fy - w.fy, d = Math.hypot(dx, dy), min = a.r + w.r / T;
        if (d < min && d > 1e-4) { a.fx = w.fx + dx / d * min; a.fy = w.fy + dy / d * min; }
      }
    }
    // the player and the enemies stand in each other's way like walls and neither pushes the other (pushPlayer
    // stops the player): an enemy comes up to the player and no further, and one the player has come up against
    // comes no closer. A boss coming down on them or ending its run there, or one coming out of hiding, steps
    // off; through a dodge they pass each other. (last: where each was left last frame, before anything moved it)
    const dodging = G.player.dodging;
    for (const a of all) {
      if (!a.mesh || !a.alive || a.puppet) continue;
      const free = loose(a) || a.hidden, fresh = a.wasFree !== false || a.lastFx === undefined;
      a.wasFree = free;
      const dxp = a.fx - pc.fx, dyp = a.fy - pc.fy;
      const dp = Math.hypot(dxp, dyp), minp = a.r + BODY_R;
      if (!free && !dodging && !this.passing.has(a) && dp < minp - 1e-3) {
        const lx = fresh ? a.fx : G.map.nearX(a.lastFx, a.fx), ly = fresh ? a.fy : G.map.nearY(a.lastFy, a.fy);
        const d0 = Math.hypot(lx - pc.fx, ly - pc.fy);
        if (fresh || d0 >= minp - 1e-3) {
          // (right on the player - a boss landing from a leap: back the way it faced)
          const ux = dp > 1e-4 ? dxp / dp : -Math.cos(a.aim || 0), uy = dp > 1e-4 ? dyp / dp : -Math.sin(a.aim || 0);
          a.fx = pc.fx + ux * minp; a.fy = pc.fy + uy * minp;
        } else if (dp < d0) { a.fx = lx; a.fy = ly; }
      }
      a.lastFx = a.fx; a.lastFy = a.fy;
    }
    this.enemies = this.enemies.filter(e => {
      if (e.state === 'dead' && e.timer > 1.2) { e.remove(); return false; }
      if (e.state === 'dead') e.timer += dt;
      return true;
    });
  }

  // (what it is going to do; a state it has may turn that skill into another - skillByState)
  chooseAction(e) { return this.skillByState(e.b, this.pickAction(e)); }
  pickAction(e) {
    if (e.forcedSkill) { const s = e.forcedSkill; e.forcedSkill = null; return s; }   // Force Action (339)
    // (one with no actions at all does nothing, as in VX Ace - the dark stage machine's middle forms)
    if (!e.data.actions?.length) return null;
    let acts = e.data.actions.filter(a => this.actionValid(e, a));
    // a boss heals far less often than its pattern says (BOSS_HEAL_REST / BOSS_HEAL_PASS)
    if (e.boss) acts = acts.filter(a => !this.isHealSkill($data.skills[a.skill_id]) || (G.time >= (e.healReady || 0) && Math.random() < BOSS_HEAL_PASS));
    if (!acts.length) return $data.skills[1];
    const max = Math.max(...acts.map(a => a.rating));
    const zero = max - 3;
    const pool = acts.filter(a => a.rating > zero);
    const total = pool.reduce((s, a) => s + a.rating - zero, 0);
    let r = Math.random() * total;
    for (const a of pool) { r -= a.rating - zero; if (r <= 0) return $data.skills[a.skill_id] || $data.skills[1]; }
    return $data.skills[pool[0].skill_id] || $data.skills[1];
  }
  // as VX Ace's action_valid?: its condition, and the skill usable - the MP it costs (enemies pay it too) and its
  // cool-down (script 141 applies to enemies as well)
  actionValid(e, a) { return this.actionCondition(e, a) && this.enemyCanUse(e, $data.skills[a.skill_id]); }
  enemyCanUse(e, s) {
    if (!s) return false;
    if (e.b.mp < Math.floor((s.mp_cost || 0) * e.b.mcr)) return false;
    const hp = e.b.skillHpCost(s);
    if (hp > 0 && e.b.hp <= hp) return false;                   // (script 128: not with the last of its HP)
    return !((e.cool?.[s.id] || 0) > G.time);
  }
  // an enemy goes for a skill: it pays the MP, the skill cools down, a boss's heal holds the next one back
  commitSkill(e, s) {
    if (!s) return;
    e.acted = s;
    e.b.mp = Math.max(0, e.b.mp - Math.floor((s.mp_cost || 0) * e.b.mcr));
    const hp = e.b.skillHpCost(s);
    if (hp > 0) { e.b.hp = Math.max(1, e.b.hp - hp); e.drawBar(); }
    const turns = coolTurns(s);
    if (turns) (e.cool ||= {})[s.id] = G.time + turns * COOL_TURN;
    if (e.boss && this.isHealSkill(s)) e.healReady = G.time + BOSS_HEAL_REST;
  }
  // a skill that brings HP back (a heal, a regeneration) to its user or its side
  isHealSkill(s) {
    if (!s) return false;
    if (s._heal === undefined) {
      const eff = s.effects || [];
      s._heal = s.scope >= 7 && s.scope <= 11 && (s.damage?.type === 3 || eff.some(ef => ef.code === 11 && (ef.value1 > 0 || ef.value2 > 0)) ||
        eff.some(ef => ef.code === 21 && ($data.states[ef.data_id]?.features || []).some(f => f.code === 22 && f.data_id === 7 && f.value > 0)));
    }
    return s._heal;
  }
  actionCondition(e, a) {
    const p1 = a.condition_param1, p2 = a.condition_param2;
    switch (a.condition_type) {
      case 1: { const n = e.turn; return p2 === 0 ? n === p1 : n > 0 && n >= p1 && n % p2 === p1 % p2; }
      case 2: { const r = e.b.hp / e.b.mhp; return r >= p1 && r <= p2; }
      case 3: { const r = e.b.mmp ? e.b.mp / e.b.mmp : 0; return r >= p1 && r <= p2; }
      case 4: return e.b.isState(p1);
      case 5: return (G.state.party.leader()?.level || 1) >= p1;
      case 6: return G.state.sw(p1);
      default: return true;
    }
  }
  // How an enemy's skill shows, by its own battle animation and name (the original's): 'lob' a bottle, a jar, a
  // dumpling, mud or a stone thrown in an arc onto where the player stood; 'gun' a shot from a rifle, a shotgun or a
  // pistol (fast, with a flash and a streak); 'knife' a knife or a hook thrown straight (fast, a streak); 'death' a death spell (a dark
  // circle that keeps to the player and settles a moment before it strikes); 'drain' life or mana drawn out (it
  // flows back into the one who drew it)
  skillLook(s) {
    if (!s) return null;
    if (s._look !== undefined) return s._look;
    const anim = $data.animations?.[s.animation_id]?.name || '';
    const name = (s.name || '').trim();
    let look = null;
    if (/油壷|火炎壷|毒団子|泥|投石|爆弾|瓶/.test(anim) || (/병\b|던지|투척|던져|壷|瓶|投げ|\b(?:bottle|jar|throw|toss|hurl)/i.test(name) && !/나이프|메스|メス|ナイフ|화살|\bknife/i.test(name))) look = 'lob';
    else if (/長銃|散弾|銃撃|ガンブレイク/.test(anim) || /발포|사격|저격|총격|건 ?브레이크|銃|\b(?:gun|rifle|pistol|musket)/i.test(name)) look = 'gun';
    else if (/投げナイフ/.test(anim) || /나이프|메스 투척|ナイフ|メス|\bknife/i.test(name)) look = 'knife';
    else if (/即死/.test(anim) || /^데스\d*$|멸혼|즉사|即死|\bdeath\b|\bdoom/i.test(name)) look = 'death';
    else if (/吸収|ドレイン/.test(anim) || /흡수|드레인|강탈|吸収|ドレイン|\b(?:drain|absorb|leech)/i.test(name)) look = 'drain';
    return (s._look = look);
  }
  // the colour of what a skill carries - its element, else the states it brings (none for a plain blow): motes of it
  // rise from its marked area while it winds up, and a death spell's dark
  skillFlavor(s) {
    if (!s) return null;
    if (s._flavor !== undefined) return s._flavor;
    const EL = { 2: 0xff5fd0, 3: 0xff7a28, 4: 0x9fe8ff, 5: 0xfff27a, 8: 0x7a9cff, 9: 0xffe9a8, 10: 0x9a4cff, 11: 0xd01830, 12: 0xff4a1a, 15: 0xfff27a, 18: 0x6fe05a };
    let c = this.skillLook(s) === 'death' ? EL[10] : EL[s.damage?.element_id];
    if (!c) {
      const names = (s.effects || []).filter(f => f.code === 21 && f.data_id > 1).map(f => $data.states[f.data_id]?.name || '').join(' ');
      if (/연소|화상|燃焼|火傷|\bburn/i.test(names)) c = EL[3];
      else if (/동창|동결|빙결|凍傷|凍結|\bfrost|\bfreez/i.test(names)) c = EL[4];
      else if (/독|毒|\bpoison|\bvenom/i.test(names)) c = EL[18];
      else if (/출혈|열상|出血|裂傷|\bbleed/i.test(names)) c = EL[11];
      else if (/수면|잠|睡眠|眠|\bsleep/i.test(names)) c = EL[8];
      else if (/공포|발광|처형|恐怖|発狂|処刑|\bfear|\bmadness/i.test(names)) c = EL[10];
      else if (/스턴|기절|スタン|気絶|\bstun/i.test(names)) c = EL[5];
      else if (/기름|油|\boil/i.test(names)) c = 0x9a7a3a;
    }
    return (s._flavor = c || null);
  }
  skillStyle(skill) {
    if (!skill || skill.id === 7 || /상황을 본다|웃|様子を見|笑|观察|\b(?:watch|laugh|grin)/i.test(skill.name)) return 'wait';
    if (skill.id === 2) return 'guard';
    const dmg = skill.damage?.type;
    if (skill.scope >= 7 && skill.scope <= 11) return dmg === 3 ? 'heal' : 'buff';
    if (dmg !== 1 && dmg !== 2 && dmg !== 5 && dmg !== 6) return skill.scope >= 1 && skill.scope <= 6 ? 'debuff' : 'wait';
    if (skill.hit_type === 2 || ['gun', 'knife'].includes(this.skillLook(skill)) || /활|화살|총|쏘|발사|던|弓|矢|銃|射|撃|投|箭|枪|\bbow\b|\b(?:arrow|gun|shoot|shot|throw|bullet)/i.test(skill.name)) return 'projectile';
    if (skill.scope === 2) return 'area';
    return 'melee';
  }

  enemyAI(e, dt, pc, attacking) {
    e.alertTime = Math.max(0, e.alertTime - dt);
    // a stage play between its acts (the curtain is up: everyone waits, as the original's battle waits for its
    // events), and its stage hands
    if (G.theater?.holds(e)) return attacking;
    // asleep / paralysed (not the Break stagger, which runs below)
    if (e.state !== 'stagger' && this.enemyRestricted(e)) {
      if (e.state === 'windup' || e.state === 'act') { e.state = 'recover'; attacking--; e.act = null; e.move = null; this.dropMarker(e); }
      e.timer = Math.max(e.timer - dt, 0.2);
      return attacking;
    }
    const dx = pc.fx - e.fx, dy = pc.fy - e.fy;
    const distT = Math.hypot(dx, dy);
    const distM = distT * T;
    const agi = e.b.agi;
    const speed = THREE.MathUtils.clamp(1.25 + agi / 70, 1.3, 3.4) * this.duelPace(e);
    e.timer -= dt;
    switch (e.state) {
      case 'idle':
      case 'chase': {
        e.state = 'chase';
        e.cooldown -= dt;
        // (a mount drawn in its rider's picture and the rider take turns: the other goes along - bossmoves.js updateMounts)
        if (e.pair && this.mountWaits(e)) break;
        // (back from the sky high up: down on the player with its next blow - bossmoves.js skyDive)
        if (e.diving && attacking < 2 && this.skyDive(e, dx, dy)) { attacking++; break; }
        const reach = (e.r * T) + 1.8 + (this.preferredRange(e) || 0);
        // (a boss's blows reach further: it starts one from further off - and still comes up close)
        const strike = e.boss ? Math.max(reach, e.r * T + BOSS_AREA.start) : reach;
        // a boss: a skill with a move of its own starts from wherever that move reaches (a charge from afar, a
        // leap, a shockwave, a rain of blows ...); its other skills wait until it is close
        // (in 흑기사 린다메아's duel every blow is one of her moves, one after another - no rest between moves, none of them made a
        // plain blow while the next move waits: inDuel)
        const duel = e.boss && this.inDuel(e);
        if (e.boss && e.alertTime <= 0 && e.cooldown <= 0 && attacking < 2 && (G.time >= (e.nextMove || 0) || duel)) {
          if (!e.pending) e.pending = this.chooseAction(e);
          const fam = this.bossFamilyFor(e, e.pending);
          if (fam && this.bossMoveFits(e, fam, distM, dx, dy, strike)) {
            e.skill = e.pending; e.pending = null;
            this.startBossMove(e, fam, dx, dy);
            attacking++;
            break;
          }
        }
        // (one that holds its place does what it does to itself - a charge, a song - from wherever it is)
        if (e.stationary && !e.pending && e.alertTime <= 0 && e.cooldown <= 0) e.pending = this.chooseAction(e);
        const own = e.stationary && !['melee', 'area', 'projectile', 'debuff'].includes(this.skillStyle(e.pending));
        const holdForMove = duel && !!this.bossFamilyFor(e, e.pending || (e.pending = this.chooseAction(e)));
        if (!holdForMove && e.alertTime <= 0 && e.cooldown <= 0 && (distM < strike + 0.3 || own) && attacking < 2) {
          e.move = null; e.comboStep = 0;
          e.skill = e.pending || this.chooseAction(e); e.pending = null;
          this.commitSkill(e, e.skill);
          e.style = this.skillStyle(e.skill);
          e.timer0 = e.timer = this.windupTime(e, e.skill, e.style);
          e.state = 'windup';
          e.aim = Math.atan2(dy, dx);
          e.ring.scale.setScalar(e.style === 'area' ? 3.0 / T : (e.r * T + 1.3) / 1.0);
          attacking++;
          // (waiting and guarding are its turn too, as in the original: the patterns that go by the turn - 빙폭의
          // 비스트 melting away on its fifth - go on. Running away is a skill of its own on itself: wound up, then gone)
          if (e.style === 'wait') { e.state = 'recover'; e.timer = 0.8; attacking--; if (this.actionDone(e)) e.timer = FOLLOW_REST; }
          if (e.style === 'guard') { e.state = 'guard'; e.timer = 1.6; attacking--; e.b.addState(9); this.actionDone(e); }
          if (e.state === 'windup') this.beginTelegraph(e);
          break;
        }
        // move: keep some distance for ranged attackers (one that holds its place - a stage machine hanging over
        // the stage, a prison floating in it - stays where the play put it)
        const keep = this.preferredRange(e);
        if (!e.stationary && (distM > reach - 0.2 || (keep && distM > keep))) {
          e.pathTimer -= dt;
          let tx = pc.fx, ty = pc.fy;
          if (!this.throughWalls() && !lineOfSight(e.fx, e.fy, pc.fx, pc.fy)) {
            if (e.pathTimer <= 0 || !e.path) { e.path = nextStep(e.fx, e.fy, pc.fx, pc.fy, 30); e.pathTimer = 0.4; }
            if (e.path) { tx = e.path.x; ty = e.path.y; }
          } else e.path = null;
          this.moveEnemyToward(e, tx, ty, speed * dt / T);
        }
        break;
      }
      case 'windup': {
        // the area was laid down as the wind-up began and stays where it is: stepping out of it dodges the
        // blow. Sure-hit attacks keep locked on, and so does a plain shot until it is fired: its line turns after
        // the player (up to the first wall that way) and the shot goes where it points then
        if (e.plan?.certain) e.aim = Math.atan2(dy, dx);
        else if (e.plan?.shot && !e.move) this.aimShot(e, Math.atan2(dy, dx));
        e.moveT = (e.moveT || 0) + dt;
        if (e.move === 'leap') this.updateLeap(e);
        this.newWindup(e, dt);                       // (the far orb: backing off up into the air - bossmoves.js)
        this.updateTelegraph(e);
        if (e.timer <= 0 && e.move && e.move !== 'flurry') { this.releaseBossMove(e); break; }
        if (e.timer <= 0) {
          this.executeAttack(e, distM, dx, dy); this.dropMarker(e);
          if (e.state === 'dying' || e.state === 'dead') break;       // (it fell by its own skill: 빙폭의 비스트 melting away)
          if (!this.chainNext(e)) {
            const more = this.actionDone(e);
            if (e.state !== 'dying' && e.state !== 'dead') { e.state = 'recover'; e.timer = more ? FOLLOW_REST : (0.55 + Math.random() * 0.4) / this.actionPace(e); }
          }
        }
        break;
      }
      case 'act': this.updateBossAct(e, dt); break;
      case 'guard':
      case 'recover':
      case 'stagger':
        if (e.timer <= 0) {
          if (e.state === 'stagger') { e.b.removeState(8); e.b.removeState(7); this.groggyRefill(e); }
          if (e.state === 'guard') e.b.removeState(9);
          e.state = 'chase';
          e.cooldown = e.quick ? 0.1 : (0.5 + Math.random() * 1.0) / this.actionPace(e);      // (right after a quick step: at once)
          e.quick = false;
          e.drawBar();
        }
        break;
      default: break;
    }
    return attacking;
  }
  // a plain shot winding up turns after the player; its line reaches as far as it can fly that way
  aimShot(e, a) {
    const plan = e.plan;
    if (plan.ox === undefined) return;
    e.aim = plan.aim = a;
    plan.len = this.clearRun(plan.ox, plan.oz, a, plan.oy + (e.h || 1.8) * 0.6, plan.full || 20);
    e.marker?.setLength?.(plan.len);
  }
  // how long an attack winds up, before its beat (beginTelegraph): by its kind, the skill's speed (VX Ace speed
  // correction, negative = slower), big or multi hits and the enemy's agility
  windupTime(e, skill, style) {
    let t = { melee: 1.1, area: 1.6, projectile: 1.3, debuff: 1.3, heal: 0.8, buff: 0.65 }[style] ?? 1.1;
    if (/\* ?[5-9]/.test(skill?.damage?.formula || '') || (skill?.repeats || 1) > 1) t *= 1.3;
    t *= THREE.MathUtils.clamp(1 - (skill?.speed || 0) / 300, 0.7, 1.6);
    t *= THREE.MathUtils.clamp(90 / (e.b.agi + 50), 0.75, 1.3);
    return t;
  }
  // how far a straight line from (x, z) heading a (world atan2(dz, dx)) runs before a wall rises above height
  // y on it (metres, at most max)
  // (a raised floor - a plateau over a canyon, a gallery - rising above it stops it as a wall does: its side is a cliff)
  clearRun(x, z, a, y, max) {
    const step = 0.25 * T, ca = Math.cos(a), sa = Math.sin(a);
    const sx = Math.round(x / T - 0.5), sz = Math.round(z / T - 0.5);
    for (let d = step; d < max + step; d += step) {
      const dd = Math.min(d, max);
      const tx = Math.round((x + ca * dd) / T - 0.5), ty = Math.round((z + sa * dd) / T - 0.5);
      if (!G.map.validW(tx, ty)) return Math.max(step, dd - step);
      if (tx === sx && ty === sz) continue;
      if ((G.solidTopAt?.(tx, ty) ?? -Infinity) * T > y || (G.floorAt?.(tx, ty) ?? -Infinity) > y) return Math.max(step, dd - step * 0.5);
      if (dd >= max) break;
    }
    return max;
  }
  // how far a body runs straight on from where it stands (metres, at most max) before an edge nobody walks across stops it -
  // a wall, a cliff's edge, water (collision.js lineOfSight, the original's passage): a charge, a lance's dash never go through
  walkRun(e, a, max) {
    const step = 0.25 * T, ca = Math.cos(a), sa = Math.sin(a);
    let ok = 0;
    for (let d = step; d <= max + 1e-6; d += step) {
      if (!lineOfSight(e.fx, e.fy, e.fx + ca * d / T, e.fy + sa * d / T)) break;
      ok = d;
    }
    return Math.max(ok, Math.min(max, step));
  }
  // a string of blows: now and then a melee blow is followed by one or two more, each quickly telegraphed
  // and aimed again (more often for nimble enemies; never after a heavy blow)
  chainNext(e) {
    // a boss's flurry: as many blows as its skill has hits, the boss stepping in before each
    if (e.move === 'flurry') {
      if (!e.alive || e.state !== 'windup' || this.playerDead || ++e.comboStep >= e.comboLen) { this.endFlurry(e); return false; }
      const pc = G.map.playerChar;
      if (Math.hypot(pc.fx - e.fx, pc.fy - e.fy) * T > e.r * T + 1.2) this.moveEnemyToward(e, pc.fx, pc.fy, 0.5 / T);
      e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);
      e.timer0 = e.timer = 0.42 + Math.random() * 0.18;
      this.beginTelegraph(e);
      return true;
    }
    if (e.countering) { e.countering = false; e.comboStep = 0; e.counterDone = true; return false; }
    if (!e.alive || e.state !== 'windup' || e.style !== 'melee' || e.plan?.certain || e.plan?.heavy || this.playerDead) { e.comboStep = 0; return false; }
    if (!e.comboStep) e.comboLen = Math.random() < THREE.MathUtils.clamp(0.18 + e.b.agi / 600, 0.18, 0.45) ? (Math.random() < 0.35 ? 3 : 2) : 1;
    e.comboStep = (e.comboStep || 0) + 1;
    if (e.comboStep >= e.comboLen) { e.comboStep = 0; return false; }
    e.timer0 = e.timer = 0.42 + Math.random() * 0.18;
    const pc = G.map.playerChar;
    e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);      // each blow is laid down where the player is now
    this.beginTelegraph(e);
    return true;
  }
  // heavy blows - a physical skill hitting far harder than a plain attack (atk x6 and more; a plain attack is
  // x4) - cannot be guarded: pink on the floor, a little slower to come; dodge it or get out of it
  isHeavySkill(skill) {
    if (skill._heavy === undefined) {
      const m = /a\.atk\s*\*\s*([\d.]+)/.exec(skill.damage?.formula || '');
      skill._heavy = skill.hit_type === 1 && skill.damage?.type === 1 && !!m && +m[1] >= 6;
    }
    return skill._heavy;
  }
  preferredRange(e) {
    const ranged = (e.data.actions || []).some(a => this.skillStyle($data.skills[a.skill_id]) === 'projectile');
    return ranged ? 4.5 : 0;
  }
}
