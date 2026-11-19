// What co-op (coop.js and its parts in coop/) shares: limits and checks of the messages, the poses sent, and a remote
// player's body as the others see it (RemoteBody: its avatar, held items, name, state).
import * as THREE from 'three';
import { resolveImage } from '../assets.js';
import { NEW_MOVES } from '../bossmoves.js';
import { SHOT_STYLES } from '../combat/shotlooks.js';
import { NO_H_SWITCH, isRef } from '../coopguard.js';
import { cleanName } from '../coopnet.js';
import { senIds } from '../coopworld.js';
import * as J from '../skilljudge.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { runningInterpreter } from '../interpreter.js';
import { T } from '../mapmesh.js';

export const PROTO = 11;
export const MAX_PLAYERS = 4;         // the host and up to three in its world (unless the server's rules say more)
// The rules of a co-op session: the server's (coop_server.json, sent to every player - coopnet.js HubLink); the host's
// game keeps them in its world, and the host may change them in its co-op menu. maxPlayers: players at once;
// guestStartsBoss: a guest may start a boss fight before the host does - else, as in Dark Souls, the host goes in
// first; pvp: the players can strike each other; guestRespawn (on unless set off): a guest brought down comes back at the
// last bonfire instead of being sent home; bossSpectate (on unless set off): one brought down in a boss fight watches it
// until everyone in it is down (a guest only with guestRespawn)
export const DEFAULT_RULES = { maxPlayers: MAX_PLAYERS, guestStartsBoss: false, pvp: false, guestRespawn: true, bossSpectate: true, statSync: true, guestsFollow: true, bossScale: true };
export const BOSS_PER_PLAYER = 0.6;   // (the rule bossScale) a boss's HP, MP and groggy gauge: this much more for each player past one
// The developer's world (world_server.py): one world everyone on it walks, with no host - its rules: these, as the server
// says them (maxPlayers, bossSpectate, bossScale, shareLoot - world_server.json, or changed in the co-op menu by one who
// proved the admin PIN); the rest stay: a boss fight begun by anyone (the one running its map runs it), one who falls
// comes back at its own bonfire, no stats brought to anyone's, no following. PvP is each player's own there (myPvp): two
// who both turned it on may strike each other. shareLoot (off unless set on): what anyone gets from the world - a map
// event's gift, a fight's drops and souls (lootOf) - everyone on the server gets as well
export const WORLD_RULES = { maxPlayers: 16, guestStartsBoss: true, pvp: false, guestRespawn: true, bossSpectate: true, statSync: false, guestsFollow: false, bossScale: true, shareLoot: false };
export const LOOT_PER_MINUTE = 120;   // (shareLoot) things taken from one player in a minute, at most (more are let go)
export const CYCLE_CE = 201;          // 周回プレイ準備 - the next cycle's preparation: in the developer's world, a vote first
export const WORLD_SAVE_EVERY = 120;  // s between the developer-server autosaves (this player's own, on its own PC)
export const LOCK_WAIT = 5;           // s an ask for an event's lock is good for
export const LOCK_RETRY = 4;          // s before asking again for one another player holds
export const SCOPED = new Set(['p', 'look', 'sh', 'ow', 'vo']);   // (the community server) what only those on this player's map see / hear
export const WORLD_SPAWN = { mapId: 101, x: 21, y: 21, dir: 8 };   // (the developer's world) everyone comes in at 도서관의 꿈 - its bonfire's
                                                             // arrival (the travel list's 【도서관의 꿈】)
