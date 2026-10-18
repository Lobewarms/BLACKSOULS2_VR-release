// Game state: switches, variables, self switches, party, actors (+ RPG Maker save import).
import { $data } from '../data/data.js';
import { G } from '../core/globals.js';
import { hashGet } from '../data/marshal.js';
import { normalizeMoveSpeed } from './movement-speed.js';

// script 131 ステータス限界突破: the most a param can be - the script's own limits (actors 999,999 HP, 99,999 MP, 9,999
// the rest; enemies 9,999,999 HP) plus every <限界変動:n,v> on the battler's actor / class / equipment / states / enemy
// (one to a line): the player's actors 1-11 go up to 1,099,998 HP, 199,998 MP and 109,998 for the rest. (They were
// held at 9,999 here: an original save's strength was cut down to that, not only shown so)
const LB_ACTOR = [999999, 99999, 9999, 9999, 9999, 9999, 9999, 9999];
export const LB_ENEMY = [9999999, 99999, 9999, 9999, 9999, 9999, 9999, 9999];
const PARAM_MIN = [1, 0, 1, 1, 1, 1, 1, 1];
function limitShift(o) {
  if (o._limitShift === undefined) {
    let a = null;
    for (const m of (o.note || '').matchAll(/<限界変動[：:]\s*(\d+)\s*,\s*(-?\d+)\s*>/g)) (a ||= [0, 0, 0, 0, 0, 0, 0, 0])[+m[1]] += +m[2];
    o._limitShift = a;
  }
  return o._limitShift;
}
// script 216 最大レベル限界突破: <レベル限界増加:n> raises the top level (actors 1-11: +900, to 999); past 99 each level
// adds 105% of what 98 -> 99 added, times <限界突破後補正:n>% on its features (none in this game)
function mlvPlus(o) {
  if (o._mlvPlus === undefined) { const m = /<レベル限界増加[：:](\S+?)>/.exec(o.note || ''); o._mlvPlus = m ? parseInt(m[1]) || 0 : 0; }
  return o._mlvPlus;
}
function olvExtend(o) {
  if (o._olvExt === undefined) { const m = /<限界突破後補正[：:](\S+?)>/.exec(o.note || ''); o._olvExt = m ? m[1] : null; }
  return o._olvExt;
}
// script 190 戦闘開始時ステート: <戦闘前ステート付与:id[,p]> and the like on a battler's states / equipment / itself,
// done as a fight starts (p% of the time, 100 if not given) - tags 0-11: HP / MP / TP restored by a figure or a
// share, a state added / removed, a buff / debuff added (id, turns) / removed
const BFE_WORDS = ['HP固定回復', 'HP割合回復', 'MP固定回復', 'MP割合回復', 'TP固定回復', 'TP割合回復', 'ステート付与', 'ステート解除', '強化付与', '強化解除', '弱体付与', '弱体解除'];
export function battleStartEffects(o) {
  if (o._bfe === undefined) {
    o._bfe = [];
    for (const line of (o.note || '').split(/\r?\n/)) {
      BFE_WORDS.forEach((w, tag) => {
        const m = new RegExp(`<戦闘前${w}[：:](\\S+)>`).exec(line);
        if (!m) return;
        const a = m[1].split(/\s*,\s*/), n = tag === 8 || tag === 10 ? 3 : 2;
        if (a.length === n - 1) a.push('100');
        if (a.length === n) o._bfe.push({ tag, a });
      });
    }
  }
  return o._bfe;
}

export const KIND = { item: 'item', weapon: 'weapon', armor: 'armor' };
// how many of one thing the bag holds (the original's VX Ace bag: 99; this VR version has always held more)
export const BAG_MAX = 9999;

// 誓約 (Claimh's 精霊システム, scripts 205-207): an oath with a heroine is a "spirit" - an actor of its own whose
// features, and params over 1, are added to the actor it is sworn to. Events add and remove the spirits (an oath
// that deepens swaps its spirit for the next level's); the menu's 서약 chooses which one is sworn (one at a time).
// spirit ids lo..hi -> actor id = spirit id + d (4 levels a heroine: 1-4 노데, 5-8 빌, ... 65-68 시요)
const SPIRIT_RANGES = [[1, 32, 16], [33, 60, 39], [61, 64, 41], [65, 68, 50]];
export function spiritActorId(sid) {
  for (const [lo, hi, d] of SPIRIT_RANGES) if (sid >= lo && sid <= hi) return sid + d;
  return 0;
}
export function spiritIdOf(actorId) {
  for (const [lo, hi, d] of SPIRIT_RANGES) if (actorId - d >= lo && actorId - d <= hi) return actorId - d;
  return 0;
}
// how much of a spirit's params an actor gets (the original's 相性: 3 = all of it, 0 = can't swear it):
// actor 11 only goes with 시요 (65-68), every other actor with everyone
const AFFINITY_RATE = [0, 0.5, 0.8, 1.0, 1.2, 1.5];
function oathAffinity(actorId, sid) {
  if (spiritIdOf(actorId)) return 0;
  if (actorId === 11) return sid >= 65 && sid <= 68 ? 3 : 0;
  return 3;
}

// 装備拡張 (RGSSLAB_039): actors 1-11 have weapon, shield, head, body and four ring slots
export function equipSlotCount(actorId) { return actorId >= 1 && actorId <= 11 ? 8 : 5; }
export function itemData(kind, id) {
  if (!id) return null;
  if (kind === 'item') return $data.items[id] || null;
  if (kind === 'weapon') return $data.weapons[id] || null;
  if (kind === 'armor') return $data.armors[id] || null;
  if (kind === 'skill') return $data.skills[id] || null;
  return null;
}
export function kindOf(obj) {
  const c = obj?.__class || '';
  if (c === 'RPG::Item') return 'item';
  if (c === 'RPG::Weapon') return 'weapon';
  if (c === 'RPG::Armor') return 'armor';
  if (c === 'RPG::Skill') return 'skill';
  return null;
}

