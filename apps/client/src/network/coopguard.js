// Co-op: what a guest is shown of another player's world - the messages, pictures and sounds that player's events
// show, its music - is only ever what this game's own events show outside the adult scenes, whatever the other game
// sends. A message, a picture or a sound comes as a place in the game's events (src: ['c', common event], ['t', troop,
// page] or ['e', map, event, page], then the command's index), never as a text or a file name: the guest puts up that
// command's own text, picture or sound from its own copy of the game - and nothing where the place is one left out:
// the adult scenes (the common events named シーン, and every common event one of them calls), the death ones
// (全滅処理: a player's death is its own), and whatever stands in a branch that runs only with switch 20
// (Hシーン表示しない) off. Music, which goes on from map to map, is taken only if the game's maps or events play it
// (those same ones left out). The adult scenes are known here by their names alone: nothing in them is looked into.
import { $data, loadMap } from '../data/data.js';
import { G } from '../core/globals.js';
import { convertEscapes, bannerOf, localSpeakerName } from '../ui/ui.js';

export const NO_H_SWITCH = 20;
const isI = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// ---- the common events left out: the adult scenes, those they call, the deaths. One of those they call that the
// game's other events call too (the kills 簡易殺す, a ring check) is taken where one of those calls it: this map's
// events, a troop's, a common event not left out (shownCe)
let shut = null, own = null;
export function shutEvents() {
  if (shut) return shut;
  const ces = $data.commonEvents || [], calls = new Map();
  for (const ce of ces) if (ce?.list) calls.set(ce.id, ce.list.filter(c => c.code === 117).map(c => c.parameters?.[0]));
  const out = new Set(), todo = [];
  own = new Set();
  for (const ce of ces) if (ce && /シーン/.test(ce.name || '')) { out.add(ce.id); own.add(ce.id); todo.push(ce.id); }
  while (todo.length) for (const id of calls.get(todo.pop()) || []) if (isI(id, 1, 99999) && !out.has(id)) { out.add(id); todo.push(id); }
  for (const ce of ces) if (ce && /全滅処理/.test(ce.name || '')) { out.add(ce.id); own.add(ce.id); }
  return (shut = out);
}
const shared = new Map();        // `${common event}:${map}` -> called by the game's other events there
function shownCe(id) {
  const out = shutEvents();
  if (!out.has(id)) return true;
  if (own.has(id)) return false;
  const key = id + ':' + (G.map?.mapId | 0);
  if (shared.has(key)) return shared.get(key);
  const calls = list => (list || []).some(c => c?.code === 117 && c.parameters?.[0] === id);
  let yes = ($data.commonEvents || []).some(ce => ce?.list && !out.has(ce.id) && calls(ce.list))
    || ($data.troops || []).some(t => (t?.pages || []).some(p => calls(p?.list)));
  for (const [, ev] of yes ? [] : G.map?.map?.events || []) if ((ev?.pages || []).some(p => calls(p?.list))) { yes = true; break; }
  shared.set(key, yes);
  return yes;
}

// ---- the branches that run only with switch 20 off (Conditional Branch: switch 20 OFF, the else of switch 20 ON,
// either side of a script that reads it): per command of a list, 1 if it stands in one
const gated = new WeakMap();
function gating(list) {
  let g = gated.get(list);
  if (g) return g;
  g = new Uint8Array(list.length);
  const open = [];             // the conditional branches it is in: { indent, otherwise, now }
  for (let i = 0; i < list.length; i++) {
    const c = list[i], d = c?.indent | 0;
    while (open.length && open[open.length - 1].indent > d) open.pop();
    const top = open[open.length - 1];
    if (top?.indent === d) { if (c?.code === 411) top.now = top.otherwise; else open.pop(); }    // (its else; its end)
    g[i] = open.some(b => b.now) ? 1 : 0;
    if (c?.code === 111) {
      const [kind, a, b] = c.parameters || [];
      let then = false, otherwise = false;
      if (kind === 0 && a === NO_H_SWITCH) { then = b === 1; otherwise = b === 0; }
      else if (kind === 12 && /\$game_switches\s*\[\s*20\s*\]/.test(String(a))) then = otherwise = true;
      open.push({ indent: d, otherwise, now: then });
    }
  }
  gated.set(list, g);
  return g;
}
export const hGated = (list, i) => !!gating(list)[i];

// ---- (the one running a map) where a command of the game's events stands - its place, or null: not one of the
// game's own lists. A map's events are known from when it is entered (an event goes on running after its player
// went on to another map)
const baseOf = new WeakMap();
export function indexMap(mapId, raw) {
  for (const [id, ev] of raw?.events || []) (ev?.pages || []).forEach((p, k) => { if (p?.list) baseOf.set(p.list, ['e', mapId, id, k]); });
}
export function refOf(interp, index = interp?.index) {
  const list = interp?.list;
  if (!Array.isArray(list) || !isI(index, 0, list.length - 1)) return null;
  let base = baseOf.get(list);
  if (!base) {
    // (a list met the first time: which of the game's it is - a common event, a troop's page, this map's event)
    const ce = ($data.commonEvents || []).find(c => c?.list === list);
    if (ce) base = ['c', ce.id];
    for (const t of base ? [] : $data.troops || []) {
      const k = (t?.pages || []).findIndex(p => p?.list === list);
      if (k >= 0) { base = ['t', t.id, k]; break; }
    }
    if (!base && G.map?.map) { indexMap(G.map.mapId, G.map.map); base = baseOf.get(list); }
    if (base) baseOf.set(list, base);
  }
  return base ? [...base, index] : null;
}

