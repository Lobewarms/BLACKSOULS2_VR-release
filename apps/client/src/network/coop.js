// Co-op, the Souls way: one player opens their world (the host) and others come into it (guests, phantoms) - as many
// as the server's rules allow (maxPlayers, 2-8). A guest walks the host's world with its own body, gear and things;
// only the host's world is real there - the guest's own world waits untouched (its game as it was, never saved while
// away) and it goes back to it when the visit ends: it leaves, the host ends it or goes, or nothing is heard from the
// host for a while.
// Players meet through the co-op server (coop_server.py: run on the host's PC, or elsewhere so that nobody learns the
// host's address), reached by address and PIN (coopnet.js HubLink).
// Everyone sees everyone else (coopavatar.js); a guest sees the host's world as the host's switches, variables and
// self switches make it (kept up as they change), its people where the host's are (the map's events stand, move, turn
// and change as the host's do - never moving on their own), its screen (tone, brightness) and music, and follows the
// host from map to map. A phantom's own events do not run - no talking, doors, traps or fights of its own. The host's
// enemies are there for it to fight (combat.js puppets), their moves played out as the host's go - a boss's too - and
// a boss fight's fog closes the way out for it as well. Each player judges the blows on itself by what it sees (the
// Souls way): the moves played out on a guest strike it there; its own blows on the host's enemies are reported to
// the host, which checks them and owns the enemies. What the host's events
// show - messages, pictures, their sounds - it sees and hears too, only to see: never the adult scenes (mirrorOk).
// Every message is small, checked field by field and only ever read as data; what steers a guest's world (welcome,
// world changes, transfers) is taken only from the host.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { GameState, itemData } from '../game/state.js';
import { getAdjust } from '../combat/weapons.js';
import { resolveImage, resolveAudio } from '../data/assets.js';
import { T } from '../world/mapmesh.js';
import { CoopAvatar } from './coopavatar.js';
import { LocalLink, RtcLink, LocalSignal, HubLink, WorldLink, takeRules, isTag, cleanName, SERVER_VERSION, WORLD_VERSION } from './coopnet.js';
import { worldSwitch, worldVariable, writeSyncs, changesWorld, worldPart, mergeWorld, senIds, LIT_FROM_START } from './coopworld.js';
import { convertEscapes, textColor } from '../ui/ui.js';
import { FloorMarker, MARK } from '../combat/telegraph.js';
import { NEW_MOVES } from '../combat/bossmoves.js';
import { exitOf } from '../game/interpreter.js';
import { tr } from '../ui/i18n.js';
import { packEnemyBuffs, readEnemyBuffs } from './enemy-status.js';
import { NO_H_SWITCH, refOf, indexMap, isRef, sayAt, pictureAt, soundAt, animationAt, musicOk, guard } from './coopguard.js';

const PROTO = 11;
export const MAX_PLAYERS = 4;         // the host and up to three in its world (unless the server's rules say more)
// The rules of a co-op session: the server's (coop_server.json, sent to every player - coopnet.js HubLink); the host's
// game keeps them in its world, and the host may change them in its co-op menu. maxPlayers: players at once;
// guestStartsBoss: a guest may start a boss fight before the host does - else, as in Dark Souls, the host goes in
// first; pvp: the players can strike each other; guestRespawn (on unless set off): a guest brought down comes back at the
// last bonfire instead of being sent home; bossSpectate (on unless set off): one brought down in a boss fight watches it
// until everyone in it is down (a guest only with guestRespawn)
const DEFAULT_RULES = { maxPlayers: MAX_PLAYERS, guestStartsBoss: false, pvp: false, guestRespawn: true, bossSpectate: true, statSync: true, guestsFollow: true, bossScale: true };
const BOSS_PER_PLAYER = 0.6;   // (the rule bossScale) a boss's HP, MP and groggy gauge: this much more for each player past one
// The developer's world (world_server.py): one world everyone on it walks, with no host - its rules: these, as the server
// says them (maxPlayers, bossSpectate, bossScale - world_server.json, or changed in the co-op menu by one who proved the
// admin PIN); the rest stay: a boss fight begun by anyone (the one running its map runs it), one who falls comes back at
// its own bonfire, no stats brought to anyone's, no following. PvP is each player's own there (myPvp): two who both
// turned it on may strike each other
const WORLD_RULES = { maxPlayers: 16, guestStartsBoss: true, pvp: false, guestRespawn: true, bossSpectate: true, statSync: false, guestsFollow: false, bossScale: true };
const CYCLE_CE = 201;          // 周回プレイ準備 - the next cycle's preparation: in the developer's world, a vote first
const WORLD_SAVE_EVERY = 120;  // s between the developer-server autosaves (this player's own, on its own PC)
const LOCK_WAIT = 5;           // s an ask for an event's lock is good for
const LOCK_RETRY = 4;          // s before asking again for one another player holds
const SCOPED = new Set(['p', 'look', 'sh', 'ow']);   // (the developer's world) what only those on this player's map see
const WORLD_SPAWN = { mapId: 101, x: 21, y: 21, dir: 8 };   // (the developer's world) everyone comes in at 도서관의 꿈 - its bonfire's
                                                             // arrival (the travel list's 【도서관의 꿈】)