export const LEAD_TIE = 3;            // s: guests come onto a map this close together came at once (the lowest id leads it)
export const FOLLOW_GRACE = 2;        // s a guest following the host (guestsFollow) leaves the map it is going from to the host
export const LEAD_EVERY = 0.5;        // s: the host tells who leads each map it is not on
export const BOSS_CALL_WAIT = 40;     // s a guest's ask for the host to come to its boss fight is good for
export const DEFAULT_PORT = 28471;     // (not 27015: Apple's mobile device service and many Steam games hold that one)
export const POSE_EVERY = 1 / 20;     // s between poses
export const LOOK_EVERY = 0.25;       // s between looks at what one looks like (sent when it changed)
export const FLAGS_EVERY = 0.1;       // s: the world's changes go together (some maps change a variable every frame)
export const HELLO_EVERY = 1;         // s: a guest asks again until the host answers
export const EVENTS_EVERY = 0.1;      // s between the host's events sent (what changed; all of them to one just come)
export const SCREEN_EVERY = 0.25;     // s between looks at the host's screen tone and music (sent when they change)
export const ENEMIES_EVERY = 0.1;     // s between the host's enemies sent (all of those on the map: a few, small)
export const HITS_PER_SECOND = 20;    // a guest's blow reports the host takes at most (more is not a person swinging)
export const HALL_WAIT = 2.5;         // s without a hallucination's copies from the one running it: this player's own again
export const EN_STATES = ['idle', 'chase', 'windup', 'act', 'stagger', 'recover', 'guard', 'dying', 'dead'];
// what of an attack plan a guest needs to draw its mark and play its move (combat.js beginTelegraph / puppetTelegraph,
// releaseBossMove)
export const PLAN_NUMS = ['r', 'r0', 'half', 'len', 'width', 'aim', 'ox', 'oy', 'oz', 'cx', 'cz', 'lockAt', 'hits', 'tempo', 'way', 'n', 'wave', 'gap', 'full', 'spin', 'mult'];
export const PLAN_FLAGS = ['ground', 'follow', 'heavy', 'pierce', 'certain', 'blockable', 'around', 'shot', 'lob', 'death', 'wall', 'dive'];
export const PLAN_SHAPES = ['circle', 'ring', 'sector', 'line', 'multi', 'none'];
// a boss's moves (combat.js bossFamily) - nothing else is taken
export const BOSS_MOVES = new Set(['charge', 'lunge', 'leap', 'fissure', 'quake', 'roar', 'breath', 'spin', 'flurry', 'thrust', 'grab', 'sweep',
  'execute', 'nova', 'wave', 'cross', 'field', 'pursuit', 'orbs', 'rain', 'volley', 'dice', 'chess', ...NEW_MOVES]);
export const FX_PER_SEND = 8;         // the host's event sounds, animations and flashes sent at once (more are dropped)
// The host's scenes stay its own. What its events show - messages, pictures, their sounds, animations and flashes - goes
// to its guests only on the game's own route without the adult scenes (switch 20 Hシーン表示しない on: the prologue's
// question sets it) and never out of one of those scenes (BLACK SOULS II's scene common events, by number - skilljudge.js),
// wherever one is called from -
// the recollection room as well. A guest takes them only as places in the game's events it checks itself and shows
// from its own copy of the game (coopguard.js), whatever the other game sends
// (the lists of BLACK SOULS II's common events of a kind - skilljudge.js, by number)
const listsOf = kind => new Set([...J.commonEventIds(kind)].map(id => $data.commonEvents?.[id]?.list).filter(Boolean));
export let sceneLists = null;
export function inScene(interp) {
  if (!sceneLists) sceneLists = listsOf('scene');
  for (let it = interp?.root || interp; it; it = it.child) if (it.list && sceneLists.has(it.list)) return true;
  return false;
}
// The host's death is its own: what its death's common events (the YOU DIED, its sound, the dark) show its
// guests do not see or hear, nor its screen going dark for it (deathOn) - nor a YOU DIED an event writes elsewhere
export let deathLists = null;
export function inDeath(interp) {
  if (!deathLists) deathLists = listsOf('death');
  for (let it = interp?.root || interp; it; it = it.child) if (it.list && deathLists.has(it.list)) return true;
  return false;
}
// the bonfire common event an event's page rests at (the original's bonfire ones - by number, skilljudge.js - called at its
// top), or null
export let fireIds = null;
export function bonfireOf(list) {
  if (!fireIds) fireIds = J.commonEventIds('bonfire');
  const call = (list || []).find(c => c.indent === 0 && c.code === 117 && fireIds.has(c.parameters[0]));
  return call ? $data.commonEvents[call.parameters[0]] : null;
}
// (the developer's world, its rule shareLoot) the event command giving something now is the world's to give - the loot
// everyone gets: a map event's run, the map's own (what a player began: a chest - its contents' common events -, a gift;
// a cutscene) or a roaming monster's fight, giving a number of it. Not a common event run of itself or reserved (an
// item's or a skill's use: a soul item's souls), a parallel process, a fight's troop pages, a bonfire's or a death's
// common event (flasks filled again, what a death takes and gives), an amount from a variable (souls given back, things
// coming back, flasks filled), nor a hallucination's fight (its seer's own)
export let ownCes = null;
export function eventLoot() {
  const it = runningInterpreter(), root = it && (it.root || it);
  if (!root || !(root.eventId > 0) || (root.kind !== 'main' && root.kind !== 'symbol')) return false;
  const cmd = it.list?.[it.index];
  if (!cmd || cmd.code < 125 || cmd.code > 128 || cmd.parameters[cmd.code === 125 ? 1 : 2] !== 0) return false;
  if (!ownCes) ownCes = new Set([...J.commonEventIds('bonfire'), ...J.commonEventIds('death')]);
  for (let x = root; x; x = x.child) if (ownCes.has(x.commonEventId)) return false;
  const ev = root.event();
  return !(root.kind === 'symbol' && ev && G.combat?.privateSymbol?.(ev));
}

