// The developer's world (world_server.py): one world shared by everyone on it - what of the game is the world's, and
// what is each player's own.
// The world's: the switches, variables and self switches the story, the places and their people go by - a boss beaten,
// a door or a shortcut opened, a chest emptied, someone killed or locked up, a bonfire lit (everyone may travel to it).
// The server keeps them and passes them on as they change (coop.js).
// Each player's own - never the world's, kept in its own developer-server save: what is its character's (its
// background, its oaths and their levels, its summons, its souls and where it lost them, its last bonfire, SEN, the
// rings it wears, Hシーン表示しない, the snake god's curse), what the game works out on the way (the enemy and treasure flags of the map it is
// on, counts, places, numbers drawn), a scene's own flags, and what starts a common event by itself (on for one, it
// would start that event for everyone). Found by what the game's events write them with (the player's own data, random
// numbers, parallel processes only - a scan of the game's events) and by their names in the game's own data.
// What a parallel process or a roaming monster's fight changes is that player's own as well (each player's game runs
// those for itself): only an event's run on the map's own interpreter - what a player began, a cutscene, a fight's -
// changes the world (writeSyncs).
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { runningInterpreter } from '../game/interpreter.js';

// (the bonfires one may travel to - 126-156, 1041-1045: the world's, lit by anyone for everyone; a save brought in does not
// bring its own)
// (618 蛇神呪い, the snake god's curse - its random frights (CE184), the cursed monsters of 13 maps, the snake god gone
// from 리펀 대성당: borne by the one whose game killed or maddened 도마뱀 빌 - or crossed the snake god -, not by
// everyone; 빌's own end - 189/191/192, his self switches - is the world's)
const OWN_SWITCHES = '1-8,11-20,22-40,60,67,69,72-74,77,79,82,86,88,93,99,101-102,104-106,122-125,157,163,167,169,196,202,'
  + '216,244,246-380,384,387,390,397,419,426,432-437,439,456,460,464,469-470,499-500,528-539,548,556,565,591,606-610,618,'
  + '634-640,655-679,721-859,863,892-894,904,909,912,923,936-937,946-994,1001-1040,1046,1049,1051-1063,1093-1097';
const OWN_VARIABLES = '1-2,4-7,12-14,16-17,19,21-24,26-27,29-31,35-39,42-43,53,56-57,62-65,67-83,85,91,100-113,118,123-200,'
  + '203-208,210-859,861-865,867,869,874,876-877,887,892-893,901-1007';
export const NO_H = 20;
// the bonfires lit in the developer's world from the start: 도서관의 꿈's (127) and 추락의 방's (128 - map 1), the way out
// of 도서관의 꿈 where everyone comes in and the way back. (The game lights the two together at the library's event 2 and
// at a party wipe, CE11: a world already past the first would have neither until someone falls.)
export const LIT_FROM_START = [127, 128];
const ranges = s => {
  const set = new Set();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let i = a; i <= (b || a); i++) set.add(i);
  }
  return set;
};
let ownSw = null, ownVar = null;
function own() {
  if (ownSw) return;
  ownSw = ranges(OWN_SWITCHES);
  ownVar = ranges(OWN_VARIABLES);
  // (a switch that starts a common event by itself - autorun, parallel: on for one player, it would start that event
  // for everyone)
  for (const c of $data.commonEvents || []) if (c && c.trigger > 0 && c.switch_id > 0) ownSw.add(c.switch_id);
  // (SEN: the variable the game's own SEN reminder watches, and the switches it keeps)
  const { v, sw } = senIds();
  if (v) ownVar.add(v);
  for (const i of sw) ownSw.add(i);
}
// SEN as the game's own reminder script has it (scriptdata.js): its variable and switches - each player's own, never
// another's (the developer's world, and a guest in a host's)
export function senIds() {
  const s = G.scripts?.sen;
  return { v: s?.variable > 0 ? s.variable : 0, sw: (s?.switches || []).map(x => x[0]).filter(i => i > 0) };
}
// 蛇神呪い: the snake god's curse (own - OWN_SWITCHES)
export const CURSE = 618;
// an event page that only a player's own state brings out: low SEN (SEN's switches - SEN 0, 30, 70 or under) or the
// snake god's curse among its conditions - its monsters are that player's hallucinations (combat.js privateSymbol)
export function personalPage(page) {
  const c = page?.condition;
  if (!c) return false;
  const mine = id => id === CURSE || senIds().sw.includes(id);
  return (c.switch1_valid && mine(c.switch1_id)) || (c.switch2_valid && mine(c.switch2_id));
}
export function worldSwitch(id) { own(); return Number.isInteger(id) && id > 0 && id !== NO_H && !ownSw.has(id); }
export function worldVariable(id) { own(); return Number.isInteger(id) && id > 0 && !ownVar.has(id); }