// ---------------------------------------------------------------------------
// Battler stat logic shared by actors and enemies (Game_BattlerBase subset)
// ---------------------------------------------------------------------------
export class BattlerBase {
  constructor() {
    this.hp = 1; this.mp = 0; this.tp = 0;
    this.states = []; this.stateTurns = {};
    this.stateSteps = {};                           // (states that wear off by walking: steps left)
    this.buffs = [0, 0, 0, 0, 0, 0, 0, 0];
    this.buffTime = [0, 0, 0, 0, 0, 0, 0, 0];       // (seconds left)
  }
  featureObjects() { return this.states.map(id => $data.states[id]).filter(Boolean); }
  allFeatures() {
    const out = [];
    for (const o of this.featureObjects()) if (o?.features) out.push(...o.features);
    return out;
  }
  featuresWith(code, id) { return this.allFeatures().filter(f => f.code === code && (id === undefined || f.data_id === id)); }
  featuresPi(code, id) { return this.featuresWith(code, id).reduce((r, f) => r * f.value, 1); }
  featuresSum(code, id) { return this.featuresWith(code, id).reduce((r, f) => r + f.value, 0); }
  featuresSet(code) { return [...new Set(this.featuresWith(code).map(f => f.data_id))]; }
  paramBase() { return 0; }
  paramPlus() { return 0; }
  paramBuffRate(i) { return this.buffs[i] * 0.25 + 1; }
  paramMax(i) { return LB_ACTOR[i] + this.limitParam(i); }
  limitParam(i) {
    let v = 0;
    for (const o of this.featureObjects()) { const a = o && limitShift(o); if (a) v += a[i]; }
    return v;
  }
  param(i) {
    let v = this.paramBase(i) + this.paramPlus(i);
    v *= this.featuresPi(21, i) * this.paramBuffRate(i);
    return Math.floor(Math.max(PARAM_MIN[i], Math.min(this.paramMax(i), v)));
  }
  xparam(i) { return this.featuresSum(22, i); }
  sparam(i) { return this.featuresPi(23, i); }
  get mhp() { return this.param(0); } get mmp() { return this.param(1); }
  get atk() { return this.param(2); } get def() { return this.param(3); }
  get mat() { return this.param(4); } get mdf() { return this.param(5); }
  get agi() { return this.param(6); } get luk() { return this.param(7); }
  get hit() { return this.xparam(0); } get eva() { return this.xparam(1); }
  get cri() { return this.xparam(2); } get cev() { return this.xparam(3); }
  get mev() { return this.xparam(4); } get mrf() { return this.xparam(5); }
  get cnt() { return this.xparam(6); } get hrg() { return this.xparam(7); }
  get mrg() { return this.xparam(8); } get trg() { return this.xparam(9); }
  get tgr() { return this.sparam(0); } get grd() { return this.sparam(1); }
  get rec() { return this.sparam(2); } get pha() { return this.sparam(3); }
  get mcr() { return this.sparam(4); } get tcr() { return this.sparam(5); }
  get pdr() { return this.sparam(6); } get mdr() { return this.sparam(7); }
  get fdr() { return this.sparam(8); } get exr() { return this.sparam(9); }
  elementRate(id) { return this.featuresPi(11, id); }
  stateRate(id) { return this.featuresPi(13, id); }
  stateResist(id) { return this.featuresSet(14).includes(id); }
  atkElements() { return this.featuresSet(31); }
  atkStates() { return this.featuresSet(32); }
  atkStatesRate(id) { return this.featuresSum(32, id); }
  isState(id) { return this.states.includes(id); }
  state(id) { return this.isState(id); }
  // <スキル無効:X[,Y]> (script 196): skill X used on this battler comes to nothing, Y% of the time (the rates of all
  // its features added up)
  skillCanceled(id) {
    let p = 0;
    for (const o of this.featureObjects()) {
      if (!o) continue;
      if (!o._skillCancel) {
        o._skillCancel = {};
        for (const m of (o.note || '').matchAll(/<スキル無効[：:]\s*(\d+)\s*(?:,\s*(\d+))?\s*>/g)) o._skillCancel[+m[1]] = (o._skillCancel[+m[1]] || 0) + (m[2] ? +m[2] : 100);
      }
      p += o._skillCancel[id] || 0;
    }
    return p > Math.random() * 100;
  }
  get dead() { return this.hp <= 0; }
  addState(id) {
    const st = $data.states[id];
    if (!st) return;
    // (one it has already: its counts start again - VX Ace's reset_state_counts)
    if (this.isState(id)) { if (st.remove_by_walking) this.stateSteps[id] = st.steps_to_remove; return; }
    // (a state it resists does not take - VX Ace's state_addable?; death is seen to by the callers)
    if (id !== 1 && this.stateResist(id)) return;
    if (id === 1) this.hp = 0;
    this.states.push(id);
    this.stateTurns[id] = st.min_turns || 0;
    if (st.remove_by_walking) this.stateSteps[id] = st.steps_to_remove;
    this.clampHpMp();
  }
  // (as VX Ace's refresh after a state comes or goes: HP and MP no higher than the maximum it leaves - 기사의 긍지's
  // doubled HP gone, the HP over it goes too)
  removeState(id) {
    this.states = this.states.filter(s => s !== id);
    delete this.stateTurns[id];
    delete this.stateSteps[id];
    if (id === 1 && this.hp <= 0) this.hp = 1;
    this.clampHpMp();
  }
  clampHpMp() {
    this.hp = Math.max(0, Math.min(this.hp, this.mhp));
    this.mp = Math.max(0, Math.min(this.mp, this.mmp));
  }
  // a step on the map: the states that wear off by walking count down (VX Ace's update_state_steps - 발광 after 100
  // steps, poison after 10); the ones gone
  walkStep() {
    const gone = [];
    for (const id of [...this.states]) {
      if (!$data.states[id]?.remove_by_walking) continue;
      const n = this.stateSteps[id] ?? $data.states[id].steps_to_remove;
      this.stateSteps[id] = Math.max(0, n - 1);
      if (this.stateSteps[id] === 0) { this.removeState(id); gone.push(id); }
    }
    return gone;
  }

