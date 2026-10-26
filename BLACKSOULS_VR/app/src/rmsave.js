// A VR save written as the original game's save (원작 세이브로 내보내기 - main.js showRmExportMenu): Save##.rvdata2, as RPG
// Maker VX Ace writes it (DataManager: Marshal.dump of the header, then of the contents).
// - A Ruby Marshal 4.8 tree that keeps all a save holds - classes, instance variables in their order, strings with their
//   encodings, user-defined dumps (Table, Color, Tone), floats and bignums as written, links between objects - read and
//   written back byte for byte (readTree / writeTree). Plain values: nil = null, true / false, a Fixnum = a JS integer;
//   the rest are nodes { t: <Marshal type character>, ... }.
// - The original's scripts add more to a save than this VR version keeps (메뉴 settings, battle state, the map's events...),
//   so a save is not made from nothing: an original save is the template (the one the VR save was made from, if it is
//   there) and the VR state is written into it (exportRmSave). The game reads the map again as it loads it (its version id
//   left apart from the data's: DataManager.reload_map_if_updated), so the template's map, events and the event it was
//   saved in do not come along.

const ch = c => c.charCodeAt(0);
const latin1 = new TextDecoder('latin1');
const utf8 = new TextEncoder();
const FIX_MIN = -(2 ** 30), FIX_MAX = 2 ** 30 - 1;       // RGSS3's Ruby (1.9, 32 bits): a Fixnum's range

// ------------------------------------------------------------------ the tree
class TreeReader {
  constructor(bytes, pos) {
    this.b = bytes; this.p = pos;
    this.syms = []; this.objs = [];
  }
  byte() { return this.b[this.p++]; }
  long() {
    let c = this.b[this.p++];
    if (c > 127) c -= 256;
    if (c === 0) return 0;
    if (c > 4) return c - 5;
    if (c < -4) return c + 5;
    let x = 0;
    const n = Math.abs(c);
    for (let i = 0; i < n; i++) x += this.b[this.p++] * 2 ** (8 * i);
    return c > 0 ? x : x - 2 ** (8 * n);
  }
  bytes() { const n = this.long(); const out = this.b.slice(this.p, this.p + n); this.p += n; return out; }
  reg(node) { this.objs.push(node); return node; }
  // a symbol where one must be (a class's name, an instance variable's): ':' its first time, ';' after; 'I' with encoding
  symbol() {
    const t = this.byte();
    if (t === ch(';')) return this.syms[this.long()];
    if (t === ch(':')) return this.symDef(false);
    if (t === ch('I') && this.b[this.p] === ch(':')) { this.p++; return this.symDef(true); }
    throw new Error(`Marshal: a symbol expected at ${this.p - 1}`);
  }
  symDef(withIvars) {
    const node = { t: ':', s: latin1.decode(this.bytes()) };
    this.syms.push(node);
    if (withIvars) node.I = this.ivars();
    return node;
  }
  ivars() {
    const n = this.long(), out = [];
    for (let i = 0; i < n; i++) { const k = this.symbol(); out.push([k, this.read()]); }
    return out;
  }
  read() {
    const t = String.fromCharCode(this.byte());
    switch (t) {
      case '0': return null;
      case 'T': return true;
      case 'F': return false;
      case 'i': return this.long();
      case ':': return this.symDef(false);
      case ';': return this.syms[this.long()];
      case '@': {
        const i = this.long();
        if (i >= this.objs.length) throw new Error(`Marshal: a link to object ${i} not yet read`);
        return this.objs[i];
      }
      case 'I': {
        if (this.b[this.p] === ch(':')) { this.p++; return this.symDef(true); }
        const node = this.read();
        node.I = this.ivars();
        return node;
      }
      case 'e': { const m = this.symbol(); const node = this.read(); node.ex = [m, ...(node.ex || [])]; return node; }
      case 'C': { const c = this.symbol(); const node = this.read(); node.uc = c; return node; }
      case '"': return this.reg({ t: '"', b: this.bytes() });
      case '/': { const node = this.reg({ t: '/', b: null, o: 0 }); node.b = this.bytes(); node.o = this.byte(); return node; }
      case 'f': return this.reg({ t: 'f', raw: this.bytes() });
      case 'l': {
        const node = this.reg({ t: 'l', sign: this.byte(), len: 0, b: null });
        node.len = this.long();
        node.b = this.b.slice(this.p, this.p + node.len * 2); this.p += node.len * 2;
        return node;
      }
      case '[': {
        const node = this.reg({ t: '[', a: [] });
        const n = this.long();
        for (let i = 0; i < n; i++) node.a.push(this.read());
        return node;
      }
      case '{': case '}': {
        const node = this.reg({ t: '{', e: [] });
        const n = this.long();
        for (let i = 0; i < n; i++) { const k = this.read(); node.e.push([k, this.read()]); }
        if (t === '}') node.d = this.read();
        return node;
      }
      case 'o': {
        const c = this.symbol();
        const node = this.reg({ t: 'o', c, iv: [] });
        node.iv = this.ivars();
        return node;
      }
      case 'S': {
        const c = this.symbol();
        const node = this.reg({ t: 'S', c, m: [] });
        node.m = this.ivars();
        return node;
      }
      case 'u': { const c = this.symbol(); return this.reg({ t: 'u', c, b: this.bytes() }); }
      case 'U': { const c = this.symbol(); const node = this.reg({ t: 'U', c, v: null }); node.v = this.read(); return node; }
      case 'd': { const c = this.symbol(); const node = this.reg({ t: 'd', c, v: null }); node.v = this.read(); return node; }
      case 'c': case 'm': case 'M': return this.reg({ t, b: this.bytes() });
      default: throw new Error(`Marshal: type '${t}' at ${this.p - 1}`);
    }
  }
}
// one Marshal.dump from pos: { root, end }
export function readTree(bytes, pos = 0) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[pos] !== 4 || b[pos + 1] !== 8) throw new Error('Marshal: not version 4.8');
  const r = new TreeReader(b, pos + 2);
  const root = r.read();
  return { root, end: r.p };
}