// (host) a guest as this world's enemies see it: a body they go for, where the guest stands (its pose) - one of the
// companions to them (allies.js struckable). Their blows on it are judged on the guest's own side, by what it sees -
// the moves are played out there (combat.js puppets): its own place, guard, dodge, perfect guard and HP; it says how
// each went ('ow'), shown on it here
export class RemoteBody {
  constructor(coop, peer) { this.coop = coop; this.peer = peer; this.r = 0.3; this.h = 1.7; this.remote = true; }
  get stands() { const p = this.peer.pose; return !!p && p.m === G.map?.mapId && !!G.map?.grid; }
  get alive() { return true; }
  get fighter() { return true; }
  get actor() { return null; }                 // (an even target rate - allies.js pickTarget)
  get fx() { return this.peer.pose.h[0] / T - 0.5; }
  get fy() { return this.peer.pose.h[2] / T - 0.5; }
  worldPos(out = new THREE.Vector3()) { const fx = this.fx, fy = this.fy; return out.set((fx + 0.5) * T, G.floorAt ? G.floorAt(fx, fy) : 0, (fy + 0.5) * T); }
  chest(out = new THREE.Vector3()) { this.worldPos(out); out.y += this.h * 0.6; return out; }
  living() { return []; }                      // (its actors are on its own side: never a stand-in)
  takeHit() {}                                 // (judged on its own side)
  // (in that enemy's fight: always, but for a boss fight it did not join or watches fallen - Coop.onBossFightBegin)
  inFight(e) { const s = e?.battle?.coopIn; return !s || (s.has(this.peer.id) && !e.battle.coopDead?.has(this.peer.id)); }
}
export const QUIET = 30;              // s without a word from someone: gone (a map being built can hold a page still for
                               // seconds - its own or the other's)
export const CONNECT_WAIT = 25;       // s a guest waits to be let into the host's world
export const MAX_TEXT = 4 << 20;      // longest message read (a welcome carries a whole world's switches)
export const MAX_LIST = 200000;
export const now = () => performance.now() / 1000;
export const waitFor = (test, ms) => new Promise(res => { const t0 = now(); const go = () => (test() || now() - t0 > ms / 1000 ? res() : setTimeout(go, 30)); go(); });
export const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

// ---- checks: a message is taken only as it should be, field by field --------------------------------------------
export const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const isNum = (v, lim = 1e5) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
export const isList = (a, max) => Array.isArray(a) && a.length <= max;
export const nums = (a, n, lim) => Array.isArray(a) && a.length === n && a.every(x => isNum(x, lim));
// a variable's value: what the game's variables hold (numbers, short texts, true / false)
export const isValue = v => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12) || (typeof v === 'string' && v.length <= 2000) || typeof v === 'boolean';
export const SELF_KEY = /^\d{1,5},\d{1,5},[ABCD]$/;
export const HALL_KEY = /^\d{1,5}:\d{1,2}$/;          // a hallucination: its event and page on the map (combat.js hallKey)
export const FILE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,80}$/;
export const okSwitch = i => isInt(i, 1, 99999);

