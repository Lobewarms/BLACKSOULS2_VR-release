// What the port makes of the game's skills, items, states, common events and choices - always by their numbers and the
// database's own fields, never by their names or words (those change with every language and every translation):
//   1. the player's own rule for that number (the rule editor - userrules.js skills[...].vr), for any game;
//   2. BLACK SOULS II's own, by its numbers (bs2ids.js), while the launcher's switch for the game's own fixes is on
//      (maphints.js builtinRules) - its Break and co-op's common events and YOU DIED also while the database has the game's
//      number of common events (they never followed the switch);
//   3. else the database's own fields alone: a skill's scope, hit type, damage, repeats, element.
// Used by the fight (combat/*.js, bossmoves.js), co-op (coop*.js), the interpreter's kill choice, and the rule editor (what a
// skill does by default, beside the player's own).
import { $data } from './data.js';
import { builtinRules } from './maphints.js';
import { userRules, rulesVersion, SKILL_VR } from './userrules.js';
import { SKILLS, LINDA, LOOK, FLAVOR_STATES, BREAK, GUN_BREAK, KNIFE, UNBREAKABLE_STATES, KILL_CHOICES, DICE_FACE, SHOT_LOOK, YOU_DIED, BANNERS,
  COMMON_EVENTS } from './bs2ids.js';

const sets = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
const W = sets(SKILLS), FL = sets(FLAVOR_STATES);
const byKind = t => ({ skill: new Set(t.skills), item: new Set(t.items) });
const BRK = byKind(BREAK), GUN = byKind(GUN_BREAK), KNF = byKind(KNIFE);
const UNBREAK = new Set(UNBREAKABLE_STATES);
const CE = sets({ scene: COMMON_EVENTS.scene, death: COMMON_EVENTS.death, bonfire: COMMON_EVENTS.bonfire, trapDeath: COMMON_EVENTS.trapDeath });
const NONE = new Set();

const bs2 = () => builtinRules();
// BLACK SOULS II's numbers that do not follow the switch (Break, co-op's common events and its YOU DIED - as before; whether
// they should is the user's to say): while it is on, or while the database has the game's number of common events
const bs2Always = () => bs2() || bs2CommonEvents();
const w = (key, s) => bs2() && W[key].has(s.id);
// an item or a skill (the two have numbers of their own)
const kindOf = o => (o?.__class === 'RPG::Item' || (o && 'itype_id' in o) ? 'item' : 'skill');
// the player's own rule for a skill (or undefined)
export const skillRule = id => userRules().skills?.[id]?.vr;
const own = (s, f, u) => (u && s ? skillRule(s.id)?.[f] : undefined);
// (worked out again when the rules are read again or the switch changes)
const stamp = () => `${rulesVersion}|${bs2() ? 1 : 0}`;
const memo = new WeakMap();
const remember = (s, key, u, make) => {
  if (!s || typeof s !== 'object') return make();
  let m = memo.get(s);
  if (!m || m.at !== stamp()) memo.set(s, (m = { at: stamp() }));
  const k = key + (u ? '' : '0');
  return k in m ? m[k] : (m[k] = make());
};

// ---- colours: elements (the database's element numbers - VX Ace's own) and the ones a rule names
const EL = { 2: 0xff5fd0, 3: 0xff7a28, 4: 0x9fe8ff, 5: 0xfff27a, 8: 0x7a9cff, 9: 0xffe9a8, 10: 0x9a4cff, 11: 0xd01830, 12: 0xff4a1a, 15: 0xfff27a, 18: 0x6fe05a };
export const COLORS = { fire: EL[3], ice: EL[4], thunder: EL[5], poison: EL[18], bleed: EL[11], sleep: EL[8], dark: EL[10], holy: EL[9], pink: EL[2],
  blaze: EL[12], oil: 0x9a7a3a };