// ---- (a guest) the command at a place, as this game has it: { list, i, cmd } - null when there is none of those
// codes there, or the place is one left out. A place on another map than this one waits for that map's data
export const isRef = r => Array.isArray(r) && r.length >= 3 && r.length <= 5 && typeof r[0] === 'string' && r.slice(1).every(v => Number.isInteger(v));
function listAt(ref, map) {
  const [k, a, b, c] = ref;
  if (k === 'c' && ref.length === 3 && isI(a, 1, 99999)) return shownCe(a) ? $data.commonEvents?.[a]?.list || null : null;
  if (k === 't' && ref.length === 4 && isI(a, 1, 99999) && isI(b, 0, 99)) return $data.troops?.[a]?.pages?.[b]?.list || null;
  if (k === 'e' && ref.length === 5 && isI(b, 1, 99999) && isI(c, 0, 99)) return map?.events?.get?.(b)?.pages?.[c]?.list || null;
  return null;
}
function commandAt(ref, codes, map = null) {
  if (!isRef(ref)) return null;
  if (ref[0] === 'e') { if (!isI(ref[1], 1, 9999)) return null; map ||= ref[1] === G.map?.mapId ? G.map.map : null; }
  const list = listAt(ref, map), i = ref[ref.length - 1];
  if (!Array.isArray(list) || !isI(i, 0, list.length - 1) || !codes.includes(list[i]?.code) || hGated(list, i)) return null;
  return { list, i, cmd: list[i] };
}
async function commandAtAsync(ref, codes) {
  if (isRef(ref) && ref[0] === 'e' && isI(ref[1], 1, 9999) && ref[1] !== G.map?.mapId) {
    if (!$data.mapInfos?.has(ref[1])) return null;
    try { return commandAt(ref, codes, await loadMap(ref[1])); } catch { return null; }
  }
  return commandAt(ref, codes);
}

// the picture the game's own Show Picture at a place shows: its name ('' - none) - null: no such command there
export async function pictureAt(ref) {
  const at = await commandAtAsync(ref, [231]);
  return at ? String(at.cmd.parameters?.[1] ?? '') : null;
}
// the sound the game's own Play SE (250) / Play ME (249) at a place plays: { name, volume, pitch }, or null
export async function soundAt(ref, code) {
  const a = (await commandAtAsync(ref, [code]))?.cmd.parameters?.[0];
  return a?.name ? { name: String(a.name), volume: isI(a.volume, 0, 100) ? a.volume : 100, pitch: isI(a.pitch, 50, 150) ? a.pitch : 100 } : null;
}
// the animation the game's own Show Animation at a place plays (0: none)
export async function animationAt(ref) {
  const at = await commandAtAsync(ref, [212]);
  return at ? at.cmd.parameters?.[1] | 0 : 0;
}