// a trap of the host's world - a touch event's commands (its page's), their top level: HP it takes (Change HP, decrease: a number or a
// variable of the world; 'allow knockout' or not), the trap death check (common event 56: HP left at 1 is death),
// death itself (the party-wipe common events, Game Over); its sound and flash. null: not one
export const HAZARD_GAP = 1;          // s: one trap passing over this player hurts once
export function hazardOf(list) {
  if (!list) return null;
  if (list._hazard !== undefined) return list._hazard;
  let h = null;
  const get = () => (h ||= { hits: [], death: false, check: false, se: null, flash: null });
  for (const c of list) {
    if (c.indent !== 0) continue;
    const p = c.parameters;
    if (c.code === 311 && p[2] === 1) get().hits.push({ c: p[3] === 0 ? p[4] : null, v: p[3] === 0 ? 0 : p[4], knockout: !!p[5] });
    else if (c.code === 353) get().death = true;
    else if (c.code === 117) {
      if (J.commonEventIs('trapDeath', p[0])) get().check = true;
      else if (J.commonEventIs('death', p[0])) get().death = true;
    }
  }
  if (h) for (const c of list) {
    if (c.indent !== 0) continue;
    if (c.code === 250 && !h.se) h.se = c.parameters[0];
    if (c.code === 224 && !h.flash) h.flash = c.parameters;
  }
  return (list._hazard = h && (h.hits.length || h.death || h.check) ? h : null);
}

