// Co-op, the host's side: guests coming in and going, the world they are shown (switches, events, pictures, music), boss
// fights with them in it, their blows and falls, everything the host decides for the session.
import { NO_H_SWITCH, refOf } from '../coopguard.js';
import { cleanName, isTag } from '../coopnet.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { T } from '../mapmesh.js';
import { convertEscapes } from '../ui.js';
import { BOSS_CALL_WAIT, BOSS_MOVES, BOSS_PER_PLAYER, EN_STATES, FX_PER_SEND, HITS_PER_SECOND, LOOT_PER_MINUTE,
  PLAN_FLAGS, PLAN_NUMS, PLAN_SHAPES, PROTO, RemoteBody, SELF_KEY, YOU_DIED, eventLoot, fingerprint, inDeath, inScene,
  isInt, isList, isNum, isSenSwitch, isSenVar, isValue, now, okSwitch, r2, r3, shown, waitFor,
  worldOf } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class HostPart {
  // ---- host ------------------------------------------------------------------------------------------------------
  // a guest turned away (its VR mod's version or its game's edition not this one's, or banned): it is told, and this
  // host sees who and why - once (it asks a few times before it hears)
  refuseGuest(from, why) {
    this.send({ t: 'refuse', why }, from);
    const key = `${from}:${why}`;
    if ((this.refusedOnce ||= new Set()).has(key)) return;
    this.refusedOnce.add(key);
    const name = this.link?.info?.get(from)?.name || '?';
    G.ui?.toast?.(tr('{name} 님이 들어오지 못했습니다: {why}', { name, why: G.ui.coopNote(why) }));
    console.info('[coop] turned away:', name, why);
  }
  onHello(m, from) {
    if (!this.ready()) return;                                    // (still loading: it asks again)
    if (m.v !== PROTO) { this.refuseGuest(from, 'version'); return; }
    if (m.fp !== fingerprint()) { this.refuseGuest(from, 'game'); return; }
    // (banned by this host: the server keeps it out by its tag - over the dev links the tag is the guest's own word)
    const tag = this.link?.info ? this.tagOf(from) : isTag(m.tag) ? m.tag : '';
    if (tag && this.banTags().includes(tag)) { this.refuseGuest(from, 'banned'); return; }
    // (again to the same guest: its first welcome came while it could not take it - the changes since go on being
    // sent as well; taken twice they do no harm)
    const p = this.peerFor(from, true);
    if (!p) { this.send({ t: 'full' }, from); return; }
    if (!this.link?.info) p.tag = tag;
    this.lookKey = '';
    const pc = G.map.playerChar;
    // (over the dev links the rules come with it: a server tells them itself)
    this.send({ t: 'welcome', v: PROTO, world: worldOf(G.state), map: this.arrival(pc.x, pc.y, pc.direction || 2, from), r: this.link?.rules ? undefined : this.localRules, st: this.ownStats() }, from);
  }
  // where a guest comes in: a free cell beside this player (behind it first, then at its sides, then in front) that
  // one could step onto from where it stands - not inside it, nor where another player stands; its own cell if none
  // (taken: cells already given out to others coming in with this one; those handed out a moment ago count too - the
  // one sent there may not have arrived yet)
  arrival(x, y, dir, who = null, taken = new Set()) {
    const m = G.map, back = 10 - dir, t = now();
    for (const [cell, h] of this.handed) {
      if (t - h.t > 30) this.handed.delete(cell);
      else if (h.m === m.mapId && h.who !== who) taken.add(cell);
    }
    for (const p of this.peers.values()) {
      if (p.id === who || !p.pose || p.pose.m !== m.mapId) continue;
      taken.add(`${Math.round(p.pose.h[0] / T - 0.5)},${Math.round(p.pose.h[2] / T - 0.5)}`);
    }
    for (const d of [back, ...[2, 4, 6, 8].filter(k => k !== back && k !== dir), dir]) {
      const nx = m.wrapX(x + (d === 4 ? -1 : d === 6 ? 1 : 0)), ny = m.wrapY(y + (d === 8 ? -1 : d === 2 ? 1 : 0));
      if (!m.grid.valid(nx, ny) || !m.playerEdgePassable(x, y, d) || taken.has(`${nx},${ny}`)) continue;
      if (m.eventsXyNt(nx, ny).some(ev => ev.page && !ev.erased && ev.normalPriority() && !ev.through)) continue;
      taken.add(`${nx},${ny}`);
      this.handed.set(`${nx},${ny}`, { m: m.mapId, t, who });
      return { m: m.mapId, x: nx, y: ny, d: dir };
    }
    return { m: m.mapId, x, y, d: dir };
  }
  // a switch, variable or self switch of this world changed (state.js): the guests' copies of the world change too
  noteFlag(st, kind, key, value) {
    if (this.role === 'world') { this.noteWorld(st, kind, key, value); return; }
    if (this.phantom && this.leadsNow && this.recording > 0 && st === G.state) { this.outFlags.set(`${kind}:${key}`, [kind, key, value]); return; }
    if (this.role !== 'host' || !this.peers.size || st !== G.state) return;
    this.flags.set(`${kind}:${key}`, [kind, key, value]);
  }
  sendFlags() {
    const S = [], V = [], SS = [];
    for (const [kind, key, v] of this.flags.values()) {
      if (kind === 'S' && okSwitch(key)) S.push([key, v ? 1 : 0]);
      else if (kind === 'V' && okSwitch(key) && isValue(v ?? 0)) V.push([key, v ?? 0]);
      else if (kind === 'SS' && SELF_KEY.test(key)) SS.push([key, v ? 1 : 0]);
    }
    this.flags.clear();
    if (S.length || V.length || SS.length) this.send({ t: 'flags', S, V, SS });
  }
  // (a guest leading a map) what one of its fights or events there gave the party (an item, a weapon, armor, gold - the
  // boss's reward): the host's to have as well (onWorldFlags)
  noteGain(kind, id, n) {
    if (this.phantom && this.leadsNow && this.recording > 0 && n > 0 && this.outGains.length < 64) this.outGains.push([kind, id, n]);
    // (the developer's world, shareLoot) what the world gave this player - a fight's rewards, an event's gift: to
    // everyone else too (sent with the next frame - update); never what another player's share put in this bag
    if (n > 0 && this.world && this.worldRules.shareLoot && !this.lootIn && (this.lootDepth > 0 || eventLoot()) && this.outLoot.length < 64) this.outLoot.push([kind, id, n]);
  }
  // (the developer's world, shareLoot) what another player got from the world: put in this bag as well, said with whose
  // it was - checked as a gift's would be (a thing of the game's, a sane amount), so many a minute from one player at most
  onLoot(m, from) {
    if (!this.worldRules.shareLoot || !isList(m.g, 16) || !G.state?.party) return;
    const KINDS = { item: 'items', weapon: 'weapons', armor: 'armors' };
    const t = now(), at = (this.lootAt.get(from) || []).filter(x => t - x < 60), name = this.rosterName(from);
    this.lootIn = true;
    try {
      for (const e of m.g) {
        if (!Array.isArray(e) || e.length !== 3 || at.length >= LOOT_PER_MINUTE) continue;
        const [k, i, n] = e;
        if (k === 'gold' ? !(i === 0 && isInt(n, 1, 9999999)) : !(KINDS[k] && isInt(i, 1, 99999) && $data[KINDS[k]]?.[i] && isInt(n, 1, 99))) continue;
        at.push(t);
        if (k === 'gold') G.state.party.gainGold(n); else G.state.party.gainItem(k, i, n);
        G.ui.toast?.(convertEscapes(tr('{name} 님이 얻은 {item}[을;를] 함께 받았습니다', { name, item: this.giftText(k, i, n) })), 0, '#e8d8a8');
      }
    } finally { this.lootIn = false; }
    this.lootAt.set(from, at);
  }
  // (guest) going to another map: what its fights and events changed on this one goes to the host now (main.js)
  beforeTransfer() {
    if (!this.phantom) return;
    this.sendWorldFlags();
    if (this.bossCall) { this.bossCall = null; if (this.hostId) this.send({ t: 'bcx' }, this.hostId); }     // (its ask goes with it)
  }
  sendWorldFlags() {
    if (!this.outFlags.size && !this.outGains.length) return;
    const S = [], V = [], SS = [];
    for (const [kind, key, v] of this.outFlags.values()) {
      if (kind === 'S' && okSwitch(key) && key !== NO_H_SWITCH) S.push([key, v ? 1 : 0]);
      else if (kind === 'V' && okSwitch(key) && isValue(v ?? 0)) V.push([key, v ?? 0]);
      else if (kind === 'SS' && SELF_KEY.test(key)) SS.push([key, v ? 1 : 0]);
    }
    this.outFlags.clear();
    const g = this.outGains.splice(0);
    if (this.hostId && (S.length || V.length || SS.length || g.length)) this.send({ t: 'wf', m: G.map.mapId, S, V, SS, g }, this.hostId);
  }
  // (host) what the guests' own fights and events changed of this world on a map this player is not on (sent by the guest
  // leading it): its monsters beaten stay beaten here (their self switches); by the rule guestStartsBoss, what a boss
  // fight there brought too - the world's switches and variables, and its rewards to this player's party
  onWorldFlags(m, from) {
    const p = this.peers.get(from);
    if (!p || p.host || !isInt(m.m, 1, 9999)) return;
    const lb = this.ledBy.get(m.m);
    // (from the guest leading that map - or the one that led it a moment ago: it sends them on its way out)
    if (!(p.pose?.m === m.m && !this.hostOn(m.m) && this.leaderOf(m.m) === from) && !(lb?.id === from && now() - lb.t < 3)) return;
    const t = now();
    p.wfs = (p.wfs || []).filter(x => t - x < 1);
    if (p.wfs.length >= 20) return;
    p.wfs.push(t);
    const ok = (a, test) => isList(a, 500) && a.every(e => Array.isArray(e) && test(e));
    if (!ok(m.SS, e => e.length === 2 && typeof e[0] === 'string' && SELF_KEY.test(e[0]) && +e[0].split(',')[0] === m.m && (e[1] === 0 || e[1] === 1))) return;
    if (!ok(m.S, e => e.length === 2 && okSwitch(e[0]) && (e[1] === 0 || e[1] === 1)) || !ok(m.V, e => e.length === 2 && okSwitch(e[0]) && isValue(e[1]))) return;
    const KINDS = { item: 'items', weapon: 'weapons', armor: 'armors' };
    if (!ok(m.g, e => e.length === 3 && (e[0] === 'gold' ? isInt(e[1], 0, 0) : !!KINDS[e[0]] && isInt(e[1], 1, 99999) && !!$data[KINDS[e[0]]]?.[e[1]]) && isInt(e[2], 1, e[0] === 'gold' ? 9999999 : 99))) return;
    const st = G.state;
    for (const [key, v] of m.SS) { const [mapId, evId, ch] = key.split(','); st.setSelfSw(+mapId, +evId, ch, !!v); }
    if (this.rules.guestStartsBoss) {
      // (never switch 20 - Hシーン表示しない - nor SEN: this player's own)
      for (const [id, v] of m.S) if (id !== NO_H_SWITCH && !isSenSwitch(id)) st.setSw(id, !!v);
      for (const [id, v] of m.V) if (!isSenVar(id)) st.setV(id, v);
      for (const [kind, id, n] of m.g) {
        if (kind === 'gold') st.party.gainGold(n);
        else { st.party.gainItem(kind, id, n); G.ui.notifyGain?.(kind, id, n); }
      }
    }
    if (m.S.length || m.V.length || m.g.length || m.SS.length) console.info("[coop] kept from the guests' own map", m.m, JSON.stringify({ S: m.S.length, V: m.V.length, SS: m.SS.length, g: m.g.length }));
  }
  // an event as the guests' copies show it: [id, x, y (tiles, fractional while it walks), facing, step, opacity,
  // flags (1: not shown - no page, erased, see-through, no picture, or the host's fight shows it as something else; 2:
  // gone - no page, or erased: nothing of it is there to step on), its character sheet and index, its tile, its balloon]
  // (frozen: one of the scenes plays - each event shows its guests how it looked before it: a scene's own looks stay
  // the host's)
  evState(ev, frozen = false) {
    const gone = !ev.page || ev.erased;
    const hidden = gone || ev.transparent || !!G.combat?.hidesEvent?.(ev) || (!ev.characterName && !(ev.tileId > 0));
    let look = [ev.characterName || '', ev.characterIndex | 0];
    if (frozen) look = this.evLook.get(ev.id) || ['', 0]; else this.evLook.set(ev.id, look);
    return [ev.id, r2(ev.realX), r2(ev.realY), [2, 4, 6, 8].includes(ev.direction) ? ev.direction : 2, ev.pattern | 0,
      Math.max(0, Math.min(255, ev.opacity ?? 255)) | 0, (hidden ? 1 : 0) | (gone ? 2 : 0), look[0], look[1], ev.tileId | 0, ev.balloonId | 0];
  }
  // what changed among this map's events, to the guests on it - and all of them, with the screen, to one just come
  sendEvents() {
    if (!this.ready()) return;
    const m = G.map.mapId;
    if (this.evMap !== m) { this.evMap = m; this.evLast = new Map(); this.evLook = new Map(); }
    const all = [], changed = [], frozen = this.sceneOn();
    for (const ev of G.map.eventList) {
      const st = this.evState(ev, frozen), key = st.join('|');
      all.push(st);
      if (this.evLast.get(ev.id) !== key) { this.evLast.set(ev.id, key); changed.push(st); }
    }
    for (const p of this.guests()) {
      if (p.pose?.m !== m) continue;                 // (not on this map yet)
      if (p.evMap !== m) { p.evMap = m; this.send({ t: 'ev', m, e: all }, p.id); this.catchUp(p); }
      else if (changed.length) this.send({ t: 'ev', m, e: changed }, p.id);
    }
  }
  // one just come onto this map is told what is up now: the screen, a boss fight's fog, the pictures, the message
  catchUp(p) {
    this.send(this.screenMsg(), p.id);
    if (this.arenaMsg?.m === G.map.mapId) this.send(this.arenaMsg, p.id);
    if (this.pics.size) this.send({ t: 'pic', l: [...this.pics.keys()].map(n => this.picNow(n)).filter(Boolean) }, p.id);
    if (this.saying) this.send(this.saying.out, p.id);
    const b = this.bossFightOn();
    if (b && !b.coopIn.has(p.id)) this.send({ t: 'bq', b: this.bossIds(b) }, p.id);          // (a boss fight going on: join it?)
  }
  // the screen's tone (where it is going), its brightness and the music playing (while one of the scenes plays, the
  // music from before it: a scene's own sounds stay the host's)
  screenMsg() {
    const s = G.screen, tone = s.toneTarget || s.tone, a = G.audio;
    const loop = l => (l?.name ? [l.name, Math.round(l.volume ?? 100), Math.round(l.pitch ?? 100)] : null);
    if (!this.lastMusic || !this.sceneOn()) this.lastMusic = { bgm: loop(a?.bgm), bgs: loop(a?.bgs) };
    return { t: 'scr', tone: [tone.r, tone.g, tone.b, tone.gray].map(v => Math.round(v)), br: this.deathOn() ? 255 : Math.round(s.fadeTarget ?? 255), ...this.lastMusic };
  }
  // one of the scenes going on (inScene) - on the map's own interpreter, or a fight's
  sceneOn() { return this.running().some(it => inScene(it)); }
  // this player's death going on (inDeath): its screen going dark is its own
  deathOn() { return this.running().some(it => inDeath(it)); }
  running() {
    const c = G.combat;
    return [G.map?.interpreter, ...(c?.detached || []).map(d => d.interp), ...(c?.sideInterps || [])].filter(it => it?.running?.());
  }
  sendScreen() {
    const msg = this.screenMsg(), key = JSON.stringify(msg);
    if (key === this.scrKey) return;
    this.scrKey = key;
    this.send(msg);
  }
  // this map's enemies, to the guests on it: [id, enemy, x, y, lift, hover, HP, max HP, state, flags (1 hidden, 2 in a
  // fight, 4 not to be aimed at, 8 a player of a stage play put on here - src/theater.js, 16 fading out, 32 a boss, 64 a
  // roaming boss whose fight has not begun - a guest's blow begins it only by the rules, 128 one of a boss fight that
  // guest did not join), groggy %, states, where a plain shot winding up aims (or null), how many times stronger a boss
  // is for the players in its fight (bossScale; else 1), its place in its troop (-1: none) - a play draws some by it]
  sendEnemies() {
    if (!this.ready()) return;
    const m = G.map.mapId, list = [], fights = [];
    const syms = new Map([...G.combat.symbols.values()].filter(s => s.enemy).map(s => [s.enemy, s]));
    for (const e of G.combat.netEnemies()) {
      list.push(this.enemyEntry(e, e.battle ? null : syms.get(e)));
      fights.push(e.battle?.coopIn ? e.battle : null);
    }
    for (const p of this.guests()) {
      if (p.pose?.m !== m) continue;
      // (out of its boss fight: never in it, or watching it fallen)
      const mine = list.map((n, i) => (fights[i] && (!fights[i].coopIn.has(p.id) || fights[i].coopDead?.has(p.id)) ? n.map((v, k) => (k === 9 ? v | 128 : v)) : n));
      const key = JSON.stringify(mine);
      if (key === p.enKey && !mine.length) continue;          // (nothing there, as last told)
      p.enKey = key;
      this.send({ t: 'en', m, e: mine }, p.id);
    }
  }
  enemyEntry(e, sym = null) {
    const st = EN_STATES.indexOf(e.state);
    const flags = (!e.group.visible || e.hidden ? 1 : 0) | (e.battle ? 2 : 0) | (e.untargetable ? 4 : 0) | (e.fadeOnly ? 16 : 0) | (e.boss ? 32 : 0)
      | (sym && G.combat.symbolIsBoss(sym) ? 64 : 0) | (G.theater?.active && e.battle && e.battle === G.theater.battle ? 8 : 0);
    const gmax = G.combat.groggyMax(e);
    const aim = e.state === 'windup' && e.plan?.shot && !e.move && isNum(e.plan.aim, 100) ? r3(e.plan.aim) : null;
    return [e.netId, e.b.enemyId, r2(e.fx), r2(e.fy), r2(e.lift || 0), r2(e.hover || 0), Math.round(e.b.hp), Math.round(e.b.mhp),
      st < 0 ? 1 : st, flags, gmax ? Math.round(100 * (e.grog ?? gmax) / gmax) : 100, e.b.states.slice(0, 32), aim, e.b.coopK || 1,
      isInt(e.memberIndex, 0, 63) ? e.memberIndex : -1];
  }
  // an enemy as sent (enemyEntry): its fields checked - or null
  enemyFrom(n) {
    const [id, enemyId, fx, fy, lift, hover, hp, mhp, st, flags, grog, states, aim, k, mi] = Array.isArray(n) ? n : [];
    if (!Array.isArray(n) || n.length !== 15 || !isNum(k, 100) || k < 1 || !isInt(mi, -1, 63) || !isInt(id, 1, Number.MAX_SAFE_INTEGER) || !isInt(enemyId, 1, 99999) || !$data.enemies?.[enemyId] || !isNum(fx, 1e4) || !isNum(fy, 1e4)
      || !isNum(lift, 100) || !isNum(hover, 100) || !isInt(hp, 0, 1e8) || !isInt(mhp, 1, 1e8) || !isInt(st, 0, EN_STATES.length - 1)
      || !isInt(flags, 0, 255) || !isInt(grog, 0, 100) || !isList(states, 32) || !states.every(s => isInt(s, 1, 9999) && $data.states?.[s])
      || (aim !== null && !isNum(aim, 100))) return null;
    return { id, enemyId, fx, fy, lift, hover, hp, mhp, state: EN_STATES[st], flags, grog, states, aim, k, mi };
  }
  // (the developer's world) who is told what an enemy here does: of the map's monsters (its runner's), everyone on the
  // map; of a hallucination (combat.js privateSymbol), only those who see it too
  audience(e) {
    if (!e?.netId) return [];
    if (e.private) return this.world ? this.hallViewers(e.hallKey) : [];
    return this.isAuthority() && this.peers.size ? this.guestsHere() : [];
  }
  hallViewers(key) { const m = G.map?.mapId; return key ? this.guests().filter(p => p.pose?.m === m && p.hvm === m && !!p.hv?.has(key)) : []; }
  peerSees(id, key) { const p = this.peers.get(id), m = G.map?.mapId; return !!key && !!p && p.pose?.m === m && p.hvm === m && !!p.hv?.has(key); }
  // the copy here of an enemy that player runs: one of the map's (its runner's) or a hallucination of its this player sees too
  puppetOf(id, from) {
    if (!isInt(id, 1, Number.MAX_SAFE_INTEGER)) return null;
    const P = G.combat.puppets;
    return (this.fromAuthority(from) ? P.get(id) : null) || (this.world ? P.get(`h:${from}:${id}`) : null) || null;
  }
  // (host - the developer's world: also one running a hallucination there) the guests standing on this map, as bodies
  // this world's enemies can go for (allies.js struckable - a hallucination, only for those who see it)
  remoteBodies() {
    if (!(this.isAuthority() || this.world) || !this.peers.size) return [];
    const out = [];
    for (const p of this.peers.values()) {
      if (p.host) continue;
      const b = (p.body ||= new RemoteBody(this, p));
      if (b.stands) out.push(b);
    }
    return out;
  }
  guestsHere() { const m = G.map?.mapId; return this.guests().filter(p => p.pose?.m === m); }
  // (host) an enemy laying down the mark of its move, taking it up, doing it: its guests see the same
  onTelegraph(e) {
    const to = this.audience(e);
    if (!to.length || !e.plan) return;
    const plan = e.plan, p = { shape: PLAN_SHAPES.includes(plan.shape) ? plan.shape : 'none' };
    for (const k of PLAN_NUMS) if (isNum(plan[k], 1e5)) p[k] = r2(plan[k]);
    for (const k of PLAN_FLAGS) if (plan[k]) p[k] = 1;
    if (BOSS_MOVES.has(plan.move)) p.move = plan.move;
    if (plan.shape === 'multi') p.parts = (plan.parts || []).slice(0, 24).map(q => ({ shape: q.shape === 'circle' ? 'circle' : 'line',
      x: r2(q.x), y: r2(q.y || 0), z: r2(q.z), r: r2(q.r || 0), aim: r2(q.aim || 0), len: r2(q.len || 0), width: r2(q.width || 0),
      ...(isNum(q.at, 10) ? { at: r2(q.at) } : {}) }));
    if (plan.cap && isInt(plan.cap.left, 0, 12)) p.cap = plan.cap.left;
    // (whom it goes for: this guest, another guest - who - or the host)
    const at = e.tgt?.remote ? e.tgt.peer.id : null;
    for (const g of to) this.send({ t: 'tg', id: e.netId, p, s: e.skill?.id || 0, t0: r2(e.timer0 || 1), me: g.id === at ? 1 : 0, who: at && g.id !== at ? at : null }, g.id);
  }
  onTelegraphEnd(e) {
    for (const g of this.audience(e)) this.send({ t: 'tgx', id: e.netId }, g.id);
  }
  // (a plain shot: where its line turned to by the end)
  onEnemyAct(e, skill) {
    if (!skill) return;
    const at = e.tgt?.remote ? e.tgt.peer.id : null, a = e.plan?.shot && isNum(e.plan.aim, 100) ? r3(e.plan.aim) : null;
    for (const g of this.audience(e)) this.send({ t: 'ax', id: e.netId, s: skill.id, a, me: g.id === at ? 1 : 0 }, g.id);
  }
  // (host) a boss up in the air - where it comes down is marked now (combat.js updateLeap); its move goes off
  // (releaseBossMove); its charge ran into this player (it stops there and bounces back)
  onLeap(e) {
    const to = this.audience(e);
    if (!to.length || !e.plan) return;
    const p = e.plan, msg = { t: 'lp', id: e.netId, cx: r2(p.cx), cz: r2(p.cz), sx: r2(p.sx), sy: r2(p.sy), j: r3(p.jumpAt || 0), h: r2(p.height || 4) };
    for (const g of to) this.send(msg, g.id);
  }
  onBossMove(e) {
    for (const g of this.audience(e)) this.send({ t: 'bx', id: e.netId }, g.id);
  }
  onChargeImpact(e) {
    for (const g of this.audience(e)) this.send({ t: 'bi', id: e.netId, x: r2(e.fx), y: r2(e.fy) }, g.id);
  }
  // (host) a boss fight's fog closes the arena (arena.js), and opens again: for the guests on this map as well - where
  // the fight began opens a dark round it the same
  onArena(on, battle = null, at = null) {
    if (!this.isAuthority()) return;
    this.arenaMsg = on ? { t: 'ar', m: G.map.mapId, ev: battle?.event?.id || 0, x: Math.round(at?.fx ?? 0), y: Math.round(at?.fy ?? 0) } : null;
    if (!this.peers.size) return;
    for (const g of this.guestsHere()) this.send(on ? this.arenaMsg : { t: 'arx' }, g.id);
  }
  // (host) what its events show its guests too, when it may (inScene)
  // (the developer's world: each player runs its own events - what they show is its own)
  contentOk(interp) { return this.isAuthority() && this.role !== 'world' && !!G.state?.sw(NO_H_SWITCH) && !inScene(interp) && !inDeath(interp); }
  mirrorOk(interp) { return this.peers.size > 0 && this.contentOk(interp); }
  // a message, choices or a scrolling text an event of the host's put up: its guests read it while it is up (ended:
  // update). It goes as where it stands in the game's events (coopguard.js: a guest puts it up from its own copy), with
  // this player's names for those in it, which of its choices show and its speaker's name. One that turned out to be
  // a big banner (VICTORY ACHIEVED) shows as that there too
  onSay(interp, msg) {
    if (!this.mirrorOk(interp) || !Number.isInteger(msg.at)) return;
    const ui = G.ui, src = refOf(interp, msg.at), shown = ui.msg === msg;
    if (!src || (msg.lines || []).some(l => YOU_DIED.test(l)) || (!shown && !(ui.banner?.text && !YOU_DIED.test(ui.banner.text)))) return;
    this.sendFlags();                    // (the world's changes first: the numbers in it read the same there)
    const out = { t: 'say', src, nm: this.namesIn(msg), vis: msg.choiceAt || null, name: String(msg.name || '').slice(0, 40) };
    if (shown) this.saying = { msg, out };
    for (const g of this.guestsHere()) this.send(out, g.id);
  }
  // this player's names for those a message names (\N[n], \P[n] - and the speaker, a face that is one of the party's):
  // { N1: 'Grimm', P2: .. }
  namesIn(msg) {
    const out = {}, st = G.state;
    const scan = s => String(s ?? '').replace(/\\([NP])\[(\d+)\]/gi, (m, k, n) => {
      const key = k.toUpperCase() + n;
      if (!(key in out)) {
        const id = key[0] === 'N' ? +n : st?.party?.actors?.[+n - 1], name = id ? st?.actor(id)?.name : '';
        if (typeof name === 'string' && name.length <= 16) out[key] = name;
      }
      return m;
    });
    for (const l of msg.lines || []) scan(l);
    for (const c of msg.choices || []) scan(c.text);
    const names = G.scripts?.names || {}, f = msg.face ? names[`${msg.face}_${msg.faceIndex}`] ?? names[msg.face] : '';
    const am = /^Actor\[(\d+)\]/.exec(f || '');
    if (am) scan(`\\N[${am[1]}]`);
    return out;
  }
  // a picture an event of the host's showed, moved or took away (what is on its screen after it - pictures.js)
  onPicture(interp, code, params) {
    if (!this.isAuthority() || this.role === 'world') return;
    const n = params?.[0];
    if (!isInt(n, 1, 100)) return;
    if (code === 235) {
      this.ownPics.delete(n);
      if (this.pics.delete(n) && this.peers.size) this.sendPics([{ o: 'e', n }]);
      return;
    }
    const pic = G.pictures?.pics.get(n);
    if (code === 231) {
      // (a scene's own, or one a stage play hung on its stage: never theirs - nor one not shown by the game's own
      // events: a guest takes a picture only as where it stands in them, coopguard.js)
      const src = pic && this.contentOk(interp) ? refOf(interp) : null;
      if (!src) { this.ownPics.add(n); if (this.pics.delete(n) && this.peers.size) this.sendPics([{ o: 'e', n }]); return; }
      this.ownPics.delete(n);
      this.pics.set(n, src);
      this.sendPics([this.picNow(n)]);
      return;
    }
    if (code === 232 && pic && this.pics.has(n) && !this.ownPics.has(n) && pic.target && pic.d > 0) {
      const t = pic.target;
      this.sendPics([{ o: 'm', n, org: pic.origin ? 1 : 0, x: r2(t.x), y: r2(t.y), zx: r2(t.zx), zy: r2(t.zy), op: r2(t.opacity), bl: pic.blend | 0, d: pic.d }]);
    }
  }
  // a picture as it is now on the host's screen (shown there; moving on toward where it goes, if it does)
  picNow(n) {
    const pic = G.pictures?.pics.get(n);
    if (!pic) { this.pics.delete(n); return null; }
    const s = { o: 's', n, src: this.pics.get(n), org: pic.origin ? 1 : 0, x: r2(pic.x), y: r2(pic.y), zx: r2(pic.zx), zy: r2(pic.zy), op: r2(pic.opacity), bl: pic.blend | 0 };
    if (pic.target && pic.d > 0) s.mv = { o: 'm', n, org: s.org, x: r2(pic.target.x), y: r2(pic.target.y), zx: r2(pic.target.zx), zy: r2(pic.target.zy), op: r2(pic.target.opacity), bl: s.bl, d: pic.d };
    return s;
  }
  sendPics(list) { if (this.peers.size) for (const g of this.guestsHere()) this.send({ t: 'pic', l: list }, g.id); }
  // a sound, an animation or a flash one of the host's events played (checkFx): sent together, a few at a time - a
  // sound or an animation as where it stands in the game's events (coopguard.js)
  onFx(interp, f) {
    if (!this.mirrorOk(interp) || this.fxOut.length >= FX_PER_SEND) return;
    if (f[0] === 'fl') { this.fxOut.push(f); return; }
    const src = refOf(interp);
    if (src) this.fxOut.push(f[0] === 'an' ? ['an', f[1], src] : [f[0], src]);
  }
  // a guest's blow on one of this world's enemies (combat.js applyGuestHit): checked, and only so many a second
  onHit(m, from) {
    const p = this.peers.get(from);
    if (!p || p.host || !this.ready() || p.pose?.m !== G.map.mapId) return;
    const t = now();
    p.hits = (p.hits || []).filter(x => t - x < 1);
    if (p.hits.length >= HITS_PER_SECOND) return;
    p.hits.push(t);
    const ids = a => isList(a, 16) && a.every(id => isInt(id, 2, 9999) && $data.states?.[id]);
    if (!isInt(m.id, 1, Number.MAX_SAFE_INTEGER) || !isInt(m.d, -1e7, 1e7) || !ids(m.add) || !ids(m.rm) || !isNum(m.g, 1e7) || m.g < 0
      || ![0, 7, 8].includes(m.brk) || typeof m.big !== 'boolean') return;
    G.combat.applyGuestHit({ id: m.id, d: m.d, add: m.add, rm: m.rm, g: m.g, brk: m.brk, big: m.big }, from);
  }
  // (host) a guest asks to begin a boss fight here (askBossStart): only by the server's rules, for an event of this map
  // that does begin one, at the guest's side (where this world sees the guest too), and while this world is free for
  // it - then the event begins (its scene plays here; this player stays where it is) and the guest is the one in the
  // fight it brings: everyone else, this player too, is asked whether to join it (onBossFightBegin). Else the guest
  // hears the buzzer
  onBossAsk(m, from) {
    const p = this.peers.get(from);
    if (!p || p.host) return;
    const no = why => { console.info('[coop] boss fight not begun for a guest:', why); this.send({ t: 'bossno' }, from); };
    const map = G.map, ev = isInt(m.ev, 1, 99999) && this.ready() ? map.events[m.ev] : null;
    if (!this.rules.guestStartsBoss) return no('rules');
    if (!ev || !isInt(m.x, 0, 999) || !isInt(m.y, 0, 999) || ![2, 4, 6, 8].includes(m.d) || !['touch', 'action', 'bump'].includes(m.how) || p.pose?.m !== map.mapId) return no('bad');
    const gx = p.pose.h[0] / T - 0.5, gy = p.pose.h[2] / T - 0.5;
    if (Math.hypot(map.nearX(gx, m.x) - m.x, map.nearY(gy, m.y) - m.y) > 2.5) return no('not there');
    if (Math.max(Math.abs(map.nearX(ev.x, m.x) - m.x), Math.abs(map.nearY(ev.y, m.y) - m.y)) > 1) return no('not at it');
    if (!map.grid.valid(m.x, m.y) || !map.walkable(m.x, m.y)) return no('cell');
    const ui = G.ui;
    if (map.interpreter.running() || map.transferring || G.combat.eventFightOn() || G.arena?.active || G.combat.playerDead
      || ui.msg || ui.menuOpen || ui.sceneOpen || ui.banner) return no('busy');
    if (!ev.triggerIn(m.how === 'action' ? [0, 1, 2] : [1, 2]) || !G.combat.eventStartsBoss(ev)) return no('no boss');
    this.bossStarter = { id: from, t: now(), fx: m.x, fy: m.y, d: m.d };     // (the one in the fight that begins)
    ev.start();
    console.info('[coop] a guest began a boss fight: event', ev.id);
  }
  // (host) a guest on a map this player is not on found a boss fight there (the rule guestStartsBoss): asked whether to
  // go to it - yes: this player goes to that guest and the fight begins there with both in it (startTrip); no, no
  // answer, or busy: the guests there fight it themselves (bgo). The answer goes to every guest there
  onBossCall(m, from) {
    const p = this.peers.get(from);
    if (!p || p.host) return;
    if (!this.rules.guestStartsBoss) { this.send({ t: 'bossno' }, from); return; }
    if (!isInt(m.m, 1, 9999) || !$data.mapInfos?.has(m.m) || p.pose?.m !== m.m || this.hostOn(m.m) || !isInt(m.ev, 1, 99999)
      || !isInt(m.x, 0, 999) || !isInt(m.y, 0, 999) || ![2, 4, 6, 8].includes(m.d) || !['touch', 'action', 'bump'].includes(m.how)) return;
    const tell = what => { for (const g of this.guests()) if (g.id === from || g.pose?.m === m.m) this.send({ t: what }, g.id); };
    const go = why => { console.info('[coop] the guests fight a boss on their own:', why); tell('bgo'); };
    // (asked already, or on its way: for that map the answer given does - another map's guests fight theirs)
    const busy = this.callOpen || this.hostTrip;
    if (busy) { if (busy.m !== m.m) this.send({ t: 'bgo' }, from); return; }
    const fighting = () => G.combat.inCombat || this.bossFightOn() || G.arena?.active || G.combat.playerDead;
    if (fighting()) return go('busy');
    const answer = yes => {
      const open = this.callOpen;
      this.callOpen = null;
      const q = this.peers.get(from);
      if (!yes || !q || q.pose?.m !== m.m) return go('declined');
      // (too late: the guests there have begun it by now - onBossCallAnswer)
      if (!open || now() - open.t > BOSS_CALL_WAIT - 2) return go('late');
      if (!this.ready() || G.map.interpreter.running() || fighting() || this.hostOn(m.m)) return go('busy');
      this.hostTrip = { from, ev: m.ev, x: m.x, y: m.y, d: m.d, how: m.how, m: m.m, t: now() };
      tell('bcok');
      G.map.reserveTransfer(m.m, m.x, m.y, m.d, 0);
      console.info('[coop] going to a guest boss fight on map', m.m);
    };
    this.callOpen = { from, m: m.m, t: now(), answer };
    const name = p.name || '?', boss = this.bossNames(m.b);
    const title = boss ? convertEscapes(tr('{name} 님이 다른 맵에서 {boss}[과;와]의 보스전을 시작하려 합니다. 가시겠습니까?', { name, boss }))
      : tr('{name} 님이 다른 맵에서 보스전을 시작하려 합니다. 가시겠습니까?', { name });
    G.ui.askBossJoin?.(answer, { title, yes: tr('간다'), no: tr('가지 않는다') });
  }
  // (host) the guest stopped waiting for the answer (onBossCallAnswer): the ask goes
  onCallWithdrawn(from) {
    const o = this.callOpen;
    if (!o || o.from !== from) return;
    this.callOpen = null;
    if (G.ui.prompt?.answer === o.answer) G.ui.closeBossPrompt();
  }
  // (host) there now: the fight begins as one that guest begins here, both in it (onBossFightBegin: tripNow) - unless it
  // has begun already (its boss, roaming, came for this player first): that guest is in it too
  startTrip(trip) {
    if (this.tripNow !== trip || !this.peers.has(trip.from) || G.map.mapId !== trip.m) return;
    const b = this.bossFightOn();
    if (b) { this.tripNow = null; if (!b.coopIn.has(trip.from)) { b.coopIn.add(trip.from); this.scaleBosses(b); } return; }
    const ev = G.map.events[trip.ev], ui = G.ui;
    if (!ev || ev.erased || !G.combat.eventStartsBoss(ev)) { this.tripNow = null; this.send({ t: 'bossno' }, trip.from); return; }
    if (!this.ready() || G.map.interpreter.running() || G.combat.eventFightOn() || G.arena?.active || G.combat.playerDead
      || ui.msg || ui.menuOpen || ui.sceneOpen || ui.banner) {
      if ((trip.tries = (trip.tries || 0) + 1) < 40) setTimeout(() => this.startTrip(trip), 500);
      return;
    }
    this.bossStarter = { id: trip.from, t: now(), fx: trip.x, fy: trip.y, d: trip.d };
    ev.start();
    console.info('[coop] the host came to a guest boss fight: event', ev.id);
  }
  // (host) where a boss fight a guest began starts out (combat.js startBattle: where its enemies stand, the arena's
  // middle): where that guest stood - none for one this player began
  bossStarterAt() {
    const s = this.bossStarter;
    return this.isAuthority() && s && now() - s.t < 60 && this.peers.has(s.id) ? { fx: s.fx, fy: s.fy, d: s.d } : null;
  }
  // (host) a boss fight began in this world (combat.js startBattle): in it is the one who began it - this player, or the
  // guest - and everyone else here is asked whether to join it: the guests ('bq') and this player too. One that does is
  // brought to the fight; one that does not stays where it is, out of it - its enemies do not go for it, and it and they
  // never strike each other (it may join it later from the co-op menu). A guest coming in during the fight is asked
  // as well. Those in it who fall may watch it (bossSpectate: coopDead) until everyone in it is down
  onBossFightBegin(battle) {
    if (this.role !== 'host') {
      // (a guest leading a map: a boss fight the guests here begin - all of them in it, this player as 'host' (the one
      // running it), the boss as strong as for them; one coming onto the map meanwhile is in it too (update), and those
      // who fall watch it by the rules until everyone in it is down, as in the host's)
      if (!this.leadsNow) return;
      battle.coopIn = new Set(['host', ...this.guestsHere().map(g => g.id)]);
      battle.coopDead = new Set();
      battle.coopPeak = 1;
      battle.coopRun = this.runOf(battle);
      this.bossBattle = battle;
      this.scaleBosses(battle);
      // (the guests elsewhere are asked whether to join it, as for the host's - joining brings them here: onJoinAnswer)
      const b = this.bossIds(battle);
      for (const g of this.guests()) if (!battle.coopIn.has(g.id)) this.send({ t: 'bq', b }, g.id);
      return;
    }
    const at = this.bossStarterAt(), starter = at ? this.bossStarter.id : null;
    this.bossStarter = null;
    // (this player came to a guest's boss fight: both in it - startTrip)
    const trip = this.tripNow && now() - this.tripNow.t < 60 && this.tripNow.m === G.map.mapId && this.peers.has(this.tripNow.from) ? this.tripNow : null;
    this.tripNow = null;
    battle.coopIn = new Set([starter || 'host']);
    if (trip) { battle.coopIn.add('host'); battle.coopIn.add(trip.from); }
    battle.coopDead = new Set();
    battle.coopPeak = 1;
    battle.coopRun = this.runOf(battle);
    this.bossBattle = battle;
    if (trip) this.scaleBosses(battle);
    const b = this.bossIds(battle);
    // (every guest not in it is asked - on another map too: one gone back to its bonfire as the last try was lost, before
    // the fight's event began it again - 그랑・기뇰's 재도전; joining brings it there: onJoinAnswer)
    for (const g of this.guests()) if (!battle.coopIn.has(g.id)) this.send({ t: 'bq', b }, g.id);
    if (!battle.coopIn.has('host')) G.ui.askBossJoin?.(yes => { if (yes) this.hostJoin(); }, { title: this.joinTitle(b) });
  }
  // the boss fight going on in this world now (one a guest may join), if any
  bossFightOn() {
    const b = this.bossBattle;
    return b && !b.done && b.coopIn && G.combat.battles.includes(b) ? b : null;
  }
  // where one joining the fight is brought: beside one in it still standing - this player, or a guest
  fightSpot(b) {
    if (b.coopIn.has('host') && !b.coopDead.has('host')) { const pc = G.map.playerChar; return { x: pc.x, y: pc.y, d: pc.direction || 2 }; }
    for (const id of b.coopIn) {
      const p = this.peers.get(id);
      if (!p || b.coopDead.has(id) || p.pose?.m !== G.map.mapId) continue;
      return { x: Math.round(p.pose.h[0] / T - 0.5), y: Math.round(p.pose.h[2] / T - 0.5), d: 2 };
    }
    const e = b.enemies.find(x => x.alive && !x.hidden);
    return e ? { x: Math.round(e.fx), y: Math.round(e.fy), d: 2 } : null;
  }
  // a guest says whether it joins the boss fight: one that does is in it, and brought to it - beside it on this map, taken
  // here from another one
  onJoinAnswer(m, from) {
    const p = this.peers.get(from), b = this.bossFightOn();
    if (!p || p.host || !b || m.yes !== 1 || b.coopIn.has(from) || !p.pose?.m || !this.ready()) return;
    const spot = this.fightSpot(b), here = p.pose.m === G.map.mapId;
    b.coopIn.add(from);
    this.giveRules(b, from);
    this.scaleBosses(b);
    if (spot) {
      const at = this.arrival(spot.x, spot.y, spot.d, from);
      if (here) this.send({ t: 'tp', x: at.x, y: at.y, d: at.d }, from);
      else { this.send({ t: 'map', ...at }, from); (b.coming ||= new Map()).set(from, now()); }
    }
    console.info('[coop] a guest joined the boss fight', here ? '' : '(from another map)');
  }
  // (host) this player joins a boss fight a guest began: brought to it, a moment of dark
  async hostJoin() {
    const b = this.bossFightOn();
    if (!b || b.coopIn.has('host')) return;
    const spot = this.fightSpot(b);
    b.coopIn.add('host');
    this.scaleBosses(b);
    console.info('[coop] the host joined the boss fight');
    if (!spot) return;
    const at = this.arrival(spot.x, spot.y, spot.d, 'host');
    G.screen.fadeOut(12);
    await waitFor(() => G.screen.brightness <= 1, 800);
    if (this.active && !G.map.transferring) G.player.teleportTo(at.x, at.y, at.d);
    G.screen.fadeIn(16);
  }
  // (host, the rule bossScale) a boss fight's bosses grow with the most players that were ever in it at once (as in Dark
  // Souls, one who falls or leaves takes nothing away): HP, MP and the groggy gauge times 1 + BOSS_PER_PLAYER for each one
  // past the first - the share of them left kept; nothing else of them changes. Worked out again as the fight goes on
  // (a boss that comes out later, one that changes into another, the rule changed)
  scaleBosses(b) {
    if (!b?.coopIn) return;
    this.scaleBossesTo(b, b.coopIn.size);
  }
  scaleBossesTo(b, players) {
    b.coopPeak = Math.max(b.coopPeak || 1, players);
    const k = this.rules.bossScale ? Math.round((1 + BOSS_PER_PLAYER * (b.coopPeak - 1)) * 100) / 100 : 1;
    for (const e of b.enemies) {
      if (!e.b || !(e.boss || e.coopBoss)) continue;
      e.coopBoss = true;                             // (one that changes out of a boss stays one here)
      if ((e.b.coopK || 1) === k) continue;
      const hp0 = e.b.mhp, mp0 = e.b.mmp;
      e.b.coopK = k;
      if (hp0 > 0) e.b.hp = Math.min(e.b.mhp, Math.round(e.b.hp * e.b.mhp / hp0));
      if (mp0 > 0) e.b.mp = Math.min(e.b.mmp, Math.round(e.b.mp * e.b.mmp / mp0));
      e.grogId = null;
      G.combat.groggyMax(e);
      e.drawBar?.();
      console.info('[coop] boss', e.b.name, 'x' + k, '(players', b.coopPeak + ')');
    }
  }
  // (host) out of this world's boss fight - never in it, or watching it fallen (combat.js outOfFight)
  hostOutOf(battle) { const s = battle?.coopIn; return !!s && (!s.has('host') || battle.coopDead?.has('host')); }
  // (host) this player falls (combat.js playerFalls): in the boss fight it is in, by the rules (bossSpectate), it
  // watches the fight instead - unless it was the last one standing in it: then everyone in it is down (wipe) and its
  // own death goes on as the original's (souls lost, the bonfire). False: the death goes on now
  hostFalls() {
    const b = this.bossFightOn();
    if (!this.isAuthority() || !this.rules.bossSpectate || !b || !b.coopIn.has('host') || b.coopDead.has('host')) return false;
    b.coopDead.add('host');
    if (this.allDown(b)) { this.wipe(b, true); return false; }
    this.spectate();
    return true;
  }
  // (host) a guest in the boss fight fell: it watches it (sp, by the rules) - or is out of it (back at the bonfire,
  // or home). Either way, once no one in it stands, everyone in it is down
  onDown(m, from) {
    const b = this.bossFightOn();
    if (!b || !b.coopIn.has(from) || b.coopDead.has(from)) return;
    if (m.sp === 1 && this.rules.bossSpectate && this.rules.guestRespawn) b.coopDead.add(from); else b.coopIn.delete(from);
    console.info('[coop] a guest fell in the boss fight');
    if (this.allDown(b)) this.wipe(b, false);
  }
  allDown(b) { return b.coopIn.size > 0 && [...b.coopIn].every(id => b.coopDead.has(id)); }
  // everyone in the boss fight is down: each one's death goes on now - the guests' at the bonfire, this player's as the
  // original's (unless it is falling right now: hostFalls lets that one go on); they are out of the fight from then on
  wipe(b, hostNow) {
    console.info('[coop] everyone in the boss fight is down');
    const dead = [...b.coopDead];
    b.coopIn.clear(); b.coopDead.clear();
    for (const id of dead) if (id !== 'host' && this.peers.has(id)) this.send({ t: 'wipe' }, id);
    if (dead.includes('host') && !hostNow) {
      this.unspectate(false);
      if (this.phantom) { this.leadLost(); this.respawn(); } else G.combat.onPlayerDeath(null);
    }
  }
  // (a guest leading a map, down for good in the boss fight the guests here run) that fight is lost: its lose branch
  leadLost() { for (const b of [...G.combat.battles]) if (!b.done && b.bossFight) b.finish(2); }
  // (host) the boss fight is over (combat.js onBattleEnd) - or this world moved on: those watching it are up again
  // (a fight lost all the same - its rules changed while they watched: they are down - wipe)
  onBossFightEnd(battle) {
    if (battle?.result === 0) this.announceKill(battle);
    if (this.isAuthority() && battle?.ruleStates?.size) for (const g of battle.coopIn || []) if (g !== 'host' && this.peers.has(g)) this.send({ t: 'pst', end: 1 }, g);
    if (!this.isAuthority() || !battle?.coopDead?.size) return;
    const lost = battle.result === 2;
    for (const id of battle.coopDead) if (id !== 'host' && this.peers.has(id)) this.send({ t: lost ? 'wipe' : 'rev' }, id);
    if (battle.coopDead.has('host')) this.unspectate(!lost);
    battle.coopDead.clear();
  }
  // a boss fight won here (the host's, or the one the guests on this map ran): everyone on the server hears who beat
  // which boss - those in it too, this player as well (onKill)
  announceKill(battle) {
    if (!this.isAuthority() || !battle.bossFight || !battle.coopIn?.size || battle.told) return;
    battle.told = true;
    const ins = [...battle.coopIn];
    const m = { t: 'kill', b: this.bossIds(battle), w: ins.map(id => (id === 'host' ? this.myName() : this.peers.get(id)?.name || '?')).slice(0, 8),
      in: ins.map(id => (id === 'host' ? this.myId() : id)).slice(0, 8) };
    if (this.peers.size) this.send(m);
    this.onKill(m);
  }
  // '<who> 님이 <boss>을(를) 처치하셨습니다' - to everyone on the server, a while in its notices (ui.js toast), and kept in
  // the chat's log (coopchat.js)
  onKill(m) {
    if (!isList(m.w, 8) || !m.w.every(n => typeof n === 'string' && n.length <= 32) || !isList(m.in, 8) || !m.in.every(id => typeof id === 'string' && id.length <= 64)) return;
    const boss = this.bossNames(m.b), who = m.w.map(n => cleanName(n) || '?').join(', ');
    if (!boss || !who) return;
    const line = convertEscapes(tr('{who} 님이 {boss}[을;를] 처치하셨습니다', { who, boss }));
    G.ui.toast?.(line, 0, '#ffd870', 6);
    G.chat?.add('kill', who, line, false);
    console.info('[coop] boss beaten:', who, '-', boss);
  }
  // a fight's bosses as enemy ids (at most three): its big ones (combat.js refreshBosses), else its strongest standing
  bossIds(battle) {
    const all = (battle?.enemies || []).filter(e => e.b);
    let list = all.filter(e => e.boss || e.coopBoss);
    if (!list.length) list = all.filter(e => !e.hidden).sort((a, b) => b.b.solo().mhp - a.b.solo().mhp).slice(0, 1);
    return [...new Set(list.map(e => e.b.enemyId))].slice(0, 3);
  }
  // a troop's bosses before its fight begins (a boss call): its members in sight whose HP is near the biggest's - at
  // most three, else the biggest
  troopBossIds(troopId) {
    const hp = m => $data.enemies[m.enemy_id].params?.[0] || 0;
    const ms = ($data.troops?.[troopId]?.members || []).filter(m => !m.hidden && $data.enemies?.[m.enemy_id]).sort((a, b) => hp(b) - hp(a));
    if (!ms.length) return [];
    const strong = ms.filter(m => hp(m) >= hp(ms[0]) * 0.75);
    return [...new Set((strong.length <= 3 ? strong : strong.slice(0, 1)).map(m => m.enemy_id))].slice(0, 3);
  }
  // their names as this game has them (each player's own language); ids sent are checked here
  bossNames(ids) {
    return (isList(ids, 3) ? ids : []).filter(id => isInt(id, 1, 99999) && $data.enemies?.[id]?.name).map(id => $data.enemies[id].name).join(', ');
  }
  // the question whether to join a boss fight, its boss named ([과;와]: the Korean particle - ui.js convertEscapes);
  // null: the plain one
  joinTitle(ids) {
    const boss = this.bossNames(ids);
    return boss ? convertEscapes(tr('{boss}[과;와]의 보스전이 시작되었습니다. 참여하시겠습니까?', { boss })) : null;
  }
  // (the one running the map) a boss fight's rule an event put on the whole party (Change State - interpreter.js c313:
  // 그랑・기뇰's 악랄영역 and 하얀 감옥, 천수 영역, 라이덴·유니스·린다메아 영역, 프리켓's dice, 빅토리아's 불사신...):
  // the others in that fight, standing, get it too (onEventState); one joining later gets those in force (giveRules);
  // those the original takes away with a battle go when it ends (onBossFightEnd: pst end)
  shareEventState(add, id, interp) {
    if (!this.isAuthority() || !$data.states?.[id]) return;
    const b = G.combat.battleOf(interp);
    if (!b?.bossFight || !b.coopIn || b.done) return;
    b.ruleStates ||= new Set();
    if (add) b.ruleStates.add(id); else b.ruleStates.delete(id);
    for (const g of b.coopIn) if (g !== 'host' && !b.coopDead?.has(g) && this.peers.has(g)) this.send({ t: 'pst', a: add ? 1 : 0, s: id }, g);
  }
  giveRules(b, id) { for (const s of b.ruleStates || []) this.send({ t: 'pst', a: 1, s }, id); }
  // (guest) such a rule: on its own whole party as on the host's, its turns running as any state's; death (전투 불능 -
  // 가짜 바다거북's wrong answer) a fall as from a blow
  onEventState(m) {
    if (m.end === 1) { this.dropRules(); return; }
    const party = G.state.party, a0 = party.leader();
    if (!isInt(m.s, 1, 9999) || !$data.states?.[m.s] || !a0 || this.spectating || G.combat.playerDead) return;
    for (const a of party.members()) { if (m.a === 1) a.addState(m.s); else a.removeState(m.s); }
    if (m.a !== 1) return;
    if (a0.isState(m.s)) G.combat.timeActorState(m.s);
    if ($data.states[m.s].remove_at_battle_end) (this.rulesGot ||= new Set()).add(m.s);
    if (a0.hp <= 0) G.combat.playerFalls(null);
  }
  // (guest) the fight over, or this guest gone from it: the rules it got that end with a battle go
  dropRules() {
    for (const id of this.rulesGot || []) for (const a of G.state.party.members()) a.removeState(id);
    this.rulesGot = null;
  }
  // (host) a guest asks to come to this player's side (the co-op menu) - from another map, or from afar on this one; not
  // into a boss fight it is not in (the buzzer)
  onCome(from) {
    const p = this.peers.get(from);
    if (!p || p.host || !this.ready()) return;
    const b = this.bossFightOn();
    if (b && !this.hostOutOf(b) && !b.coopIn.has(from)) { this.send({ t: 'bossno' }, from); return; }
    const pc = G.map.playerChar;
    this.send({ t: 'map', ...this.arrival(pc.x, pc.y, pc.direction || 2, from) }, from);
  }

  // this world's player went somewhere (main.js performTransfer): the guests come along, each beside it
  onTransfer(mapId, x, y, dir) {
    if (this.role !== 'host') return;
    if (this.bossBattle) this.onBossFightEnd(this.bossBattle);
    // (gone to a guest's boss fight: it begins there a moment later)
    const trip = this.hostTrip;
    this.tripNow = null;
    if (trip) {
      this.hostTrip = null;
      if (trip.m === mapId && now() - trip.t < 60) { trip.t = now(); this.tripNow = trip; setTimeout(() => this.startTrip(trip), 800); }
    }
    if (!this.peers.size || !this.rules.guestsFollow) return;        // (the rule off: the guests go their own way)
    const d = [2, 4, 6, 8].includes(dir) ? dir : 2, given = new Set();
    for (const p of this.guests()) this.send({ t: 'map', ...this.arrival(x, y, d, p.id, given) }, p.id);
  }
}
