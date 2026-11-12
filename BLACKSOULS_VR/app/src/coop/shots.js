// Co-op, everyone: what each player shoots, as the others see it (a shot's flight: arrows, bullets, spells, thrown things).
import * as THREE from 'three';
import { SHOT_STYLES, shotStyleOf } from '../combat/shotlooks.js';
import { CoopAvatar } from '../coopavatar.js';
import { NO_H_SWITCH, indexMap } from '../coopguard.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { FloorMarker, MARK } from '../telegraph.js';
import { voiceCode } from '../voicemarks.js';
import { getAdjust } from '../weapons.js';
import { BOSS_CALL_WAIT, CONNECT_WAIT, ENEMIES_EVERY, EVENTS_EVERY, FLAGS_EVERY, HELLO_EVERY, LEAD_EVERY, LOOK_EVERY,
  POSE_EVERY, PROTO, QUIET, SCREEN_EVERY, checkLook, checkPose, fingerprint, isInt, isList, isNum, now, nums, r2, r3,
  shown, tmpV, v3, worldXf } from './common.js';

// (never made: its methods are Coop's own - mixed into it in coop.js)
export class ShotPart {
  // ---- everyone --------------------------------------------------------------------------------------------------
  // (a host sees the guests it let in; a guest sees the others only once it stands in the host's world)
  canSee(from) { return this.role === 'world' ? this.world : this.role === 'host' ? this.peers.has(from) : this.summoned; }
  onLook(m, from) {
    if (!this.canSee(from)) return;
    const look = checkLook(m), p = look && this.peerFor(from, true);
    if (!p) return;
    p.name = look.nm;
    p.pvp = look.pv;                    // (the developer's world: its own PvP on)
    p.hv = new Set(look.hv || []); p.hvm = look.hm;      // (the hallucinations it sees there - shared with those who see them too)
    this.avatarOf(p).setLook(look);
  }
  onPose(m, from) {
    if (!this.canSee(from)) return;
    const pose = checkPose(m), p = pose && this.peerFor(from, true);
    if (!p || pose.s <= p.seq) return;                       // (an older one arriving late)
    p.seq = pose.s;
    p.pose = pose;
    p.arrT = now() - pose.ag;                                 // (when it came onto its map, by this clock)
    this.avatarOf(p).setPose(pose);
    this.aimMarkOf(p, pose);
  }
  // another player aiming something it has ready (pose rk - an area spell, a throwable): its mark on this floor, blue
  // as one's own, following its aim - one sees where it would land before it comes; gone when it is thrown (the mark
  // of where it bursts takes over: combat.js areaMark) or put away
  aimMarkOf(p, pose) {
    const rk = pose?.rk && pose.m === G.map?.mapId ? pose.rk : null;
    if (!rk) { if (p.aimMk) { G.combat.fadingMarkers.push(p.aimMk); p.aimMk = null; } return; }
    if (!p.aimMk || p.aimMk.spec.r !== rk[3]) {
      p.aimMk?.dispose();
      p.aimMk = new FloorMarker(G.combat.root, { shape: 'circle', r: rk[3], color: MARK.player });
      p.aimMk.setProgress(1);
    }
    p.aimMk.setPose(rk[0], rk[1], rk[2], 0);
  }
  avatarOf(p) { return (p.avatar ||= new CoopAvatar(this.scene)); }

