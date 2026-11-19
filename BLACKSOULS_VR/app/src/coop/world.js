// The developer's world (world_server.py, the community servers): the rules and the admin, coming in, the shared world as it
// changes, one event at a time, the next cycle, giving things, hallucinations seen together.
import { NO_H_SWITCH } from '../coopguard.js';
import { WorldLink, cleanName, isTag } from '../coopnet.js';
import { LIT_FROM_START, changesWorld, mergeWorld, worldPart, worldSwitch, worldVariable,
  writeSyncs } from '../coopworld.js';
import * as J from '../skilljudge.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { T } from '../mapmesh.js';
import { GameState, itemData } from '../state.js';
import { convertEscapes } from '../ui.js';
import { CONNECT_WAIT, CYCLE_CE, FLAGS_EVERY, HALL_KEY, HALL_WAIT, LOCK_RETRY, LOCK_WAIT, MAX_LIST, SELF_KEY,
  WORLD_RULES, WORLD_SAVE_EVERY, WORLD_SPAWN, checkWorld, fingerprint, isInt, isList, isNum, isValue, now, okSwitch, r2,
  serverUrl, toWorld } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class WorldPart {
  // ---- the developer's world (world_server.py) -----------------------------------------------------------------------
  // One world everyone on the developer's server walks, with no host. Each player's game runs everything itself - its
  // own events (one at a time where they change the world: a lock), its own fights - and tells the server what of the
  // world it changed; the server keeps the world and passes the changes on (coopworld.js: what is the world's, what each
  // one's own). On each map the one there longest runs the monsters for the others there (puppets, as a guest's on a map
  // it leads). Each player's character is its own, kept on its own PC (its developer-server saves).
  // the developer's servers this game came with (devserver.json beside the game: { servers: [{ ip, port, pin }, ...] } -
  // 1 and 2, the one elsewhere than the other; a single { ip, port, pin } is server 1)
  setDevServers(cfg) {
    const one = s => (s && typeof s === 'object' && typeof s.ip === 'string' && /^[\w.-]{1,80}$/.test(s.ip) && isInt(+s.port, 1024, 65535) && /^\d{4,12}$/.test(String(s.pin ?? ''))
      ? { ip: s.ip, port: +s.port, pin: String(s.pin) } : null);
    const list = Array.isArray(cfg?.servers) ? cfg.servers : [cfg];
    this.devServers = list.slice(0, 4).map(one);         // (one set wrongly keeps its number: null)
    return this.devServers.filter(Boolean).length;
  }
  // a community server: one this game came with (its number in devserver.json) or one this player added ({ ip, port, pin })
  joinWorld(i = 0) {
    const s = typeof i === 'object' ? i : this.devServers[i];
    if (!s || this.active) return false;
    this.devIndex = typeof i === 'object' ? -1 : i;
    this.devName = typeof i === 'object' ? `${s.ip}:${s.port}` : String(i + 1);
    this.start('world', () => new WorldLink(serverUrl(s), { pin: s.pin, key: this.myKey(), name: this.myName(), fp: fingerprint() }), s);
    this.wphase = 'connecting';
    return true;
  }
  // which community server this is, as the menus name it: its number, or its address
  worldName() { return this.devName ?? String((this.devIndex ?? 0) + 1); }
  onWorldMsg(m) {
    switch (m.t) {
      case 'ready': {
        const w = m.world === null ? null : checkWorld(m.world);
        if (w === null && m.world !== null) { this.fail('world'); return; }
        this.wworld = w ? toWorld(w) : null;
        this.onRoster(m.roster);
        this.onLeadsMsg(m.leads);
        this.takeWorldRules(m.rules);
        // (this PC proved the admin PIN of this server before - its key kept: it is the admin again)
        const kept = this.adminKeyKept();
        if (kept) this.adminLogin({ key: kept }, true);
        if (this.wphase === 'connecting') { this.wphase = 'choosing'; G.ui?.showWorldStart?.(); }
        break;
      }
      case 'wf': this.onWorldChange(m); break;
      case 'world': { const w = checkWorld(m.w); if (!w) break; this.wworld = toWorld(w); if (this.world) this.applyWholeWorld(this.wworld); break; }
      case 'roster': this.onRoster(m.l); break;
      case 'lead': this.onLeadsMsg(m.l); break;
      case 'lockok': case 'lockno': this.onLockAnswer(m); break;
      case 'seeded': this.onSeeded(m); break;
      case 'vote': this.onVote(m); break;
      case 'voteno': this.onVoteRefused(m); break;
      case 'voted': this.onVoted(m); break;
      case 'cycle': this.onCycle(m); break;
      case 'rules': this.takeWorldRules(m.r); console.info('[coop] the developer server\'s rules:', JSON.stringify(this.worldRules)); break;
      case 'admin': this.onAdminAnswer(m); break;
      default: break;
    }
  }
  // ---- the rules as the server says them; the admin (the server's admin PIN proved in the co-op menu - kept on this PC
  // for that server) changes them for everyone at once
  takeWorldRules(r) {
    if (!r || typeof r !== 'object') return;
    this.worldRules = { ...WORLD_RULES, maxPlayers: isInt(r.maxPlayers, 2, 16) ? r.maxPlayers : WORLD_RULES.maxPlayers,
      bossSpectate: r.bossSpectate !== false, bossScale: r.bossScale !== false, shareLoot: r.shareLoot === true };   // (PvP: each player's own - myPvp)
    G.ui?.refreshCoopMenu?.();
  }
  // (the admin key is kept for its server and the salt it was made with: never the PIN itself)
  serverKey() { const s = this.server; return s ? `${s.ip}:${s.port}` : ''; }
  adminKeyKept() {
    const d = G.settings.devAdmin, e = d && typeof d === 'object' ? d[this.serverKey()] : null;
    return e && typeof e === 'object' && /^[0-9a-f]{64}$/.test(e.k || '') && e.s === this.link?.adminSalt ? e.k : '';
  }
  keepAdminKey(key) {
    const k = this.serverKey();
    if (!k) return;
    const d = G.settings.devAdmin && typeof G.settings.devAdmin === 'object' ? { ...G.settings.devAdmin } : {};
    if (key) d[k] = { k: key, s: this.link?.adminSalt || '' }; else delete d[k];
    G.settings.devAdmin = d;
    G.saveSettings?.();
  }
  // the admin PIN typed in (12 digits: the key is made from it - a moment), or the key this PC kept
  async adminLogin({ pin = '', key = '' } = {}, quiet = false) {
    if (this.role !== 'world' || !this.link?.adminProve || (!key && !/^\d{12}$/.test(String(pin)))) return false;
    const link = this.link, k = key || await link.adminKey(pin);
    if (this.link !== link || !k) return false;
    this.adminTry = { key: k, quiet };
    return link.adminProve(k);
  }
  onAdminAnswer(m) {
    const t = this.adminTry;
    this.adminTry = null;
    this.isAdmin = m.ok === 1;
    if (this.isAdmin) { if (t) this.keepAdminKey(t.key); if (t && !t.quiet) G.audio?.playSystemSe(1); }
    else if (t?.quiet) this.keepAdminKey('');          // (the server's admin PIN changed since)
    else { G.audio?.playSystemSe(3); G.ui.toast?.(tr('관리자 PIN이 맞지 않습니다')); }
    G.ui?.refreshCoopMenu?.();
  }
  // (the admin) a rule changed - only that one is sent (one changed right after another keeps the other): the server
  // takes it and tells everyone (here too)
  setWorldRule(key, value) {
    if (this.role !== 'world' || !this.isAdmin || !['maxPlayers', 'bossSpectate', 'bossScale', 'shareLoot'].includes(key)) return false;
    this.link?.tell?.({ t: 'rules', r: { [key]: value } });
    return true;
  }
  // everyone on this session and where each one is (the co-op menu's members) - this player first: [{ id, name, map,
  // me, host }] (map 0: on its way, or in its opening alone)
  members() {
    const me = { id: this.myId() || 'me', name: this.myName(), map: this.ready() && (this.role !== 'world' || this.world) ? G.map.mapId : 0, me: true, host: this.role === 'host' };
    const out = [me];
    if (this.role === 'world') {
      for (const [id, name, , map] of this.roster) if (id !== this.myId()) out.push({ id, name: name || '?', map });
      return out;
    }
    for (const p of this.peers.values()) out.push({ id: p.id, name: this.nameOf(p.id), map: p.pose?.m | 0, host: !!p.host });
    return out;
  }
  onRoster(l) {
    if (!isList(l, 64)) return;
    const mine = this.world && this.ready() ? G.map.mapId : -1;
    const was = new Set(this.roster.filter(r => r[3] === mine).map(r => r[0]));
    this.roster = l.filter(r => Array.isArray(r) && r.length === 4 && typeof r[0] === 'string' && r[0].length <= 16 && isInt(r[3], 0, 9999))
      .map(r => [r[0], cleanName(r[1]), isTag(r[2]) ? r[2] : '', r[3]]);
    // (someone just come onto this map: it is shown what this player looks like)
    if (this.roster.some(r => r[3] === mine && r[0] !== this.myId() && !was.has(r[0]))) this.lookKey = '';
    G.ui?.refreshCoopMenu?.();
  }
  onLeadsMsg(l) {
    if (!isList(l, 500) || !l.every(e => Array.isArray(e) && e.length === 2 && isInt(e[0], 1, 9999) && typeof e[1] === 'string' && e[1].length <= 64)) return;
    this.leadNow = new Map(l);
  }
  // (the developer's world) someone else on this player's map, as the server says
  othersHere() {
    if (!this.world || !this.ready()) return false;
    const m = G.map.mapId, me = this.myId();
    return this.roster.some(r => r[3] === m && r[0] !== me);
  }
  // the map this player is on, as the server knows it (0: none - on its way, or in its opening alone)
  tellAt(m) {
    if (this.role !== 'world' || !this.link?.open || m === this.atSent) return;
    this.atSent = m;
    this.link.tell({ t: 'at', m });
  }

  // ---- coming in: from the beginning (the opening alone, into the world at its first bonfire), a save of this
  // game's own (at its last bonfire), or a developer-server save (where it was). This player's own game waits as it is
  // (home) and comes back when it leaves
  worldNew() {
    const st = new GameState();
    st.newGame();
    this.enterAway(st, null, 'prologue');
  }
  worldLoad(st) { this.enterAway(st, null, 'in'); }
  // where everyone comes into the world: 도서관의 꿈, at its bonfire's arrival - as the travel list takes one there (its
  // common events with it)
  worldSpawn() {
    const b = (G.scripts?.bonfires || []).find(x => x.mapId === WORLD_SPAWN.mapId);
    return b ? { mapId: b.mapId, x: b.x, y: b.y, dir: b.dir || 2, commons: b.commons || [] } : { ...WORLD_SPAWN, commons: [] };
  }
  enterAway(st, place, phase) {
    if (this.role !== 'world' || this.wphase !== 'choosing') return;
    G.combat.reset();
    if (!this.home) { const pc = G.map.playerChar; this.home = { state: G.state, mapId: G.map.mapId, x: pc.x, y: pc.y, dir: pc.direction || 2 }; }
    this.summoned = true;
    G.map.interpreter.clear();
    G.map.reservedCommon = [];
    st.switches[NO_H_SWITCH] = true;
    if (phase === 'prologue') {
      this.wphase = 'prologue';
      this.tellAt(0);
      G.enterWorld(st, place || undefined);
      console.info('[coop] the opening, alone (into the world at the first bonfire)');
      return;
    }
    this.wphase = 'joining';
    this.joinShared(st, place);
  }
  // (the opening alone) over: its first bonfire rested at (main.js onBonfire), or the player come to where everyone comes into
  // the world - 도서관의 꿈, where the opening's first death wakes it (updateWorld) - free to move there: into the world from here
  prologueDone() {
    if (this.role !== 'world' || this.wphase !== 'prologue' || this.pendingJoin) return;
    this.wphase = 'joining';
    this.joinShared(G.state, null);
  }
  // into the world: its part as the server has it, this game's own as it is - or, the world empty (or waiting for the
  // next cycle and this game come through to it), this game's world becomes it (seed)
  joinShared(st, place) {
    for (const i of LIT_FROM_START) st.switches[i] = true;      // (lit in this world from the start - a world it seeds has them too)
    this.pendingJoin = { st, place };
    if (this.wworld === null || this.cycling) { this.link?.tell?.({ t: 'seed', w: worldPart(st), c: +st.v(47) || 0 }); return; }
    this.finishJoin(this.wworld);
  }
  onSeeded(m) {
    if (!this.pendingJoin) return;
    if (m.ok === 1) { console.info('[coop] this game\'s world is the world now'); this.finishJoin(null); return; }
    const w = m.w ? checkWorld(m.w) : null;
    if (w) this.wworld = toWorld(w);
    this.finishJoin(this.wworld || null);
  }
  finishJoin(w) {
    const j = this.pendingJoin;
    this.pendingJoin = null;
    if (!j || this.role !== 'world') return;
    this.cycling = false;
    if (w) mergeWorld(j.st, w);
    j.st.switches[NO_H_SWITCH] = true;
    this.wworld = undefined;
    this.wphase = 'in';
    this.authNow = undefined; this.leadsNow = false; this.arrMap = 0; this.atSent = undefined; this.wsaveT = 2;
    // (at 도서관의 꿈, whatever it came from)
    const at = this.worldSpawn();
    G.map.interpreter.clear();
    G.map.reservedCommon = [];
    G.enterWorld(j.st, { mapId: at.mapId, x: at.x, y: at.y, dir: at.dir });
    for (const ce of at.commons) G.map.reserveCommonEvent(ce);
    console.info('[coop] in the developer\'s world');
    G.ui?.refreshCoopMenu?.();
  }

  // ---- the world as it changes
  // a change this game made to it (state.js): to the server, the others hear it in a moment (coopworld.js writeSyncs)
  noteWorld(st, kind, key, value) {
    if (this.applying || st !== G.state || !this.world || !writeSyncs(kind, key)) return;
    this.outWorld.set(`${kind}:${key}`, [kind, key, value]);
  }
  flushWorld() {
    if (!this.outWorld.size) return;
    const S = [], V = [], SS = [];
    for (const [kind, key, v] of this.outWorld.values()) {
      if (kind === 'S' && okSwitch(key)) S.push([key, v ? 1 : 0]);
      else if (kind === 'V' && okSwitch(key) && isValue(v ?? 0)) V.push([key, v ?? 0]);
      else if (kind === 'SS' && SELF_KEY.test(key)) SS.push([key, v ? 1 : 0]);
    }
    this.outWorld.clear();
    if (S.length || V.length || SS.length) this.link?.tell?.({ t: 'wf', S, V, SS });
  }
  // another player's changes: here too (the world's part only - Hシーン表示しない never); before this player is in
  // the world, the world it will come into
  onWorldChange(m) {
    const ok = (a, test) => isList(a, MAX_LIST) && a.every(e => Array.isArray(e) && e.length === 2 && test(e));
    if (!ok(m.S, e => okSwitch(e[0]) && (e[1] === 0 || e[1] === 1)) || !ok(m.V, e => okSwitch(e[0]) && isValue(e[1]))
      || !ok(m.SS, e => typeof e[0] === 'string' && SELF_KEY.test(e[0]) && (e[1] === 0 || e[1] === 1))) return;
    if (!this.world) {
      const w = this.wworld;
      if (!w) return;
      for (const [id, v] of m.S) { if (v) w.sw.add(id); else w.sw.delete(id); }
      for (const [id, v] of m.V) { if (v === 0) w.vars.delete(id); else w.vars.set(id, v); }
      for (const [key, v] of m.SS) { if (v) w.self.add(key); else w.self.delete(key); }
      return;
    }
    const st = G.state;
    this.applying = true;
    try {
      for (const [id, v] of m.S) if (worldSwitch(id) && (v || !LIT_FROM_START.includes(id))) st.setSw(id, !!v);     // (those stay lit)
      for (const [id, v] of m.V) if (worldVariable(id)) st.setV(id, v);
      for (const [key, v] of m.SS) { const [mapId, evId, ch] = key.split(','); st.setSelfSw(+mapId, +evId, ch, !!v); }
    } finally { this.applying = false; }
  }
  // the whole world anew (one brought in - the next cycle's): this game's world part becomes it
  applyWholeWorld(w) {
    this.applying = true;
    try { mergeWorld(G.state, w); G.map?.requestRefresh(); } finally { this.applying = false; }
    this.wworld = undefined;
  }

  // every frame (update): false while this player is not in the world yet
  updateWorld(dt) {
    if (G.state && !G.state.switches[NO_H_SWITCH]) G.state.switches[NO_H_SWITCH] = true;
    if (this.wphase === 'connecting' && this.server && !this.link?.open && now() - this.startT > CONNECT_WAIT) { this.fail('no server'); return false; }
    if (!this.world) {
      if (this.wphase === 'prologue') {
        this.tellAt(0);
        // (there it would stand alone among the others until it rested at the bonfire - lighting it is not resting)
        const pc = G.map?.playerChar;
        if (this.ready() && G.map.mapId === this.worldSpawn().mapId && !G.map.interpreter.running() && !pc?.moveRouteForcing && !G.ui?.msg && !G.ui?.sceneOpen) this.prologueDone();
      }
      return false;
    }
    if (this.ready()) this.tellAt(G.map.mapId);
    this.worldMapNow();
    if ((this.wfT -= dt) <= 0) { this.wfT = FLAGS_EVERY; this.flushWorld(); }
    if ((this.wsaveT -= dt) <= 0) { this.wsaveT = WORLD_SAVE_EVERY; this.saveWorldChar(0); }
    const t = now();
    for (const [k, w] of this.lockWait) if (t - w.t > LOCK_WAIT) this.lockWait.delete(k);
    return true;
  }
  // who runs the map this player stands on changed (the server's word): leading it, its roaming monsters are this
  // game's to run; else the one running it sends them (puppets)
  worldMapNow() {
    if (!this.ready()) return;
    const auth = this.authorityId();
    if (auth === this.authNow) return;
    if (this.leadsNow && this.bossBattle) { this.onBossFightEnd(this.bossBattle); this.bossBattle = null; }
    if (this.spectating) this.unspectate(true);
    this.dropRules();
    const was = this.authNow;
    this.authNow = auth;
    this.leadsNow = auth === null;
    if (was !== undefined) G.arena?.release?.();
    G.combat.ownMapMonsters(this.leadsNow);
    console.info('[coop] this map is run by', auth === null ? 'this player' : 'the player ' + auth);
  }

  // ---- one event at a time: an event whose run changes the world (coopworld.js changesWorld) begins only once the
  // server lets this player have it - another in it, the buzzer (for a press). A boss fight is begun by the one running
  // the map (where this player stands); the roaming monsters there are that one's
  mayStart(ev) {
    if (!this.world) return true;
    if (!this.leadsNow && G.combat.isSymbolPage?.(ev)) return false;
    if (!this.leadsNow && G.combat.eventStartsBoss?.(ev)) { this.askRunnerBoss(ev); return false; }
    if (!changesWorld(ev.list)) return true;
    const k = `${G.map.mapId},${ev.id}`;
    if (this.locks.has(k)) return true;
    const t = now(), w = this.lockWait.get(k);
    if (w && t - w.t < LOCK_WAIT) return false;
    const no = this.lockNo.get(k);
    if (no && no.page === ev.page && t - no.t < LOCK_RETRY) return false;
    this.lockWait.set(k, { ev, page: ev.page, t });
    this.link?.tell?.({ t: 'lock', k });
    return false;
  }
  askRunnerBoss(ev) {
    const to = this.authorityId();
    if (!to || G.time < this.bossAskAt) return;
    this.bossAskAt = G.time + 3;
    const pc = G.map.playerChar, d = [2, 4, 6, 8].includes(pc.direction) ? pc.direction : 2;
    this.send({ t: 'lstart', ev: ev.id, x: pc.x, y: pc.y, d, how: ev.trigger === 0 ? 'action' : 'touch' }, to);
    console.info('[coop] the one running this map is asked to begin its boss fight');
  }
  onLockAnswer(m) {
    const k = typeof m.k === 'string' ? m.k : '', w = this.lockWait.get(k);
    this.lockWait.delete(k);
    if (m.t === 'lockno') {
      if (w) { this.lockNo.set(k, { page: w.page, t: now() }); if (w.ev.trigger === 0) G.audio?.playSystemSe(3); }
      return;
    }
    this.locks.add(k);
    // (still there to run: this map, the same page, nothing else running)
    const ev = w?.ev;
    if (ev && this.world && G.map.events[ev.id] === ev && ev.page === w.page && !ev.erased && this.ready() && !G.map.interpreter.running() && ev.start()) return;
    this.releaseLock(k);
  }
  // an event's run ended (gamemap.js, combat.js - a fight it began): its lock goes, what it changed first
  eventDone(mapId, evId, interp = null) {
    const k = `${mapId},${evId}`;
    if (this.locks.has(k)) this.releaseLock(k);
    if (interp?.carried) this.bringFightAlong(interp);
  }
  // (the one whose events run here - the host, a guest leading its map, the developer's world's lead) the event of a boss
  // fight won here carried this player on past what stood in its way (보스 러시: through five doors, the last shutting behind
  // it): the others in that fight on this map come too, beside it - nothing of the event's carried them, and walking they
  // would find the way shut (the doors look open on their side, but only the host's event let its player through)
  // Only as the run of the event that began the fight ends, and once: the fight stays this world's boss fight after it is
  // over, and the map's interpreter that ran an autorun's fight (그랑・기뇰's) goes on to run other events - one of them
  // carrying the player later brings no one
  bringFightAlong(interp) {
    const b = this.bossBattle;
    if (!this.isAuthority() || !b?.done || b.result !== 0 || !b.coopIn || b.coopAlong || !b.coopRun || interp.run !== b.coopRun) return;
    b.coopAlong = true;
    const pc = G.map.playerChar, taken = new Set();
    for (const id of b.coopIn) {
      const p = id === 'host' ? null : this.peers.get(id);
      if (!p?.pose || p.pose.m !== G.map.mapId || b.coopDead?.has(id)) continue;
      if (Math.hypot(p.pose.h[0] / T - 0.5 - pc.fx, p.pose.h[2] / T - 0.5 - pc.fy) < 3) continue;     // (by it already)
      const at = this.arrival(pc.x, pc.y, pc.direction || 2, id, taken);
      this.send({ t: 'tp', x: at.x, y: at.y, d: at.d }, id);
    }
  }
  // the run of the event that began a fight (interpreter.js setup numbers each run)
  runOf(battle) { const it = battle.interpreter; return (it?.root || it)?.run || 0; }
  releaseLock(k) {
    this.locks.delete(k);
    this.flushWorld();
    this.link?.tell?.({ t: 'unlock', k });
  }

  // (the developer's world) this player falls in a boss fight another player runs (its boss here a puppet): by the rules
  // it watches the fight, that one told; else its own death goes on as the original's (its souls, its bonfire)
  worldFalls() {
    if (!this.world || this.leadsNow) return false;
    const to = this.authorityId();
    if (!to || !this.inBossFight()) return false;
    const c = $data.system.sounds?.[15];
    if (c) G.audio?.playSe(c);
    if (this.rules.bossSpectate) { this.spectate(); this.send({ t: 'down', sp: 1 }, to); return true; }
    this.send({ t: 'down' }, to);
    return false;
  }
  // (the developer's world) the common events left out: the adult scenes (BLACK SOULS II's, by number - skilljudge.js)
  worldSkips(id) { return J.commonEventIs('scene', id); }

  // ---- the next cycle is everyone's to say: an event of this player's reaching its preparation (周回プレイ準備) asks
  // the server for a vote (one a player may call once an hour) - everyone on the server says yes or no, more than half
  // yes and everyone goes on to the next cycle: each one's game runs the preparation (its own character's part of it) and
  // the opening alone, and the first one through to its first bonfire brings the next cycle's world (the one before is
  // kept aside on the server). Its run waits: 'wait' while the vote is open, 'go' passed, 'no' not
  cycleVote(interp, id) {
    if (id !== CYCLE_CE || !this.world) return null;
    const v = interp.cycleVote;
    if (v === 'go' || v === 'no') { interp.cycleVote = null; return v; }
    if (!v) {
      interp.cycleVote = 'wait';
      this.myVote = interp;
      this.link?.tell?.({ t: 'vote', k: 'cycle', c: +G.state.v(47) || 0 });
    }
    return 'wait';
  }
  onVoteRefused(m) {
    if (this.myVote) { this.myVote.cycleVote = 'no'; this.myVote = null; }
    G.audio?.playSystemSe(3);
    if (m.why === 'wait' && isInt(m.left, 0, 3600)) G.ui.toast?.(tr('투표는 한 시간에 한 번만 걸 수 있습니다 ({n}분 남음)', { n: Math.ceil(m.left / 60) }));
    else G.ui.toast?.(tr('이미 진행 중인 투표가 있습니다'));
  }
  onVote(m) {
    if (m.k !== 'cycle' || typeof m.id !== 'string' || m.id.length > 16) return;
    this.voting = { id: m.id };
    const n = isInt(m.n, 1, 64) ? m.n : 1;
    if (m.from === this.myId()) { G.ui.toast?.(tr('다음 회차로 넘어갈지 투표를 시작했습니다 ({n}명 중 과반수가 동의하면 넘어갑니다)', { n }), 0, '#ffd870', 6); return; }
    const name = cleanName(m.by) || '?';
    G.ui.askBossJoin?.(yes => { if (this.voting?.id === m.id) this.link?.tell?.({ t: 'ballot', id: m.id, yes: yes ? 1 : 0 }); },
      { title: tr('{name} 님이 다음 회차로 넘어가자고 합니다. 동의하시겠습니까? (과반수가 동의하면 모두 다음 회차로 넘어갑니다)', { name }), yes: tr('동의'), no: tr('반대'), wait: 60 });
  }
  onVoted(m) {
    if (this.voting?.id === m.id) this.voting = null;
    if (G.ui.prompt && !this.voting) G.ui.closeBossPrompt?.();
    const yes = isInt(m.yes, 0, 64) ? m.yes : 0, n = isInt(m.n, 1, 64) ? m.n : 1;
    if (m.pass === 1) { G.ui.toast?.(tr('투표 통과: 모두 다음 회차로 넘어갑니다 (찬성 {yes}/{n})', { yes, n }), 0, '#ffd870', 6); return; }
    G.ui.toast?.(tr('투표 부결 (찬성 {yes}/{n})', { yes, n }), 0, '#f0e6c8', 5);
    if (this.myVote) { this.myVote.cycleVote = 'no'; this.myVote = null; }
  }
  // the vote passed: on to the next cycle - this player's event, if it asked, goes on into the preparation; everyone
  // else's game runs it now. Then the opening alone, into the world at the first bonfire (prologueDone)
  onCycle() {
    if (!this.world) return;
    this.flushWorld();
    for (const k of [...this.locks]) this.releaseLock(k);
    const mine = this.myVote;
    this.myVote = null;
    this.wphase = 'prologue';
    this.cycling = true;
    this.authNow = undefined; this.leadsNow = false;
    this.tellAt(0);
    G.combat.ownMapMonsters(true);
    if (mine) { mine.cycleVote = 'go'; console.info('[coop] on to the next cycle'); return; }
    G.combat.reset();
    G.ui?.closeMenu?.();
    G.map.interpreter.clear();
    G.map.reservedCommon = [];
    const list = $data.commonEvents?.[CYCLE_CE]?.list;
    if (list) G.map.interpreter.setup(list, 0);
    console.info('[coop] on to the next cycle (the vote)');
  }
  // ---- giving another player something of this one's bag (the developer's world - its character is kept, as the
  // other's is): that one is asked, and only once it takes it does it go from this bag to that one. Anything but a key
  // item (the story's) and what is worn - souls (the game's money: kind 'gold') too. The one given to takes what it was
  // asked about, as it was asked
  giveable(kind, id) {
    if (kind === 'gold') return id === 0;
    const d = itemData(kind, id);
    return !!d && ['item', 'weapon', 'armor'].includes(kind) && !(kind === 'item' && d.itype_id === 2);
  }
  // what one gives at a time may be: up to 99 of a thing, so much money
  giveMax(kind) { return kind === 'gold' ? 999999999 : 99; }
  giveAmountOk(kind, n) { return isInt(n, 1, this.giveMax(kind)); }
  have(kind, id) { return kind === 'gold' ? G.state.party.gold : G.state.party.itemCount(kind, id); }
  giftText(kind, id, n) { return kind === 'gold' ? tr('{n} 소울', { n: n.toLocaleString() }) : tr('{item} {n}개', { item: itemData(kind, id)?.name || '?', n }); }
  giveItem(to, kind, id, n) {
    if (!this.world || !this.roster.some(r => r[0] === to && r[0] !== this.myId()) || !this.giveable(kind, id) || !this.giveAmountOk(kind, n)) return false;
    if (this.have(kind, id) < n) return false;
    const g = Math.random().toString(36).slice(2, 10), gifts = (this.gifts ||= new Map());
    for (const [k, o] of gifts) if (now() - o.t > 60) gifts.delete(k);
    gifts.set(g, { to, kind, id, n, t: now() });
    this.send({ t: 'give', g, k: kind, i: id, n }, to);
    return true;
  }
  rosterName(id) { return this.roster.find(r => r[0] === id)?.[1] || this.nameOf(id); }
  onGive(m, from) {
    if (typeof m.g !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.g) || !isInt(m.i, 0, 99999) || !this.giveable(m.k, m.i) || !this.giveAmountOk(m.k, m.n)) return;
    const offers = (this.offers ||= new Map()), t = now();
    for (const [k, o] of offers) if (t - o.t > 60) offers.delete(k);
    // (not now - told so: the ask holds this player still while it shows, so not in a fight, an event or down, nor over
    // another question (a boss fight's, a vote) or another offer; nor again within 20 s of a no to the same player)
    const busy = !!G.ui.prompt || offers.size > 0 || !!G.combat?.inCombat || !!G.combat?.playerDead || !!G.map?.interpreter?.running()
      || t - (this.giveNo?.get(from) ?? -99) < 20;
    if (busy) { this.send({ t: 'givno', g: m.g, b: 1 }, from); return; }
    offers.set(m.g, { from, k: m.k, i: m.i, n: m.n, t });
    const name = this.rosterName(from);
    G.ui.askBossJoin?.(yes => {
      if (offers.get(m.g)?.from !== from) return;
      if (!yes) { offers.delete(m.g); (this.giveNo ||= new Map()).set(from, now()); }
      this.send({ t: yes ? 'givok' : 'givno', g: m.g }, from);
    }, { title: convertEscapes(tr('{name} 님이 {item}[을;를] 주려고 합니다. 받으시겠습니까?', { name, item: this.giftText(m.k, m.i, m.n) })), yes: tr('받는다'), no: tr('받지 않는다'), wait: 30 });
  }
  // (the one giving) its answer: taken - out of this bag now (if it is still here), and it is told to put it in its own
  onGiveAnswer(m, from) {
    const g = this.gifts?.get(m.g);
    if (!g || g.to !== from) return;
    this.gifts.delete(m.g);
    const name = this.rosterName(from);
    if (m.t === 'givno') { G.ui.toast?.(m.b === 1 ? tr('{name} 님이 지금은 받을 수 없습니다', { name }) : tr('{name} 님이 받지 않았습니다', { name })); return; }
    if (this.have(g.kind, g.id) < g.n || now() - g.t > 60) { G.audio?.playSystemSe(3); return; }
    if (g.kind === 'gold') G.state.party.gainGold(-g.n); else G.state.party.gainItem(g.kind, g.id, -g.n);
    this.send({ t: 'gave', g: m.g }, from);
    G.audio?.playSystemSe(1);
    G.ui.toast?.(tr('{name} 님에게 건넸습니다', { name }));
    console.info('[coop] given:', g.kind, g.id, g.n);
  }
  // (the one given to) it is here: what it was asked about, as it was asked
  onGave(m, from) {
    const o = this.offers?.get(m.g);
    if (!o || o.from !== from) return;
    this.offers.delete(m.g);
    if (o.k === 'gold') { G.state.party.gainGold(o.n); G.ui.toast?.(convertEscapes(tr('{item}[을;를] 받았습니다', { item: this.giftText('gold', 0, o.n) }))); G.audio?.playSystemSe(22); }
    else { G.state.party.gainItem(o.k, o.i, o.n); G.ui.notifyGain?.(o.k, o.i, o.n); }
    console.info('[coop] received:', o.k, o.i, o.n);
  }
  // ---- hallucinations seen together (the developer's world): a monster only some see - SEN 0's, the curse's (combat.js
  // privateSymbol) - is run by the one of them who has run it longest (of two at once, the first by id); that one's
  // copies go to the others who see the same (their look's hv): they put their own away and fight it with that one -
  // their blows go to it, and when it falls theirs falls too. Nobody else sees any of it
  sendHallucinations() {
    if (!this.ready()) return;
    const m = G.map.mapId, groups = G.combat.hallGroups();
    for (const p of this.guests()) {
      if (p.pose?.m !== m) continue;
      const list = [];
      if (p.hvm === m && p.hv?.size) for (const [key, g] of groups) if (p.hv.has(key)) for (const e of g.enemies) list.push([...this.enemyEntry(e, g.sym), key, r2(g.age)]);
      const k = JSON.stringify(list);
      if (k === p.henKey && !list.length) continue;
      p.henKey = k;
      this.send({ t: 'hen', m, e: list }, p.id);
    }
  }
  onHallEnemies(m, from) {
    const p = this.peers.get(from);
    if (!p || !this.ready() || m.m !== G.map.mapId || p.pose?.m !== m.m || !isList(m.e, 64)) return;
    const list = [], seen = new Set(G.combat.hallKeysSeen());
    for (const n of m.e) {
      if (!Array.isArray(n) || n.length !== 17) continue;
      const e = this.enemyFrom(n.slice(0, 15)), key = n[15], age = n[16];
      if (!e || typeof key !== 'string' || !HALL_KEY.test(key) || !isNum(age, 1e7) || age < 0) continue;
      if (!seen.has(key) || !this.followHall(key, from, age)) continue;
      e.hallKey = key;
      list.push(e);
    }
    G.combat.applyPuppets(list, from);
  }
  // whether this player takes that one's run of a hallucination it sees too: following it already; or that one has
  // run it longer than this player's own run of it (or the one it follows) - then its own is put away
  followHall(key, from, age) {
    const F = (this.hallFollow ||= new Map()), f = F.get(key), t = now();
    if (f?.from === from) { f.t = t; f.age = age; return true; }
    const longer = (a, b, who, other) => a > b + 0.5 || (Math.abs(a - b) <= 0.5 && who < other);
    if (f) { if (!longer(age, f.age + (t - f.t), from, f.from)) return false; }
    else { const mine = G.combat.hallAge(key); if (mine !== null && !longer(age, mine, from, this.myId())) return false; }
    F.set(key, { from, t, age });
    G.combat.yieldHallucination(key);
    console.info('[coop] a hallucination seen with', from, key);
    return true;
  }
  hallFollowing(key) { return !!this.hallFollow?.has(key); }
  // (each frame) another map: nothing followed; the one followed silent a while, gone from here, or this player not
  // seeing it any more: its own again
  updateHallFollow() {
    const m = G.map?.mapId;
    if (this.hallMap !== m) { this.hallMap = m; this.hallFollow?.clear(); G.combat.dropHallPuppets(); return; }
    if (!this.hallFollow?.size) return;
    const t = now();
    for (const [key, f] of [...this.hallFollow]) {
      if (t - f.t < HALL_WAIT && this.peers.get(f.from)?.pose?.m === m && G.combat.seesHallucination(key)) continue;
      this.hallFollow.delete(key);
      G.combat.dropHallPuppets(f.from, key);
      G.combat.resumeHallucination(key);
    }
  }
  // (combat) a hallucination this player ran, beaten: those who fought it with this player beat theirs too
  hallucinationBeaten(key) {
    if (!this.world || !key) return;
    for (const p of this.hallViewers(key)) this.send({ t: 'hdown', k: key }, p.id);
  }
  onHallDown(m, from) {
    const f = typeof m.k === 'string' && HALL_KEY.test(m.k) ? this.hallFollow?.get(m.k) : null;
    if (!f || f.from !== from) return;
    this.hallFollow.delete(m.k);
    G.combat.dropHallPuppets(from, m.k);
    G.combat.winHallucination(m.k);
  }
  // this player's character, kept on its own PC (its developer-server saves - main.js)
  saveWorldChar(slot = 0) {
    if (this.role !== 'world' || this.wphase !== 'in' || !G.state || !G.map?.grid) return;
    G.saveWorld?.(slot, true);
  }
}
