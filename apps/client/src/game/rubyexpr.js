// Tiny Ruby -> JS translator for the script calls used by event commands
// (355 Script, 111 Conditional Branch "script", 122 Control Variables "script",
//  move route "script", damage formulas). Unknown names resolve through a sandbox scope.
import { G, SCENE_REQUESTS } from '../core/globals.js';
import { $data } from '../data/data.js';

const cache = new Map();

const METHOD_RENAMES = {
  'include?': 'includes', 'state?': 'isState', 'empty?': '__empty', 'nil?': '__nil',
  'zero?': '__zero', 'dead?': '__dead', 'alive?': '__alive', 'exist?': '__exist', 'equips': 'equipsList',
};
const POSTFIX = new Set(['ceil', 'floor', 'round', 'to_i', 'to_f', 'abs', 'to_s', 'min', 'max', 'sum', 'size', 'length', 'first', 'last', 'sample', 'empty?', 'zero?', 'nil?']);

// Find the operand ending right before position `end` (exclusive) in s
function operandStart(s, end) {
  let i = end - 1;
  const closeOpen = { ')': '(', ']': '[' };
  while (i >= 0) {
    const ch = s[i];
    if (closeOpen[ch]) {
      let depth = 0;
      for (; i >= 0; i--) {
        if (s[i] === ch) depth++;
        else if (s[i] === closeOpen[ch]) { depth--; if (depth === 0) break; }
      }
      i--;
      continue;
    }
    if (/[\w$.@]/.test(ch)) { i--; continue; }
    break;
  }
  return i + 1;
}

