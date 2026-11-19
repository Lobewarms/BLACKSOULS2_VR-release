// The player's own rules: made in the rule editor (mapedit.html - 맵 · 동료 · 적; the launcher's 규칙 편집기) and kept in the
// saves folder as user_rules.json (GET / POST /api/userrules - server.py, the launcher). They come before BLACK SOULS II's own
// (maphints.js, allies.js LOOK, combat/common.js HOLDS_PLACE) and before the general rules, for whatever game is played - the
// launcher's switch for the game's own fixes on or off:
//   maps:       { "<map id>": { ...that map's rules, as maphints.js writes them... } } - all of that map's rules (an empty {}:
//               none - the general rules alone)
//   companions: { "<actor id>": { book | battler | face | chip, wall, with } } - how that companion looks, as allies.js LOOK
//               writes it (none of the four: the general rule's look); wall: it stands as a wall that tall (metres), where it
//               was called up; with: the actors that are one body with it
//   enemies:    { "<enemy id>": { holdPlace: true | false } } - it holds its place in a fight (never walks, never knocked back),
//               or it does not
//   weapons, armors: { "<id>": { features: [{ code, data_id, value }, ...], params: [8 numbers], note, description } } - what
//               the rule changes in that equipment (any of them; itemrules.js puts it over the game's own data)
//   skills:     { "<id>": { effects: [{ code, data_id, value1, value2 }, ...], damage: { type, element_id, formula, variance,
//               critical }, hit_type, success_rate, repeats, mp_cost, tp_cost, note, description, vr } } - the same for a skill;
//               vr: { pattern, style, look, color, blink, points, shot } - what the port makes of that skill (skilljudge.js,
//               SKILL_VR): the boss move it is, how an enemy's use of it goes and shows, its colour, a boss's quick step
//               after it, the points of a star of lines, its shot's look - by the skill's number, for any game
// Read as the game starts and again on going into another map (main.js), and when the editor saves in this browser (the
// USER_RULES_CHANNEL).
export const USER_RULES_API = '/api/userrules';
export const USER_RULES_FILE = 'saves/user_rules.json';           // (where the servers keep them - told on the editor's page)
export const USER_RULES_CHANNEL = 'bsvr-userrules';
export const RULE_KINDS = ['maps', 'companions', 'enemies', 'weapons', 'armors', 'skills'];
const ITEM_RULE_KINDS = ['weapons', 'armors', 'skills'];
// what a skill's vr may say (skilljudge.js): pattern - the boss move ('none': none of its own); style - an enemy's use of it
// ('wait' none, 'melee', 'projectile', 'area'); look - what flies ('none', 'lob' an arc, 'gun', 'knife', 'death', 'drain');
// color - the colour of what it carries; blink - a boss steps away after it (a skill on itself); points - a star of lines;
// shot - what its shot looks like in flight (combat/shotlooks.js SHOT_STYLES)
export const SKILL_VR = {
  pattern: ['none', 'charge', 'leap', 'fissure', 'quake', 'roar', 'breath', 'spin', 'wave', 'cross', 'grab', 'execute', 'rain', 'volley',
    'field', 'thrust', 'sweep', 'starSpin', 'lattice', 'stripes', 'farOrb', 'blinkChain', 'cloakLeap', 'flurry', 'orbs', 'pursuit', 'nova'],
  style: ['wait', 'melee', 'projectile', 'area'],
  look: ['none', 'lob', 'gun', 'knife', 'death', 'drain'],
  color: ['none', 'fire', 'ice', 'thunder', 'poison', 'bleed', 'sleep', 'dark', 'holy', 'pink', 'blaze', 'oil'],
  blink: [true, false],
  points: [4, 5, 6],
  shot: ['bullet', 'knife', 'fire', 'ice', 'thunder', 'dark', 'holy', 'soul', 'poison', 'water', 'wind', 'blood', 'earth', 'arcane'],
};

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isName = v => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isIndex = v => Number.isInteger(v) && v >= 0 && v < 1000;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isText = (v, n) => typeof v === 'string' && v.length <= n;