// an event (any of its pages) that is a roaming monster (its move route turns its encounter on): its self switches are
// the map's runner's own (the monsters there are its to run)
export function isMonsterEvent(ev) {
  if (!ev) return false;
  if (ev._monster === undefined) {
    ev._monster = (ev.event?.pages || []).some(pg => (pg.move_route?.list || []).some(mc => mc.code === 45 && /enable_symbol_encount/.test(mc.parameters?.[0] || '')));
  }
  return ev._monster;
}

// a change the game is making now (state.js): the world's (passed on) - a switch or variable of the world's, any
// self switch but a roaming monster's, made by an event's run on the map's own interpreter, a fight's, or the game
// itself; not by a parallel process or a roaming monster's fight (each player's game runs those for itself)
export function writeSyncs(kind, key) {
  if (kind === 'S' && !worldSwitch(key)) return false;
  if (kind === 'V' && !worldVariable(key)) return false;
  const it = runningInterpreter(), root = it && (it.root || it);
  if (root && (root.kind === 'parallel' || root.kind === 'symbol')) return false;
  if (kind === 'SS') {
    const [m, e] = String(key).split(',').map(Number);
    if (m === G.map?.mapId && isMonsterEvent(G.map.events?.[e])) return false;
  }
  return true;
}

// an event's page whose run changes the world - a switch or variable of the world's, a self switch (its own, or a
// common event's it calls): one player at a time runs it (coop.js mayStart)
const changes = new WeakMap();
export function changesWorld(list, depth = 0) {
  if (!Array.isArray(list)) return false;
  if (changes.has(list)) return changes.get(list);
  let yes = false;
  for (const c of list) {
    const p = c.parameters;
    if (c.code === 123) yes = true;
    else if (c.code === 121) { for (let i = p[0]; i <= p[1] && !yes; i++) yes = worldSwitch(i); }
    else if (c.code === 122) { for (let i = p[0]; i <= p[1] && !yes; i++) yes = worldVariable(i); }
    else if (c.code === 117 && depth < 4) yes = changesWorld($data.commonEvents?.[p[0]]?.list, depth + 1);
    if (yes) break;
  }
  changes.set(list, yes);
  return yes;
}

// the world's part of a game: its switches on, variables set and self switches on that are the world's
export function worldPart(st) {
  const sw = [], vars = [];
  st.switches.forEach((v, i) => { if (v && worldSwitch(i)) sw.push(i); });
  st.variables.forEach((v, i) => { if (worldVariable(i) && v !== 0 && v != null) vars.push([i, v]); });
  return { sw, vars, self: [...st.selfSwitches.keys()] };
}
// a game in the world: the world's part as the server has it ({ sw, vars, self } - lists, or a set, a map and a set),
// its own part as it was; Hシーン表示しない always on, the bonfires lit from the start lit
export function mergeWorld(st, w) {
  const on = new Set(w.sw), set = new Map(w.vars);
  let n = st.switches.length, nv = st.variables.length;
  for (const i of on) n = Math.max(n, i + 1);
  for (const i of set.keys()) nv = Math.max(nv, i + 1);
  for (let i = 1; i < n; i++) if (worldSwitch(i)) st.switches[i] = on.has(i);
  for (let i = 1; i < nv; i++) if (worldVariable(i)) st.variables[i] = set.has(i) ? set.get(i) : 0;
  st.selfSwitches = new Map([...w.self].map(k => [k, true]));
  st.switches[NO_H] = true;
  for (const i of LIT_FROM_START) st.switches[i] = true;
}
