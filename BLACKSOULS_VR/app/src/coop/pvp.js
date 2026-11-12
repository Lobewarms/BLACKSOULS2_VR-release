// Co-op PvP (the server's rule pvp; in the developer's world each player's own): who may strike whom, blows between players.
import * as THREE from 'three';
import { resolveAudio } from '../assets.js';
import { musicOk } from '../coopguard.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { textColor } from '../ui.js';
import { FOLLOW_GRACE, isInt, isList, isNum, now, nums, r3, waitFor } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class PvpPart {
  // ---- PvP (the server's rule pvp; in the developer's world each player's own - myPvp: two who both turned it on): the
  // other players this player's blows can reach here - standing on this map, not watching a fight fallen
  pvpWith(p) { return this.role === 'world' ? this.myPvp && !!p?.pvp : !!this.rules.pvp; }
  pvpWithId(id) { return this.pvpWith(this.peers.get(id)); }
  // this player may strike or be struck by another at all (combat.js: the swing, the clash, the shots)
  get pvpAny() { return this.role === 'world' ? this.myPvp : !!this.rules.pvp; }
  setMyPvp(on) {
    if (this.role !== 'world') return false;
    this.myPvp = !!on;
    this.lookKey = '';                    // (the others see it at once: its look, the mark over its name)
    console.info('[coop] this player\'s PvP:', this.myPvp ? 'on' : 'off');
    return true;
  }
  pvpPeers() {
    if (!this.active || (this.role === 'guest' && !this.summoned) || (this.role === 'world' && !this.world)) return [];
    return [...this.peers.values()].filter(p => this.pvpWith(p) && p.avatar?.cur && p.pose && p.pose.m === G.map?.mapId && !p.pose.sp);
  }
  // their bodies: { id, x, z (where it is seen), y (its floor), r, h }
  pvpTargets() {
    return this.pvpPeers().map(p => {
      const c = p.avatar.cur;
      return { id: p.id, x: c.x, z: c.z, y: G.floorAt ? G.floorAt(c.x / T - 0.5, c.z / T - 0.5) : c.y - 1.6, r: 0.38, h: 1.75 };
    });
  }
  // this player's blade met another's weapon or shield (combat.js clashWithPlayers): it is told how (k: 1 taken on its
  // shield, 2 held off by its blade, 3 its blade beaten aside, 4 turned aside by its shield, 5 sliding along its blade;
  // side: which of its hands) - its hand jolts; held off, everyone sees the ring of a guard on it ('ow')
  sendClash(to, side, k) { this.send({ t: 'cl', side, k }, to); }
  onClash(m, from) {
    const p = this.peers.get(from);
    if (!p || !this.pvpWith(p) || !this.canSee(from) || p.pose?.m !== G.map?.mapId || !this.ready()) return;
    if (!['right', 'left'].includes(m.side) || !isInt(m.k, 1, 5)) return;
    const t = now();
    p.cls = (p.cls || []).filter(x => t - x < 1);
    if (p.cls.length >= 10) return;
    p.cls.push(t);
    if (G.combat.clashed(m.side, m.k) && m.k <= 2) this.send({ t: 'ow', id: 0, k: 1 });
  }
  // a blow of this player's reached another one (combat.js strikePlayer): the attack skill, how hard, and this
  // player's numbers - the one struck works out the rest; sa: how much a swung blow wears its super armor down
  sendPvp(to, s, mult, crit, actor, item = false, sa = 0) {
    const nums = ['atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mhp', 'mp', 'mmp', 'level'];
    const a = {};
    for (const k of nums) a[k] = Math.round(+actor[k] || 0);
    const el = (actor.atkElements?.() || []).filter(x => isInt(x, 1, 99)).slice(0, 8);
    this.send({ t: 'pv', s, u: item ? 1 : 0, m: r3(mult), c: crit ? 1 : 0, a, el, ...(sa > 0 ? { sa: r3(sa) } : {}) }, to);
    if (sa > 0) (this.swungAt ||= new Map()).set(to, now());             // (a swung blow: it may be told it bounced - onBounced)
  }
  // a swung blow of this player's was taken on that one's shield (its onPvp): a light weapon bounces off it (combat.js
  // bounce) - only just after this player swung at that one, once a blow
  onBounced(from) {
    const p = this.peers.get(from), at = this.swungAt?.get(from);
    if (!p || !this.pvpWith(p) || !this.canSee(from) || p.pose?.m !== G.map?.mapId || !this.ready() || at === undefined || now() - at > 1.5) return;
    this.swungAt.delete(from);
    G.combat.bounce();
  }
  // another player's blow reached this one (PvP): judged here (combat.js pvpStruck) - and told to everyone ('ow')
  onPvp(m, from) {
    const p = this.peers.get(from);
    // (judged here: in the developer's world only when this player and the striker both have it on)
    if (!p || !this.pvpWith(p) || !this.canSee(from) || p.pose?.m !== G.map?.mapId || !this.ready()) return;
    const t = now();
    p.pvs = (p.pvs || []).filter(x => t - x < 1);
    if (p.pvs.length >= 10) return;                          // (more than a person can swing)
    p.pvs.push(t);
    // (a skill - the weapon's own attack, a spell - or an item thrown: u)
    const s = isInt(m.s, 1, 99999) && (m.u === undefined || m.u === 0 || m.u === 1) ? (m.u === 1 ? $data.items[m.s] : $data.skills[m.s]) : null;
    const a = m.a && typeof m.a === 'object' ? m.a : null;
    const nums = ['atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mhp', 'mp', 'mmp', 'level'];
    if (!s || !isNum(m.m, 20) || m.m < 0 || !a || !nums.every(k => isNum(a[k], 1e9)) || !isList(m.el, 8) || !m.el.every(x => isInt(x, 1, 99))) return;
    // (sa: how much it wears this one's super armor down - a swung blow, by its weapon; an older version sends none)
    if (m.sa !== undefined && (!isNum(m.sa, 5) || m.sa < 0)) return;
    // (a stand-in for the striker: its numbers as sent, its attack's elements)
    const by = { ...Object.fromEntries(nums.map(k => [k, a[k]])), tp: 0, atkElements: () => m.el.slice(), elementRate: () => 1, isStateAffected: () => false };
    const c = p.avatar?.cur, from3 = c ? new THREE.Vector3(c.x, c.y - 0.6, c.z) : null;
    const how = G.combat.pvpStruck(by, s, m.m, from3, m.sa || 0);
    if (how && how !== 'dodge') this.send({ t: 'ow', id: 0, k: how === 'hit' ? 0 : how === 'guard' ? 1 : 2 });
    // (a swung blow taken on this one's shield: the striker is told - a light weapon bounces off)
    if ((how === 'guard' || how === 'perfect') && m.sa > 0 && G.combat.hasShield && G.combat.shieldOut) this.send({ t: 'bn' }, from);
  }
  // where the host stands, as this guest sees it (a mark that follows the host)
  hostChest(out) {
    const a = this.peers.get(this.authNow || this.hostId)?.avatar;          // (the one who runs this map: the host, or a guest)
    if (!a?.cur) return null;
    return out.set(a.cur.x, a.cur.y - 0.6, a.cur.z);
  }
  // (guest) fallen in the host's world: home, as it was before it came
  // By the server's rules: in a boss fight it is in, it watches the fight (bossSpectate, with guestRespawn) until the
  // host says it is over; else it comes back at the last bonfire (guestRespawn) - or it goes home. Either way the host
  // is told it fell ('down': watching it - sp - or out of it)
  phantomFell() {
    const c = $data.system.sounds?.[15];
    if (c) G.audio?.playSe(c);
    const r = this.rules;
    // (leading the map, in the boss fight the guests here run: watching it while others in it stand, by the rules, as
    // the host does in its own - else that fight is lost)
    if (this.leadsNow && this.bossFightOn()) {
      if (r.guestRespawn && this.hostFalls()) return;
      this.leadLost();
    }
    const to = this.authorityId(), fight = !!to && this.inBossFight();      // (the host's, or the guest's leading it)
    if (r.bossSpectate && r.guestRespawn && fight) { this.spectate(); this.send({ t: 'down', sp: 1 }, to); return; }
    if (fight) this.send({ t: 'down' }, to);
    if (r.guestRespawn) { this.respawn(); return; }
    this.end('fell');
  }
  // (guest) the one running this map is held by a scene of its world (an event holding it - not one waiting on its
  // fight): this guest is held too - no walking (player.js canMove), no blows, shots or items (combat.js paused)
  heldByScene() {
    if (!this.phantom || this.leadsNow || !this.authNow) return false;
    const a = this.peers.get(this.authNow)?.pose;
    return !!a && a.hd === 1 && a.m === G.map?.mapId;
  }
  // (guest) in a boss fight of the one running this map (the host, or a guest leading it): a boss of it here that this
  // guest is not out of
  inBossFight() { return this.shared && [...G.combat.puppets.values()].some(e => e.alive && e.boss && e.battle && !e.outOfFight); }
  // fallen, watching the boss fight it was in: unseen (a shade to the others), untouchable, its hands empty - up again
  // when the fight is won ('rev'), or brought down for good when everyone in it is ('wipe'); the original's YOU DIED
  spectate() {
    if (this.spectating) return;
    this.spectating = true;
    G.combat.spectating = true;
    G.combat.setGhostly?.(true);
    const a = G.state.party.leader();
    if (a) a.hp = 0;
    G.ui.showBanner?.('YOU DIED', textColor(10), false);
    console.info('[coop] fallen in the boss fight: watching it');
  }
  unspectate(revive) {
    if (!this.spectating) return;
    this.spectating = false;
    G.combat.spectating = false;
    G.combat.setGhostly?.(false);
    if (revive) { const a = G.state.party.leader(); if (a) { a.removeState(1); a.hp = a.mhp; } G.audio?.playSystemSe(16); }
  }
  // (guest) back at the last bonfire of the host's world - the one it rested at itself (phantomBonfire), else where the
  // host last rested (its variables 29-31, as the original's death takes the player) - whole again; one on another map than the host waits there until the host
  // moves on, or goes back to it from the co-op menu. Its own game's souls are not touched (it is never saved while away)
  async respawn() {
    this.unspectate(false);
    this.respawning = true;              // (nothing here comes for it meanwhile - combat.js updateSymbols, askBossStart)
    try { await this.respawnNow(); } finally { this.respawning = false; }
  }
  async respawnNow() {
    G.ui.showBanner?.('YOU DIED', textColor(10), false);
    G.screen.fadeOut(30);
    await waitFor(() => G.screen.brightness <= 1, 1500);
    if (!this.phantom) return;
    for (const a of G.state.party.members()) a.recoverAll();
    // (at the bonfire it rested at itself - phantomBonfire - else the host's last one)
    const st = G.state, r = this.restAt, [map, x, y] = r ? [r.m, r.x, r.y] : [st.v(31), st.v(29), st.v(30)];
    if (isInt(map, 1, 9999) && $data.mapInfos?.has(map) && isInt(x, 0, 999) && isInt(y, 0, 999)) G.map.reserveTransfer(map, x, y, 2, 0);
    else { const h = this.peers.get(this.hostId)?.pose; if (h) G.map.reserveTransfer(h.m, Math.round(h.h[0] / T - 0.5), Math.round(h.h[2] / T - 0.5), 2, 0); else G.screen.fadeIn(16); }
    console.info('[coop] back at the bonfire');
  }
  // (guest) to the host's side, wherever it is
  goToHost() { if (this.phantom && this.hostId && !this.spectating) this.send({ t: 'come' }, this.hostId); }
  awayFromHost() { const h = this.peers.get(this.hostId)?.pose; return this.phantom && !!h && h.m > 0 && h.m !== G.map.mapId; }
  // the host's enemies on this map: puppets of them (combat.js applyPuppets)
  onEnemies(m) {
    if (m.m !== G.map.mapId || !isList(m.e, 200) || !this.ready()) return;
    const list = [];
    for (const n of m.e) {
      const e = this.enemyFrom(n);
      if (!e) {
        // (one not taken stays as it was - not put away as if gone; said once a while, to be found)
        const k = Array.isArray(n) && isInt(n[0], 1, Number.MAX_SAFE_INTEGER) ? n[0] : 0;
        if (k && G.combat.puppets.has(k)) list.push({ keep: k });
        if (!this.badEnemyAt || now() - this.badEnemyAt > 5) { this.badEnemyAt = now(); console.warn('[coop] enemy entry not taken:', JSON.stringify(n).slice(0, 240)); }
        continue;
      }
      list.push(e);
    }
    G.combat.applyPuppets(list);
  }
  // the host's screen tone, brightness (faded in and out with it - update) and music
  // a screen as the one sending it has it (the host, or a guest leading a map - each one's kept: the one running the map
  // this guest is on is the one shown - mapNow)
  onScreen(m, from) {
    const t = m.tone;
    if (!Array.isArray(t) || t.length !== 4 || !t.every((v, i) => isNum(v, 255) && (i < 3 || v >= 0))) return;
    const loop = (l, folder) => (l === null ? null : Array.isArray(l) && l.length === 3 && typeof l[0] === 'string' && l[0].length <= 80
      && isInt(l[1], 0, 100) && isInt(l[2], 50, 150) && resolveAudio(folder, l[0]) && musicOk(folder === 'Audio/BGM' ? 'bgm' : 'bgs', l[0])
      ? { name: l[0], volume: l[1], pitch: l[2] } : undefined);         // (music the game's maps and events play - coopguard.js)
    const scr = { tone: t.slice(), bgm: loop(m.bgm, 'Audio/BGM'), bgs: loop(m.bgs, 'Audio/BGS'), br: isInt(m.br, 0, 255) ? m.br : 255 };
    this.scrOf.set(from, scr);
    if (from === this.authNow) this.applyScreen(scr);
  }
  applyScreen({ tone: t, bgm, bgs }) {
    const cur = G.screen.toneTarget || G.screen.tone;
    if ([cur.r, cur.g, cur.b, cur.gray].some((v, i) => Math.abs(v - t[i]) > 0.5)) G.screen.startTone({ red: t[0], green: t[1], blue: t[2], gray: t[3] }, 20);
    const a = G.audio;
    const same = (cur, want) => cur && want && cur.name === want.name && cur.volume === want.volume && cur.pitch === want.pitch;
    if (bgm === null) { if (a.bgm) a.fadeOutBgm(1); } else if (bgm && !same(a.bgm, bgm)) a.playBgm(bgm);
    if (bgs === null) { if (a.bgs) a.fadeOutBgs(1); } else if (bgs && !same(a.bgs, bgs)) a.playBgs(bgs);
  }
  // (guest, every frame) who runs the map it stands on (authorityId): the host, a guest leading it - or itself. Its screen
  // (tone, brightness, music) is that one's; leading it, its own (plain, the map's own music). When that changes, what
  // the one before showed goes (its message, fog), the puppets it sent go, and leading it this guest makes the map's
  // roaming monsters its own (combat.js ownMapMonsters) - or lets its own go to the one who runs it now
  mapNow() {
    const s = G.screen;
    if (this.ready()) {
      let auth = this.authorityId();
      // (following the host, and it has just gone on: this guest goes after it in a moment - it does not take over the
      // map it is leaving meanwhile)
      if (auth === null && this.authNow === this.hostId && this.rules.guestsFollow && now() - (this.peers.get(this.hostId)?.arrT ?? -1e9) < FOLLOW_GRACE) auth = this.hostId;
      if (auth !== this.authNow) {
        const was = this.authNow;
        if (this.leadsNow) this.sendWorldFlags();          // (what this guest's fights here changed, before it is not its own)
        if (this.leadsNow && this.bossBattle) { this.onBossFightEnd(this.bossBattle); this.bossBattle = null; }
        if (this.spectating) this.unspectate(true);
        this.dropRules();
        this.authNow = auth;
        this.leadsNow = auth === null;
        if (was !== undefined) { G.ui?.closeRemoteMessage?.(); G.arena?.release?.(); }
        if (!this.leadsNow && G.map.interpreter.running()) G.map.interpreter.clear();      // (a boss fight's scene of its own)
        if (this.leadsNow) for (const ev of G.map.eventList) ev.net = null;               // (its events are its own now)
        const scr = auth ? this.scrOf.get(auth) : null;
        if (scr) this.applyScreen(scr); else s.startTone({ red: 0, green: 0, blue: 0, gray: 0 }, 20);
        G.combat.ownMapMonsters(this.leadsNow);
        console.info('[coop] this map is run by', auth === null ? 'this guest' : auth === this.hostId ? 'the host' : 'the guest ' + auth);
      }
    }
    // (faded out or in with the one who runs it - its own transfers' fades aside)
    const br = this.authNow ? this.scrOf.get(this.authNow)?.br ?? 255 : 255;
    if (!G.map.transferring && !(s.fadeDur > 0) && Math.abs(s.brightness - br) > 1) { s.fadeTarget = br; s.fadeDur = 15; }
  }
  // the host went to another map (or another place on this one): the phantom goes there too
  followHost() {
    const f = this.follow;
    if (!f || G.map.transferring) return;
    this.follow = null;
    G.map.reserveTransfer(f.m, f.x, f.y, f.d, 0);
  }
}