// an item's rule (weapons / armors / skills) as kept: each field it gives, in its shape - anything else left out (a list with
// one row not in its shape: the whole list - never half of an item's features, the rest wiped)
const isEffect = f => isObj(f) && isInt(f.code, 1, 99) && isInt(f.data_id, -1, 9999) && isNum(f.value1) && isNum(f.value2);
const isFeature = f => isObj(f) && isInt(f.code, 1, 99) && isInt(f.data_id, -1, 9999) && isNum(f.value);
function cleanItem(kind, e) {
  const out = {};
  if (kind === 'skills') {
    if (Array.isArray(e.effects) && e.effects.length <= 64 && e.effects.every(isEffect)) {
      out.effects = e.effects.map(f => ({ code: f.code, data_id: f.data_id, value1: f.value1, value2: f.value2 }));
    }
    if (isObj(e.damage)) {
      const d = e.damage, dd = {};
      if (isInt(d.type, 0, 6)) dd.type = d.type;
      if (isInt(d.element_id, -1, 999)) dd.element_id = d.element_id;
      if (isText(d.formula, 400)) dd.formula = d.formula;
      if (isInt(d.variance, 0, 100)) dd.variance = d.variance;
      if (typeof d.critical === 'boolean') dd.critical = d.critical;
      if (Object.keys(dd).length) out.damage = dd;
    }
    for (const [f, lo, hi] of [['hit_type', 0, 2], ['success_rate', 0, 100], ['repeats', 1, 9], ['mp_cost', 0, 9999], ['tp_cost', 0, 100]]) if (isInt(e[f], lo, hi)) out[f] = e[f];
    if (isObj(e.vr)) {
      const vr = {};
      for (const [f, allowed] of Object.entries(SKILL_VR)) if (allowed.includes(e.vr[f])) vr[f] = e.vr[f];
      if (Object.keys(vr).length) out.vr = vr;
    }
  } else {
    if (Array.isArray(e.features) && e.features.length <= 64 && e.features.every(isFeature)) {
      out.features = e.features.map(f => ({ code: f.code, data_id: f.data_id, value: f.value }));
    }
    if (Array.isArray(e.params) && e.params.length === 8 && e.params.every(v => isInt(v, -999999, 999999))) out.params = e.params.slice();
  }
  for (const f of ['note', 'description']) if (isText(e[f], 4000)) out[f] = e[f];
  return out;
}

// rules as read: each kind an object of numbered entries, each an object (anything else left out; an item's as cleanItem keeps it)
export function cleanRules(raw) {
  const out = Object.fromEntries(RULE_KINDS.map(k => [k, {}]));
  if (!isObj(raw)) return out;
  for (const kind of RULE_KINDS) {
    if (!isObj(raw[kind])) continue;
    for (const [id, e] of Object.entries(raw[kind])) {
      if (!/^\d+$/.test(id) || !(+id > 0) || !isObj(e)) continue;
      if (!ITEM_RULE_KINDS.includes(kind)) { out[kind][id] = e; continue; }
      const c = cleanItem(kind, e);
      if (Object.keys(c).length) out[kind][id] = c;
    }
  }
  return out;
}

let rules = cleanRules(null);
const looks = new Map();                  // actor id -> its look made from the player's rule (once per reading)
export const userRules = () => rules;
// one more each time the rules are read again (what was worked out from them is worked out anew - skilljudge.js)
export let rulesVersion = 0;

// -> the rules read (null: they could not be read - those in use stay)
export async function loadUserRules() {
  try {
    const r = await fetch(USER_RULES_API, { cache: 'no-store' });
    if (!r.ok) return null;
    setUserRules(await r.json());
    return rules;
  } catch { return null; }
}
export function setUserRules(raw) { rules = cleanRules(raw); looks.clear(); rulesVersion++; }

// a companion's look by the player's rule (as allies.js LOOK has one), or null - the first of its pictures that is given:
// book [[picture, metres aside, metres back], ...], battler, face [name, index], chip [name, index]
export function userCompanion(id) {
  if (looks.has(+id)) return looks.get(+id);
  const e = rules.companions[id];
  let L = null;
  if (e) {
    L = {};
    const book = Array.isArray(e.book) ? e.book.filter(p => Array.isArray(p) && isName(p[0])).map(([n, side, back]) => [n, +side || 0, +back || 0]) : [];
    if (book.length) L.book = book;
    else if (isName(e.battler)) L.battler = e.battler;
    else if (Array.isArray(e.face) && isName(e.face[0])) L.face = [e.face[0], isIndex(e.face[1]) ? e.face[1] : 0];
    else if (Array.isArray(e.chip) && isName(e.chip[0])) L.chip = [e.chip[0], isIndex(e.chip[1]) ? e.chip[1] : 0];
    if (Number.isFinite(e.wall) && e.wall > 0) L.wall = Math.min(e.wall, 10);
    const w = Array.isArray(e.with) ? e.with.filter(n => Number.isInteger(n) && n > 0 && n !== +id) : [];
    if (w.length) L.with = [...new Set(w)];
  }
  looks.set(+id, L);
  return L;
}
// the actors some companion's rule makes one body with it (allies.js hostOf)
export function userCompanionIds() { return Object.keys(rules.companions).map(Number); }

// whether an enemy holds its place by the player's rule: true / false, or null - no rule of theirs for it
export function userHoldsPlace(enemyId) {
  const e = rules.enemies[enemyId];
  return e && typeof e.holdPlace === 'boolean' ? e.holdPlace : null;
}

// the rules as the file keeps them: every kind, its entries by number, one key a line at the top (the editor sends this)
export function rulesText(r) {
  const sorted = o => Object.fromEntries(Object.keys(o || {}).sort((a, b) => a - b).map(k => [k, o[k]]));
  return JSON.stringify(Object.fromEntries(RULE_KINDS.map(k => [k, sorted(r?.[k])])), null, 1) + '\n';
}