  // ---- what this player shoots, as the others see it ('sh'): a shot's flight (an arrow, a bullet, a spell's light, a
  // thing thrown - combat.js shareShot), an area's burst, a Gun Break's line, a follow-up shot's line and its animation.
  // Only to be seen: they fly, stop where they meet an enemy there and play their animation - what they do is judged on
  // the side of the one who shot (combat.js peerShot)
  shareShot(s) {
    if (!this.peers.size || !this.ready()) return;
    const m = { t: 'sh', k: 'p', f: v3(s.from), v: v3(s.vel), lk: s.look, c: s.color | 0, l: r2(Math.min(10, s.life)), a: s.anim | 0 };
    if (s.icon) m.i = s.icon;
    if (s.quat) m.q = [s.quat.x, s.quat.y, s.quat.z, s.quat.w].map(r3);
    if (s.gravity) { m.g = r2(s.gravity); m.ln = r2(Math.max(0, s.land)); }
    if (s.align) m.al = 1;
    if (s.tumble) m.tu = 1;
    if (s.fine) m.fi = 1;
    if (s.aoe) m.ao = r2(s.aoe);
    if (s.dest) m.d = v3(s.dest);
    if (s.track) m.tk = s.track;
    if (s.target) m.tg = s.target;
    if (s.style) m.st = s.style;                              // (how it looks in flight - combat/shotlooks.js - and a meaning's colour over it)
    if (s.tint != null) m.ti = s.tint | 0;
    this.send(m);
  }
  shareBurst(at, r, color, anim) { if (this.peers.size && this.ready()) this.send({ t: 'sh', k: 'b', at: v3(at), r: r2(r), c: color | 0, a: anim | 0 }); }
  shareGunBreak(g) {
    if (!this.peers.size || !this.ready()) return;
    this.send({ t: 'sh', k: 'g', f: v3(g.from), e: v3(g.end), cn: g.cannon ? 1 : 0, pts: g.points.slice(0, 8).map(v3), a: g.anim | 0, at: v3(g.animAt), h: r2(g.height || 0) });
  }
  shareLine(from, to, color) { if (this.peers.size && this.ready()) this.send({ t: 'sh', k: 'l', f: v3(from), e: v3(to), c: color | 0 }); }
  shareAnim(at, anim, h) { if (this.peers.size && this.ready() && anim > 0) this.send({ t: 'sh', k: 'a', at: v3(at), a: anim | 0, h: r2(h || 0) }); }
  // another player's ('sh'): only from one standing on this map, only so many a second, every field checked
  onShotMsg(m, from) {
    const p = this.peers.get(from);
    if (!p || !this.canSee(from) || p.pose?.m !== G.map?.mapId || !this.ready()) return;
    const t = now();
    p.shs = (p.shs || []).filter(x => t - x < 1);
    if (p.shs.length >= 40) return;                          // (more than a burst of shots)
    p.shs.push(t);
    const vec = a => (nums(a, 3, 1e5) ? new THREE.Vector3(a[0], a[1], a[2]) : null);
    const anim = a => (isInt(a, 0, 9999) && (!a || $data.animations?.[a]) ? a : -1);
    const col = c => (isInt(c, 0, 0xffffff) ? c : -1);
    const C = G.combat;
    if (m.k === 'p') {
      const f = vec(m.f), v = vec(m.v), a = anim(m.a), c = col(m.c);
      if (!f || !v || v.length() > 100 || v.length() < 0.1 || a < 0 || c < 0 || !['o', 'a', 'i', 't', 'k'].includes(m.lk) || !isNum(m.l, 10) || m.l <= 0) return;
      if (m.lk !== 'o' && m.lk !== 'a' && !isInt(m.i, 1, 99999)) return;
      const q = m.q === undefined ? null : nums(m.q, 4, 1.01) ? new THREE.Quaternion(m.q[0], m.q[1], m.q[2], m.q[3]).normalize() : undefined;
      const d = m.d === undefined ? null : vec(m.d);
      const flag = x => x === undefined || x === 1;
      if (q === undefined || (m.d !== undefined && !d) || !flag(m.al) || !flag(m.tu) || !flag(m.fi)) return;
      if ((m.g !== undefined && (!isNum(m.g, 50) || m.g < 0)) || (m.ln !== undefined && (!isNum(m.ln, 5) || m.ln < 0)) || (m.ao !== undefined && (!isNum(m.ao, 10) || m.ao < 0))) return;
      if ((m.tk !== undefined && !isInt(m.tk, 1, Number.MAX_SAFE_INTEGER)) || (m.tg !== undefined && !isInt(m.tg, 1, Number.MAX_SAFE_INTEGER))) return;
      // (a look this side does not know - a newer version's: the plain ball; a bad tint: none)
      const style = SHOT_STYLES.includes(m.st) ? m.st : null, tint = m.ti !== undefined && isInt(m.ti, 0, 0xffffff) ? m.ti : null;
      C.peerShot({ from: f, vel: v, look: m.lk, icon: m.i | 0, color: c, quat: q, life: m.l, gravity: m.g || 0, land: m.ln || 0, align: !!m.al, tumble: !!m.tu,
        fine: !!m.fi, aoe: m.ao || 0, dest: d, track: m.tk || 0, target: m.tg || 0, anim: a, by: from, style, tint });
    } else if (m.k === 'b') {
      const at = vec(m.at), a = anim(m.a), c = col(m.c);
      if (at && a >= 0 && c >= 0 && isNum(m.r, 10) && m.r > 0) { C.burstFx(c, a, at, m.r); C.areaMark(at, m.r, G.time + 0.6); }
    } else if (m.k === 'g') {
      const f = vec(m.f), e = vec(m.e), at = vec(m.at), a = anim(m.a);
      if (!f || !e || !at || a < 0 || (m.cn !== 0 && m.cn !== 1) || !isList(m.pts, 8) || !isNum(m.h, 50) || m.h < 0) return;
      const pts = m.pts.map(vec);
      if (pts.some(x => !x)) return;
      C.gunBreakFx({ from: f, end: e, cannon: m.cn === 1, points: pts, anim: a, animAt: at, height: m.h });
    } else if (m.k === 'l') {
      const f = vec(m.f), e = vec(m.e), c = col(m.c);
      if (f && e && c >= 0 && f.distanceTo(e) < 60) C.spawnTracer(f, e, c);
    } else if (m.k === 'a') {
      const at = vec(m.at), a = anim(m.a);
      if (at && a > 0 && isNum(m.h, 50) && m.h >= 0) G.screen.playAnimationOn(at, a, { rate: 3, height: m.h || undefined });
    }
  }