const FLAVOR = [['burn', COLORS.fire], ['frost', COLORS.ice], ['poison', COLORS.poison], ['bleed', COLORS.bleed], ['sleep', COLORS.sleep],
  ['fear', COLORS.dark], ['stun', COLORS.thunder], ['oil', COLORS.oil]];

// ---- how an enemy's skill shows: 'lob' (an arc onto where the player stood), 'gun', 'knife', 'death', 'drain', or null
function look(s, u) {
  if (!s) return null;
  const r = own(s, 'look', u);
  if (r !== undefined) return r === 'none' ? null : r;
  return bs2() ? LOOK[s.id] || null : null;
}
export const skillLook = s => look(s, true);

// ---- the colour of what a skill carries: the rule's, else its element (a death spell's dark), else the states it brings
function flavor(s, u) {
  if (!s) return null;
  const r = own(s, 'color', u);
  if (r !== undefined) return r === 'none' ? null : COLORS[r] ?? null;
  let c = look(s, u) === 'death' ? EL[10] : EL[s.damage?.element_id];
  if (!c && bs2()) {
    const brings = (s.effects || []).filter(f => f.code === 21 && f.data_id > 1).map(f => f.data_id);
    c = FLAVOR.find(([k]) => brings.some(id => FL[k].has(id)))?.[1];
  }
  return c || null;
}
export const skillFlavor = s => flavor(s, true);

// ---- an enemy's use of a skill: 'wait' (VX Ace's 7, 様子を見る), 'guard' (2), 'heal' / 'buff' (on its side), 'debuff', or a
// blow: 'projectile' (magic, a shot), 'area' (all), 'melee'
function style(skill, u) {
  const r = own(skill, 'style', u);
  if (r !== undefined) return r;
  if (!skill || skill.id === 7 || w('wait', skill)) return 'wait';
  if (skill.id === 2) return 'guard';
  const dmg = skill.damage?.type;
  if (skill.scope >= 7 && skill.scope <= 11) return dmg === 3 ? 'heal' : 'buff';
  if (dmg !== 1 && dmg !== 2 && dmg !== 5 && dmg !== 6) return skill.scope >= 1 && skill.scope <= 6 ? 'debuff' : 'wait';
  if (skill.hit_type === 2 || ['gun', 'knife'].includes(look(skill, u)) || w('shot', skill)) return 'projectile';
  if (skill.scope === 2) return 'area';
  return 'melee';
}
export const skillStyle = skill => style(skill, true);
export const skillHits = skill => Math.min(Math.max((skill.repeats || 1) * ({ 3: 1, 4: 2, 5: 3, 6: 4 }[skill.scope] || 1), 1), 6);

