// The fights in co-op (coop.js): the host's enemies told to its guests, and what the guests' blows do to them.
import * as THREE from 'three';
import { PART_MOVES } from '../bossmoves.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { FloorMarker, MARK } from '../telegraph.js';
import { ActionEnemy, GROGGY } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class CoopPart {
  // ---- co-op (coop.js): the host's enemies for its guests, and what the guests' blows do to them ------------------
  // the enemies a host's guests see: the bodies standing or falling on this map
  netEnemies() {
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean)).filter(e => e.mesh && e.state !== 'dead' && !e.private);
  }
  // (guest) the host's enemies as just sent: a body for each (made, changed or put away to match), where the host's
  // is, as hurt and as broken as it is - except what a blow of this guest's changed a moment ago and the host has not
  // taken yet (it would flicker back)
  applyPuppets(list, src = null) {
    // (src: a player whose hallucinations these are - coop.js onHallEnemies - kept apart from the map runner's)
    const seen = new Set(), keyOf = id => (src ? `h:${src}:${id}` : id);
    for (const n of list) {
      if (n.keep) { seen.add(keyOf(n.keep)); continue; }          // (its entry was not taken this time: as it was)
      seen.add(keyOf(n.id));
      let e = this.puppets.get(keyOf(n.id)), lookAs = 0;
      if (e && e.b.enemyId !== n.enemyId) {
        // (into a form with no picture from one with a picture: up in the sky, as the form it was - transformEnemy)
        const was = e.lookAs || e.b.enemyId;
        if (!$data.enemies[n.enemyId]?.battler_name && $data.enemies[was]?.battler_name) lookAs = was;
        e.remove(); e = null;
      }
      // (a player of the host's stage play - 8 - is drawn as the play draws it, by its place in the troop: one that
      // came into the play, or into another place in it, is drawn anew)
      const inPlay = !!(n.flags & 8);
      if (e && (!!e.inPlay !== inPlay || (inPlay && e.memberIndex !== n.mi))) { e.remove(); e = null; }
      if (!e) {
        e = new ActionEnemy(this, null, n.enemyId, n.fx, n.fy, { dormant: true, inPlay, memberIndex: n.mi, lookAs });
        e.puppet = true; e.netId = n.id;
        if (src) { e.src = src; e.private = true; }
        this.puppets.set(keyOf(n.id), e);
      }
      if (src) e.hallKey = n.hallKey;
      e.netFlags = n.flags;
      e.netX = n.fx; e.netY = n.fy; e.hover = n.hover;
      if (!this.puppetMoves(e)) e.lift = n.lift;             // (a leap going on here lifts it itself)
      e.hidden = !!(n.flags & 1);
      e.battle = n.flags & 2 ? this.puppetBattle : null;
      // (a roaming boss whose fight has not begun: out of this guest's reach unless the rules let a guest begin it; one
      // of a boss fight this guest did not join: neither strikes the other - 128)
      e.outOfFight = !!(n.flags & 128);
      e.noTarget = !!(n.flags & 4) || (!!(n.flags & 64) && !G.coop?.rules?.guestStartsBoss) || e.outOfFight;
      e.boss = !!(n.flags & 32);
      // (a boss made stronger for its co-op fight - coop.js scaleBosses: its HP, MP and groggy gauge as big as there)
      if ((e.b.coopK || 1) !== n.k) { e.b.coopK = n.k; e.grogId = null; }
      const fresh = G.time - (e.netReported ?? -9) < 0.6;
      const dying = n.state === 'dying' || n.state === 'dead';
      if (dying) {
        if (e.state !== 'dying' && e.state !== 'dead') { this.puppetEnd(e); e.state = 'dying'; e.timer = 0; e.fadeOnly = !!(n.flags & 16); if (e.bar) e.bar.visible = false; }
      } else {
        if (e.state === 'dying' || e.state === 'dead') {
          e.group.visible = true;
          if (e.mat) { e.mat.opacity = 1; e.mat.color.setRGB(1, 1, 1); }
          if (e.mesh) e.mesh.position.y = 0;
        }
        // (a move of the host's going on here plays out - unless the host's was cut short: broken, fallen)
        const own = e.state === 'act' && !!e.act && G.time < (e.actUntil || 0) && n.state !== 'stagger';
        if ((!fresh && !own) || e.state === 'dying' || e.state === 'dead') {
          e.state = n.state;
          if (n.state !== 'windup' && n.state !== 'act' && (e.move || e.act || e.marker)) this.puppetEnd(e);
        }
        // (a plain shot winding up turns after its target there: its line here too)
        if (n.aim !== null && e.state === 'windup' && e.plan?.shot && !e.move && e.plan.ox !== undefined) this.aimShot(e, n.aim);
        e.b.hp = fresh ? Math.min(e.b.hp, n.hp) : n.hp;
        if (!fresh) e.b.states = n.states.slice();
        const gmax = this.groggyMax(e);
        if (gmax && !fresh) e.grog = gmax * n.grog / 100;
        if (e.bar) e.bar.visible = !!e.battle && !e.hidden;
      }
      e.drawBar();
      e.netBase = this.puppetSnap(e);
    }
    for (const [id, e] of this.puppets) if ((e.src || null) === src && !seen.has(id)) { e.remove(); this.puppets.delete(id); }
  }
  puppetSnap(e) { return { hp: e.b.hp, states: [...e.b.states], grog: e.grog || 0, state: e.state }; }
  // (guest) what this guest's own blows, shots and spells did to the host's enemies since the last look - every frame:
  // nothing else changes a puppet. [{ id, d: HP taken, add / rm: states, g: groggy taken, brk: a Break (7 / 8), big: the
  // big attack that ends one }]
  puppetReports() {
    const out = [];
    for (const e of this.puppets.values()) {
      const b = e.netBase;
      if (!b || e.state === 'dying' || e.state === 'dead') continue;
      const now = this.puppetSnap(e);
      const brk = now.state === 'stagger' && b.state !== 'stagger' ? (now.states.includes(7) ? 7 : 8) : 0;
      const big = b.state === 'stagger' && now.state !== 'stagger';
      const skip = id => id === 1 || ((brk || big) && (id === 7 || id === 8));
      const add = now.states.filter(id => !b.states.includes(id) && !skip(id));
      const rm = b.states.filter(id => !now.states.includes(id) && !skip(id));
      const d = Math.round(b.hp - now.hp), g = Math.round(Math.max(0, b.grog - now.grog));
      if (d || add.length || rm.length || g > 0 || brk || big) {
        out.push({ id: e.netId, src: e.src || null, d, add, rm, g, brk, big });
        e.netReported = G.time;
      }
      e.netBase = now;
    }
    return out;
  }
  // (host) a guest's blow on one of this world's enemies: taken as if it had struck here - its numbers in the friend's
  // colour, the fight started if it was roaming, a Break, the groggy gauge, states, the fall
  applyGuestHit(r, from = null) {
    const e = this.netEnemies().find(x => x.netId === r.id) || this.hallEnemyFor(r.id, from);
    if (!e || !e.alive || e.hidden) return false;
    // (a boss fight that guest did not join, or watches fallen)
    if (e.battle?.coopIn && (!e.battle.coopIn.has(from) || e.battle.coopDead?.has(from))) return false;
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      // (a roaming boss: a guest's blow begins its fight only by the server's rules - else the host goes in first)
      if (sym && !G.coop?.rules?.guestStartsBoss && this.symbolIsBoss(sym)) return false;
      if (sym && this.leadBoss(sym)) { this.engage(sym.ev, true); return false; }      // (the host is asked first)
      if (sym) this.engage(sym.ev, true);
    }
    const p = e.worldPos(new THREE.Vector3());
    if (r.d) {
      const d = Math.max(-e.b.mhp, Math.min(e.b.mhp, r.d));
      e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp - d));
      e.flash = 0.18; if (e.bar) e.bar.visible = true;
      if (d > 0) {
        this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(d), '#bfe4ff');
        G.audio?.playSe(G.seAt('Slash1', 70, 100), new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z));
        this.damageRemovesStates(e);
      }
    }
    for (const id of r.add) if ($data.states[id] && !e.b.stateResist(id)) this.addEnemyState(e, id, true);
    for (const id of r.rm) { e.b.removeState(id); if (e.stateTimers) delete e.stateTimers[id]; }
    if (r.g > 0 && this.groggyMax(e) && e.state !== 'stagger') {
      e.grog = Math.max(0, e.grog - Math.min(r.g, GROGGY.cap * e.grogMax));
      e.grogT = G.time;
      if (e.grog <= 0) e.grogDown = true;
    }
    if (r.brk && e.state !== 'stagger') this.breakEnemy(e, r.brk);
    if (r.big) this.endStagger(e);
    e.drawBar();
    this.checkEnemyDeath(e);
    return true;
  }
  // (the developer's world) a hallucination this player runs that the one who struck it sees too
  hallEnemyFor(id, from) {
    if (!G.coop?.world || !from) return null;
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean))
      .find(e => e.private && e.netId === id && e.mesh && e.state !== 'dead' && G.coop.peerSees(from, e.hallKey)) || null;
  }
  // (guest) a copy of the host's enemy moving here on its own, as the host's does there: through the air in a leap, in
  // a charge and the bounce back off what it ran into (anywhere else it is eased to where the host says it is)
  puppetMoves(e) {
    return (e.state === 'windup' && e.move === 'leap' && !!e.plan?.jumped) || (e.state === 'act' && (e.act?.kind === 'dash' || e.act?.kind === 'recoil'));
  }
  // (guest) the host's enemy's move is over (or was cut short): so is its copy's
  puppetEnd(e) {
    this.dropMarker(e);
    this.hideBlade(e);
    e.move = null; e.act = null; e.plan = null;
  }
  // (guest) a boss's move of the host's goes off: here as there, but only to be seen - whom it strikes the host says
  // (onHurt). A move made of parts needs them; a flurry is plain blows (puppetAct)
  puppetRelease(e) {
    const plan = e.plan, fam = e.move;
    if (!plan || !fam || fam === 'flurry' || !e.alive || e.state !== 'windup') return false;
    if (['rain', 'volley', 'dice', 'cross', 'field', 'chess', ...PART_MOVES].includes(fam) && !Array.isArray(plan.parts)) return false;
    if (['pursuit', 'orbs'].includes(fam) && !(plan.n > 0)) return false;
    e.timer = 0;
    e.actUntil = G.time + 3.5;
    this.releaseBossMove(e);
    return true;
  }
  // (guest) up in the air: where the host's boss comes down, marked from now on (as the host's own updateLeap does)
  puppetLeap(e, at) {
    const plan = e.plan;
    if (!plan || e.move !== 'leap' || plan.jumped || e.state !== 'windup') return false;
    Object.assign(plan, { jumped: true, sx: at.sx, sy: at.sy, jumpAt: at.j, height: at.h, cx: at.cx, cz: at.cz });
    this.dropMarker(e);
    e.marker = new FloorMarker(this.root, { ...plan, color: MARK.heavy, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    return true;
  }
  // (guest) the host's charging boss ran into the host there: it stops and bounces back here too
  puppetImpact(e, fx, fy) {
    if (!e.alive) return;
    const aim = e.plan?.aim ?? e.aim ?? 0;
    const a = e.act?.kind === 'dash' ? e.act : { ca: Math.cos(aim), sa: Math.sin(aim) };
    e.fx = fx; e.fy = fy;
    e.state = 'act'; e.move ||= 'charge'; e.actUntil = G.time + 2;
    this.chargeImpact(e, a, false);
  }
  // (guest) one of the host's enemies does its plain move (a blow, a blast, a shot): its animation, its sounds, its shots
  // flying - only to be seen (aim: where a shot's line turned to by the end)
  puppetAct(e, skill, aim = null) {
    if (!e.alive) return;
    e.skill = skill; e.style = this.skillStyle(skill);
    if (aim !== null && e.plan?.shot) { e.plan.aim = aim; e.aim = aim; }
    try { this.executeAttack(e, 0, 0, 0); } finally { this.dropMarker(e); }
  }
}