function rewritePostfix(s) {
  // repeatedly rewrite `<operand>.method` (no parens) into function form
  for (let guard = 0; guard < 200; guard++) {
    const m = /\.(ceil|floor|round|to_i|to_f|abs|to_s|min|max|sum|size|length|first|last|sample|empty\?|zero\?|nil\?)(?![\w?(])/.exec(s);
    if (!m) break;
    const start = operandStart(s, m.index);
    const operand = s.slice(start, m.index);
    const fn = '__' + m[1].replace('?', '_q');
    s = s.slice(0, start) + `${fn}(${operand})` + s.slice(m.index + m[0].length);
  }
  return s;
}

export function translateRuby(src) {
  const out = [];
  for (let raw of String(src).split(/\r?\n/)) {
    // strip comments (not inside strings)
    let line = '', q = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) { line += c; if (c === q && raw[i - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'") { q = c; line += c; continue; }
      if (c === '#') break;
      line += c;
    }
    line = line.replace(/\s+$/, '');
    if (!line.trim()) continue;
    line = line.replace(/\b([A-Z]\w*)::(\w+)/g, '$1.$2');
    line = line.replace(/\bnil\b/g, 'null');
    line = line.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!');
    line = line.replace(/\.(\w+\?)/g, (m, name) => '.' + (METHOD_RENAMES[name] || name.replace('?', '_q')));
    line = line.replace(/"([^"]*?)#\{([^}]*)\}([^"]*)"/g, '`$1${$2}$3`');
    line = rewritePostfix(line);
    const t = line.trim();
    let mm;
    if ((mm = /^if\s+(.+?)(\s+then)?$/.exec(t))) { out.push(`if (${mm[1]}) {`); continue; }
    if ((mm = /^unless\s+(.+)$/.exec(t))) { out.push(`if (!(${mm[1]})) {`); continue; }
    if ((mm = /^elsif\s+(.+)$/.exec(t))) { out.push(`} else if (${mm[1]}) {`); continue; }
    if (t === 'else') { out.push('} else {'); continue; }
    if (t === 'end') { out.push('}'); continue; }
    if ((mm = /^(.*\S)\s+if\s+(.+)$/.exec(t)) && !/[?:]\s*$/.test(mm[1])) { out.push(`if (${mm[2]}) { ${mm[1]}; }`); continue; }
    if ((mm = /^(.*\S)\s+unless\s+(.+)$/.exec(t))) { out.push(`if (!(${mm[2]})) { ${mm[1]}; }`); continue; }
    if (/^[a-z_]\w*$/.test(t) && !['true', 'false', 'null', 'break', 'next'].includes(t)) { out.push(`${t}()`); continue; }
    out.push(line);
  }
  return out.join('\n');
}

// --- sandbox -------------------------------------------------------------------------
function makeArrayProxy(getFn, setFn) {
  return new Proxy({}, {
    get: (_, k) => (k === Symbol.toPrimitive ? undefined : getFn(k)),
    set: (_, k, v) => { setFn(k, v); return true; },
  });
}

let helpers = null;
function buildHelpers() {
  const st = () => G.state;
  const charProxy = c => c && ({
    get x() { return c.x; }, get y() { return c.y; }, get direction() { return c.direction; },
    get id() { return c.id; }, moveto: (x, y) => c.moveto?.(x, y), set_direction: d => c.setDirection?.(d),
    get screen_x() { return 0; }, get screen_y() { return 0; },
  });
  const h = {
    __min: a => (Array.isArray(a) ? Math.min(...a) : a), __max: a => (Array.isArray(a) ? Math.max(...a) : a),
    __sum: a => a.reduce((x, y) => x + y, 0), __size: a => a?.length ?? 0, __length: a => a?.length ?? 0,
    __first: a => a?.[0], __last: a => a?.[a.length - 1], __sample: a => a?.[Math.floor(Math.random() * a.length)],
    __ceil: Math.ceil, __floor: Math.floor, __round: Math.round, __to_i: x => Math.trunc(+x || 0),
    __to_f: x => +x || 0, __abs: Math.abs, __to_s: x => String(x), __empty_q: a => !a || a.length === 0,
    __zero_q: x => x === 0, __nil_q: x => x == null,
    rand: n => (n ? Math.floor(Math.random() * n) : Math.random()),
    p: (...a) => console.log('[ruby p]', ...a), print: (...a) => console.log('[ruby]', ...a), msgbox: (...a) => console.log('[ruby]', ...a),
    RPG: { Item: 'item', Weapon: 'weapon', Armor: 'armor', Skill: 'skill' },
    Math, Integer: { MAX: 2 ** 31 }, Float: { INFINITY: Infinity },
    get $game_variables() { return makeArrayProxy(k => st().v(+k), (k, v) => st().setV(+k, v)); },
    get $game_switches() { return makeArrayProxy(k => st().sw(+k), (k, v) => st().setSw(+k, v)); },
    get $game_self_switches() {
      return makeArrayProxy(k => { const [m, e, c] = String(k).split(','); return st().selfSw(+m, +e, c); },
        (k, v) => { const [m, e, c] = String(k).split(','); st().setSelfSw(+m, +e, c, v); });
    },
    get $game_actors() { return makeArrayProxy(k => st().actor(+k), () => {}); },
    get $game_party() {
      const p = st().party;
      return new Proxy(p, {
        get: (t, k) => {
          if (k === 'members') return p.members();
          if (k === 'leader') return p.leader();
          if (k === 'item_number') return item => p.itemCount(itemKind(item), item?.id);
          if (k === 'has_item_q') return (item, inc) => p.hasItem(itemKind(item), item?.id, inc);
          if (k === 'lose_item') return (item, n) => p.gainItem(itemKind(item), item?.id, -n);
          if (k === 'lose_gold') return n => p.gainGold(-n);
          if (k === 'gain_gold') return n => p.gainGold(n);
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    },
    get $game_map() {
      const m = G.map;
      return {
        get map_id() { return m?.mapId; }, get width() { return m?.width; }, get height() { return m?.height; },
        events: makeArrayProxy(k => charProxy(m?.events[+k]), () => {}),
        region_id: (x, y) => m?.grid.region(x, y) ?? 0,
        set need_refresh(v) { m?.requestRefresh(); },
        get interpreter() { return m?.interpreter; },
      };
    },
    get $game_player() { return charProxy(G.map?.playerChar); },
    get $game_system() { return st().system; },
    get $game_temp() {
      return {
        // (script 141: the cool-downs of the player's / the enemies' skills n turns shorter - 토끼의 회중시계, 정신 통일)
        actor_loss_cool_time: (n = 1) => G.combat?.lossCoolTime('actor', n),
        enemy_loss_cool_time: (n = 1) => G.combat?.lossCoolTime('enemy', n),
        reserve_common_event: id => G.map?.reserveCommonEvent(id),
      };
    },
    get $game_message() { return G.ui?.message || {}; },
    get $game_timer() { return { get sec() { return Math.floor(st().system.timer.count / 60); } }; },
    get $data_items() { return $data.items; }, get $data_weapons() { return $data.weapons; },
    get $data_armors() { return $data.armors; }, get $data_skills() { return $data.skills; },
    get $data_states() { return $data.states; }, get $data_actors() { return $data.actors; },
    get $data_enemies() { return $data.enemies; }, get $data_classes() { return $data.classes; },
    SceneManager: { call: name => SCENE_REQUESTS.push(String(name)), goto: name => SCENE_REQUESTS.push(String(name)) },
    // 誓約 (the oath system): swear / end / lock an oath (spirit) of an actor
    Spirits: {
      add_partner: (aid, sid) => st().swearOath(aid, sid),
      remove_partner: (aid, sid) => st().breakOath(aid, sid),
      lock_partner: sid => st().lockOath(sid, true),
      unlock_partner: sid => st().lockOath(sid, false),
    },
    Audio: { se_play() {}, bgm_play() {}, bgs_play() {}, me_play() {} },
    // custom script entry points used by BLACKSOULS II events
    enable_symbol_encount: id => ({ __symbol: id }),
    reset_stealth: () => { st().system.stealthSteps = 0; },
    set_number_range: (min, max) => { if (G.ui) G.ui.numberRange = [min, max]; },
    w_recipe_switch_on: id => { if (!st().system.recipes.includes(id)) st().system.recipes.push(id); },
    recipe_all_switch_on: () => { st().system.recipesAll = true; },
    adv_self_switches: (m, e, c, v) => {
      if (m === 'all' && e === 'all' && c === 'all' && !v) { st().selfSwitches.clear(); G.map?.requestRefresh(); }
    },
    call_keep: () => SCENE_REQUESTS.push('Scene_Keep'),
    // the storage script's other commands: how many of a thing are kept (into a variable), as much as can go in
    // (0) or out (1) of one thing, of a kind, of everything with a word in its note
    item_keep_get: (vid, id) => st().setV(vid, st().party.keptCount('item', id)),
    weapon_keep_get: (vid, id) => st().setV(vid, st().party.keptCount('weapon', id)),
    armor_keep_get: (vid, id) => st().setV(vid, st().party.keptCount('armor', id)),
    item_keep: (a, b) => st().party.keepAsMuch('item', b, a),
    weapon_keep: (a, b) => st().party.keepAsMuch('weapon', b, a),
    armor_keep: (a, b) => st().party.keepAsMuch('armor', b, a),
    item_keep_all: a => st().party.keepAll('item', a),
    weapon_keep_all: a => st().party.keepAll('weapon', a),
    armor_keep_all: a => st().party.keepAll('armor', a),
    word_keep_all: (a, w) => { for (const k of ['item', 'weapon', 'armor']) st().party.keepAll(k, a, String(w)); },
    get_region_id: () => G.map?.playerRegion() ?? 0,
  };
  // visual-effect toggles from the original scripts: harmless no-ops (or mapped to fog/tone later)
  for (const n of ['brain_noise_start', 'brain_noise_stop', 'rich_fog_start', 'rich_fog_stop', 'rich_sunshine_start',
    'rich_sunshine_stop', 'start_noise', 'end_noise', 'start_fallen_leaves', 'end_fallen_leaves', 'start_signal',
    'end_signal', 'ancient_light', 'screen_noise_start', 'screen_noise_stop']) {
    h[n] = (...a) => G.screen?.effectHook?.(n, a);
  }
  return h;
}

function itemKind(item) {
  const c = item?.__class || '';
  return c === 'RPG::Weapon' ? 'weapon' : c === 'RPG::Armor' ? 'armor' : 'item';
}

function makeScope(extra) {
  helpers ||= buildHelpers();
  const locals = Object.create(null);
  return new Proxy(locals, {
    has: () => true,
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (extra && k in extra) return extra[k];
      if (k in t) return t[k];
      if (k in helpers) return helpers[k];
      if (k in globalThis) return globalThis[k];
      if (typeof k === 'string' && /^Scene_/.test(k)) return k;
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function compile(src, mode) {
  const key = mode + '\u0000' + src;
  if (cache.has(key)) return cache.get(key);
  let fn = null;
  const js = translateRuby(src);
  try {
    if (mode === 'expr') {
      // value of the last statement
      const lines = js.split('\n').filter(l => l.trim());
      const last = lines.pop() || 'null';
      const body = lines.join('\n') + `\nreturn (${last});`;
      // eslint-disable-next-line no-new-func
      fn = new Function('__s', `with (__s) { ${body} }`);
    } else {
      // eslint-disable-next-line no-new-func
      fn = new Function('__s', `with (__s) { ${js} }`);
    }
  } catch (e) {
    console.warn('[ruby] cannot compile:', src, '\n->', js, e.message);
    fn = null;
  }
  cache.set(key, fn);
  return fn;
}

export function runRuby(src, extra) {
  const fn = compile(src, 'stmt');
  if (!fn) return undefined;
  try { return fn(makeScope(extra)); } catch (e) { console.warn('[ruby] error:', src, e.message); return undefined; }
}

export function evalRuby(src, extra) {
  const fn = compile(src, 'expr');
  if (!fn) return undefined;
  try { return fn(makeScope(extra)); } catch (e) { console.warn('[ruby] error:', src, e.message); return undefined; }
}

// Damage formula: a = user, b = target, v = variables
export function evalFormula(formula, a, b) {
  const v = makeArrayProxy(k => G.state.v(+k), () => {});
  const r = evalRuby(formula, { a, b, v });
  return Number.isFinite(+r) ? +r : 0;
}