const LEAD_TIE = 3;            // s: guests come onto a map this close together came at once (the lowest id leads it)
const FOLLOW_GRACE = 2;        // s a guest following the host (guestsFollow) leaves the map it is going from to the host
const LEAD_EVERY = 0.5;        // s: the host tells who leads each map it is not on
const BOSS_CALL_WAIT = 40;     // s a guest's ask for the host to come to its boss fight is good for
export const DEFAULT_PORT = 28471;     // (not 27015: Apple's mobile device service and many Steam games hold that one)
const POSE_EVERY = 1 / 20;     // s between poses
const LOOK_EVERY = 0.25;       // s between looks at what one looks like (sent when it changed)
const FLAGS_EVERY = 0.1;       // s: the world's changes go together (some maps change a variable every frame)
const HELLO_EVERY = 1;         // s: a guest asks again until the host answers
const EVENTS_EVERY = 0.1;      // s between the host's events sent (what changed; all of them to one just come)
const SCREEN_EVERY = 0.25;     // s between looks at the host's screen tone and music (sent when they change)
const ENEMIES_EVERY = 0.1;     // s between the host's enemies sent (all of those on the map: a few, small)
const HITS_PER_SECOND = 20;    // a guest's blow reports the host takes at most (more is not a person swinging)
const HALL_WAIT = 2.5;         // s without a hallucination's copies from the one running it: this player's own again
const EN_STATES = ['idle', 'chase', 'windup', 'act', 'stagger', 'recover', 'guard', 'dying', 'dead'];
// what of an attack plan a guest needs to draw its mark and play its move (combat.js beginTelegraph / puppetTelegraph,
// releaseBossMove)
const PLAN_NUMS = ['r', 'r0', 'half', 'len', 'width', 'aim', 'ox', 'oy', 'oz', 'cx', 'cz', 'lockAt', 'hits', 'tempo', 'way', 'n', 'wave', 'gap', 'full', 'spin', 'mult'];
const PLAN_FLAGS = ['ground', 'follow', 'heavy', 'pierce', 'certain', 'blockable', 'around', 'shot', 'lob', 'death', 'wall', 'dive'];
const PLAN_SHAPES = ['circle', 'ring', 'sector', 'line', 'multi', 'none'];
// a boss's moves (combat.js bossFamily) - nothing else is taken
const BOSS_MOVES = new Set(['charge', 'lunge', 'leap', 'fissure', 'quake', 'roar', 'breath', 'spin', 'flurry', 'thrust', 'grab', 'sweep',
  'execute', 'nova', 'wave', 'cross', 'field', 'pursuit', 'orbs', 'rain', 'volley', 'dice', 'chess', ...NEW_MOVES]);
const FX_PER_SEND = 8;         // the host's event sounds, animations and flashes sent at once (more are dropped)
// The host's scenes stay its own. What its events show - messages, pictures, their sounds, animations and flashes - goes
// to its guests only on the game's own route without the adult scenes (switch 20 Hシーン表示しない on: the prologue's
// question sets it) and never out of one of those scenes (the common events named シーン), wherever one is called from -
// the recollection room as well. A guest takes them only as places in the game's events it checks itself and shows
// from its own copy of the game (coopguard.js), whatever the other game sends
let sceneLists = null;
function inScene(interp) {
  if (!sceneLists) sceneLists = new Set(($data.commonEvents || []).filter(c => c && /シーン/.test(c.name || '')).map(c => c.list));
  for (let it = interp?.root || interp; it; it = it.child) if (it.list && sceneLists.has(it.list)) return true;
  return false;
}
// The host's death is its own: what its death's common events (全滅処理: the YOU DIED, its sound, the dark) show its
// guests do not see or hear, nor its screen going dark for it (deathOn) - nor a YOU DIED an event writes elsewhere
let deathLists = null;
function inDeath(interp) {
  if (!deathLists) deathLists = new Set(($data.commonEvents || []).filter(c => c && /全滅処理/.test(c.name || '')).map(c => c.list));
  for (let it = interp?.root || interp; it; it = it.child) if (it.list && deathLists.has(it.list)) return true;
  return false;
}
const YOU_DIED = /YOU\s*DIED/i;
// the bonfire common event an event's page rests at (the original's 篝火 ones, called at its top), or null
let fireIds = null;
function bonfireOf(list) {
  if (!fireIds) fireIds = new Set(($data.commonEvents || []).filter(c => c && /篝火/.test(c.name || '')).map(c => c.id));
  const call = (list || []).find(c => c.indent === 0 && c.code === 117 && fireIds.has(c.parameters[0]));
  return call ? $data.commonEvents[call.parameters[0]] : null;
}