export function checkWorld(w) {
  if (!w || typeof w !== 'object') return null;
  if (!isList(w.sw, MAX_LIST) || !w.sw.every(okSwitch)) return null;
  if (!isList(w.vars, MAX_LIST) || !w.vars.every(e => Array.isArray(e) && e.length === 2 && okSwitch(e[0]) && isValue(e[1]))) return null;
  if (!isList(w.self, MAX_LIST) || !w.self.every(k => typeof k === 'string' && SELF_KEY.test(k))) return null;
  return w;
}
// the world as kept here: switches on, variables set, self switches on
export const toWorld = w => ({ sw: new Set(w.sw), vars: new Map(w.vars), self: new Set(w.self) });
export function checkPlace(p) {
  if (!p || typeof p !== 'object' || !isInt(p.m, 1, 9999) || !$data.mapInfos?.has(p.m)) return null;
  if (!isInt(p.x, 0, 999) || !isInt(p.y, 0, 999) || ![2, 4, 6, 8].includes(p.d)) return null;
  return { m: p.m, x: p.x, y: p.y, d: p.d };
}
export function checkItem(s) {
  if (s === null) return null;
  if (!s || typeof s !== 'object' || !isInt(s.icon, 1, 99999) || !['weapon', 'shield'].includes(s.kind) || !isInt(s.wtype, 0, 99)) return undefined;
  if (!['right', 'left'].includes(s.hand) || typeof s.large !== 'boolean' || (s.sz !== undefined && (!isNum(s.sz, 2) || s.sz < 0))) return undefined;
  const a = s.adj;
  if (!a || !isNum(a.rot, 720) || !isNum(a.offset, 100) || !isNum(a.scale, 10) || a.scale <= 0 || typeof a.flip !== 'boolean') return undefined;
  return { icon: s.icon, kind: s.kind, wtype: s.wtype, hand: s.hand, large: s.large, sz: s.sz || 0, adj: { rot: a.rot, offset: a.offset, scale: a.scale, flip: a.flip } };
}
// what a hand holds ready or in hand instead (Coop.lookMsg U)
export function checkUse(u) {
  if (u === undefined || u === null) return null;
  if (!u || typeof u !== 'object' || !['t', 'k', 's', 'm', 'n', 'r'].includes(u.k) || !isInt(u.i, 0, 99999) || !isInt(u.c, 0, 0xffffff) || !['right', 'left'].includes(u.h)) return undefined;
  if (u.k !== 's' && u.i < 1) return undefined;
  // (a spell's look - combat/shotlooks.js; one this side does not know, or none from an older version: the plain light)
  const st = u.k === 's' && SHOT_STYLES.includes(u.st) ? u.st : undefined;
  return st ? { k: u.k, i: u.i, c: u.c, h: u.h, st } : { k: u.k, i: u.i, c: u.c, h: u.h };
}
export function checkLook(m) {
  const c = m.chr;
  if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string' || !isInt(c[1], 0, 7)) return null;
  // (a character sheet of this game: anything else is drawn as nobody)
  const name = c[0] && FILE_NAME.test(c[0]) && resolveImage('Graphics/Characters', c[0]) ? c[0] : '';
  const R = checkItem(m.R), L = checkItem(m.L), U = checkUse(m.U);
  if (R === undefined || L === undefined || U === undefined) return null;
  // (the developer's world: the hallucinations it sees on its map - combat.js privateSymbol)
  const hv = Array.isArray(m.hv) && m.hv.length <= 64 && m.hv.every(k => typeof k === 'string' && HALL_KEY.test(k)) && isInt(m.hm, 1, 9999) ? m.hv : null;
  // (its voice setting - 0 off, 1 listen only, 2 talk too -, for the marks by its name; -1: an older version telling none)
  const vc = [0, 1, 2].includes(m.vc) ? m.vc : -1;
  return { chr: [name, c[1]], R, L, U, nm: cleanName(m.nm), pv: m.pv === 1, hv, hm: hv ? m.hm : 0, vc };
}
// a place and turn in the world: x, y, z, then a quaternion
export const checkXf = a => (a === undefined || a === 0 ? null : nums(a, 7, 1e5) ? a : undefined);
export function checkHand(d) {
  if (d === undefined) return {};
  if (!d || typeof d !== 'object') return null;
  const h = checkXf(d.h), i = checkXf(d.i);
  if (h === undefined || i === undefined) return null;
  const c = d.c === undefined ? null : nums(d.c, 3, 1) ? d.c : undefined;
  if (c === undefined) return null;
  // (lo: the shield held down at the side - a PC player's, out of its own view: shown, but no blade meets it)
  if (d.lo !== undefined && d.lo !== 0 && d.lo !== 1) return null;
  return { h, i, c, lo: d.lo || 0 };
}
export function checkPose(m) {
  if (!isInt(m.s, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.m, 0, 9999) || !nums(m.h, 4, 1e5) || (m.j !== undefined && !isNum(m.j, 10))) return null;
  const R = checkHand(m.R), L = checkHand(m.L), u = checkXf(m.u);
  if (!R || !L || u === undefined || (m.ag !== undefined && (!isNum(m.ag, 1e7) || m.ag < 0))) return null;
  // (a balloon over it - an event of its world put one on it, or it put up one itself: an emote)
  if ((m.b !== undefined && !isInt(m.b, 0, 32)) || (m.sp !== undefined && m.sp !== 0 && m.sp !== 1)) return null;
  // (held by its world's scene - the one running a map: the others there are held with it)
  if (m.hd !== undefined && m.hd !== 0 && m.hd !== 1) return null;
  // (something ready, being aimed - an area spell, a throwable: where it would land, how wide)
  if (m.rk !== undefined && (!nums(m.rk, 4, 1e5) || !(m.rk[3] > 0 && m.rk[3] <= 10))) return null;
  // (speaking now - its microphone hears a voice: the microphone by its name solid)
  if (m.v !== undefined && m.v !== 0 && m.v !== 1) return null;
  return { s: m.s, m: m.m, h: m.h, j: m.j || 0, R, L, u, b: m.b || 0, sp: m.sp || 0, ag: m.ag || 0, hd: m.hd || 0, rk: m.rk || null, v: m.v || 0 };
}