// ---- the boss move a skill is (combat/bossacts.js planBossMove, bossmoves.js planNewMove), or null
const LINDA_FAMILY = { lance: 'blinkChain', void: 'lattice', punish: 'stripes', blackLight: 'starSpin', sanction: 'blinkChain', noah: 'farOrb' };
function family(s, u) {
  if (!s) return null;
  const r = own(s, 'pattern', u);
  if (r !== undefined) return r === 'none' ? null : r;
  return remember(s, 'fam', u, () => {
    // BLACK SOULS II's own: a leap over the player in a cloak (뛰어넘기), 흑기사 린다메아's six
    if (bs2()) {
      if (s.scope === 11 && W.cloakLeap.has(s.id)) return 'cloakLeap';
      const k = LINDA[s.id];
      if (k && s.scope >= 1 && s.scope <= 6) return LINDA_FAMILY[k];
    }
    if (!(s.scope >= 1 && s.scope <= 6 && (s.damage?.type === 1 || s.damage?.type === 5))) return null;
    const st = style(s, u), hits = skillHits(s), many = s.scope >= 2 && s.scope <= 6;
    const atk = +(/a\.atk\s*\*\s*([\d.]+)/.exec(s.damage.formula || '')?.[1] || 0);
    const magic = s.hit_type === 2;
    // (BLACK SOULS II's skills by what they are - bs2ids.js)
    if (w('charge', s)) return 'charge';
    if (w('leap', s)) return 'leap';
    if (w('fissure', s)) return 'fissure';
    if (w('quake', s)) return 'quake';
    if (w('roar', s)) return 'roar';
    if (w('breath', s)) return 'breath';
    if (w('spin', s)) return 'spin';
    if (w('wave', s)) return 'wave';
    if (w('cross', s)) return 'cross';
    if (w('grab', s)) return 'grab';
    if (w('bite', s) && atk >= 10) return 'charge';
    if (w('execute', s)) return 'execute';
    if (w('rain', s) && st !== 'melee') return 'rain';
    if (w('volley', s)) return 'volley';
    if (s.scope !== 1 && (w('fog', s) || (bs2() && (s.effects || []).some(ef => ef.code === 21 && (ef.data_id === 2 || ef.data_id === 3))))) return 'field';
    if (w('thrust', s) && st === 'melee' && s.scope === 1) return 'thrust';
    if (w('sweep', s) && !magic) return 'sweep';
    if (s.scope === 1 && w('beam', s)) return 'starSpin';
    if (w('lattice', s)) return 'lattice';
    if (many && (magic || s.hit_type === 0) && w('storm', s)) return 'starSpin';
    if (many && hits >= 2 && !magic && w('blades', s)) return 'stripes';
    if ((magic || (s.hit_type === 0 && !atk)) && w('far', s)) return 'farOrb';
    if (st === 'melee' && !magic && w('blinkCut', s)) return 'blinkChain';
    // (any game: by the skill's fields) more than one shot: a volley at one, a rain over all; more than one blow at
    // all with no attack in it: a rain; more than one cut: a flurry; a spell on one: shots that come round after the player
    // (BLACK SOULS II's orbs) or eruptions under them; a spell on all: a blast round the boss; a wide blow: a sweep
    if (st === 'projectile' && hits >= 2) return s.scope === 1 ? 'volley' : 'rain';
    if (st === 'area' && !atk && hits >= 2) return 'rain';
    if (st === 'melee' && atk && hits >= 2) return 'flurry';
    if (magic && s.scope === 1) return w('orb', s) ? 'orbs' : 'pursuit';
    if (magic && s.scope === 2) return 'nova';
    if (st === 'area' && s.hit_type === 1) return !atk && /\ba\.mat\b/.test(s.damage.formula || '') ? 'nova' : 'sweep';
    return null;
  });
}
export const bossFamily = s => family(s, true);
// 흑기사 린다메아's own six (BLACK SOULS II): 'lance' | 'void' | 'punish' | 'blackLight' | 'sanction' | 'noah', or null
export const lindaKind = s => (s && bs2() ? LINDA[s.id] || null : null);

// ---- a boss's quick step after a skill on itself (combat/areas.js)
function blinks(s, u) {
  const r = own(s, 'blink', u);
  return r !== undefined ? r : !!s && w('blink', s);
}
export const bossBlinks = s => blinks(s, true);
// ---- the lines of a star (bossacts.js 'cross'): 4, 5 or 6
function points(s, u) {
  const r = own(s, 'points', u);
  return r !== undefined ? r : s && w('star5', s) ? 5 : s && w('star6', s) ? 6 : 4;
}
export const crossPoints = s => points(s, true);
// ---- a delayed blow that comes as a meteor rain (bossacts.js delayedFamily), one that drops the player from the sky
// (bossmoves.js liftInfo)
export const meteorBlow = s => !!s && w('meteor', s);
export const fallBlow = s => !!s && w('fall', s);