// (host) a guest as this world's enemies see it: a body they go for, where the guest stands (its pose) - one of the
// companions to them (allies.js struckable). Their blows on it are judged on the guest's own side, by what it sees -
// the moves are played out there (combat.js puppets): its own place, guard, dodge, perfect guard and HP; it says how
// each went ('ow'), shown on it here
class RemoteBody {
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
const QUIET = 30;              // s without a word from someone: gone (a map being built can hold a page still for
                               // seconds - its own or the other's)
const CONNECT_WAIT = 25;       // s a guest waits to be let into the host's world
const MAX_TEXT = 4 << 20;      // longest message read (a welcome carries a whole world's switches)
const MAX_LIST = 200000;
const now = () => performance.now() / 1000;
const waitFor = (test, ms) => new Promise(res => { const t0 = now(); const go = () => (test() || now() - t0 > ms / 1000 ? res() : setTimeout(go, 30)); go(); });
const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

// ---- checks: a message is taken only as it should be, field by field --------------------------------------------
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lim = 1e5) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const isList = (a, max) => Array.isArray(a) && a.length <= max;
const nums = (a, n, lim) => Array.isArray(a) && a.length === n && a.every(x => isNum(x, lim));
// a variable's value: what the game's variables hold (numbers, short texts, true / false)
const isValue = v => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12) || (typeof v === 'string' && v.length <= 2000) || typeof v === 'boolean';
const SELF_KEY = /^\d{1,5},\d{1,5},[ABCD]$/;
const HALL_KEY = /^\d{1,5}:\d{1,2}$/;          // a hallucination: its event and page on the map (combat.js hallKey)
const FILE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,80}$/;
const okSwitch = i => isInt(i, 1, 99999);

// a trap of the host's world - a touch event's commands (its page's), their top level: HP it takes (Change HP, decrease: a number or a
// variable of the world; 'allow knockout' or not), the trap death check (common event 56: HP left at 1 is death),
// death itself (the party-wipe common events, Game Over); its sound and flash. null: not one
const HAZARD_GAP = 1;          // s: one trap passing over this player hurts once
function hazardOf(list) {
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
      const name = $data.commonEvents?.[p[0]]?.name || '';
      if (/罠死亡判定/.test(name)) get().check = true;
      else if (/全滅処理/.test(name)) get().death = true;
    }
  }
  if (h) for (const c of list) {
    if (c.indent !== 0) continue;
    if (c.code === 250 && !h.se) h.se = c.parameters[0];
    if (c.code === 224 && !h.flash) h.flash = c.parameters;
  }
  return (list._hazard = h && (h.hits.length || h.death || h.check) ? h : null);
}