// a message window as the game's own command at a place puts it up (Show Text - its lines, and the choices after it -,
// Show Choices, Show Scrolling Text). names: the other player's names for \N[n] / \P[n] ({ N1: 'Grimm', P2: .. },
// short ones only); vis: which of its choices show there ([block, item]: their conditions are that game's own); name:
// its speaker's name as the other game says it (taken only if this game has that name). { banner } for a big banner
// (VICTORY ACHIEVED); null: no such command there, or the place is one left out
const NAME_OK = /^[^\x00-\x1f\\[\]]{0,16}$/;
export async function sayAt(ref, { names = null, vis = null, name = '' } = {}) {
  const at = await commandAtAsync(ref, [101, 102, 105]);
  if (!at) return null;
  const { list, cmd } = at;
  const nm = {};
  if (names && typeof names === 'object' && !Array.isArray(names)) {
    for (const [k, v] of Object.entries(names).slice(0, 16)) if (/^[NP]\d{1,4}$/.test(k) && typeof v === 'string' && NAME_OK.test(v)) nm[k] = v;
  }
  const conv = s => convertEscapes(String(s ?? '').replace(/\\([NP])\[(\d+)\]/gi, (m, k, n) => nm[k.toUpperCase() + n] ?? m));
  const raw = [], msg = { face: '', faceIndex: 0, background: 0, position: 2, lines: [], choices: null, scroll: false, name: '' };
  let i = at.i;
  if (cmd.code === 101) {
    const [face, fi, bg, pos] = cmd.parameters || [];
    msg.face = typeof face === 'string' ? face : '';
    msg.faceIndex = isI(fi, 0, 7) ? fi : 0;
    msg.background = isI(bg, 0, 2) ? bg : 0;
    msg.position = isI(pos, 0, 2) ? pos : 2;
    while (list[i + 1]?.code === 401) raw.push(String(list[++i].parameters?.[0] ?? ''));
  } else if (cmd.code === 105) {
    msg.position = 1; msg.scroll = true;
    while (list[i + 1]?.code === 405) raw.push(String(list[++i].parameters?.[0] ?? ''));
  }
  const ci = cmd.code === 102 ? at.i : cmd.code === 101 && list[i + 1]?.code === 102 ? i + 1 : -1;
  if (ci >= 0) msg.choices = choicesAt(list, ci, vis).map(t => ({ text: conv(t), enabled: true }));
  msg.lines = raw.map(conv);
  if (msg.lines.some(l => /YOU\s*DIED/i.test(l))) return null;
  const banner = cmd.code === 101 ? bannerOf({ face: msg.face, choices: msg.choices, lines: raw }) : null;
  if (banner) return { banner };
  if (typeof name === 'string' && name && name.length <= 40) {
    const playerNames = new Set(Object.values(nm)), ok = new Set(playerNames);
    for (const v of Object.values(G.scripts?.names || {})) if (typeof v === 'string' && !/^Actor\[/.test(v)) ok.add(v.trim());
    for (const a of $data.actors || []) if (a?.name) ok.add(a.name);
    for (const c of list) {
      const t = (c.code === 108 || c.code === 408) && /^NW名前指定\s*(.+)$/.exec(String(c.parameters?.[0] ?? ''));
      if (t) ok.add(t[1].trim());
    }
    const aliases = G.scripts?.nameAliases || {};
    // Only translations of locally recognized speakers join the existing
    // allowlist. An arbitrary host string is still not a speaker name.
    for (const source of [...ok]) if (Object.hasOwn(aliases, source)) ok.add(aliases[source]);
    if (ok.has(name)) msg.name = playerNames.has(name) ? name : localSpeakerName(name);
  }
  return msg;
}
// the choices of a Show Choices (and the ones right after it, at its indent: one list - interpreter.js setupChoices)
// as their texts, without their conditions; vis: those shown ([block, item]) - all of them if it makes no sense
function choicesAt(list, i, vis) {
  const d = list[i].indent, groups = [];
  while (i < list.length && list[i].code === 102 && list[i].indent === d) {
    groups.push(Array.isArray(list[i].parameters?.[0]) ? list[i].parameters[0] : []);
    let j = i + 1;
    while (j < list.length && !(list[j].code === 404 && list[j].indent === d)) j++;
    i = j + 1;
  }
  const text = (b, k) => String(groups[b][k] ?? '').replace(/if\((.+?)\)/g, '').replace(/en\((.+?)\)/g, '').trim();
  const all = groups.flatMap((g, b) => g.map((_, k) => [b, k]));
  const fits = Array.isArray(vis) && vis.length <= all.length
    && vis.every(v => Array.isArray(v) && v.length === 2 && isI(v[0], 0, groups.length - 1) && isI(v[1], 0, groups[v[0]].length - 1));
  return (fits ? vis : all).map(([b, k]) => text(b, k));
}

// ---- music: a BGM / BGS is taken only if the game plays it - the system's own, the maps this player has been on
// (theirs, and what their events play), the troops' events and the common events (those left out aside)
const music = { bgm: new Set(), bgs: new Set() }, heard = new Set();
let musicKnown = false;
function noteMusic(lists) {
  for (const list of lists) {
    const g = gating(list);
    for (let i = 0; i < list.length; i++) {
      const c = list[i], n = c?.parameters?.[0]?.name;
      if (!n || g[i]) continue;
      if (c.code === 241 || c.code === 132) music.bgm.add(n);
      else if (c.code === 245) music.bgs.add(n);
    }
  }
}
export function musicOk(kind, name) {
  if (!musicKnown) {
    musicKnown = true;
    const s = $data.system || {};
    for (const a of [s.title_bgm, s.battle_bgm, s.boat?.bgm, s.ship?.bgm, s.airship?.bgm]) if (a?.name) music.bgm.add(a.name);
    const out = shutEvents();
    noteMusic(($data.commonEvents || []).filter(ce => ce?.list && !out.has(ce.id)).map(ce => ce.list));
    noteMusic(($data.troops || []).flatMap(t => (t?.pages || []).map(p => p?.list).filter(Boolean)));
  }
  const m = G.map?.mapId, raw = G.map?.map;
  if (m && raw && !heard.has(m)) {
    heard.add(m);
    if (raw.bgm?.name) music.bgm.add(raw.bgm.name);
    if (raw.bgs?.name) music.bgs.add(raw.bgs.name);
    for (const [, ev] of raw.events || []) noteMusic((ev?.pages || []).map(p => p?.list).filter(Boolean));
  }
  return !!music[kind]?.has(name);
}

// (for the tests: the parts, to look at and to try out - leaveOut: a common event left out as the adult scenes are;
// leaveOut(id, true): as one they call)
const leaveOut = (id, called = false) => { shutEvents().add(id); if (!called) own.add(id); shared.clear(); };
const takeBack = id => { shutEvents().delete(id); own.delete(id); shared.clear(); };
export const guard = { shutEvents, hGated, refOf, musicOk, music, leaveOut, takeBack };