// ---- a die skill's face (bossacts.js 'dice'): BLACK SOULS II's, else its fixed damage in ten thousands
export function diceFace(s) {
  const k = (bs2() ? DICE_FACE[s?.id] : undefined) ?? Math.round((+s?.damage?.formula || 10000) / 10000);
  return Math.min(Math.max(k || 1, 1), 6);
}
// ---- what a shot looks like in flight (combat/shotlooks.js): the player's rule for the skill, a gun's round, a thrown
// knife, its element (light: BLACK SOULS II's soul arrows, else a star), a drain, a death spell, BLACK SOULS II's table,
// else an orb in a rune circle
const EL_SHOT = { 2: 'blood', 3: 'fire', 4: 'ice', 5: 'thunder', 10: 'dark', 11: 'blood', 12: 'fire', 15: 'thunder', 18: 'poison' };
export const shotStyle = (o, lk = null) => shotOf(o, lk, true);
function shotOf(o, lk, u) {
  if (lk === 'gun') return 'bullet';
  if (lk === 'knife') return 'knife';
  if (!o) return 'arcane';
  const kind = kindOf(o);
  const r = u && kind === 'skill' ? skillRule(o.id)?.shot : undefined;
  if (r !== undefined) return r;
  const table = bs2() ? SHOT_LOOK[kind === 'item' ? 'items' : 'skills'][o.id] : undefined;
  const el = o.damage?.element_id | 0;
  if (el === 9) return table === 'soul' ? 'soul' : 'holy';
  if (EL_SHOT[el]) return EL_SHOT[el];
  if (lk === 'drain') return 'blood';
  if (lk === 'death') return 'dark';
  return table || 'arcane';
}

// ---- messages by their place in the game's events (coopguard.js refOf: ['c', ce, i] | ['t', troop, page, i] | ['e', map,
// event, page, i]): one that says YOU DIED (BLACK SOULS II's, with its common events), a big banner (VICTORY ACHIEVED)
const placeKey = ref => (Array.isArray(ref) ? ref.join(':') : '');
const DIED = new Set(YOU_DIED), BANNER = new Set(BANNERS);
export const youDiedAt = ref => bs2Always() && DIED.has(placeKey(ref));
export const bannerAt = ref => bs2() && BANNER.has(placeKey(ref));

// ---- BLACK SOULS II's Break (combat/items.js, attacks.js): a skill or item of it (with the Break states it brings), one
// that fires a gun; thrown knives (combat/spells.js); the states that keep a foe from being broken
export const isBreak = o => !!o && bs2Always() && BRK[kindOf(o)].has(o.id) && (o.effects || []).some(e => e.code === 21 && (e.data_id === 7 || e.data_id === 8));
export const isGunBreak = o => !!o && bs2Always() && GUN[kindOf(o)].has(o.id);
export const isKnife = o => !!o && bs2() && KNF[kindOf(o)].has(o.id);
export const unbreakableState = id => bs2Always() && UNBREAK.has(id);

// ---- the choices to kill an NPC (BLACK SOULS II): the event's page has one; which choices of the command at `at` kill
const killPage = (mapId, eventId, page) => (bs2() ? KILL_CHOICES[`${mapId}:${eventId}:${page}`] : undefined);
export const pageKills = (mapId, eventId, page) => !!killPage(mapId, eventId, page);
export const killOptions = (mapId, eventId, page, at) => killPage(mapId, eventId, page)?.[at] || null;

// ---- BLACK SOULS II's common events (co-op): while the switch is on, or its database has the game's number of them
export function bs2CommonEvents() { return ($data.commonEvents?.length || 0) === COMMON_EVENTS.count; }
export const commonEventIs = (kind, id) => bs2Always() && CE[kind].has(id);
export const commonEventIds = kind => (bs2Always() ? CE[kind] : NONE);
export const bs2CommonEventSets = () => Object.fromEntries(Object.keys(CE).map(k => [k, [...commonEventIds(k)]]));

// ---- the rule editor: what a skill does by default (the player's rule left out) and with it
export function judged(s, withRule = false) {
  const u = !!withRule;
  return { pattern: family(s, u), style: style(s, u), look: look(s, u), color: flavor(s, u), blink: blinks(s, u), points: points(s, u),
    shot: shotOf(s, look(s, u), u) };
}
export { SKILL_VR };