  // ---- VX Ace buffs: a level of -2..2 for each param (25% a level) with time left (seconds - the caller turns the
  // original's turns into time); as Game_Battler's add_buff / add_debuff / remove_buff
  addBuff(i, secs) {
    if (this.dead) return false;
    if (this.buffs[i] < 2) this.buffs[i]++;
    if (this.buffs[i] < 0) this.eraseBuff(i);
    else if (this.buffs[i] !== 0 && this.buffTime[i] < secs) this.buffTime[i] = secs;
    this.clampHpMp();
    return true;
  }
  addDebuff(i, secs) {
    if (this.dead) return false;
    if (this.buffs[i] > -2) this.buffs[i]--;
    if (this.buffs[i] > 0) this.eraseBuff(i);
    else if (this.buffs[i] !== 0 && this.buffTime[i] < secs) this.buffTime[i] = secs;
    this.clampHpMp();
    return true;
  }
  eraseBuff(i) { this.buffs[i] = 0; this.buffTime[i] = 0; }
  removeBuff(i) {
    if (this.dead || !this.buffs[i]) return false;
    this.eraseBuff(i);
    this.clampHpMp();
    return true;
  }
  removeAllBuffs() { for (let i = 0; i < 8; i++) this.removeBuff(i); }
  debuffRate(i) { return this.featuresPi(12, i); }
  // time passing: the ones run out go
  tickBuffs(dt) {
    let gone = false;
    for (let i = 0; i < 8; i++) {
      if (!this.buffs[i]) continue;
      this.buffTime[i] -= dt;
      if (this.buffTime[i] <= 0) { this.eraseBuff(i); gone = true; }
    }
    if (gone) this.clampHpMp();
    return gone;
  }
  // their icons, as Game_BattlerBase#buff_icons
  buffIcons() {
    const out = [];
    this.buffs.forEach((lv, i) => { if (lv > 0) out.push(64 + (lv - 1) * 8 + i); else if (lv < 0) out.push(80 + (-lv - 1) * 8 + i); });
    return out;
  }
  // script 172 回復反転: <HP回復無効:p> / <HP回復反転:p> (MP too) on its states / equipment - a heal it gets comes to
  // nothing p% of the time, or turns into as much damage (허약, 꺼지지 않는 화염, 신어의 반지, 불길한 상의, 천수 영역).
  // What a heal of v (kind 0 HP, 1 MP) comes to
  healAmount(v, kind = 0) {
    if (!(v > 0)) return v;
    let nul = 0, inv = 0;
    for (const o of this.featureObjects()) {
      if (!o) continue;
      if (o._healRule === undefined) {
        const n = o.note || '', g = w => { const m = new RegExp(`<${w}[：:](\\S+?)>`).exec(n); return m ? parseInt(m[1]) || 0 : 0; };
        o._healRule = [g('HP回復無効'), g('MP回復無効'), g('HP回復反転'), g('MP回復反転')];
      }
      nul += o._healRule[kind]; inv += o._healRule[kind + 2];
    }
    if (nul > Math.random() * 100) return 0;
    if (inv > Math.random() * 100) return -v;
    return v;
  }
  // script 220 絶対命中: <必中/物理/魔法/全絶対命中> and ...絶対回避 on its features, by hit type (0 sure, 1 physical,
  // 2 magical) - what it uses always lands (kind 0) / what is used on it always misses (kind 1): 흰 유니콘 유니스
  // evades every sure hit; 필중화 lands every physical and magical one
  certainty(kind, hitType) {
    for (const o of this.featureObjects()) {
      if (!o) continue;
      if (o._certainty === undefined) {
        const n = o.note || '', K = ['必中', '物理', '魔法', '全'];
        o._certainty = [K.map(w => n.includes(`<${w}絶対命中>`)), K.map(w => n.includes(`<${w}絶対回避>`))];
      }
      const a = o._certainty[kind];
      if (a[3] || a[hitType]) return true;
    }
    return false;
  }
  // script 171 自動蘇生: <自動蘇生:hp,animation[,chance]> on its states / equipment / itself - fallen in a fight it may get
  // up again with that HP (the first one whose chance comes up); <自動蘇生破損:p> on what saved it: p% of the time that
  // equipment breaks (it is lost) / that state goes. (용의 가호의 반지, 가디언 엔젤, 너스 콜)
  autoRevive() {
    for (const o of this.featureObjects()) {
      if (!o) continue;
      if (o._autoRev === undefined) {
        o._autoRev = [];
        for (const line of (o.note || '').split(/\r?\n/)) {
          const m = /<自動蘇生[：:](\S+)>/.exec(line);
          const d = m ? m[1].split(/\s*,\s*/) : [];
          if (d.length >= 2) o._autoRev.push({ hp: d[0], anim: parseInt(d[1]) || 0, chance: d[2] ?? '100' });
        }
        const b = /<自動蘇生破損[：:](\S+)>/.exec(o.note || '');
        o._autoRevBreak = b ? b[1] : '0';
      }
      for (const r of o._autoRev) {
        if (!(this.evalNote(r.chance) > Math.random() * 100)) continue;
        const hp = Math.trunc(this.evalNote(r.hp));
        if (hp > 0) return { hp, anim: r.anim, source: o, breakRate: this.evalNote(o._autoRevBreak) };
      }
    }
    return null;
  }
  // a number in a note: a figure, or a small formula of this battler's (self.mhp*3/4)
  evalNote(s) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
    // Original RPG Maker note formulas evaluate against this battler.
    // eslint-disable-next-line no-new-func
    try { return Number(Function('self', `return (${s});`)(this)) || 0; } catch { return 0; }
  }
  // script 128 スキルコスト拡張: what a skill costs in HP - <消費ＨＰ n>, <消費ＨＰ n%> of the HP left, <消費最大ＨＰ n%> of
  // the maximum (a rate costs at least 1): 거합베기, 바람쓸이, 귀곡추추, 총탄 장전, 귀신 무사's cuts
  skillHpCost(skill) {
    if (!skill) return 0;
    if (skill._hpCost === undefined) {
      const n = skill.note || '';
      let m;
      skill._hpCost = (m = /<消費最大(?:ＨＰ|HP)\s*(\d+)%\s*>/.exec(n)) ? { max: +m[1] }
        : (m = /<消費(?:ＨＰ|HP)\s*(\d+)%\s*>/.exec(n)) ? { rate: +m[1] }
        : (m = /<消費(?:ＨＰ|HP)\s*(\d+)\s*>/.exec(n)) ? { fixed: +m[1] } : null;
    }
    const c = skill._hpCost;
    if (!c) return 0;
    if (c.max) return Math.max(Math.floor(this.mhp * c.max / 100), 1);
    if (c.rate) return Math.max(Math.floor(this.hp * c.rate / 100), 1);
    return c.fixed;
  }
  // VX Ace's clear_states as script 115 (全回復無効ステート) has it: a state noted [全回復無効ステート] stays -
  // 망자 through a bonfire's Recover All, a boss's domain, a companion's difficulty - until an event takes it away
  clearStates() {
    this.states = this.states.filter(id => ($data.states[id]?.note || '').includes('[全回復無効ステート]'));
    for (const id of Object.keys(this.stateTurns)) if (!this.states.includes(+id)) delete this.stateTurns[id];
    for (const id of Object.keys(this.stateSteps)) if (!this.states.includes(+id)) delete this.stateSteps[id];
  }
  // VX Ace's die: no other states, no buffs
  die() {
    this.hp = 0;
    this.clearStates();
    this.buffs = [0, 0, 0, 0, 0, 0, 0, 0];
    this.buffTime = [0, 0, 0, 0, 0, 0, 0, 0];
    this.addState(1);
  }
  recoverAll() {
    this.clearStates();
    this.hp = this.mhp; this.mp = this.mmp;
  }
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------
export class GameActor extends BattlerBase {
  constructor(actorId) {
    super();
    const a = $data.actors[actorId];
    this.id = actorId;
    this.name = a?.name || '';
    this.nickname = a?.nickname || '';
    this.classId = a?.class_id || 1;
    this.level = a?.initial_level || 1;
    this.exp = {};
    this.characterName = a?.character_name || '';
    this.characterIndex = a?.character_index || 0;
    this.faceName = a?.face_name || '';
    this.faceIndex = a?.face_index || 0;
    this.paramPlusArr = [0, 0, 0, 0, 0, 0, 0, 0];
    this.skills = [];
    this.partners = [];          // 서약: the spirits sworn to this actor (spirit ids)
    this.maxSpirits = 1;
    this.partnerLocked = false;  // (a spirit) its oath can't be changed in the menu (Spirits.lock_partner)
    this.equips = [];
    const eq = a?.equips || [0, 0, 0, 0, 0];
    eq.forEach((id, slot) => this.equips.push({ kind: slot === 0 ? 'weapon' : 'armor', id }));
    this.padEquips();
    this.exp[this.classId] = this.expForLevel(this.level);
    for (const l of this.cls?.learnings || []) if (l.level <= this.level) this.learnSkill(l.skill_id);
    this.hp = this.mhp; this.mp = this.mmp;
  }
  get data() { return $data.actors[this.id]; }
  get cls() { return $data.classes[this.classId]; }
  get maxLevel() {
    let v = this.data?.max_level || 99;
    for (const o of this.featureObjects()) if (o) v += mlvPlus(o);
    return v;
  }
  get max_level() { return this.maxLevel; }
  expForLevel(lv) {
    const p = this.cls?.exp_params || [30, 20, 30, 30];
    const [basis, extra, accA, accB] = p;
    return Math.round(basis * Math.pow(lv - 1, 0.9 + accA / 250) * lv * (lv + 1) / (6 + lv * lv / 50 / accB) + (lv - 1) * extra);
  }
  get currentExp() { return this.exp[this.classId] || 0; }
  ownFeatureObjects() {
    const objs = [this.data, this.cls];
    for (const e of this.equips) { const d = itemData(e.kind, e.id); if (d) objs.push(d); }
    return objs.concat(super.featureObjects()).filter(Boolean);
  }
  // (with the features of the spirits sworn to it)
  featureObjects() {
    const objs = this.ownFeatureObjects();
    for (const s of this.partnerActors()) objs.push(...s.ownFeatureObjects());
    return objs;
  }
  // ---- 서약 ----
  get isSpirit() { return spiritIdOf(this.id) > 0; }
  get spiritId() { return spiritIdOf(this.id); }
  partnerActors() {
    if (!this.partners.length) return [];
    return this.partners.map(sid => G.state.actor(spiritActorId(sid))).filter(Boolean);
  }
  canPartner(sid) { return oathAffinity(this.id, sid) !== 0 && !!$data.actors[spiritActorId(sid)]; }
  removePartner(sid) {
    if (!this.partners.includes(sid)) return;
    this.partners = this.partners.filter(x => x !== sid);
    this.clampHpMp();
  }
  // what a spirit gives the actor it is sworn to: its params over 1 (the original's PRM_BASE)
  oathParam(i) { return BattlerBase.prototype.param.call(this, i) - 1; }
  // (co-op, the rule statSync - coop.js syncStats: a guest's own number for a param - bareParam - brought to the
  // host's by syncScale, that param's factor; what it grew is taken back out, so that with it the sum comes to that.
  // Its equipment, states and oaths count on top as they are)
  paramBase(i) {
    const v = this.levelParam(i), k = this.syncScale?.[i];
    if (!k) return v;
    return Math.round(this.bareParam(i) * k / (this.ownRate(i) || 1)) - (this.paramPlusArr[i] || 0);
  }
  // its own number for a param - its level's and what it grew, by its own and its class's traits, as far as they go -
  // without its equipment, states or oaths (what statSync compares)
  bareParam(i) {
    let max = LB_ACTOR[i];
    for (const o of [this.data, this.cls]) { const a = o && limitShift(o); if (a) max += a[i]; }
    return Math.floor(Math.max(PARAM_MIN[i], Math.min(max, (this.levelParam(i) + (this.paramPlusArr[i] || 0)) * this.ownRate(i))));
  }
  // its own and its class's traits' rate for a param (not its equipment's, states' or oaths')
  ownRate(i) {
    let r = 1;
    for (const o of [this.data, this.cls]) for (const f of o?.features || []) if (f.code === 21 && f.data_id === i) r *= f.value;
    return r;
  }
  levelParam(i) {
    const t = this.cls?.params;
    if (!t) return 1;
    const top = t.ysize - 1;
    const v = t.data[i + Math.min(this.level, top) * t.xsize];
    if (this.level <= 99 || top < 99) return v;
    // (past 99: script 216)
    const inc = t.data[i + 99 * t.xsize] - t.data[i + 98 * t.xsize];
    return inc ? v + Math.trunc(inc * (this.level - 99) * 1.05 * this.overLevelRate()) : v;
  }
  overLevelRate() {
    let r = 100;
    for (const o of this.featureObjects()) {
      const x = o && olvExtend(o);
      if (x != null) r += (x === 'level' ? this.level : parseFloat(x) || 0) - 100;
    }
    return r / 100;
  }
  paramPlus(i) {
    let v = this.paramPlusArr[i] || 0;
    for (const e of this.equips) { const d = itemData(e.kind, e.id); if (d?.params) v += d.params[i]; }
    return v;
  }
  param(i) {
    let v = super.param(i);
    for (const s of this.partnerActors()) v += Math.trunc(s.oathParam(i) * AFFINITY_RATE[oathAffinity(this.id, s.spiritId)]);
    return v;
  }
  addParam(i, v) { this.paramPlusArr[i] += v; this.clampHpMp(); }
  add_param(i, v) { this.addParam(i, v); }
  learnSkill(id) { if (!this.skills.includes(id)) this.skills.push(id); }
  // skills in the skill list: learned + added by equipment / states (feature 43)
  allSkills() {
    return [...new Set([...this.skills, ...this.featuresSet(43)])].sort((a, b) => a - b)
      .map(id => $data.skills[id]).filter(s => s && s.name);
  }
  skillTypeUsable(skill) {
    if (!skill.stype_id) return true;
    return this.featuresSet(41).includes(skill.stype_id) && !this.featuresSet(42).includes(skill.stype_id);
  }
  skillSealed(id) { return this.featuresSet(44).includes(id); }
  // <アイテム封印> (script 186) on a state, equipment...: no items in a fight (하얀 감옥 영역, 간호사 영역)
  itemSealed() { return this.featureObjects().some(o => o && (o._itemSeal ??= /<アイテム封印>/.test(o.note || ''))); }
  skillMpCost(skill) { return Math.floor(skill.mp_cost * this.mcr); }
  // (an HP cost cannot be paid with the last of the HP - script 128)
  skillCostPayable(skill) { const hp = this.skillHpCost(skill); return this.mp >= this.skillMpCost(skill) && this.tp >= skill.tp_cost && (hp <= 0 || this.hp > hp); }
  paySkillCost(skill) { const hp = this.skillHpCost(skill); this.mp -= this.skillMpCost(skill); this.tp -= skill.tp_cost; if (hp > 0) this.hp = Math.max(1, this.hp - hp); }
  forgetSkill(id) { this.skills = this.skills.filter(s => s !== id); }
  weapons() { return this.equips.filter(e => e.kind === 'weapon' && e.id).map(e => $data.weapons[e.id]); }
  armors() { return this.equips.filter(e => e.kind === 'armor' && e.id).map(e => $data.armors[e.id]); }
  padEquips() {
    const n = equipSlotCount(this.id);
    while (this.equips.length < n) this.equips.push({ kind: 'armor', id: 0 });
  }
  isEquipped(kind, id) { return this.equips.some(e => e.kind === kind && e.id === id); }
  equipSlotType(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= equipSlotCount(this.id)) return undefined;
    return slot === 1 && this.featuresSet(55).includes(1) ? 0 : Math.min(slot, 4);
  }
  equipChangeOk(slot) {
    const type = this.equipSlotType(slot);
    return type !== undefined && !this.featuresSet(53).includes(type) && !this.featuresSet(54).includes(type);
  }
  canEquipItem(kind, item) {
    if (!item) return false;
    const type = kind === 'weapon' ? 0 : item.etype_id;
    if (this.featuresSet(54).includes(type)) return false;
    return kind === 'weapon' ? this.featuresSet(51).includes(item.wtype_id)
      : kind === 'armor' && this.featuresSet(52).includes(item.atype_id);
  }
  releaseUnequippableItems(returnToParty = true) {
    // Original VXAce_SP1 repeats because removing later gear can change the
    // permissions of an earlier slot. Each changed pass removes an item.
    let changed;
    do {
      changed = false;
      for (let slot = 0; slot < this.equips.length; slot++) {
        const e = this.equips[slot];
        if (!e?.id) continue;
        const item = itemData(e.kind, e.id), type = e.kind === 'weapon' ? 0 : item?.etype_id;
        if (this.canEquipItem(e.kind, item) && type === this.equipSlotType(slot)) continue;
        this.equips[slot] = { kind: this.equipSlotType(slot) === 0 ? 'weapon' : 'armor', id: 0 };
        if (returnToParty) G.state.party.gainItem(e.kind, e.id, 1);
        changed = true;
      }
    } while (changed);
  }
  changeEquipById(slot, id) {
    const type = this.equipSlotType(slot), kind = type === 0 ? 'weapon' : 'armor';
    if (type === undefined || !Number.isInteger(id) || id < 0) return false;
    const item = itemData(kind, id), party = G.state.party;
    // Event commands may clear fixed slots, but still trade a real party-owned item.
    if (id && (!item || (kind === 'armor' && item.etype_id !== type) || party.itemCount(kind, id) < 1)) return false;
    const cur = this.equips[slot];
    if (cur?.id) party.gainItem(cur.kind, cur.id, 1);
    if (id) party.gainItem(kind, id, -1);
    this.equips[slot] = { kind, id };
    this.releaseUnequippableItems();
    this.clampHpMp();
    return true;
  }
  change_equip_by_id(slot, id) { return this.changeEquipById(slot, id); }
  forceChangeEquip(slot, kind, id) {
    if (!this.equips[slot]) this.equips[slot] = { kind, id: 0 };
    this.equips[slot] = { kind, id };
    this.releaseUnequippableItems(false);
    this.clampHpMp();
  }
  changeExp(exp) {
    this.exp[this.classId] = Math.max(0, exp);
    while (this.level < this.maxLevel && this.currentExp >= this.expForLevel(this.level + 1)) this.levelUp();
    while (this.level > 1 && this.currentExp < this.expForLevel(this.level)) this.level--;
    this.clampHpMp();
  }
  levelUp() {
    this.level++;
    for (const l of this.cls?.learnings || []) if (l.level === this.level) this.learnSkill(l.skill_id);
  }
  changeLevel(lv) {
    lv = Math.max(1, Math.min(lv, this.maxLevel));
    this.changeExp(this.expForLevel(lv));
  }
  recoverAll() {
    this.clearStates();
    this.hp = this.mhp; this.mp = this.mmp;
  }
  toJSON() {
    return {
      id: this.id, name: this.name, nickname: this.nickname, classId: this.classId, level: this.level,
      exp: this.exp, characterName: this.characterName, characterIndex: this.characterIndex,
      faceName: this.faceName, faceIndex: this.faceIndex, paramPlus: this.paramPlusArr,
      skills: this.skills, equips: this.equips, hp: this.hp, mp: this.mp, tp: this.tp, states: this.states,
      partners: this.partners, maxSpirits: this.maxSpirits, partnerLocked: this.partnerLocked,
      buffs: this.buffs, buffTime: this.buffTime, stateSteps: this.stateSteps,
    };
  }
  static fromJSON(o) {
    const a = new GameActor(o.id);
    Object.assign(a, {
      name: o.name, nickname: o.nickname, classId: o.classId, level: o.level, exp: o.exp,
      characterName: o.characterName, characterIndex: o.characterIndex, faceName: o.faceName,
      faceIndex: o.faceIndex, paramPlusArr: o.paramPlus, skills: o.skills, equips: o.equips,
      hp: o.hp, mp: o.mp, tp: o.tp || 0, states: o.states || [],
      partners: Array.isArray(o.partners) ? o.partners.filter(x => typeof x === 'number' && x > 0) : [],
      maxSpirits: o.maxSpirits || 1, partnerLocked: !!o.partnerLocked,
    });
    if (Array.isArray(o.buffs) && o.buffs.length === 8) { a.buffs = o.buffs.map(v => +v || 0); a.buffTime = (o.buffTime || []).map(v => +v || 0).concat([0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 8); }
    if (o.stateSteps && typeof o.stateSteps === 'object') a.stateSteps = { ...o.stateSteps };
    a.padEquips();
    return a;
  }
}

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------
export class GameParty {
  constructor() {
    this.gold = 0; this.steps = 0;
    this.actors = [];
    this.items = new Map(); this.weapons = new Map(); this.armors = new Map();
    this.spirits = [];
    this.kept = { item: new Map(), weapon: new Map(), armor: new Map() };     // 창고 (keep() below)
  }
  container(kind) { return kind === 'weapon' ? this.weapons : kind === 'armor' ? this.armors : this.items; }
  itemCount(kind, id) { return this.container(kind).get(id) || 0; }
  hasItem(kind, id, includeEquip = false) {
    if (this.itemCount(kind, id) > 0) return true;
    return includeEquip && this.members().some(a => a.isEquipped(kind, id));
  }
  gainItem(kind, id, n, includeEquip = false) {
    if (!id) return;
    if (n > 0) G.coop?.noteGain?.(kind, id, n);          // (co-op: a guest's own boss fight's reward - kept in the host's world too)
    const c = this.container(kind);
    // (what the bag cannot hold goes into the storage by itself, up to what that takes - the storage script's
    // 自動倉庫送り - unless its switch holds that back or the thing may not be kept)
    const K = G.scripts?.keep;
    if (n > 0 && K?.autoKeep && !(K.autoSwitch > 0 && G.state?.sw(K.autoSwitch)) && !this.keepSealed(kind, id)) {
      const over = (c.get(id) || 0) + n - BAG_MAX;
      if (over > 0) { this.kept[kind].set(id, Math.min(this.keptCount(kind, id) + over, this.keepLimit(kind, id))); n -= over; }
    }
    const total = (c.get(id) || 0) + n;
    const v = Math.max(0, Math.min(BAG_MAX, total));
    if (v) c.set(id, v); else c.delete(id);
    if (includeEquip && total < 0) {
      let remaining = -total;
      for (const a of this.members()) {
        let removed = false;
        for (const e of a.equips) {
          if (remaining > 0 && e.kind === kind && e.id === id) { e.id = 0; remaining--; removed = true; }
        }
        if (removed) a.clampHpMp();
      }
    }
    G.map?.requestRefresh?.();
  }
  gain_item(item, n) { const k = kindOf(item); if (k) this.gainItem(k, item.id, n); }
  // ---- 창고: the storage (script アイテム預かり所 - the library bear's 창고). It takes up to keepLimit of each thing
  // (999, or <保存制限:n> on it) and nothing that says <保存禁止>; what is in it does not count as had (events look
  // at the bag only, as in the original)
  keptCount(kind, id) { return this.kept[kind]?.get(id) || 0; }
  keepLimit(kind, id) {
    const K = G.scripts?.keep;
    const m = new RegExp(`<${K?.limitWord || '保存制限'}[：:](\\d+)>`).exec(itemData(kind, id)?.note || '');
    return m ? +m[1] : K?.limit || 999;
  }
  keepSealed(kind, id) { return (itemData(kind, id)?.note || '').includes(`<${G.scripts?.keep?.sealWord || '保存禁止'}>`); }
  // n > 0: that many from the bag into the storage; n < 0: that many back out of it
  keep(kind, id, n) {
    const c = this.kept[kind];
    if (!n || !c) return;
    const v = Math.max(0, (c.get(id) || 0) + n);
    if (v) c.set(id, v); else c.delete(id);
    this.gainItem(kind, id, -n);
    G.map?.requestRefresh?.();
  }
  // as much as can go - mode 0: into the storage, 1: back out (the storage script's event commands)
  keepAsMuch(kind, id, mode) {
    if (!itemData(kind, id) || this.keepSealed(kind, id)) return;
    const bag = this.itemCount(kind, id), kept = this.keptCount(kind, id);
    this.keep(kind, id, mode === 0 ? Math.min(this.keepLimit(kind, id) - kept, bag) : -Math.min(BAG_MAX - bag, kept));
  }
  // every thing of a kind (that has the word in its note, when given)
  keepAll(kind, mode, word = null) {
    const list = kind === 'weapon' ? $data.weapons : kind === 'armor' ? $data.armors : $data.items;
    for (const d of list) if (d && (!word || (d.note || '').includes(word))) this.keepAsMuch(kind, d.id, mode);
  }
  item_container(kind) {
    const c = this.container(kind);
    return new Proxy({}, { get: (_, k) => c.get(+k) || 0 });
  }
  gainGold(n) { this.gold = Math.max(0, Math.min(999999999, this.gold + n)); if (n > 0) G.coop?.noteGain?.('gold', 0, n); }
  members() { return this.actors.map(id => G.state.actor(id)); }
  leader() { return this.actors.length ? G.state.actor(this.actors[0]) : null; }
  addActor(id) { if (!this.actors.includes(id)) this.actors.push(id); }
  removeActor(id) { this.actors = this.actors.filter(a => a !== id); }
  // an event gives an oath ($game_party.add_spirit) or takes it back (remove_spirit: the party members it was
  // sworn to lose it). As in the original, an oath that deepens takes the old level's spirit back and gives the
  // next one's: it is no longer sworn and is chosen again in the menu
  add_spirit(id) { if (!this.spirits.includes(id)) this.spirits.push(id); }
  remove_spirit(id) {
    for (const a of this.members()) a?.removePartner(id);
    this.spirits = this.spirits.filter(s => s !== id);
  }
  // party ability features (code 64): 4 gold x2, 5 drops x2 (0-3 encounters / surprise / pre-emptive: not used here)
  partyAbility(id) { return this.members().some(a => a && a.featuresWith(64, id).length > 0); }
  get size() { return this.actors.length; }
  allDead() { return this.members().every(a => a.dead); }
  toJSON() {
    return {
      gold: this.gold, steps: this.steps, actors: this.actors, spirits: this.spirits,
      items: [...this.items], weapons: [...this.weapons], armors: [...this.armors],
      kept: { item: [...this.kept.item], weapon: [...this.kept.weapon], armor: [...this.kept.armor] },
    };
  }
  static fromJSON(o) {
    const p = new GameParty();
    Object.assign(p, { gold: o.gold, steps: o.steps, actors: o.actors, spirits: o.spirits || [] });
    p.items = new Map(o.items); p.weapons = new Map(o.weapons); p.armors = new Map(o.armors);
    for (const k of ['item', 'weapon', 'armor']) p.kept[k] = new Map(o.kept?.[k] || []);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Whole game state
// ---------------------------------------------------------------------------
export class GameState {
  constructor() {
    this.switches = [];
    this.variables = [];
    this.selfSwitches = new Map();
    this.actorMap = new Map();
    this.party = new GameParty();
    this.system = {
      saveDisabled: false, menuDisabled: false, encounterDisabled: false, formationDisabled: false,
      saveCount: 0, battleCount: 0, winCount: 0, escapeCount: 0, playFrames: 0,
      timer: { working: false, count: 0 }, recipes: [],
      battleBgm: null, battleEndMe: null,      // set by events (132 / 133); null = the database's
    };
    this.mapId = 0;
    this.start = { x: 0, y: 0, dir: 2 };
    this.importedFrom = null;
  }
  sw(id) { return !!this.switches[id]; }
  // (each change is also told to a co-op guest standing in this world - coop.js noteFlag)
  setSw(id, v) { this.switches[id] = !!v; G.map?.requestRefresh(); G.coop?.noteFlag(this, 'S', id, this.switches[id]); }
  v(id) { return this.variables[id] ?? 0; }
  setV(id, v) {
    if (typeof v === 'number' && Number.isFinite(v)) v = Math.trunc(v);
    this.variables[id] = v;
    G.map?.requestRefresh();
    G.coop?.noteFlag(this, 'V', id, v);
  }
  selfKey(mapId, evId, ch) { return `${mapId},${evId},${ch}`; }
  selfSw(mapId, evId, ch) { return !!this.selfSwitches.get(this.selfKey(mapId, evId, ch)); }
  setSelfSw(mapId, evId, ch, v) {
    const k = this.selfKey(mapId, evId, ch);
    if (v) this.selfSwitches.set(k, true); else this.selfSwitches.delete(k);
    G.map?.requestRefresh();
    G.coop?.noteFlag(this, 'SS', k, !!v);
  }
  actor(id) {
    if (!$data.actors[id]) return null;
    if (!this.actorMap.has(id)) this.actorMap.set(id, new GameActor(id));
    return this.actorMap.get(id);
  }
  // ---- 서약 ----
  // the actor a spirit is sworn to (0: none)
  oathHolder(sid) {
    for (const a of this.actorMap.values()) if (a.partners.includes(sid)) return a.id;
    return 0;
  }
  // the spirits the party has that this actor could swear: not sworn to someone else, and they go together
  oathChoices(actor) {
    return this.party.spirits.filter(sid => actor.canPartner(sid) && [0, actor.id].includes(this.oathHolder(sid)));
  }
  // Spirits.add_partner: swear spirit sid to actor aid if the party has it, it is free, they go together and the
  // actor has room
  swearOath(aid, sid) {
    const a = this.actor(aid);
    if (!a || a.isSpirit || !this.party.spirits.includes(sid) || !a.canPartner(sid)) return false;
    if (this.oathHolder(sid) || a.partners.length >= a.maxSpirits) return false;
    a.partners.push(sid);
    a.clampHpMp();
    return true;
  }
  // the menu: swear sid in the actor's oath slot (0: none); a locked oath stays
  setOath(a, slot, sid) {
    const cur = a.partners[slot] || 0;
    if (cur === sid) return true;
    if (cur && this.actor(spiritActorId(cur))?.partnerLocked) return false;
    if (sid && (!a.canPartner(sid) || ![0, a.id].includes(this.oathHolder(sid)))) return false;
    const list = a.partners.filter(x => x !== sid);
    if (sid) list[Math.min(slot, list.length)] = sid;
    else list.splice(slot, 1);
    a.partners = list.filter(Boolean).slice(0, a.maxSpirits);
    a.clampHpMp();
    return true;
  }
  // Spirits.remove_partner / lock_partner / unlock_partner (no actor is made up just to be told it has nothing)
  breakOath(aid, sid) {
    this.actorMap.get(aid)?.removePartner(sid);
    const s = this.actorMap.get(spiritActorId(sid));
    if (s) s.partnerLocked = false;
  }
  lockOath(sid, on) {
    const s = this.actor(spiritActorId(sid));
    if (s && this.oathHolder(sid)) s.partnerLocked = !!on;
  }

  newGame() {
    const sys = $data.system;
    this.party.actors = [...sys.party_members];
    this.mapId = sys.start_map_id;
    this.start = { x: sys.start_x, y: sys.start_y, dir: 2 };
    this.importedFrom = 'new';
  }

  // Import a parsed RPG Maker VX Ace save (contents hash from Save##.rvdata2)
  importRmSave(contents, label) {
    const get = k => hashGet(contents, k);
    // The real-time player and companion paths both use six seconds per original turn.
    const turnSeconds = 6;
    const remainingCount = value => Number.isSafeInteger(value) && value >= 0
      ? Math.min(value, Math.floor(Number.MAX_SAFE_INTEGER / turnSeconds)) : undefined;
    const sw = get('switches'); const vars = get('variables');
    this.switches = (sw?.data || []).map(v => !!v);
    this.variables = (vars?.data || []).map(v => (['number', 'string', 'boolean'].includes(typeof v) ? v : 0));
    this.selfSwitches = new Map();
    const ss = get('self_switches')?.data;
    if (ss instanceof Map) for (const [k, v] of ss) if (v && Array.isArray(k)) this.selfSwitches.set(this.selfKey(k[0], k[1], k[2]), true);
    const party = get('party');
    this.party = new GameParty();
    if (party) {
      this.party.gold = party.gold || 0;
      this.party.steps = party.steps || 0;
      this.party.actors = [...(party.actors || [])];
      for (const [kind, key] of [['item', 'items'], ['weapon', 'weapons'], ['armor', 'armors']]) {
        const m = party[key];
        if (m instanceof Map) for (const [id, n] of m) if (n > 0) this.party.container(kind).set(+id, n);
      }
      // (what was in the storage - アイテム預かり所's @items_k / @weapons_k / @armors_k)
      for (const [kind, key] of [['item', 'items_k'], ['weapon', 'weapons_k'], ['armor', 'armors_k']]) {
        const m = party[key];
        if (m instanceof Map) for (const [id, n] of m) if (n > 0) this.party.kept[kind].set(+id, n);
      }
      if (Array.isArray(party.spirits)) this.party.spirits = party.spirits.filter(x => typeof x === 'number');
    }
    this.actorMap = new Map();
    const actors = get('actors')?.data || [];
    actors.forEach((ra, id) => {
      if (!ra || !$data.actors[id]) return;
      const a = new GameActor(id);
      a.name = ra.name ?? a.name; a.nickname = ra.nickname ?? a.nickname;
      a.classId = ra.class_id || a.classId; a.level = ra.level || a.level;
      if (ra.exp instanceof Map) { a.exp = {}; for (const [c, e] of ra.exp) a.exp[c] = e; }
      a.characterName = ra.character_name ?? a.characterName; a.characterIndex = ra.character_index ?? a.characterIndex;
      a.faceName = ra.face_name ?? a.faceName; a.faceIndex = ra.face_index ?? a.faceIndex;
      if (Array.isArray(ra.param_plus)) a.paramPlusArr = ra.param_plus.map(x => +x || 0);
      if (Array.isArray(ra.skills)) a.skills = ra.skills.filter(x => typeof x === 'number');
      if (Array.isArray(ra.equips)) {
        a.equips = ra.equips.map((bi, slot) => {
          const cname = bi?.class?.name || '';
          const kind = cname ? (cname === 'RPG::Weapon' ? 'weapon' : 'armor') : (slot === 0 ? 'weapon' : 'armor');
          return { kind, id: bi?.item_id || 0 };
        });
        a.padEquips();
      }
      a.states = Array.isArray(ra.states) ? ra.states.filter(x => typeof x === 'number') : [];
      for (const [source, target] of [['state_steps', 'stateSteps'], ['state_turns', 'stateTurns']]) {
        for (const sid of a.states) {
          const count = remainingCount(hashGet(ra[source], sid) ?? ra[source]?.[sid]);
          if (count !== undefined) a[target][sid] = count;
        }
      }
      if (Array.isArray(ra.buffs)) {
        a.buffs = Array.from({ length: 8 }, (_, i) => Number.isInteger(ra.buffs[i]) ? Math.max(-2, Math.min(2, ra.buffs[i])) : 0);
        a.buffTime = a.buffs.map((level, i) => {
          const turns = remainingCount(ra.buff_turns?.[i]);
          return level && turns !== undefined ? turns * turnSeconds : 0;
        });
      }
      // 서약: the spirits sworn to it (an emptied slot is 0) / a spirit's lock
      if (Array.isArray(ra.partners)) a.partners = ra.partners.filter(x => typeof x === 'number' && x > 0);
      if (typeof ra.max_spirits === 'number') a.maxSpirits = Math.max(1, ra.max_spirits);
      a.partnerLocked = !!ra.partner_locked;
      a.hp = ra.hp ?? a.mhp; a.mp = ra.mp ?? a.mmp; a.tp = ra.tp || 0;
      this.actorMap.set(id, a);
    });
    const leader = this.actorMap.get(this.party.actors[0]);
    for (const sid of leader?.states || []) {
      if ($data.states[sid]?.auto_removal_timing && leader.stateTurns[sid] !== undefined)
        (this.system.stateTimers ||= {})[sid] = leader.stateTurns[sid] * turnSeconds;
    }
    const sys = get('system');
    if (sys) {
      Object.assign(this.system, {
        saveDisabled: !!sys.save_disabled, menuDisabled: !!sys.menu_disabled,
        encounterDisabled: !!sys.encounter_disabled, formationDisabled: !!sys.formation_disabled,
        saveCount: sys.save_count || 0, battleCount: sys.battle_count || 0,
        winCount: sys.win_count || 0, escapeCount: sys.escape_count || 0, playFrames: sys.frames_on_save || 0,
        battleBgm: sys.battle_bgm?.name !== undefined ? { name: sys.battle_bgm.name, volume: sys.battle_bgm.volume, pitch: sys.battle_bgm.pitch } : null,
        battleEndMe: sys.battle_end_me?.name !== undefined ? { name: sys.battle_end_me.name, volume: sys.battle_end_me.volume, pitch: sys.battle_end_me.pitch } : null,
      });
      // (the weapon recipes turned on - アイテム合成's w_rcp_sw)
      if (Array.isArray(sys.w_rcp_sw)) this.system.recipes = sys.w_rcp_sw.map((on, i) => (on === true ? i : 0)).filter(Boolean);
    }
    const timer = get('timer');
    if (timer) this.system.timer = { working: !!timer.working, count: timer.count || 0 };
    const map = get('map'); const player = get('player');
    this.mapId = map?.map_id || $data.system.start_map_id;
    this.start = { x: player?.x ?? 0, y: player?.y ?? 0, dir: player?.direction || 2, moveSpeed: normalizeMoveSpeed(player?.move_speed) };
    this.importedFrom = label;
  }

  toJSON() {
    return {
      version: 1,
      switches: this.switches, variables: this.variables, selfSwitches: [...this.selfSwitches.keys()],
      actors: [...this.actorMap.values()].map(a => a.toJSON()), party: this.party.toJSON(),
      system: this.system, mapId: this.mapId, start: this.start, importedFrom: this.importedFrom,
      quickSlots: this.quickSlots || null,
    };
  }
  static fromJSON(o) {
    const s = new GameState();
    s.switches = o.switches; s.variables = o.variables;
    s.selfSwitches = new Map((o.selfSwitches || []).map(k => [k, true]));
    s.actorMap = new Map(o.actors.map(a => [a.id, GameActor.fromJSON(a)]));
    s.party = GameParty.fromJSON(o.party);
    Object.assign(s.system, o.system);
    s.mapId = o.mapId; s.start = o.start; s.importedFrom = o.importedFrom;
    s.quickSlots = Array.isArray(o.quickSlots) ? o.quickSlots : null;
    return s;
  }
}