class TreeWriter {
  constructor() { this.buf = new Uint8Array(1 << 20); this.n = 0; this.syms = new Map(); this.objs = new Map(); }
  room(k) {
    if (this.n + k <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    nb.set(this.buf.subarray(0, this.n)); this.buf = nb;
  }
  byte(v) { this.room(1); this.buf[this.n++] = typeof v === 'string' ? ch(v) : v & 0xff; }
  raw(b) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  long(x) {
    if (x === 0) return this.byte(0);
    if (x > 0 && x < 123) return this.byte(x + 5);
    if (x < 0 && x > -124) return this.byte((x - 5) & 0xff);
    const out = [];
    for (let i = 1; i <= 4; i++) {
      out.push(x & 0xff);
      x = Math.floor(x / 256);
      if (x === 0) { this.byte(i); break; }
      if (x === -1) { this.byte(-i & 0xff); break; }
      if (i === 4) throw new Error('Marshal: a long out of range');
    }
    for (const v of out) this.byte(v);
  }
  bytes(b) { this.long(b.length); this.raw(b); }
  symbol(node) {
    const s = typeof node === 'string' ? node : node.s;
    if (this.syms.has(s)) { this.byte(';'); this.long(this.syms.get(s)); return; }
    const iv = typeof node === 'string' ? null : node.I;
    if (iv) this.byte('I');
    this.byte(':');
    this.bytes(Uint8Array.from(s, c => c.charCodeAt(0)));
    this.syms.set(s, this.syms.size);
    if (iv) this.ivars(iv);
  }
  ivars(list) { this.long(list.length); for (const [k, v] of list) { this.symbol(k); this.write(v); } }
  write(v) {
    if (v === null || v === undefined) return this.byte('0');
    if (v === true) return this.byte('T');
    if (v === false) return this.byte('F');
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= FIX_MIN && v <= FIX_MAX) { this.byte('i'); this.long(v); return; }
      return this.write(Number.isInteger(v) ? bignum(v) : float(v));
    }
    if (typeof v === 'string') return this.write(str(v));
    if (v.t === ':') return this.symbol(v);
    if (this.objs.has(v)) { this.byte('@'); this.long(this.objs.get(v)); return; }
    if (v.I) this.byte('I');
    for (const m of v.ex || []) { this.byte('e'); this.symbol(m); }
    if (v.uc) { this.byte('C'); this.symbol(v.uc); }
    this.objs.set(v, this.objs.size);
    this.byte(v.t === '{' && v.d !== undefined ? '}' : v.t);
    switch (v.t) {
      case '"': case 'c': case 'm': case 'M': this.bytes(v.b); break;
      case '/': this.bytes(v.b); this.byte(v.o); break;
      case 'f': this.bytes(v.raw); break;
      case 'l': this.byte(v.sign); this.long(v.len); this.raw(v.b); break;
      case '[': this.long(v.a.length); for (const x of v.a) this.write(x); break;
      case '{':
        this.long(v.e.length);
        for (const [k, x] of v.e) { this.write(k); this.write(x); }
        if (v.d !== undefined) this.write(v.d);
        break;
      case 'o': this.symbol(v.c); this.ivars(v.iv); break;
      case 'S': this.symbol(v.c); this.ivars(v.m); break;
      case 'u': this.symbol(v.c); this.bytes(v.b); break;
      case 'U': case 'd': this.symbol(v.c); this.write(v.v); break;
      default: throw new Error(`Marshal: cannot write '${v.t}'`);
    }
    if (v.I) this.ivars(v.I);
  }
}
// Marshal.dump of a tree (with its 4.8 head)
export function writeTree(root) {
  const w = new TreeWriter();
  w.byte(4); w.byte(8);
  w.write(root);
  return w.buf.slice(0, w.n);
}