  // what this player looks like: the party leader's character sheet, and what each hand holds and how - and what it
  // holds ready or in hand instead (U: k 't' a thing to throw, 'k' a knife, 's' a spell's light of colour c, 'm' a bottle
  // to drink, 'n' a syringe, 'r' a resin; i its icon, h the hand - combat.js peerUseModel makes it)
  lookMsg() {
    const leader = G.state?.party?.leader();
    const specs = G.combat?.heldSpecs?.() || {};
    const item = s => {
      if (!s?.item) return null;
      const a = getAdjust(s.key, s.kind, s.wtype, s.hand, s.item.icon_index);
      return { icon: s.item.icon_index | 0, kind: s.kind, wtype: s.wtype | 0, hand: s.hand, large: !!s.large, sz: +s.span || 0, adj: { rot: +a.rot || 0, offset: +a.offset || 0, scale: +a.scale || 1, flip: !!a.flip } };
    };
    const c = G.combat, r = c?.ready, h = c?.held;
    const U = r ? { k: r.kind === 'item' ? (c.isKnife(r.obj) ? 'k' : 't') : 's', i: r.obj.icon_index | 0, c: r.kind === 'item' ? 0 : c.skillColor(r.obj) | 0, h: 'right',
      ...(r.kind === 'item' ? {} : { st: shotStyleOf(r.obj) }) }
      : h ? { k: h.how === 'stab' ? 'n' : h.how === 'rub' ? 'r' : 'm', i: h.obj.icon_index | 0, c: 0, h: h.hand === 'left' ? 'left' : 'right' } : null;
    // (while one of the scenes plays: as it looked before it - a scene's own looks stay this player's)
    if (!this.sceneOn()) this.lookChr = [leader?.characterName || '', leader?.characterIndex || 0];
    // (vc: its voice setting - the marks by its name: voicemarks.js)
    const look = { t: 'look', chr: this.lookChr || ['', 0], R: item(specs.weapon), L: item(specs.offhand), U, nm: this.myName(), vc: voiceCode(G.voice?.mode) };
    if (this.role === 'world' && this.myPvp) look.pv = 1;            // (its own PvP on: a red PVP over its name)
    if (this.role === 'world') { const hv = G.combat?.hallKeysSeen?.() || []; if (hv.length) { look.hv = hv; look.hm = G.map.mapId; } }
    return look;
  }
  // where this player is: the head (and the way it looks), the hands - shown bare, with their fingers - and what
  // they hold, each as a place and turn in the world
  poseMsg() {
    const msg = { t: 'p', s: ++this.seq, m: this.ready() ? G.map.mapId : 0, h: [0, 0, 0, 0] };
    if (!msg.m) return msg;
    msg.ag = r2(Math.max(0, now() - this.arrT));            // (how long on this map - leaderOf)
    const head = G.player.headWorld(tmpV), f = G.player.forward2D();
    msg.h = [r3(head.x), r3(head.y), r3(head.z), r3(Math.atan2(-f.x, -f.z))];
    msg.j = r3(G.player.jumpY || 0);
    // (a balloon an event put on this player, or one it put up itself - an emote)
    const bal = G.map.playerChar?.balloonId | 0;
    if (bal > 0 && bal <= 32) msg.b = bal;
    if (this.spectating) msg.sp = 1;
    if (G.voice?.micLive && G.voice.speaking) msg.v = 1;     // (speaking now: the microphone by its name solid)
    const rk = G.combat.readyMark?.();                       // (something ready, being aimed: where it would land)
    if (rk) msg.rk = rk.map(r3);
    if (this.isAuthority() && G.map.interpreter.running() && G.map.interpreter.waitMode !== 'battle') msg.hd = 1;
    for (const side of ['right', 'left']) {
      const d = {};
      const hand = G.hands?.models?.[side];
      if (G.vr && hand?.root?.parent && shown(hand.root)) { d.h = worldXf(hand.root); d.c = (hand.last || [0, 0, 0]).map(r3); }
      const obj = side === 'right' ? G.combat?.weapon : G.combat?.shield;
      if (obj?.parent && !obj.userData.unarmed && obj.children.length && shown(obj)) d.i = worldXf(obj);
      // (a PC shield down at the side - its guard not up: shown, but it stops no one's blade - combat.js deskShieldUp)
      if (d.i && side === 'left' && !G.vr && G.combat.hasShield && !G.combat.deskShieldUp()) d.lo = 1;
      msg[side === 'right' ? 'R' : 'L'] = d;
    }
    // (what it holds ready or in hand instead - lookMsg U)
    const use = G.combat?.ready?.fx || G.combat?.held?.fx;
    if (use?.parent && shown(use)) msg.u = worldXf(use);
    return msg;
  }