function checkWorld(w) {
  if (!w || typeof w !== 'object') return null;
  if (!isList(w.sw, MAX_LIST) || !w.sw.every(okSwitch)) return null;
  if (!isList(w.vars, MAX_LIST) || !w.vars.every(e => Array.isArray(e) && e.length === 2 && okSwitch(e[0]) && isValue(e[1]))) return null;
  if (!isList(w.self, MAX_LIST) || !w.self.every(k => typeof k === 'string' && SELF_KEY.test(k))) return null;
  return w;
}
// the world as kept here: switches on, variables set, self switches on
const toWorld = w => ({ sw: new Set(w.sw), vars: new Map(w.vars), self: new Set(w.self) });
function checkPlace(p) {
  if (!p || typeof p !== 'object' || !isInt(p.m, 1, 9999) || !$data.mapInfos?.has(p.m)) return null;
  if (!isInt(p.x, 0, 999) || !isInt(p.y, 0, 999) || ![2, 4, 6, 8].includes(p.d)) return null;
  return { m: p.m, x: p.x, y: p.y, d: p.d };
}
function checkItem(s) {
  if (s === null) return null;
  if (!s || typeof s !== 'object' || !isInt(s.icon, 1, 99999) || !['weapon', 'shield'].includes(s.kind) || !isInt(s.wtype, 0, 99)) return undefined;
  if (!['right', 'left'].includes(s.hand) || typeof s.large !== 'boolean' || (s.sz !== undefined && (!isNum(s.sz, 2) || s.sz < 0))) return undefined;
  const a = s.adj;
  if (!a || !isNum(a.rot, 720) || !isNum(a.offset, 100) || !isNum(a.scale, 10) || a.scale <= 0 || typeof a.flip !== 'boolean') return undefined;
  return { icon: s.icon, kind: s.kind, wtype: s.wtype, hand: s.hand, large: s.large, sz: s.sz || 0, adj: { rot: a.rot, offset: a.offset, scale: a.scale, flip: a.flip } };
}
// what a hand holds ready or in hand instead (Coop.lookMsg U)
function checkUse(u) {
  if (u === undefined || u === null) return null;
  if (!u || typeof u !== 'object' || !['t', 'k', 's', 'm', 'n', 'r'].includes(u.k) || !isInt(u.i, 0, 99999) || !isInt(u.c, 0, 0xffffff) || !['right', 'left'].includes(u.h)) return undefined;
  if (u.k !== 's' && u.i < 1) return undefined;
  return { k: u.k, i: u.i, c: u.c, h: u.h };
}
function checkLook(m) {
  const c = m.chr;
  if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string' || !isInt(c[1], 0, 7)) return null;
  // (a character sheet of this game: anything else is drawn as nobody)
  const name = c[0] && FILE_NAME.test(c[0]) && resolveImage('Graphics/Characters', c[0]) ? c[0] : '';
  const R = checkItem(m.R), L = checkItem(m.L), U = checkUse(m.U);
  if (R === undefined || L === undefined || U === undefined) return null;
  // (the developer's world: the hallucinations it sees on its map - combat.js privateSymbol)
  const hv = Array.isArray(m.hv) && m.hv.length <= 64 && m.hv.every(k => typeof k === 'string' && HALL_KEY.test(k)) && isInt(m.hm, 1, 9999) ? m.hv : null;
  return { chr: [name, c[1]], R, L, U, nm: cleanName(m.nm), pv: m.pv === 1, hv, hm: hv ? m.hm : 0 };
}
// a place and turn in the world: x, y, z, then a quaternion
const checkXf = a => (a === undefined || a === 0 ? null : nums(a, 7, 1e5) ? a : undefined);
function checkHand(d) {
  if (d === undefined) return {};
  if (!d || typeof d !== 'object') return null;
  const h = checkXf(d.h), i = checkXf(d.i);
  if (h === undefined || i === undefined) return null;
  const c = d.c === undefined ? null : nums(d.c, 3, 1) ? d.c : undefined;
  if (c === undefined) return null;
  return { h, i, c };
}
function checkPose(m) {
  if (!isInt(m.s, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.m, 0, 9999) || !nums(m.h, 4, 1e5) || (m.j !== undefined && !isNum(m.j, 10))) return null;
  const R = checkHand(m.R), L = checkHand(m.L), u = checkXf(m.u);
  if (!R || !L || u === undefined || (m.ag !== undefined && (!isNum(m.ag, 1e7) || m.ag < 0))) return null;
  // (a balloon over it - an event of its world put one on it, or it put up one itself: an emote)
  if ((m.b !== undefined && !isInt(m.b, 0, 32)) || (m.sp !== undefined && m.sp !== 0 && m.sp !== 1)) return null;
  // (held by its world's scene - the one running a map: the others there are held with it)
  if (m.hd !== undefined && m.hd !== 0 && m.hd !== 1) return null;
  // (something ready, being aimed - an area spell, a throwable: where it would land, how wide)
  if (m.rk !== undefined && (!nums(m.rk, 4, 1e5) || !(m.rk[3] > 0 && m.rk[3] <= 10))) return null;
  return { s: m.s, m: m.m, h: m.h, j: m.j || 0, R, L, u, b: m.b || 0, sp: m.sp || 0, ag: m.ag || 0, hd: m.hd || 0, rk: m.rk || null };
}