// ------------------------------------------------------------------ making nodes
export const sym = s => ({ t: ':', s });
// a string as RGSS3 keeps one: UTF-8, its encoding an instance variable (E: true)
export function str(s) { return { t: '"', b: utf8.encode(String(s)), I: [[sym('E'), true]] }; }
const arr = a => ({ t: '[', a });
const hash = e => ({ t: '{', e });
function bignum(v) {
  let m = BigInt(Math.abs(v));
  const out = [];
  while (m > 0n) { out.push(Number(m & 0xffn)); m >>= 8n; }
  if (out.length % 2) out.push(0);
  return { t: 'l', sign: ch(v < 0 ? '-' : '+'), len: out.length / 2, b: Uint8Array.from(out) };
}
// a Float as Ruby 1.9's Marshal writes it (the shortest digits that read back the same)
function float(d) {
  let s;
  if (Number.isNaN(d)) s = 'nan';
  else if (!Number.isFinite(d)) s = d < 0 ? '-inf' : 'inf';
  else if (d === 0) s = Object.is(d, -0) ? '-0' : '0';
  else {
    const [mant, exp] = Math.abs(d).toExponential().split('e');
    const digits = mant.replace('.', ''), decpt = parseInt(exp, 10) + 1, n = digits.length;
    if (decpt < -3 || decpt > n) s = digits[0] + (n > 1 ? '.' + digits.slice(1) : '') + 'e' + (decpt - 1);
    else if (decpt > 0) s = digits.slice(0, decpt) + (n > decpt ? '.' + digits.slice(decpt) : '');
    else s = '0.' + '0'.repeat(-decpt) + digits;
    if (d < 0) s = '-' + s;
  }
  return { t: 'f', raw: utf8.encode(s) };
}
// RPG Maker's Tone / Color dump: four doubles (little-endian)
function tone4(r, g, b, x) {
  const dv = new DataView(new ArrayBuffer(32));
  [r, g, b, x].forEach((v, i) => dv.setFloat64(i * 8, +v || 0, true));
  return new Uint8Array(dv.buffer);
}

