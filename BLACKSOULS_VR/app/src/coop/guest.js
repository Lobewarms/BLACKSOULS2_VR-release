// Co-op, a guest's side: coming into the host's world, being shown it as the host has it, the host's enemies as puppets,
// its own blows and falls told to the host, going home.
import * as THREE from 'three';
import { resolveAudio, resolveImage } from '../assets.js';
import { NO_H_SWITCH, animationAt, isRef, pictureAt, sayAt, soundAt } from '../coopguard.js';
import { takeRules } from '../coopnet.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { exitOf } from '../interpreter.js';
import { T } from '../mapmesh.js';
import { GameState } from '../state.js';
import { BOSS_CALL_WAIT, BOSS_MOVES, FILE_NAME, FX_PER_SEND, HAZARD_GAP, HITS_PER_SECOND, MAX_LIST, PLAN_FLAGS,
  PLAN_NUMS, PLAN_SHAPES, PROTO, SELF_KEY, applyWorld, bonfireOf, checkFx, checkPic, checkPlace, checkWorld, hazardOf,
  isInt, isList, isNum, isSenSwitch, isSenVar, isStr, isValue, now, okSwitch, waitFor } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class GuestPart {
  // ---- guest -----------------------------------------------------------------------------------------------------
  onWelcome(m, from) {
    if (m.v !== PROTO || !this.ready()) return;
    const world = checkWorld(m.world), place = checkPlace(m.map);
    if (!world || !place) return;
    if (m.r && !this.link?.rules) this.localRules = takeRules(m.r);
    if (m.st) this.onStats(m.st);
    this.hostId = from;
    const p = this.peerFor(from, true);
    if (!p) return;
    p.host = true;
    this.lookKey = '';
    this.summon(world, place);
  }
  // into the host's world: the guest's own game is kept as it is, and a copy of it - its party, gear and things -
  // goes, in a world with the host's switches, to beside the host
  summon(world, place) {
    G.combat.reset();                    // (a fight of its own left unfinished ends in its own world, as on leaving a map)
    const pc = G.map.playerChar;
    this.home = { state: G.state, mapId: G.map.mapId, x: pc.x, y: pc.y, dir: pc.direction || 2 };
    this.restAt = null;                  // (no bonfire of the host's world rested at yet)
    this.scrOf.clear(); this.authNow = undefined; this.leadsNow = false;     // (nothing of this world's screens known yet)
    this.bossCall = null; this.bossGo = null;
    const st = GameState.fromJSON(JSON.parse(JSON.stringify(G.state.toJSON())));
    applyWorld(st, world);
    G.map.interpreter.clear();
    G.map.reservedCommon = [];
    this.summoned = true;
    G.enterWorld(st, { mapId: place.m, x: place.x, y: place.y, dir: place.d });
    console.info('[coop] in the host\'s world');
  }
  goHome() {
    const h = this.home;
    this.home = null;
    this.summoned = false;
    if (!h || !G.enterWorld) return;
    G.combat.reset({ keepState: true });
    G.map.interpreter.clear();
    G.map.reservedCommon = [];
    G.enterWorld(h.state, { mapId: h.mapId, x: h.x, y: h.y, dir: h.dir });
    console.info('[coop] back home');
  }
  onMap(m) {
    const place = checkPlace(m);
    if (place) this.follow = place;
  }
  onFlags(m) {
    const ok = (a, test) => isList(a, MAX_LIST) && a.every(e => Array.isArray(e) && e.length === 2 && test(e));
    if (!ok(m.S, e => okSwitch(e[0]) && (e[1] === 0 || e[1] === 1))) return;
    if (!ok(m.V, e => okSwitch(e[0]) && isValue(e[1]))) return;
    if (!ok(m.SS, e => typeof e[0] === 'string' && SELF_KEY.test(e[0]) && (e[1] === 0 || e[1] === 1))) return;
    const st = G.state;
    // (switch 20 stays on here - applyWorld; SEN stays this guest's own)
    for (const [id, v] of m.S) if (id !== NO_H_SWITCH && !isSenSwitch(id)) st.setSw(id, !!v);
    for (const [id, v] of m.V) if (!isSenVar(id)) st.setV(id, v);
    for (const [key, v] of m.SS) { const [mapId, evId, ch] = key.split(','); st.setSelfSw(+mapId, +evId, ch, !!v); }
  }
  // the host's events on this map: where they stand, how they look (character.js followNet moves them there)
  onEvents(m) {
    if (m.m !== G.map.mapId || !isList(m.e, 5000) || !this.ready()) return;
    for (const e of m.e) {
      if (!Array.isArray(e) || e.length !== 11 || !isInt(e[0], 1, 99999)) continue;
      const [id, x, y, dir, pattern, opacity, flags, name, index, tileId, balloon] = e;
      const ev = G.map.events[id];
      if (!ev || !isNum(x, 1e4) || !isNum(y, 1e4) || ![2, 4, 6, 8].includes(dir) || !isInt(pattern, 0, 3) || !isInt(opacity, 0, 255)
        || !isInt(flags, 0, 255) || typeof name !== 'string' || !isInt(index, 0, 7) || !isInt(tileId, 0, 99999) || !isInt(balloon, 0, 32)) continue;
      const sheet = name && FILE_NAME.test(name) && resolveImage('Graphics/Characters', name) ? name : '';
      if (!ev.net) { ev.realX = x; ev.realY = y; }
      ev.net = { x, y, dir, pattern, opacity, hidden: !!(flags & 1), gone: !!(flags & 2), name: sheet, index, tileId, balloon };
    }
  }
  // the mark of a move one of the host's enemies is winding up (combat.js puppetTelegraph)
  onMark(m, from) {
    const e = this.puppetOf(m.id, from);
    const q = m.p;
    if (!e || !q || typeof q !== 'object' || !PLAN_SHAPES.includes(q.shape) || !isNum(m.t0, 60) || m.t0 <= 0) return;
    const plan = { shape: q.shape };
    for (const k of PLAN_NUMS) if (q[k] !== undefined) { if (!isNum(q[k], 1e5)) return; plan[k] = q[k]; }
    for (const k of PLAN_FLAGS) if (q[k] === 1) plan[k] = true;
    if (q.move !== undefined) { if (!BOSS_MOVES.has(q.move)) return; plan.move = q.move; }
    if (q.shape === 'multi') {
      if (!isList(q.parts, 24)) return;
      plan.parts = [];
      for (const s of q.parts) {
        if (!s || !['circle', 'line'].includes(s.shape) || !['x', 'y', 'z', 'r', 'aim', 'len', 'width'].every(k => isNum(s[k], 1e5))) return;
        // (a part's own moment: a lattice's second way, the next bands - bossmoves.js)
        if (s.at !== undefined && !isNum(s.at, 10)) return;
        plan.parts.push({ shape: s.shape, x: s.x, y: s.y, z: s.z, r: s.r, aim: s.aim, len: s.len, width: s.width, ...(s.at !== undefined ? { at: s.at } : {}) });
      }
    }
    if (plan.n !== undefined && !isInt(plan.n, 1, 12)) return;
    if (q.cap !== undefined) { if (!isInt(q.cap, 0, 12)) return; plan.cap = { left: q.cap }; }
    const skill = isInt(m.s, 1, 99999) ? $data.skills[m.s] || null : null;
    const other = typeof m.who === 'string' && m.who.length <= 40 ? this.peerTarget(m.who) : null;
    G.combat.puppetTelegraph(e, plan, m.t0, m.me === 1, skill, other);
  }
  // (guest) another guest as this one sees it, for a move of the host's enemy that goes for it (its mark follows it,
  // its shots fly at it - combat.js puppetTelegraph)
  peerTarget(id) {
    const p = this.peers.get(id);
    if (!p || p.host) return null;
    return (p.target ||= { get stands() { return !!p.avatar?.cur; }, alive: true, away: true,
      chest: out => { const c = p.avatar?.cur; return c ? out.set(c.x, c.y - 0.6, c.z) : this.hostChest(out) || G.player.headWorld(out); } });
  }
  onMarkEnd(m, from) {
    const e = this.puppetOf(m.id, from);
    if (!e) return;
    G.combat.dropMarker(e);
  }
  // one of the host's enemies does its plain move: its animation, sounds and shots here too, where it goes off
  onAct(m, from) {
    const e = this.puppetOf(m.id, from);
    const s = isInt(m.s, 1, 99999) ? $data.skills[m.s] : null;
    if (!e || !s || (m.a !== null && m.a !== undefined && !isNum(m.a, 100))) return;
    try { G.combat.puppetAct(e, s, m.a ?? null); } catch (err) { console.warn('[coop] act', err); }
  }
  // a boss of the host's up in the air (where it comes down), its move going off, its charge stopped on the host
  onLeapMsg(m, from) {
    const e = this.puppetOf(m.id, from);
    if (!e || !['cx', 'cz', 'sx', 'sy'].every(k => isNum(m[k], 1e5)) || !isNum(m.j, 60) || !isNum(m.h, 20) || m.h <= 0) return;
    G.combat.puppetLeap(e, { cx: m.cx, cz: m.cz, sx: m.sx, sy: m.sy, j: m.j, h: m.h });
  }
  onBossMoveMsg(m, from) {
    const e = this.puppetOf(m.id, from);
    if (!e) return;
    try { G.combat.puppetRelease(e); } catch (err) { console.warn('[coop] boss move', err); }
  }
  onImpactMsg(m, from) {
    const e = this.puppetOf(m.id, from);
    if (!e || !isNum(m.x, 1e4) || !isNum(m.y, 1e4)) return;
    try { G.combat.puppetImpact(e, m.x, m.y); } catch (err) { console.warn('[coop] impact', err); }
  }
  // the host's boss fight closed the arena: its fog closes the way out here too (the same cells, worked out from this
  // map), a dark round where the fight began opens the same
  onArenaMsg(m) {
    if (m.m !== G.map.mapId || !this.ready() || !isInt(m.ev, 0, 99999) || !isInt(m.x, 0, 999) || !isInt(m.y, 0, 999)) return;
    G.arena?.release();
    G.arena?.begin({ event: G.map.events[m.ev] || null, remote: true }, { fx: m.x, fy: m.y });
  }
  // what the one running this map shows (say / sayx, pic, fx): one after another as they came - one may wait for the
  // data of the map its event stands on (coopguard.js) - and only while that one still runs this map
  inOrder(m, from) {
    this.showQ = (this.showQ || Promise.resolve()).then(() => this.onShow(m, from)).catch(e => console.warn('[coop] show', e?.message || e));
  }
  async onShow(m, from) {
    if (m.t === 'sayx') { if (this.fromAuthority(from)) G.ui.closeRemoteMessage?.(); return; }
    if (m.t === 'say') return this.onSayMsg(m, from);
    if (m.t === 'pic') return this.onPicMsg(m, from);
    if (m.t === 'fx') return this.onFxMsg(m, from);
  }
  // what the host is reading: the game's own message where it says, put up here from this game's own copy - only to
  // read (ui.js showRemoteMessage) - or a big banner
  async onSayMsg(m, from) {
    if (!isRef(m.src) || (m.vis != null && !isList(m.vis, 64)) || (m.name !== undefined && !isStr(m.name, 40))) return;
    const say = await sayAt(m.src, { names: m.nm, vis: m.vis, name: m.name || '' });
    if (!say || !this.fromAuthority(from)) return;
    if (say.banner) G.ui.showBanner?.(say.banner.text, say.banner.color, false);
    else G.ui.showRemoteMessage?.(say);
  }
  // the host's pictures (pictures.js), as they are there - a picture shown only as the game's own Show Picture where it
  // says shows it (coopguard.js), else none
  async onPicMsg(m, from) {
    if (!isList(m.l, 100)) return;
    for (const raw of m.l) {
      const o = checkPic(raw), P = G.pictures;
      if (!o || !P) continue;
      if (o.o === 'e') { P.erase(o.n); continue; }
      if (o.o === 's') {
        const name = await pictureAt(o.src);
        if (!this.fromAuthority(from)) return;
        if (name === null || (name && !resolveImage('Graphics/Pictures', name))) { P.erase(o.n); continue; }
        P.show([o.n, name, o.org, 0, o.x, o.y, o.zx, o.zy, o.op, o.bl]);
        const mv = raw.mv ? checkPic(raw.mv) : null;
        if (mv?.o === 'm' && mv.n === o.n) P.move([mv.n, '', mv.org, 0, mv.x, mv.y, mv.zx, mv.zy, mv.op, mv.bl, mv.d]);
        continue;
      }
      P.move([o.n, '', o.org, 0, o.x, o.y, o.zx, o.zy, o.op, o.bl, o.d]);
    }
  }
  // the sounds, animations and flashes of the host's events - a sound or an animation only as the game's own command
  // where it says plays it (coopguard.js)
  async onFxMsg(m, from) {
    if (!isList(m.l, FX_PER_SEND)) return;
    for (const raw of m.l) {
      const f = checkFx(raw);
      if (!f) continue;
      if (f[0] === 'fl') { G.screen.startFlash({ red: f[1], green: f[2], blue: f[3], alpha: f[4] }, f[5]); continue; }
      if (f[0] === 'an') {
        const anim = await animationAt(f[2]);
        if (!anim || !$data.animations?.[anim] || !this.fromAuthority(from)) continue;
        // (on one of the map's people - its copy here - or on the host)
        const ev = f[1] ? G.map.events[f[1]] : null, host = f[1] ? null : this.hostChest(new THREE.Vector3());
        if (ev) G.screen.playAnimationOn(ev, anim);
        else if (host) G.screen.playAnimationOn(host.setY(host.y + 0.3), anim, { world: true });
        continue;
      }
      const a = await soundAt(f[1], f[0] === 'se' ? 250 : 249);
      if (!a || !resolveAudio(f[0] === 'se' ? 'Audio/SE' : 'Audio/ME', a.name) || !this.fromAuthority(from)) continue;
      if (f[0] === 'se') G.audio?.playSe(a); else G.audio?.playMe(a);
    }
  }
  // (guest) this player stepped on, spoke to or ran into an event of the host's world that begins a boss fight
  // (player.js): if the server's rules let a guest begin one, the host is asked to (onBossAsk); else nothing happens,
  // as before - the host goes in first
  // (guest) the player stepped on / bumped into / acted on events of the host's world (player.js): a boss fight there
  // may be asked for (askBossStart); a trap of it hurts this player (phantomHazard); and, the rule guestsFollow off, a
  // way out of the map takes it where it leads (phantomExit). Nothing else of them runs for a guest
  phantomTouch(evs, how) {
    if (!this.phantom || this.spectating) return false;
    if (this.askBossStart(evs, how)) return true;
    const live = evs.filter(ev => ev && ev.list && !ev.erased && !ev.net?.gone);       // (an unseen trigger is still there)
    if (how !== 'action') for (const ev of live) if (this.phantomHazard(ev)) return true;
    if (how === 'action') for (const ev of live) if (this.phantomBonfire(ev)) return true;
    if (!this.rules.guestsFollow) for (const ev of live) if (this.phantomExit(ev)) return true;
    return false;
  }
  // (guest) a bonfire of the host's world (an event calling one of the bonfire common events, 篝火): it rests there - the
  // fire's sound and flash, whole again, its bottles filled as its own game fills them (their counts are its own) - and
  // comes back here when it falls (respawn). Nothing of the host's world changes (no enemies back, no switches). Going its
  // own way (the rule guestsFollow off) it may travel on from it to another bonfire, as the original offers
  phantomBonfire(ev) {
    const ce = bonfireOf(ev.list);
    if (!ce) return false;
    const party = G.state.party;
    if (!party.leader() || G.combat.playerDead) return true;
    const own = this.home?.state || G.state;
    for (const c of ce.list) {
      if (c.indent !== 0) continue;
      const p = c.parameters;
      if (c.code === 250) G.audio?.playSe(p[0]);
      else if (c.code === 224) G.screen.startFlash(p[0], p[1]);
      else if (c.code === 314) for (const a of party.members()) a.recoverAll();
      else if (c.code === 126 && $data.items?.[p[0]]) {
        const n = Math.max(0, p[2] === 0 ? +p[3] || 0 : +own.v(p[3]) || 0);
        party.gainItem('item', p[0], p[1] === 0 ? n : -n);
      }
    }
    const pc = G.map.playerChar;
    this.restAt = { m: G.map.mapId, x: pc.x, y: pc.y };
    console.info('[coop] the guest rested at a bonfire:', G.map.mapId, pc.x, pc.y);
    // (the list comes up a moment later: the press that rested here would pick its first row at once - 도서관의 꿈)
    if (!this.rules.guestsFollow && ce.list.some(c => c.code === 355 && /Scene_ShortMove/.test(c.parameters[0]))) {
      setTimeout(() => {
        if (this.phantom && !G.combat.playerDead && !G.ui.msg && !G.ui.menuOpen && !G.ui.sceneOpen && !G.map.transferring) G.ui.openBonfireWarp?.();
      }, 400);
    }
    return true;
  }
  // (guest) a trap of the host's world met (hazardOf): its sound and flash, the HP it takes - a trap that may not knock
  // one out leaves 1, and the trap death check then kills, as the original's does - and death by the rules
  phantomHazard(ev) {
    const h = [1, 2].includes(ev.trigger) ? hazardOf(ev.list) : null;
    if (!h) return false;
    if (G.time - (ev._hurtAt ?? -9) < HAZARD_GAP) return true;
    ev._hurtAt = G.time;
    const a = G.state.party.leader();
    if (!a || G.combat.playerDead) return true;
    if (h.se) G.audio?.playSe(h.se);
    if (h.flash) G.screen.startFlash(h.flash[0], h.flash[1]);
    let dmg = 0, knockout = false;
    for (const x of h.hits) { dmg += x.c ?? (+G.state.v(x.v) || 0); knockout ||= x.knockout; }
    if (dmg > 0) {
      a.hp = Math.max(knockout ? 0 : 1, a.hp - dmg);
      G.combat.popupAtPlayer(`-${dmg}`, '#ff9a9a');
      G.screen.hurtFlash?.(1);
      G.input.haptic('left', 1, 120); G.input.haptic('right', 1, 120);
    }
    if (h.death || (h.check && a.hp <= 1) || a.hp <= 0) { a.hp = 0; G.combat.playerFalls(null); }
    console.info('[coop] a trap of the host\'s world:', ev.id, dmg);
    return true;
  }
  // (guest, every frame) the host's moving traps (event touch) that run into this player
  trapContacts() {
    const pc = G.map.playerChar;
    for (const ev of G.map.eventList) {
      if (ev.trigger !== 2 || ev.erased || ev.net?.gone || !hazardOf(ev.list)) continue;
      if (Math.hypot(G.map.nearX(ev.realX, pc.fx) - pc.fx, G.map.nearY(ev.realY, pc.fy) - pc.fy) < 0.7) this.phantomHazard(ev);
    }
  }
  // (guest, the rule guestsFollow off) a door, a stair, a map's edge: where it leads (interpreter.js exitOf), with its
  // sound
  phantomExit(ev) {
    if (G.map.transferring) return false;
    const to = exitOf(ev.list || [], ev.id);
    if (!to || !isInt(to.m, 1, 9999) || !$data.mapInfos?.has(to.m) || !isInt(to.x, 0, 999) || !isInt(to.y, 0, 999)) return false;
    if (to.se) G.audio?.playSe(to.se);
    G.map.reserveTransfer(to.m, to.x, to.y, [2, 4, 6, 8].includes(to.d) ? to.d : 0, to.fade);
    console.info('[coop] the guest goes its own way: map', to.m);
    return true;
  }
  askBossStart(evs, how) {
    if (!this.phantom || !this.hostId || !this.rules.guestStartsBoss || G.time < this.bossAskAt || this.spectating || this.respawning) return false;
    const ev = evs.find(x => x && !x.net?.gone && G.combat.eventStartsBoss(x));
    if (!ev) return false;
    this.bossAskAt = G.time + 3;
    const pc = G.map.playerChar, d = [2, 4, 6, 8].includes(pc.direction) ? pc.direction : 2;
    if (this.hostOn(G.map.mapId)) { this.send({ t: 'boss', ev: ev.id, x: pc.x, y: pc.y, d, how }, this.hostId); return true; }
    // (a map the host is not on: the host is asked to come to it - if it will not, the guests here fight it themselves:
    // onBossCallAnswer)
    if (G.map.interpreter.running() || G.combat.eventFightOn() || G.arena?.active) return true;
    this.bossAskAt = G.time + BOSS_CALL_WAIT;
    this.bossCall = { ev: ev.id, x: pc.x, y: pc.y, d, how, m: G.map.mapId, t: now() };
    this.send({ t: 'bcall', ev: ev.id, x: pc.x, y: pc.y, d, how, m: G.map.mapId, b: this.troopBossIds(G.combat.eventBossTroop(ev)) }, this.hostId);
    console.info('[coop] the host is asked to come to a boss fight here');
    return true;
  }
  // (guest) the host's answer: it comes (bcok - its own way of beginning it follows once it is here), or not (bgo - or no
  // answer in time: late): the guests here fight it themselves - the one leading this map begins it, where the one who
  // asked stands
  onBossCallAnswer(go, late = false) {
    const c = this.bossCall;
    this.bossCall = null;
    this.bossAskAt = G.time + (go ? 3 : 20);                 // (the host on its way: not asked again meanwhile)
    if (!go || !c || (!late && now() - c.t > BOSS_CALL_WAIT) || !this.ready() || G.map.mapId !== c.m || this.hostOn(c.m)) return;
    const pc = G.map.playerChar, ev = G.map.events[c.ev];
    // (gone from it meanwhile - but a roaming boss: it fights where it is)
    if (!(ev && G.combat.symbols.has(ev)) && Math.hypot(G.map.nearX(pc.x, c.x) - c.x, G.map.nearY(pc.y, c.y) - c.y) > 2.5) return;
    if (this.leadsNow) this.leadStart(c, null);
    else { const l = this.authorityId(); if (l) this.send({ t: 'lstart', ev: c.ev, x: c.x, y: c.y, d: c.d, how: c.how }, l); }
  }
  // (a guest leading a map) a boss fight the guests here begin: its event runs here as the host's would (its scenes too,
  // but the adult ones - interpreter.js c117), the one who asked is where the fight starts out (bossStarterAt); what it
  // changes of the world and gives is kept in the host's world (noteFlag, noteGain)
  leadStart(c, from) {
    const ev = G.map.events[c.ev];
    if (G.map.interpreter.running() || G.combat.eventFightOn() || G.arena?.active) return;          // (begun already)
    if (!ev || ev.erased || !G.combat.eventStartsBoss(ev)) { G.audio?.playSystemSe(3); return; }
    this.bossStarter = from ? { id: from, t: now(), fx: c.x, fy: c.y, d: c.d } : null;
    this.bossGo = ev;                                        // (a roaming one: its fight begins now - combat.js leadBoss)
    try { ev.start(); } finally { this.bossGo = null; }
    console.info('[coop] the guests here begin a boss fight: event', ev.id);
  }
  onLeadStart(m, from) {
    const p = this.peers.get(from);
    if (!p || p.host || !this.rules.guestStartsBoss || p.pose?.m !== G.map.mapId || !this.ready()) return;
    if (!isInt(m.ev, 1, 99999) || !isInt(m.x, 0, 999) || !isInt(m.y, 0, 999) || ![2, 4, 6, 8].includes(m.d)) return;
    const gx = p.pose.h[0] / T - 0.5, gy = p.pose.h[2] / T - 0.5;
    if (Math.hypot(G.map.nearX(gx, m.x) - m.x, G.map.nearY(gy, m.y) - m.y) > 2.5) return;
    this.leadStart(m, from);
  }
  // (guest) a boss fight began in the host's world without this player: join it? (ui.js askBossJoin - asked over the
  // play, which goes on meanwhile; no answer in a while is no). Not joined, it can be joined later from the co-op menu
  // (the host's fight - or one the guests run on a map the host is not on: the guest leading it asks, from: onBossFightBegin)
  onJoinAsk(m, from = this.hostId) {
    G.ui.askBossJoin?.(yes => { if (yes) this.joinBossFight(from); }, { title: this.joinTitle(m?.b) });
  }
  joinBossFight(to = this.hostId) {
    if (!this.shared || !to) return;
    this.joinTo = { id: to, t: now() };                       // (it brings this guest there: map / tp)
    this.send({ t: 'ba', yes: 1 }, to);
  }
  joiningTo(from) { return !!from && this.joinTo?.id === from && now() - this.joinTo.t < 60; }
  // a boss fight of the host's this guest is out of (its enemies here: out of reach both ways)
  outOfBossFight() { return this.shared && [...G.combat.puppets.values()].some(e => e.outOfFight && e.alive); }
  // (guest) joined: brought beside the host, a moment of dark
  async onBrought(m) {
    if (!isInt(m.x, 0, 999) || !isInt(m.y, 0, 999) || ![2, 4, 6, 8].includes(m.d) || !G.map.grid?.valid(m.x, m.y)) return;
    G.ui.closeBossPrompt?.();
    G.screen.fadeOut(12);
    await waitFor(() => G.screen.brightness <= 1, 800);
    if (this.shared && !G.map.transferring) G.player.teleportTo(m.x, m.y, m.d);
    G.screen.fadeIn(16);
  }
  // (guest) a blow of the host's enemy struck this player here (combat.js reportStruck): how it went, for the others
  // to show on it - 0 it landed, 1 guarded, 2 a perfect guard (id: the enemy's; 0 for another player's blow)
  onStruck(e, how) {
    if (!this.shared || (this.phantom && !this.hostId) || !e?.netId) return;
    this.send({ t: 'ow', id: e.netId, k: how });
  }
  // another player says how a blow went on it (an enemy's, or - PvP - a player's): a red flash and the hurt sound
  // over it, or the ring of a guard (gold for a perfect one) where it stands
  onStruckMsg(m, from) {
    const p = this.peers.get(from), a = p?.avatar;
    if (!p || !a?.cur || !isInt(m.id, 0, Number.MAX_SAFE_INTEGER) || ![0, 1, 2].includes(m.k) || !this.canSee(from)) return;
    const t = now();
    p.ows = (p.ows || []).filter(x => t - x < 1);
    if (p.ows.length >= HITS_PER_SECOND) return;
    p.ows.push(t);
    if (m.k === 0) { a.flashHurt(); return; }
    const at = new THREE.Vector3(a.cur.x, a.cur.y - 0.45, a.cur.z), perfect = m.k === 2;
    G.audio?.playSe(G.seAt('Parry', 90, perfect ? 150 : 120), at);
    G.combat?.spawnSparks?.(at, new THREE.Vector3(Math.sin(a.cur.yaw), 0, Math.cos(a.cur.yaw)), perfect ? 14 : 8, perfect ? 0xffd860 : 0xfff0c0);
  }
}