const isStr = (s, max) => typeof s === 'string' && s.length <= max;
// a picture shown, moved or taken away on the host's screen ('s' / 'm' / 'e'; where it is already worked out there)
function checkPic(o) {
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
function checkFx(f) {
  if (!Array.isArray(f)) return null;
  if ((f[0] === 'se' || f[0] === 'me') && f.length === 2 && isRef(f[1])) return f;
  if (f[0] === 'an' && f.length === 3 && isInt(f[1], 0, 99999) && isRef(f[2])) return f;
  if (f[0] === 'fl' && f.length === 6 && f.slice(1, 5).every(v => isInt(v, 0, 255)) && isInt(f[5], 1, 600)) return f;
  return null;
}

// the game's data everyone must share (a different version or edition of the game could not be the same world)
function fingerprint() {
  const d = $data, s = d.system || {};
  const parts = [s.game_title, d.mapInfos?.size, d.actors?.length, d.classes?.length, d.skills?.length, d.items?.length, d.weapons?.length,
    d.armors?.length, d.enemies?.length, d.troops?.length, d.states?.length, d.commonEvents?.length, s.switches?.length, s.variables?.length];
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
}

// the world a host's game is: its switches, variables and self switches (only those that are on / set)
function worldOf(st) {
  const sw = [], vars = [];
  st.switches.forEach((v, i) => { if (v && okSwitch(i)) sw.push(i); });
  st.variables.forEach((v, i) => { if (okSwitch(i) && v !== 0 && v != null && isValue(v)) vars.push([i, v]); });
  return { sw, vars, self: [...st.selfSwitches.keys()].filter(k => SELF_KEY.test(k)) };
}
// (a guest's copy: switch 20 - Hシーン表示しない - is always on, whatever the host's world says: a guest's events take
// only the game's own route without the adult scenes)
// (its SEN - the variable and switches of the game's SEN reminder - stays its own: the host's does not become it)
function applyWorld(st, w) {
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
const isSenSwitch = id => senIds().sw.includes(id);
const isSenVar = id => id === senIds().v;

const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
const v3 = v => [r3(v.x), r3(v.y), r3(v.z)];
function worldXf(o) {
  o.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(tmpP, tmpQ, tmpS);
  return [tmpP.x, tmpP.y, tmpP.z, tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w].map(r3);
}
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
// a co-op server's address as the browser reaches it
export const serverUrl = s => `ws://${s.local ? '127.0.0.1' : s.ip}:${s.port || DEFAULT_PORT}/coop`;

export class Coop {
  constructor(scene) {
    this.scene = scene;
    this.role = null;           // 'host' | 'guest' | null
    this.link = null;
    this.server = null;         // the co-op server this session is on ({ local, ip, port }) - none for the dev links
    this.peers = new Map();     // the others: id -> { id, host, heard, seq, avatar, pose }
    this.hostId = null;         // (guest) the host's id
    this.summoned = false;      // (guest) standing in the host's world
    this.home = null;           // (guest) its own world while it is away: { state, mapId, x, y, dir }
    this.flags = new Map();     // (host) the world's changes not sent yet
    this.follow = null;         // (guest) where the host went last
    this.lastError = '';        // why the last visit could not begin (the co-op menu says it)
    this.seq = 0; this.poseT = 0; this.lookT = 0; this.flagsT = 0; this.lookKey = ''; this.helloT = -99; this.tick = 0; this.startT = 0;
    this.evT = 0; this.scrT = 0; this.enT = 0; this.evMap = 0; this.evLast = new Map(); this.scrKey = '';
    this.handed = new Map();    // (host) cells lately given to guests coming in: cell -> { m, t, who }
    this.saying = null;         // (host) the message its guests are reading with it ({ msg, out })
    this.pics = new Map();      // (host) the pictures its guests see: number -> where the Show Picture stands (coopguard.js)
    this.evLook = new Map();    // (host) how each event of this map looked when last sent outside a scene (evState)
    this.guard = guard;         // (the checks of what a guest is shown - coopguard.js: for the tests)
    this.ownPics = new Set();   // (host) pictures a scene put up: never sent, nor what is done with them
    this.fxOut = [];            // (host) its events' sounds, animations and flashes to send
    this.arenaMsg = null;       // (host) the boss fight's fog, while it is up ('ar')
    this.localRules = { ...DEFAULT_RULES };   // (the rules where no server gives them: the dev links)
    this.bossAskAt = 0;         // (guest) when it last asked the host to begin a boss fight
    this.key = '';              // the random key this game keeps (myKey) - and, for the dev links, the tag made of it
    this.myTag = '';
    this.sentAway = new Set();  // (host, dev links) guests sent away: what they still send is not taken
    this.hostSt = null;         // (guest) the host's own numbers (the rule statSync)
    this.stKey = ''; this.stT = 0; this.bsT = 0; this.syncKey = ''; this.syncT = 0;
    // (a map the host is not on, led by one of the guests there - leaderOf): since when this player stands on its map,
    // whether it leads it now and who runs it as this player sees it; what its own fights and events there change of the
    // world (recording: their interpreters are running), on its way to the host; a boss fight it asked the host to come
    // to (bossCall), and the one it begins of its own (bossGo); the host's way to such a fight (hostTrip), there now
    // (tripNow), and the ask it is answering (callOpen)
    this.arrMap = 0; this.arrT = now(); this.leadsNow = false; this.authNow = undefined; this.scrOf = new Map();
    this.recording = 0; this.outFlags = new Map(); this.outGains = []; this.wfT = 0;
    this.bossCall = null; this.bossGo = null; this.hostTrip = null; this.tripNow = null; this.callOpen = null;
    this.leadNow = new Map(); this.leadKey = ''; this.leadT = 0;      // (who leads which map, as the host says - leaderOf)
    this.ledBy = new Map();     // (host) map -> the guest leading it last, and when (onWorldFlags)
    // (the developer's world - world_server.py) where this player is with it: 'connecting', 'choosing' (how it comes in),
    // 'prologue' (the opening alone: its own until its first bonfire), 'in'; the world as the server has it while this
    // player is not in it yet (null: empty), who is on which map (roster: [id, name, tag, map]), the events' locks it holds
    // and asks for, what of the world it changed not sent yet, a vote this player's event waits on
    this.devServers = [];       // the developer's servers this game came with (devserver.json: 1 and 2 - { ip, port, pin } each)
    this.wphase = ''; this.wworld = undefined; this.roster = []; this.locks = new Set(); this.lockWait = new Map(); this.lockNo = new Map();
    this.outWorld = new Map(); this.applying = false; this.cycling = false; this.myVote = null; this.voting = null; this.wsaveT = WORLD_SAVE_EVERY;
    this.atSent = undefined; this.pendingJoin = null;
    this.worldRules = { ...WORLD_RULES }; this.isAdmin = false; this.adminTry = null;   // (the rules the server says; admin PIN proved)
    this.myPvp = false;         // (the developer's world) this player's own PvP, turned on in the co-op menu - off at each coming in
    addEventListener('pagehide', () => this.end('closed', { stay: true }));
  }
  get active() { return !!this.role; }
  get defaultPort() { return DEFAULT_PORT; }
  // this session's rules (DEFAULT_RULES): the server's, or - over the dev links - as set here; the developer's world's own
  get rules() { return this.role === 'world' ? this.worldRules : this.link?.rules || this.localRules; }
  // in the developer's world (in it - not still choosing how to come in, nor in the opening alone)
  get world() { return this.role === 'world' && this.wphase === 'in'; }
  // in a world whose maps' monsters others may run: a guest in the host's, or anyone in the developer's
  get shared() { return this.phantom || this.world; }
  // (host) a rule changed in the co-op menu: the server takes it and tells everyone (over the dev links the host tells
  // its guests itself). Those already in stay even when fewer may come now
  setRule(key, value) {
    if (this.role !== 'host' || !(key in DEFAULT_RULES)) return false;
    const was = this.rules, r = takeRules({ ...was, [key]: value });
    if (this.link?.setRules) { if (!this.link.setRules(r)) return false; }
    else { this.localRules = r; this.send({ t: 'rules', r }); }
    this.onRules(r);
    // (the guests follow this player again: those elsewhere come to its side)
    if (r.guestsFollow && !was.guestsFollow && this.ready()) {
      const pc = G.map.playerChar, given = new Set();
      for (const p of this.guests()) if (p.pose?.m && p.pose.m !== G.map.mapId) this.send({ t: 'map', ...this.arrival(pc.x, pc.y, pc.direction || 2, p.id, given) }, p.id);
    }
    return true;
  }
  onRules(r) {
    console.info('[coop] rules:', JSON.stringify(r));
    if (this.phantom) this.syncStats();
    G.ui?.refreshCoopMenu?.();
  }
  // the co-op server is older than this game (coopnet.js SERVER_VERSION): its rules and their defaults are not this
  // game's - the co-op menu says so (its coop_server.py is to be replaced by this game's)
  // (the developer's world: its own version - world_server.py WORLD_VERSION, not the co-op server's)
  get serverOld() { const l = this.link; return !!l && l.open === true && 'serverVersion' in l && l.serverVersion < (this.role === 'world' ? WORLD_VERSION : SERVER_VERSION); }
  // (host) the server's join PIN, as the server told this host - and a new one for it (4-12 digits)
  get serverPin() { return this.role === 'host' ? this.link?.pin || null : null; }
  setPin(pin) { return this.role === 'host' && !!this.link?.setPin?.(String(pin)); }
  // (a guest running an event of the host's world - interpreter.js c117) the common events it leaves out: the adult scenes
  // (シーン - as none are ever shown to a guest) and the death ones (全滅処理: its own fall goes by the server's rules)
  skipsCommonEvent(id) {
    const name = $data.commonEvents?.[id]?.name || '';
    return /シーン|全滅処理/.test(name);
  }
  // a guest in the host's world: its own events do not run, nothing is saved
  get phantom() { return this.role === 'guest' && this.summoned; }
  guests() { return [...this.peers.values()].filter(p => !p.host); }

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
    this.outWorld.clear(); this.cycling = false; this.myVote = null; this.voting = null; this.atSent = undefined; this.pendingJoin = null;
    this.worldRules = { ...WORLD_RULES }; this.isAdmin = false; this.adminTry = null; this.myPvp = false; this.hallFollow?.clear(); this.hallMap = 0;
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
  }
  fail(why) {
    this.lastError = String(why || 'connect');
    this.end(`could not: ${this.lastError}`);
    G.audio?.playSystemSe(3);            // (the buzzer: it did not work - the co-op menu says why)
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
      case 'tp': if (this.shared && (from === this.hostId || this.joiningTo(from))) this.onBrought(m); break;
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
      case 'look': this.onLook(m, from); break;
      case 'p': this.onPose(m, from); break;
      case 'bye': this.peerGone(from, 'said goodbye'); break;
      default: break;
    }
  }

  // ---- host ------------------------------------------------------------------------------------------------------
  onHello(m, from) {
    if (!this.ready()) return;                                    // (still loading: it asks again)
    if (m.v !== PROTO) { this.send({ t: 'refuse', why: 'version' }, from); return; }
    if (m.fp !== fingerprint()) { this.send({ t: 'refuse', why: 'game' }, from); return; }
    // (banned by this host: the server keeps it out by its tag - over the dev links the tag is the guest's own word)
    const tag = this.link?.info ? this.tagOf(from) : isTag(m.tag) ? m.tag : '';
    if (tag && this.banTags().includes(tag)) { this.send({ t: 'refuse', why: 'banned' }, from); return; }
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
    const enemies = G.combat.netEnemies(), buffs = packEnemyBuffs(enemies);
    for (const e of enemies) {
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
      this.send({ t: 'en', m, e: mine, buffs }, p.id);
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
  // '<who> 님이 <boss>을(를) 처치하셨습니다' - to everyone on the server, a while in its notices (ui.js toast)
  onKill(m) {
    if (!isList(m.w, 8) || !m.w.every(n => typeof n === 'string' && n.length <= 32) || !isList(m.in, 8) || !m.in.every(id => typeof id === 'string' && id.length <= 64)) return;
    const boss = this.bossNames(m.b), who = m.w.map(n => cleanName(n) || '?').join(', ');
    if (!boss || !who) return;
    G.ui.toast?.(convertEscapes(tr('{who} 님이 {boss}[을;를] 처치하셨습니다', { who, boss })), 0, '#ffd870', 6);
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
  // player's numbers - the one struck works out the rest
  sendPvp(to, s, mult, crit, actor, item = false) {
    const nums = ['atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mhp', 'mp', 'mmp', 'level'];
    const a = {};
    for (const k of nums) a[k] = Math.round(+actor[k] || 0);
    const el = (actor.atkElements?.() || []).filter(x => isInt(x, 1, 99)).slice(0, 8);
    this.send({ t: 'pv', s, u: item ? 1 : 0, m: r3(mult), c: crit ? 1 : 0, a, el }, to);
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
    // (a stand-in for the striker: its numbers as sent, its attack's elements)
    const by = { ...Object.fromEntries(nums.map(k => [k, a[k]])), tp: 0, atkElements: () => m.el.slice(), elementRate: () => 1, isStateAffected: () => false };
    const c = p.avatar?.cur, from3 = c ? new THREE.Vector3(c.x, c.y - 0.6, c.z) : null;
    const how = G.combat.pvpStruck(by, s, m.m, from3);
    if (how && how !== 'dodge') this.send({ t: 'ow', id: 0, k: how === 'hit' ? 0 : how === 'guard' ? 1 : 2 });
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
      e.statusBuffs = readEnemyBuffs(m.buffs, e.id);
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
  joinWorld(i = 0) {
    const s = this.devServers[i];
    if (!s || this.active) return false;
    this.devIndex = i;
    this.start('world', () => new WorldLink(serverUrl(s), { pin: s.pin, key: this.myKey(), name: this.myName(), fp: fingerprint() }), s);
    this.wphase = 'connecting';
    return true;
  }
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
      bossSpectate: r.bossSpectate !== false, bossScale: r.bossScale !== false };          // (PvP: each player's own - myPvp)
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
    if (this.role !== 'world' || !this.isAdmin || !['maxPlayers', 'bossSpectate', 'bossScale'].includes(key)) return false;
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
  // (the opening alone) its first bonfire: into the world from here (main.js onBonfire)
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
    if (!this.world) { if (this.wphase === 'prologue') this.tellAt(0); return false; }
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
  eventDone(mapId, evId) {
    const k = `${mapId},${evId}`;
    if (this.locks.has(k)) this.releaseLock(k);
  }
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
  // (the developer's world) the common events left out: the adult scenes (シーン)
  worldSkips(id) { return /シーン/.test($data.commonEvents?.[id]?.name || ''); }

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
      const list = [], enemies = [];
      if (p.hvm === m && p.hv?.size) for (const [key, g] of groups) if (p.hv.has(key)) for (const e of g.enemies) {
        list.push([...this.enemyEntry(e, g.sym), key, r2(g.age)]);
        enemies.push(e);
      }
      const k = JSON.stringify(list);
      if (k === p.henKey && !list.length) continue;
      p.henKey = k;
      this.send({ t: 'hen', m, e: list, buffs: packEnemyBuffs(enemies) }, p.id);
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
      e.statusBuffs = readEnemyBuffs(m.buffs, e.id);
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
      C.peerShot({ from: f, vel: v, look: m.lk, icon: m.i | 0, color: c, quat: q, life: m.l, gravity: m.g || 0, land: m.ln || 0, align: !!m.al, tumble: !!m.tu,
        fine: !!m.fi, aoe: m.ao || 0, dest: d, track: m.tk || 0, target: m.tg || 0, anim: a, by: from });
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
    const U = r ? { k: r.kind === 'item' ? (c.isKnife(r.obj) ? 'k' : 't') : 's', i: r.obj.icon_index | 0, c: r.kind === 'item' ? 0 : c.skillColor(r.obj) | 0, h: 'right' }
      : h ? { k: h.how === 'stab' ? 'n' : h.how === 'rub' ? 'r' : 'm', i: h.obj.icon_index | 0, c: 0, h: h.hand === 'left' ? 'left' : 'right' } : null;
    // (while one of the scenes plays: as it looked before it - a scene's own looks stay this player's)
    if (!this.sceneOn()) this.lookChr = [leader?.characterName || '', leader?.characterIndex || 0];
    const look = { t: 'look', chr: this.lookChr || ['', 0], R: item(specs.weapon), L: item(specs.offhand), U, nm: this.myName() };
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
    const rk = G.combat.readyMark?.();                       // (something ready, being aimed: where it would land)
    if (rk) msg.rk = rk.map(r3);
    if (this.isAuthority() && G.map.interpreter.running() && G.map.interpreter.waitMode !== 'battle') msg.hd = 1;
    for (const side of ['right', 'left']) {
      const d = {};
      const hand = G.hands?.models?.[side];
      if (G.vr && hand?.root?.parent && shown(hand.root)) { d.h = worldXf(hand.root); d.c = (hand.last || [0, 0, 0]).map(r3); }
      const obj = side === 'right' ? G.combat?.weapon : G.combat?.shield;
      if (obj?.parent && !obj.userData.unarmed && obj.children.length && shown(obj)) d.i = worldXf(obj);
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
    const see = head && this.ready();
    for (const p of this.peers.values()) if (p.avatar) { if (see) p.avatar.update(dt, head); else p.avatar.hide(); }
  }
}