export const isStr = (s, max) => typeof s === 'string' && s.length <= max;
// a picture shown, moved or taken away on the host's screen ('s' / 'm' / 'e'; where it is already worked out there)
export function checkPic(o) {
  if (!o || typeof o !== 'object' || !isInt(o.n, 1, 100)) return null;
  if (o.o === 'e') return { o: 'e', n: o.n };
  if ((o.o !== 's' && o.o !== 'm') || ![0, 1].includes(o.org) || !isNum(o.x, 1e4) || !isNum(o.y, 1e4) || !isNum(o.zx, 2000) || !isNum(o.zy, 2000)
    || !isNum(o.op, 255) || o.op < 0 || ![0, 1, 2].includes(o.bl)) return null;
  const p = { o: o.o, n: o.n, org: o.org, x: o.x, y: o.y, zx: o.zx, zy: o.zy, op: o.op, bl: o.bl };
  if (o.o === 'm') return isInt(o.d, 1, 999) ? { ...p, d: o.d } : null;
  return isRef(o.src) ? { ...p, src: o.src } : null;          // (shown: where in the game's events - coopguard.js pictureAt)
}
// a sound, an animation or a flash one of the host's events played: ['se' | 'me', where] - the game's own Play SE / ME
// there (coopguard.js) -, ['an', on whom (an event's id; 0: the host), where] - its Show Animation -, ['fl', red, green,
// blue, strength, frames]
export function checkFx(f) {
  if (!Array.isArray(f)) return null;
  if ((f[0] === 'se' || f[0] === 'me') && f.length === 2 && isRef(f[1])) return f;
  if (f[0] === 'an' && f.length === 3 && isInt(f[1], 0, 99999) && isRef(f[2])) return f;
  if (f[0] === 'fl' && f.length === 6 && f.slice(1, 5).every(v => isInt(v, 0, 255)) && isInt(f[5], 1, 600)) return f;
  return null;
}

// the game's data everyone must share (a different version or edition of the game could not be the same world)
export function fingerprint() {
  const d = $data, s = d.system || {};
  const parts = [s.game_title, d.mapInfos?.size, d.actors?.length, d.classes?.length, d.skills?.length, d.items?.length, d.weapons?.length,
    d.armors?.length, d.enemies?.length, d.troops?.length, d.states?.length, d.commonEvents?.length, s.switches?.length, s.variables?.length];
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
}

// the world a host's game is: its switches, variables and self switches (only those that are on / set)
export function worldOf(st) {
  const sw = [], vars = [];
  st.switches.forEach((v, i) => { if (v && okSwitch(i)) sw.push(i); });
  st.variables.forEach((v, i) => { if (okSwitch(i) && v !== 0 && v != null && isValue(v)) vars.push([i, v]); });
  return { sw, vars, self: [...st.selfSwitches.keys()].filter(k => SELF_KEY.test(k)) };
}
// (a guest's copy: switch 20 - Hシーン表示しない - is always on, whatever the host's world says: a guest's events take
// only the game's own route without the adult scenes)
// (its SEN - the variable and switches of the game's SEN reminder - stays its own: the host's does not become it)
export function applyWorld(st, w) {
  const sen = senIds(), senV = sen.v ? st.variables[sen.v] : undefined, senS = sen.sw.map(i => [i, !!st.switches[i]]);
  st.switches = [];
  for (const i of w.sw) st.switches[i] = true;
  st.switches[NO_H_SWITCH] = true;
  st.variables = [];
  for (const [i, v] of w.vars) st.variables[i] = v;
  st.selfSwitches = new Map(w.self.map(k => [k, true]));
  if (sen.v) st.variables[sen.v] = senV ?? 0;
  for (const [i, v] of senS) st.switches[i] = v;
}
// a switch or variable of SEN's (each player's own)
export const isSenSwitch = id => senIds().sw.includes(id);
export const isSenVar = id => id === senIds().v;

export const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
export const v3 = v => [r3(v.x), r3(v.y), r3(v.z)];
export function worldXf(o) {
  o.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(tmpP, tmpQ, tmpS);
  return [tmpP.x, tmpP.y, tmpP.z, tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w].map(r3);
}
export const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
// a co-op server's address as the browser reaches it
export const serverUrl = s => `ws://${s.local ? '127.0.0.1' : s.ip}:${s.port || DEFAULT_PORT}/coop`;