// ------------------------------------------------------------------ reading and changing the tree
const name = k => (k && k.t === ':' ? k.s : k);
// an object's instance variable ('@name')
export function iget(o, k) { const e = o?.iv?.find(([s]) => s.s === k); return e ? e[1] : undefined; }
export function iset(o, k, v) {
  const e = o.iv.find(([s]) => s.s === k);
  if (e) e[1] = v; else o.iv.push([sym(k), v]);
}
// a hash's value by a symbol key (the save's :system, :party...)
export function hget(h, k) { const e = h?.e?.find(([key]) => name(key) === k); return e ? e[1] : undefined; }
export function hset(h, k, v) { const e = h.e.find(([key]) => name(key) === k); if (e) e[1] = v; else h.e.push([sym(k), v]); }
// a string node's text
export function text(v) { return v && v.t === '"' ? new TextDecoder().decode(v.b) : v == null ? '' : String(v); }
// a copy of a part of the tree: links inside it keep pointing inside the copy (an actor's battle result knows its actor)
function clone(node, memo = new Map()) {
  if (node === null || typeof node !== 'object' || node.t === ':' || node.t === 'c' || node.t === 'm') return node;
  if (memo.has(node)) return memo.get(node);
  const out = { ...node };
  memo.set(node, out);
  if (node.I) out.I = node.I.map(([k, v]) => [k, clone(v, memo)]);
  if (node.a) out.a = node.a.map(v => clone(v, memo));
  if (node.e) out.e = node.e.map(([k, v]) => [clone(k, memo), clone(v, memo)]);
  if (node.d !== undefined) out.d = clone(node.d, memo);
  if (node.iv) out.iv = node.iv.map(([k, v]) => [k, clone(v, memo)]);
  if (node.m) out.m = node.m.map(([k, v]) => [k, clone(v, memo)]);
  if (node.v !== undefined) out.v = clone(node.v, memo);
  if (node.b instanceof Uint8Array) out.b = node.b.slice();
  return out;
}
// both Marshal.dumps of a save file: { header, contents }
export function readSave(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h = readTree(b, 0), c = readTree(b, h.end);
  if (c.end !== b.length) throw new Error('Marshal: bytes left after the contents');
  return { header: h.root, contents: c.root };
}
export function writeSave({ header, contents }) {
  const a = writeTree(header), b = writeTree(contents);
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// ------------------------------------------------------------------ the VR state into a template
// vr: GameState.toJSON(); template: the bytes of an original save. ctx: { versionId: the game's System version id,
// stateInfo(id) -> { minTurns, stepsToRemove } | null, isSpirit(actorId), spiritActorId(spiritId),
// mapAudio: { bgm, bgs } of the map the save is on ({ name, volume, pitch } or null - played as it loads) }
// -> the new save's bytes
export function exportRmSave(vr, template, ctx) {
  const save = readSave(template);
  const { header, contents } = save;
  const sys = hget(contents, 'system'), party = hget(contents, 'party'), player = hget(contents, 'player');
  const map = hget(contents, 'map'), actorsObj = hget(contents, 'actors');
  if (!sys || !party || !player || !map || !actorsObj) throw new Error('not an original save');
  const int = v => (Number.isFinite(+v) ? Math.trunc(+v) : 0);

  // switches, variables, self switches
  const swData = iget(hget(contents, 'switches'), '@data');
  if (swData?.t === '[') {
    const n = Math.max(swData.a.length, vr.switches?.length || 0);
    for (let i = 0; i < n; i++) {
      const on = !!vr.switches?.[i];
      if (on) swData.a[i] = true;
      else if (swData.a[i] !== undefined && swData.a[i] !== null) swData.a[i] = false;
      else swData.a[i] = null;
    }
  }
  const varData = iget(hget(contents, 'variables'), '@data');
  if (varData?.t === '[') {
    const n = Math.max(varData.a.length, vr.variables?.length || 0);
    for (let i = 0; i < n; i++) {
      const v = vr.variables?.[i], was = varData.a[i];
      // (what this version cannot hold - an array or hash a script keeps in a variable - read as 0: kept as it was)
      if ((v === 0 || v == null) && was && typeof was === 'object' && was.t !== '"' && was.t !== 'f' && was.t !== 'l') continue;
      varData.a[i] = v == null ? (was === undefined ? null : was === null ? null : 0) : typeof v === 'string' ? str(v) : typeof v === 'boolean' ? v : (Number.isFinite(v) ? v : 0);
    }
  }
  const ssData = iget(hget(contents, 'self_switches'), '@data');
  if (ssData?.t === '{') {
    ssData.e = (vr.selfSwitches || []).map(k => {
      const [m, e, c] = String(k).split(',');
      return [arr([int(m), int(e), str(c)]), true];
    });
  }

  // the party
  iset(party, '@gold', int(vr.party.gold));
  iset(party, '@steps', int(vr.party.steps));
  iset(party, '@actors', arr((vr.party.actors || []).map(int)));
  const bag = (key, list) => {
    const h = iget(party, key);
    const e = (list || []).filter(([, n]) => n > 0).map(([id, n]) => [int(id), int(n)]);
    if (h?.t === '{') h.e = e; else iset(party, key, hash(e));
  };
  bag('@items', vr.party.items); bag('@weapons', vr.party.weapons); bag('@armors', vr.party.armors);
  // (the storage - アイテム預かり所: only where the template's game has it)
  if (iget(party, '@items_k') !== undefined) {
    bag('@items_k', vr.party.kept?.item); bag('@weapons_k', vr.party.kept?.weapon); bag('@armors_k', vr.party.kept?.armor);
  }
  if (iget(party, '@spirits') !== undefined) iset(party, '@spirits', arr((vr.party.spirits || []).map(int)));
  const lead = int(vr.party.actors?.[0]);
  for (const k of ['@menu_actor_id', '@target_actor_id']) {
    if (iget(party, k) !== undefined && !(vr.party.actors || []).includes(iget(party, k))) iset(party, k, lead);
  }

  // the actors
  const data = iget(actorsObj, '@data');
  const vrActors = new Map((vr.actors || []).map(a => [a.id, a]));
  const parentOf = new Map();
  for (const a of vr.actors || []) for (const sid of a.partners || []) parentOf.set(ctx.spiritActorId(sid), a.id);
  const sample = spirit => data.a.find(n => n && n.t === 'o' && iget(n, '@is_spirit') === spirit) || data.a.find(n => n && n.t === 'o');
  const n = Math.max(data.a.length, ...[...vrActors.keys()].map(id => id + 1));
  for (let id = 0; id < n; id++) {
    const va = vrActors.get(id);
    // (one this VR game never made: made again by the original as it is first needed, as a new game's)
    if (!va) { if (data.a[id] !== undefined) data.a[id] = null; continue; }
    let o = data.a[id];
    if (!o || o.t !== 'o') {
      const src = sample(!!ctx.isSpirit(id));
      if (!src) continue;
      o = clone(src);
      // (what the game's setup gives a new actor by its id that the copy brought from another: 死亡時ボイス's voice - its own
      // id -, スキル忘れ's sealed skills - none -, no skill used last)
      if (iget(o, '@voice_id') !== undefined) iset(o, '@voice_id', id);
      if (iget(o, '@skill_seal') !== undefined) iset(o, '@skill_seal', arr([]));
      if (iget(o, '@last_skill') !== undefined) iset(o, '@last_skill', { t: 'o', c: sym('Game_BaseItem'), iv: [[sym('@class'), null], [sym('@item_id'), 0]] });
      if (iget(o, '@action_input_index') !== undefined) iset(o, '@action_input_index', 0);
      data.a[id] = o;
    }
    writeActor(o, id, va, ctx, parentOf.get(id) || 0);
  }
  while (data.a.length < n) data.a.push(null);

  // the system
  const vs = vr.system || {};
  // (left apart from the game's own: the original reads the map again as it loads - DataManager.reload_map_if_updated)
  iset(sys, '@version_id', ctx.versionId === 0 ? 1 : 0);
  for (const [k, v] of [['@save_disabled', vs.saveDisabled], ['@menu_disabled', vs.menuDisabled], ['@encounter_disabled', vs.encounterDisabled],
    ['@formation_disabled', vs.formationDisabled]]) if (iget(sys, k) !== undefined && v !== undefined) iset(sys, k, !!v);
  if (vs.saveCount != null) iset(sys, '@save_count', int(vs.saveCount));
  if (vs.battleCount != null) iset(sys, '@battle_count', int(vs.battleCount));
  if (vs.playFrames != null) iset(sys, '@frames_on_save', int(vs.playFrames));
  const wt = iget(sys, '@window_tone'), t = vs.windowTone;
  if (wt?.t === 'u' && t) wt.b = tone4(t.red, t.green, t.blue, t.gray);
  const recipes = iget(sys, '@w_rcp_sw');
  if (recipes?.t === '[' && Array.isArray(vs.recipes)) {
    const on = new Set(vs.recipes.map(int));
    const len = Math.max(recipes.a.length, ...[...on].map(i => i + 1));
    for (let i = 0; i < len; i++) recipes.a[i] = on.has(i) ? true : recipes.a[i] === true ? false : (recipes.a[i] ?? null);
  }
  const music = (key, m) => {
    const o = iget(sys, key);
    if (o?.t !== 'o') return;
    iset(o, '@name', str(m?.name || ''));
    if (m) { iset(o, '@volume', int(m.volume ?? 100)); iset(o, '@pitch', int(m.pitch ?? 100)); }
    if (iget(o, '@pos') !== undefined) iset(o, '@pos', 0);
  };
  // (what plays as it loads: the map's own music - the template's was where it was saved)
  music('@bgm_on_save', ctx.mapAudio?.bgm || null);
  music('@bgs_on_save', ctx.mapAudio?.bgs || null);
  const battleBgm = iget(sys, '@battle_bgm');
  if (vs.battleBgm && battleBgm?.t === 'o') { iset(battleBgm, '@name', str(vs.battleBgm.name || '')); iset(battleBgm, '@volume', int(vs.battleBgm.volume)); iset(battleBgm, '@pitch', int(vs.battleBgm.pitch)); }
  const timer = hget(contents, 'timer');
  if (timer?.t === 'o' && vs.timer) { iset(timer, '@count', int(vs.timer.count)); iset(timer, '@working', !!vs.timer.working); }

  // the map: the one the VR save is on, read again as it loads; nothing running in it, its screen plain
  iset(map, '@map_id', int(vr.mapId));
  clearInterpreter(iget(map, '@interpreter'));
  plainScreen(iget(map, '@screen'));

  // the player: where the VR save has it, as its leader looks
  const x = int(vr.start?.x), y = int(vr.start?.y);
  for (const [k, v] of [['@x', x], ['@y', y], ['@real_x', x], ['@real_y', y], ['@direction', int(vr.start?.dir) || 2]]) iset(player, k, v);
  if (vs.playerSpeed) iset(player, '@move_speed', int(vs.playerSpeed));
  const leader = vrActors.get(lead);
  if (leader) { iset(player, '@character_name', str(leader.characterName || '')); iset(player, '@character_index', int(leader.characterIndex)); }
  for (const k of ['@transferring', '@move_route_forcing', '@transparent', '@locked']) if (iget(player, k) !== undefined) iset(player, k, false);

  // the header the load screen shows: the party's pictures and the play time
  const members = (vr.party.actors || []).slice(0, 4).map(id => vrActors.get(id)).filter(Boolean);
  hset(header, 'characters', arr(members.map(a => arr([str(a.characterName || ''), int(a.characterIndex)]))));
  if (vs.playFrames != null) {
    const s = Math.floor(int(vs.playFrames) / 60);
    const p2 = v => String(v).padStart(2, '0');
    hset(header, 'playtime_s', str(`${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`));
  }
  return writeSave(save);
}

function writeActor(o, id, va, ctx, parentId) {
  const int = v => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
  iset(o, '@actor_id', id);
  for (const [k, v] of [['@name', va.name], ['@nickname', va.nickname], ['@character_name', va.characterName], ['@face_name', va.faceName]]) {
    if (v != null) iset(o, k, str(v));
  }
  for (const [k, v] of [['@class_id', va.classId], ['@level', va.level], ['@character_index', va.characterIndex], ['@face_index', va.faceIndex],
    ['@hp', va.hp], ['@mp', va.mp], ['@tp', va.tp || 0]]) if (v != null) iset(o, k, int(v));
  if (va.exp && typeof va.exp === 'object') iset(o, '@exp', hash(Object.entries(va.exp).map(([c, e]) => [int(c), int(e)])));
  if (Array.isArray(va.paramPlus)) iset(o, '@param_plus', arr(va.paramPlus.map(int)));
  if (Array.isArray(va.skills)) iset(o, '@skills', arr(va.skills.map(int)));
  if (Array.isArray(va.equips)) {
    const old = iget(o, '@equips');
    const cls = name => ({ t: 'c', b: utf8.encode(name) });
    iset(o, '@equips', arr(va.equips.map((e, slot) => {
      const prev = old?.t === '[' && old.a[slot]?.t === 'o' ? old.a[slot] : { t: 'o', c: sym('Game_BaseItem'), iv: [[sym('@class'), null], [sym('@item_id'), 0]] };
      const it = { ...prev, iv: prev.iv.map(([k, v]) => [k, v]) };
      iset(it, '@class', e?.id ? cls(e.kind === 'weapon' ? 'RPG::Weapon' : 'RPG::Armor') : null);
      iset(it, '@item_id', e?.id ? int(e.id) : 0);
      return it;
    })));
  }
  // states, with what wears them off (a state kept from the template keeps its count; a new one starts as the game starts one)
  if (Array.isArray(va.states)) {
    const states = va.states.map(int);
    iset(o, '@states', arr(states));
    for (const [k, fresh] of [['@state_turns', s => ctx.stateInfo?.(s)?.minTurns ?? 0], ['@state_steps', s => ctx.stateInfo?.(s)?.stepsToRemove ?? 0], ['@state_frames', null]]) {
      const h = iget(o, k);
      if (h?.t !== '{') continue;
      const kept = new Map(h.e.filter(([s]) => states.includes(s)));
      h.e = states.filter(s => kept.has(s) || fresh).map(s => [s, kept.has(s) ? kept.get(s) : fresh(s)]);
    }
  }
  // (out of battle: no buffs)
  const buffs = iget(o, '@buffs');
  if (buffs?.t === '[') buffs.a = buffs.a.map(() => 0);
  const bt = iget(o, '@buff_turns');
  if (bt?.t === '{') bt.e = [];
  // 誓約: the spirits sworn to it; a spirit's oath (whom it is sworn to) and its lock
  if (Array.isArray(va.partners)) iset(o, '@partners', arr(va.partners.filter(s => s > 0).map(int)));
  if (typeof va.maxSpirits === 'number' && iget(o, '@max_spirits') !== undefined) iset(o, '@max_spirits', int(va.maxSpirits));
  if (iget(o, '@partner_locked') !== undefined) iset(o, '@partner_locked', !!va.partnerLocked);
  if (iget(o, '@is_spirit') !== undefined) iset(o, '@is_spirit', !!ctx.isSpirit(id));
  if (iget(o, '@parent_id') !== undefined) iset(o, '@parent_id', ctx.isSpirit(id) ? parentId : 0);
}

// Game_Interpreter (its marshal_dump: [depth, map id, event id, list, index + 1, branch]): with no list, nothing runs
function clearInterpreter(it) {
  if (it?.t !== 'U' || it.v?.t !== '[' || it.v.a.length < 6) return;
  it.v.a[1] = 0; it.v.a[2] = 0; it.v.a[3] = null; it.v.a[4] = 0; it.v.a[5] = hash([]);
}
// Game_Screen as a map is entered: lit, no tint, flash, shake or weather, no pictures shown
function plainScreen(s) {
  if (s?.t !== 'o') return;
  for (const [k, v] of [['@brightness', 255], ['@fadeout_duration', 0], ['@fadein_duration', 0], ['@tone_duration', 0], ['@flash_duration', 0],
    ['@shake_power', 0], ['@shake_duration', 0], ['@shake', 0], ['@weather_power', 0], ['@weather_power_target', 0], ['@weather_duration', 0]]) {
    if (iget(s, k) !== undefined) iset(s, k, v);
  }
  if (iget(s, '@weather_type') !== undefined) iset(s, '@weather_type', sym('none'));
  for (const k of ['@tone', '@tone_target']) { const t = iget(s, k); if (t?.t === 'u') t.b = tone4(0, 0, 0, 0); }
  const pics = iget(iget(s, '@pictures'), '@data');
  if (pics?.t === '[') for (const p of pics.a) if (p?.t === 'o' && iget(p, '@name') !== undefined) { iset(p, '@name', str('')); if (iget(p, '@origin') !== undefined) iset(p, '@origin', 0); }
}