  // every frame (main.js); head: the viewer, or null while no map is shown
  update(dt, head) {
    if (!this.role) return;
    const t = now();
    if (t - (this.membersAt || 0) > 0.5) { this.membersAt = t; this.noteMembers(); }
    // (this page stood still a while itself - building a map: what the others said meanwhile is still on its way in)
    if (t - this.tick > 2) for (const p of this.peers.values()) p.heard = Math.max(p.heard, t - 2);
    this.tick = t;
    if (this.link && this.link.open !== false) this.linked = true;
    // (since when this player stands on the map it is on - who leads a map the host is not on: leaderOf)
    // (and where in its events what they show stands - coopguard.js refOf)
    if (this.ready() && G.map.mapId !== this.arrMap) { this.arrMap = G.map.mapId; this.arrT = t; indexMap(G.map.mapId, G.map.map); }
    if (this.serverOld && !this.oldSaid) { this.oldSaid = true; console.warn('[coop] the co-op server is an older version than this game:', this.link.serverVersion); }
    for (const p of [...this.peers.values()]) if (t - p.heard > QUIET) { this.peerGone(p.id, 'silent'); if (!this.role) return; }
    if (this.role === 'world' && !this.updateWorld(dt)) return;
    if (this.role === 'guest' && !this.summoned) {
      // not let in yet: ask the host, and give up after a while - no server; nobody hosting, or no answer, counted from
      // the first ask (a slow PC still loading its own map is not given up on)
      const open = this.link && this.link.open !== false;
      if (open && this.ready()) {
        this.askT ||= t;
        if (t - this.helloT > HELLO_EVERY) { this.helloT = t; this.send({ t: 'hello', v: PROTO, fp: fingerprint(), tag: this.myTag }); }
      }
      if (this.server && this.askT && t - this.askT > CONNECT_WAIT) this.fail(this.link.hostId ? 'no answer' : 'no host');
      else if (this.server && !open && t - this.startT > CONNECT_WAIT) this.fail('no server');
      return;
    }
    if (this.phantom) {
      if (G.state && !G.state.switches[NO_H_SWITCH]) G.state.switches[NO_H_SWITCH] = true;     // (whatever set it off: applyWorld)
      this.followHost();
      if (!this.spectating && this.ready()) this.trapContacts();
      this.mapNow();
    }
    if (this.role === 'host' && (this.flagsT -= dt) <= 0 && this.flags.size) { this.flagsT = FLAGS_EVERY; this.sendFlags(); }
    if (this.role === 'host' && this.peers.size && (this.stT -= dt) <= 0) { this.stT = 1; this.sendStats(); }
    if (this.role === 'host' && this.peers.size && (this.leadT -= dt) <= 0) { this.leadT = LEAD_EVERY; this.sendLeads(); }
    if (this.isAuthority() && (this.bsT -= dt) <= 0) {
      this.bsT = 1;
      const b = this.bossFightOn();
      if (b) {
        // (one in it gone from this map is out of it - if no one in it stands now, everyone in it is down)
        // (but one on its way here, joining from another map)
        for (const id of [...b.coopIn]) if (id !== 'host' && this.peers.get(id)?.pose?.m !== G.map.mapId && !(now() - (b.coming?.get(id) ?? -1e9) < 30)) { b.coopIn.delete(id); b.coopDead.delete(id); }
        if (this.shared) for (const g of this.guestsHere()) if (!b.coopIn.has(g.id)) { b.coopIn.add(g.id); this.giveRules(b, g.id); }    // (the guests' own: all here in it)
        if (this.allDown(b)) this.wipe(b, false);
      }
      this.scaleBosses(b);
    }
    if (this.phantom && (this.syncT -= dt) <= 0) { this.syncT = 1; this.syncStats(); }
    if (this.phantom && (this.wfT -= dt) <= 0) { this.wfT = FLAGS_EVERY; this.sendWorldFlags(); }
    // (no answer from the host in time - in its menu, or a scene: the guests fight it themselves)
    if (this.bossCall && now() - this.bossCall.t > BOSS_CALL_WAIT) { if (this.hostId) this.send({ t: 'bcx' }, this.hostId); this.onBossCallAnswer(true, true); }
    if (this.isAuthority() && this.peers.size) {
      // (the developer's world: each player's events and screen are its own - only the monsters are the runner's)
      if (this.role !== 'world' && (this.evT -= dt) <= 0) { this.evT = EVENTS_EVERY; this.sendEvents(); }
      if (this.role !== 'world' && (this.scrT -= dt) <= 0) { this.scrT = SCREEN_EVERY; this.sendScreen(); }
      if ((this.enT -= dt) <= 0) { this.enT = ENEMIES_EVERY; this.sendEnemies(); }
      if (this.fxOut.length) { const l = this.fxOut.splice(0); for (const g of this.guestsHere()) this.send({ t: 'fx', l }, g.id); }
    }
    if (this.world) {
      this.updateHallFollow();
      if (this.peers.size && (this.henT = (this.henT ?? 0) - dt) <= 0) { this.henT = ENEMIES_EVERY; this.sendHallucinations(); }
    }
    this.fxOut.length = 0;
    // (the message its guests were reading went away: theirs too)
    if (this.isAuthority() && this.saying && G.ui.msg !== this.saying.msg) {
      this.saying = null;
      for (const g of this.guests()) this.send({ t: 'sayx' }, g.id);
    }
    // (a guest: what its blows did to the host's enemies, to the host)
    // (... and on a hallucination seen with another: to the one running it)
    if (this.shared) { const lead = this.authorityId(); for (const { src, ...r } of G.combat.puppetReports()) { const to = src || lead; if (to) this.send({ t: 'hit', ...r }, to); } }
    if (this.peers.size || this.othersHere()) {
      if ((this.lookT -= dt) <= 0 && G.state) {
        this.lookT = LOOK_EVERY;
        const look = this.lookMsg(), key = JSON.stringify(look);
        if (key !== this.lookKey) { this.lookKey = key; this.send(look); }
      }
      if ((this.poseT -= dt) <= 0) { this.poseT = POSE_EVERY; this.send(this.poseMsg()); }
    }
    // (the developer's world, shareLoot) what the world gave this player, to everyone on the server - wherever they are
    if (this.outLoot.length) { const g = this.outLoot.splice(0, 16); if (this.world) this.send({ t: 'loot', g }); }
    const see = head && this.ready();
    for (const p of this.peers.values()) if (p.avatar) { if (see) p.avatar.update(dt, head); else p.avatar.hide(); }
  }
}
