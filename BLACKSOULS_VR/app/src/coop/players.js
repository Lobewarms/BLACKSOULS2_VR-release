// Co-op's players: who runs a map (where the host stands; on a map the host is not on, one of the guests there), who this
// player is to the others (its name, its look), and the rule statSync - a guest's own numbers, its level's and what it grew.
import { HubLink, LocalLink, LocalSignal, RtcLink, cleanName, isTag, takeRules } from '../coopnet.js';
import { G } from '../globals.js';
import { DEFAULT_RULES, LEAD_TIE, MAX_TEXT, SCOPED, WORLD_RULES, isInt, isList, isNum, now, r2,
  serverUrl } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class PlayersPart {
  // ---- who runs a map: where the host stands, the host; on a map it is not on, one of the guests there - the one there
  // longest (arrivals less than LEAD_TIE s apart: the lowest id). That one runs the map's monsters and the events it
  // begins (a boss fight the host let the guests have) as the host would, and tells the others there what it shows
  // (the same messages); what those fights and events change of the world is sent to the host and kept there
  myId() { return this.link?.id || ''; }
  hostOn(mapId) {
    if (!mapId) return false;
    if (this.role === 'host') return G.map?.mapId === mapId;
    const h = this.peers.get(this.hostId)?.pose;
    return !!h && h.m === mapId;
  }
  // (the host decides it - all see the same one, each one's view of the others' arrival being late by the way there -
  // and tells the guests: sendLeads; the one leading a map keeps it while it stays there. local: as this game sees it)
  leaderOf(mapId, local = false) {
    if (!mapId || this.hostOn(mapId)) return null;
    const told = local ? null : this.leadNow.get(mapId);
    if (told && (told === this.myId() ? this.phantom && G.map?.mapId === mapId : this.peers.get(told)?.pose?.m === mapId)) return told;
    const c = [];
    if (this.phantom && G.map?.mapId === mapId) c.push({ id: this.myId(), t: this.arrT });
    for (const p of this.peers.values()) if (!p.host && p.pose?.m === mapId) c.push({ id: p.id, t: p.arrT ?? now() });
    if (!c.length) return null;
    const first = Math.min(...c.map(x => x.t));
    return c.filter(x => x.t - first < LEAD_TIE).map(x => x.id).sort()[0] || null;
  }
  // (host) who leads each map the guests are on and this player is not: the one leading it still there keeps it, else the
  // one there longest - told to the guests when it changes (and to one just come)
  sendLeads() {
    const maps = new Set();
    for (const p of this.guests()) if (p.pose?.m > 0 && !this.hostOn(p.pose.m)) maps.add(p.pose.m);
    const next = new Map();
    for (const m of maps) {
      const cur = this.leadNow.get(m);
      const id = cur && this.peers.get(cur)?.pose?.m === m ? cur : this.leaderOf(m, true);
      if (id) next.set(m, id);
    }
    this.leadNow = next;
    const t = now();
    for (const [m, id] of next) this.ledBy.set(m, { id, t });
    for (const [m, b] of this.ledBy) if (t - b.t > 30) this.ledBy.delete(m);
    const l = [...next].sort((a, b) => a[0] - b[0]), key = JSON.stringify(l);
    if (key !== this.leadKey) { this.leadKey = key; this.send({ t: 'lead', l }); }
  }
  onLead(m) {
    if (!isList(m.l, 500) || !m.l.every(e => Array.isArray(e) && e.length === 2 && isInt(e[0], 1, 9999) && typeof e[1] === 'string' && e[1].length <= 64)) return;
    this.leadNow = new Map(m.l);
  }
  // (guest) who runs the map it stands on: the host's id, a leading guest's id - or null: this player leads it
  authorityId() {
    // (the developer's world: the one the server says runs it - the one there longest)
    if (this.role === 'world') {
      if (!this.world) return null;
      const l = this.leadNow.get(G.map?.mapId);
      return !l || l === this.myId() ? null : l;
    }
    if (this.role !== 'guest') return null;
    const m = G.map?.mapId;
    if (this.hostOn(m)) return this.hostId;
    const l = this.leaderOf(m);
    return l === this.myId() ? null : l;
  }
  // this player runs the map it stands on: the host, or a guest leading a map the host is not on
  isAuthority() { return this.role === 'host' || (this.shared && this.leadsNow); }
  // (guest) a message about this map from the one who runs it
  fromAuthority(from) { return this.shared && !!from && from === this.authorityId(); }

  // ---- who this player is to the others: its name (English; kept in the settings - typed at the prologue's name
  // input with the hero's, changed in the co-op menu; until then the hero's own, if it is English) and the random
  // key its game keeps; the server makes the tag the others know it by of that key (coopnet.js) - over the dev links
  // the tag is made here
  myName() { return cleanName(G.settings.coopName) || cleanName(G.state?.actor(1)?.name) || '?'; }
  hasName() { return this.myName() !== '?'; }
  setMyName(name) {
    const n = cleanName(name);
    if (!n) return false;
    G.settings.coopName = n;
    G.saveSettings?.();
    return true;
  }
  myKey() {
    if (/^[0-9a-f]{32}$/.test(this.key)) return this.key;
    let k = G.settings.coopKey;
    if (typeof k !== 'string' || !/^[0-9a-f]{32}$/.test(k)) {
      k = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (!G.devLaunch) { G.settings.coopKey = k; G.saveSettings?.(); }      // (a test window keeps one of its own)
    }
    return (this.key = k);
  }
  async makeTag() {
    try {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.myKey()));
      this.myTag = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    } catch { this.myTag = ''; }
  }
  // another player's name (as it says it) and tag (the server's word; over the dev links its own)
  nameOf(id) { return this.peers.get(id)?.name || this.link?.info?.get(id)?.name || '?'; }
  // a chat line's or a voice's sender, as this player knows it (the community server: its list of who is on it too); one
  // this player muted (co-op menu → members: kept by its tag)
  chatName(id) { return this.roster.find(r => r[0] === id)?.[1] || this.nameOf(id); }
  chatTag(id) { return this.roster.find(r => r[0] === id)?.[2] || this.tagOf(id); }
  muted(id) { const tag = this.chatTag(id); return !!tag && Array.isArray(G.settings.chatMuted) && G.settings.chatMuted.includes(tag); }
  // who is in this session with this player now (id -> name): one coming and one going is said (coopchat.js notePeer) -
  // those already there as it came in (the first moments) are not said to come
  noteMembers() {
    if (!G.chat?.on) { this.knownMembers = null; return; }
    const t = now(), list = new Map(this.members().filter(x => !x.me && x.name && x.name !== '?').map(x => [x.id, x.name]));
    if (!this.knownMembers) { this.knownMembers = list; this.membersSince = t; G.chat.clear(); return; }
    if (t - this.membersSince > 3) {
      for (const [id, name] of list) if (!this.knownMembers.has(id)) G.chat.notePeer(name, true);
      for (const [id, name] of this.knownMembers) if (!list.has(id)) G.chat.notePeer(name, false);
    }
    this.knownMembers = list;
  }
  tagOf(id) { return this.link?.info?.get(id)?.tag || this.peers.get(id)?.tag || ''; }
  // (host) this host's list of the banned, kept in its settings: [{ tag, name, at }]
  bans() { return Array.isArray(G.settings.coopBans) ? G.settings.coopBans.filter(b => b && isTag(b.tag)) : []; }
  banTags() { return this.bans().map(b => b.tag); }
  // (host) a guest sent away from this world - banned, it may not come back (the server keeps it out by its tag)
  kick(id, ban = false) {
    const p = this.peers.get(id);
    if (this.role !== 'host' || !p || p.host) return false;
    const name = this.nameOf(id), tag = this.tagOf(id);
    if (ban && tag && !this.banTags().includes(tag)) {
      G.settings.coopBans = [{ tag, name, at: Date.now() }, ...this.bans()].slice(0, 200);
      G.saveSettings?.();
    }
    if (this.link?.kick) { this.link.kick(id, ban); if (ban) this.link.setBans(this.banTags()); }
    else { this.send({ t: 'kick', ban: ban ? 1 : 0 }, id); this.sentAway.add(id); this.peerGone(id, 'sent away'); }
    console.info(`[coop] ${ban ? 'banned' : 'sent away'}:`, name, tag);
    return true;
  }
  unban(tag) {
    G.settings.coopBans = this.bans().filter(b => b.tag !== tag);
    G.saveSettings?.();
    if (this.role === 'host') this.link?.setBans?.(this.banTags());
  }

  // ---- the rule statSync: a guest's own numbers - its level's and what it grew (state.js bareParam: not its
  // equipment, states or oaths) - brought to the host's: the six together by their average, HP and MP each by itself
  ownStats() {
    const a = G.state?.party?.leader();
    if (!a?.bareParam) return null;
    const avg = [2, 3, 4, 5, 6, 7].reduce((s, i) => s + a.bareParam(i), 0) / 6;
    return { p: r2(avg), hp: a.bareParam(0), mp: a.bareParam(1) };
  }
  // (host) its own numbers to the guests whenever they change (one coming in gets them with its welcome)
  sendStats() {
    const s = this.ownStats(), key = JSON.stringify(s);
    if (!s || key === this.stKey) return;
    this.stKey = key;
    this.send({ t: 'st', ...s });
  }
  // (guest) the host's own numbers
  onStats(m) {
    if (!m || !isNum(m.p, 1e7) || !(m.p > 0) || !isNum(m.hp, 1e8) || !(m.hp > 0) || !isNum(m.mp, 1e8) || m.mp < 0) return;
    this.hostSt = { p: m.p, hp: m.hp, mp: m.mp };
    this.syncStats();
  }
  // (guest) this party's numbers by the rule: brought to the host's (each one by what the leader's take - its numbers
  // stay as they were against each other's), or its own again. HP and MP keep their share of the whole
  syncStats() {
    const st = G.state, a = st?.party?.leader();
    if (!a?.bareParam) return;
    let k = null;
    const h = this.hostSt;
    if (this.phantom && this.rules.statSync && h) {
      const avg = [2, 3, 4, 5, 6, 7].reduce((s, i) => s + a.bareParam(i), 0) / 6, hp = a.bareParam(0), mp = a.bareParam(1);
      const p = avg > 0 ? h.p / avg : 1;
      k = [hp > 0 ? h.hp / hp : 1, mp > 0 && h.mp > 0 ? h.mp / mp : 1, p, p, p, p, p, p].map(x => Number(x.toPrecision(6)));
    }
    const members = st.party.members(), key = JSON.stringify([k, members.map(m => m.id)]);
    if (key === this.syncKey) return;
    this.syncKey = key;
    for (const m of members) {
      const fh = m.mhp > 0 ? m.hp / m.mhp : 1, fm = m.mmp > 0 ? m.mp / m.mmp : 1;
      m.syncScale = k;
      if (m.hp > 0) m.hp = Math.max(1, Math.min(m.mhp, Math.round(fh * m.mhp)));
      m.mp = Math.max(0, Math.min(m.mmp, Math.round(fm * m.mmp)));
    }
    if (k) console.info('[coop] numbers brought to the host\'s:', JSON.stringify(k));
  }
  // (guest) by how much this player's numbers are brought to the host's now, if at all: { p, hp, mp }
  syncFactors() { const k = this.phantom ? G.state?.party?.leader()?.syncScale : null; return k ? { p: k[2], hp: k[0], mp: k[1] } : null; }

  // open this world on a co-op server (this PC's: { local: true, port }; or one elsewhere, with its host PIN)
  openWorld(server) {
    this.start('host', () => new HubLink(serverUrl(server), { role: 'host', pin: server.local ? '' : server.hostPin || '', key: this.myKey(), name: this.myName(), bans: this.banTags() }), server);
  }
  // go into the world of whoever hosts on that server (its PIN)
  visit(server) {
    this.start('guest', () => new HubLink(serverUrl(server), { role: 'guest', pin: server.pin || '', key: this.myKey(), name: this.myName() }), server);
  }
  // (dev) two windows of this browser: ?coop=host|join&room=.. - over a BroadcastChannel, or WebRTC (&link=rtc,
  // one guest)
  startLocal(role, room, rtc = false) {
    this.start(role, rtc ? () => new RtcLink(new LocalSignal(room, role), { initiator: role === 'guest', relay: false }) : () => new LocalLink(room), null);
  }
  start(role, makeLink, server) {
    this.end('restart', { stay: true });
    this.role = role;
    this.server = server;
    this.lastServer = server;
    this.lastError = '';
    this.linked = false;
    this.localRules = { ...DEFAULT_RULES };
    this.askT = 0;
    this.evMap = 0; this.scrKey = '';
    this.sentAway.clear();
    this.hostSt = null; this.stKey = ''; this.syncKey = '';
    this.makeTag();
    this.helloT = -99;
    this.startT = now();
    const link = makeLink();
    link.onmessage = (text, from) => { if (this.link === link) this.receive(text, from); };
    link.onclose = why => { if (this.link === link && this.role) this.linkLost(why); };
    link.onpeer = (id, role, on) => { if (this.link === link && !on) this.peerGone(id, 'left'); else if (this.link === link && on) this.lookKey = ''; };
    link.onrules = rules => { if (this.link === link) this.onRules(rules); };
    link.onworld = m => { if (this.link === link) this.onWorldMsg(m); };
    this.link = link;
    console.info(`[coop] ${role}`, server ? serverUrl(server) : '(this browser)');
  }
  // stay: the game is about to be replaced anyway (a save loaded, the title) - a guest is not sent home first
  end(why = 'end', { stay = false } = {}) {
    if (!this.role) return;
    if (this.peers.size) this.send({ t: 'bye' });
    // (the developer's world: this player's character is kept on its PC as it goes - its developer-server autosave - however
    // it goes: left, another save loaded, the title)
    if (this.world) { this.flushWorld(); this.saveWorldChar(0); }
    this.wphase = ''; this.wworld = undefined; this.roster = []; this.locks.clear(); this.lockWait.clear(); this.lockNo.clear();
    this.knownMembers = null;
    this.outWorld.clear(); this.cycling = false; this.myVote = null; this.voting = null; this.atSent = undefined; this.pendingJoin = null;
    this.worldRules = { ...WORLD_RULES }; this.isAdmin = false; this.adminTry = null; this.myPvp = false; this.hallFollow?.clear(); this.hallMap = 0;
    this.outLoot.length = 0; this.lootAt.clear();
    const back = this.summoned && !stay;
    for (const p of this.peers.values()) { p.avatar?.dispose(); p.aimMk?.dispose(); }
    this.peers.clear();
    this.hostId = null;
    this.flags.clear();
    this.follow = null;
    this.saying = null; this.pics.clear(); this.ownPics.clear(); this.fxOut.length = 0; this.arenaMsg = null; this.scrOf.clear(); this.lastMusic = null;
    this.bossBattle = null; this.bossStarter = null;
    this.bossCall = null; this.hostTrip = null; this.tripNow = null; this.callOpen = null;
    this.leadNow = new Map(); this.leadKey = '';
    // (watching a boss fight fallen as the visit ends: a guest goes home as it was; the host's death goes on now)
    if (this.spectating) { const host = this.role === 'host'; this.unspectate(false); if (host) setTimeout(() => G.combat.onPlayerDeath(null), 0); }
    G.ui?.closeRemoteMessage?.();
    G.ui?.closeBossPrompt?.();
    const link = this.link;
    this.link = null;
    link?.close();
    this.role = null;
    if (back) this.goHome(); else { this.summoned = false; this.home = null; }
    console.info('[coop] ended:', why);
  }
  // the link went down: the session is over - the buzzer, and the co-op menu says why (one that never got going: why
  // it could not)
  linkLost(why) {
    if (this.role === 'guest' || this.role === 'world' ? !this.summoned : !this.linked) { this.fail(why); return; }
    this.lastError = why === 'server closed' || why === 'denied kicked' || why === 'denied banned' ? why : '';
    this.end(`link ${why}`);
    G.audio?.playSystemSe(3);
    this.tellWhy();
  }
  fail(why) {
    this.lastError = String(why || 'connect');
    this.end(`could not: ${this.lastError}`);
    G.audio?.playSystemSe(3);            // (the buzzer: it did not work - and why, at once: the co-op menu says it too)
    this.tellWhy();
  }
  // why it could not, or why it ended, as a notice (the co-op menu's note: before, only there - the menu is closed by
  // then, and all one heard was the buzzer)
  tellWhy() {
    const note = this.lastError && G.ui?.coopNote?.(this.lastError, this.lastServer);
    if (note) G.ui.toast(note);
  }
  peerGone(id, why) {
    const p = this.peers.get(id);
    if (!p) return;
    p.avatar?.dispose();
    p.aimMk?.dispose();
    this.peers.delete(id);
    // (one gone from the boss fight is out of it: if it was the last one in it standing, everyone in it is down)
    const b = this.bossBattle;
    if (b?.coopIn?.delete(id)) { b.coopDead.delete(id); if (this.bossFightOn() === b && this.allDown(b)) this.wipe(b, false); }
    console.info(`[coop] ${p.host ? 'host' : 'player'} gone:`, why);
    G.ui?.refreshCoopMenu?.();
    if (this.role === 'guest' && p.host) this.end(`host ${why}`);
  }

  send(msg, to = null) {
    try { this.link?.send(JSON.stringify(msg), to, msg.t === 'p', this.role === 'world' && SCOPED.has(msg.t)); } catch (e) { console.warn('[coop] send failed', e); }
  }
  // standing in a map that is shown, not moving between maps
  ready() { return !!(G.state && G.map?.grid && G.view?.mesh && G.view.mapId === G.map.mapId && !G.map.transferring); }
  // someone heard from: a host knows only the guests it let in; a guest in the host's world sees the others there too
  peerFor(from, add) {
    let p = this.peers.get(from);
    if (!p && add && this.peers.size < this.rules.maxPlayers - 1) {
      p = { id: from, host: false, heard: now(), seq: -1, avatar: null, pose: null };
      this.peers.set(from, p);
      this.lookKey = '';                   // (the newcomer is told what this one looks like)
      this.leadKey = '';                   // (and who leads the maps the host is not on)
      G.ui?.refreshCoopMenu?.();           // (the co-op menu, if it is up, counts it)
    }
    return p || null;
  }

  receive(text, from) {
    if (!this.role || typeof text !== 'string' || text.length > MAX_TEXT || typeof from !== 'string' || from.length > 40) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    const known = this.peers.get(from);
    if (known) known.heard = now();
    // (only the host steers a guest's world - through the server, a guest knows who the host is)
    const fromHost = this.role === 'guest' && (this.hostId ? from === this.hostId : !this.link?.hostId || from === this.link.hostId);
    if (this.role === 'host' && this.sentAway.has(from)) return;
    switch (m.t) {
      case 'hello': if (this.role === 'host') this.onHello(m, from); break;
      case 'welcome': if (fromHost && !this.summoned) this.onWelcome(m, from); break;
      case 'full': case 'refuse':
        // (the host will not have it: its world is full, or the games are not the same - the menu says which)
        if (fromHost && !this.summoned) this.fail(m.t === 'full' ? 'full' : m.why === 'version' ? 'version' : m.why === 'banned' ? 'banned' : 'game');
        break;
      case 'map': if (this.phantom && (from === this.hostId || this.joiningTo(from))) this.onMap(m); break;
      case 'flags': if (this.phantom && from === this.hostId) this.onFlags(m); break;
      case 'ev': if (this.fromAuthority(from)) this.onEvents(m); break;
      case 'en': if (this.fromAuthority(from)) this.onEnemies(m); break;
      // (the developer's world: also of one's hallucination this player sees too - puppetOf finds whose)
      case 'tg': if (this.fromAuthority(from) || this.world) this.onMark(m, from); break;
      case 'tgx': if (this.fromAuthority(from) || this.world) this.onMarkEnd(m, from); break;
      case 'ax': if (this.fromAuthority(from) || this.world) this.onAct(m, from); break;
      case 'lp': if (this.fromAuthority(from) || this.world) this.onLeapMsg(m, from); break;
      case 'bx': if (this.fromAuthority(from) || this.world) this.onBossMoveMsg(m, from); break;
      case 'bi': if (this.fromAuthority(from) || this.world) this.onImpactMsg(m, from); break;
      case 'hen': if (this.world) this.onHallEnemies(m, from); break;
      case 'hdown': if (this.world) this.onHallDown(m, from); break;
      case 'ar': if (this.fromAuthority(from)) this.onArenaMsg(m); break;
      case 'arx': if (this.fromAuthority(from)) G.arena?.release(); break;
      // (what its events show: taken in order, each checked against this game's own events - coopguard.js)
      case 'say': case 'sayx': case 'pic': case 'fx': if (this.fromAuthority(from)) this.inOrder(m, from); break;
      case 'hit': if (this.isAuthority() || this.world) this.onHit(m, from); break;      // (the world: also on a hallucination this player runs)
      case 'wf': if (this.role === 'host') this.onWorldFlags(m, from); break;
      case 'lead': if (this.role === 'guest' && from === this.hostId) this.onLead(m); break;
      case 'bcall': if (this.role === 'host') this.onBossCall(m, from); break;
      case 'bgo': case 'bcok': if (this.phantom && from === this.hostId) this.onBossCallAnswer(m.t === 'bgo'); break;
      case 'bcx': if (this.role === 'host') this.onCallWithdrawn(from); break;
      case 'lstart': if (this.shared && this.leadsNow) this.onLeadStart(m, from); break;
      case 'ow': this.onStruckMsg(m, from); break;
      case 'pv': this.onPvp(m, from); break;
      case 'cl': this.onClash(m, from); break;
      case 'bn': this.onBounced(from); break;
      case 'sh': this.onShotMsg(m, from); break;
      case 'boss': if (this.role === 'host') this.onBossAsk(m, from); break;
      case 'ba': if (this.isAuthority()) this.onJoinAnswer(m, from); break;
      case 'down': if (this.isAuthority()) this.onDown(m, from); break;
      case 'come': if (this.role === 'host') this.onCome(from); break;
      case 'rev': if (this.shared && (from === this.hostId || this.fromAuthority(from))) this.unspectate(true); break;
      // (the developer's world: down for good in another's boss fight - its own death, as the original's)
      case 'wipe': if (this.shared && (from === this.hostId || this.fromAuthority(from)) && this.spectating) { if (this.world) { this.unspectate(false); G.combat.onPlayerDeath(null); } else this.respawn(); } break;
      case 'bq': if (this.shared && (from === this.hostId || this.peers.has(from))) this.onJoinAsk(m, from); break;
      case 'pst': if (this.shared && (from === this.hostId || this.fromAuthority(from))) this.onEventState(m); break;
      case 'kill': if (this.canSee(from)) this.onKill(m); break;
      // (a chat line, a voice: from one this player sees - coopchat.js, coopvoice.js; a muted one's let go)
      case 'ch': if (this.canSee(from)) G.chat?.onChat(from, m, this.chatName(from), this.peers.get(from)?.avatar, this.muted(from)); break;
      case 'vo': if (this.canSee(from)) G.voice?.onVoice(from, m, this.muted(from)); break;
      case 'tp': if (this.shared && (from === this.hostId || from === this.authNow || this.joiningTo(from))) this.onBrought(m); break;     // (the one running this map: bringFightAlong)
      // (the rules, from the host itself - only over the dev links: a server tells them itself)
      case 'rules': if (this.role === 'guest' && fromHost && !this.link?.rules) { this.localRules = takeRules(m.r); this.onRules(this.localRules); } break;
      case 'bossno': if (this.phantom && from === this.hostId) G.audio?.playSystemSe(3); break;
      case 'st': if (this.role === 'guest' && fromHost) this.onStats(m); break;
      // (the dev links: the host sent this guest away - with a server, the server ends it)
      case 'kick': if (this.role === 'guest' && fromHost) { this.lastError = m.ban ? 'banned' : 'kicked'; this.end(this.lastError); G.audio?.playSystemSe(3); } break;
      case 'scr': if (this.phantom && (from === this.hostId || this.peers.has(from))) this.onScreen(m, from); break;
      // (the developer's world: something another player gives this one - asked first - and the answers)
      case 'give': if (this.world) this.onGive(m, from); break;
      case 'givok': case 'givno': if (this.world) this.onGiveAnswer(m, from); break;
      case 'gave': if (this.world) this.onGave(m, from); break;
      case 'loot': if (this.world) this.onLoot(m, from); break;          // (what another got from the world - shareLoot)
      case 'look': this.onLook(m, from); break;
      case 'p': this.onPose(m, from); break;
      case 'bye': this.peerGone(from, 'said goodbye'); break;
      default: break;
    }
  }
}
