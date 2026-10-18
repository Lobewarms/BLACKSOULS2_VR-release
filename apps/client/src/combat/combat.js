// Real-time 3D action combat replacing RPG Maker's turn-based battles.
//  - Battle Processing (301) spawns the troop as 3D enemies (battler art as billboards)
//  - symbol-encounter events become roaming enemies that engage on sight
//  - player: swing the weapon (VR) / click (desktop); shield block (left grip / RMB); dodge
//  - original mechanics: Break (hit during wind-up -> defenceless), Guard (halves damage), Evade (dodge i-frames)
import * as THREE from 'three';
import { BalloonIcon, BALLOON_TIME, BALLOON_SIZE } from '../ui/balloons.js';
import { AllySystem } from '../entities/allies.js';
import { G } from '../core/globals.js';
import { tr } from '../ui/i18n.js';
import { $data } from '../data/data.js';
import { T } from '../world/mapmesh.js';
import { loadCanvas } from '../data/assets.js';
import { BattlerBase, itemData, LB_ENEMY, battleStartEffects } from '../game/state.js';
import { evalFormula } from '../game/rubyexpr.js';
import { Interpreter } from '../game/interpreter.js';
import { commonEventList } from '../entities/character.js';
import { resolveCircle, lineOfSight, nextStep, clearEdgeCache } from '../world/collision.js';
import { FONT, drawIcon, stripEscapes, iconAssetRevision } from '../ui/ui.js';
import { QuickRing, quickSlots, entryData } from '../ui/quickslots.js';
import { FloorMarker, MARK } from './telegraph.js';
import { buildIconModel, getAdjust, setAdjust, resetAdjust, defaultAdjust } from './weapons.js';
import { WeaponFx, ELEMENT_FX } from './weaponfx.js';
import { desktopRest, desktopSwing, desktopModel, desktopShield, desktopShieldGuardPoint, desktopEquipmentHidden } from './desktop-weapon.js';
import { playerRecoveryRate } from './action-speed.js';
import { battlerEffects, effectsKey, fitLabel } from '../ui/battler-status.js';
import { openFights } from '../world/maphints.js';
import { personalPage } from '../network/coopworld.js';
import { SHIELD_SOUND } from '../ui/audio.js';
import { bossMoves, NEW_MOVES, PART_MOVES } from './bossmoves.js';

G.weaponAdjust = { get: getAdjust, set: setAdjust, reset: resetAdjust };
// items used by hand in VR: the herb bottles go to the mouth, the syringes (수혈액) into the body
const HERB_ICONS = [635, 636];
const SYRINGE_ICON = 649;

// how hard a VR swing must be to count (setting 휘두르기 판정): blade-tip speed in m/s, and how far the
// tip must have travelled in the last ~0.14 s (a real arc, not a flick of the wrist)
const SWING_LEVELS = [[2.6, 0.2], [3.4, 0.28], [4.4, 0.36], [5.4, 0.45]];
// a guard raised this soon before the blow lands is a perfect guard: no damage and a fifth of the HP back, then
// for a few seconds stronger blows and DEF / MDF two buff levels up (x1.5, the game's own buff rate)
const PERFECT_GUARD = 0.25, POWER_BUFF = { mult: 1.5, time: 5 }, GUARD_BUFF = { level: 2, heal: 0.2 };
// once lowered, the guard comes up again only this much later (s; held down, it stays up - and after a perfect
// guard it may come up again at once). The guns with Gun Break cannot guard: a Gun Break that hits an enemy whose
// blow - one a guard could stop - is this close to landing on the player (s) is their perfect guard, and their
// next Gun Break is ready at once
const GUARD_COOLDOWN = 0.5, GUN_PARRY = 0.35;
const DESK_ACT = 0.3;          // (PC) a shot, a cast or a throw let go keeps the hands busy this long: the guard down (handsBusy)
// how long a boss rests between two of its own moves (s, random between)
const BOSS_MOVE_REST = [2.5, 5];
const FOLLOW_REST = 0.3;          // the breath between an action and the one it goes on with (使用後追加行動)
// how fast a boss's charge runs (m/s)
const CHARGE_SPEED = 36;
// a boss's attacks cover more ground than anyone else's (m): its plain blow reaches this far beyond its body, its
// sure-hit circle (purple) is this wide around it, and it starts a blow from this far off
const BOSS_AREA = { reach: 10, certain: 14, start: 4.5 };
// a boss's eruptions under the player (pursuit): one every gap s, each bursting fuse s after it is laid, this wide
const PURSUIT = { gap: 0.5, fuse: 0.85, r: 1.8 };
// a boss's pools (field): this wide (m), lasting time s, hurting every tick s
const POOL = { r: 2.6, time: 5.5, tick: 1 };
// how long a state that leaves an enemy open to Break (charging up, guarding, a counter stance) does so (s) - a
// boss's, shorter still
const BREAK_WINDOW = 1.5, BREAK_WINDOW_BOSS = 0.8;
// a turn of a skill's cool-down (<クールタイム:n>, script 141) for enemies and companions - as for the player (s)
export const COOL_TURN = 1.5;
// a boss's healing (수혈액, 소울의 빛, 재생...): never again within BOSS_HEAL_REST s, and when its pattern would
// have it, only this often - far rarer than the original (the user's wish)
const BOSS_HEAL_REST = 45, BOSS_HEAL_PASS = 0.3;
// a skill's cool-down in turns (script 141), 0 for none
export function coolTurns(s) {
  if (!s) return 0;
  if (s._coolTurns === undefined) { const m = /<クールタイム[：:]\s*(\d+)\s*>/.exec(s.note || ''); s._coolTurns = m ? +m[1] : 0; }
  return s._coolTurns;
}
// a boss's charge that runs into the player throws them this far along its way (m); one landing on them from a
// leap sends them up at this speed (m/s: a little higher than the player's own jump, 3.1)
const CHARGE_KNOCK = 2.2, LEAP_LAUNCH = 3.5;
const PARRY_SLIDE = 0.6;            // m: a charge met with a perfect guard still pushes the player back this far
// the player's body, as the enemies meet it (tiles; the same as against walls, player.js)
const BODY_R = 0.22;
// a boss's whirl: how far it turns away as it winds up (rad), how many turns it makes and for how long (s)
const SPIN_COIL = 1.1, SPIN_TURNS = 4, SPIN_TIME = 1.8;
// the whirl's turn at time t of it: from the coiled pose, faster and faster, slowing to face the player at the end
function spinAngle(t) {
  return -SPIN_COIL + (SPIN_TURNS * Math.PI * 2 + SPIN_COIL) * THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(t / SPIN_TIME, 0, 1), 0, 1);
}
// a picture turned by angle a (seen from the front: cos a wide, mirrored while its back is round; never quite a line)
function turnWidth(a) { const c = Math.cos(a); return Math.sign(c || 1) * Math.max(0.06, Math.abs(c)); }
// blow after blow: within RUSH.window s the swings after the first RUSH.free hit weaker
const RUSH = { window: 1.5, free: 2, mults: [0.6, 0.4, 0.25] };
// groggy (in place of the weapons' stun, which kept enemies helpless blow after blow): every enemy that can be stunned has a
// gauge from its stats - (ATK + DEF + MDF) / 3, a little more the bigger it is (max HP^0.25) and the less it can be stunned
// (/ sqrt of its stun rate); stun-proof ones have none. A blow carrying the attacker's weapon states (the "normal attack"
// effect) takes the attacker's ATK from it (MAT for a magic one) times how hard it hit, a little more for a weapon that
// stunned (+40% at 100%), never more than a tenth of the gauge in one attack. With no blow for 3 s it fills 5% a second.
// Emptied, the enemy is broken as by a Break, and it is full again when the enemy gets up
const GROGGY = { k: 20, stun: 0.4, cap: 0.1, delay: 3, regen: 0.05 };
// the one sound of a Break (or a groggy gauge) that lands - the user's choice: the game's own 金属 (1) at half pitch, from
// where it starts (its first 0.07 s are silent, twice that slowed down)
const BREAK_SE = { name: '金属 (1)', volume: 100, pitch: 50, from: 0.07 };
const STUN = 13;
// an enemy's thrown bottle / jar / mud is in the air this long before it lands (s), and its shots from a gun fly this
// fast (m/s)
const LOB_FLIGHT = 0.55, GUN_SPEED = 34;
// Gun Break: how far the shot carries (m) - it goes through every enemy on its line, up to a wall
const GUN_BREAK_RANGE = 24;
// the player's own buffs (a resin, a skill) wear off like in a battle of the original: a turn is 6 s, as for
// troop pages (a resin: 10 turns = 60 s)
const TURN_SECONDS = 6;
// an enemy's turn, for its states and buffs (원작 턴 수 × 2초)
const ENEMY_TURN = 2;
// 흑기사 린다메아 in her duel (inDuel): everything she does this much quicker - wind-ups, rests, her moves' steps, her running
const DUEL_PACE = 2;
// skills whose cool-down turns are the player's real turns (TURN_SECONDS each, as long as the states they give last) -
// not the quick COOL_TURN: else the state outlasts the cool-down and stays up for good. Up as often as in the original:
// 진혼가 138 (death resisted 3 turns = 18 s, cool-down 8 turns = 48 s), 절대 필중 603, 성기사의 깃발 847, 고기방패 소환 836;
// the weapons' 기사의 긍지 93, 광전사의 포효 82, 잔심 102, 마나 리제네 26, 광기가 부르는 소리 497, 도살 개시 600,
// 그랜드 챌린지 971, 퀵 드로우 159 (the companions' own and the skills that grow by stages stay as they were)
const FULL_TURN_COOL = new Set([138, 603, 847, 836, 93, 82, 102, 26, 497, 600, 971, 159]);
// skills that grow a stage a use (script 195 <ステート変化>), one a turn in the original: one a TURN_SECONDS here - each
// use keeps the next away so long. 씩성난 분노 469 (its stages 470-478: the tenth, a blow on all of atk x 100)
const STAGE_TURNS = [469];
// a resin (송진) held in the left hand goes onto the weapon after this much rubbing along it (m)
const RESIN_RUB = 0.3;
const ELEMENT_SE = { fire: 'Fire1', ice: 'Ice1', thunder: 'Thunder1', dark: 'Darkness1', light: 'Saint1' };
// thrown items: knives fly straight and fast (m/s); anything else goes in an arc (gravity m/s2); a pot landing on the
// floor right beside an enemy still gets it (m beyond its body); the held / flying models' size (blade, bottle)
const KNIFE_SPEED = 32, THROW_GRAVITY = 9.8, THROWN_SPLASH = 0.6, KNIFE_SCALE = 0.75, THROWN_SCALE = 0.23;
const FORWARD = new THREE.Vector3(0, 0, -1), TUMBLE_AXIS = new THREE.Vector3(1, 0, 0);
// brightness of flashes / glows (setting 이펙트 밝기)
const fxk = () => THREE.MathUtils.clamp(G.settings.fxBrightness ?? 0.5, 0.1, 1);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpColor = new THREE.Color();
const tmpHead = new THREE.Vector3(), tmpRigQ = new THREE.Quaternion();
// distance from (px, py) to the segment (ax, ay)-(bx, by)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 > 1e-9 ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}
// how far along a step from (ax, ay) to (bx, by) a body first comes within r of (cx, cy): 0..1 (1: never)
function firstContact(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (a < 1e-9 || disc < 0) return 1;
  return THREE.MathUtils.clamp((-b - Math.sqrt(disc)) / (2 * a), 0, 1);
}
// several marks laid down for one move (a rain of blows, a fan of shots): each fills toward its own moment and
// goes when its part has landed
class MarkerSet {
  constructor(parent, specs) { this.list = specs.map(s => new FloorMarker(parent, s)); }
  release(i, fading) { const m = this.list[i]; if (m && !m.released) { m.released = true; fading.push(m); } }
  fadeOut(dt) { let done = true; for (const m of this.list) if (!m.released && m.parent && !m.fadeOut(dt)) done = false; return done; }
  dispose() { for (const m of this.list) if (!m.released && m.parent) m.dispose(); }
}
// a point as seen from the head, in the rig's frame: moving with the stick, turning, or taking real
// steps carries the head and the hands together, so what changes here is only the arm's own motion
function bodyRelative(p, out) {
  const rig = G.player.rig;
  rig.updateWorldMatrix(true, false);
  out.copy(p).sub(G.player.headWorld(tmpHead));
  return out.applyQuaternion(rig.getWorldQuaternion(tmpRigQ).invert());
}

// a thing made half see-through (the stealth) or back as it was: its opaque materials only (a glow keeps its own)
function ghostify(root, on) {
  root.traverse(m => {
    if (!m.isMesh || !m.material) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const g = mat.userData.ghost;
      if (on && !g && !mat.transparent) {
        mat.userData.ghost = { o: mat.opacity, d: mat.depthWrite };
        mat.transparent = true; mat.opacity = mat.opacity * 0.35; mat.depthWrite = false; mat.needsUpdate = true;
      } else if (!on && g) {
        mat.transparent = false; mat.opacity = g.o; mat.depthWrite = g.d; mat.needsUpdate = true;
        delete mat.userData.ghost;
      }
    }
  });
}

// ------------------------------------------------------------------ enemy stats
// Script 218 簡易難易度変更: the difficulty (its variable - BLACKSOULS II's 60: chosen 0-9 at 도서관의 꿈, and one
// deeper for each floor down the 混沌 dungeon) multiplies the enemies' stats (rows 0-7), the experience (8), the
// souls (9) and the drop chance (10) by that column - as the original reads it, there and then
function difficultyRate(row) {
  const d = G.scripts?.difficulty;
  if (!d) return 1;
  return d.rows[row]?.[G.state?.v(d.variable) || 0] ?? 1;
}
class EnemyBattler extends BattlerBase {
  constructor(enemyId) {
    super();
    this.enemyId = enemyId;
    this.hp = this.mhp; this.mp = this.mmp;
  }
  get data() { return $data.enemies[this.enemyId]; }
  get name() { return this.data?.name || ''; }
  featureObjects() { return [this.data, ...super.featureObjects()].filter(Boolean); }
  // (co-op, the rule bossScale - coop.js scaleBosses: a boss's HP and MP times coopK, by how many were in its fight)
  paramBase(i) { return (this.data?.params[i] || 1) * difficultyRate(i) * (i <= 1 ? this.coopK || 1 : 1); }
  // it as it would be without that - what is left of its HP and MP the same share: what its own damage formulas read
  // of it (백사자 라이덴's axes: a.mhp * 0.01 - it strikes no harder) and what its size is judged by
  solo() {
    if (!(this.coopK > 1)) return this;
    const me = this, s = Object.create(this, { coopK: { value: 1 } });
    const share = (v, from, to) => (from > 0 ? Math.round(v * to / from) : v);
    return Object.defineProperties(s, {
      hp: { get: () => share(me.hp, me.mhp, s.mhp), set: v => { me.hp = share(v, s.mhp, me.mhp); } },
      mp: { get: () => share(me.mp, me.mmp, s.mmp), set: v => { me.mp = share(v, s.mmp, me.mmp); } },
    });
  }
  // (script 131 限界突破's enemy limits - max HP up to 9,999,999 - and <限界変動> on it: 메이벨's HP, the bosses' DEF / MDF;
  // a boss made stronger for a co-op fight goes past its HP and MP limits as many times)
  paramMax(i) { return (LB_ENEMY[i] + this.limitParam(i)) * (i <= 1 ? this.coopK || 1 : 1); }
  paramPlus() { return 0; }
  get level() { return 1; }
  // VX Ace: a battler is dead when it has the death state; 0 HP adds it unless it is resisted
  get dead() { return this.isState(1); }
}

// ------------------------------------------------------------------ textures
const battlerCache = new Map();
function battlerTexture(name, hue) {
  const key = `${name}#${hue}`;
  if (!battlerCache.has(key)) {
    battlerCache.set(key, loadCanvas('Graphics/Battlers', name, hue).then(c => {
      if (!c) return null;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      return { tex, w: c.width, h: c.height, core: drawnHalfWidth(c) };
    }));
  }
  return battlerCache.get(key);
}
// how far out from the middle of a picture its figure is drawn (pixels): the half-width holding 80% of what is
// drawn there (as drawn: alphaTest 0.25), not the empty margins round it
function drawnHalfWidth(c) {
  const W = c.width, a = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, c.height).data;
  const cols = new Float64Array(W);
  let total = 0;
  for (let i = 3, x = 0; i < a.length; i += 4) {
    if (a[i] > 64) { cols[x]++; total++; }
    if (++x === W) x = 0;
  }
  if (!total) return W / 2;
  const cx = W / 2;
  let lo = Math.floor(cx), hi = lo, inside = 0;
  while (inside < total * 0.8 && (lo > 0 || hi < W)) {
    if (lo > 0) inside += cols[--lo];
    if (hi < W) inside += cols[hi++];
  }
  return Math.max(cx - lo, hi - cx);
}

function textSprite(text, color = '#fff', size = 64) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 128, 48);
  ctx.fillStyle = color; ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  s.scale.set(0.6, 0.225, 1);
  s.renderOrder = 1500;
  return s;
}

// ------------------------------------------------------------------ PvP: blades meeting (VR)
const BLADE_R = 0.035;                     // m: a blade's half thickness
const clashInv = new THREE.Matrix4();
// the closest points of segments p1-q1 and p2-q2: [their distance, the point between them]
function segSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), cl = v => Math.max(0, Math.min(1, v));
  let s = 0, u = 0;
  if (a > 1e-9 || e > 1e-9) {
    if (a <= 1e-9) u = cl(f / e);
    else {
      const c = d1.dot(r);
      if (e <= 1e-9) s = cl(-c / a);
      else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-9 ? cl((b * f - c * e) / den) : 0;
        u = (b * s + f) / e;
        if (u < 0) { u = 0; s = cl(-c / a); } else if (u > 1) { u = 1; s = cl((b - c) / a); }
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, u);
  return [c1.distanceTo(c2), c1.add(c2).multiplyScalar(0.5)];
}
// where segment a-b first enters a box grown by r (null: it does not)
function segBox(a, b, box, r) {
  const d = b.clone().sub(a);
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const lo = box.min.getComponent(i) - r, hi = box.max.getComponent(i) + r, o = a.getComponent(i), v = d.getComponent(i);
    if (Math.abs(v) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let ta = (lo - o) / v, tb = (hi - o) / v;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return a.clone().addScaledVector(d, t0);
}
// where a blade's path between two frames (b0-t0, then b1-t1: world) meets one held thing (in its own frame, m: that
// frame - a weapon: its blade from the grip along -Z, len long, and its cross guard (across it, Y) if it has one; a
// shield: its box) - and how it goes, as steel does: { at, dir, how } or null.
//  a weapon - moving along its blade, it slides: down to its cross guard ('guard': caught there), or off its tip, or
//    down an unguarded one to the hand ('slide': the blow goes on); driven into it: its strong half (by the grip)
//    holds ('block'), its weak half is beaten aside by a hard blow ('beat': the blow goes on, weaker); its cross
//    guard struck: caught ('guard')
//  a shield - square on, it takes the blow ('block'); at a slant (the blade moving along its face), turned aside
//    ('deflect')
function bladeMeets(s, b0, t0, b1, t1, strong) {
  clashInv.copy(s.m).invert();
  const m = new THREE.Vector3().subVectors(t1, t0).transformDirection(clashInv);      // how it moves, in that frame
  const back = new THREE.Vector3().subVectors(t0, t1).normalize();
  const out = (x, how) => ({ at: x.applyMatrix4(s.m), dir: back, how });
  let thin = 2;
  if (s.kind === 'shield') { const size = s.box.getSize(new THREE.Vector3()); thin = [0, 1, 2].sort((i, j) => size.getComponent(i) - size.getComponent(j))[0]; }
  const p = new THREE.Vector3(0, 0, -0.1), q = new THREE.Vector3(0, 0, -(s.len || 0)), g = s.guard;
  const g0 = g && new THREE.Vector3(0, -g.half, -g.at), g1 = g && new THREE.Vector3(0, g.half, -g.at);
  for (let k = 0; k <= 3; k++) {
    const a = new THREE.Vector3().lerpVectors(b0, b1, k / 3).applyMatrix4(clashInv);
    const b = new THREE.Vector3().lerpVectors(t0, t1, k / 3).applyMatrix4(clashInv);
    if (s.kind === 'shield') {
      const at = segBox(a, b, s.box, BLADE_R);
      if (at) return out(at, Math.abs(m.getComponent(thin)) < 0.5 ? 'deflect' : 'block');
      continue;
    }
    if (g) { const [dg, xg] = segSeg(a, b, g0, g1); if (dg < BLADE_R * 2) return out(xg, 'guard'); }
    const [d, x] = segSeg(a, b, p, q);
    if (d >= BLADE_R * 2) continue;
    if (Math.abs(m.z) > 0.5) return m.z > 0 && g ? out(new THREE.Vector3(0, 0, -g.at), 'guard') : out(x, 'slide');
    return out(x, strong && -x.z > s.len * 0.5 ? 'beat' : 'block');
  }
  return null;
}

// ------------------------------------------------------------------ weapons
const WTYPE = { AXE: 1, CLAW: 2, SPEAR: 3, SWORD: 4, KATANA: 5, BOW: 6, DAGGER: 7, MACE: 8, STAFF: 9, GUN: 10 };
// What a weapon shoots on the trigger (PC: a click), if anything - a gun's bullet or a bow's arrow - by its kind, and a
// few by their icon (the same for their +1..+9): 거룩한 총검 a gun (its blow is a stab and then a shot of the bullet
// loaded in the original - the trigger fires that shot, gunShotSkill; in VR a swing still strikes with it), 광기의 활
// 접접 a bow (filed with the swords), 거대 철구 nothing (filed with the guns, but swung - the original's club animation;
// its blow is on all enemies), 메리의 지팡이 its magic (its blow is a sure hit on all enemies, not a swing of the staff).
// The other staffs swing (마술사, 만상, 르뤼에 - their blow is the plain attack with the staff's own animation; 심해의
// 기사의 닻 is filed with them)
const SHOT_BY_ICON = { 796: 'gun', 779: 'bow', 426: null, 422: 'magic' };
// 메리의 지팡이's orb (its blow, S967, is on all enemies): it bursts where it lands - an enemy, the floor, a wall - its
// blow on all within this reach (m), the reach shown (staffBurst)
const STAFF_BURST = 2.6;
const BURST_GAP = 0.08;          // s between the bullets of a burst
function shotStyle(item) {
  if (!item) return null;
  if (item.icon_index in SHOT_BY_ICON) return SHOT_BY_ICON[item.icon_index];
  return item.wtype_id === WTYPE.GUN ? 'gun' : item.wtype_id === WTYPE.BOW ? 'bow' : null;
}
// a shield's size (m across) by its guard effect - the original's 방어효과율【소】【중】【대】【특대】, its guard rate
// (GRD) 1.5 / 2 / 2.5 / 3: 【소】 the size a shield always had (weapons.js), the others bigger in step; 0: none (it
// is drawn by its kind, a great shield or not - weapons.js)
function shieldSpan(armor) {
  const grd = (armor?.features || []).filter(f => f.code === 23 && f.data_id === 1).reduce((r, f) => r * f.value, 1);
  return grd >= 2.95 ? 0.88 : grd >= 2.45 ? 0.72 : grd >= 1.95 ? 0.585 : grd >= 1.45 ? 0.45 : 0;
}
function makeWeaponMesh(wtype) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, metalness: 0.1, roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0x9a7a3a, metalness: 0.8, roughness: 0.4 });
  const add = (geo, mat, z, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(0, y, z); g.add(m); return m; };
  let length = 1.0;
  switch (wtype) {
    case WTYPE.SPEAR: {
      length = 1.9;
      const shaft = add(new THREE.CylinderGeometry(0.016, 0.016, 1.9, 8), dark, -0.65); shaft.rotation.x = Math.PI / 2;
      const head = add(new THREE.ConeGeometry(0.035, 0.28, 6), metal, -1.72); head.rotation.x = -Math.PI / 2;
      break;
    }
    case WTYPE.AXE: {
      length = 0.85;
      const h = add(new THREE.CylinderGeometry(0.018, 0.02, 0.85, 8), dark, -0.32); h.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.02, 0.24, 0.16), metal, -0.68, 0.08);
      break;
    }
    case WTYPE.MACE: {
      length = 0.8;
      const h = add(new THREE.CylinderGeometry(0.018, 0.02, 0.7, 8), dark, -0.28); h.rotation.x = Math.PI / 2;
      add(new THREE.DodecahedronGeometry(0.08), metal, -0.7);
      break;
    }
    case WTYPE.DAGGER: case WTYPE.CLAW: {
      length = 0.45;
      add(new THREE.BoxGeometry(0.03, 0.025, 0.12), dark, 0.0);
      add(new THREE.BoxGeometry(0.1, 0.02, 0.025), gold, -0.07);
      const b = add(new THREE.BoxGeometry(0.035, 0.008, 0.34), metal, -0.25);
      b.scale.set(1, 1, 1);
      break;
    }
    case WTYPE.STAFF: {
      length = 1.5;
      const s = add(new THREE.CylinderGeometry(0.018, 0.022, 1.5, 8), dark, -0.5); s.rotation.x = Math.PI / 2;
      add(new THREE.OctahedronGeometry(0.06), new THREE.MeshStandardMaterial({ color: 0x6688ff, emissive: 0x2233aa, emissiveIntensity: 1.5 }), -1.27);
      break;
    }
    case WTYPE.GUN: case WTYPE.BOW: {
      length = 0.6;
      add(new THREE.BoxGeometry(0.04, 0.12, 0.08), dark, 0.0, -0.04);
      add(new THREE.BoxGeometry(0.035, 0.05, 0.55), wtype === WTYPE.GUN ? metal : dark, -0.25, 0.03);
      break;
    }
    case WTYPE.KATANA: {
      length = 1.05;
      add(new THREE.BoxGeometry(0.035, 0.03, 0.26), dark, 0.02);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 12), gold, -0.12).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.03, 0.008, 0.85), metal, -0.55);
      break;
    }
    default: {
      length = 1.0;
      add(new THREE.BoxGeometry(0.035, 0.035, 0.2), dark, 0.03);
      add(new THREE.BoxGeometry(0.2, 0.025, 0.03), gold, -0.08);
      add(new THREE.BoxGeometry(0.055, 0.012, 0.86), metal, -0.52);
      add(new THREE.ConeGeometry(0.028, 0.08, 4), metal, -0.98).rotation.x = -Math.PI / 2;
    }
  }
  g.userData.length = length;
  g.userData.ranged = wtype === WTYPE.GUN || wtype === WTYPE.BOW;
  return g;
}
function makeShieldMesh(large) {
  const g = new THREE.Group();
  const geo = large ? new THREE.BoxGeometry(0.42, 0.62, 0.035) : new THREE.CylinderGeometry(0.22, 0.22, 0.035, 20);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6a5a48, metalness: 0.5, roughness: 0.55 }));
  if (!large) m.rotation.x = Math.PI / 2;
  g.add(m);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xa08850, metalness: 0.8, roughness: 0.3 }));
  boss.position.z = -0.02;
  g.add(boss);
  return g;
}

// ------------------------------------------------------------------ action enemy
let netSeq = 0;                  // (co-op: the number the players share for one enemy body - coop.js)
export class ActionEnemy {
  constructor(sys, battle, enemyId, fx, fy, opts = {}) {
    this.sys = sys; this.battle = battle;
    this.netId = ++netSeq;
    this.b = new EnemyBattler(enemyId);
    this.fx = fx; this.fy = fy;              // tile coords (centre = integer)
    this.state = opts.dormant ? 'idle' : 'chase';
    this.timer = 0; this.cooldown = 0.6 + Math.random() * 0.8;
    // (its own count of turns, from 1 as the original's ATB (script 149) starts it: an action "on turn 1" is its
    // first)
    this.turn = 1;
    this.hitCooldown = 0;
    this.flash = 0;
    this.knock = { x: 0, y: 0 };
    this.path = null; this.pathTimer = 0;
    this.hidden = !!opts.hidden;
    this.alertTime = 0;
    // (a co-op guest's copy of a player in the host's stage play: drawn as the play draws it - src/theater.js)
    if (opts.inPlay) { this.inPlay = true; this.memberIndex = opts.memberIndex; }
    // (a form gone up into the sky - bossmoves.js skyHold: drawn as the form it was, out of sight up there)
    this.lookAs = opts.lookAs || 0; this.sky = !!opts.lookAs;
    this.group = new THREE.Group();
    sys.root.add(this.group);
    this.ready = this.build();
  }
  get data() { return this.b.data; }
  get alive() { return !this.b.dead && this.state !== 'dying' && this.state !== 'dead'; }
  // 対象不可 in its note: nothing can be aimed at it - no blow, shot or spell of the player's or a companion's
  // reaches it (the dark stage machine above 그랑・기뇰's last act, until its last form)
  get untargetable() { if (this.noTarget || this.sys.skyHidden(this)) return true; const d = this.data; return !!d && (d._untargetable ??= /対象不可/.test(d.note || '')); }
  async build() {
    this.group.userData.enemy = true;          // (a reset sweeps up any enemy body left behind)
    const d = this.data, id = this.b.enemyId;
    // (a stage play draws some bodies its own way - src/theater.js)
    const look = (this.lookAs && $data.enemies[this.lookAs]) || d;
    const t = await (G.theater?.battlerTexture?.(this) || battlerTexture(look.battler_name, look.battler_hue));
    if (this.b.enemyId !== id) return;             // changed into something else meanwhile: that build is the one
    this.picW = t?.w || 0;
    let w = 1, h = 1.8;
    if (t) {
      h = THREE.MathUtils.clamp(t.h / 105, 0.9, 4.2);
      w = h * t.w / t.h;
    }
    const sc = G.theater?.scaleOf?.(this) || 1;
    h *= sc; w *= sc;
    this.h = h; this.w = w;
    // (tiles) its body - what stands in the way - is a little narrower than the figure drawn (arms, wings and
    // weapons stick out of it); blows land anywhere on the figure (hr). The height is the whole picture's.
    const core = t ? t.core * h / t.h : w * 0.4;
    this.r = THREE.MathUtils.clamp(core * 0.8, 0.2, 1.3) / T;
    this.hr = THREE.MathUtils.clamp(core, 0.25, 1.8) / T;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    this.mat = new THREE.MeshLambertMaterial({ map: t?.tex || null, color: t ? 0xffffff : 0x884444, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, emissive: 0x000000 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.order = 'YXZ';              // (turned to the player, then leant - in its own plane, or toward them)
    this.group.add(this.mesh);
    // Name, HP/groggy and active status effects share one camera-facing nameplate.
    const bar = document.createElement('canvas'); bar.width = 512; bar.height = 184;
    this.barCanvas = bar;
    this.lastBar = null;
    this.barTex = new THREE.CanvasTexture(bar);
    this.barTex.colorSpace = THREE.SRGBColorSpace;
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: true, depthWrite: false, transparent: true, toneMapped: false }));
    this.bar.scale.set(1.65, 1.65 * bar.height / bar.width, 1);
    this.bar.position.y = h + 0.12 + this.bar.scale.y / 2;
    this.bar.renderOrder = 1400;
    this.bar.visible = false;
    this.group.add(this.bar);
    // telegraph ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
    this.group.add(this.ring);
    // Break-chance cue (no text): a glow behind the body, a ring on the floor and rising sparks
    const glow = this.sys.glowTexture();
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, ...add }));
    this.aura.position.y = h * 0.5;
    this.aura.renderOrder = -1;                  // drawn before the body: shows around it
    this.aura.visible = false;
    this.group.add(this.aura);
    this.cueRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ ...add, side: THREE.DoubleSide }));
    this.cueRing.rotation.x = -Math.PI / 2;
    this.cueRing.position.y = 0.05;
    this.cueRing.visible = false;
    this.group.add(this.cueRing);
    this.sparks = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, ...add }));
      s.scale.setScalar(0.13);
      s.visible = false;
      this.group.add(s);
      this.sparks.push(s);
    }
    this.cue = null;
    this.drawBar();
  }
  drawBar() {
    if (!this.barCanvas) return;
    const effects = battlerEffects(this.b, this.statusBuffs ?? this.b.buffs);
    const gmax = this.sys?.groggyMax ? this.sys.groggyMax(this) : 0;
    const grog = gmax ? Math.max(0, Math.min(1, (this.grog ?? gmax) / gmax)) : 0;
    const page = Math.floor((G.time || 0) / 3) % Math.max(1, Math.ceil(effects.length / 4));
    const name = stripEscapes(this.b.name).trim() || tr('적 {id}', { id: this.b.enemyId });
    const key = `${name}/${this.b.hp}/${this.b.mhp}/${this.state}/${gmax}/${Math.round(grog * 488)}/${effectsKey(effects)}/${page}/${iconAssetRevision()}`;
    if (key === this.lastBar) return;
    this.lastBar = key;
    const ctx = this.barCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 184);
    ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, 512, effects.length ? 184 : 88);
    ctx.font = `bold 42px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fitLabel(ctx, name, 488), 256, 25);
    ctx.fillStyle = '#301010'; ctx.fillRect(10, 50, 492, 20);
    ctx.fillStyle = this.state === 'stagger' ? '#ffd040' : '#c02424';
    ctx.fillRect(12, 52, 488 * Math.max(0, Math.min(1, this.b.hp / this.b.mhp)), 16);
    // the groggy gauge (what is left of it), for an enemy that has one
    if (gmax) {
      ctx.fillStyle = '#29251d'; ctx.fillRect(10, 74, 492, 8);
      ctx.fillStyle = '#ece0b4';
      ctx.fillRect(12, 76, 488 * grog, 4);
    }
    ctx.font = `34px ${FONT}`; ctx.textAlign = 'left';
    // Cycle pages so every active effect is readable even with many simultaneous states.
    effects.slice(page * 4, page * 4 + 4).forEach((effect, i) => {
      const x = 12 + (i % 2) * 250, y = 96 + Math.floor(i / 2) * 40;
      drawIcon(ctx, effect.icon, x, y, 32);
      ctx.fillStyle = '#fff';
      ctx.fillText(fitLabel(ctx, stripEscapes(effect.name), 202), x + 38, y + 16);
    });
    this.barTex.needsUpdate = true;
  }
  updateNameplate(head) {
    if (!this.bar) return;
    this.bar.visible = this.alive && !this.hidden && this.group.visible && !this.untargetable && head.distanceTo(this.group.position) < 18;
    if (this.bar.visible) this.drawBar();
  }
  // (lift: off the floor - a boss in the middle of a leap)
  worldPos(target = new THREE.Vector3()) { return target.set((this.fx + 0.5) * T, (G.floorAt ? G.floorAt(this.fx, this.fy) : 0) + (this.lift || 0), (this.fy + 0.5) * T); }
  remove() {
    this.sys.root.remove(this.group);
    this.mesh?.geometry.dispose(); this.mat?.dispose();
    this.barTex?.dispose(); this.bar?.material.dispose();
    this.ring?.geometry.dispose(); this.ring?.material.dispose();
    this.cueRing?.geometry.dispose(); this.cueRing?.material.dispose();
    for (const gh of this.ghosts || []) gh.g.material.dispose();
    this.balloon?.dispose();
    this.aura?.material.dispose();
    for (const s of this.sparks || []) s.material.dispose();
  }
}

// ------------------------------------------------------------------ battle
class Battle {
  constructor(sys, opts) {
    Object.assign(this, opts);
    this.sys = sys;
    this.enemies = [];
    this.done = false; this.result = -1;
    this.time = 0; this.escapeTimer = 0;
    this.troop = $data.troops[opts.troopId];
    this.pageDone = new Set();
  }
  get alive() { return this.enemies.filter(e => e.alive && !e.hidden); }
  finish(result) {
    if (this.done) return;
    this.done = true; this.result = result;
    this.sys.onBattleEnd(this);
  }
}

// a page of a roaming monster (as its event takes it up: a fight, touched, its move route turning its encounter on)
function symbolPage(p) {
  return !!p && [1, 2].includes(p.trigger) && (p.list || []).some(c => c.code === 301) &&
    (p.move_route?.list || []).some(mc => mc.code === 45 && /enable_symbol_encount\(\d+\)/.test(mc.parameters?.[0] || ''));
}

// ------------------------------------------------------------------ system
export class CombatSystem {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'combat';
    scene.add(this.root);
    this.battles = [];
    this.enemies = [];
    this.symbols = new Map();      // event -> {fx, fy, home, enemy(visual), engaged, interp}
    this.passing = new Set();      // enemies the player is slipping through (a dodge)
    this.allies = new AllySystem(this);   // the party's other members, in the world
    // (a co-op guest: the host's enemies as it sees them - puppets, moved and judged by the host; netId -> body)
    this.puppets = new Map();
    this.puppetBattle = { done: false, puppet: true, enemies: [] };
    // (what a puppet's mark that follows the host follows: where this guest sees the host - coop.js hostChest; away:
    // another player's body as seen here, whose blows are its own to judge)
    this.hostTarget = { stands: true, alive: true, away: true, chest: out => G.coop?.hostChest?.(out) || G.player.headWorld(out) };
    this.projectiles = [];
    this.popups = [];
    this.playerDead = false;
    this.deathHandled = false;
    this.stamina = 1; this.staminaDelay = 0;
    this.healing = null;
    this.swing = null;            // desktop swing animation
    this.weapon = null; this.shield = null; this.wtype = 0;
    this.prevTip = new THREE.Vector3(); this.prevBase = new THREE.Vector3(); this.hasPrev = false;
    this.prevRel = new THREE.Vector3();   // the tip relative to the body last frame (swing speed)
    this.attackTokens = 0;
    this.rangedCooldown = 0;
    this.quick = new QuickRing();
    this.skillCD = {};             // skill id -> G.time when it can be used again
    this.fx = [];                  // short-lived flashes / tracers
    this.ready = null;             // a spell / throwable held in the right hand, waiting for the attack button
    this.held = null;              // VR: a herb bottle / syringe in the right hand, used at the mouth / on the body;
                                   // a resin in the left hand, rubbed onto the weapon
    this.skillArm = null;          // a weapon art waiting on the weapon (red): the next blow that lands is that skill
    this.disarmed = false;         // 무장해제: weapon and shield put away, the bare hands show and nothing they do hits
    this.weaponFx = new WeaponFx(this.root, () => this.glowTexture());
    this.fadingMarkers = [];
    this.waves = [];               // shockwaves running across the floor (a boss's quake / roar / wave)
    this.hazards = [];             // eruptions and pools a boss's move leaves on the floor for a while
    this.music = null;             // map BGM/BGS saved while battle music plays
    this.sideInterps = [];         // common events run by enemy skills (as a battle would run them)
    this.detached = [];            // event fights moved off the map's interpreter: {interp, battle, ev}
    this.defeated = new Map();     // event -> time its enemy was beaten on this visit (respawn hold)
  }
  get inCombat() { return this.battles.some(b => !b.done); }
  // a fight an event started (a boss, a '살해한다' fight...) - not a roaming monster's own, unless it is a boss of a map
  // that stays open (one boss at a time there: 소녀의 악몽's 시부치 waits while a girl's fight is on)
  eventFightOn() { return this.battles.some(b => !b.done && (!b.symbol || b.openBoss)) || this.openFightTroops(null).length > 0; }
  // a moment later - unless the fights are gone by then (the map changed, a rest at a bonfire)
  later(ms, fn) { const gen = this.gen; setTimeout(() => { if (gen === this.gen) fn(); }, ms); }

  // ---- lifecycle -------------------------------------------------------------
  // (keepState: a save is being loaded - the fights going away belong to the game left behind, not to it)
  reset({ keepState = false, carry = false } = {}) {
    // (carry - a map change: an event's run that is past its fight, in its win or lose branch, goes on on the new map as
    // the original's map interpreter would - 혼돈 던전 / 시공 던전's defeat, CE269, takes the party out and then lets the
    // menu and saving back; dropped with the old map, saving stayed shut until 고왕의 뼛가루. One still in its fight
    // ends with it)
    const carried = carry ? [...[...this.symbols.values()].map(s => s.interp), ...this.detached.map(d => d.interp), ...(this.carried || [])]
      .filter(it => it?.running() && it.foughtOut && !it.battle) : [];
    // a fight an event started and that ends unfinished (the map left, a rest at a bonfire) never happened: what that
    // event changed on its way to it goes back too, so its scene plays again from its start
    if (!keepState) for (const d of this.detached) if (d.battle && !d.battle.done) this.undoFightEvent(d.interp);
    G.arena?.release();                        // a closed boss arena opens with the fights gone
    G.theater?.reset();                        // (and a stage play's stage is taken down)
    G.player?.endAir?.();                      // (blown up into the sky by a wind: back on the ground)
    this.gen = (this.gen || 0) + 1;            // blows and shots still on their way belong to the old fights
    for (const e of this.enemies) e.remove();
    for (const s of this.symbols.values()) s.enemy?.remove();
    for (const e of this.puppets.values()) e.remove();
    this.puppets.clear();
    for (const p of this.projectiles) this.root.remove(p.mesh);
    for (const p of this.popups) this.root.remove(p.sprite);
    for (const f of this.fx) this.root.remove(f.obj);
    for (const e of this.enemies) e.marker?.dispose();
    for (const s of this.symbols.values()) s.enemy?.marker?.dispose();
    for (const m of this.fadingMarkers) m.dispose();
    for (const m of this.areaMarks || []) m.mk.dispose();
    this.areaMarks = [];
    for (const w of this.waves) this.root.remove(w.mesh);
    for (const h of this.hazards) { if (h.mesh) this.root.remove(h.mesh); h.mk?.dispose(); }
    this.hazards = [];
    for (const e of this.enemies) this.hideBlade(e);
    // any enemy body (or shockwave) no list holds any more goes too
    for (const ch of [...this.root.children]) if (ch.userData.enemy || ch.userData.transient) this.root.remove(ch);
    // a fight left unfinished (walked away from through an exit - 소녀의 악몽's open fights): the battle music its event
    // chose goes back to what it was, as its win or lose branch would have put it
    const unfinished = [...[...this.symbols.values()].filter(s => s.engaged && s.interp).map(s => s.interp), ...this.detached.map(d => d.interp)];
    for (const it of unfinished) if (it && it.running() && it.battle && !it.battle.done && it.battleBgmBefore !== undefined) G.state.system.battleBgm = it.battleBgmBefore;
    this.enemies = []; this.battles = []; this.symbols.clear(); this.projectiles = []; this.popups = []; this.fx = []; this.fadingMarkers = []; this.waves = [];
    // (the fights gone: what my own skills gave me for them goes too - fightState; a save being loaded keeps its own)
    if (this.fightStates && !keepState) { const a = G.state?.party?.leader(); for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s); }
    this.fightStates = null;
    this.quick.close();
    this.cancelReady();
    this.cancelHeld();
    for (const d of this.detached) { if (!carried.includes(d.interp)) d.interp.terminate(); d.ev?.unlock?.(); }
    this.detached = [];
    this.sideInterps = [];
    this.carried = carried;
    this.defeated.clear();
    if (this.music) { G.audio?.restore(this.music.saved); this.music = null; }
    G.screen?.clearAnims?.();
    this.playerDead = false; this.deathHandled = false;
    this.allies?.reset();
    clearEdgeCache();
  }
  // what a fight's enemies left going - shots in the air, shockwaves, pools and eruptions - gone at once (a stage
  // play's curtain closing on an act)
  clearEnemyFx(battle) {
    const mine = x => x?.battle === battle;
    this.projectiles = this.projectiles.filter(p => {
      if (p.owner !== 'enemy' || !mine(p.enemy)) return true;
      this.root.remove(p.mesh);
      return false;
    });
    this.waves = this.waves.filter(w => {
      if (!mine(w.e)) return true;
      this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
      return false;
    });
    this.hazards = this.hazards.filter(h => {
      if (!mine(h.e)) return true;
      if (h.mesh) { this.root.remove(h.mesh); h.mesh.material.dispose(); }
      if (h.mk) this.fadingMarkers.push(h.mk);
      return false;
    });
  }
  onMapLoaded() {
    this.reset({ carry: true });                // (a run carried over from the map left goes on - reset)
    G.theater?.prepare();                      // (a map a play is put on: its lights hung now, dark)
    this.reviveEnemies(false);
    for (const ev of G.map.eventList) this.onEventPageChanged(ev);
  }

  // ---- bonfire -------------------------------------------------------------------
  // Resting at a bonfire (CE 篝火) brings every enemy back, as a Souls bonfire does: the fights here end,
  // beaten field enemies stand again at once and the living ones go home healed; on other maps beaten
  // enemies are back as soon as the player arrives there.
  restAtBonfire() {
    const sys = G.state.system;
    sys.bonfireRest = (sys.bonfireRest || 0) + 1;
    for (const s of this.symbols.values()) if (s.engaged) s.ev.unlock?.();
    this.reset();
    this.reviveEnemies(true);
    for (const ev of G.map.eventList) this.onEventPageChanged(ev);
  }
  // a beaten (or escaped) enemy's page that brings it back after a while: parallel, of an enemy's event, only its own
  // moves and waits and a self switch turned back off - a co-op guest leading a map runs it too (character.js)
  comebackPage(ev) {
    const page = ev.page;
    if (!page || ev.trigger !== 4) return false;
    if (page._comeback === undefined) {
      const list = page.list || [], quiet = new Set([0, 108, 408, 230, 505]);
      page._comeback = list.some(c => c.code === 123 && c.parameters[1] === 1)
        && list.every(c => quiet.has(c.code) || (c.code === 123 && c.parameters[1] === 1) || (c.code === 205 && c.parameters[0] === 0))
        && (ev.event?.pages || []).some(p => p.list?.some(c => c.code === 301));
    }
    return page._comeback;
  }
  // beaten enemies wait on a page that turns their self switch back after a while (원작 10 s): turn it
  // back now, once per map after each rest (home: the living ones also walk back to their places)
  reviveEnemies(home) {
    const sys = G.state.system, mapId = G.map.mapId;
    sys.restSeen = sys.restSeen || {};
    if (!home && (sys.restSeen[mapId] ?? -1) >= (sys.bonfireRest || 0)) return;
    sys.restSeen[mapId] = sys.bonfireRest || 0;
    let changed = false;
    for (const ev of G.map.eventList) {
      const pages = ev.event?.pages || [];
      if (!pages.some(p => p.list?.some(c => c.code === 301))) continue;      // not an enemy
      const page = ev.page;
      if (page && page.trigger === 4) {
        for (const c of page.list || []) {
          if (c.code === 123 && c.parameters[1] === 1) { G.state.setSelfSw(mapId, ev.id, c.parameters[0], false); changed = true; }
        }
      }
      if (home && (ev.x !== ev.event.x || ev.y !== ev.event.y)) ev.moveto(ev.event.x, ev.event.y);
    }
    if (changed) G.map.refresh();
  }

  // ---- symbol enemies -----------------------------------------------------------
  isSymbolPage(ev) {
    return ev.symbolId != null && ev.page && ev.list && ev.list.some(c => c.code === 301) && [1, 2].includes(ev.trigger);
  }
  // (the developer's world) a roaming monster only this player's own state brings out - low SEN's (SEN 0: the
  // hallucinations of 안개 공원, the patients, the chess pieces, 리펀 대성당's snake spirits ...), the snake god's
  // curse's - one no page of its event shows without it (not one that is there anyway and only looks otherwise at SEN 0:
  // 피눈물 웅덩이's, the map runner's as ever). This player's own to see and fight wherever it is, whoever runs the map,
  // and nobody else's: the others see it fight thin air (coopworld personalPage)
  privateSymbol(ev) {
    if (!G.coop?.world || !this.isSymbolPage(ev) || !personalPage(ev.page)) return false;
    return !(ev.event?.pages || []).some(p => p !== ev.page && !personalPage(p) && symbolPage(p));
  }
  // a hallucination by its event and page ('id:page'): the same seen by another is the same one (coop.js - seen together)
  hallKey(ev) { return `${ev.id}:${(ev.event?.pages || []).indexOf(ev.page)}`; }
  hallKeysSeen() { return (G.map?.eventList || []).filter(ev => this.privateSymbol(ev)).slice(0, 64).map(ev => this.hallKey(ev)); }
  seesHallucination(key) { return (G.map?.eventList || []).some(ev => this.privateSymbol(ev) && this.hallKey(ev) === key); }
  // the hallucinations this player runs, by key: the body roaming, or the enemies of its fight - and how long it has run it
  hallGroups() {
    const out = new Map();
    for (const s of this.symbols.values()) {
      if (!s.private || !s.hallKey) continue;
      const age = G.time - (s.claimT ?? G.time);
      const b = s.engaged ? this.battles.find(x => x.private && x.hallKey === s.hallKey && !x.done) : null;
      if (b) out.set(s.hallKey, { age, sym: null, enemies: b.enemies.filter(e => e.mesh && e.state !== 'dead') });
      else if (s.enemy?.mesh && s.enemy.state !== 'dead') out.set(s.hallKey, { age, sym: s, enemies: [s.enemy] });
    }
    return out;
  }
  hallAge(key) { const s = [...this.symbols.values()].find(x => x.private && x.hallKey === key); return s ? G.time - (s.claimT ?? G.time) : null; }
  // (another player runs it for this one too - coop.js followHall) its own put away: the body, its fight with it
  yieldHallucination(key) {
    for (const [ev, s] of [...this.symbols]) {
      if (!s.private || s.hallKey !== key) continue;
      s.interp?.terminate?.();
      ev.unlock?.();
      s.enemy?.marker?.dispose(); s.enemy?.remove();
      this.symbols.delete(ev);
    }
    for (const b of this.battles) {
      if (!b.private || b.hallKey !== key || b.done) continue;
      for (const e of b.enemies) { e.marker?.dispose(); this.hideBlade(e); e.remove(); }
      this.enemies = this.enemies.filter(e => !b.enemies.includes(e));
      this.projectiles = this.projectiles.filter(p => { if (!b.enemies.includes(p.enemy)) return true; this.root.remove(p.mesh); return false; });
      b.done = true; b.result = 1;
      if (b.interpreter?.battle === b) b.interpreter.battle = null;      // (its event's run is over with it)
    }
    this.battles = this.battles.filter(b => !b.done || b.interpreter?.battle === b);
    this.detached = this.detached.filter(d => { if (!(d.battle?.private && d.battle.hallKey === key)) return true; d.interp.terminate(); d.ev?.unlock?.(); return false; });
    if (!this.battles.some(b => !b.done) && this.music) { G.audio?.restore(this.music.saved); this.music = null; }
  }
  // (following it ended) its own again - a fresh one, where it begins
  resumeHallucination(key) {
    const ev = (G.map?.eventList || []).find(e => this.privateSymbol(e) && this.hallKey(e) === key);
    if (ev) this.onEventPageChanged(ev);
  }
  // (fought with the one running it, and beaten there) beaten here too, as if this player had: its own fight with it
  // begins and is won at once - what it gives, its event's win as ever
  winHallucination(key) {
    const ev = (G.map?.eventList || []).find(e => this.privateSymbol(e) && this.hallKey(e) === key);
    if (!ev) return;
    this.onEventPageChanged(ev);
    const s = this.symbols.get(ev);
    if (!s || s.engaged) return;
    s.autoWin = true;
    this.engage(ev, true);
  }
  // the copies of hallucinations another runs (all, that one's, or that one's of one key)
  dropHallPuppets(src = null, key = null) {
    for (const [k, e] of [...this.puppets]) {
      if (!e.src || (src && e.src !== src) || (key && e.hallKey !== key)) continue;
      e.remove(); this.puppets.delete(k);
    }
  }
  controlsEvent(ev) { return this.symbols.has(ev) && this.isSymbolPage(ev); }
  // an area's ordinary monster, roaming or not: it comes back once beaten (a page of its event turns its self switch
  // back off - the 원작 comeback of field enemies) - never a boss, whatever music it fights to (윈터벨's orcs, snow
  // tigers, invisible horses, winter knights... to 裏ボス; 리델 묘지's grave robbers to their own)
  comesBack(ev) {
    const pages = ev?.event?.pages;
    return !!pages && (ev._comesBack ??= pages.some(p => p.list?.some(c => c.code === 123 && c.parameters[1] === 1)));
  }
  // a roaming boss, not one of an area's ordinary monsters: it never comes back once beaten (comesBack) and at most
  // two events on the map fight its troop (윈터벨's slimes: thirty)
  oneOffSymbol(sym, troopId) {
    if (this.comesBack(sym.ev)) return false;
    const fights = ev => (ev.event?.pages || []).some(p => p.list?.some(c => c.code === 301 && c.parameters[0] === 0 && c.parameters[1] === troopId));
    return G.map.eventList.filter(fights).length <= 2;
  }
  // a boss fight on a map that stays open (maphints openFights - 소녀의 악몽): the arena would have hidden the map's
  // other events; here only this fight's own step out of sight - the events whose troops share its enemies (the
  // second of 트위들 쌍둥이's two, the tea party's three, each starting the one fight) - and the map's other bosses
  // do not take one up while it lasts (one at a time, as in the original) unless struck
  // (the troops of the boss fights on - or about to start: a symbol that has taken one up runs its event first)
  openFightTroops(except) {
    const out = [];
    if (!openFights(G.map?.mapId)) return out;
    for (const s of this.symbols.values()) if (s.engaged && s.ev !== except && (s.oneOff ??= this.oneOffSymbol(s, s.troopId))) out.push(s.troopId);
    for (const b of this.battles) if (!b.done && b.openBoss && b.event !== except) out.push(b.troop?.id);
    return out;
  }
  sharesOpenFight(ev) {
    const s = this.symbols.get(ev);
    if (!s || s.engaged) return false;
    const fights = this.openFightTroops(ev);
    if (!fights.length) return false;
    const mine = new Set(($data.troops[s.troopId]?.members || []).map(m => m.enemy_id));
    return fights.some(id => ($data.troops[id]?.members || []).some(m => mine.has(m.enemy_id)));
  }
  waitsForOpenFight(ev) {
    const s = this.symbols.get(ev);
    if (!s || s.engaged || !this.openFightTroops(ev).length) return false;
    return (s.oneOff ??= this.oneOffSymbol(s, s.troopId));
  }
  // the event that started a fight is replaced by the 3D enemies while it lasts; a beaten enemy's event
  // stays out of sight while its comeback is held
  hidesEvent(ev) { return this.controlsEvent(ev) || this.eventInBattle(ev) || this.holdsPage(ev) || !!G.arena?.hides(ev) || this.sharesOpenFight(ev) || this.phantomHides(ev); }
  // a co-op phantom does not meet the host world's roaming monsters of its own where another runs the map (they are that
  // one's there - its puppets); on a map it leads it meets them as in its own game (ownMapMonsters) - in the developer's
  // world the same: the one running the map runs its monsters
  phantomHides(ev) {
    if (!G.coop?.shared || !this.isSymbolPage(ev)) return false;
    if (this.privateSymbol(ev)) return !!G.coop.hallFollowing?.(this.hallKey(ev));     // (seen with another, who runs it)
    return !G.coop.leadsNow;
  }
  // (a guest leading a map) one of its roaming bosses: its fight begins only by way of the host - asked to come to it, or
  // letting the guests fight it (coop.js askBossStart, leadStart: bossGo)
  leadBoss(s) { return !!G.coop?.phantom && G.coop.leadsNow && G.coop.bossGo !== s.ev && this.symbolIsBoss(s); }
  // such a boss struck before its fight began: the host is asked (engage) - nothing lands meanwhile
  heldBoss(e) {
    if (e.battle || !G.coop?.leadsNow) return false;
    const sym = [...this.symbols.values()].find(s => s.enemy === e);
    if (!sym || !this.leadBoss(sym)) return false;
    this.engage(sym.ev, true);
    return true;
  }
  eventInBattle(ev) { return this.battles.some(b => !b.done && b.event === ev) || this.detached.some(d => d.ev === ev); }
  // 원작: beaten field enemies come back 10 s later (their self switch D page waits 600 frames, then
  // switches back). That suits battles that freeze the map; fought in real time they seem to never go
  // away, so by default the comeback waits until the player has left the map (setting 쓰러뜨린 적 부활)
  holdsPage(ev) {
    const mode = G.settings.respawn || 'map';
    if (mode === 'original' || !this.defeated.has(ev)) return false;
    const page = ev.page;
    if (!page || ev.trigger !== 4) return false;
    if (page._respawn === undefined) page._respawn = (page.list || []).some(c => c.code === 123 && c.parameters[1] === 1);
    if (!page._respawn) return false;
    if (mode === 'map') return true;
    const pc = G.map.playerChar;
    return G.time - this.defeated.get(ev) < 60 || Math.hypot(G.map.nearX(ev.x, pc.fx) - pc.fx, G.map.nearY(ev.y, pc.fy) - pc.fy) < 8;
  }
  // a fight started by touching / talking to an event: the event's commands wait for the result on
  // their own, so the menu, exits and other events stay usable meanwhile
  // what the events of the fights still on changed before them ([key, value before]: 'S:id', 'V:id', 'SS:selfKey') - a
  // save made now keeps those as they were, so the scene plays again once loaded (main.js saveVr)
  pendingUndo() {
    const out = [];
    for (const d of this.detached) if (d.battle && !d.battle.done && d.interp.undo) out.push(...d.interp.undo);
    return out;
  }
  undoFightEvent(interp) {
    for (const [key, old] of interp?.undo || []) {
      const at = key.indexOf(':'), kind = key.slice(0, at), id = key.slice(at + 1);
      if (kind === 'S') G.state.setSw(+id, old);
      else if (kind === 'V') G.state.setV(+id, old);
      else if (kind === 'SS') { const [m, e, ch] = id.split(','); G.state.setSelfSw(+m, +e, ch, old); }
    }
    if (interp) interp.undo = null;
  }
  detachInterpreter(interp, battle) {
    const ev = interp.event();
    interp.main = false;             // its death common event (全滅処理) is handed back to the map
    this.detached.push({ interp, battle, ev });
    G.map.interpreter = new Interpreter(0, true);
  }
  onEventPageChanged(ev) {
    const s = this.symbols.get(ev), mine = this.privateSymbol(ev);
    if (G.coop?.shared && !G.coop.leadsNow && !mine && !s?.private) return;      // (phantomHides: but its own hallucinations)
    if (this.isSymbolPage(ev)) {
      const key = mine ? this.hallKey(ev) : null, followed = !!key && !!G.coop?.hallFollowing?.(key);
      // (one that turned from a hallucination into a monster of the map's, or back, or into another: made anew as what it
      // is now - and not at all while another player runs it for this one too)
      if (s && !s.engaged && (!!s.private !== mine || (s.hallKey || null) !== key || followed)) {
        s.enemy?.remove(); this.symbols.delete(ev);
        if (!followed) this.onEventPageChanged(ev);
        return;
      }
      if (!s && followed) return;
      if (!s) {
        const troopId = ev.battleTroopId();
        const member = $data.troops[troopId]?.members?.find(m => !m.hidden) || $data.troops[troopId]?.members?.[0];
        const sym = { ev, fx: ev.x, fy: ev.y, homeX: ev.x, homeY: ev.y, engaged: false, interp: null, troopId, wander: null, private: mine, hallKey: key, claimT: G.time };
        if (member) {
          sym.enemy = new ActionEnemy(this, null, member.enemy_id, ev.x, ev.y, { dormant: true });
          sym.enemy.balloonOf = ev;              // (it shows the event's balloon icons)
          if (mine) this.makePrivate(sym.enemy, key);
        }
        this.symbols.set(ev, sym);
      }
    } else if (s && !s.engaged) {
      s.enemy?.remove();
      this.symbols.delete(ev);
    }
  }
  // (co-op guest - coop.js mapNow) the one who runs the map it stands on changed: the puppets the one before sent go (and
  // their shots - the one now sends its own); leading it now, its roaming monsters are this game's to run (own: its
  // symbols come - onEventPageChanged; its bosses too, begun by way of the host: leadBoss); else its own go - their
  // fights end
  ownMapMonsters(own) {
    for (const e of this.puppets.values()) e.remove();
    this.puppets.clear();
    this.projectiles = this.projectiles.filter(p => { if (!p.ghost) return true; this.root.remove(p.mesh); return false; });
    if (own) {
      for (const ev of G.map.eventList) this.onEventPageChanged(ev);
      return;
    }
    if (!this.symbols.size && !this.enemies.length && !this.battles.length) return;
    // (its own hallucinations stay - privateSymbol: their fights go on whoever runs the map)
    for (const [ev, s] of [...this.symbols]) {
      if (s.private) continue;
      if (s.engaged) s.ev.unlock?.();
      s.enemy?.marker?.dispose(); s.enemy?.remove();
      this.symbols.delete(ev);
    }
    for (const e of this.enemies) { if (e.private) continue; e.marker?.dispose(); this.hideBlade(e); e.remove(); }
    this.enemies = this.enemies.filter(e => e.private);
    for (const b of this.battles) if (!b.private) { b.done = true; b.result = 1; }
    this.battles = this.battles.filter(b => b.private);
    for (const d of this.detached) {
      if (d.battle?.private) continue;
      d.interp.terminate(); d.ev?.unlock?.(); if (d.ev) G.coop?.eventDone?.(d.interp.mapId, d.ev.id);
    }
    this.detached = this.detached.filter(d => d.battle?.private);
    this.projectiles = this.projectiles.filter(p => { if (p.owner !== 'enemy' || p.ghost || p.enemy?.private) return true; this.root.remove(p.mesh); return false; });
    if (this.battles.some(b => !b.done)) return;
    if (this.fightStates) { const a = G.state?.party?.leader(); for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s); this.fightStates = null; }
    if (this.music) { G.audio?.restore(this.music.saved); this.music = null; }
  }
  // (a hallucination - privateSymbol - and the enemies of its fight) never among the map's monsters sent to everyone: only to
  // those who see it too (coop.js audience, sendHallucinations)
  makePrivate(e, key) { e.private = true; e.hallKey = key; }
  symbolSetting(ev) {
    return G.scripts.symbols?.[ev.symbolId] || { range: 3, dashRange: 4, idleMode: 1, speedAfter: 4 };
  }
  // called when a symbol event would start (touch/bump/action) -> fight in real time instead
  engage(ev, hit = false) {
    const s = this.symbols.get(ev);
    if (!s || !this.isSymbolPage(ev)) return false;
    if (s.engaged || this.playerDead) return true;
    if (this.leadBoss(s)) { G.coop.askBossStart([ev], hit ? 'bump' : 'touch'); return true; }
    if (this.sharesOpenFight(ev) || (!hit && this.waitsForOpenFight(ev))) return true;
    s.engaged = true;
    s.interp = new Interpreter(1, false, 'symbol');
    s.interp.setup(ev.list, ev.id);
    ev.lock?.();
    return true;
  }

  // ---- battle processing -----------------------------------------------------------
  startBattle({ troopId, canEscape, canLose, event, interpreter }) {
    // a fight begun while the last one's defeat is still being played out is fought standing: 그랑・기뇰's 재도전
    // starts it again from the same event (never idle in between), after its lose branch brought the party back
    if (this.playerDead && (G.state.party.leader()?.hp || 0) > 0) { this.playerDead = false; this.deathHandled = false; }
    const sym = event ? this.symbols.get(event) : null;
    const battle = new Battle(this, { troopId, canEscape, canLose, event, interpreter, symbol: sym, private: !!sym?.private, hallKey: sym?.hallKey || null });
    this.battles.push(battle);
    G.state.system.battleCount++;
    const members = battle.troop?.members || [];
    // anchor: symbol body, visible event, or in front of the player - or, a boss fight a co-op guest began, of that guest
    let ax, ay;
    const by = G.coop?.bossStarterAt?.(), pc = G.map.playerChar, who = by || pc;
    if (sym?.enemy) { ax = sym.enemy.fx; ay = sym.enemy.fy; }
    else if (event && event.characterName && Math.hypot(event.x - who.fx, event.y - who.fy) < 9) { ax = event.x; ay = event.y; }
    else {
      const f = by ? { x: by.d === 4 ? -1 : by.d === 6 ? 1 : 0, z: by.d === 8 ? -1 : by.d === 2 ? 1 : 0 } : G.player.forward2D();
      ax = who.fx + f.x * 3.2; ay = who.fy + f.z * 3.2;
      [ax, ay] = resolveCircle(ax, ay, 0.45);
    }
    const sorted = members.map((m, i) => ({ m, i })).sort((a, b) => a.m.x - b.m.x);
    const toP = Math.atan2(who.fy - ay, who.fx - ax);
    // the body standing on the field becomes the first visible member of its kind (a troop's leftmost member
    // can be a hidden one that comes out later); with none of its kind it leaves - never a second body
    // standing by, to be left behind when the fight ends
    const own = sym?.enemy ? sorted.find(({ m }) => !m.hidden && m.enemy_id === sym.enemy.b.enemyId) : null;
    if (sym?.enemy && !own) { sym.enemy.remove(); sym.enemy = null; }
    sorted.forEach(({ m }, k) => {
      let e;
      if (own?.m === m && sym?.enemy) {
        e = sym.enemy; sym.enemy = null;
        e.battle = battle; e.state = 'chase'; e.alertTime = 0.4;
      } else {
        const lateral = (k - (sorted.length - 1) / 2) * 1.1;
        let fx = ax + Math.cos(toP + Math.PI / 2) * lateral - Math.cos(toP) * 0.4;
        let fy = ay + Math.sin(toP + Math.PI / 2) * lateral - Math.sin(toP) * 0.4;
        [fx, fy] = resolveCircle(fx, fy, 0.35);
        e = new ActionEnemy(this, battle, m.enemy_id, fx, fy, { hidden: m.hidden });
        e.alertTime = 0.8 + k * 0.3;
      }
      e.memberIndex = members.indexOf(m);
      if (battle.private) this.makePrivate(e, battle.hallKey);
      battle.enemies.push(e);
      this.enemies.push(e);
    });
    // (a hallucination beaten with another, who ran it - winHallucination: this player's own falls at once)
    if (sym?.autoWin) { sym.autoWin = false; for (const e of battle.enemies) if (!e.hidden) { e.b.hp = 0; this.killEnemy(e); } }
    // what their notes do as a fight starts (script 190: 섬뜩한 힌들리, 펜릴... all stats up; the player's 거룩한 총검,
    // 독사의 옷, 꿀벌의 반지, 광란왕의 반지, 나의 투쟁의 반지, 극작가의 두건, 방왕의 반지)
    for (const e of battle.enemies) this.battleStart(e.b, e, battle);
    const leader = G.state.party.leader();
    if (leader && !this.playerDead) this.battleStart(leader, null, battle);
    // a stage play (그랑・기뇰): the troop takes its places on the stage (src/theater.js)
    G.theater?.begin(battle);
    // a boss fight: its big ones (at most three) use some of their skills as moves of their own (bossFamily) - not
    // one with an area's ordinary monsters (comesBack: no arena closing the way out, nothing of co-op's boss fights)
    if (battle.enemies.length && this.isBossFight(interpreter, battle.troop) && !this.comesBack(sym?.ev || event)) {
      battle.bossFight = true;
      this.refreshBosses(battle);
      // the arena closes (src/arena.js) - also for a boss that comes in several equal parts (그랑・기뇰, 반상의
      // 고왕, 흰 유니콘 유니스); started by a roaming enemy only when that is a one-off boss (도도, 그리피, the
      // nightmares of 소녀의 악몽...)
      if (!sym || this.oneOffSymbol(sym, troopId)) {
        if (openFights(G.map.mapId)) battle.openBoss = true;
        else G.arena?.begin(battle, by);            // (where the fight began: the guest's, if a guest began it)
      }
      // (the roaming monsters still after the player do not follow into the fog: as if escaped - they go back,
      // to come again as the original's escape lets them)
      if (G.arena?.active && G.arena.battle === battle) for (const b of this.battles) if (b !== battle && !b.done && b.symbol) b.finish(1);
      // (co-op: the players not in it are asked whether to join it - coop.js; not to a hallucination's)
      if (!battle.private) G.coop?.onBossFightBegin?.(battle);
    }
    if (battle.enemies.length) this.battleMusicStart();
    if (!battle.enemies.length) battle.finish(0);
    else if (!sym) G.audio?.playSystemSe(7);
    return battle;
  }
  battleStart(b, e, battle) {
    const turn = e ? ENEMY_TURN : TURN_SECONDS;
    for (const o of b.featureObjects()) {
      if (!o) continue;
      for (const { tag, a } of battleStartEffects(o)) {
        if (!(b.evalNote(a[a.length - 1]) > Math.random() * 100)) continue;
        const v = b.evalNote(a[0]);
        switch (tag) {
          case 0: b.hp = Math.max(0, Math.min(b.mhp, b.hp + Math.trunc(v))); break;
          case 1: b.hp = Math.max(0, Math.min(b.mhp, b.hp + Math.trunc(v * b.mhp / 100))); break;
          case 2: b.mp = Math.max(0, Math.min(b.mmp, b.mp + Math.trunc(v))); break;
          case 3: b.mp = Math.max(0, Math.min(b.mmp, b.mp + Math.trunc(v * b.mmp / 100))); break;
          case 6:
            if (e) this.addEnemyState(e, v, true);
            else if (!b.stateResist(v)) {
              b.addState(v); this.timeActorState(v);
              // (one the original takes away as a fight ends goes with this one - 거룩한 총검's bullets start at 1 again)
              if ($data.states[v]?.remove_at_battle_end) (battle.eventStates ||= []).push([b, v]);
            }
            break;
          case 7:
            b.removeState(v);
            if (e?.stateTimers) delete e.stateTimers[v];
            if (!e && G.state.system.stateTimers) delete G.state.system.stateTimers[v];
            break;
          case 8: b.addBuff(v, b.evalNote(a[1]) * turn); break;
          case 9: if (b.buffs[v] > 0) b.removeBuff(v); break;
          case 10: b.addDebuff(v, b.evalNote(a[1]) * turn); break;
          case 11: if (b.buffs[v] < 0) b.removeBuff(v); break;
          default: break;
        }
      }
    }
    if (e) e.drawBar?.();
  }
  // ---- battle music (BattleManager): the map's BGM/BGS are kept, the battle BGM plays, a won fight
  // plays the battle end ME, then the map music comes back where it was. Setting 전투 BGM: 'boss' plays
  // it only when an event chose a battle BGM other than the usual one (the boss themes); 'all' every
  // fight like the original. Music the troop's own events start mid-fight (boss phases) plays either way.
  battleMusicStart() {
    const usual = $data.system.battle_bgm;
    const bgm = G.state.system.battleBgm || usual;
    const special = !!bgm?.name && bgm.name !== usual?.name;
    const play = (G.settings.battleBgm || 'boss') === 'all' ? !!bgm?.name : special;
    if (this.music) {
      // fights overlap: the first one saved the map music - but a boss's own theme still comes in over a plain
      // fight going on (monsters still after the player as the boss's scene starts)
      if (play && bgm.name !== this.music.bgm) { this.music.played = true; this.music.bgm = bgm.name; G.audio?.playBgm(bgm); G.audio?.stopBgs(); }
      return;
    }
    this.music = { saved: G.audio?.snapshot(), played: play, bgm: play ? bgm.name : '' };
    if (play) { G.audio?.playBgm(bgm); G.audio?.stopBgs(); }
  }
  deferMapMusic(kind, audio) {
    const s = this.music?.saved;
    if (!s) return;
    if (!audio?.name) { s[kind] = null; return; }
    if (s[kind]?.name === audio.name) { s[kind].volume = audio.volume; s[kind].pitch = audio.pitch; return; }
    s[kind] = { name: audio.name, volume: audio.volume, pitch: audio.pitch, pos: 0 };
  }
  battleMusicEnd(result) {
    if (!this.music || this.battles.some(b => !b.done)) return;
    const m = this.music;
    this.music = null;
    G.audio?.restore(m.saved);
    if (result === 0 && m.played) G.audio?.playMe(G.state.system.battleEndMe || $data.system.battle_end_me);
  }
  onBattleEnd(battle) {
    G.player.floatDown?.();                         // (blown up by the wind when it ended: let down gently)
    if (battle.result === 0 && battle.private) G.coop?.hallucinationBeaten?.(battle.hallKey);
    if (battle.result === 0) {
      let gold = 0, exp = 0;
      // (rings and oaths: twice the souls, twice the drop chance; the experience rate)
      // (the difficulty: more souls the harder - but for <お金変動無効> - and so on, script 218)
      const party = G.state.party, dropRate = (party.partyAbility(5) ? 2 : 1) * difficultyRate(10);
      for (const e of battle.enemies) {
        if (e.escaped || e.hidden) continue;       // (VX Ace's rewards are the fallen's: not one that left - enemyEscape -, nor one that never came out)
        const note = e.data.note || '';
        gold += /<お金変動無効>/.test(note) ? e.data.gold || 0 : Math.round((e.data.gold || 0) * difficultyRate(9));
        exp += /<経験値変動無効>/.test(note) ? e.data.exp || 0 : Math.round((e.data.exp || 0) * difficultyRate(8));
        for (const di of e.data.drop_items || []) {
          if (di.kind > 0 && di.denominator > 0 && Math.random() * di.denominator < dropRate) {
            const kind = ['', 'item', 'weapon', 'armor'][di.kind];
            G.state.party.gainItem(kind, di.data_id, 1);
            G.ui.notifyGain(kind, di.data_id, 1);
          }
        }
      }
      if (gold && party.partyAbility(4)) gold *= 2;
      if (gold) { party.gainGold(gold); G.ui.notifyGold?.(gold); }
      if (exp) for (const a of party.members()) a.changeExp(a.currentExp + Math.floor(exp * a.exr));
      G.state.system.winCount++;
      if (battle.event) this.defeated.set(battle.event, G.time);
    } else if (battle.result === 2 && !battle.canLose) {
      this.onPartyDead();
    } else if (battle.result === 1) {
      G.state.system.escapeCount++;
      for (const e of battle.enemies) if (e.alive) { e.state = 'dying'; e.timer = 0; e.fadeOnly = true; }
    }
    if (battle.symbol) {
      const s = battle.symbol;
      if (s.enemy && !s.enemy.battle) s.enemy.remove();      // (a body that stood by - there should be none)
      s.enemy = null;
      s.fx = s.homeX; s.fy = s.homeY;
    }
    // the states its events gave the party for this fight (and the rest of the chain they went round to) go with it
    for (const [a, id] of battle.eventStates || []) {
      const chain = new Set([id]);
      for (const s of chain) for (const n of this.stateExpired(a, s)) chain.add(n);
      for (const s of chain) if ($data.states[s]?.remove_at_battle_end && a.isState(s)) {
        a.removeState(s);
        if (G.state.system.stateTimers) delete G.state.system.stateTimers[s];
      }
    }
    // (the last fight over: what my own skills gave me for the fighting goes - fightState)
    if (this.fightStates && !this.inCombat) {
      const a = G.state.party.leader();
      for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s);
      this.fightStates = null;
    }
    this.battleMusicEnd(battle.result);
    G.arena?.battleEnded(battle);
    G.theater?.battleEnded(battle);
    G.coop?.onBossFightEnd?.(battle);           // (co-op: those watching it fallen are up again)
  }
  // enemy conditions for conditional branch type 5
  // the battle a troop event belongs to (several fights can run at once)
  battleOf(interp) {
    const root = interp ? (interp.root || interp) : null;
    return (root && this.battles.find(x => x.troopInterp === root)) || this.battles.find(x => !x.done);
  }
  enemyCondition(index, sub, stateId, interp) {
    const b = this.battleOf(interp);
    const e = b?.enemies.find(x => x.memberIndex === index);
    if (!e) return false;
    return sub === 0 ? !e.hidden && e.alive : e.b.isState(stateId);
  }
  troopCommand(code, p, interp) {
    const b = this.battleOf(interp);
    if (!b) return;
    // (Force Action names its battler as a kind and an index - 0 an enemy, 1 a party member, not here; the rest
    // name the enemy first, -1 for all of them)
    if (code === 339 && p[0] !== 0) return;
    const at = code === 339 ? p[1] : p[0];
    const targets = at < 0 ? b.enemies : b.enemies.filter(e => e.memberIndex === at);
    for (const e of targets) {
      if (code === 331) {
        if (!e.alive) continue;                    // VX Ace skips the dead
        // (a boss made stronger for a co-op fight: as many times more - the same share of it as alone, as the
        // original's phases mean it: 트위들 쌍둥이 come back with what 90000 leaves of them)
        const v = Math.round((p[1] === 0 ? 1 : -1) * (p[2] === 0 ? p[3] : G.state.v(p[3])) * (e.b.coopK || 1));
        e.b.hp = Math.max(p[4] ? 0 : 1, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar(); this.checkEnemyDeath(e);
      }
      if (code === 333) {
        if (p[1] === 0 && e.hidden) continue;      // (as VX Ace's add_state: one still hidden takes none - not even death)
        if (p[1] === 0) {
          const st = $data.states[p[2]];
          // as VX Ace's add_state: death fells it there and then (unless it resists it - 불사신), and a state that
          // wears off by itself does so here too (a boss's "do nothing" turn as a phase begins, a stance that goes
          // round); one that never wears off stays until an event takes it away
          if (p[2] === 1) { if (e.alive && !e.b.stateResist(1)) { e.b.hp = 0; this.killEnemy(e); } }
          else if (st?.auto_removal_timing) this.addEnemyState(e, p[2], true);
          else { e.b.addState(p[2]); this.markBreakOpen(e, p[2]); }
        } else {
          e.b.removeState(p[2]); if (e.stateTimers) delete e.stateTimers[p[2]]; if (e.actionStates) delete e.actionStates[p[2]];
          // (its Break taken away - the lion's roar as it is broken: it is up again at once)
          if ((p[2] === 7 || p[2] === 8) && e.state === 'stagger') this.endStagger(e);
        }
        this.checkEnemyDeath(e);
      }
      if (code === 334) {
        // Recover All also brings back an enemy that has just fallen: a boss phase is often "lose the
        // immortality, fall, transform, recover" in one event, all in the same moment
        const down = e.state === 'dying' || e.state === 'dead';
        e.b.recoverAll(); this.pruneStateTimers(e);
        if (down) this.reviveEnemy(e);
        e.drawBar();
      }
      if (code === 339) { const s = $data.skills[p[2]]; if (s && e.alive) { e.forcedSkill = s; e.cooldown = 0; e.alertTime = 0; } }
      if (code === 337 && p[1] > 0 && e.alive && !e.hidden) {
        const wp = e.worldPos(new THREE.Vector3());
        // (a timing that hides its target - グラン形態変化 - hides the enemy that long: Sprite_Base's flash(nil))
        G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + (e.hover || 0) + (e.h || 1.6) * 0.5, wp.z), p[1], { height: e.h || 1.6,
          onHide: frames => { e.hideUntil = G.time + frames / 60; } });
        G.theater?.animated(e);
      }
      if (code === 335 && e.hidden) { e.hidden = false; G.theater?.onAppear(e); }
      if (code === 336) { this.transformEnemy(e, p[1]); if (interp?.troop) this.dropPendingForms(b, e.memberIndex, interp); }
    }
    if (code === 340) b.finish(1);
    if (code === 335 || code === 336) this.refreshBosses(b);
  }
  // A troop page changing an enemy's form: the 擬態 pages that would change it again a moment later stand down - pages waiting
  // on a switch alone, at any moment (span 2), that change the same enemy, their switch turned on by a skill of the form it was
  // (흑기사 린다메아's 뛰어넘기 into the sky, 노아의 묵시록 back down): their switches go off. In the original such a page runs
  // right after the skill; here the troop's pages take turns, and her duel (page 7, her last form) could come in between - then
  // the 擬態 page turned her back into the form before it, and she leapt and dived all through the duel
  dropPendingForms(b, member, interp) {
    for (const p of b.troop?.pages || []) {
      const c = p.condition;
      if (p.list === interp.list || p.span !== 2 || !c.switch_valid || c.turn_valid || c.enemy_valid || c.actor_valid || c.turn_ending) continue;
      if (!p.list.some(x => x.code === 336 && x.parameters[0] === member)) continue;
      if (G.state.sw(c.switch_id)) G.state.setSw(c.switch_id, false);
    }
  }
  // Enemy Transform: the new form's picture, and its own moves - none of the old form's left half done
  transformEnemy(e, enemyId) {
    this.dropMarker(e); this.hideBlade(e);
    if (e.state === 'windup' || e.state === 'act') { e.state = 'recover'; e.timer = 0.5; }
    // (a form with no picture of its own taken on from one with a picture: gone from the original's screen - up into the sky
    // here, as the form it was (bossmoves.js skyHold). How high it is stays: up from a leap, down from the sky)
    const was = e.lookAs || e.b.enemyId, wasSky = !!e.sky;
    e.sky = !$data.enemies[enemyId]?.battler_name && !!$data.enemies[was]?.battler_name;
    e.lookAs = e.sky ? was : 0;
    // (back from the sky while still high up: it comes down on the player with its next blow - bossmoves.js skyDive)
    e.diving = wasSky && !e.sky && (e.lift || 0) > 3;
    if (e.diving) e.divingAt = G.time;
    if (e.pair) this.unpairMount(e.pair);
    e.move = null; e.act = null; e.plan = null; e.pending = null; e.comboStep = 0;
    e.boss = false; e.lungeSkill = e.volleySkill = undefined; e.cool = {};
    e.b.enemyId = enemyId;
    e.remove(); e.group = new THREE.Group(); this.root.add(e.group); e.ready = e.build();
    G.theater?.onTransform(e);
  }
  // A boss fight's big ones - those standing (not still hidden, not out of reach) whose HP is near the biggest's, at
  // most three - use some of their skills as moves of their own (bossFamily). Counted as the fight starts and again
  // as hidden members come out or one changes into something else (a boss's next phase)
  refreshBosses(b) {
    if (!b?.bossFight) return;
    const on = b.enemies.filter(e => e.alive && !e.hidden && !e.untargetable);
    if (!on.length) return;
    const top = Math.max(...on.map(e => e.b.solo().mhp));               // (a co-op boss: as it would be alone)
    const strong = on.filter(e => e.b.solo().mhp >= top * 0.75);
    const list = G.theater?.bossesOf?.(b, on) ?? (strong.length <= 3 ? strong : []);
    for (const e of list) {
      if (e.boss) continue;
      e.boss = true; e.nextMove = G.time + 2 + Math.random() * 2;
      this.bossFallback(e);
    }
    if (!b.private) G.coop?.scaleBosses?.(b);      // (one that came out in a co-op fight: as strong as the rest at once)
  }

  // ---- player equipment visuals ------------------------------------------------------
  // what each hand holds: the weapon, and the shield-slot item (a shield, or one of the guns that sit in that slot)
  heldSpecs() {
    const leader = G.state.party.leader();
    const w = leader?.weapons()[0] || null;
    const off = leader?.armors().find(a => a && a.etype_id === 1) || null;
    const offGun = !!off && (off.features || []).some(f => f.code === 43);   // guns add their shot skill
    // (a bow filed with the swords is made and held as a bow)
    const wtype = w ? (shotStyle(w) === 'bow' ? WTYPE.BOW : w.wtype_id || WTYPE.SWORD) : 0;
    return {
      weapon: w ? { item: w, key: `w${w.id}`, kind: 'weapon', wtype, hand: 'right' } : null,
      offhand: off ? { item: off, key: `a${off.id}`, kind: offGun ? 'weapon' : 'shield', wtype: offGun ? WTYPE.GUN : 0, hand: 'left', gun: offGun, large: off.atype_id === 6,
        span: offGun ? 0 : shieldSpan(off) } : null,
    };
  }
  refreshEquipment() {
    if (this.gripAdjust) return;                     // the items are being moved by hand
    const { weapon: ws, offhand: os } = this.heldSpecs();
    const wtype = ws?.wtype || WTYPE.SWORD;
    const key = `${ws?.key || '-'}|${os?.key || '-'}|${G.vr}|${iconAssetRevision()}`;
    if (key === this.equipKey) return;
    this.equipKey = key;
    this.swing = null; this.deskCharge = null;
    this.wtype = wtype;
    if (this.weapon) this.weapon.parent?.remove(this.weapon);
    if (this.shield) this.shield.parent?.remove(this.shield);
    const ctrl = G.input.controllers;
    const vr = G.vr && ctrl.right;
    // the held models are built from the equipped items' own icons (fallback: simple shapes)
    const adjOf = spec => spec && getAdjust(spec.key, spec.kind, spec.wtype, spec.hand, spec.item.icon_index);
    const model = spec => spec && buildIconModel(spec.item.icon_index, {
      kind: spec.kind, wtype: spec.wtype, hand: spec.hand, large: spec.large, span: spec.span, adjust: adjOf(spec) });
    // (what the weapon shoots on the trigger / a click, if anything: a gun's bullet, a bow's arrow - shotStyle)
    this.shotKind = shotStyle(ws?.item);
    // a hold pose set by hand (grip adjust mode) replaces the default placement in VR
    const handPose = (obj, spec) => {
      const g = adjOf(spec)?.grip;
      if (!g) return false;
      obj.position.fromArray(g.p); obj.quaternion.fromArray(g.q);
      return true;
    };
    const wrapDesktop = (m, roll, shield = false) => vr ? m : desktopModel(m, { roll, shield });
    const wModel = model(ws);
    this.weapon = new THREE.Group();
    if (ws) {
      const wInner = wrapDesktop(wModel || makeWeaponMesh(wtype), -Math.PI / 2);
      this.weapon.add(wInner);
      this.weapon.userData.length = (wModel || wInner).userData.length;
      this.weapon.userData.visualLength = this.weapon.userData.length * (wInner.userData.desktopScale || 1);
      this.weapon.userData.ranged = !!this.shotKind;
    } else {
      // bare hands: nothing to draw (VR shows the hand), the fist is what hits
      this.weapon.userData.unarmed = true;
      this.weapon.userData.length = 0.11;
    }
    if (vr) {
      // WebXR grip space: -Z runs out of the top of the fist -> blade along -Z
      ctrl.right.grip.add(this.weapon);
      this.weapon.rotation.set(0, 0, 0);
      this.weapon.position.set(0, 0, 0.03);
      if (!handPose(this.weapon, ws) && this.weapon.userData.ranged) this.weapon.userData.alignRay = 'right';
      if (this.shotKind === 'gun') this.addLaser(this.weapon);
    } else {
      G.three.camera.add(this.weapon);
      desktopRest(this.weapon, 'right', !!this.shotKind, G.three.camera);
    }
    this.shield = null;
    this.offGun = null;
    if (os) {
      const sModel = model(os);
      this.shield = new THREE.Group();
      if (os.gun) {
        // pistol in the left hand: held like a weapon (cannot guard with it)
        const gunModel = sModel || makeWeaponMesh(WTYPE.GUN);
        const gunVisual = wrapDesktop(gunModel, Math.PI / 2);
        this.shield.add(gunVisual);
        this.shield.userData.length = gunModel.userData.length || 0.3;
        this.shield.userData.visualLength = this.shield.userData.length * (gunVisual.userData.desktopScale || 1);
        this.offGun = this.shield;
        if (G.vr && ctrl.left) {
          ctrl.left.grip.add(this.shield); this.shield.position.set(0, 0, 0.03);
          if (!handPose(this.shield, os)) this.shield.userData.alignRay = 'left';
          this.addLaser(this.shield);
        }
        else { G.three.camera.add(this.shield); desktopRest(this.shield, 'left', true, G.three.camera); }
      } else {
        this.shield.add(wrapDesktop(sModel || makeShieldMesh(os.large), 0, true));
        if (G.vr && ctrl.left) {
          // the holder's +Z (shield front) turns to -X = the back of the left hand
          ctrl.left.grip.add(this.shield);
          this.shield.position.set(-0.07, 0.0, 0.02);
          this.shield.rotation.set(0, -Math.PI / 2, 0);
          handPose(this.shield, os);
        } else {
          G.three.camera.add(this.shield);
          desktopShield(this.shield, 0, G.three.camera);
        }
      }
    }
    this.hasShield = !!os && !os.gun;
    this.hasPrev = false;
    this.showArms();
  }
  // the weapon / shield in the hands - unless they are put away (무장해제), or the hand holds something else.
  // (PC: a shield only comes into view while the guard is up - updateDeskShield; held low all the time it hid the
  // status window and part of the view)
  showArms() {
    const hidden = !G.vr && desktopEquipmentHidden(G.ui, G.map?.transferring);
    if (this.weapon) this.weapon.visible = !hidden && !this.disarmed && !this.ready && !(this.held && this.held.how !== 'rub');
    this.shieldOut = !!this.shield && !this.disarmed && !(this.held && this.held.how === 'rub');
    if (this.shield) this.shield.visible = !hidden && this.shieldOut && (G.vr || !this.hasShield || (this.deskShieldT || 0) > 0.01);
  }
  updateDesktopEquipment() {
    if (G.vr) return;
    if (!this.swing) desktopRest(this.weapon, 'right', !!this.shotKind, G.three.camera);
    if (this.offGun) desktopRest(this.offGun, 'left', true, G.three.camera);
    this.showArms();
  }
  // PC: the shield comes up from below into its place while the guard is up, and goes down out of view again
  updateDeskShield(dt) {
    if (G.vr || !this.shield || !this.hasShield) return;
    const t = this.deskShieldT = THREE.MathUtils.clamp((this.deskShieldT || 0) + (this.guardUp && this.shieldOut ? dt : -dt) / 0.12, 0, 1);
    desktopShield(this.shield, t, G.three.camera);
    this.shield.visible = this.shieldOut && t > 0.01 && !desktopEquipmentHidden(G.ui, G.map?.transferring);
  }
  // 무장해제 (VR: right stick click, PC: H): the weapon and shield go away with the sound of gear coming off,
  // the bare hands show, and nothing the hands do hits - no swing, Break, shot or weapon art, so no one is cut
  // down by accident; the guard is down too. Again: they are taken up. The equipment itself stays on
  toggleDisarm(on = !this.disarmed) {
    if (on === this.disarmed) return;
    this.disarmed = on;
    // what the hands were doing with them ends (a weapon art is paid only when it lands: nothing is lost)
    this.hasPrev = false; this.charge = null; this.deskCharge = null; this.breakArm = null;
    if (this.swing) { this.swing = null; if (!G.vr) desktopRest(this.weapon, 'right', !!this.shotKind, G.three.camera); }
    if (on) this.skillArm = null;
    if (this.breakGlow) this.breakGlow.visible = false;
    this.showArms();
    if (on) {
      G.audio?.playSe(G.seAt('布擦れ', 90, 100));
      G.audio?.playSe(G.seAt('soubi-01', 60, 70));
    } else G.audio?.playSystemSe(4);
    G.input.haptic('left', 0.35, 50); G.input.haptic('right', 0.35, 50);
  }
  // ---- hold-pose adjustment (VR): press+release a grip and that hand's item stays floating where it
  //      is; grip it again and it is held at the new pose (saved per item); gripping away from it
  //      brings it back as before. B / Y ends the mode.
  startGripAdjust() {
    if (!G.vr || !G.input.controllers.right) { G.ui.toast(tr('VR에서만 쓸 수 있어요')); return false; }
    if (this.battles.some(b => !b.done)) { G.ui.toast(tr('전투 중에는 할 수 없어요')); return false; }
    this.toggleDisarm(false);
    this.equipKey = null;
    this.refreshEquipment();
    const specs = this.heldSpecs();
    const ga = {};
    const add = (hand, obj, spec) => {
      if (!obj || !spec || !G.input.controllers[hand]) return;
      ga[hand] = { obj, spec, state: 'held', ignoreRelease: false, pos: obj.position.clone(), quat: obj.quaternion.clone(), box: this.localBox(obj) };
    };
    add('right', this.weapon, specs.weapon);
    add('left', this.shield, specs.offhand);
    if (!ga.right && !ga.left) { G.ui.toast(tr('장비한 무기·방패가 없어요')); return false; }
    this.gripAdjust = ga;
    G.ui.setHint(tr('그립 눌렀다 떼기: 놓기 · 다시 쥐기: 고정 · B: 끝'));
    return true;
  }
  endGripAdjust(save = true) {
    const ga = this.gripAdjust;
    if (!ga) return;
    for (const hand of ['right', 'left']) {
      const h = ga[hand];
      if (!h) continue;
      this.highlight(h.obj, 0);
      if (h.state === 'free') {
        // never picked up again: back to the hand as it was
        G.input.controllers[hand]?.grip.add(h.obj);
        h.obj.position.copy(h.pos); h.obj.quaternion.copy(h.quat);
      }
    }
    this.gripAdjust = null;
    this.hasPrev = false;
    G.ui.setHint(null);
    if (save) G.ui.toast(tr('손에 든 자세를 저장했어요'));
  }
  updateGripAdjust() {
    const ga = this.gripAdjust;
    const input = G.input;
    if (!G.vr || G.ui.menuOpen || G.map?.transferring || input.cancel()) { this.endGripAdjust(); return; }
    const handPos = new THREE.Vector3();
    for (const hand of ['right', 'left']) {
      const h = ga[hand];
      const grip = input.controllers[hand]?.grip;
      if (!h || !grip) continue;
      if (h.state === 'held') {
        if (input.xrReleased(hand, 1)) {
          if (h.ignoreRelease) { h.ignoreRelease = false; continue; }
          G.three.scene.attach(h.obj);                 // stays floating where it is
          h.state = 'free';
          input.haptic(hand, 0.3, 40);
          G.audio?.playSystemSe(0);
        }
        continue;
      }
      grip.getWorldPosition(handPos);
      const near = h.box.distanceToPoint(h.obj.worldToLocal(handPos.clone())) < 0.08;
      this.highlight(h.obj, near ? 0.45 : 0.12 + 0.08 * Math.sin(G.time * 5));
      if (input.xrPressed(hand, 1)) {
        if (near) {
          grip.attach(h.obj);                          // held exactly as it floats now
          delete h.obj.userData.alignRay;              // a hand-set pose wins over the pointing-ray default
          const adj = getAdjust(h.spec.key, h.spec.kind, h.spec.wtype, h.spec.hand, h.spec.item.icon_index);
          adj.grip = { p: h.obj.position.toArray().map(v => +v.toFixed(4)), q: h.obj.quaternion.toArray().map(v => +v.toFixed(5)) };
          setAdjust(h.spec.key, adj);
          h.pos.copy(h.obj.position); h.quat.copy(h.obj.quaternion);
          G.audio?.playSystemSe(1);
        } else {
          grip.add(h.obj);                             // called back unchanged
          h.obj.position.copy(h.pos); h.obj.quaternion.copy(h.quat);
          G.audio?.playSystemSe(2);
        }
        this.highlight(h.obj, 0);
        h.state = 'held'; h.ignoreRelease = true;
        input.haptic(hand, 0.6, 60);
      }
    }
  }
  // bounding box of an item in its own (holder) space, for the "is the hand on it" test
  localBox(obj) {
    obj.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const box = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    return box;
  }
  highlight(obj, k) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material?.emissive) return;
      const mat = o.material;
      if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.clone();
      if (k > 0) mat.emissive.setRGB(0.55 * k, 0.6 * k, 0.75 * k);
      else mat.emissive.copy(mat.userData.baseEmissive);
    });
  }
  // rotation from a controller's grip space to its pointing ray (constant per device; cached once tracked)
  rayOffset(hand) {
    if (this._rayOff?.[hand]) return this._rayOff[hand];
    const c = G.input.controllers[hand];
    if (!c || !c.grip.visible || !c.ray.visible) return null;
    c.grip.updateWorldMatrix(true, false); c.ray.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), sc = new THREE.Vector3();
    const qg = new THREE.Quaternion(), qr = new THREE.Quaternion();
    c.grip.matrixWorld.decompose(p, qg, sc);
    c.ray.matrixWorld.decompose(p, qr, sc);
    const off = qg.invert().multiply(qr);
    (this._rayOff ||= {})[hand] = off;
    return off;
  }
  alignHeldToRay() {
    if (!G.vr || this.gripAdjust) return;
    for (const holder of [this.weapon, this.shield]) {
      const hand = holder?.userData.alignRay;
      if (!hand) continue;
      const off = this.rayOffset(hand);
      if (off) holder.quaternion.copy(off);
    }
    // the aiming lasers show where shots go: out of the muzzle along the controller's pointing ray,
    // however the model has been turned in the hand
    for (const [holder, hand] of [[this.weapon, 'right'], [this.offGun, 'left']]) {
      const laser = holder?.userData.laser;
      const c = G.input.controllers[hand];
      if (!laser || !c) continue;
      holder.updateWorldMatrix(true, false); c.ray.updateWorldMatrix(true, false);
      const hq = new THREE.Quaternion(), rq = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      holder.matrixWorld.decompose(v, hq, sc);
      c.ray.matrixWorld.decompose(v, rq, sc);
      laser.quaternion.copy(hq.invert().multiply(rq));
    }
  }
  // where a hand's controller points (VR): shots follow this, not the held model
  aimRay(hand) {
    const c = G.vr ? G.input.controllers[hand] : null;
    if (!c) return null;
    c.ray.updateWorldMatrix(true, false);
    return { origin: new THREE.Vector3().setFromMatrixPosition(c.ray.matrixWorld), dir: new THREE.Vector3(0, 0, -1).transformDirection(c.ray.matrixWorld) };
  }
  // a faint aiming laser out of the muzzle
  addLaser(holder) {
    const len = holder.userData.length || 0.4;
    const geo = new THREE.CylinderGeometry(0.0025, 0.0025, 6, 4, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const laser = new THREE.Mesh(geo, mat);
    laser.position.set(0, 0, -len);
    holder.add(laser);
    holder.userData.laser = laser;
  }
  weaponSegment(base, tip) {
    if (!this.weapon) return false;
    this.weapon.updateWorldMatrix(true, false);
    base.set(0, 0, this.weapon.userData.unarmed ? -0.02 : -0.12).applyMatrix4(this.weapon.matrixWorld);
    tip.set(0, 0, -this.weapon.userData.length).applyMatrix4(this.weapon.matrixWorld);
    return true;
  }

  // ---- items ---------------------------------------------------------------------------
  useItem(item, from) {
    if (!item || this.spectating) return false;
    if (this.restrained && from !== 'quick') { this.restrainedBuzz(); return false; }
    if (from === 'menu' && this.inCombat && G.state.party.leader()?.itemSealed()) {
      G.ui.toast(`${stripEscapes(item.name)}: ${tr('봉인되어 있습니다')}`, item.icon_index); G.audio?.playSystemSe(3);
      return false;
    }
    // VR: a herb bottle / syringe picked in the menu goes into the hand, like from a quick slot
    const how = from === 'menu' && this.handUse(item);
    if (how) { G.ui.closeMenu(); return this.holdConsumable(item, how); }
    const used = this.applyUsableToActor(item, from);
    if (used && item.consumable) G.state.party.gainItem('item', item.id, -1);
    if (used) G.audio?.playSystemSe(22);
    return used;
  }
  // effects of an item / skill on the player (the whole "party" here)
  applyUsableToActor(obj, from) {
    const actor = G.state.party.leader();
    if (!actor) return false;
    // <スキル無効:n> (script 196): a skill of the player's own that a state on them erases (그랑・기뇰's 사자와 유니콘:
    // no buffs) - used, and nothing comes of it
    if (obj.__class === 'RPG::Skill' && actor.skillCanceled(obj.id)) return false;
    let used = false;
    const type = obj.damage?.type || 0;
    const pha = obj.__class === 'RPG::Item' ? actor.pha : 1;     // 약의 지식: items heal more (rings, oaths)
    if (type === 3 || type === 4) {
      const v = Math.max(0, Math.floor(evalFormula(obj.damage.formula, actor, actor) * actor.rec));
      if (type === 3) this.healPlayerHp(actor, v);
      else this.healPlayerMp(actor, v);
      used = true;
    }
    // (script 169's stealth: <ステルス:n> on what is used - the map's monsters do not notice the player for n steps)
    const stealth = /ステルス:(\d+)/i.exec(obj.note || '');
    if (stealth && +stealth[1] > 0) { G.state.system.stealthSteps = +stealth[1]; used = true; }
    if (this.applyBuffEffects(actor, obj, TURN_SECONDS)) used = true;
    for (const ef of obj.effects || []) {
      switch (ef.code) {
        case 11: { const v = Math.floor((actor.mhp * ef.value1 + ef.value2) * actor.rec * pha); if (v > 0) this.healPlayerHp(actor, v); else if (v < 0) { actor.hp = Math.max(0, actor.hp + v); this.popupAtPlayer(String(v), '#ffb0b0'); } used = true; break; }
        case 12: { const v = Math.floor((actor.mmp * ef.value1 + ef.value2) * actor.rec * pha); if (v > 0) this.healPlayerMp(actor, v); else if (v < 0) actor.mp = Math.max(0, actor.mp + v); used = true; break; }
        case 13: actor.tp = Math.min(100, actor.tp + ef.value1); used = true; break;
        case 21: if (ef.data_id > 0 && Math.random() < ef.value1) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); this.fightState(ef.data_id); } used = true; break;
        case 22: actor.removeState(ef.data_id); used = true; break;
        case 42: actor.addParam(ef.data_id, ef.value1); used = true; break;
        case 43: {
          const sk = $data.skills[ef.data_id];
          if (sk && !actor.skills.includes(sk.id)) { actor.learnSkill(sk.id); G.ui.toast(tr('{name} 습득', { name: stripEscapes(sk.name) }), sk.icon_index); }
          used = true; break;
        }
        case 44: G.map.reserveCommonEvent(ef.data_id); used = true; if (from === 'menu') G.ui.closeMenu(); break;
        default: break;
      }
    }
    if (actor.hp <= 0) this.playerFalls(null);
    return used;
  }
  // a heal on the player, after the recovery rules on them (script 172 - 허약, 천수 영역: nothing, or as much damage)
  healPlayerHp(actor, v) {
    const r = actor.healAmount(v, 0);
    if (r > 0) { actor.hp = Math.min(actor.mhp, actor.hp + r); this.popupAtPlayer(`+${r}`, '#60ff80'); }
    else if (r < 0) { actor.hp = Math.max(0, actor.hp + r); this.slipHurt(-r); }
    else { this.popupAtPlayer('0', '#9a9a9a'); G.audio?.playSystemSe(3); }
    return r;
  }
  healPlayerMp(actor, v) {
    const r = actor.healAmount(v, 1);
    if (r > 0) { actor.mp = Math.min(actor.mmp, actor.mp + r); this.popupAtPlayer(`MP +${r}`, '#80b0ff'); }
    else if (r < 0) actor.mp = Math.max(0, actor.mp + r);
    else this.popupAtPlayer('MP 0', '#9a9a9a');
    return r;
  }
  // VX Ace's buff effects of an item / skill on a battler: 31 a buff, 32 a debuff (by its debuff rate - times chance,
  // as the player's states are), 33 / 34 a buff / a debuff taken away; turn: the seconds a turn lasts for it. Whether
  // the item / skill had any
  applyBuffEffects(b, obj, turn, chance = 1) {
    let any = false;
    for (const ef of obj?.effects || []) {
      if (ef.code === 31) { b.addBuff(ef.data_id, ef.value1 * turn); any = true; }
      else if (ef.code === 32) { if (Math.random() < b.debuffRate(ef.data_id) * chance) b.addDebuff(ef.data_id, ef.value1 * turn); any = true; }
      else if (ef.code === 33) { if (b.buffs[ef.data_id] > 0) b.removeBuff(ef.data_id); any = true; }
      else if (ef.code === 34) { if (b.buffs[ef.data_id] < 0) b.removeBuff(ef.data_id); any = true; }
    }
    return any;
  }
  // the player at 0 HP falls (the fight lost) - unless a state keeps them up (진혼가, 불사신: the death state resisted -
  // they stay at 0 HP until it ends), or something brings them back at once in a fight (自動蘇生, script 171)
  playerFalls(killer) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead || actor.hp > 0 || this.spectating) return;
    if (actor.stateResist(1)) {
      if (!this.deathlessAt || G.time - this.deathlessAt > 2) {
        this.deathlessAt = G.time;
        G.audio?.playSe(G.seAt('Saint3', 60, 130));
        G.input.haptic('left', 0.6, 90); G.input.haptic('right', 0.6, 90);
      }
      return;
    }
    if (this.inCombat && this.autoRevivePlayer(actor)) return;
    if (G.coop?.phantom) { G.coop.phantomFell(); return; }      // (a guest falling in another's world: by the rules - coop.js)
    if (G.coop?.worldFalls?.()) return;                           // (the developer's world: in another's boss fight, by the rules)
    if (G.coop?.hostFalls?.()) return;                            // (a co-op host fallen in a boss fight: watching it)
    this.onPlayerDeath(killer);
  }
  autoRevivePlayer(actor) {
    const r = actor.autoRevive();
    if (!r) return false;
    // (as VX Ace: fallen - the states and buffs go with it - and up again with that HP)
    actor.die(); actor.removeState(1);
    actor.hp = Math.min(actor.mhp, r.hp);
    const timers = G.state.system.stateTimers;
    if (timers) for (const k of Object.keys(timers)) if (!actor.isState(+k)) delete timers[k];
    if (r.anim) G.screen.playAnimationOn(G.map.playerChar, r.anim);
    G.audio?.playSystemSe(16);
    this.popupAtPlayer(`+${actor.hp}`, '#60ff80');
    if (r.breakRate > Math.random() * 100) this.breakSaver(actor, r.source);
    return true;
  }
  // what brought a battler back may break: equipment is lost (with the original's crash), a state goes
  breakSaver(b, o) {
    if (o.__class === 'RPG::Weapon' || o.__class === 'RPG::Armor') {
      const kind = o.__class === 'RPG::Weapon' ? 'weapon' : 'armor';
      const slot = (b.equips || []).find(s => s.kind === kind && s.id === o.id);
      if (!slot) return;
      slot.id = 0;
      b.clampHpMp();
      G.audio?.playSe(G.seAt('Crash', 80, 100));
      if (b === G.state.party.leader()) G.ui.toast(tr('{name} 파손', { name: stripEscapes(o.name) }), o.icon_index, '#ff9a9a');
    } else if (o.__class === 'RPG::State' && b.isState(o.id)) b.removeState(o.id);
  }

  // ---- quick slots (hold X / Q) and skills ---------------------------------------------------
  updateQuick(paused) {
    const input = G.input, ring = this.quick;
    const blocked = paused || this.playerDead || this.spectating || !!this.gripAdjust || G.ui.menuOpen || !!G.ui.msg || !!G.ui.sceneOpen
      || !!G.emotes?.ring.isOpen;                     // (the emote ring up: one ring at a time - src/emotes.js)
    if (ring.isOpen) {
      if (blocked) { ring.close(); return; }
      ring.update();
      if (!input.quickHeld()) {                       // released: use whatever is under the hand
        const sel = ring.sel;
        ring.close();
        const entry = sel >= 0 ? quickSlots()[sel] : null;
        if (entry) this.useQuickEntry(entry);
      }
      return;
    }
    if (blocked) return;
    if (input.quickPressed()) {
      if (this.ready) { this.cancelReady(true); return; }
      if (this.held) { this.cancelHeld(true); return; }
      if (this.skillArm) { this.skillArm = null; G.audio?.playSystemSe(2); return; }
      quickSlots(); ring.open(); return;
    }
    const n = input.digitPressed();                    // PC: 1-8 use a slot directly
    if (n) { const entry = quickSlots()[n - 1]; if (entry) this.useQuickEntry(entry); }
  }
  coolSeconds(obj) {
    const m = /<クールタイム:(\d+)>/.exec(obj?.note || '');
    return m ? +m[1] * (FULL_TURN_COOL.has(obj.id) ? TURN_SECONDS : COOL_TURN) : 0;
  }
  // a stage of a skill that grows a stage a turn (STAGE_TURNS): the next stage no sooner than a turn on - its cool-down
  // on the first stage's id (the quick slot's, which the stages are used through)
  stageCool(s) {
    if (!this._stageRoot) {
      this._stageRoot = new Map();
      for (const id of STAGE_TURNS) {
        if (!$data.skills[id]) continue;
        this._stageRoot.set(id, id);
        for (const m of ($data.skills[id].note || '').matchAll(/<ステート変化:(\d+),(\d+)>/g)) this._stageRoot.set(+m[1], id);
      }
    }
    const root = this._stageRoot.get(s?.id);
    if (root) this.skillCD[root] = Math.max(this.skillCD[root] || 0, G.time + TURN_SECONDS);
  }
  skillCooling(skill) { return Math.max(0, (this.skillCD[skill.id] || 0) - G.time); }
  isBreakSkill(obj) {
    return /브레이크|ブレイク|破防|\bbreak/i.test(obj.name || '') && (obj.effects || []).some(e => e.code === 21 && (e.data_id === 7 || e.data_id === 8));
  }
  useQuickEntry(entry) {
    let obj = entryData(entry);
    const actor = G.state.party.leader();
    if (!obj || !actor || this.playerDead) return false;
    const name = stripEscapes(obj.name);
    const fail = msg => { G.ui.toast(`${name}: ${msg}`, obj.icon_index); G.audio?.playSystemSe(3); return false; };
    if (this.restrained) { this.restrainedBuzz(); return false; }
    if (this.healing) return fail(tr('다른 아이템을 쓰는 중'));
    if (obj.occasion === 3) return fail(tr('사용할 수 없습니다'));
    if (obj.occasion === 2 && this.inCombat) return fail(tr('전투 중에는 쓸 수 없습니다'));
    if (entry.kind === 'item') {
      if (this.inCombat && actor.itemSealed()) return fail(tr('봉인되어 있습니다'));
      if (G.state.party.itemCount('item', obj.id) <= 0) return fail(tr('남은 것이 없습니다'));
    } else {
      if (!actor.allSkills().some(s => s.id === obj.id)) return fail(tr('지금은 쓸 수 없는 스킬입니다'));
      if (actor.skillSealed(obj.id) || !actor.skillTypeUsable(obj)) return fail(tr('봉인되어 있습니다'));
      if (!actor.skillCostPayable(obj)) return fail(this.costShort(actor, obj));
      const cd = this.skillCooling(obj);
      if (cd > 0) return fail(tr('재사용 대기 {s}초', { s: cd.toFixed(1) }));
      // (one a state of mine turns into another - script 195: that one is what is used, and it has to be ready)
      obj = this.skillByState(actor, obj);
      const cd2 = this.skillCooling(obj);
      if (cd2 > 0) return fail(tr('재사용 대기 {s}초', { s: cd2.toFixed(1) }));
      if (!actor.skillCostPayable(obj)) return fail(this.costShort(actor, obj));
      // the original battle commands that already have their own button here
      if (obj.id === 12) {
        if (G.player.dodge.cooldown > 0) return fail(tr('잠시 후에 다시'));
        G.player.wantDodge = true; return true;
      }
      // a weapon's own move takes the weapons up again (무장해제 ends)
      if (this.disarmed && (this.isBreakSkill(obj) || this.isWeaponArt(obj))) this.toggleDisarm(false);
      if (this.isBreakSkill(obj)) {
        if (/건 ?브레이크|ガン ?ブレイク|枪械?破防|\bgun ?break/i.test(obj.name || '')) { if ((this.breakCooldown || 0) <= G.time) this.fireGunBreak(obj); return true; }
        this.breakArm = { skill: obj, until: G.time + 3 };          // the next swing that lands within 3 s
        G.input.haptic('right', 0.3, 40);
        return true;
      }
      // a physical blow on one enemy (일섬, 참수, 삼단 베기...): it goes onto the weapon, which glows red, and
      // comes out with the next blow that lands - MP and cool-down are paid then. X puts it away
      if (this.isWeaponArt(obj)) { this.armSkill(obj); return true; }
    }
    return this.performUsable(obj, entry.kind);
  }
  // HP damage on one enemy that is not a spell: RPG Maker's 물리 공격 (일섬, 참수...), or 필중 (sure hit) when it
  // hits by attack power / defence (혈도 찌르기, 거합베기, 월광도, 다리 쏘기, 피의 시련...) or comes with a weapon
  // (혼 베기). Sure-hit spells by magic power (관통빙주, 독사의 포옹) and fixed-damage books stay in the hand
  isWeaponArt(s) {
    if (!s || !(s.scope === 1 || s.scope === 3) || !(s.damage?.type === 1 || s.damage?.type === 5)) return false;
    if (s.hit_type === 1) return true;
    if (s.hit_type !== 0) return false;
    if (/\ba\.atk\b|\bb\.def\b/.test(s.damage.formula || '')) return true;
    if (!this._weaponSkillIds) {
      this._weaponSkillIds = new Set();
      for (const w of $data.weapons || []) for (const f of w?.features || []) if (f.code === 43) this._weaponSkillIds.add(f.data_id);
    }
    return this._weaponSkillIds.has(s.id);
  }
  armSkill(s) {
    this.cancelReady();
    this.cancelHeld();
    this.skillArm = { skill: s };
    this.weaponFx.burst(this.weaponSeg(), 'armed');
    G.audio?.playSe(G.seAt('Powerup', 70, 125));
    G.input.haptic('right', 0.5, 80);
  }
  // the blow that lands with a weapon art on: that skill, paid for now (with too little MP left by then: a
  // plain blow, and the art is gone)
  takeArmedSkill(actor) {
    const s = this.skillArm?.skill;
    if (!s || !actor) return null;
    this.skillArm = null;
    if (!actor.skillCostPayable(s) || actor.skillSealed(s.id)) {
      G.ui.toast(`${stripEscapes(s.name)}: ${this.costShort(actor, s)}`, s.icon_index);
      G.audio?.playSystemSe(3);
      return null;
    }
    this.actorPays(actor, s);
    this.skillCD[s.id] = G.time + this.coolSeconds(s);
    this.actorUserEffect(s);
    return s;
  }
  // skills used from the menu (heals, buffs, common events)
  useSkillFromMenu(skill) {
    const actor = G.state.party.leader();
    if (!actor || !skill || this.spectating) return false;
    if (this.restrained) { this.restrainedBuzz(); return false; }
    skill = this.skillByState(actor, skill);
    const ok = actor.skillCostPayable(skill) && !actor.skillSealed(skill.id) && actor.skillTypeUsable(skill) && this.skillCooling(skill) <= 0;
    if (!ok || (skill.scope >= 1 && skill.scope <= 6) || skill.occasion === 1 || skill.occasion === 3) { G.audio?.playSystemSe(3); return false; }
    this.actorPays(actor, skill);
    this.skillCD[skill.id] = G.time + this.coolSeconds(skill);
    this.stageCool(skill);
    const used = this.applyUsableToActor(skill, 'menu');
    G.screen.playAnimationOn(G.map.playerChar, skill.animation_id);
    this.actorUserEffect(skill);
    return used;
  }
  isDrink(obj) {
    const t = obj.damage?.type || 0;
    return t === 3 || t === 4 || (obj.effects || []).some(e => e.code === 11 || e.code === 12);
  }
  payUsable(obj, kind) {
    if (kind === 'item') { if (obj.consumable) G.state.party.gainItem('item', obj.id, -1); }
    else {
      this.actorPays(G.state.party.leader(), obj);
      this.skillCD[obj.id] = G.time + this.coolSeconds(obj);
      this.stageCool(obj);
      this.actorUserEffect(obj);
    }
  }
  // a skill of mine paid for: MP, TP and the HP it costs (script 128 - shown as it goes, like a blow taken)
  actorPays(actor, s) {
    if (!actor || !s) return;
    const hp = actor.skillHpCost(s);
    actor.paySkillCost(s);
    if (hp > 0) this.popupAtPlayer(`-${hp}`, '#ff9a9a');
  }
  // which of a skill's costs I cannot pay
  costShort(actor, s) {
    return actor.mp >= actor.skillMpCost(s) && actor.tp >= (s.tp_cost || 0) ? tr('HP가 부족합니다') : tr('MP가 부족합니다');
  }
  // a skill of mine with <使用者効果 n> (script 113): skill n's effects on me as well, once the skill has done its
  // work (the next cut's mark of 삼단 베기, a bullet loaded, a guard)
  actorUserEffect(s) {
    const self = this.userEffectSkill(s);
    if (self) this.later(60, () => { if (!this.playerDead) this.applyUsableToActor(self, 'self'); });
  }
  performUsable(obj, kind) {
    const scope = obj.scope || 0;
    const name = stripEscapes(obj.name);
    // things aimed at enemies go into the right hand first; the attack button lets them go
    if (scope >= 1 && scope <= 6 && !this.directUse) return this.readyUsable(obj, kind);
    if (scope >= 1 && scope <= 6) {
      const targets = this.pickTargets(obj, kind);
      if (!targets.length) { G.ui.toast(tr('{name}: 대상이 없습니다', { name }), obj.icon_index); G.audio?.playSystemSe(3); return false; }
      this.payUsable(obj, kind);
      const from = this.castOrigin();
      // thrown items and magic fly to the target; physical / sure-hit skills land at once
      const flies = kind === 'item' || obj.hit_type === 2;
      targets.forEach((e, i) => {
        if (flies) this.later(i * 140, () => { if (e.alive) this.launchUsable(obj, kind, from, e); });
        else {
          this.applyUsableToEnemy(e, obj, from);
          const wp = e.worldPos(new THREE.Vector3()); wp.y += e.h * 0.5;
          if (obj.animation_id > 0) G.screen.playAnimationOn(wp, obj.animation_id, { rate: 3, height: e.h });
          else G.audio?.playSe(G.seAt('Slash1', 90, 100), wp);
        }
      });
      if (kind === 'item') G.audio?.playSe(G.seAt('Wind7', 70, 120));
      else this.playerFollowUp(obj, targets[0], from);
      G.input.haptic('left', 0.5, 60);
      return true;
    }
    // the player (and the party, which is just the player here)
    const how = kind === 'item' && this.handUse(obj);
    if (how) return this.holdConsumable(obj, how);
    if (kind === 'item' && this.isDrink(obj)) {
      this.healing = { id: obj.id, t: 0.9 };        // drinking takes a moment
      G.audio?.playSystemSe(22);
      return true;
    }
    if (kind === 'skill') { this.payUsable(obj, kind); this.playerFollowUp(obj, null, null); }
    const used = this.applyUsableToActor(obj, 'quick');
    if (kind === 'item' && used && obj.consumable) G.state.party.gainItem('item', obj.id, -1);
    if (obj.animation_id > 0) G.screen.playAnimationOn(G.map.playerChar, obj.animation_id, { rate: 3 });
    else if (used) G.audio?.playSystemSe(22);
    if (!used) G.ui.toast(tr('{name}: 효과가 없었다', { name }), obj.icon_index);
    return used;
  }
  // ---- a herb bottle / syringe in the right hand (VR) ----------------------------------------
  // The herb bottles go to the mouth, the syringes (수혈액) into the body: the item is used when it
  // gets there. X (the quick button) puts it away.
  handUse(obj) {
    if (!G.vr || !obj) return null;
    if (this.isResin(obj)) return G.input.controllers.left && this.weapon ? 'rub' : null;
    if (!G.input.controllers.right) return null;
    if (HERB_ICONS.includes(obj.icon_index)) return 'mouth';
    if (obj.icon_index === SYRINGE_ICON) return 'stab';
    return null;
  }
  // a resin (송진): an item that gives the attack an element for a while
  isResin(obj) {
    return (obj?.effects || []).some(e => e.code === 21 && ($data.states[e.data_id]?.features || []).some(f => f.code === 31));
  }
  resinElements(obj) {
    const out = [];
    for (const e of obj?.effects || []) if (e.code === 21) for (const f of $data.states[e.data_id]?.features || []) if (f.code === 31 && ELEMENT_FX[f.data_id]) out.push(ELEMENT_FX[f.data_id]);
    return out;
  }
  holdConsumable(obj, how) {
    if (G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name: stripEscapes(obj.name) }), obj.icon_index); return false; }
    this.cancelReady();
    this.cancelHeld();
    const stab = how === 'stab', rub = how === 'rub';
    const hand = rub ? 'left' : 'right';
    // the icon as a solid model held like a weapon (the hand hides behind it); its -Z end is the
    // bottle's neck / the needle / the resin's lump
    const model = buildIconModel(obj.icon_index, {
      kind: 'weapon', wtype: 0, hand,
      adjust: stab ? { rot: 225, flip: false, offset: 6, scale: 0.13 } : rub ? { rot: 0, flip: false, offset: 7, scale: 0.1 } : { rot: 0, flip: false, offset: 9, scale: 0.11 } });
    const wrap = new THREE.Group();
    if (model) wrap.add(model); else wrap.add(this.iconSprite(obj.icon_index));
    const tip = new THREE.Object3D();
    tip.position.set(0, 0, -(model?.userData.length || 0.1));
    wrap.add(tip);
    // the bottle's neck out of the top of the fist; the syringe the other way round, needle out of the
    // bottom of the fist (a downward stab)
    if (stab) wrap.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(wrap);
    holder.position.set(0, 0, 0.03);
    G.input.controllers[hand].grip.add(holder);
    wrap.userData.holder = holder;
    this.held = { obj, how, hand, fx: wrap, tip, t: 0, near: 0, hist: null, wasInside: null, rub: 0, along: null, buzz: 0, rubbing: false };
    G.audio?.playSe(G.seAt('Equip1', 60, 120));
    G.input.haptic(hand, 0.4, 50);
    return true;
  }
  cancelHeld(sound = false) {
    const h = this.held;
    if (!h) return;
    const holder = h.fx.userData.holder;
    holder?.parent?.remove(holder);
    h.fx.parent?.remove(h.fx);
    h.fx.traverse(o => {
      if (!o.isSprite) o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.held = null;
    this.showArms();
    if (sound) G.audio?.playSystemSe(2);
  }
  // just below the eyes, a little in front of them
  mouthPoint(out) {
    return G.three.camera.localToWorld(out.set(0, -0.075, -0.06));
  }
  // the body under the head (a capsule from the neck to the knees), the other hand and its forearm
  insideBody(p) {
    const cam = G.three.camera;
    const head = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const axisX = head.x - fwd.x * 0.08, axisZ = head.z - fwd.z * 0.08;   // the neck is behind the eyes
    const top = head.y - 0.18, bottom = head.y - 1.25;
    const y = THREE.MathUtils.clamp(p.y, bottom, top);
    if (Math.hypot(p.x - axisX, p.z - axisZ) + Math.abs(p.y - y) < 0.2) return true;
    const left = G.input.controllers.left?.grip;
    if (left) {
      const a = left.getWorldPosition(new THREE.Vector3());
      if (a.distanceTo(p) < 0.09) return true;
      // the forearm runs back from the hand toward the body
      const elbow = new THREE.Vector3(0, 0, 0.26).applyMatrix4(left.matrixWorld);
      const seg = new THREE.Line3(a, elbow);
      if (seg.closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p) < 0.055) return true;
    }
    return false;
  }
  updateHeld(dt, paused) {
    const h = this.held;
    if (!h) return;
    if (this.playerDead || this.spectating || G.ui.menuOpen || G.map?.transferring || !G.vr) { this.cancelHeld(); return; }
    if (h.how === 'rub') { if (this.shield) this.shield.visible = false; }   // the resin is in the shield hand
    else if (this.weapon) this.weapon.visible = false;      // the item is in the weapon hand
    h.t += dt;
    if (paused) { h.hist = null; h.wasInside = null; h.near = 0; h.along = null; return; }
    const tip = h.tip.getWorldPosition(new THREE.Vector3());
    if (h.how === 'rub') this.rubResin(h, tip, dt);
    else if (h.how === 'mouth') {
      // held at the lips for a moment: drunk
      h.near = tip.distanceTo(this.mouthPoint(new THREE.Vector3())) < 0.1 ? h.near + dt : 0;
      if (h.near > 0.25) this.consumeHeld();
    } else {
      // pushed into the body from outside (not resting against it, not pulled out of it); the speed
      // is taken over the last few frames so one jittery frame does not count as a thrust
      const inside = this.insideBody(tip);
      const hist = h.hist || (h.hist = []);
      hist.push({ t: h.t, p: bodyRelative(tip, new THREE.Vector3()) });
      while (hist.length > 2 && h.t - hist[0].t > 0.07) hist.shift();
      const span = h.t - hist[0].t;
      const speed = span > 0.02 ? hist[hist.length - 1].p.distanceTo(hist[0].p) / span : 0;
      const entering = inside && h.wasInside === false;
      h.wasInside = inside;
      if (entering && speed > 0.45 && h.t > 0.3) this.consumeHeld();
    }
  }
  consumeHeld() {
    const h = this.held;
    if (!h) return;
    const { obj, how } = h;
    this.cancelHeld();
    if (G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name: stripEscapes(obj.name) }), obj.icon_index); return; }
    const used = this.useItem(obj, 'quick');
    if (!used) { G.ui.toast(tr('{name}: 효과가 없었다', { name: stripEscapes(obj.name) }), obj.icon_index); return; }
    if (how === 'rub') {
      // the resin is on: its element flares up along the weapon
      const els = this.resinElements(obj), seg = this.weaponSeg();
      for (const el of els) this.weaponFx.burst(seg, el);
      G.audio?.playSe(G.seAt(ELEMENT_SE[els[0]] || 'Magic1', 75, 110), seg?.tip);
      G.input.haptic('left', 0.7, 140); G.input.haptic('right', 0.7, 140);
      return;
    }
    if (how === 'stab') G.audio?.playSe(G.seAt('Damage1', 55, 140));
    G.input.haptic('right', how === 'stab' ? 0.8 : 0.5, how === 'stab' ? 90 : 160);
  }
  // the resin in the left hand rubbed along the weapon in the right: what counts is how far the touching spot
  // slides along the blade (moving either hand does it); a short touch or a tap is not enough
  rubResin(h, resinTip, dt) {
    const seg = this.weaponSeg();
    if (!seg) { h.along = null; return; }
    const holder = h.fx.userData.holder;
    const grip = holder ? holder.getWorldPosition(new THREE.Vector3()) : resinTip.clone();
    const line = new THREE.Line3(seg.base, seg.tip), q = new THREE.Vector3();
    let best = null;
    for (const p of [resinTip, grip.clone().lerp(resinTip, 0.5), grip]) {
      const t = line.closestPointToPointParameter(p, true);
      const d = line.at(t, q).distanceTo(p);
      if (!best || d < best.d) best = { d, t, at: q.clone() };
    }
    const touching = best.d < 0.06;
    const along = best.t * line.distance();
    if (touching && h.along != null) {
      const step = Math.abs(along - h.along);
      if (step < 0.15) h.rub += step;            // (a jump between frames is not a rub)
      if (step > 0.002) {
        h.buzz -= dt;
        if (h.buzz <= 0) {
          h.buzz = 0.06;
          G.input.haptic('left', 0.25, 25); G.input.haptic('right', 0.2, 25);
          const els = this.resinElements(h.obj);
          const color = { fire: 0xff9040, ice: 0xa0e0ff, thunder: 0xfff0a0, dark: 0xa040ff, light: 0xffe8a0 }[els[0]] || 0xffe0a0;
          this.spawnGlow(best.at, { color, size: 0.08, life: 0.18, grow: 1.4 });
        }
      }
      if (!h.rubbing) { h.rubbing = true; G.audio?.playSe(G.seAt('Sand', 45, 120), best.at); }
    } else if (!touching) h.rubbing = false;
    h.along = touching ? along : null;
    if (h.rub >= RESIN_RUB && h.t > 0.3) this.consumeHeld();
  }
  // the weapon's grip-to-tip line (world), while it is drawn
  weaponSeg() {
    if (!this.weapon || !this.weapon.visible || !this.weapon.parent) return null;
    const base = new THREE.Vector3(), tip = new THREE.Vector3();
    if (!this.weaponSegment(base, tip)) return null;
    if (!G.vr && !this.weapon.userData.unarmed) tip.set(0, 0, -(this.weapon.userData.visualLength || this.weapon.userData.length)).applyMatrix4(this.weapon.matrixWorld);
    return { base, tip };
  }
  // A state an event gives the party during a fight (Change State, 313 - a boss's rules: 그랑・기뇰's 악랄영역 that
  // goes round atk -> def -> mat -> mdf): its turns run as any state's do in a battle, and one VX Ace takes away
  // when a battle ends goes with this fight
  eventStateAdded(actor, id, interp) {
    if (!this.inCombat || !actor.isState(id)) return;
    if (actor === G.state.party.leader()) this.timeActorState(id);
    if ($data.states[id]?.remove_at_battle_end) {
      const b = this.battleOf(interp);
      if (b) (b.eventStates ||= []).push([actor, id]);
    }
  }
  // an event's own blow on the player during a fight (Change HP / Change State - 가짜 바다거북's wrong answer, a
  // trap's 9999): they fall as from any blow, the fight lost (its lose branch, or the death common event)
  eventDeathCheck(interp) {
    const a = G.state.party.leader();
    if (this.spectating) return true;                       // (co-op: watching a boss fight fallen - none of its blows land)
    if (!this.inCombat || this.playerDead || !a || (a.hp > 0 && !a.isState(1))) return false;
    if (!a.isState(1) && a.stateResist(1)) return false;       // (진혼가, 불사신: it stays up at 0 HP)
    a.hp = 0;
    this.onPlayerDeath(this.battleOf(interp));
    return true;
  }
  // the player's own buffs wear off after their turns (TURN_SECONDS each); the time left is kept in
  // system.stateTimers, so a save keeps it too
  // a state my own skill / item gave me in a fight that the original takes away as a battle ends and that has no turns
  // to run out (거룩한 총검's bullet loaded, the cut 삼단 베기 is at): it goes when the fighting is over (onBattleEnd) -
  // the next fight starts again from the first bullet, the first cut
  fightState(id) {
    const st = $data.states[id];
    if (this.inCombat && st?.remove_at_battle_end && !st.auto_removal_timing) (this.fightStates ||= new Set()).add(id);
  }
  timeActorState(id) {
    const st = $data.states[id];
    if (!st?.auto_removal_timing) return;
    const turns = st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1));
    if (turns > 0) (G.state.system.stateTimers ||= {})[id] = turns * TURN_SECONDS;
  }
  updateActorStates(dt, paused) {
    const timers = G.state?.system?.stateTimers, actor = G.state?.party?.leader();
    if (!actor || paused) return;
    this.regenerate(actor, dt);
    actor.tickBuffs(dt);
    this.restrainCheck(actor);
    if (!timers) return;
    for (const k of Object.keys(timers)) {
      if (!actor.isState(+k)) { delete timers[k]; continue; }
      timers[k] -= dt;
      if (timers[k] <= 0) {
        delete timers[k]; actor.removeState(+k);
        for (const s of this.stateExpired(actor, +k)) { actor.addState(s); this.timeActorState(s); }
        // (an angel's sentence run out; 진혼가 over at 0 HP)
        if (actor.hp <= 0 && !this.playerDead) this.playerFalls(null);
      }
    }
  }
  // 행동 불가 (setting, off by default): asleep, stunned, broken (a state that cannot act, restriction 4) the player
  // cannot walk, swing, guard or use anything; the states a restriction takes away go (a guard, a charge)
  playerRestrained() {
    if (G.settings.restrainStates !== true || this.playerDead) return false;
    const a = G.state?.party?.leader();
    return !!a && a.states.some(id => id !== 1 && ($data.states[id]?.restriction || 0) >= 4);
  }
  // (held by a state: what the player tries does not happen - a dull buzz in both hands, the original's buzzer)
  restrainedBuzz() {
    G.audio?.playSystemSe(3);
    G.input.haptic('left', 0.5, 120); G.input.haptic('right', 0.5, 120);
  }
  restrainCheck(actor) {
    const on = this.playerRestrained();
    const mv = on ? G.input.moveVector() : null;
    if (on && Math.hypot(mv.x, mv.y) > 0.5 && G.time > (this.restrainBuzzAt || 0)) {
      this.restrainBuzzAt = G.time + 0.8;
      G.input.haptic('left', 0.35, 60); G.input.haptic('right', 0.35, 60);
    }
    if (on && !this.restrained) {
      for (const id of [...actor.states]) if ($data.states[id]?.remove_by_restriction) { actor.removeState(id); if (G.state.system.stateTimers) delete G.state.system.stateTimers[id]; }
      this.guardUp = false; this.charge = null; this.deskCharge = null;
    }
    this.restrained = on;
  }
  // (a blow taken: the states it shakes off - sleep - go, VX Ace's remove_states_by_damage)
  damageRemovesActorStates(actor) {
    for (const id of [...actor.states]) {
      const st = $data.states[id];
      if (st?.remove_by_damage && id !== 1 && Math.random() * 100 < st.chance_by_damage) {
        actor.removeState(id);
        if (G.state.system.stateTimers) delete G.state.system.stateTimers[id];
      }
    }
  }
  // the states a state brings as it runs out (its turns over), by its note - the original's script ステート解除時:
  // <自然解除時ステート:n> / <強制自然解除時ステート:n> (and <解除時ステート:n> / <強制解除時ステート:n>, as on any
  // removal); "forced" ones whatever the rate. The meat shield's 20 turns end in its death, the angel's sentence in
  // the player's, a boss's stances go round
  stateExpired(b, id) {
    const note = $data.states[id]?.note || '';
    const out = [];
    for (const [word, forced] of [['解除時ステート', false], ['強制解除時ステート', true], ['自然解除時ステート', false], ['強制自然解除時ステート', true]]) {
      const m = new RegExp(`<${word}[：:]([^>]+)>`).exec(note);
      if (!m) continue;
      for (const s of m[1].split(/\s*,\s*/).map(Number)) {
        if (!$data.states[s] || b.stateResist?.(s)) continue;
        if (!forced && (b.stateRate?.(s) ?? 1) <= 0) continue;
        out.push(s);
      }
    }
    return out;
  }
  // HP / MP regeneration (rings, oaths) and slip damage (poison, bleeding, burning, 발광) - VX Ace's regenerate_all: in a
  // fight a turn's worth every TURN_SECONDS, on the map every 20 steps (onPlayerStep). Slip damage leaves at least 1
  // HP (the game does not let it kill) and is felt as a blow is: the edges of the view flush red (no shake)
  regenerate(actor, dt) {
    if (this.playerDead || actor.hp <= 0 || !this.inCombat) { this.regenT = 0; return; }
    this.regenT = (this.regenT || 0) + dt;
    if (this.regenT < TURN_SECONDS) return;
    this.regenT -= TURN_SECONDS;
    this.regenerateNow(actor);
  }
  regenerateNow(actor) {
    if (this.playerDead || actor.hp <= 0) return;
    const hp = Math.trunc(actor.mhp * actor.hrg), mp = Math.trunc(actor.mmp * actor.mrg);
    if (hp > 0) actor.hp = Math.min(actor.mhp, actor.hp + hp);
    else if (hp < 0) {
      const v = Math.min(-hp, Math.max(0, actor.hp - 1));
      if (v > 0) { actor.hp -= v; this.slipHurt(v); }
    }
    if (mp > 0) actor.mp = Math.min(actor.mmp, actor.mp + mp);
    else if (mp < 0) actor.mp = Math.max(0, actor.mp + mp);
  }
  // HP lost to poison, a damage floor...: the red edges of a blow taken, a little buzz, the number - no shake
  slipHurt(v) {
    G.screen.hurtFlash(0.7);
    G.input.haptic('left', 0.3, 50); G.input.haptic('right', 0.3, 50);
    this.popupAtPlayer(`-${v}`, '#c070ff');
  }
  // light on the weapon: a weapon art waiting (red), the elements its attack has from states (resins)
  updateWeaponFx(dt) {
    const kinds = new Set();
    if (this.skillArm) kinds.add('armed');
    for (const id of G.state?.party?.leader()?.states || []) {
      for (const f of $data.states[id]?.features || []) if (f.code === 31 && ELEMENT_FX[f.data_id]) kinds.add(ELEMENT_FX[f.data_id]);
    }
    this.weaponFx.update(dt, this.weaponSeg(), kinds);
  }

  // ---- spell / throwable in the right hand ----------------------------------------------------
  // throwing knives (투척 나이프, 수술칼): the items thrown with the original's knife animation
  isKnife(obj) {
    const anim = $data.animations?.[obj?.animation_id]?.name || '';
    return /ナイフ|knife/i.test(anim) || /나이프|수술칼|ナイフ|メス|knife|scalpel|飞刀|手术刀/i.test(obj?.name || '');
  }
  // a thrown item made like the held weapons (every pixel of its icon a small block): a knife held like a dagger,
  // blade forward; anything else (a bottle, a pot, a dung ball) in the fist
  thrownModel(obj, knife) {
    const model = buildIconModel(obj.icon_index, knife
      ? { kind: 'weapon', wtype: 7, hand: 'right', adjust: { ...defaultAdjust('weapon', 7, 'right', obj.icon_index), scale: KNIFE_SCALE } }
      : { kind: 'weapon', wtype: 0, hand: 'right', adjust: { rot: 0, flip: false, offset: 4, scale: THROWN_SCALE } });
    if (!model) return null;
    // (in a holder of its own: a throw turns the holder, the model keeps its own turn - icon blade to -Z)
    const holder = new THREE.Group();
    holder.add(model);
    holder.userData.thrown = true;
    holder.userData.icon = obj.icon_index; holder.userData.knife = !!knife;
    return holder;
  }
  readyUsable(obj, kind) {
    this.cancelReady();
    const fx = new THREE.Group();
    if (kind === 'item') {
      // VR: the item itself in the hand; the flat screen keeps the icon (seen from behind a model is only an edge)
      const model = G.vr ? this.thrownModel(obj, this.isKnife(obj)) : null;
      fx.add(model || this.iconSprite(obj.icon_index));
      fx.userData.model = !!model;
    } else {
      const color = new THREE.Color(this.skillColor(obj)).multiplyScalar(fxk());
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.setScalar(0.32);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(0.45 + 0.55 * fxk()), toneMapped: false }));
      fx.add(glow, core);
      fx.userData.glow = glow;
    }
    const right = G.vr ? G.input.controllers.right : null;
    if (right) { right.grip.add(fx); if (fx.userData.model) fx.position.set(0, 0, 0.03); else fx.position.set(0, 0.02, -0.08); }
    else { G.three.camera.add(fx); fx.position.set(0.22, -0.22, -0.5); }
    const physicalArea = obj.scope === 2 && obj.hit_type === 1 && kind === 'skill';
    const area = obj.scope === 2;
    const marker = new FloorMarker(this.root, area
      ? { shape: 'circle', r: physicalArea ? 3.5 : 2.5, color: MARK.player }
      : { shape: 'circle', r: 0.45, color: MARK.player, label: '' });
    this.ready = { obj, kind, fx, marker, physicalArea, area, t: 0 };
    G.audio?.playSe(G.seAt(kind === 'item' ? 'Equip1' : 'Magic1', 60, 120));
    G.input.haptic('right', 0.4, 50);
    if (!this.readyHintShown) { this.readyHintShown = true; G.ui.toast(G.vr ? tr('오른손으로 겨누고 트리거로 발사 · X로 취소') : tr('겨누고 좌클릭으로 발사 · Q로 취소')); }
    return true;
  }
  // (co-op) what this player has ready, as it aims it - an area spell, a throwable: where it would land and how wide
  // ([x, floor y, z, r]); the others see it all the while (coop.js poseMsg rk), to step out of it before it comes
  readyMark() {
    const r = this.ready;
    if (!r?.marker?.outer?.visible) return null;
    const p = r.marker.outer.position;
    return [p.x, p.y - 0.045, p.z, r.marker.spec.r];
  }
  cancelReady(sound = false) {
    const r = this.ready;
    if (!r) return;
    r.fx.parent?.remove(r.fx);
    r.fx.traverse(o => {
      if (!o.isSprite) o.geometry?.dispose();          // sprites share one geometry
      if (o.material) { if (o.material.map && o.material.map !== this._glowTex) o.material.map.dispose(); o.material.dispose(); }
    });
    r.marker.dispose();
    this.ready = null;
    this.showArms();
    if (sound) G.audio?.playSystemSe(2);
  }
  // where the right hand (PC: the view) points: first enemy on the line, and where it meets floor / wall
  readyAim() {
    const right = G.vr ? G.input.controllers.right : null;
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    if (right) {
      right.ray.updateWorldMatrix(true, false);
      origin.setFromMatrixPosition(right.ray.matrixWorld);
      dir.set(0, 0, -1).transformDirection(right.ray.matrixWorld);
    } else {
      G.three.camera.getWorldPosition(origin);
      dir.set(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    }
    const range = 15, step = 0.2;
    const p = new THREE.Vector3();
    const sx = origin.x / T - 0.5, sy = origin.z / T - 0.5;
    let enemy = null, point = origin.clone().addScaledVector(dir, range);
    march: for (let t = 0.3; t <= range; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      const tx = p.x / T - 0.5, ty = p.z / T - 0.5;
      if (!G.map.validW(Math.round(tx), Math.round(ty)) || (t > 0.6 && !lineOfSight(sx, sy, tx, ty))) { point = p.clone().addScaledVector(dir, -step); break; }
      const fl = G.floorAt(tx, ty);
      if (p.y <= fl) { point = p.clone(); point.y = fl; break; }
      for (const e of this.allTargets()) {
        const wp = e.worldPos(tmpA);
        if (Math.hypot(p.x - wp.x, p.z - wp.z) < e.hr * T + 0.3 && p.y > wp.y - 0.2 && p.y < wp.y + e.h + 0.3) { enemy = this.partAt(e, p); point = new THREE.Vector3(wp.x, wp.y, wp.z); break march; }
      }
    }
    // a spot in the air drops to the floor below it
    point.y = G.floorAt(point.x / T - 0.5, point.z / T - 0.5);
    return { origin, dir, enemy, point };
  }
  updateReady(dt, paused) {
    const r = this.ready;
    if (!r) return;
    if (this.playerDead || this.spectating || G.ui.menuOpen || G.map?.transferring) { this.cancelReady(); return; }
    if (this.weapon) this.weapon.visible = false;
    r.t += dt;
    const pulse = 1 + Math.sin(r.t * 8) * 0.12;
    if (!r.fx.userData.model) r.fx.scale.setScalar(pulse);
    r.fx.children.forEach(c => { if (c.userData.spin || c.isSprite) c.material.rotation += dt * 3; });
    if (paused) { r.marker.setVisible(false); return; }
    const aim = this.readyAim();
    r.aim = aim;
    r.marker.setVisible(true);
    if (r.physicalArea) {
      const head = G.player.headWorld(new THREE.Vector3());
      r.marker.setPose(head.x, G.floorAt(head.x / T - 0.5, head.z / T - 0.5), head.z, 0);
    } else {
      r.marker.setPose(aim.point.x, aim.point.y, aim.point.z, 0);
      if (!r.area) r.marker.setColor(aim.enemy ? 0xffd060 : MARK.player);
    }
    r.marker.setProgress(1);
    const fire = G.vr ? G.input.xrPressed('right', 0) : G.input.attackPressed();
    if (fire) this.fireReady();
  }
  fireReady() {
    const r = this.ready;
    if (!r) return;
    const { obj, kind } = r;
    const actor = G.state.party.leader();
    const name = stripEscapes(obj.name);
    // costs are paid when it actually goes
    if (kind === 'item' && G.state.party.itemCount('item', obj.id) <= 0) { G.ui.toast(tr('{name}: 남은 것이 없습니다', { name }), obj.icon_index); this.cancelReady(); return; }
    if (kind === 'skill' && !actor.skillCostPayable(obj)) {
      const hpShort = actor.mp >= actor.skillMpCost(obj) && actor.tp >= (obj.tp_cost || 0);
      G.ui.toast(hpShort ? tr('{name}: HP가 부족합니다', { name }) : tr('{name}: MP가 부족합니다', { name }), obj.icon_index); this.cancelReady(); return;
    }
    if (!G.vr) this.deskActUntil = G.time + DESK_ACT / playerRecoveryRate(actor); // recovery only; costs and skill turn cooldowns stay unchanged
    const aim = r.aim || this.readyAim();
    const from = new THREE.Vector3(); r.fx.getWorldPosition(from);
    // throwing knives stay in the hand - one throw per pull, no waiting - until they run out or X puts them away
    const knife = kind === 'item' && this.isKnife(obj);
    if (!knife) this.cancelReady();
    this.payUsable(obj, kind);
    if (kind === 'skill') this.playerFollowUp(obj, aim.enemy || null, from);
    if (knife && G.state.party.itemCount('item', obj.id) <= 0) this.cancelReady();
    G.input.haptic('right', 0.8, 70);
    if (kind === 'item') G.audio?.playSe(G.seAt('Wind7', 70, knife ? 165 : 120));
    else G.audio?.playSe(G.seAt('Magic1', 70, 100));
    if (kind === 'item') { this.throwItem(obj, from, aim, knife); return; }
    if (r.physicalArea) {
      const head = G.player.headWorld(new THREE.Vector3());
      head.y = G.floorAt(head.x / T - 0.5, head.z / T - 0.5);
      this.burstUsable(obj, head, 3.5);
      this.areaMark(head, 3.5, G.time + 0.6);
      G.coop?.shareBurst?.(head, 3.5, this.skillColor(obj), obj.animation_id);
      return;
    }
    const opts = { speed: kind === 'item' ? 12 : 20, owner: 'player', usable: obj, homing: 0, life: 2.5 };
    if (r.area) {
      const to = aim.point.clone(); to.y += 0.2;
      this.spawnProjectile(from, to.clone().sub(from), { ...opts, aoe: 2.5, dest: to, mesh: kind === 'item' ? this.iconSprite(obj.icon_index) : null, color: this.skillColor(obj) });
      return;
    }
    const n = { 3: 1, 4: 2, 5: 3, 6: 4 }[obj.scope] || 1;
    for (let k = 0; k < n; k++) {
      this.later(k * 130, () => {
        const dir = aim.dir.clone();
        if (n > 1) dir.add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12)).normalize();
        this.spawnProjectile(from, dir, { ...opts, target: aim.enemy, mesh: kind === 'item' ? this.iconSprite(obj.icon_index) : null, color: this.skillColor(obj) });
      });
    }
  }
  // a knife flies straight and fast where the hand points; anything else goes in an arc onto the spot aimed at - onto
  // the enemy aimed at, keeping on it as it moves (its course across the floor bends, its height is the throw's)
  throwItem(obj, from, aim, knife) {
    const model = this.thrownModel(obj, knife);
    const mesh = model || this.iconSprite(obj.icon_index);
    const base = { owner: 'player', usable: obj, homing: 0, mesh, color: this.skillColor(obj) };
    if (knife) {
      if (model) model.quaternion.setFromUnitVectors(FORWARD, aim.dir.clone().normalize());
      this.spawnProjectile(from, aim.dir, { ...base, speed: KNIFE_SPEED, life: 1.2, align: true, fine: true });
      return;
    }
    const area = obj.scope === 2;
    const dest = aim.enemy ? aim.enemy.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, aim.enemy.h * 0.5, 0))
      : aim.point.clone().add(new THREE.Vector3(0, area ? 0.2 : 0.05, 0));
    const flight = THREE.MathUtils.clamp(0.25 + Math.hypot(dest.x - from.x, dest.z - from.z) / 12, 0.3, 1.4);
    const v0 = dest.clone().sub(from).divideScalar(flight);
    v0.y += 0.5 * THROW_GRAVITY * flight;
    if (model) {
      // its picture faces back at the thrower, upright, and spins in that face as it flies (the model's front is its
      // holder's -X, the icon's top its -Z)
      const f = new THREE.Vector3(v0.x, 0, v0.z);
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      const z = new THREE.Vector3(0, -1, 0), y = new THREE.Vector3().crossVectors(z, f);
      model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, y, z));
    }
    this.spawnProjectile(from, v0, { ...base, speed: v0.length(), life: flight + 1.5, gravity: THROW_GRAVITY, track: aim.enemy || null,
      landAt: G.time + flight, tumble: !!model, aoe: area ? 2.5 : 0, dest: area ? dest : null });
  }
  // a thrown pot that met no enemy: it breaks where it fell (its own animation there), and an enemy right beside
  // that spot still takes it
  landThrown(p) {
    const at = p.mesh.position.clone();
    at.y = Math.max(at.y, G.floorAt(at.x / T - 0.5, at.z / T - 0.5));
    let best = null, bd = THROWN_SPLASH;
    for (const e of this.allTargets()) {
      const wp = e.worldPos(tmpB);
      const d = Math.hypot(wp.x - at.x, wp.z - at.z) - e.hr * T;
      if (d < bd) { bd = d; best = e; }
    }
    if (p.usable.animation_id > 0) G.screen.playAnimationOn(at.clone().add(new THREE.Vector3(0, 0.3, 0)), p.usable.animation_id, { rate: 3 });
    // (PvP: another player right beside where it broke takes it too)
    const pt = (G.coop?.pvpTargets?.() || []).find(c => Math.hypot(c.x - at.x, c.z - at.z) - c.r < THROWN_SPLASH);
    if (pt) this.strikePlayerWith(pt, p.usable);
    if (!best) return;
    const n = Math.max(1, Math.min(5, p.usable.repeats || 1));
    for (let r = 0; r < n; r++) this.later(r * 120, () => { if (best.alive) this.applyUsableToEnemy(best, p.usable, at); });
  }
  // an area spell / thrown item bursting at a spot: everything within the radius takes it
  burstUsable(obj, at, radius) {
    this.burstFx(this.skillColor(obj), obj.animation_id, at, radius);
    const n = Math.max(1, Math.min(5, obj.repeats || 1));
    for (const e of this.allTargets()) {
      const wp = e.worldPos(tmpB);
      if (Math.hypot(wp.x - at.x, wp.z - at.z) > radius + e.hr * T) continue;
      for (let k = 0; k < n; k++) this.later(k * 120, () => this.applyUsableToEnemy(e, obj, at));
    }
    // (PvP: the other players in it take it too)
    for (const t of G.coop?.pvpTargets?.() || []) if (Math.hypot(t.x - at.x, t.z - at.z) <= radius + t.r) this.strikePlayerWith(t, obj);
  }
  // 메리의 지팡이's orb over (STAFF_BURST): it bursts where it met an enemy (its blow and the reach of it around landed
  // with the hit - playerHitEnemy) or struck the floor or a wall (its blow then on all within the reach, PvP players as
  // well); a blue glow, the reach marked on the floor a moment, the others in co-op shown the same. One that flew out of
  // its life in the air does nothing
  staffBurst(p) {
    const r = p.staff;
    let at = p.burstAt;
    if (!at) {
      if (!p.landed) return;
      at = p.mesh.position.clone();
      at.y = G.floorAt(at.x / T - 0.5, at.z / T - 0.5);
      const actor = G.state.party.leader(), skill = actor && this.skillByState(actor, this.playerAttackSkill(actor));
      if (skill) {
        const blow = {};                               // (one attack for the groggy gauge)
        for (const e of this.allTargets()) if (e.worldPos(tmpB).distanceTo(at) <= r + e.hr * T) this.applyUsableToEnemy(e, skill, at, { mult: p.power, knock: 0.1, blow });
        for (const t of G.coop?.pvpTargets?.() || []) if (Math.hypot(t.x - at.x, t.z - at.z) <= r + t.r) this.strikePlayer(t, { power: p.power });
      }
    }
    this.burstFx(p.color, 0, at, r);
    this.areaMark(at, r, G.time + 0.6, null, true);
    G.coop?.shareBurst?.(at, r, p.color, 0);
  }
  // what a burst looks like: its colour's glow over the spot and its animation (the others are shown it too - peerShotEnds,
  // coop.js shareBurst)
  burstFx(color, anim, at, radius) {
    this.spawnGlow(at.clone().add(new THREE.Vector3(0, 0.4, 0)), { color, size: radius * 1.6, life: 0.35, grow: 1.2 });
    if (anim > 0) G.screen.playAnimationOn(at.clone().add(new THREE.Vector3(0, 0.6, 0)), anim, { rate: 3 });
  }
  // (co-op) another player's shot over, as shown here: an area one bursts where it ended, a pot that met no one breaks
  // where it fell (its animation there)
  peerShotEnds(p) {
    const at = p.mesh.position.clone();
    if (p.aoe && !p.burst) { p.burst = true; this.burstFx(p.color, p.anim, at, p.aoe); return; }
    if (!p.gravity || p.hit || p.anim <= 0) return;
    at.y = Math.max(at.y, G.floorAt(at.x / T - 0.5, at.z / T - 0.5));
    G.screen.playAnimationOn(at.add(new THREE.Vector3(0, 0.3, 0)), p.anim, { rate: 3 });
  }

  // targets in front of the player's gaze: single / random scopes take the best aligned enemy
  pickTargets(obj, kind) {
    const head = G.player.headWorld(new THREE.Vector3());
    const look = G.player.forwardVec();
    const melee = kind === 'skill' && obj.hit_type === 1;
    const range = melee ? 4.5 : 15;
    const pc = G.map.playerChar;
    const cands = [];
    for (const e of this.allTargets()) {
      const wp = e.worldPos(new THREE.Vector3());
      const to = new THREE.Vector3(wp.x - head.x, 0, wp.z - head.z);
      const d = to.length();
      if (d - e.hr * T > range) continue;
      if (!lineOfSight(pc.fx, pc.fy, e.fx, e.fy)) continue;
      cands.push({ e, d, ang: d > 1e-3 ? to.normalize().angleTo(look) : 0 });
    }
    if (obj.scope === 2) return cands.filter(c => c.ang < 1.7 || c.d < 3).map(c => c.e);
    const front = cands.filter(c => c.ang < 0.6).sort((a, b) => (a.ang * 4 + a.d * 0.08) - (b.ang * 4 + b.d * 0.08));
    if (!front.length) return [];
    if (obj.scope === 1) return [front[0].e];
    const n = { 3: 1, 4: 2, 5: 3, 6: 4 }[obj.scope] || 1;
    const pool = front.slice(0, 4).map(c => c.e);
    return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
  }
  // where thrown items and spells leave from: the left hand (PC: low left of the view)
  castOrigin() {
    const left = G.vr ? G.input.controllers.left : null;
    if (left) return left.grip.getWorldPosition(new THREE.Vector3());
    const head = G.player.headWorld(new THREE.Vector3());
    const f = G.player.forwardVec();
    return head.addScaledVector(f, 0.45).add(new THREE.Vector3(f.z * 0.18, -0.25, -f.x * 0.18));
  }
  launchUsable(obj, kind, from, e) {
    const to = e.worldPos(new THREE.Vector3()); to.y += e.h * 0.6;
    const opts = { speed: kind === 'item' ? 11 : 19, owner: 'player', target: e, usable: obj, homing: 0 };
    if (kind === 'item') opts.mesh = this.iconSprite(obj.icon_index);
    else opts.color = this.skillColor(obj);
    this.spawnProjectile(from, to.sub(from), opts);
  }
  iconSprite(iconIndex) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    drawIcon(ctx, iconIndex, 4, 4, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false }));
    s.scale.setScalar(0.22);
    s.userData.spin = true;
    s.userData.icon = iconIndex;                     // (co-op: what the others are shown flying - shareShot)
    return s;
  }
  // an item / skill landing on an enemy: damage formula, drain, added / removed states.
  // mult scales the damage (swing power, back stab, critical); 0 damage stays 0 like the original
  applyUsableToEnemy(e, obj, sourcePos, { mult = 1, crit = false, knock = 0.1, weak = false, color = null, by = null, blow = null, canReflect = true } = {}) {
    if (!e.alive) return 0;
    if (this.heldBoss(e)) return -1;
    const actor = by || G.state.party.leader();          // (by: a companion using its skill)
    // what it always evades (script 220 - 흰 유니콘 유니스 and every sure hit): its evasion sound, nothing lands
    if (!this.certainHit(actor, obj) && e.b.certainty(1, obj.hit_type ?? 1)) { this.missOn(e, obj); return -1; }
    // a spell turned back (magic reflection - an enemy chanting, 영창): it lands on the one who cast it
    if (canReflect && !by && obj.hit_type === 2 && e.b.mrf > Math.random()) { this.reflectOntoPlayer(e, obj); return -1; }
    if (!this.hitLands(actor, obj)) { this.missOn(e, obj); return -1; }
    // slipped in a stance that answers it (리포스트, script 191): nothing lands
    const slip = this.slipsWithAnswer(e.b, obj, actor);
    if (slip) { this.enemySlips(e, slip, obj, sourcePos, by); return -1; }
    const p = e.worldPos(new THREE.Vector3());
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const type = obj.damage?.type || 0;
    let dmg = 0;
    if (type === 1 || type === 5) {
      dmg = this.computeDamage(actor, e.b, obj, mult * (e.state === 'stagger' ? 1.5 : 1));
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), dmg <= 0 ? '#9a9a9a' : weak ? '#ff3a3a' : color || (crit ? '#ffd040' : '#ffffff'));
      const heal = (type === 5 ? dmg : 0) + this.convertDrain(actor, obj, dmg);
      if (heal > 0 && actor) {
        actor.hp = Math.min(actor.mhp, actor.hp + heal);
        if (by) this.allies.healActor(by, heal); else this.popupAtPlayer(`+${heal}`, '#60ff80');
      }
      if (sourcePos && knock) {
        const away = Math.atan2(p.z - sourcePos.z, p.x - sourcePos.x);
        e.knock.x += Math.cos(away) * knock; e.knock.y += Math.sin(away) * knock;
      }
      if (dmg > 0) this.damageRemovesStates(e);
    }
    for (const ef of obj.effects || []) {
      if (ef.code === 11) {                              // HP by a share of max HP (negative: a cut), by its recovery rate
        const v = Math.floor((e.b.mhp * ef.value1 + ef.value2) * e.b.rec);
        if (v < 0) {
          e.b.hp = Math.max(0, e.b.hp + v);
          e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
          this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), String(-v), '#ffb0b0');
        } else if (v > 0) { e.b.hp = Math.min(e.b.mhp, e.b.hp + v); e.drawBar(); }
      } else if (ef.code === 21 && ef.data_id === 0) {   // "normal attack" states: the attacker's own (poison blades...)
        for (const id of actor?.atkStates() || []) {
          if (id === STUN) continue;                   // (stun: the groggy gauge instead)
          if (Math.random() < this.stateEffectChance(actor, e.b, obj, id, ef.value1 * actor.atkStatesRate(id))) this.addEnemyState(e, id);
        }
        this.groggyHit(e, actor, obj, mult, blow);
      } else if (ef.code === 21 && ef.data_id === 1) {   // instant death (ouija board etc.)
        if (Math.random() < this.stateEffectChance(actor, e.b, obj, 1, ef.value1)) e.b.hp = 0;
      } else if (ef.code === 21 && ef.data_id > 1) {
        const id = ef.data_id;
        if (id === 7 || id === 8) {
          if (Math.random() < this.breakRoll(e, id, ef.value1)) this.breakEnemy(e, id);
          continue;
        }
        if (Math.random() < this.stateEffectChance(actor, e.b, obj, id, ef.value1)) this.addEnemyState(e, id);
      } else if (ef.code === 22) {
        e.b.removeState(ef.data_id);
        if (e.stateTimers) delete e.stateTimers[ef.data_id];
      } else if (ef.code === 12) {                       // MP by a share (a minus: taken away)
        const v = Math.floor((e.b.mmp * ef.value1 + ef.value2) * e.b.rec);
        e.b.mp = Math.max(0, Math.min(e.b.mmp, e.b.mp + v));
      } else if (ef.code === 44) this.fightCommonEvent(ef.data_id);
    }
    // buffs / debuffs (a curse on its weapon, its legs shot): a cold glow as it goes down, a warm one up
    const before = e.b.buffs.reduce((a, v) => a + v, 0);
    if (this.applyBuffEffects(e.b, obj, ENEMY_TURN)) {
      const after = e.b.buffs.reduce((a, v) => a + v, 0);
      if (after !== before) this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), { color: after < before ? 0x5878ff : 0xff7848, size: e.h * 0.9, life: 0.5, grow: 1.3 });
    }
    this.checkEnemyDeath(e);
    return dmg;
  }
  // script 220: an item / skill that lands whatever the target evades - <絶対命中> on it, or its user's features
  certainHit(user, obj) { return /<絶対命中>/.test(obj?.note || '') || !!user?.certainty?.(0, obj?.hit_type ?? 1); }
  // The weapon must meet its target first; RPG accuracy still decides whether
  // that contact lands. HIT applies only to physical attacks (VX Ace item_hit).
  hitLands(user, skill) {
    if (this.certainHit(user, skill)) return true;
    const success = Number(skill?.success_rate ?? 100), hit = skill?.hit_type === 1 ? user?.hit ?? 1 : 1;
    const chance = THREE.MathUtils.clamp(success / 100 * hit, 0, 1);
    return Number.isFinite(chance) && Math.random() < chance;
  }
  // Script 185 can ignore LUK or state susceptibility, but never state immunity.
  stateEffectChance(user, target, skill, id, base = 1) {
    if (target.stateResist(id)) return 0;
    const note = skill?.note || '', forced = /<強制付与>/.test(note);
    const rate = forced || /<有効度無視ステート付与>/.test(note) ? 1 : target.stateRate(id);
    const luck = forced || /<運無視ステート付与>/.test(note) ? 1 : Math.max(0, 1 + ((user?.luk ?? 0) - (target.luk ?? 0)) * 0.001);
    return THREE.MathUtils.clamp(base * rate * luck, 0, 1);
  }
  missOn(e, obj) {
    const p = e.worldPos(new THREE.Vector3());
    G.audio?.playSystemSe(obj?.hit_type === 2 ? 19 : 18);
    this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), { color: 0xe8f0ff, size: e.h * 0.6, life: 0.25, grow: 1.6 });
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
  }
  // the player's spell turned back by an enemy: it lands on the player (its damage as from the player, its states
  // and buffs), with the original's reflection sound
  reflectOntoPlayer(e, obj) {
    const actor = G.state.party.leader();
    const p = e.worldPos(new THREE.Vector3());
    G.audio?.playSystemSe(20);
    this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.6, p.z), { color: 0xc8f0ff, size: e.h * 0.9, life: 0.35, grow: 1.5 });
    if (!actor || this.playerDead) return;
    const t = obj.damage?.type || 0;
    const dmg = t === 1 || t === 5 ? this.computeDamage(actor, actor, obj) : 0;
    if (dmg > 0) {
      actor.hp = Math.max(0, actor.hp - dmg);
      G.screen.hurtFlash(1);
      G.input.haptic('left', 0.8, 90); G.input.haptic('right', 0.8, 90);
      this.popupAtPlayer(`-${dmg}`, '#ffb0b0');
    }
    for (const ef of obj.effects || []) {
      if (ef.code === 21 && ef.data_id === 1) {
        if (Math.random() < this.stateEffectChance(actor, actor, obj, 1, ef.value1)) actor.addState(1);
      } else if (ef.code === 21 && ef.data_id > 1 && !actor.stateResist(ef.data_id) && Math.random() < ef.value1 * actor.stateRate(ef.data_id)) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); }
    }
    this.applyBuffEffects(actor, obj, TURN_SECONDS);
    if (actor.hp <= 0) this.playerFalls(e.battle);
  }
  // an enemy's spell turned back by the player (magic reflection - 거울의 대방패): it lands on that enemy
  reflectOntoEnemy(e, skill) {
    const head = G.player.headWorld(new THREE.Vector3());
    G.audio?.playSystemSe(20);
    this.spawnGlow(head.clone().add(new THREE.Vector3(0, -0.3, 0)), { color: 0xc8f0ff, size: 0.8, life: 0.35, grow: 1.6 });
    if (!e?.alive) return;
    const p = e.worldPos(new THREE.Vector3());
    const t = skill.damage?.type || 0;
    const dmg = t === 1 || t === 5 ? this.computeDamage(e.b, e.b, skill) : 0;
    if (dmg > 0) {
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), '#c8f0ff');
    }
    for (const ef of skill.effects || []) {
      if (ef.code === 21 && ef.data_id === 1) {
        if (Math.random() < this.stateEffectChance(e.b, e.b, skill, 1, ef.value1)) e.b.hp = 0;
      } else if (ef.code === 21 && ef.data_id > 1 && !e.b.stateResist(ef.data_id) && Math.random() < ef.value1 * e.b.stateRate(ef.data_id)) this.addEnemyState(e, ef.data_id);
    }
    this.applyBuffEffects(e.b, skill, ENEMY_TURN);
    this.checkEnemyDeath(e);
  }
  // a common event a skill that strikes calls (effect 44) runs at once beside the fight, as VX Ace runs it in the
  // battle - 비전・귀섬 calls 最期の太刀, and 귀신 무사's last stand ends in 할복 (once a use, however many it hits)
  fightCommonEvent(id) {
    if (G.coop?.phantom) return;                   // (another player's world: its events are run there)
    const list = commonEventList(id);
    if (!list) return;
    if (this.ceAt?.[id] !== undefined && G.time - this.ceAt[id] < 0.3) return;
    (this.ceAt ||= {})[id] = G.time;
    const it = new Interpreter(1);
    it.troop = true;
    it.setup(list, 0);
    this.sideInterps.push(it);
  }
  // 変換攻撃 (script 199): <変換攻撃判定:chance> on the skill, then <HP変換攻撃:percent,chance> on it or on
  // the attacker's equipment / states turns that share of the damage dealt into HP (the youtou's drain)
  convertDrain(actor, obj, dmg) {
    if (!actor || dmg <= 0) return 0;
    const gate = /<変換攻撃判定[：:]\s*([\d.]+)\s*>/.exec(obj.note || '');
    if (!gate || !(parseFloat(gate[1]) > Math.floor(Math.random() * 100))) return 0;
    let pct = 0;
    for (const o of [...actor.featureObjects(), obj]) {
      const m = /<HP変換攻撃[：:]([^>\s]+)>/.exec(o?.note || '');
      if (!m) continue;
      const [a, b = '100'] = m[1].split(/\s*,\s*/);
      if (parseFloat(b) > Math.floor(Math.random() * 100)) pct += parseFloat(a) || 0;
    }
    return Math.floor(dmg * pct / 100);
  }
  // VX Ace: at 0 HP an enemy gets the death state unless it resists it (불사신 and other gimmicks); then
  // it stays standing at 0 HP until the gimmick takes the resistance away
  checkEnemyDeath(e) {
    if (e.puppet) return;                          // (it falls when the host's falls - coop.js)
    if (!e.alive || e.b.hp > 0) return;
    if (!e.b.stateResist(1) && e.battle && this.autoReviveEnemy(e)) return;
    if (!e.b.stateResist(1)) { this.killEnemy(e); return; }
    if (!e.deathlessAt || G.time - e.deathlessAt > 2) {
      e.deathlessAt = G.time;
      // (it does not go down yet: the shimmer the player's own deathless state makes - no words over it)
      const p = e.worldPos(new THREE.Vector3()); p.y += e.h * 0.6;
      G.audio?.playSe(G.seAt('Saint3', 60, 130), p);
    }
  }
  autoReviveEnemy(e) {
    const r = e.b.autoRevive();
    if (!r) return false;
    e.b.die(); e.b.removeState(1); this.pruneStateTimers(e);
    e.b.hp = Math.min(e.b.mhp, r.hp); e.drawBar();
    const p = e.worldPos(new THREE.Vector3());
    if (r.anim) G.screen.playAnimationOn(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), r.anim, { world: true, size: this.enemySize(e) });
    G.audio?.playSystemSe(16);
    if (r.breakRate > Math.random() * 100) this.breakSaver(e.b, r.source);
    return true;
  }
  // lasting: one that never wears off in the original stays (a state a running-out one brings - 노・페이스's last
  // stance); else it lasts 8 turns here
  addEnemyState(e, id, quiet = false, lasting = false) {
    const st = $data.states[id];
    if (!st || !e.alive) return;
    // death (a skill of its own - 빙폭의 비스트 melting away, a self-destruct -, or one that strikes it): it falls as from
    // any blow, unless it cannot die
    if (id === 1) { if (!e.b.stateResist(1)) { e.b.hp = 0; this.killEnemy(e); } return; }
    e.b.addState(id);
    if (!e.b.isState(id)) return;                    // (it resists it)
    this.markBreakOpen(e, id);
    if (lasting && !st.auto_removal_timing) { if (e.stateTimers) delete e.stateTimers[id]; }
    else if (st.auto_removal_timing === 1 && st.restriction < 4) {
      // removed at the end of an action (charging up, chanting): its turns count down as the enemy's own actions
      // end (the ATB, script 148) - a charge (2) lasts through the attack it was charging for, 기사의 긍지 (10)
      // through ten of them
      const n = Math.max(1, st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1)));
      (e.actionStates ||= {})[id] = { at: e.turn, n };
      (e.stateTimers ||= {})[id] = Math.max(20, n * 6);           // safety net
    } else {
      const turns = st.auto_removal_timing ? st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1)) : 8;
      // (one a troop's event puts on the party as well, at the same moment - 흑기사 린다메아's 린다메아영역2, the duel neither side
      // can die in: the original counts it in the same turns on both, so it lasts as long on her as on the player - an enemy's
      // turn here is a third of the player's, and it was over on her side long before the player's)
      const party = G.state?.system?.stateTimers?.[id];
      (e.stateTimers ||= {})[id] = st.auto_removal_timing && party > 0 && G.state.party.leader()?.isState(id) ? party : Math.max(2, turns * 2);
    }
    // knocked out of its wind-up (or its move): the attack is off, and so is its mark on the floor
    if (st.restriction >= 4 && (e.state === 'windup' || e.state === 'act')) { e.state = 'recover'; e.timer = 0.4; e.act = null; e.move = null; this.dropMarker(e); }
  }
  // 흑기사 린다메아's duel: a state that keeps both her and the player from dying, put on both at once for a while (린다메아영역2):
  // she stands her ground under the player's blows while it lasts - no knockback
  inDuel(e) {
    const a = G.state?.party?.leader();
    return !!a && e.b.states.some(id => {
      const st = $data.states[id];
      return !!st?.auto_removal_timing && a.isState(id) && (st.features || []).some(f => f.code === 14 && f.data_id === 1);
    });
  }
  damageRemovesStates(e) {
    for (const id of [...e.b.states]) {
      const st = $data.states[id];
      if (st?.remove_by_damage && Math.random() * 100 < st.chance_by_damage && id !== 1) {
        e.b.removeState(id);
        if (e.stateTimers) delete e.stateTimers[id];
      }
    }
  }
  enemyRestricted(e) {
    return e.b.states.some(id => id !== 7 && id !== 8 && ($data.states[id]?.restriction || 0) >= 4);
  }
  // timed states on enemies (turns = 2 s) and slip damage (poison) every 2 s
  tickEnemyStates(e, dt) {
    if (e.alive) e.b.tickBuffs(dt);
    const timers = e.stateTimers;
    if (!e.alive) return;
    let removed = false;
    for (const k of Object.keys(timers || {})) {
      timers[k] -= dt;
      if (timers[k] <= 0) {
        delete timers[k]; e.b.removeState(+k); removed = true;
        for (const s of this.stateExpired(e.b, +k)) this.addEnemyState(e, s, true, true);
      }
    }
    if (removed) this.checkEnemyDeath(e);
    if (!e.alive || e.b.hp <= 0) return;
    e.slipT = (e.slipT || 0) + dt;
    if (e.slipT < 2) return;
    e.slipT -= 2;
    if (e.b.mrg > 0 && e.b.mp < e.b.mmp) e.b.mp = Math.min(e.b.mmp, e.b.mp + Math.max(1, Math.floor(e.b.mmp * e.b.mrg)));
    const hrg = e.b.hrg;
    if (hrg > 0) {
      const before = e.b.hp;
      e.b.hp = Math.min(e.b.mhp, e.b.hp + Math.trunc(e.b.mhp * hrg));
      if (e.b.hp !== before) e.drawBar();
    } else if (hrg < 0) {
      const v = Math.max(1, Math.floor(e.b.mhp * -hrg));
      e.b.hp = Math.max(0, e.b.hp - v);
      if (e.bar) e.bar.visible = true; e.drawBar();
      const p = e.worldPos(new THREE.Vector3());
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.8, p.z), String(v), '#c070ff');
      this.checkEnemyDeath(e);
    }
  }

  // ---- short effects: flashes, tracers ----------------------------------------------------------
  glowTexture() {
    if (!this._glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      this._glowTex = new THREE.CanvasTexture(c);
    }
    return this._glowTex;
  }
  // (grav: how fast it falls - a mote rising from a marked area floats; arc: thrown along a curve from one point to
  // another, at full strength until it lands)
  spawnGlow(pos, { color = 0xffe0a0, size = 0.3, life = 0.12, grow = 1.5, vel = null, grav = 7, arc = null } = {}) {
    color = new THREE.Color(color).multiplyScalar(fxk());
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.renderOrder = 1400;
    this.root.add(s);
    this.fx.push({ obj: s, t: 0, life, size, grow, vel, grav, arc });
    return s;
  }
  // a spray of sparks glancing off where a blow met a shield: out to the sides and up, not on along the
  // blow (blow: its way, x / z)
  spawnSparks(pos, blow, n = 8, color = 0xfff0c0) {
    // (small, and a gameplay cue: full brightness whatever the effect brightness setting)
    const c = new THREE.Color(color).multiplyScalar(1 / fxk());
    const l = Math.hypot(blow.x, blow.z) || 1, bx = blow.x / l, bz = blow.z / l;
    for (let i = 0; i < n; i++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.8);
      const back = -0.4 - Math.random() * 0.8;              // a little back toward where the blow came from
      const v = new THREE.Vector3(-bz * side + bx * back, 1 + Math.random() * 1.8, bx * side + bz * back);
      this.spawnGlow(pos, { color: c, size: 0.05 + Math.random() * 0.05, life: 0.2 + Math.random() * 0.2, grow: 0.6, vel: v });
    }
    this.spawnGlow(pos, { color: c, size: 0.32, life: 0.12, grow: 1.6 });
  }
  spawnTracer(from, to, color = 0xfff0b0) {
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    const geo = new THREE.CylinderGeometry(0.014, 0.014, len, 6, 1, true);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.4 + 0.6 * fxk()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    this.root.add(m);
    this.fx.push({ obj: m, t: 0, life: 0.16, tracer: true });
  }
  updateFx(dt) {
    if (!this.fx.length) return;
    // (a trail's motes are made after the sweep: made in it, they went into the list being replaced and so were
    // never taken away again - a grab's dark red trail stayed in the air for good)
    const trails = [];
    this.fx = this.fx.filter(f => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        this.root.remove(f.obj);
        if (f.tracer) f.obj.geometry.dispose();
        f.obj.material.dispose();
        return false;
      }
      if (f.arc) {
        f.obj.position.lerpVectors(f.arc.from, f.arc.to, k);
        f.obj.position.y += f.arc.h * 4 * k * (1 - k);
        if (f.arc.trail && Math.random() < 0.6) trails.push({ at: f.obj.position.clone(), color: f.arc.trail, size: f.size * 0.45 });
        return true;
      }
      f.obj.material.opacity = 1 - k;
      if (!f.tracer) f.obj.scale.setScalar(f.size * (1 + (f.grow - 1) * k));
      if (f.vel) { f.obj.position.addScaledVector(f.vel, dt); f.vel.y -= (f.grav ?? 7) * dt; }
      return true;
    });
    for (const t of trails) this.spawnGlow(t.at, { color: t.color, size: t.size, life: 0.18, grow: 0.5 });
  }
  // animation "target flash": a short glow at the target (not right in the player's face)
  flashAt(pos, color) {
    const head = G.player?.headWorld(new THREE.Vector3());
    if (!pos || (head && pos.distanceTo(head) < 0.8)) return;
    const c = color ? new THREE.Color(color.red / 255, color.green / 255, color.blue / 255) : new THREE.Color(1, 1, 1);
    this.spawnGlow(pos, { color: c, size: 0.9, life: 0.25, grow: 1.4 });
  }

  // ---- damage --------------------------------------------------------------------------
  computeDamage(attacker, target, skill, mult = 1) {
    if (!skill?.damage || skill.damage.type === 0) return 0;
    let v = evalFormula(skill.damage.formula, attacker.solo ? attacker.solo() : attacker, target);
    // element
    const el = skill.damage.element_id;
    if (el > 0) v *= target.elementRate(el);
    else if (el < 0) {
      const els = attacker.atkElements();
      if (els.length) v *= Math.max(...els.map(e => target.elementRate(e)));
    }
    if (skill.hit_type === 1 || skill.hit_type === 2) v *= this.damageRate(attacker, target, skill);
    const variance = skill.damage.variance || 0;
    const amp = Math.floor(Math.max(Math.abs(v) * variance / 100, 0));
    v += Math.floor(Math.random() * (amp + 1)) + Math.floor(Math.random() * (amp + 1)) - amp;
    v = Math.round(v * mult);
    return Math.max(0, v);
  }
  // Script 193 combines the attacker's penetration traits with this skill's
  // bonus. The game also uses the trait spelling on skills, so accept it there
  // when the proper skill-bonus tag is absent. Count the two spellings once.
  damageRate(attacker, target, skill) {
    const type = skill.hit_type, rate = type === 1 ? target.pdr : type === 2 ? target.mdr : 1;
    if (rate >= 1 || type !== 1 && type !== 2) return rate;
    const tag = new RegExp(`<ダメージ率貫通[：:]\\s*${type}\\s*,\\s*([^>]+)>`);
    let penetrate = 0;
    for (const object of attacker.featureObjects?.() || []) {
      const value = tag.exec(object?.note || '')?.[1];
      if (value) penetrate += evalFormula(value, attacker, target);
    }
    const bonus = /<ダメージ率貫通追加[：:]\s*([^>]+)>/.exec(skill.note || '')?.[1] ?? tag.exec(skill.note || '')?.[1];
    if (bonus) penetrate += evalFormula(bonus, attacker, target);
    return THREE.MathUtils.clamp(1 - (1 - rate) * (1 - THREE.MathUtils.clamp(penetrate, 0, 100) / 100), 0, 1);
  }
  // 攻撃ID変更 (script 203): equipment / states can swap the normal attack (skill 1) for their own skill;
  // with several, the highest <攻撃ID優先度変更:n> on the skill wins, then the highest id
  playerAttackSkill(actor = G.state.party.leader()) {
    if (!actor) return $data.skills[1];
    const ids = [];
    for (const o of actor.featureObjects()) {
      if (o._atkId === undefined) { const m = /<攻撃ID変更[：:]\s*(\d+)\s*>/.exec(o.note || ''); o._atkId = m ? +m[1] : 0; }
      if (o._atkId && $data.skills[o._atkId]) ids.push(o._atkId);
    }
    if (!ids.length) return $data.skills[1];
    const prio = id => {
      const s = $data.skills[id];
      if (s._atkPrio === undefined) { const m = /<攻撃ID優先度変更[：:]\s*(-?\d+)\s*>/.exec(s.note || ''); s._atkPrio = m ? +m[1] : 0; }
      return s._atkPrio;
    };
    const uniq = [...new Set(ids)].sort((a, b) => a - b);
    const top = Math.max(...uniq.map(prio));
    return $data.skills[uniq.filter(id => prio(id) === top).pop()] || $data.skills[1];
  }
  // hits per blow: the skill's repeats (+ attack-count features) times its random-target count
  attackHits(skill, actor) {
    const repeats = Number(skill.repeats), extra = Number(actor?.featuresSum(34));
    const n = Math.max(1, Number.isFinite(repeats) ? Math.trunc(repeats) : 1) + Math.max(0, Number.isFinite(extra) ? Math.trunc(extra) : 0);
    // Original upgraded machine guns reach twelve hits. Keep valid counts while
    // bounding a malformed database value before it can enqueue a huge volley.
    return THREE.MathUtils.clamp(n * ({ 3: 1, 4: 2, 5: 3, 6: 4 }[skill.scope] || 1), 1, 64);
  }
  criticalLands(target, skill) {
    if (skill.damage?.critical === false) return false;
    const avoid = THREE.MathUtils.clamp(target.cev || 0, 0, 1);
    return avoid === 0 || Math.random() >= avoid;
  }
  // a weapon blow (VR swing, desktop click, arrow / bullet): the attack skill's formula, element, hits,
  // drain and states (Raiden's axes hit by the wielder's HP, the youtou drains, daggers hit twice...)
  // opts.melee: a swing (counts toward flailing); opts.strong: swung very hard; opts.charge: how charged (0-1); opts.one:
  // one hit of the blow's (a bullet of a burst - fireRanged)
  playerHitEnemy(e, power, crit, sourcePos, { melee = false, strong = false, charge = 0, one = false } = {}) {
    const actor = G.state.party.leader();
    // a weapon art on the weapon (red): this blow is that skill - its formula, hits, element and animation -
    // at least at full strength, and not weakened by flailing
    const art = this.takeArmedSkill(actor);
    const skill = art || this.skillByState(actor, this.playerAttackSkill(actor));
    let mult = (art ? Math.max(1, power) : power) * this.buffMult();
    // a charged blow hits up to twice as hard; a hard or charged blow on a broken enemy is the big attack
    // the Break opened: twice again, and the opening is over
    const heavy = charge >= 0.35;
    if (heavy) mult *= 1 + charge;
    const big = e.state === 'stagger' && (strong || heavy);
    if (big) mult *= 2;
    // flailing: the third and later swings within 1.5 s hit weaker, their numbers in red
    let weak = false;
    if (melee && !art) { const r = this.rushMult(); if (r < 1) { mult *= r; weak = true; } }
    if (e.state === 'idle' || (e.alertTime > 0 && e.state === 'chase' && !e.battle)) mult *= 2;     // (a backstab)
    if (e.state === 'guard' && !this.ignoresGuard(actor, skill)) mult *= 0.3;
    if (crit && !this.criticalLands(e.b, skill)) crit = false;
    if (crit) mult *= 2;
    const p = e.worldPos(new THREE.Vector3());
    const hits = one ? 1 : this.attackHits(skill, actor);
    const blow = {};                                     // (its hits are one attack for the groggy gauge)
    if (this.applyUsableToEnemy(e, skill, sourcePos, { mult, crit, knock: 0.12 * power * (heavy ? 2 : 1) * (big ? 1.6 : 1), weak, color: big ? '#ffb030' : null, blow }) < 0) {
      this.afterPlayerAction(skill, e, sourcePos, !!art);                // (slipped: nothing of the blow lands)
      return;
    }
    for (let i = 1; i < hits; i++) this.later(i * 120, () => { if (e.alive) this.applyUsableToEnemy(e, skill, sourcePos, { mult, knock: 0.04, weak, blow }); });
    if (skill.scope === 2) {
      // an "all enemies" attack (the giant iron ball): the blow reaches everyone around the one struck
      const op = new THREE.Vector3();
      for (const o of this.allTargets()) {
        if (o === e || o.worldPos(op).distanceTo(p) > 2.6 + o.hr * T) continue;
        this.applyUsableToEnemy(o, skill, p, { mult: power, knock: 0.1, blow });
      }
    }
    // the attack's own animation (a plain attack uses the weapon's) brings its sounds; otherwise a slash.
    // It plays where the weapon met the enemy, as big as the enemy
    const anim = skill.animation_id < 0 ? (actor?.weapons()[0]?.animation_id || 0) : skill.animation_id;
    const at = this.hitPoint(e, sourcePos);
    if (anim > 0) G.screen.playAnimationOn(at, anim, { rate: 2, attack: skill.id === 1, world: true, size: this.enemySize(e) * (big ? 1.6 : heavy ? 1.3 : 1) });
    else G.audio?.playSe(G.seAt(crit ? 'Slash11' : 'Slash1', 90, 90 + Math.random() * 20), at);
    G.audio?.playSystemSe(10);
    const way = new THREE.Vector3(p.x - (sourcePos?.x ?? p.x), 0, p.z - (sourcePos?.z ?? p.z));
    if (big) {
      // the big attack: a heavy crunch, a long shake in the hand, gold sparks; the enemy gets up
      G.audio?.playSe(G.seAt('Blow8', 100, 75), at);
      G.audio?.playSe(G.seAt('Explosion1', 55, 140), at);
      G.input.haptic('right', 1, 260); G.input.haptic('left', 0.6, 160);
      this.spawnSparks(at, way.lengthSq() > 1e-4 ? way : new THREE.Vector3(0, 0, 1), 16, 0xffc070);
      this.endStagger(e);
    } else if (heavy) {
      G.audio?.playSe(G.seAt('Blow3', 95, 85), at);
      G.input.haptic('right', 1, 160);
    }
    this.afterPlayerAction(skill, e, sourcePos, !!art);
    if (melee) this.maybeCounter(e, skill);
  }
  // after a blow of mine (once a swing, however many it met): what the attack leaves on me (script 113 - 쌍검's stacks,
  // 쉴드 뱅커's guard; an art's came as it was paid for) and the skill it goes on with (script 189)
  afterPlayerAction(s, e, from, art) {
    if (this.lastAct?.s === s && G.time - this.lastAct.t < 0.12) return;
    this.lastAct = { s, t: G.time };
    if (!art) this.actorUserEffect(s);
    this.playerFollowUp(s, e, from);
  }
  // a skill of mine that goes on with another (script 189 使用後追加行動 - 거룩한 총검's cut or thrust and then its gun
  // break, 글라키의 묵시록 and its thorns, 사자선풍 or 잭 슈트룸 again half the time): that one comes by itself a moment
  // later, on the same enemy (else the nearest; all around for an "all" skill), or on me - as many hits as it has (풀
  // 버스트's 7); a shot from the gun in the right hand when there is one (거룩한 총검), else from the left
  playerFollowUp(s, e, from, depth = 0) {
    const actor = G.state.party.leader();
    if (!s || !actor || depth > 8) return;
    for (const a of this.afterActions(s)) {
      if (a.p < Math.floor(Math.random() * 100)) continue;
      const next = a.id > 0 ? this.skillByState(actor, $data.skills[a.id]) : null;
      if (!next) continue;
      this.later(320, () => {
        if (this.playerDead || !actor.skillCostPayable(next) || actor.skillSealed(next.id) || this.skillCooling(next) > 0) return;
        let targets = [];
        if (next.scope >= 1 && next.scope <= 6) {
          const head = G.player.headWorld(new THREE.Vector3()), op = new THREE.Vector3();
          const near = this.allTargets().map(o => ({ o, d: o.worldPos(op).distanceTo(head) - o.hr * T })).filter(x => x.d < 8).sort((x, y) => x.d - y.d).map(x => x.o);
          targets = next.scope === 2 ? near : e?.alive && !e.hidden ? [e] : near.slice(0, 1);
          if (!targets.length) return;
        }
        this.actorPays(actor, next);
        this.skillCD[next.id] = G.time + this.coolSeconds(next);
        const at = from || this.castOrigin();
        const gun = this.skillLook(next) === 'gun', reps = THREE.MathUtils.clamp(next.repeats || 1, 1, 8);
        for (const t of targets) {
          const wp = t.worldPos(new THREE.Vector3()); wp.y += t.h * 0.5;
          if (next.animation_id > 0) { G.screen.playAnimationOn(wp, next.animation_id, { rate: 3, height: t.h }); G.coop?.shareAnim?.(wp, next.animation_id, t.h); }
          for (let r = 0; r < reps; r++) this.later(r * BURST_GAP * 1000, () => {
            if (!t.alive) return;
            this.applyUsableToEnemy(t, next, at);
            if (!gun) return;
            const f = this.shotKind === 'gun' && this.weapon && !this.disarmed ? this.muzzle() : this.castOrigin();
            this.spawnTracer(f, wp, 0xfff0c0);
            G.coop?.shareLine?.(f, wp, 0xfff0c0);
          });
        }
        if (!targets.length) this.applyUsableToActor(next, 'self');
        this.actorUserEffect(next);
        this.playerFollowUp(next, targets[0] || e, from, depth + 1);
      });
      return;
    }
  }
  // 반격 (script 173 攻撃を受けてから反撃): an enemy in a counter stance (CNT - 반격 자세, 잔심, 화내기...) answers a
  // physical blow at once - after taking it - with its counter skill (<反撃スキル n> on its states or itself, the
  // highest; else its attack): a quick blow at the player, laid down and gone in a moment
  maybeCounter(e, skill) {
    if (!e.alive || !e.battle || e.hidden || this.playerDead || !skill) return;
    if (/<反撃不可>/.test(skill.note || '') || (skill.hit_type !== 1 && !/<反撃可能>/.test(skill.note || ''))) return;
    if (e.state === 'stagger' || e.state === 'windup' || e.state === 'act' || e.state === 'dying' || this.enemyRestricted(e)) return;
    if (G.time < (e.counterReady || 0) || !(e.b.cnt > 0) || Math.random() >= e.b.cnt) return;
    let id = 0;
    for (const o of e.b.featureObjects()) { const m = /<\s*反撃スキル\s*(\d+)\s*>/.exec(o?.note || ''); if (m) id = Math.max(id, +m[1]); }
    this.startCounter(e, $data.skills[id] || $data.skills[1]);
  }
  playerCanCounter(actor, enemy) {
    return !!actor && actor.hp > 0 && !actor.isState(1) && !!enemy?.alive && !enemy.hidden && !this.outOfFight(enemy)
      && !this.playerDead && !this.spectating && !this.disarmed && !this.restrained && !this.gripAdjust && !this.held && !this.ready
      && !actor.states.some(id => ($data.states[id]?.restriction || 0) >= 4);
  }
  playerCounterSkill(enemy, incoming, actor = G.state.party.leader()) {
    if (!this.playerCanCounter(actor, enemy) || !incoming || /<反撃不可>/.test(incoming.note || '')
      || incoming.hit_type !== 1 && !/<反撃可能>/.test(incoming.note || '') || !(actor.cnt > 0) || Math.random() >= actor.cnt) return null;
    let id = 0;
    for (const obj of actor.featureObjects()) {
      const match = /<\s*反撃スキル\s*(\d+)\s*>/.exec(obj?.note || '');
      if (match) id = Math.max(id, +match[1]);
    }
    return $data.skills[id] || this.playerAttackSkill(actor);
  }
  queuePlayerCounter(enemy, skill) {
    const actor = G.state.party.leader();
    if (!skill || !this.playerCanCounter(actor, enemy)) return;
    // Original script 173 applies the incoming attack before the counter. Its
    // automatic response spends no skill cost and targets only the attacker.
    this.later(150, () => {
      if (G.state.party.leader() !== actor || !this.playerCanCounter(actor, enemy)) return;
      const strike = () => {
        if (G.state.party.leader() !== actor || !this.playerCanCounter(actor, enemy)) return;
        this.applyUsableToEnemy(enemy, skill, this.castOrigin(), { canReflect: false });
      };
      strike();
      const normalAttack = this.playerAttackSkill(actor)?.id === skill.id;
      const repeats = Number(skill.repeats);
      const hits = normalAttack ? this.attackHits({ ...skill, scope: 1 }, actor)
        : THREE.MathUtils.clamp(Number.isFinite(repeats) ? Math.trunc(repeats) : 1, 1, 64);
      for (let i = 1; i < hits; i++) this.later(i * 120, strike);
      const position = enemy.worldPos(new THREE.Vector3()); position.y += enemy.h * 0.5;
      if (skill.animation_id > 0) G.screen.playAnimationOn(position, skill.animation_id, { rate: 3, height: enemy.h });
      G.audio?.playSystemSe(10); G.input.haptic('right', 0.6, 60);
    });
  }
  // a counter (反撃) or an answer to a slipped blow (回避時スキル): a quick blow at the player, 0.35 s to see it
  // coming; not a turn of the enemy's own (as in the original, it comes inside the player's action)
  startCounter(e, s) {
    if (e.puppet) return false;                    // (the host's enemy: what it does is the host's to decide)
    if (!e.alive || e.hidden || this.playerDead || e.state === 'stagger' || e.state === 'windup' || e.state === 'act' || e.state === 'dying' || this.enemyRestricted(e)) return false;
    if (G.time < (e.counterReady || 0)) return false;
    e.counterReady = G.time + 0.9;
    e.move = null; e.act = null; e.comboStep = 0; e.pending = null;
    e.skill = s; e.style = this.skillStyle(s);
    if (!['melee', 'area', 'projectile', 'debuff'].includes(e.style)) e.style = 'melee';
    const pc = G.map.playerChar;
    e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);
    e.state = 'windup'; e.timer0 = e.timer = 0.35; e.countering = true;
    this.beginTelegraph(e);
    e.timer0 = e.timer = 0.35;                       // (no beat: a counter comes at once)
    if (e.plan) e.plan.t0 = e.timer0;
    G.audio?.playSe(G.seAt('Sword4', 90, 120), e.worldPos(new THREE.Vector3()));
    return true;
  }
  // after a perfect guard: stronger blows for a few seconds
  buffMult() { return (this.powerUntil || 0) > G.time ? POWER_BUFF.mult : 1; }
  // after a perfect guard: DEF and MDF two buff levels up while it lasts (only while a blow's damage is worked
  // out - the actor's own buffs are left as they were)
  withGuardBuff(actor, fn) {
    if (!((this.guardUntil || 0) > G.time) || !actor?.buffs) return fn();
    const b = actor.buffs, def = b[3], mdf = b[5];
    b[3] = Math.max(def, GUARD_BUFF.level); b[5] = Math.max(mdf, GUARD_BUFF.level);
    try { return fn(); } finally { b[3] = def; b[5] = mdf; }
  }
  // a swing that lands: how hard it still hits (one sweep through two enemies is one swing)
  rushMult() {
    const now = G.time, r = this.rush || (this.rush = []);
    if (!r.length || now - r[r.length - 1] > 0.15) r.push(now);
    while (r.length && now - r[0] > RUSH.window) r.shift();
    const k = r.length - RUSH.free;
    return k <= 0 ? 1 : RUSH.mults[Math.min(k, RUSH.mults.length) - 1];
  }
  // an enemy's own counter rate (CNT, its features - not what its states give it)
  ownCounter(e) {
    if (e.ownCnt === undefined || e.ownCntOf !== e.b.enemyId) {
      e.ownCntOf = e.b.enemyId;
      e.ownCnt = ($data.enemies[e.b.enemyId]?.features || []).filter(f => f.code === 22 && f.data_id === 6).reduce((s, f) => s + f.value, 0);
    }
    return e.ownCnt;
  }
  // the opening a Break made is over (the big attack used it)
  endStagger(e) {
    if (e.state !== 'stagger') return;
    e.b.removeState(8); e.b.removeState(7);
    e.state = 'recover'; e.timer = 0.6;
    this.groggyRefill(e);
    e.drawBar();
  }
  // ---- the groggy gauge (GROGGY) -------------------------------------------------------------------------------
  // how big it is (0: none - it cannot be stunned); worked out again when the enemy changes into another
  groggyMax(e) {
    const id = e.b?.enemyId;
    if (e.grogId === id) return e.grogMax;
    const d = e.b?.data, f = d?.features || [];
    const s = f.some(x => x.code === 14 && x.data_id === STUN) ? 0 : f.filter(x => x.code === 13 && x.data_id === STUN).reduce((r, x) => r * x.value, 1);
    let max = 0;
    if (d && s > 0) {
      const avg = (e.b.paramBase(2) + e.b.paramBase(3) + e.b.paramBase(5)) / 3, k = e.b.coopK || 1;
      const big = THREE.MathUtils.clamp(Math.pow(e.b.paramBase(0) / k / 1000, 0.25), 0.5, 8);
      max = Math.max(1, Math.round(GROGGY.k * avg * big / Math.sqrt(s) * k));       // (a co-op boss: as many times more)
    }
    const frac = e.grogMax ? THREE.MathUtils.clamp(e.grog / e.grogMax, 0, 1) : 1;
    e.grogId = id; e.grogMax = max; e.grog = max * frac;
    if (!max) e.grogDown = false;
    return max;
  }
  // a blow that carries the attacker's weapon states takes groggy away (blow: one attack - its hits, and the enemies an
  // "all" blow reaches, each share one cap)
  groggyHit(e, actor, obj, mult, blow) {
    const max = this.groggyMax(e);
    if (!max || !actor || !e.alive || e.state === 'stagger' || e.grogDown || this.inDuel(e)) return;     // (her duel: no groggy)
    const stun = THREE.MathUtils.clamp(actor.featuresSum(32, STUN), 0, 1);
    let g = (obj?.hit_type === 2 ? actor.mat : actor.atk) * (1 + GROGGY.stun * stun) * Math.max(0, mult);
    const used = blow?.grog?.get(e) || 0;
    g = Math.min(g, GROGGY.cap * max - used);
    if (!(g > 0)) return;
    if (blow) (blow.grog ||= new Map()).set(e, used + g);
    e.grog = Math.max(0, e.grog - g);
    e.grogT = G.time;
    if (e.grog <= 0) e.grogDown = true;
    e.drawBar();
  }
  groggyRefill(e) {
    if (!this.groggyMax(e)) return;
    e.grog = e.grogMax; e.grogDown = false;
  }
  // it fills again a little at a time once the blows stop; emptied, the enemy is broken as soon as it can be - not in
  // the middle of a big attack nothing breaks (the red ring), then right after it
  tickGroggy(e, dt) {
    if (!this.groggyMax(e)) return;
    // (흑기사 린다메아's duel - inDuel: she is never stunned in it; her gauge stays full)
    if (this.inDuel(e)) { if (e.grogDown || e.grog < e.grogMax) { this.groggyRefill(e); e.drawBar(); } return; }
    if (e.grogDown) {
      if (e.state === 'stagger' || e.state === 'dying' || e.hidden || this.breakCue(e) === 'locked') return;
      e.grogDown = false;
      const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
      this.breakEnemy(e, 8);
      // (as a Break that lands: its animation - silent, the sound is breakEnemy's - and the hand shakes)
      const brk = $data.skills[13];
      if (brk?.animation_id > 0) G.screen.playAnimationOn(at, brk.animation_id, { rate: 2, world: true, size: this.enemySize(e), mute: true });
      G.input.haptic('right', 1, 160);
      return;
    }
    if (e.state === 'stagger' || e.grog >= e.grogMax || G.time - (e.grogT || 0) < GROGGY.delay) return;
    const px = Math.round(e.grog / e.grogMax * 124);
    e.grog = Math.min(e.grogMax, e.grog + GROGGY.regen * e.grogMax * dt);
    if (Math.round(e.grog / e.grogMax * 124) !== px) e.drawBar();
  }
  // where a blow meets an enemy: on its side toward where the blow came from, at the blow's height
  hitPoint(e, src) {
    const p = e.worldPos(new THREE.Vector3());
    p.y += e.hover || 0;
    const from = src || G.player.headWorld(new THREE.Vector3());
    const dx = from.x - p.x, dz = from.z - p.z, d = Math.hypot(dx, dz) || 1;
    const r = e.hr * T * 0.8;
    const y = THREE.MathUtils.clamp(src ? src.y : p.y + e.h * 0.5, p.y + e.h * 0.15, p.y + e.h * 0.95);
    return new THREE.Vector3(p.x + dx / d * r, y, p.z + dz / d * r);
  }
  enemySize(e) { return THREE.MathUtils.clamp(Math.max(e.h, e.w || 0) * 1.1, 0.9, 3.5); }
  reviveEnemy(e) {
    if (!this.enemies.includes(e)) this.enemies.push(e);
    if (!e.group.parent) { e.group = new THREE.Group(); this.root.add(e.group); e.ready = e.build(); }
    e.state = 'recover'; e.timer = 0.8; e.fadeOnly = false; e.alertTime = 0.4;
    e.group.visible = true;
    if (e.mat) { e.mat.opacity = 1; e.mat.color.setRGB(1, 1, 1); }
    if (e.mesh) e.mesh.position.y = 0;
    if (e.bar) e.bar.visible = true;
  }
  breakEnemy(e, stateId = 8) {
    if (this.inDuel(e)) return;                       // (흑기사 린다메아's duel: nothing breaks her in it - inDuel)
    this.dropMarker(e);
    e.state = 'stagger'; e.timer = stateId === 7 ? 3.2 : 2.2;
    const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
    G.audio?.playSe(BREAK_SE, at);
    if (e.ring) e.ring.material.opacity = 0;          // (its body can still be loading)
    // (its bar turns yellow while it is broken - shown now, even before any blow of the player's has landed on it: a
    // Break does no harm of itself)
    if (e.bar) e.bar.visible = true;
    e.drawBar();
    e.b.addState(stateId);
    // being unable to act ends charging and guarding (states removed by restriction)
    for (const id of [...e.b.states]) {
      if (!$data.states[id]?.remove_by_restriction) continue;
      e.b.removeState(id);
      if (e.stateTimers) delete e.stateTimers[id];
      if (e.actionStates) delete e.actionStates[id];
    }
  }
  killEnemy(e) {
    if (e.state === 'dying' || e.state === 'dead') return;
    this.dropMarker(e);
    e.state = 'dying'; e.timer = 0;
    if (e.bar) e.bar.visible = false;               // (its body can still be loading)
    if (e.ring) e.ring.material.opacity = 0;
    // as VX Ace's die: its other states go (a fallen 거울의 그림자 is no longer broken - 반상의 고왕's count of its
    // broken shadows counted it again every turn, and the king fell after three of six)
    e.b.die(); this.pruneStateTimers(e);
    const big = e.b.solo().mhp >= 3000;
    G.audio?.playSystemSe(big ? 12 : 11);
    if (!e.battle) {
      // killed while dormant (one-shot) -> start its event so the win branch runs
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
  }
  // (a co-op guest: the host's enemies' moves, played out here, strike it here - each player judges the blows on
  // itself by what it sees; the host is told how it went, to show it - reportStruck)
  enemyStrikePlayer(e, skill, { blockable = true, kind = 'melee', certain = false, shieldHit = false, mult = 1, delayed = false, parry = false, dodged = false } = {}) {
    if (this.playerDead || this.outOfFight(e)) return;    // (co-op: a boss fight this player is out of - never its)
    if (!delayed && G.player.aloft?.()) return;              // (blown up into the sky by the wind: out of reach - liftInfo)
    const actor = G.state.party.leader();
    const head = G.player.headWorld(new THREE.Vector3());
    const ep = e ? e.worldPos(new THREE.Vector3()) : head.clone();
    // slipped past it in the dodge (dodged: while a wave went over - passOver): the game's own evasion sound, no words
    if ((G.player.invuln > 0 || dodged) && !certain) {
      G.audio?.playSystemSe(18);
      G.input.haptic('left', 0.2, 30); G.input.haptic('right', 0.2, 30);
      return;
    }
    // VX invocation chooses counter before reflection. Script 173 then applies
    // this attack normally before the selected counter is allowed to answer.
    const counter = e && this.playerCounterSkill(e, skill, actor);
    // a spell turned back (magic reflection: 거울의 대방패)
    if (!counter && e && skill?.hit_type === 2 && actor.mrf > Math.random()) { this.reflectOntoEnemy(e, skill); return; }
    if (e && skill && !this.hitLands(e.b, skill)) {
      G.audio?.playSystemSe(17); this.queuePlayerCounter(e, counter); return;
    }
    // what the player always evades (script 220)
    if (e && skill && !this.certainHit(e.b, skill) && actor.certainty(1, skill.hit_type ?? 1)) {
      G.audio?.playSystemSe(18); this.queuePlayerCounter(e, counter); return;
    }
    // Passive armor evasion also applies without a special riposte-note skill.
    const slip = e && this.slipsWithAnswer(actor, skill, e.b);
    if (slip) { this.playerSlips(e, slip, skill); this.queuePlayerCounter(e, counter); return; }
    if (!delayed && e && skill && !e.puppet) this.scheduleDelayed(e, skill);
    // near death, a companion who stands in for others (身代わり) takes a blow that is not a sure hit, as the
    // original's substitute does
    if (!certain && actor.hp < actor.mhp / 4) {
      const sub = this.allies.substitute();
      if (sub) { sub.takeHit(e, skill); this.queuePlayerCounter(e, counter); return; }
    }
    // Original item_cri is the attacker's CRI reduced by the target's CEV.
    // Effect-only skills and zero chances must not create a critical roll.
    const criticalChance = skill?.damage?.type > 0 && skill.damage.critical === true
      ? THREE.MathUtils.clamp((e?.b.cri || 0) * (1 - THREE.MathUtils.clamp(actor.cev || 0, 0, 1)), 0, 1) : 0;
    const damageMult = criticalChance > 0 && Math.random() < criticalChance ? mult * 2 : mult;
    let dmg = this.withGuardBuff(actor, () => this.computeDamage(e ? e.b : actor, actor, skill, damageMult));
    dmg = Math.round(dmg * G.settings.difficulty);
    // a share of the HP / MP the skill takes away besides (HP / MP recovery with a minus - 조커 -100%, 하얀 충격
    // -99%, 황산 -25%, 톱니바퀴 MP -8%: VX Ace's item_effect_recover_hp, by the target's recovery rate); no guard
    // lessens it, a perfect guard still stops it
    let share = 0, mpShare = 0;
    for (const ef of skill?.effects || []) {
      if (ef.code === 11 && (ef.value1 < 0 || ef.value2 < 0)) share += -(actor.mhp * ef.value1 + ef.value2) * actor.rec;
      if (ef.code === 12 && (ef.value1 < 0 || ef.value2 < 0)) mpShare += -(actor.mmp * ef.value1 + ef.value2) * actor.rec;
    }
    share = Math.floor(share * G.settings.difficulty * mult);
    let blocked = false, perfect = false;
    // (parry: a blow no plain guard stops - a heavy one, or one through a guard - which a perfect guard still does)
    const guarded = shieldHit || ((blockable || parry) && this.isBlocking(ep));
    if (guarded && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD) {
      // a perfect guard (raised just before it landed): nothing gets through, a fifth of the HP comes back,
      // and for a few seconds blows hit harder and DEF / MDF are up
      blocked = true; dmg = 0; perfect = true;
      this.perfectGuardReward(actor);
      this.guardFree = true;                     // (no cool-down after it: lowered, it may come up again at once)
      this.guardTing(ep, true);
      this.reportStruck(e, 2);
    } else if (guarded && (shieldHit || blockable)) {
      blocked = true;
      dmg = Math.round(dmg * (this.hasShield ? 0.25 : 0.5) / Math.max(0.5, actor.grd));      // (방어 효과율)
      this.stamina = Math.max(0, this.stamina - 0.22); this.staminaDelay = 1;
      this.guardTing(ep);
      this.reportStruck(e, 1);
    } else {
      // a blow that lands is felt even when it does no damage: the edges of the view flush red, both hands
      // shake (and the view, if 피격 흔들림 is on), the game's own hurt sound
      G.screen.hurtFlash(1);
      G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 1);
      G.input.haptic('left', 1, 120); G.input.haptic('right', 1, 120);
      G.audio?.playSystemSe(14);
      this.reportStruck(e, 0);
    }
    if (perfect) { this.queuePlayerCounter(e, counter); return; } // (nothing got through)
    dmg += share;
    if (mpShare > 0) actor.mp = Math.max(0, actor.mp - Math.floor(mpShare * G.settings.difficulty));
    if (dmg > 0) {
      if (blocked) G.screen.hurtFlash(0.3);            // some of it still got through the guard
      if (e && this.skillLook(skill) === 'drain') this.drainStream(e, head, skill);
      actor.hp = Math.max(0, actor.hp - dmg);
      this.damageRemovesActorStates(actor);
    }
    // the rest of it lands with no damage too (a sleep spell, a curse - the states only came with damage before)
    for (const ef of skill?.effects || []) {
      if (ef.code !== 21 || ef.data_id <= 0 || actor.stateResist(ef.data_id)) continue;
      if (ef.data_id === 1) {
        if (Math.random() < this.stateEffectChance(e?.b, actor, skill, 1, ef.value1)) actor.addState(1);
        continue;
      }
      // (blown up by the wind: always, as in the original, and up into the sky it goes - bossmoves.js liftInfo)
      const lift = !delayed && this.liftInfo().states.has(ef.data_id);
      if (lift || Math.random() < this.stateEffectChance(e?.b, actor, skill, ef.data_id, ef.value1 * 0.6)) {
        actor.addState(ef.data_id); this.timeActorState(ef.data_id);
        if (lift) this.liftPlayer(e);
      }
    }
    this.applyBuffEffects(actor, skill, TURN_SECONDS, 0.6);
    if (actor.hp <= 0) this.playerFalls(e?.battle);
    else this.queuePlayerCounter(e, counter);
  }
  // (a co-op guest struck by the host's enemy: how it went - 0 it landed, 1 guarded, 2 a perfect guard - is shown on
  // this player as the host sees it)
  reportStruck(e, how) { if (e?.puppet) G.coop?.onStruck?.(e, how); }
  // the blows only a perfect guard (or a perfect Gun Break) stops: the pink ones - heavy, or through a guard - and the
  // crimson ones, but a grab, which no guard stops at all: out of its band, or through it in a dodge
  parryable(plan) { return !!plan && plan.move !== 'grab' && !!(plan.heavy || plan.pierce || this.noPlainGuard(plan)); }
  // what no plain guard stops - a bottle thrown onto where the player stands, a death spell's circle, a lance, a spell's
  // circle at the player's feet, lines / blasts / rings / waves / pools laid round them, the chessboard: a perfect guard
  // stops it. (A sure hit among them was purple, as one a plain guard stops; the others were orange - the colour of a blow
  // that is guarded or dodged - and no guard did anything: 그랑・기뇰's waves, 리펀 대성당's circles at the feet)
  noPlainGuard(plan) { return !!plan && !plan.blockable && !plan.shot; }
  // no plain guard stops it, a perfect one does - heavy, through a guard, or such a blow: pink on the floor (a sure hit
  // among them: crimson - markLook); its border blinks, a low warning sounds
  unguardable(plan) { return !!plan && !!(plan.heavy || plan.pierce || this.noPlainGuard(plan)); }
  // how a mark looks: orange; pink = no plain guard; purple = a sure hit (no dodging through it) a plain guard
  // stops; crimson = a sure hit no plain guard stops either
  markLook(plan) {
    const noGuard = this.unguardable(plan), certain = !!plan?.certain;
    return { color: certain && noGuard ? MARK.certainHeavy : noGuard ? MARK.heavy : certain ? MARK.certain : MARK.enemy };
  }
  // whether a blow landing now from ep would meet a perfect guard (the shield up toward it, raised just now)
  parryNow(ep) { return this.isBlocking(ep) && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD; }
  // a perfect guard's reward: a fifth of the HP back, then for a few seconds stronger blows and DEF / MDF up
  perfectGuardReward(actor) {
    this.powerUntil = this.guardUntil = G.time + POWER_BUFF.time;
    if (actor.hp > 0) actor.hp = Math.min(actor.mhp, actor.hp + Math.round(actor.mhp * GUARD_BUFF.heal));
  }
  // a grab winding up: dark red motes drawn in along its band, from its far end to the one reaching out - a
  // pull before anything is caught
  grabMotes(e, plan) {
    if (G.time < (e.grabMoteAt || 0)) return;
    e.grabMoteAt = G.time + 0.07;
    const ux = Math.cos(plan.aim), uz = Math.sin(plan.aim), wx = -uz, wz = ux;
    const hand = new THREE.Vector3(plan.ox + ux * (e.r * T * 0.6), plan.oy + Math.min(1.3, e.h * 0.55), plan.oz + uz * (e.r * T * 0.6));
    for (let i = 0; i < 2; i++) {
      const k = 0.35 + Math.random() * 0.65, side = (Math.random() - 0.5) * (plan.width || 1.5);
      const x = plan.ox + ux * plan.len * k + wx * side, z = plan.oz + uz * plan.len * k + wz * side;
      const at = new THREE.Vector3(x, G.floorAt(x / T - 0.5, z / T - 0.5) + 0.2 + Math.random() * 1.2, z);
      this.spawnGlow(at, { color: Math.random() < 0.6 ? 0xff1a40 : 0x9a2cff, size: 0.16 + Math.random() * 0.1, life: 0.45 + 0.25 * k, grow: 0.5, arc: { from: at, to: hand, h: 0.15 + Math.random() * 0.25, trail: 0x8a1030 } });
    }
  }
  // a drain: what it took flows from the player back into the one who drew it
  drainStream(e, head, skill) {
    const to = e.worldPos(new THREE.Vector3()); to.y += e.h * 0.55;
    const from = head.clone(); from.y -= 0.35;
    const c = this.skillFlavor(skill) || 0xff5fd0;
    for (let i = 0; i < 9; i++) {
      const at = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5));
      this.later(i * 45, () => this.spawnGlow(at, { color: c, size: 0.12, life: 0.5, grow: 0.6, arc: { from: at, to, h: 0.5 + Math.random() * 0.4 } }));
    }
  }
  // a guard that holds: a bright metal "ting" where the blow met the shield (or the weapon held up), a
  // spray of sparks flying off it and a knock in that hand - no words
  // (perfect: a higher, ringing "ting" with a shimmer, more and golden sparks, both hands)
  guardTing(fromPos, perfect = false) {
    const at = new THREE.Vector3();
    const left = !!(this.shield && this.hasShield);
    const piece = left ? this.shield : this.weapon;
    if (G.vr && piece) piece.getWorldPosition(at);
    else { G.player.headWorld(at).addScaledVector(G.player.forwardVec(), 0.55); at.y -= 0.3; }
    G.audio?.playSe(G.seAt('Parry', 100, perfect ? 150 : 116 + Math.random() * 14), at);
    if (perfect) G.audio?.playSe(G.seAt('Reflection', 75, 130), at);
    const blow = new THREE.Vector3(at.x - fromPos.x, 0, at.z - fromPos.z);
    if (blow.lengthSq() < 1e-4) blow.copy(G.player.forwardVec()).negate();
    this.spawnSparks(at, blow, perfect ? 18 : 10, perfect ? 0xffd860 : 0xfff0c0);
    G.input.haptic(left ? 'left' : 'right', perfect ? 1 : 0.9, perfect ? 110 : 80);
    if (perfect) G.input.haptic(left ? 'right' : 'left', 0.6, 90);
  }
  // the guard (the block button, held): up while it is held, a shield coming up with a clank. Once lowered it comes
  // up again only GUARD_COOLDOWN s later (at once after a perfect guard: guardFree) - held through that, it comes up
  // then, but not as a perfect guard's moment (guardRaisedAt: when a press raised it). A shield-slot gun with Gun
  // Break cannot guard (its parry: fireGunBreak). PC: never with the hands busy otherwise (handsBusy) - held through
  // that, it comes up after it the same way
  updateGuard() {
    const held = G.input.block() && !this.playerDead && !this.gripAdjust && !this.disarmed && !this.restrained && !this.noGuard();
    const want = held && !this.handsBusy();
    if (want && !this.guardUp && G.time >= (this.guardDownAt ?? -99) + GUARD_COOLDOWN) {
      this.guardUp = true;
      if (!this.guardWanted) this.guardRaisedAt = G.time;
      if (this.hasShield && this.shieldOut) {
        const at = new THREE.Vector3();
        if (G.vr) this.shield.getWorldPosition(at);
        else G.player.headWorld(at).addScaledVector(G.player.forwardVec(), 0.45);
        this.playShieldSound(at);
      }
    } else if (!want && this.guardUp) { this.guardUp = false; this.guardDownAt = this.guardFree ? -99 : G.time; this.guardFree = false; }
    this.guardWanted = held;
  }
  // (PC) the hands busy with something else - a blow being charged or swung, a shot, a cast or a throw just let go, a
  // spell or a throwable held ready, a drink: no guard meanwhile (attacking and guarding never at once). A weapon art
  // waiting on the weapon (skillArm) or a Break armed leaves them free. VR: the hands are the player's own
  handsBusy() {
    return !G.vr && (this.deskCharge != null || !!this.swing || !!this.ready || !!this.healing || G.time < (this.deskActUntil ?? -99));
  }
  // the shield coming up: a buckle's clink, a little different each time
  playShieldSound(at = null) {
    const v = Math.random() * 6 - 3;
    for (const se of SHIELD_SOUND) G.audio?.playSe({ ...se, pitch: se.pitch + v }, at);
  }
  noGuard() { return !!this.offGun && !!this.gunBreakSkill(); }
  isBlocking(fromPos) {
    if (!this.guardUp || this.stamina <= 0.05 || this.gripAdjust || this.disarmed) return false;
    const head = G.player.headWorld(new THREE.Vector3());
    const to = new THREE.Vector3(fromPos.x - head.x, 0, fromPos.z - head.z).normalize();
    let facing;
    if (G.vr && this.shield && this.hasShield) {
      this.shield.updateWorldMatrix(true, false);
      facing = new THREE.Vector3(0, 0, -1).transformDirection(this.shield.matrixWorld);
      // shield face normal points away from the palm: use whichever side faces the attacker
      facing.y = 0; facing.normalize();
      return Math.abs(facing.dot(to)) > 0.35;
    }
    facing = G.player.forwardVec();
    return facing.dot(to) > 0.25;
  }

  // ---- death ------------------------------------------------------------------------------
  onPlayerDeath(killer) {
    G.player.endAir?.();
    if (this.playerDead) return;
    this.playerDead = true;
    const active = this.battles.filter(b => !b.done);
    const main = active.find(b => b.interpreter === G.map.interpreter);
    const primary = main || killer || active[0];
    for (const b of active) {
      if (b === primary) b.finish(2);
      else {
        b.done = true; b.result = 1;
        if (b.symbol?.interp) b.symbol.interp.terminate();
      }
    }
    for (const e of this.enemies) if (e.alive) { e.state = 'dying'; e.timer = 0; e.fadeOnly = true; }
    if (!primary) this.onPartyDead();
  }
  onPartyDead() {
    if (this.deathHandled || G.coop?.phantom) return;          // (a co-op guest's fall: by the server's rules - coop.js)
    this.playerDead = true;
    this.deathHandled = true;
    G.map.reserveCommonEvent(11);
  }
  onDeathCommonEvent() { this.deathHandled = true; }
  gameOver() { this.onPartyDead(); }

  // ---- popups --------------------------------------------------------------------------------
  popup(pos, text, color) {
    if (!G.settings.showDamage) return;
    const s = textSprite(text, color);
    s.position.copy(pos);
    this.root.add(s);
    this.popups.push({ sprite: s, t: 0 });
  }
  popupAtPlayer(text, color) {
    const head = G.player.headWorld(new THREE.Vector3());
    this.popup(head.addScaledVector(G.player.forwardVec(), 0.9).add(new THREE.Vector3(0, -0.35, 0)), text, color);
  }

  // ---- projectiles -------------------------------------------------------------------------
  // (thrown items: gravity, track = the enemy a pot keeps on until landAt, align = the model points where it flies,
  // tumble = it turns over as it flies, fine = tested in short steps - a fast knife must not pass through anyone)
  // (owner 'peer': another co-op player's shot as this world shows it - peerShot; anim: what plays where it ends)
  spawnProjectile(from, dir, { speed = 7, color = 0x8844ff, owner = 'enemy', enemy = null, skill = null, power = 1, homing = 0.6, target = null, usable = null, mesh = null, certain = false, aoe = 0, dest = null, life = 4, breakSkill = null, cap = null,
    gravity = 0, track = null, landAt = 0, align = false, tumble = false, fine = false, aimAt = null, steer = 0, accel = 0, maxSpeed = speed, pierce = false, ghost = false, one = false, volley = null, anim = 0,
    staff = 0 }) {
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(owner === 'enemy' ? 0.13 : 0.08, 12, 8),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(owner === 'enemy' ? 0.26 : 0.16, 12, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
      mesh.add(glow);
    }
    mesh.position.copy(from);
    this.root.add(mesh);
    const p = { mesh, vel: dir.clone().normalize().multiplyScalar(speed), owner, enemy, skill, power, life, homing, speed, target, usable, certain, aoe, dest, breakSkill, cap,
      gravity, track, landAt, align, tumble, fine, aimAt, steer, accel, maxSpeed, pierce, ghost, one, volley, anim, color, staff };
    this.projectiles.push(p);
    if (owner === 'player') this.shareShot(p, from);
    if (aoe > 0 && dest && (owner === 'player' || owner === 'peer')) this.areaMark(dest, aoe, G.time + life, p);
  }
  // (co-op) where a player's area spell or thrown pot will burst - its own, another's (peerShot): a blue mark on the
  // floor, as an enemy's move is marked, there till it bursts; a burst round the caster (physicalArea) shows a moment
  areaMark(at, r, until, p = null, always = false) {
    if (!always && !G.coop?.active) return;
    const mk = new FloorMarker(this.root, { shape: 'circle', r, color: MARK.player });
    mk.setPose(at.x, G.floorAt(at.x / T - 0.5, at.z / T - 0.5), at.z);
    mk.setProgress(1);
    (this.areaMarks ||= []).push({ mk, until, p });
  }
  updateAreaMarks() {
    if (!this.areaMarks?.length) return;
    this.areaMarks = this.areaMarks.filter(m => {
      if (G.time < m.until && (!m.p || this.projectiles.includes(m.p))) return true;
      this.fadingMarkers.push(m.mk);
      return false;
    });
  }
  // (co-op) a shot of mine as the other players are to see it (coop.js shareShot -> their peerShot): where it leaves and
  // how it flies, what it looks like, what it goes for, the animation that plays where it meets an enemy and how it
  // ends (an area's burst, a pot breaking where it falls) - only what is seen: what it does is judged here
  shareShot(p, from) {
    if (!G.coop?.active) return;
    const ud = p.mesh.userData || {};
    const look = ud.look === 'arrow' ? 'a' : ud.thrown ? (ud.knife ? 'k' : 't') : ud.icon ? 'i' : 'o';
    let anim = 0;
    if (p.usable) {                                   // (a volley's animation: once; -1: the weapon's, as its blow plays)
      const id = p.volley?.told ? 0 : p.usable.animation_id | 0;
      anim = id < 0 ? G.state.party.leader()?.weapons()[0]?.animation_id | 0 : id;
    }
    else if (!p.breakSkill) {
      const a = G.state.party.leader(), s = a && this.skillByState(a, this.playerAttackSkill(a));
      anim = !s ? 0 : s.animation_id < 0 ? a.weapons()[0]?.animation_id | 0 : s.animation_id | 0;
    }
    if (p.volley) p.volley.told = true;
    G.coop.shareShot({ from, vel: p.vel, look, icon: ud.icon | 0, color: p.color, quat: look === 't' ? p.mesh.quaternion : null, life: p.life,
      gravity: p.gravity, land: p.landAt ? p.landAt - G.time : 0, align: p.align, tumble: p.tumble, fine: p.fine, aoe: p.aoe, dest: p.dest,
      track: p.track?.netId || 0, target: p.target?.netId || 0, anim });
  }
  // (co-op) what another player holds ready or in hand instead of its weapon (coop.js lookMsg U), made as this player's
  // own is (readyUsable, holdConsumable) - placed where theirs is (coopavatar.js)
  peerUseModel(u) {
    if (u.k === 's') {
      const g = new THREE.Group();
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: new THREE.Color(u.c).multiplyScalar(fxk()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.setScalar(0.32);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(0.45 + 0.55 * fxk()), toneMapped: false }));
      g.add(glow, core);
      return g;
    }
    if (u.k === 't' || u.k === 'k') return this.thrownModel({ icon_index: u.i }, u.k === 'k') || this.iconSprite(u.i);
    const adjust = u.k === 'n' ? { rot: 225, flip: false, offset: 6, scale: 0.13 } : u.k === 'r' ? { rot: 0, flip: false, offset: 7, scale: 0.1 } : { rot: 0, flip: false, offset: 9, scale: 0.11 };
    return buildIconModel(u.i, { kind: 'weapon', wtype: 0, hand: u.h, adjust }) || this.iconSprite(u.i);
  }
  // (co-op) another player's shot (coop.js onShotMsg): flying as theirs does - on to the same enemy, here - and ending where
  // it meets one of this world's enemies, a wall or the floor, with what plays there; it does nothing here
  peerShot(s) {
    let mesh = null;
    if (s.look === 'a') mesh = this.arrowMesh();
    else if (s.look === 'i') mesh = this.iconSprite(s.icon);
    else if (s.look === 't' || s.look === 'k') {
      mesh = this.thrownModel({ icon_index: s.icon }, s.look === 'k') || this.iconSprite(s.icon);
      if (s.quat && mesh.isGroup) mesh.quaternion.copy(s.quat);
    }
    const net = id => (id ? this.puppets.get(id) || this.netEnemies().find(e => e.netId === id) || null : null);
    this.spawnProjectile(s.from, s.vel, { speed: s.vel.length(), owner: 'peer', color: s.color, mesh, homing: 0, life: s.life, gravity: s.gravity,
      landAt: s.land > 0 ? G.time + s.land : 0, align: s.align, tumble: s.tumble, fine: s.fine, aoe: s.aoe, dest: s.dest, track: net(s.track),
      target: net(s.target), anim: s.anim });
    // (who shot it: it stops at this player only when the two of them may strike each other - coop.js pvpWith)
    const shot = this.projectiles[this.projectiles.length - 1];
    if (shot?.owner === 'peer') shot.by = s.by || '';
  }
  skillColor(skill) {
    const el = skill?.damage?.element_id;
    return { 3: 0xff6a20, 4: 0x80d0ff, 5: 0xffff60, 9: 0x60a0ff, 10: 0xa040ff, 2: 0x60ff60 }[el] || 0xc070ff;
  }

  // ---- per-frame update -----------------------------------------------------------------------
  // 60 Hz: interpreters for engaged symbol events (a co-op guest leading a map: what their commands change of the world
  // is the host's to keep - coop.js noteFlag, recording)
  updateLogic() {
    const c = G.coop;
    if (c) c.recording++;
    try { this.updateLogicNow(); } finally { if (c) c.recording--; }
  }
  updateLogicNow() {
    if (this.carried?.length) {
      for (const it of this.carried) it.update();
      this.carried = this.carried.filter(it => it.running());
    }
    if (this.sideInterps.length) {
      for (const it of this.sideInterps) it.update();
      this.sideInterps = this.sideInterps.filter(it => it.running());
    }
    for (const d of this.detached) d.interp.update();
    if (this.detached.length) {
      this.detached = this.detached.filter(d => {
        if (d.interp.running()) return true;
        d.ev?.unlock?.();
        if (d.ev) G.coop?.eventDone?.(d.interp.mapId, d.ev.id);     // (the developer's world: its lock goes)
        return false;
      });
    }
    for (const [ev, s] of this.symbols) {
      if (s.engaged && s.interp) {
        s.interp.update();
        if (!s.interp.running()) {
          s.engaged = false; s.interp = null;
          ev.unlock?.();
          // what its last commands switched takes hold now, as the original refreshes the map before any event can
          // start: else a beaten girl of 소녀의 악몽 (a switch puts her away) stood again where she had roamed, for one
          // frame still on her fighting page - near enough, she came straight on for a second fight
          if (G.map.needRefresh) G.map.refresh();
          if (this.symbols.get(ev) !== s) continue;
          if (!this.isSymbolPage(ev)) { s.enemy?.remove(); this.symbols.delete(ev); }
          else if (!s.enemy) {
            const member = $data.troops[s.troopId]?.members?.[0];
            if (member) { s.enemy = new ActionEnemy(this, null, member.enemy_id, s.homeX, s.homeY, { dormant: true }); s.enemy.balloonOf = ev; }
          }
        }
      }
    }
    // troop battle events (turn ~ every 6 s)
    for (const b of this.battles) if (!b.done) this.updateTroopEvents(b);
  }
  // troop (battle) events like Game_Troop: the first page whose conditions hold runs, and the next
  // check waits until it has finished (several pages can come true at once: a turn-0 setup and a
  // turn-end page). A "turn" is 6 seconds; turn-end pages run once as each turn ends.
  updateTroopEvents(b) {
    const pages = b.troop?.pages;
    if (!pages?.length) return;
    const turn = Math.floor(b.time / 6);
    if (turn > (b.turnSeen ?? 0)) { b.turnSeen = turn; b.turnEndPending = true; }
    this.updateDelayed(b, turn);
    if (b.troopInterp?.running()) { b.troopInterp.update(); return; }
    // every enemy down: the fight is won before any other page comes on (VX Ace judges the battle first) - else a
    // fake 흰 유니콘 유니스 falling with the real one was brought back by its own page as the rest fell
    if (b.enemies.length && b.enemies.every(e => !e.alive || e.hidden)) return;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page.list.length <= 1) continue;
      const c = page.condition;
      if (!c.turn_ending && !c.turn_valid && !c.enemy_valid && !c.actor_valid && !c.switch_valid) continue;
      // span: 0 once per battle, 1 once per turn, 2 "moment" (whenever true; at most once a second here)
      const key = page.span === 1 ? `${i}:${turn}` : page.span === 2 ? `${i}:m${Math.floor(b.time)}` : `${i}`;
      if (b.pageDone.has(key)) continue;
      if (c.turn_ending && !b.turnEndPending) continue;
      if (c.turn_valid) { const n = turn; const ok = c.turn_b === 0 ? n === c.turn_a : n >= c.turn_a && (n - c.turn_a) % c.turn_b === 0; if (!ok) continue; }
      if (c.enemy_valid) { const e = b.enemies.find(x => x.memberIndex === c.enemy_index); if (!e || e.b.hp / e.b.mhp * 100 > c.enemy_hp) continue; }
      if (c.actor_valid) { const a = G.state.actor(c.actor_id); if (!a || a.hp / a.mhp * 100 > c.actor_hp) continue; }
      if (c.switch_valid && !G.state.sw(c.switch_id)) continue;
      b.pageDone.add(key);
      b.troopInterp = new Interpreter(1);
      b.troopInterp.troop = true;                  // its music changes play even during battle music
      b.troopInterp.setup(page.list, 0);
      b.troopInterp.update();                      // at once, like the original processing it right away
      return;
    }
    b.turnEndPending = false;
  }

  paused() {
    const m = G.map;
    return !m || m.transferring || G.ui.msg || G.ui.menuOpen || G.ui.sceneOpen ||
      (m.interpreter.running() && m.interpreter.waitMode !== 'battle') ||
      !!G.coop?.heldByScene?.();             // (co-op guest: the host's scene holds it as it holds the host)
  }

  update(dt) {
    if (!G.map?.grid) return;
    if (this.gripAdjust) this.updateGripAdjust();
    this.refreshEquipment();
    this.alignHeldToRay();
    if (G.input.disarmPressed() && !G.ui.menuOpen && !G.ui.sceneOpen && !this.gripAdjust && !this.playerDead) this.toggleDisarm();
    if (this.playerDead && !G.map.interpreter.running() && !G.map.transferring && !G.map.reservedCommon.length &&
        (G.state.party.leader()?.hp || 0) > 0) { this.playerDead = false; this.deathHandled = false; }
    const paused = this.paused();
    // stamina
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay <= 0) this.stamina = Math.min(1, this.stamina + 0.45 * dt);
    this.rangedCooldown = Math.max(0, this.rangedCooldown - dt);
    this.updateGuard();
    this.updateDeskShield(dt);
    this.updateDesktopEquipment();
    // drinking takes a moment (quick slot potions)
    if (this.healing) {
      this.healing.t -= dt;
      if (this.healing.t <= 0) { this.useItem($data.items[this.healing.id], 'quick'); this.healing = null; }
    }
    this.updateQuick(paused);
    G.emotes?.update(paused);
    this.updateReady(dt, paused);
    this.updateHeld(dt, paused);
    this.updateFx(dt);
    this.updateAreaMarks();
    if (this.fadingMarkers.length) this.fadingMarkers = this.fadingMarkers.filter(m => !m.fadeOut(dt));
    if (!paused && !this.playerDead) {
      this.updatePlayerAttack(dt);
      this.updateSymbols(dt);
    }
    // (PC: whatever took the hands this frame - a blow, a cast, a drink - has the guard down before any blow lands)
    if (this.guardUp && this.handsBusy()) this.updateGuard();
    this.updateWeaponGlow();
    this.updateActorStates(dt, paused);
    this.updateGhost();
    this.updateWeaponFx(dt);
    if (this.spectating) this.setGhostly(true);       // (co-op: watching a fight fallen - what it holds stays a shade)
    // (a co-op guest: the host's world it stands in does not wait while this player is in its menu)
    const held = paused && !(G.coop?.phantom && !G.map.transferring);
    this.updateEnemies(dt, held);
    this.allies.update(dt, paused);
    this.updateProjectiles(dt, held);
    this.updateWaves(dt, held);
    this.updateHazards(dt, held);
    this.updatePopups(dt);
    // battle end checks
    for (const b of this.battles) {
      if (b.done) continue;
      b.time += paused ? 0 : dt;
      if (b.enemies.length && b.enemies.every(e => !e.alive || e.hidden) && b.enemies.every(e => e.state === 'dead' || e.hidden)) {
        b.finish(0);
        continue;
      }
      if (b.canEscape && !paused) {
        const pc = G.map.playerChar;
        // (co-op: the guests in it too - one going its own way may fight far from this player)
        const near = [pc, ...(G.coop?.remoteBodies?.() || []).filter(r => r.inFight(b.alive[0]) && (!b.private || !!G.coop.peerSees?.(r.peer.id, b.hallKey)))];
        const far = b.alive.every(e => near.every(q => Math.hypot(e.fx - q.fx, e.fy - q.fy) * T > 15));
        b.escapeTimer = far ? b.escapeTimer + dt : 0;
        if (b.escapeTimer > 1.5) b.finish(1);
      }
    }
    this.battles = this.battles.filter(b => !b.done || b.interpreter?.battle === b);
  }

  // ---- symbol (dormant) enemies -----------------------------------------------------------------
  updateSymbols(dt) {
    const pc = G.map.playerChar;
    for (const [ev, s] of this.symbols) {
      const e = s.enemy;
      if (e) e.offStage = !e.battle && this.sharesOpenFight(ev);
      if (!e || e.battle || !e.mesh || G.arena?.hides(ev) || e.offStage) continue;
      const set = this.symbolSetting(ev);
      const dist = Math.hypot(e.fx - pc.fx, e.fy - pc.fy);
      const range = (G.input.running() ? set.dashRange : set.range) * 1.3 + 0.5;
      // (stealthed - 안 보이는 후추, 보이지 않는 몸 - the map's monsters do not notice the player; a boss still does)
      const hidden = G.state.system.stealthSteps > 0 && !this.symbolIsBoss(s);
      const down = this.spectating || !!G.coop?.respawning;      // (co-op: watching a fight fallen, or on its way back)
      if (!s.engaged && !hidden && !down && dist < range && lineOfSight(e.fx, e.fy, pc.fx, pc.fy) && !G.map.interpreter.running() && !this.waitsForOpenFight(ev)) {
        if (this.leadBoss(s)) { G.coop.askBossStart([ev], 'touch'); continue; }
        this.engage(ev);
        e.alertTime = 0.5;
        // as the original's symbol script: its balloon over it (! for most) with a little chime
        if (set.balloon > 0) {
          ev.balloonId = set.balloon; ev.balloonTime = BALLOON_TIME;
          G.audio?.playSe({ name: 'Decision1', volume: 50, pitch: 150 }, e.worldPos(new THREE.Vector3()));
        }
        continue;
      }
      // idle wander around home
      if (set.idleMode === 0) {
        if (!s.wander || s.wander.t <= 0) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
          s.wander = { x: s.homeX + Math.cos(a) * r, y: s.homeY + Math.sin(a) * r, t: 2 + Math.random() * 3 };
        }
        s.wander.t -= dt;
        this.moveEnemyToward(e, G.map.nearX(s.wander.x, e.fx), G.map.nearY(s.wander.y, e.fy), 0.7 * dt / T * 1.5, true);
      }
    }
  }

  // an event whose page begins a boss fight: a battle in its list (or in a common event it calls) that is one
  // (isBossFight). A co-op guest may begin one only by the server's rules (coop.js askBossStart)
  eventStartsBoss(ev) { return this.eventBossTroop(ev) > 0; }
  // (that fight's troop - 0: none)
  eventBossTroop(ev) {
    const list = ev?.page && !ev.erased && !this.comesBack(ev) ? ev.list : null;
    if (!list?.length) return 0;
    const fight = l => {
      const at = l.findIndex(c => c.code === 301);
      if (at < 0) return 0;
      const p = l[at].parameters, troopId = p[0] === 0 ? p[1] : p[0] === 1 ? G.state.v(p[1]) : 0;
      return $data.troops[troopId] && this.isBossFight({ list: l, index: at }, $data.troops[troopId]) ? troopId : 0;
    };
    let id = fight(list);
    for (const c of list) if (!id && c.code === 117) id = fight(commonEventList(c.parameters[0]) || []);
    return id;
  }
  // a boss on the map (no stealth hides the player from it): the same as a fight that closes the arena (startBattle) -
  // a boss fight by its music (isBossFight: the troop plays some of its own, or the event picks a battle BGM of its
  // own right before) started by a roaming one-off (도도, 그리피, the nightmares...); not an area's ordinary monsters
  // that fight to boss music (윈터벨's orcs and 리델 묘지's grave robbers come back once beaten; 윈터벨's thirty slimes)
  symbolIsBoss(s) {
    const list = s.ev.list || [];
    if (s.isBossOf === list) return s.isBoss;
    s.isBossOf = list;
    const at = list.findIndex(c => c.code === 301);
    return (s.isBoss = at >= 0 && this.isBossFight({ list, index: at }, $data.troops[s.troopId]) && this.oneOffSymbol(s, s.troopId));
  }
  // chasing enemies go straight through walls and props unless the setting says otherwise
  // (wandering ones keep to the floor)
  throughWalls() { return G.settings.enemyThroughWalls !== false; }
  moveEnemyToward(e, tx, ty, stepTiles, collide = !this.throughWalls()) {
    const dx = tx - e.fx, dy = ty - e.fy;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return;
    const s = Math.min(stepTiles, d);
    let nx = e.fx + dx / d * s, ny = e.fy + dy / d * s;
    if (collide) [nx, ny] = resolveCircle(nx, ny, Math.min(e.r || 0.3, 0.45));
    else [nx, ny] = this.clampToMap(nx, ny);
    e.fx = nx; e.fy = ny;
  }
  clampToMap(fx, fy) {
    const m = G.map, g = m.grid;
    return [m.loopX ? fx : THREE.MathUtils.clamp(fx, 0, g.w - 1), m.loopY ? fy : THREE.MathUtils.clamp(fy, 0, g.h - 1)];
  }

  // ---- active enemies -------------------------------------------------------------------------
  updateEnemies(dt, paused) {
    const pc = G.map.playerChar;
    const head = G.player.headWorld(new THREE.Vector3());
    const all = this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean), [...this.puppets.values()]);
    let attacking = this.enemies.filter(e => e.state === 'windup' || e.state === 'act').length;
    for (const e of all) {
      if (!e.mesh) continue;
      // (a co-op guest's copy of the host's enemy: it goes where the host's is, eased; the host thinks for it. What it
      // winds up and lets go is played here as the host's goes (coop.js: 'tg', 'lp', 'bx', 'ax') - a leap through the
      // air and a charge carry it on their own meanwhile)
      if (e.puppet) {
        if (!this.puppetMoves(e)) {
          const dx = e.netX - e.fx, dy = e.netY - e.fy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { e.fx = e.netX; e.fy = e.netY; }
          else { const k = 1 - Math.exp(-dt * 14); e.fx += dx * k; e.fy += dy * k; }
        }
        e.knock.x = 0; e.knock.y = 0;
        if (!paused && e.alive && e.state === 'windup' && e.plan) {
          e.timer = Math.max(0, e.timer - dt);
          e.moveT = (e.moveT || 0) + dt;
          if (e.move === 'leap') this.updateLeap(e);
          this.updateTelegraph(e);
        } else if (!paused && e.alive && e.state === 'act' && e.act && e.move) this.updateBossAct(e, dt);
      }
      // a looping map: an enemy is where its copy nearest to the player is (it only jumps when far off)
      if (G.map.loopX) e.fx = G.map.nearX(e.fx, pc.fx);
      if (G.map.loopY) e.fy = G.map.nearY(e.fy, pc.fy);
      e.flash = Math.max(0, e.flash - dt);
      e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      if (!paused && e.alive && !e.puppet) this.tickEnemyStates(e, dt);
      if (!paused && e.alive && e.battle && !e.puppet) this.tickGroggy(e, dt);
      if (e.alive && e.b.hp <= 0) this.checkEnemyDeath(e);
      this.updateBreakCue(e);
      // (it goes for the player or for a companion that fights - in a co-op boss fight, only for those in it: with
      // nobody left to go for it holds, but a move already going on goes on)
      if (!paused && e.battle && e.alive && !e.hidden && !e.puppet) {
        const tg = this.allies.pickTarget(e) || (this.outOfFight(e) ? (e.state === 'windup' || e.state === 'act' ? e.lastTg || null : null) : pc);
        if (tg) { e.lastTg = tg; attacking = this.enemyAI(e, dt, tg, attacking); }
      }
      // an attack that is off (stunned, broken, fallen, the fight over) leaves no mark on the floor, and a boss
      // knocked out of its leap comes down
      if (e.marker && e.state !== 'windup' && e.state !== 'act') this.dropMarker(e);
      if (e.sky && !paused) this.skyHold(e, dt);           // (gone up into the sky: stays up there - bossmoves.js)
      else if (e.landing || e.diving) this.skyLand(e);
      if (e.lift > 0 && !e.sky && !(e.diving && e.alive) && !(e.state === 'windup' && (e.move === 'leap' || e.move === 'farOrb')) && !(e.state === 'act' && ['recoil', 'farOrb', 'cloakLeap'].includes(e.act?.kind))) e.lift = Math.max(0, e.lift - 16 * dt);
      // (a far orb's: gone with the move it was for - cut short, the boss fallen)
      if (e.orb && !(e.state === 'windup' && e.move === 'farOrb')) this.dropOrb(e);
      if (e.act?.orb && !e.act.burst && e.state !== 'act') { this.root.remove(e.act.orb); e.act.orb.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); e.act.orb = null; e.act.burst = true; }
      // dying / fade
      if (e.state === 'dying') {
        e.timer += dt;
        const k = Math.min(1, e.timer / (e.fadeOnly ? 0.6 : 1.1));
        e.mat.opacity = 1 - k;
        e.mesh.position.y = -k * (e.fadeOnly ? 0 : e.h * 0.25);
        e.mat.color.setRGB(1, 1 - k * 0.6, 1 - k * 0.6);
        if (k >= 1) { e.state = 'dead'; e.group.visible = false; }
      }
      // knockback: a hit never sends an enemy through a wall (chasing through walls is a separate
      // setting); one that is inside a wall already (chasing through it) is not pushed at all
      if (e.stationary || this.inDuel(e)) { e.knock.x = 0; e.knock.y = 0; }      // (in the duel she stands her ground - inDuel)
      if (Math.abs(e.knock.x) + Math.abs(e.knock.y) > 0.001) {
        const nx = e.fx + e.knock.x, ny = e.fy + e.knock.y;
        const inWall = !G.map.grid.anyPassable(G.map.wrapX(Math.round(e.fx)), G.map.wrapY(Math.round(e.fy)));
        if (!inWall && lineOfSight(e.fx, e.fy, nx, ny)) [e.fx, e.fy] = resolveCircle(nx, ny, Math.min(e.r, 0.45));
        else { e.knock.x = 0; e.knock.y = 0; }
        e.knock.x *= 0.7; e.knock.y *= 0.7;
      }
      // visuals (hidden a moment by an animation - hideUntil - or floating over the floor - hover)
      e.group.visible = e.state !== 'dead' && !e.hidden && !(e.hideUntil > G.time) && !e.offStage && !this.skyHidden(e);
      const wp = e.worldPos(tmpA);
      e.group.position.copy(wp);
      e.group.position.y += e.hover || 0;
      e.updateNameplate(head);
      e.mesh.rotation.y = Math.atan2(head.x - wp.x, head.z - wp.z);
      e.mesh.rotation.z = 0; e.mesh.position.x = 0; e.mesh.position.z = 0;
      // (one hanging high over the player - the stage machine in the flies - leans its face down toward them)
      e.mesh.rotation.x = (e.hover || 0) > 2 ? 0.75 * Math.atan2(e.group.position.y + e.h * 0.5 - head.y, Math.max(0.5, Math.hypot(head.x - wp.x, head.z - wp.z))) : 0;
      if (e.ghosts && !(e.state === 'act' && e.act?.kind === 'spin')) for (const gh of e.ghosts) gh.g.visible = false;
      // a symbol's body shows its event's balloon icon over its head
      if (e.balloonOf?.balloonId > 0 && e.state !== 'dying' && e.state !== 'dead') (e.balloon ||= new BalloonIcon(e.group, BALLOON_SIZE)).update(e.balloonOf.balloonId, e.balloonOf.balloonTime, (e.h || 1.8) + 0.05);
      else e.balloon?.update(0);
      const dashing = e.state === 'act' && e.act?.kind === 'dash';
      const bob = (e.state === 'chase') ? Math.abs(Math.sin(G.time * 7 + e.fx)) * 0.04 : dashing ? Math.abs(Math.sin(G.time * 18)) * 0.07 : 0;
      if (e.state !== 'dying') e.mesh.position.y = bob;
      const wind = e.state === 'windup' ? Math.min(1, e.timer0 ? 1 - e.timer / e.timer0 : 0) : 0;
      if (e.state !== 'dying') {
        const fl = e.flash > 0 ? 0.9 * fxk() : 0;
        e.mat.emissive.setRGB(fl + wind * 0.6, fl, fl);
        // (a counter stance it took up - a skill gave it a counter rate it has none of by nature: a cold shimmer over it
        // while it lasts; one that counters by nature does not shimmer)
        if (e.b.cnt > 0 && !(this.ownCounter(e) > 0) && e.state !== 'stagger' && e.alive) { const k = 0.5 + 0.5 * Math.sin(G.time * 6); e.mat.emissive.r += 0.08 * k; e.mat.emissive.g += 0.16 * k; e.mat.emissive.b += 0.3 * k; }
        // (a stance that slips blows and answers them - 리포스트: a pale, quick flicker, and a ring of steel as it begins)
        const slipping = e.alive && e.state !== 'stagger' && this.slipStance(e.b);
        if (slipping) { const k = 0.5 + 0.5 * Math.sin(G.time * 13); e.mat.emissive.r += 0.24 * k; e.mat.emissive.g += 0.24 * k; e.mat.emissive.b += 0.28 * k; }
        if (slipping && !e.slipCue) G.audio?.playSe(G.seAt('Sword1', 80, 150), wp.clone());
        e.slipCue = slipping;
        e.mesh.scale.setScalar(1 + wind * 0.06 + (e.state === 'stagger' ? Math.sin(G.time * 30) * 0.01 : 0));
        // a boss's own moves show in its body
        if (e.boss && (e.move || e.bodyT)) this.bossBody(e, wind, fl, head);
        e.mat.opacity = e.battle || e.alertTime > 0 ? 1 : 0.92;
        if (e.blinkAt && G.time - e.blinkAt < 0.3) e.mat.opacity *= (G.time - e.blinkAt) / 0.3;     // (coming out of a quick step)
      }
      e.ring.material.opacity = 0;          // replaced by the floor telegraphs
    }
    // (a mount drawn in its rider's picture: one body with it - bossmoves.js)
    this.updateMounts(all, head, paused);
    // keep enemies apart (a charging or leaping boss goes over and through)
    const loose = x => (x.state === 'act' && x.act?.kind === 'dash') || (x.lift || 0) > 0.3 || x.stationary || x.puppet;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.mesh || !a.alive || loose(a)) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.mesh || !b.alive || loose(b) || (b.pair && b.pair === a.pair)) continue;
        const dx = b.fx - a.fx, dy = b.fy - a.fy;
        const d = Math.hypot(dx, dy), min = (a.r + b.r) * 0.85;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.fx -= dx / d * push; a.fy -= dy / d * push;
          b.fx += dx / d * push; b.fy += dy / d * push;
        }
      }
    }
    // the meat shield stands where it was summoned and the enemies do not get through it
    for (const w of this.allies.walls()) {
      for (const a of all) {
        if (!a.mesh || !a.alive || loose(a)) continue;
        const dx = a.fx - w.fx, dy = a.fy - w.fy, d = Math.hypot(dx, dy), min = a.r + w.r / T;
        if (d < min && d > 1e-4) { a.fx = w.fx + dx / d * min; a.fy = w.fy + dy / d * min; }
      }
    }
    // the player and the enemies stand in each other's way like walls and neither pushes the other (pushPlayer
    // stops the player): an enemy comes up to the player and no further, and one the player has come up against
    // comes no closer. A boss coming down on them or ending its run there, or one coming out of hiding, steps
    // off; through a dodge they pass each other. (last: where each was left last frame, before anything moved it)
    const dodging = G.player.dodging;
    for (const a of all) {
      if (!a.mesh || !a.alive || a.puppet) continue;
      const free = loose(a) || a.hidden, fresh = a.wasFree !== false || a.lastFx === undefined;
      a.wasFree = free;
      const dxp = a.fx - pc.fx, dyp = a.fy - pc.fy;
      const dp = Math.hypot(dxp, dyp), minp = a.r + BODY_R;
      if (!free && !dodging && !this.passing.has(a) && dp < minp - 1e-3) {
        const lx = fresh ? a.fx : G.map.nearX(a.lastFx, a.fx), ly = fresh ? a.fy : G.map.nearY(a.lastFy, a.fy);
        const d0 = Math.hypot(lx - pc.fx, ly - pc.fy);
        if (fresh || d0 >= minp - 1e-3) {
          // (right on the player - a boss landing from a leap: back the way it faced)
          const ux = dp > 1e-4 ? dxp / dp : -Math.cos(a.aim || 0), uy = dp > 1e-4 ? dyp / dp : -Math.sin(a.aim || 0);
          a.fx = pc.fx + ux * minp; a.fy = pc.fy + uy * minp;
        } else if (dp < d0) { a.fx = lx; a.fy = ly; }
      }
      a.lastFx = a.fx; a.lastFy = a.fy;
    }
    this.enemies = this.enemies.filter(e => {
      if (e.state === 'dead' && e.timer > 1.2) { e.remove(); return false; }
      if (e.state === 'dead') e.timer += dt;
      return true;
    });
  }

  // (what it is going to do; a state it has may turn that skill into another - skillByState)
  chooseAction(e) { return this.skillByState(e.b, this.pickAction(e)); }
  pickAction(e) {
    if (e.forcedSkill) { const s = e.forcedSkill; e.forcedSkill = null; return s; }   // Force Action (339)
    // (one with no actions at all does nothing, as in VX Ace - the dark stage machine's middle forms)
    if (!e.data.actions?.length) return null;
    let acts = e.data.actions.filter(a => this.actionValid(e, a));
    // a boss heals far less often than its pattern says (BOSS_HEAL_REST / BOSS_HEAL_PASS)
    if (e.boss) acts = acts.filter(a => !this.isHealSkill($data.skills[a.skill_id]) || (G.time >= (e.healReady || 0) && Math.random() < BOSS_HEAL_PASS));
    if (!acts.length) return $data.skills[1];
    const max = Math.max(...acts.map(a => a.rating));
    const zero = max - 3;
    const pool = acts.filter(a => a.rating > zero);
    const total = pool.reduce((s, a) => s + a.rating - zero, 0);
    let r = Math.random() * total;
    for (const a of pool) { r -= a.rating - zero; if (r <= 0) return $data.skills[a.skill_id] || $data.skills[1]; }
    return $data.skills[pool[0].skill_id] || $data.skills[1];
  }
  // as VX Ace's action_valid?: its condition, and the skill usable - the MP it costs (enemies pay it too) and its
  // cool-down (script 141 applies to enemies as well)
  actionValid(e, a) { return this.actionCondition(e, a) && this.enemyCanUse(e, $data.skills[a.skill_id]); }
  enemyCanUse(e, s) {
    if (!s) return false;
    if (e.b.mp < Math.floor((s.mp_cost || 0) * e.b.mcr)) return false;
    const hp = e.b.skillHpCost(s);
    if (hp > 0 && e.b.hp <= hp) return false;                   // (script 128: not with the last of its HP)
    return !((e.cool?.[s.id] || 0) > G.time);
  }
  // an enemy goes for a skill: it pays the MP, the skill cools down, a boss's heal holds the next one back
  commitSkill(e, s) {
    if (!s) return;
    e.acted = s;
    e.b.mp = Math.max(0, e.b.mp - Math.floor((s.mp_cost || 0) * e.b.mcr));
    const hp = e.b.skillHpCost(s);
    if (hp > 0) { e.b.hp = Math.max(1, e.b.hp - hp); e.drawBar(); }
    const turns = coolTurns(s);
    if (turns) (e.cool ||= {})[s.id] = G.time + turns * COOL_TURN;
    if (e.boss && this.isHealSkill(s)) e.healReady = G.time + BOSS_HEAL_REST;
  }
  // a skill that brings HP back (a heal, a regeneration) to its user or its side
  isHealSkill(s) {
    if (!s) return false;
    if (s._heal === undefined) {
      const eff = s.effects || [];
      s._heal = s.scope >= 7 && s.scope <= 11 && (s.damage?.type === 3 || eff.some(ef => ef.code === 11 && (ef.value1 > 0 || ef.value2 > 0)) ||
        eff.some(ef => ef.code === 21 && ($data.states[ef.data_id]?.features || []).some(f => f.code === 22 && f.data_id === 7 && f.value > 0)));
    }
    return s._heal;
  }
  actionCondition(e, a) {
    const p1 = a.condition_param1, p2 = a.condition_param2;
    switch (a.condition_type) {
      case 1: { const n = e.turn; return p2 === 0 ? n === p1 : n > 0 && n >= p1 && n % p2 === p1 % p2; }
      case 2: { const r = e.b.hp / e.b.mhp; return r >= p1 && r <= p2; }
      case 3: { const r = e.b.mmp ? e.b.mp / e.b.mmp : 0; return r >= p1 && r <= p2; }
      case 4: return e.b.isState(p1);
      case 5: return (G.state.party.leader()?.level || 1) >= p1;
      case 6: return G.state.sw(p1);
      default: return true;
    }
  }
  // How an enemy's skill shows, by its own battle animation and name (the original's): 'lob' a bottle, a jar, a
  // dumpling, mud or a stone thrown in an arc onto where the player stood; 'gun' a shot from a rifle, a shotgun or a
  // pistol (fast, with a flash and a streak); 'knife' a knife or a hook thrown straight (fast, a streak); 'death' a death spell (a dark
  // circle that keeps to the player and settles a moment before it strikes); 'drain' life or mana drawn out (it
  // flows back into the one who drew it)
  skillLook(s) {
    if (!s) return null;
    if (s._look !== undefined) return s._look;
    const anim = $data.animations?.[s.animation_id]?.name || '';
    const name = (s.name || '').trim();
    let look = null;
    if (/油壷|火炎壷|毒団子|泥|投石|爆弾|瓶/.test(anim) || (/병\b|던지|투척|던져|壷|瓶|投げ|\b(?:bottle|jar|throw|toss|hurl)/i.test(name) && !/나이프|메스|メス|ナイフ|화살|\bknife/i.test(name))) look = 'lob';
    else if (/長銃|散弾|銃撃|ガンブレイク/.test(anim) || /발포|사격|저격|총격|건 ?브레이크|銃|\b(?:gun|rifle|pistol|musket)/i.test(name)) look = 'gun';
    else if (/投げナイフ/.test(anim) || /나이프|메스 투척|ナイフ|メス|\bknife/i.test(name)) look = 'knife';
    else if (/即死/.test(anim) || /^데스\d*$|멸혼|즉사|即死|\bdeath\b|\bdoom/i.test(name)) look = 'death';
    else if (/吸収|ドレイン/.test(anim) || /흡수|드레인|강탈|吸収|ドレイン|\b(?:drain|absorb|leech)/i.test(name)) look = 'drain';
    return (s._look = look);
  }
  // the colour of what a skill carries - its element, else the states it brings (none for a plain blow): motes of it
  // rise from its marked area while it winds up, and a death spell's dark
  skillFlavor(s) {
    if (!s) return null;
    if (s._flavor !== undefined) return s._flavor;
    const EL = { 2: 0xff5fd0, 3: 0xff7a28, 4: 0x9fe8ff, 5: 0xfff27a, 8: 0x7a9cff, 9: 0xffe9a8, 10: 0x9a4cff, 11: 0xd01830, 12: 0xff4a1a, 15: 0xfff27a, 18: 0x6fe05a };
    let c = this.skillLook(s) === 'death' ? EL[10] : EL[s.damage?.element_id];
    if (!c) {
      const names = (s.effects || []).filter(f => f.code === 21 && f.data_id > 1).map(f => $data.states[f.data_id]?.name || '').join(' ');
      if (/연소|화상|燃焼|火傷|\bburn/i.test(names)) c = EL[3];
      else if (/동창|동결|빙결|凍傷|凍結|\bfrost|\bfreez/i.test(names)) c = EL[4];
      else if (/독|毒|\bpoison|\bvenom/i.test(names)) c = EL[18];
      else if (/출혈|열상|出血|裂傷|\bbleed/i.test(names)) c = EL[11];
      else if (/수면|잠|睡眠|眠|\bsleep/i.test(names)) c = EL[8];
      else if (/공포|발광|처형|恐怖|発狂|処刑|\bfear|\bmadness/i.test(names)) c = EL[10];
      else if (/스턴|기절|スタン|気絶|\bstun/i.test(names)) c = EL[5];
      else if (/기름|油|\boil/i.test(names)) c = 0x9a7a3a;
    }
    return (s._flavor = c || null);
  }
  skillStyle(skill) {
    if (!skill || skill.id === 7 || /상황을 본다|웃|様子を見|笑|观察|\b(?:watch|laugh|grin)/i.test(skill.name)) return 'wait';
    if (skill.id === 2) return 'guard';
    const dmg = skill.damage?.type;
    if (skill.scope >= 7 && skill.scope <= 11) return dmg === 3 ? 'heal' : 'buff';
    if (dmg !== 1 && dmg !== 2 && dmg !== 5 && dmg !== 6) return skill.scope >= 1 && skill.scope <= 6 ? 'debuff' : 'wait';
    if (skill.hit_type === 2 || ['gun', 'knife'].includes(this.skillLook(skill)) || /활|화살|총|쏘|발사|던|弓|矢|銃|射|撃|投|箭|枪|\bbow\b|\b(?:arrow|gun|shoot|shot|throw|bullet)/i.test(skill.name)) return 'projectile';
    if (skill.scope === 2) return 'area';
    return 'melee';
  }

  enemyAI(e, dt, pc, attacking) {
    e.alertTime = Math.max(0, e.alertTime - dt);
    // a stage play between its acts (the curtain is up: everyone waits, as the original's battle waits for its
    // events), and its stage hands
    if (G.theater?.holds(e)) return attacking;
    // asleep / paralysed (not the Break stagger, which runs below)
    if (e.state !== 'stagger' && this.enemyRestricted(e)) {
      if (e.state === 'windup' || e.state === 'act') { e.state = 'recover'; attacking--; e.act = null; e.move = null; this.dropMarker(e); }
      e.timer = Math.max(e.timer - dt, 0.2);
      return attacking;
    }
    const dx = pc.fx - e.fx, dy = pc.fy - e.fy;
    const distT = Math.hypot(dx, dy);
    const distM = distT * T;
    const agi = e.b.agi;
    const speed = THREE.MathUtils.clamp(1.25 + agi / 70, 1.3, 3.4) * this.duelPace(e);
    e.timer -= dt;
    switch (e.state) {
      case 'idle':
      case 'chase': {
        e.state = 'chase';
        e.cooldown -= dt;
        // (a mount drawn in its rider's picture and the rider take turns: the other goes along - bossmoves.js updateMounts)
        if (e.pair && this.mountWaits(e)) break;
        // (back from the sky high up: down on the player with its next blow - bossmoves.js skyDive)
        if (e.diving && attacking < 2 && this.skyDive(e, dx, dy)) { attacking++; break; }
        const reach = (e.r * T) + 1.8 + (this.preferredRange(e) || 0);
        // (a boss's blows reach further: it starts one from further off - and still comes up close)
        const strike = e.boss ? Math.max(reach, e.r * T + BOSS_AREA.start) : reach;
        // a boss: a skill with a move of its own starts from wherever that move reaches (a charge from afar, a
        // leap, a shockwave, a rain of blows ...); its other skills wait until it is close
        // (in 흑기사 린다메아's duel every blow is one of her moves, one after another - no rest between moves, none of them made a
        // plain blow while the next move waits: inDuel)
        const duel = e.boss && this.inDuel(e);
        if (e.boss && e.alertTime <= 0 && e.cooldown <= 0 && attacking < 2 && (G.time >= (e.nextMove || 0) || duel)) {
          if (!e.pending) e.pending = this.chooseAction(e);
          const fam = this.bossFamilyFor(e, e.pending);
          if (fam && this.bossMoveFits(e, fam, distM, dx, dy, strike)) {
            e.skill = e.pending; e.pending = null;
            this.startBossMove(e, fam, dx, dy);
            attacking++;
            break;
          }
        }
        // (one that holds its place does what it does to itself - a charge, a song - from wherever it is)
        if (e.stationary && !e.pending && e.alertTime <= 0 && e.cooldown <= 0) e.pending = this.chooseAction(e);
        const own = e.stationary && !['melee', 'area', 'projectile', 'debuff'].includes(this.skillStyle(e.pending));
        const holdForMove = duel && !!this.bossFamilyFor(e, e.pending || (e.pending = this.chooseAction(e)));
        if (!holdForMove && e.alertTime <= 0 && e.cooldown <= 0 && (distM < strike + 0.3 || own) && attacking < 2) {
          e.move = null; e.comboStep = 0;
          e.skill = e.pending || this.chooseAction(e); e.pending = null;
          this.commitSkill(e, e.skill);
          e.style = this.skillStyle(e.skill);
          e.timer0 = e.timer = this.windupTime(e, e.skill, e.style);
          e.state = 'windup';
          e.aim = Math.atan2(dy, dx);
          e.ring.scale.setScalar(e.style === 'area' ? 3.0 / T : (e.r * T + 1.3) / 1.0);
          attacking++;
          // (waiting and guarding are its turn too, as in the original: the patterns that go by the turn - 빙폭의
          // 비스트 melting away on its fifth - go on. Running away is a skill of its own on itself: wound up, then gone)
          if (e.style === 'wait') { e.state = 'recover'; e.timer = 0.8; attacking--; if (this.actionDone(e)) e.timer = FOLLOW_REST; }
          if (e.style === 'guard') { e.state = 'guard'; e.timer = 1.6; attacking--; e.b.addState(9); this.actionDone(e); }
          if (e.state === 'windup') this.beginTelegraph(e);
          break;
        }
        // move: keep some distance for ranged attackers (one that holds its place - a stage machine hanging over
        // the stage, a prison floating in it - stays where the play put it)
        const keep = this.preferredRange(e);
        if (!e.stationary && (distM > reach - 0.2 || (keep && distM > keep))) {
          e.pathTimer -= dt;
          let tx = pc.fx, ty = pc.fy;
          if (!this.throughWalls() && !lineOfSight(e.fx, e.fy, pc.fx, pc.fy)) {
            if (e.pathTimer <= 0 || !e.path) { e.path = nextStep(e.fx, e.fy, pc.fx, pc.fy, 30); e.pathTimer = 0.4; }
            if (e.path) { tx = e.path.x; ty = e.path.y; }
          } else e.path = null;
          this.moveEnemyToward(e, tx, ty, speed * dt / T);
        }
        break;
      }
      case 'windup': {
        // the area was laid down as the wind-up began and stays where it is: stepping out of it dodges the
        // blow. Sure-hit attacks keep locked on, and so does a plain shot until it is fired: its line turns after
        // the player (up to the first wall that way) and the shot goes where it points then
        if (e.plan?.certain) e.aim = Math.atan2(dy, dx);
        else if (e.plan?.shot && !e.move) this.aimShot(e, Math.atan2(dy, dx));
        e.moveT = (e.moveT || 0) + dt;
        if (e.move === 'leap') this.updateLeap(e);
        this.newWindup(e, dt);                       // (the far orb: backing off up into the air - bossmoves.js)
        this.updateTelegraph(e);
        if (e.timer <= 0 && e.move && e.move !== 'flurry') { this.releaseBossMove(e); break; }
        if (e.timer <= 0) {
          this.executeAttack(e, distM, dx, dy); this.dropMarker(e);
          if (e.state === 'dying' || e.state === 'dead') break;       // (it fell by its own skill: 빙폭의 비스트 melting away)
          if (!this.chainNext(e)) {
            const more = this.actionDone(e);
            if (e.state !== 'dying' && e.state !== 'dead') { e.state = 'recover'; e.timer = more ? FOLLOW_REST : (0.55 + Math.random() * 0.4) / this.actionPace(e); }
          }
        }
        break;
      }
      case 'act': this.updateBossAct(e, dt); break;
      case 'guard':
      case 'recover':
      case 'stagger':
        if (e.timer <= 0) {
          if (e.state === 'stagger') { e.b.removeState(8); e.b.removeState(7); this.groggyRefill(e); }
          if (e.state === 'guard') e.b.removeState(9);
          e.state = 'chase';
          e.cooldown = e.quick ? 0.1 : (0.5 + Math.random() * 1.0) / this.actionPace(e);      // (right after a quick step: at once)
          e.quick = false;
          e.drawBar();
        }
        break;
      default: break;
    }
    return attacking;
  }
  // a plain shot winding up turns after the player; its line reaches as far as it can fly that way
  aimShot(e, a) {
    const plan = e.plan;
    if (plan.ox === undefined) return;
    e.aim = plan.aim = a;
    plan.len = this.clearRun(plan.ox, plan.oz, a, plan.oy + (e.h || 1.8) * 0.6, plan.full || 20);
    e.marker?.setLength?.(plan.len);
  }
  // how long an attack winds up, before its beat (beginTelegraph): by its kind, the skill's speed (VX Ace speed
  // correction, negative = slower), big or multi hits and the enemy's agility
  windupTime(e, skill, style) {
    let t = { melee: 1.1, area: 1.6, projectile: 1.3, debuff: 1.3, heal: 0.8, buff: 0.65 }[style] ?? 1.1;
    if (/\* ?[5-9]/.test(skill?.damage?.formula || '') || (skill?.repeats || 1) > 1) t *= 1.3;
    t *= THREE.MathUtils.clamp(1 - (skill?.speed || 0) / 300, 0.7, 1.6);
    t *= THREE.MathUtils.clamp(90 / (e.b.agi + 50), 0.75, 1.3);
    return t;
  }
  // how far a straight line from (x, z) heading a (world atan2(dz, dx)) runs before a wall rises above height
  // y on it (metres, at most max)
  // (a raised floor - a plateau over a canyon, a gallery - rising above it stops it as a wall does: its side is a cliff)
  clearRun(x, z, a, y, max) {
    const step = 0.25 * T, ca = Math.cos(a), sa = Math.sin(a);
    const sx = Math.round(x / T - 0.5), sz = Math.round(z / T - 0.5);
    for (let d = step; d < max + step; d += step) {
      const dd = Math.min(d, max);
      const tx = Math.round((x + ca * dd) / T - 0.5), ty = Math.round((z + sa * dd) / T - 0.5);
      if (!G.map.validW(tx, ty)) return Math.max(step, dd - step);
      if (tx === sx && ty === sz) continue;
      if ((G.solidTopAt?.(tx, ty) ?? -Infinity) * T > y || (G.floorAt?.(tx, ty) ?? -Infinity) > y) return Math.max(step, dd - step * 0.5);
      if (dd >= max) break;
    }
    return max;
  }
  // how far a body runs straight on from where it stands (metres, at most max) before an edge nobody walks across stops it -
  // a wall, a cliff's edge, water (collision.js lineOfSight, the original's passage): a charge, a lance's dash never go through
  walkRun(e, a, max) {
    const step = 0.25 * T, ca = Math.cos(a), sa = Math.sin(a);
    let ok = 0;
    for (let d = step; d <= max + 1e-6; d += step) {
      if (!lineOfSight(e.fx, e.fy, e.fx + ca * d / T, e.fy + sa * d / T)) break;
      ok = d;
    }
    return Math.max(ok, Math.min(max, step));
  }
  // a string of blows: now and then a melee blow is followed by one or two more, each quickly telegraphed
  // and aimed again (more often for nimble enemies; never after a heavy blow)
  chainNext(e) {
    // a boss's flurry: as many blows as its skill has hits, the boss stepping in before each
    if (e.move === 'flurry') {
      if (!e.alive || e.state !== 'windup' || this.playerDead || ++e.comboStep >= e.comboLen) { this.endFlurry(e); return false; }
      const pc = G.map.playerChar;
      if (Math.hypot(pc.fx - e.fx, pc.fy - e.fy) * T > e.r * T + 1.2) this.moveEnemyToward(e, pc.fx, pc.fy, 0.5 / T);
      e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);
      e.timer0 = e.timer = 0.42 + Math.random() * 0.18;
      this.beginTelegraph(e);
      return true;
    }
    if (e.countering) { e.countering = false; e.comboStep = 0; e.counterDone = true; return false; }
    if (!e.alive || e.state !== 'windup' || e.style !== 'melee' || e.plan?.certain || e.plan?.heavy || this.playerDead) { e.comboStep = 0; return false; }
    if (!e.comboStep) e.comboLen = Math.random() < THREE.MathUtils.clamp(0.18 + e.b.agi / 600, 0.18, 0.45) ? (Math.random() < 0.35 ? 3 : 2) : 1;
    e.comboStep = (e.comboStep || 0) + 1;
    if (e.comboStep >= e.comboLen) { e.comboStep = 0; return false; }
    e.timer0 = e.timer = 0.42 + Math.random() * 0.18;
    const pc = G.map.playerChar;
    e.aim = Math.atan2(pc.fy - e.fy, pc.fx - e.fx);      // each blow is laid down where the player is now
    this.beginTelegraph(e);
    return true;
  }
  // heavy blows - a physical skill hitting far harder than a plain attack (atk x6 and more; a plain attack is
  // x4) - cannot be guarded: pink on the floor, a little slower to come; dodge it or get out of it
  isHeavySkill(skill) {
    if (skill._heavy === undefined) {
      const m = /a\.atk\s*\*\s*([\d.]+)/.exec(skill.damage?.formula || '');
      skill._heavy = skill.hit_type === 1 && skill.damage?.type === 1 && !!m && +m[1] >= 6;
    }
    return skill._heavy;
  }
  preferredRange(e) {
    const ranged = (e.data.actions || []).some(a => this.skillStyle($data.skills[a.skill_id]) === 'projectile');
    return ranged ? 4.5 : 0;
  }

  // ---- a boss's own moves ---------------------------------------------------------------------------
  // In a boss fight (isBossFight) the big ones use some of their skills as moves of their own, by what the
  // skill is - its name, its battle message, its animation, what it hits - with the skill's own damage,
  // effects and animation:
  //  charge  돌진, 태클, 몸통박치기, 달려들기, 일섬, a huge bite: a band from the boss toward the player, up to a
  //          wall; when it is full the boss runs its length and hits whoever is in the way
  //  leap    점프 베기, 프레스, 짓밟기, 낙하, 내리찍기: the boss crouches, springs up high and comes down on the
  //          circle marked where the player stood
  //  quake   땅울림, 충격파 / roar 포효, 울부짖기, 비명: a shockwave runs out across the floor from the boss -
  //          be beyond its edge, or roll through it as it passes
  //  fissure 땅을 가르다: the ground splits along a band toward the player
  //  breath  숨결, 브레스, 뿜다: a wide, long cone in front that keeps hitting while you stay in it
  //  spin    회전, 선풍: the boss whirls toward the player, hitting all around it
  //  rain    난사, 소나기, 유성, 벼락, spells on random targets: circles scattered around the player come down
  //          one after another
  //  volley  연사, 연발, 대포, shots with several hits: a fan of shots, a line each
  //  flurry  a melee skill with several hits: a string of quick blows, each laid down and aimed anew
  //  lunge   a boss with none of these: its heaviest blow comes with a short charge (a caster with no blow
  //          casts its strongest shot as a fan)
  // The pink ones (charge, leap, quake, roar, fissure, rain) no guard holds; no move hits more often than
  // its skill would. Between two moves a boss rests a few seconds (its other skills come as usual meanwhile).
  isBossFight(interp, troop) {
    // the troop's own battle events play music of their own (a boss's theme coming in with a phase: 목을
    // 사냥하는 비스트 starts as a small thing and turns into the beast to its own theme, 기사 펌프킨・오, 애벌레
    // 시샤, 재버워크, 란제리나... - 40 troops, every one a boss)
    if (troop?.pages?.some(p => p.list?.some(c => c.code === 241 || c.code === 132))) return true;
    // or the event chose a battle BGM of its own for this very fight, just before starting it - as most bosses
    // in the game do (music left over from an earlier fight does not count)
    const usual = $data.system.battle_bgm?.name;
    for (const it of [interp, interp?.root]) {
      const list = it?.list;
      if (!list) continue;
      for (let i = (it.index ?? 0) - 1; i >= 0; i--) {
        if (list[i]?.code !== 132) continue;
        const name = list[i].parameters[0]?.name || '';
        return !!name && name !== usual;
      }
    }
    return false;
  }
  skillHits(skill) { return THREE.MathUtils.clamp((skill.repeats || 1) * ({ 3: 1, 4: 2, 5: 3, 6: 4 }[skill.scope] || 1), 1, 6); }
  bossFamily(s) {
    if (s._bossFam !== undefined) return s._bossFam;
    // (흑기사 린다메아's own moves; a leap over the player in a cloak - bossmoves.js)
    const special = this.specialFamily(s);
    if (special !== undefined) return (s._bossFam = special);
    let f = null;
    if (s.scope >= 1 && s.scope <= 6 && (s.damage?.type === 1 || s.damage?.type === 5)) {
      const text = `${s.name} ${s.message1 || ''}`;
      const anim = $data.animations?.[s.animation_id]?.name || '';
      const style = this.skillStyle(s), hits = this.skillHits(s);
      const atk = +(/a\.atk\s*\*\s*([\d.]+)/.exec(s.damage.formula || '')?.[1] || 0);
      const magic = s.hit_type === 2;
      if (/돌진|달려\s?들|돌격|몸통박치기|태클|저돌|습보|전력투구|덤벼들|일섬|突進|突撃|突进|冲锋|冲撞|撞击|体当たり|タックル|飛びかか|襲いかか|一閃|一闪|\b(?:charg|rush|tackl|body ?slam|lung|pounc)/i.test(text) || /突進|体当たり|ぶちかまし/.test(anim)) f = 'charge';
      else if (/점프|뛰어\s?올라|도약|떠올라|날아올라|문설트|프레스|짓눌|짓밟|낙하|공중에서|내리찍|내려찍|ジャンプ|跳躍|跳跃|跳び|飛び上が|舞い上が|ムーンサルト|プレス|押し潰|踏みつけ|踏み潰|踩踏|践踏|落下|空中|叩きつけ|砸|\b(?:jump|leap|lept|press|stomp|trampl|plung|slam)/i.test(text) || /ムーンサルト|プレス|踏み/.test(anim)) f = 'leap';
      else if (/땅을 갈|대지를 가|지면을 가|균열|大地を割|地割れ|地裂|裂地|split the (?:ground|earth)|\bfissur/i.test(text)) f = 'fissure';
      else if (/땅울림|땅을 울|대지|충격파|지진|地響き|地鳴り|大地|衝撃波|冲击波|地震|地鸣|\b(?:quake|earthquake|shock ?wave|tremor)/i.test(text)) f = 'quake';
      else if (/포효|울부짖|외침|외쳤|절규|우렁찬|굉음|비명|소리를 질|咆哮|雄叫び|叫び|絶叫|吼え|悲鳴|怒吼|嚎叫|尖叫|\b(?:roar|howl|scream|shriek|bellow)/i.test(text) || /咆哮/.test(anim)) f = 'roar';
      else if (/숨결|브레스|숨을 내|내뿜|뿜어|뿜었|토해|내뱉|화염을 발사|ブレス|吐息|吐き|吐いた|噴き|吹き付け|喷吐|喷出|吐出|\b(?:breath|spit|spew|exhal|vomit)/i.test(text) || /^息/.test(anim)) f = 'breath';
      else if (/회전|선풍|회오리|소용돌이|휘몰아|回転|旋風|竜巻|渦|旋转|旋风|龙卷|\bspin(?:s|ning)?\b|\b(?:whirl|cyclon|tornado|vortex)/i.test(text)) f = 'spin';
      else if (/파도|해일|물결|웨이브|격류|급류|波|津波|激流|\b(?:wave|tide|tsunami|surge|torrent)/i.test(text)) f = 'wave';
      else if (/십자|크로스|오망성|육망성|クロス|十字|五芒|六芒|\b(?:cross|pentagram|hexagram)/i.test(text)) f = 'cross';
      else if (/덥석|움켜|붙잡|부여잡|구속|촉수|후크|갈고리|해초|껴안|휘감|掴|捕ま|触手|フック|拘束|抱き|絡め|\b(?:grab|seiz|grasp|clutch|tentacle|hook|embrac|entangl)/i.test(text) || /掴み|触手|捕食/.test(anim)) f = 'grab';
      else if (/물어|씹어|잡아먹|취식|포식|噛み|喰らい|食らい|捕食|撕咬|啃咬|吞食|\bbit(?:e|es|ing)\b|\b(?:devour|chomp)/i.test(text) && atk >= 10) f = 'charge';
      else if (/참수|처형|단두|길로틴|필살|목을 베|斬首|処刑|断頭|ギロチン|必殺|\b(?:behead|execut|decapitat|guillotin)/i.test(text)) f = 'execute';
      else if (/난사|소나기|화살 비|사우전드|サウザンド|\bthousand|유성|쏟아|흩뿌|사방으로|빗발|천둥|벼락|乱射|の雨|流星|降り注|撒き散|四方|雷|之雨|倾泻|\brain(?:s|fall)?\b|\b(?:barrage|meteor|shower|scatter|thunder|lightning)/i.test(text) && style !== 'melee') f = 'rain';
      else if (/연사|연발|연속투척|대령|대포|일제|連射|連発|連続投擲|大砲|一斉|连射|连发|大炮|齐射|\b(?:volley|rapid|salvo|cannon)/i.test(text)) f = 'volley';
      else if (s.scope !== 1 && (/안개|맹독|독가스|독 ?늪|늪을|역병|흑사|미아즈마|瘴|霧|猛毒|毒ガス|毒沼|疫|黒死|\b(?:fog|mist|poison|venom|miasma|swamp|plague|toxic)/i.test(text) ||
        (s.effects || []).some(ef => ef.code === 21 && (ef.data_id === 2 || ef.data_id === 3)))) f = 'field';
      else if (/찌르|찔러|찔렀|관통|꿰뚫|뚫기|창으로|레이피어|판트|부리|뿔|刺突|突き|貫|槍|レイピア|嘴|\b(?:thrust|pierc|stab|lance|impal|skewer|rapier|fente)/i.test(text) && style === 'melee' && s.scope === 1) f = 'thrust';
      else if (/후려|휩쓸|쓸어|베어 ?내|베어 ?넘|횡일|꼬리|사복검|채찍|薙|払|尻尾|鞭|蛇腹|横一|\b(?:sweep|swipe|tail|whip|mow|cleave|lash)/i.test(text) && !magic) f = 'sweep';
      // (a beam or a cage, a storm over all, rows of blades, a moon from afar, a cut from behind - bossmoves.js)
      else if ((f = this.newFamily(s, text, anim, style, hits, atk, magic))) { /* f */ }
      else if (style === 'projectile' && hits >= 2) f = s.scope === 1 ? 'volley' : 'rain';
      else if (style === 'area' && !atk && hits >= 2) f = 'rain';
      else if (style === 'melee' && atk && hits >= 2) f = 'flurry';
      // spells on one: shots that come round after the player (an arrow, an orb, a bubble), else eruptions under
      // them one after another; spells on all: a blast round the boss (or round it but not close in); a wide
      // physical blow on all: a sweep
      else if (magic && s.scope === 1) f = /화살|구슬|탄환|볼|구체|거품|矢|弾|玉|球|泡|\b(?:arrow|orb|ball|bolt|bullet|sphere|missile|bubble)/i.test(text) ? 'orbs' : 'pursuit';
      else if (magic && s.scope === 2) f = 'nova';
      else if (style === 'area' && s.hit_type === 1) f = !atk && /\ba\.mat\b/.test(s.damage.formula || '') ? 'nova' : 'sweep';
    }
    return (s._bossFam = f);
  }
  // a boss none of whose skills has a move of its own: its heaviest blow becomes a lunge; a caster with no blow
  // casts its strongest shot as a fan
  bossFallback(e) {
    const acts = (e.data.actions || []).map(a => $data.skills[a.skill_id]).filter(Boolean);
    if (acts.some(s => this.bossFamilyFor(e, s))) return;
    const k = (s, p) => +(new RegExp(`a\\.${p}\\s*\\*\\s*([\\d.]+)`).exec(s.damage?.formula || '')?.[1] || 0);
    const blow = acts.filter(s => this.skillStyle(s) === 'melee' && k(s, 'atk') > 0).sort((a, b) => k(b, 'atk') - k(a, 'atk'))[0];
    if (blow) { e.lungeSkill = blow.id; return; }
    const shot = acts.filter(s => this.skillStyle(s) === 'projectile' && s.scope === 1).sort((a, b) => k(b, 'mat') - k(a, 'mat'))[0];
    if (shot) e.volleySkill = shot.id;
  }
  bossFamilyFor(e, s) {
    if (!e.boss || !s) return null;
    // (up in the sky - bossmoves.js skyHold: a blow at one comes down on them from up there)
    if (e.sky && s.scope === 1 && this.skillStyle(s) === 'melee') return 'leap';
    // (a stage play's leads have their signature moves - src/theater.js)
    const play = G.theater?.familyOf?.(e, s);
    if (play !== undefined) return play;
    return this.bossFamily(s) || this.delayedFamily(s) || (s.id === e.lungeSkill ? 'lunge' : s.id === e.volleySkill ? 'volley' : null);
  }
  // A boss's body as its own moves wind up and go off. The body is a picture facing the player, so it shows by
  // leaning in its plane, squashing, stretching, rising, trembling and glowing:
  //  charge / lunge  stands its ground braced low, trembling harder and harder, scraping up dust
  //  leap            crouches deep, stretches as it springs up and as it drops, squashes as it lands
  //  quake / fissure rises tall, shaking, and comes down with a squash as the ground gives
  //  roar            swells up breathing in, shudders all over as it lets go
  //  breath          rears back swelling as it draws breath, glowing the colour of what it breathes; leans in
  //                  and quivers while it pours
  //  spin            rocks from side to side, faster and faster, then whirls
  //  rain / volley   lifts off the ground a little, swaying, glowing the colour of the spell
  //  flurry          bobs on its feet between the blows
  bossBody(e, k, fl, head) {
    const m = e.mesh, s = m.scale, t = G.time;
    const size = THREE.MathUtils.clamp((e.h || 1.8) / 1.8, 0.7, 2);
    const shake = amp => {
      const a = amp * size;
      m.position.x += Math.sin(t * 71 + e.fx * 13) * a;
      m.position.z += Math.cos(t * 63 + e.fy * 17) * a;
      m.position.y += Math.abs(Math.sin(t * 53)) * a * 0.5;
    };
    // (only a move of an element - fire, ice, thunder, light, dark, drain - glows its colour; the rest keep the
    // red of a wind-up)
    const glow = g => {
      if (![2, 3, 4, 5, 9, 10].includes(e.skill?.damage?.element_id)) return;
      const c = tmpColor.set(this.skillColor(e.skill));
      e.mat.emissive.setRGB(fl + c.r * g, fl + c.g * g, fl + c.b * g);
    };
    const away = (dist, sign = 1) => {
      const wp = e.group.position, dx = wp.x - head.x, dz = wp.z - head.z, l = Math.hypot(dx, dz) || 1;
      m.position.x += dx / l * dist * size * sign; m.position.z += dz / l * dist * size * sign;
    };
    const fam = e.move;
    if (fam && e.state === 'windup') {
      switch (fam) {
        case 'charge': case 'lunge':
          shake(0.008 + 0.05 * k * k);
          s.y *= 1 - 0.13 * k; s.x *= 1 + 0.06 * k;
          if (k > 0.3) this.bossDust(e);
          break;
        case 'leap':
          if (!e.plan?.jumped) {
            const c = Math.min(1, (e.timer0 - e.timer) / 0.35);
            s.y *= 1 - 0.2 * c; s.x *= 1 + 0.12 * c;
            shake(0.012 * c);
          } else {
            const el = e.timer0 - e.timer, crouch = Math.min(0.35, e.timer0 * 0.22);
            const q = THREE.MathUtils.clamp((el - crouch) / Math.max(0.1, e.timer0 - crouch), 0, 1);
            const str = q < 0.45 ? 1 - q / 0.45 : q > 0.78 ? (q - 0.78) / 0.22 : 0;
            s.y *= 1 + 0.16 * str; s.x *= 1 - 0.09 * str;
          }
          break;
        case 'quake': case 'fissure':
          s.y *= 1 + 0.12 * k; s.x *= 1 - 0.04 * k;
          m.position.y += 0.22 * size * k * k;
          shake(0.004 + 0.022 * k);
          break;
        case 'roar':
          s.multiplyScalar(1 + 0.1 * k + 0.025 * k * Math.sin(t * 7));
          if (k > 0.7) shake(0.03 * (k - 0.7) / 0.3);
          break;
        case 'breath':
          s.multiplyScalar(1 + 0.08 * k); s.y *= 1 + 0.04 * k;
          away(0.3 * k);
          glow(0.7 * k);
          break;
        case 'spin': {
          // coiling: it turns away (narrower and narrower, as a card turning), leans into the turn, sinks and draws
          // back a little; then holds it, trembling, and a blade glints as it is about to let go
          const c = THREE.MathUtils.smootherstep(Math.min(1, k / 0.7), 0, 1);
          s.x *= turnWidth(-SPIN_COIL * c);
          s.y *= 1 - 0.08 * c;
          m.rotation.z = 0.1 * c;
          away(0.12 * c);
          if (k > 0.7) shake(0.006 + 0.03 * (k - 0.7) / 0.3);
          if (k > 0.82 && !e.glinted) { e.glinted = true; this.spinGlint(e); }
          break;
        }
        case 'rain': case 'volley': case 'dice':
          m.position.y += 0.3 * size * k + Math.sin(t * 3) * 0.03 * k;
          m.rotation.z = Math.sin(t * 2.3) * 0.05 * k;
          glow((0.45 + 0.25 * Math.sin(t * 9)) * k);
          break;
        case 'thrust':
          // drawing back for the lance
          away(0.35 * k); s.x *= 1 - 0.08 * k; s.y *= 1 + 0.04 * k;
          if (k > 0.75) shake(0.012 + 0.03 * (k - 0.75) / 0.25);
          break;
        case 'grab':
          away(0.22 * k); s.x *= 1 + 0.1 * k;
          if (k > 0.7) shake(0.02 * (k - 0.7) / 0.3);
          break;
        case 'sweep':
          // wound back to one side
          m.rotation.z = -0.22 * k * (e.plan?.way || 1); away(0.12 * k); s.x *= 1 + 0.05 * k;
          if (k > 0.8) shake(0.02);
          break;
        case 'execute': case 'chess':
          // rising up high, trembling harder and harder
          m.position.y += 0.35 * size * k * k; s.y *= 1 + 0.14 * k; s.x *= 1 - 0.05 * k;
          shake(0.006 + 0.045 * k * k);
          break;
        case 'wave':
          away(0.25 * k); s.y *= 1 + 0.1 * k; s.x *= 1 + 0.04 * k;
          if (k > 0.7) shake(0.025 * (k - 0.7) / 0.3);
          break;
        case 'nova': case 'cross': case 'pursuit': case 'orbs': case 'field':
          m.position.y += 0.25 * size * k + Math.sin(t * 3) * 0.03 * k;
          s.multiplyScalar(1 + 0.06 * k);
          glow((0.45 + 0.25 * Math.sin(t * 9)) * k);
          break;
        case 'flurry':
          m.position.y += Math.abs(Math.sin(t * 9)) * 0.05 * size;
          m.rotation.z = Math.sin(t * 7) * 0.05;
          break;
        default: this.newBody(e, fam, k, m, s, shake, glow, away);       // (bossmoves.js)
      }
    } else if (fam && e.state === 'act') {
      const kind = e.act?.kind;
      if (kind === 'dash') { s.y *= 0.93; s.x *= 1.06; }
      else if (kind === 'breath') { away(0.15, -1); shake(0.01); glow(0.7); }
      else if (kind === 'spin') this.spinBody(e);
      else if (kind === 'rain' || kind === 'volley' || kind === 'pursuit' || kind === 'orbs' || kind === 'dice') { m.position.y += 0.3 * size; glow(0.5); }
      else if (kind === 'sweep') { m.rotation.z = 0.25 * (e.plan?.way || 1) * Math.sin(Math.min(1, e.act.t / 0.42) * Math.PI); away(0.1, -1); }
      else if (kind === 'grab') { away(0.25, -1); s.x *= 1.06; }
    }
    // just after a move: squashed by a landing or a stomp, shuddering after a roar
    const b = e.bodyT;
    if (b) {
      const a = (t - b.t0) / (b.kind === 'roar' ? 0.6 : 0.35);
      if (a >= 1 || !e.alive) e.bodyT = null;
      else if (b.kind === 'roar') { s.multiplyScalar(1 + 0.08 * (1 - a)); shake(0.03 * (1 - a)); }
      else { const q = Math.sin(a * Math.PI); s.y *= 1 - 0.2 * q; s.x *= 1 + 0.13 * q; }
    }
  }
  // the whirl: the picture turns round and round like a card (mirrored while its back is round), two fading
  // after-images a moment behind it
  spinBody(e) {
    const m = e.mesh, s = m.scale, t = e.act.t, sx = s.x;
    s.x = sx * turnWidth(spinAngle(t));
    if (!e.ghosts) {
      e.ghosts = [[0.035, 0.34], [0.07, 0.17]].map(([lag, opacity]) => {
        const mat = e.mat.clone();
        Object.assign(mat, { transparent: true, opacity, depthWrite: false, alphaTest: 0.01 });
        mat.emissive = new THREE.Color(0.3, 0.03, 0.03);
        const g = new THREE.Mesh(m.geometry, mat);
        e.group.add(g);
        return { g, lag };
      });
    }
    for (const gh of e.ghosts) {
      gh.g.visible = t > gh.lag && t < SPIN_TIME - 0.05;
      gh.g.position.copy(m.position);
      gh.g.rotation.copy(m.rotation);
      gh.g.scale.set(sx * turnWidth(spinAngle(t - gh.lag)), s.y, s.z);
    }
  }
  // the moment before a whirl: a blade glints at its chest, with the ring of steel
  spinGlint(e) {
    const p = e.worldPos(new THREE.Vector3()), head = G.player.headWorld(new THREE.Vector3());
    const d = new THREE.Vector3(head.x - p.x, 0, head.z - p.z);
    if (d.lengthSq() > 1e-6) d.normalize();
    const at = new THREE.Vector3(p.x + d.x * 0.3, p.y + (e.h || 1.8) * 0.6, p.z + d.z * 0.3);
    this.spawnGlow(at, { color: 0xffffff, size: 0.3, life: 0.3, grow: 3 });
    this.spawnGlow(at, { color: 0xfff2d0, size: 1.1, life: 0.14, grow: 1.4 });
    G.audio?.playSe(G.seAt('刀', 75, 125), at);
  }
  // a white slash trailing round a whirling boss at its waist, fading as it widens
  spawnSlashArc(e) {
    const geo = this._arcGeo || (this._arcGeo = new THREE.RingGeometry(0.86, 1, 32, 1, 0, 2.4));
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0f0).multiplyScalar(fxk()), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const arc = new THREE.Mesh(geo, mat);
    const p = e.worldPos(new THREE.Vector3()), r = THREE.MathUtils.clamp((e.r || 0.4) * T + 0.9, 1, 2.6);
    arc.position.set(p.x, p.y + (e.h || 1.8) * (0.32 + Math.random() * 0.26), p.z);
    arc.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2);
    arc.scale.setScalar(r);
    arc.renderOrder = 1400;
    this.root.add(arc);
    this.fx.push({ obj: arc, t: 0, life: 0.24, size: r, grow: 1.15 });
  }
  // dust kicked up at a boss's feet as it paws the ground before a charge, now and then with a scrape
  bossDust(e) {
    if (G.time < (e.dustAt || 0)) return;
    e.dustAt = G.time + 0.28 + Math.random() * 0.12;
    const p = e.worldPos(new THREE.Vector3());
    const a = Math.random() * Math.PI * 2, r = (e.w || 1) * 0.3;
    p.x += Math.cos(a) * r; p.z += Math.sin(a) * r; p.y += 0.1;
    this.spawnGlow(p, { color: 0xb8a890, size: 0.5 + 0.3 * Math.random(), life: 0.45, grow: 1.8, vel: new THREE.Vector3(0, 1.2, 0) });
    if (Math.random() < 0.5) G.audio?.playSe(G.seAt('足音・土', 45, 60 + Math.random() * 20), p);
  }
  // can that move start from here (d: metres to the player)
  bossMoveFits(e, fam, d, dx, dy, reach) {
    const ep = e.worldPos(new THREE.Vector3());
    const clear = max => d <= max && this.clearRun(ep.x, ep.z, Math.atan2(dy, dx), ep.y + 0.8, d) >= d - 0.3;
    // (no wall between it and the target - over a pillar it sees out of that block)
    const sees = () => lineOfSight(e.fx, e.fy, e.fx + dx, e.fy + dy, true);
    const nf = this.newMoveFits(e, fam, d, dx, dy);
    if (nf !== undefined) return nf;
    // (one that holds its place - floating, hanging - casts from wherever it is)
    if (e.stationary && !['charge', 'lunge', 'leap', 'flurry', 'thrust', 'grab', 'sweep', 'spin', 'execute', 'fissure'].includes(fam)) return d <= 22;
    switch (fam) {
      case 'dice': return d <= 15 && sees();
      case 'chess': return d <= 24;
      case 'charge': case 'fissure': return clear(16);
      case 'lunge': return clear(8);
      case 'leap': return d <= 14;
      case 'quake': return d <= 9 + e.r * T;
      case 'roar': return d <= 10;
      case 'breath': case 'spin': return d <= e.r * T + 7.5;
      case 'rain': case 'volley': return d <= 15 && sees();
      case 'flurry': return d < reach + 0.3;
      case 'thrust': return clear(e.r * T + 11);
      case 'grab': return clear(e.r * T + 8);
      case 'sweep': return d <= e.r * T + 6;
      case 'execute': return d <= e.r * T + 5.2;
      case 'nova': return d <= 13;
      case 'wave': case 'cross': case 'field': return d <= 15;
      case 'pursuit': case 'orbs': return d <= 16 && sees();
    }
    return false;
  }
  startBossMove(e, fam, dx, dy) {
    const s = e.skill;
    this.commitSkill(e, s);
    // a spell whose real blow comes later (script 192 遅延発動 - a swamp that swirls up, orbs that burst, a meteor
    // called down): the move lands that blow
    const later = this.delayedSkill(s);
    if (later) e.skill = later;
    e.move = fam; e.act = null; e.comboStep = 0;
    e.style = this.skillStyle(s);
    e.aim = Math.atan2(dy, dx);
    if (fam === 'flurry') e.comboLen = THREE.MathUtils.clamp(this.skillHits(s), 2, 5);
    e.state = 'windup';
    e.glinted = false;
    e.timer0 = e.timer = this.windupTime(e, s, e.style);
    this.beginTelegraph(e);
  }
  // A skill whose blow comes later (script 遅延スキル): <遅延発動:a,ID,n,r,p> at the end of the n-th turn from now,
  // <行動後遅延発動:a,ID,n,r,p> after the target's n-th action from now - r more at random, p % of the time.
  // A boss lands it as a move of its own, at once (as the stage play's No-Face does - 개구리 노왕's orbs, swamp,
  // flames and meteor, 탐식 미믹's rot, 너스 콜's operation); any other use leaves it to go off then (a turn for
  // an action here): scheduleDelayed
  delayedData(s) {
    if (s._delayData === undefined) {
      const m = /<(行動後)?遅延発動[：:]\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?/.exec(s.note || '');
      s._delayData = m && $data.skills[+m[2]] ? { id: +m[2], n: +m[3], r: +(m[4] || 0), p: m[5] === undefined ? 100 : +m[5], turnEnd: !m[1] } : null;
    }
    return s._delayData;
  }
  // (a later blow that does nothing here - 노・페이스's 사인: an instant death the port leaves out of enemy skills - is
  // no move and nothing to wait for)
  delayedDoes(later) {
    return !!later && (!!String(later.damage?.formula || '').trim() || (later.effects || []).some(ef => (ef.code === 21 && ef.data_id > 1) || ef.code === 44));
  }
  delayedFamily(s) {
    const d = this.delayedData(s);
    if (!d || d.turnEnd || !this.delayedDoes($data.skills[d.id])) return null;
    const later = $data.skills[d.id];
    if (/隕石/.test($data.animations?.[later.animation_id]?.name || '')) return 'rain';
    return this.bossFamily(later) || (later.damage?.type === 1 || later.damage?.type === 5 ? 'pursuit' : null);
  }
  scheduleDelayed(e, skill) {
    const d = this.delayedData(skill), b = e?.battle;
    if (!d || !b || b.done || !this.delayedDoes($data.skills[d.id]) || Math.random() * 100 >= d.p) return;
    if (e.delayedAt !== undefined && G.time - e.delayedAt < 0.5) return;       // (one use, however many hits)
    e.delayedAt = G.time;
    const turns = d.n + Math.floor(Math.random() * (d.r + 1)) + (d.turnEnd ? 0 : 1);
    (b.delayed ||= []).push({ e, skill: $data.skills[d.id], turn: Math.floor(b.time / 6) + turns, warned: false });
  }
  // as a turn ends, those due go off on the player - unless the one who cast it has fallen meanwhile; a moment
  // before, a dark glow gathers at the player's feet and the ground groans (no way out of it, as in the original:
  // 윈터벨의 바람 blows the player up, and two turns later they fall)
  updateDelayed(b, turn) {
    if (!b.delayed?.length) return;
    for (const d of b.delayed) {
      if (d.warned || b.time < (d.turn + 1) * 6 - 1.2 || !d.e.alive) continue;
      d.warned = true;
      const head = G.player.headWorld(new THREE.Vector3());
      const feet = new THREE.Vector3(head.x, G.floorAt(head.x / T - 0.5, head.z / T - 0.5) + 0.2, head.z);
      this.spawnGlow(feet, { color: this.skillFlavor(d.skill) || 0x8a40ff, size: 1.6, life: 1.2, grow: 1.6 });
      G.audio?.playSe(G.seAt('Darkness1', 70, 70), feet);
    }
    const due = b.delayed.filter(d => d.turn < turn);
    if (!due.length) return;
    b.delayed = b.delayed.filter(d => d.turn >= turn);
    for (const d of due) {
      // (the wind's fall: down out of the sky, the blow as the player lands - bossmoves.js liftFall; the wind fallen
      // before it: let down gently)
      if (d.skill && this.liftInfo().falls.has(d.skill.id)) {
        if (this.playerDead || !d.e.alive) { G.player.floatDown?.(); continue; }
        this.runSkillCommonEvents(d.skill);
        this.liftFall(d);
        continue;
      }
      if (this.playerDead || !d.skill || !d.e.alive) continue;
      const head = G.player.headWorld(new THREE.Vector3());
      if (d.skill.animation_id > 0) G.screen.playAnimationOn(head.clone().add(new THREE.Vector3(0, -0.5, 0)), d.skill.animation_id, { world: true, size: 2.2 });
      this.runSkillCommonEvents(d.skill);
      this.enemyStrikePlayer(d.e, d.skill, { blockable: false, certain: true, delayed: true });
    }
  }
  // <遅延発動:a,ID,...> / <行動後遅延発動:a,ID,...>: the skill that goes off later
  delayedSkill(s) {
    if (s._delayed === undefined) {
      const m = /<(?:行動後)?遅延発動[：:]\s*\d+\s*,\s*(\d+)/.exec(s.note || '');
      s._delayed = m && $data.skills[+m[1]] ? +m[1] : 0;
    }
    return s._delayed ? $data.skills[s._delayed] : null;
  }
  // a boss's quick step: gone in a moment, and there again a few metres from the player - beside or behind them
  blink(e) {
    const pc = G.map.playerChar, f = G.player.forward2D(), look = Math.atan2(f.z, f.x);
    for (let tries = 0; tries < 14; tries++) {
      const a = look + Math.PI * (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1);
      const d = (e.r || 0.4) + (2.2 + Math.random() * 1.2) / T;
      const x = pc.fx + Math.cos(a) * d, y = pc.fy + Math.sin(a) * d;
      const tx = Math.round(x), ty = Math.round(y);
      if (!G.map.grid.valid(tx, ty) || !G.map.walkable(tx, ty) || !lineOfSight(pc.fx, pc.fy, x, y)) continue;
      const from = e.worldPos(new THREE.Vector3());
      this.spawnGlow(from.setY(from.y + e.h * 0.5), { color: 0xc8c8ff, size: e.h, life: 0.25, grow: 1.4 });
      e.fx = x; e.fy = y; e.lastFx = undefined;
      e.blinkAt = G.time; e.quick = true;
      const to = e.worldPos(new THREE.Vector3());
      this.spawnGlow(to.setY(to.y + e.h * 0.5), { color: 0xc8c8ff, size: e.h, life: 0.3, grow: 0.8 });
      G.audio?.playSe(G.seAt('Evasion1', 90, 90), to);
      return;
    }
  }
  // the area of a boss's move (as planAttack does for the plain ones)
  planBossMove(e) {
    const s = e.skill, fam = e.move;
    const ep = e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);             // (whom it goes for: the player, a companion, a co-op guest)
    const d = Math.hypot(head.x - ep.x, head.z - ep.z);
    const hits = this.skillHits(s), R = (e.r || 0.4) * T, heavy = this.isHeavySkill(s), H = e.h || 1.8;   // (sizes guessed while its body is still loading)
    const base = { hits, heavy: true, blockable: false, move: fam };
    switch (fam) {
      case 'charge': case 'lunge': {
        // it runs on a little past where the player stands - or up to a wall, and slams into it
        const max = fam === 'lunge' ? 8 : 16, want = fam === 'lunge' ? d + 1.5 : Math.max(6, d + 4);
        const clear = Math.min(this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, max), this.walkRun(e, e.aim, max)), run = Math.min(clear, want);
        return { ...base, shape: 'line', len: run, full: run, width: THREE.MathUtils.clamp(R * 2 + 1.0, 1.8, 3.8), wall: clear < Math.min(want, max) };
      }
      case 'fissure': return { ...base, shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, 16), full: 16, width: 2.2 };
      // (from up in the sky - bossmoves.js skyHold / skyDive: a dive, its spot marked at once)
      case 'leap': {
        const dive = (!!e.sky || !!e.diving) && (e.lift || 0) > 3;
        // (a dive from the sky lands wider than a leap from the ground)
        const r = dive ? THREE.MathUtils.clamp(R + 3.4, 4.4, 6.2) : THREE.MathUtils.clamp(R + (s.scope === 2 ? 2.8 : 2.0), 2.8, 5);
        return { ...base, shape: 'circle', r, cx: head.x, cz: head.z, ground: true, dive };
      }
      case 'quake': return { ...base, shape: 'circle', r: 9 + R, around: true, wave: 8 };
      case 'roar': return { ...base, shape: 'circle', r: 10, around: true, wave: 13 };
      case 'breath': return { ...base, shape: 'sector', r: R + 9, half: 0.7, heavy, blockable: !heavy };
      case 'spin': return { ...base, shape: 'circle', r: R + 2.2, around: true, heavy: false, blockable: true, hits: Math.max(2, hits) };
      case 'flurry': return heavy ? { shape: 'sector', r: R + 3.6, half: 1.3, hits: 1, heavy: true, blockable: false, move: fam }
        : { shape: 'sector', r: R + BOSS_AREA.reach, half: 0.55, hits: 1, blockable: true, move: fam };
      // a lance: a long narrow band, quickly (crimson when it is a sure hit: step out of it)
      case 'thrust': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, R + 11), certain = s.hit_type === 0;
        return { ...base, shape: 'line', len, full: len, width: 1.3, heavy: heavy && !certain, blockable: !heavy && !certain, certain, tempo: 0.75, tmin: 0.55, tmax: 1.2 };
      }
      // a reach for the player: a band up to it; caught in it, the player is pulled in and the blows land
      case 'grab': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, R + 8);
        return { ...base, shape: 'line', len, full: len, width: 1.5, tempo: 0.9, tmin: 0.7, tmax: 1.4 };
      }
      // a wide sweep from one side to the other: the blade passes over the arc - be behind it, beyond it, or roll
      // through it as it comes
      case 'sweep': return { ...base, shape: 'sector', r: R + 6.5, half: 1.75, way: Math.random() < 0.5 ? 1 : -1, heavy, blockable: !heavy, tmin: 0.9, tmax: 1.8 };
      // a slow, huge killing blow
      case 'execute': return { ...base, shape: 'sector', r: R + 5.5, half: 1.45, tempo: 1.8, tmin: 1.8, tmax: 3.0 };
      // a blast all round it - or all round it but close in (a ring: get in close)
      case 'nova': return Math.random() < 0.5
        ? { ...base, shape: 'ring', r0: R + 3.2, r: R + 15, around: true, heavy: false, tempo: 1.25, tmin: 1.4, tmax: 2.6 }
        : { ...base, shape: 'circle', r: R + 7.5, around: true, heavy: false, tempo: 1.25, tmin: 1.4, tmax: 2.6 };
      // a wall of water (wind) rolling out from it across the floor: roll through it, or be out of its way
      case 'wave': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, 16);
        return { ...base, shape: 'line', len, full: len, width: 14, heavy: false, wave: 8, tmin: 1.0, tmax: 2.0 };
      }
      // lines through where the player stands: a cross (4 arms), a pentagram (5), a hexagram (6)
      case 'cross': {
        const text = `${s.name} ${s.message1 || ''}`;
        const n = /오망|五芒|pentagram/i.test(text) ? 5 : /육망|六芒|hexagram/i.test(text) ? 6 : 4;
        const rot = Math.random() * Math.PI * 2, y = G.floorAt(head.x / T - 0.5, head.z / T - 0.5), parts = [];
        for (let i = 0; i < n; i++) parts.push({ shape: 'line', len: 11, width: 1.8, x: head.x, y, z: head.z, aim: rot + i * Math.PI * 2 / n });
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.2, tmax: 2.2 };
      }
      // pools (poison fog, a swamp, plague) round where the player stands, one right there; they stay a while
      case 'field': {
        const n = THREE.MathUtils.clamp(hits + 1, 2, 3), g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 60; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 2.6 + Math.random() * 2.6;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 3.4))) continue;
          parts.push({ shape: 'circle', r: POOL.r, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.0, tmax: 2.0 };
      }
      // eruptions under the player one after another, each where they are at that moment; orbs that come round
      // after them (no mark on the floor: what they do shows)
      case 'pursuit': return { ...base, shape: 'none', heavy: false, n: THREE.MathUtils.clamp(hits + 2, 3, 5), tempo: 0.8, tmin: 0.6, tmax: 1.4 };
      case 'orbs': return { ...base, shape: 'none', heavy: false, blockable: true, n: THREE.MathUtils.clamp(hits + 1, 2, 5), cap: { left: hits }, tempo: 0.8, tmin: 0.6, tmax: 1.4 };
      case 'rain': {
        // around where the player stands, one right there
        const n = THREE.MathUtils.clamp(hits + 1, 3, 6), r = 2.0, g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 60; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 1.8 + Math.random() * 2.8;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 2.2))) continue;
          parts.push({ shape: 'circle', r, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0.3, cap: { left: hits } };
      }
      case 'volley': {
        const n = THREE.MathUtils.clamp(hits, 3, 5), parts = [];
        for (let i = 0; i < n; i++) {
          const a = e.aim + (i - (n - 1) / 2) * 0.7 / (n - 1);
          parts.push({ shape: 'line', len: this.clearRun(ep.x, ep.z, a, ep.y + H * 0.6, 18), width: 1.2, x: ep.x, y: ep.y, z: ep.z, aim: a });
        }
        return { ...base, heavy: false, blockable: true, shape: 'multi', parts, gap: 0.14, cap: { left: hits } };
      }
      // a die thrown (１D６): as many blasts as the face it shows, round where the player stands, one right there
      case 'dice': {
        const n = this.diceFace(s), g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 80; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 2.2 + Math.random() * 3.2;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 2.4))) continue;
          parts.push({ shape: 'circle', r: 2.1, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0.24, hits: 1, cap: { left: n }, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.3, tmax: 2.2 };
      }
      // checkmate: the floor round the player turns into a chessboard and every other square comes down - the one the
      // player stands on among them; the squares beside it are safe
      case 'chess': {
        const SQ = 3, N = 3, g = G.map.grid, parts = [];
        const ox = head.x - SQ / 2, oz = head.z - SQ / 2;
        for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
          if ((i + j) % 2) continue;
          const x0 = ox + i * SQ, cz = oz + j * SQ + SQ / 2, cx = x0 + SQ / 2;
          const tx = Math.round(cx / T - 0.5), ty = Math.round(cz / T - 0.5);
          if (!(i === 0 && j === 0) && (!g.valid(tx, ty) || !G.map.walkable(tx, ty))) continue;
          parts.push({ shape: 'line', len: SQ, width: SQ, x: x0, y: G.floorAt(cx / T - 0.5, cz / T - 0.5), z: cz, aim: 0 });
        }
        return { ...base, shape: 'multi', parts, gap: 0, hits: 1, heavy: false, certain: s.hit_type === 0, tempo: 1.6, tmin: 2.4, tmax: 3.2 };
      }
    }
    return this.planNewMove(e, fam, s, head, ep, base) ?? null;
  }
  // the face a die skill shows: the digit its name ends with (１D６주사위4), else its fixed damage in ten thousands
  diceFace(s) {
    const name = (s.name || '').trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const m = /(\d)$/.exec(name);
    const k = m ? +m[1] : Math.round((+s.damage?.formula || 10000) / 10000);
    return THREE.MathUtils.clamp(k || 1, 1, 6);
  }
  // the move goes off as its wind-up ends
  releaseBossMove(e) {
    const plan = e.plan, s = e.skill, fam = e.move;
    if (!plan) { this.endMove(e, 0.5); return; }
    G.coop?.onBossMove?.(e);                       // (its co-op guests see it go off as well - coop.js)
    if (!e.puppet) this.runSkillCommonEvents(s);
    const ep = e.worldPos(new THREE.Vector3());
    if (this.releaseNewMove(e, fam, plan, s, ep)) return;          // (bossmoves.js)
    const anim = s.animation_id > 0 ? s.animation_id : 0;
    const along = (k, y) => new THREE.Vector3(plan.ox + Math.cos(plan.aim) * k, y, plan.oz + Math.sin(plan.aim) * k);
    switch (fam) {
      case 'charge': case 'lunge': {
        this.dropMarker(e);
        const run = Math.max(0.5, plan.len - e.r * T * 0.5);           // its front stops at the wall
        e.state = 'act';
        e.act = { kind: 'dash', t: 0, x0: e.fx, y0: e.fy, ca: Math.cos(plan.aim), sa: Math.sin(plan.aim), L: run / T, dur: Math.max(0.15, run / CHARGE_SPEED), hit: false, puff: 0, wall: !!plan.wall };
        G.audio?.playSe(G.seAt('Wind7', 90, 70), ep);
        G.audio?.playSe(G.seAt('Run', 100, 80), ep);
        return;
      }
      case 'leap': this.dropMarker(e); this.landLeap(e); return;
      case 'fissure': {
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        const spots = [1, 2, 3].map(k => { const p = along(plan.len * k / 3.5, 0); p.y = G.floorAt(p.x / T - 0.5, p.z / T - 0.5) + 0.6; return p; });
        for (const p of spots) this.spawnGlow(p, { color: 0xff6a3a, size: 2.2, life: 0.35, grow: 1.3 });
        if (anim) G.screen.playAnimationOn(spots[0], anim, { world: true, size: 2.2, copies: spots.slice(1).map(pos => ({ pos, size: 2.2 })) });
        G.audio?.playSe(G.seAt('Earth4', 100, 80), ep);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.8);
        return;
      }
      case 'quake': case 'roar': {
        this.dropMarker(e);
        e.bodyT = { kind: fam === 'roar' ? 'roar' : 'stomp', t0: G.time };
        if (anim) G.screen.playAnimationOn(new THREE.Vector3(ep.x, ep.y + e.h * 0.5, ep.z), anim, { world: true, size: this.enemySize(e) * 1.5 });
        if (fam === 'quake') {
          G.audio?.playSe(G.seAt('Earth4', 100, 70), ep);
          const head = G.player.headWorld(new THREE.Vector3());
          if (Math.hypot(head.x - ep.x, head.z - ep.z) < plan.r + 2) G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.35);
        }
        this.spawnWave(e, plan);
        this.endMove(e, 0.9);
        return;
      }
      case 'thrust': case 'execute': {
        this.dropMarker(e);
        // (a lance: it darts in a little as it strikes)
        if (fam === 'thrust' && !e.puppet) this.moveEnemyToward(e, e.fx + Math.cos(plan.aim) * 3, e.fy + Math.sin(plan.aim) * 3, 1.2 / T);
        e.bodyT = { kind: fam === 'execute' ? 'stomp' : 'lunge', t0: G.time };
        const y = ep.y + Math.min(1.2, e.h * 0.5);
        const mid = fam === 'thrust' ? along(plan.len * 0.5, y) : along(Math.min(plan.r * 0.45, 3), y);
        if (anim) G.screen.playAnimationOn(mid, anim, { world: true, size: fam === 'thrust' ? 2 : THREE.MathUtils.clamp(plan.r * 0.9, 2.2, 4.5) });
        G.audio?.playSe(G.seAt(fam === 'thrust' ? 'Wind7' : 'Slash11', 100, fam === 'thrust' ? 135 : 70), ep);
        if (fam === 'execute') {
          this.spawnGlow(mid, { color: 0xff3020, size: 3.2, life: 0.3, grow: 1.4 });
          const head = G.player.headWorld(new THREE.Vector3());
          if (Math.hypot(head.x - ep.x, head.z - ep.z) < plan.r + 3) G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.45);
        }
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, plan.blockable, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, fam === 'execute' ? 1.2 : 0.7);
        return;
      }
      case 'nova': {
        this.dropMarker(e);
        e.bodyT = { kind: 'roar', t0: G.time };
        // its animation all over where it lands
        const ring = plan.shape === 'ring', mid = ring ? (plan.r0 + plan.r) / 2 : plan.r * 0.6;
        const n = THREE.MathUtils.clamp(Math.round(2 * Math.PI * mid / 3.4), 4, 9), copies = [];
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2, x = plan.ox + Math.cos(a) * mid, z = plan.oz + Math.sin(a) * mid;
          copies.push({ pos: new THREE.Vector3(x, G.floorAt(x / T - 0.5, z / T - 0.5) + 1, z), size: 3.2 });
        }
        if (anim) G.screen.playAnimationOn(ring ? copies[0].pos : new THREE.Vector3(plan.ox, plan.oy + 1, plan.oz), anim, { world: true, size: ring ? 3.2 : Math.min(2 * plan.r, 6), copies: ring ? copies.slice(1) : copies });
        this.spawnRing(new THREE.Vector3(plan.ox, plan.oy, plan.oz), plan.r, this.skillColor(s));
        G.audio?.playSe(G.seAt('Explosion3', 90, 80), ep);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.9);
        return;
      }
      case 'cross': {
        this.dropMarker(e);
        const p0 = plan.parts[0];
        if (p0) {
          const c = new THREE.Vector3(p0.x, p0.y + 1, p0.z);
          const arm = (p, k, y) => new THREE.Vector3(p.x + Math.cos(p.aim) * p.len * k, y, p.z + Math.sin(p.aim) * p.len * k);
          if (anim) G.screen.playAnimationOn(c, anim, { world: true, size: 2.6, copies: plan.parts.map(p => ({ pos: arm(p, 0.6, p0.y + 1), size: 2.4 })) });
          for (const p of plan.parts) this.spawnGlow(arm(p, 0.5, p0.y + 0.3), { color: this.skillColor(s), size: 2.2, life: 0.3, grow: 1.3 });
          G.audio?.playSe(G.seAt('Saint5', 90, 90), c);
        }
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.8);
        return;
      }
      case 'wave':
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        this.spawnBand(e, plan);
        if (anim) G.screen.playAnimationOn(along(2, ep.y + 1), anim, { world: true, size: 3 });
        G.audio?.playSe(G.seAt('Water1', 100, 70), ep);
        this.endMove(e, 0.8);
        return;
      case 'field':
        // the pools come up and stay (hazards), hurting whoever stands in them
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        for (const p of plan.parts) this.addPool(e, s, p, plan);
        G.audio?.playSe(G.seAt('Poison', 90, 80), ep);
        this.endMove(e, 0.8);
        return;
      case 'chess': {
        // every marked square at once: a pillar of darkness on each, the board shaking
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        const head = G.player.headWorld(new THREE.Vector3());
        const near = plan.parts.map(p => ({ p, d: Math.hypot(p.x + p.len / 2 - head.x, p.z - head.z) })).sort((a, b) => a.d - b.d);
        for (const { p } of near) this.spawnGlow(new THREE.Vector3(p.x + p.len / 2, p.y + 0.4, p.z), { color: 0xb050ff, size: p.len * 1.15, life: 0.45, grow: 1.15 });
        if (anim && near.length) {
          const at = q => new THREE.Vector3(q.p.x + q.p.len / 2, q.p.y + 1.2, q.p.z);
          G.screen.playAnimationOn(at(near[0]), anim, { world: true, size: 3, copies: near.slice(1, 6).map(q => ({ pos: at(q), size: 3 })) });
        }
        G.audio?.playSe(G.seAt('Darkness5', 100, 70), ep);
        G.audio?.playSe(G.seAt('Earth4', 90, 60), ep);
        G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.4);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, 1, false, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, 1);
        this.endMove(e, 1.2);
        return;
      }
      case 'pursuit': e.state = 'act'; e.act = { kind: 'pursuit', t: 0, next: 0, left: plan.n, cap: { left: plan.hits } }; return;
      case 'orbs': e.state = 'act'; e.act = { kind: 'orbs', t: 0, next: 0, left: plan.n }; return;
      case 'grab': e.state = 'act'; e.act = { kind: 'grab', t: 0 }; return;
      case 'sweep':
        G.audio?.playSe(G.seAt('Wind7', 100, 85), ep);
        e.state = 'act'; e.act = { kind: 'sweep', t: 0, dur: 0.42, a0: plan.aim - plan.half * plan.way, allyHit: new Set() };
        return;
      case 'breath':
        if (anim) {
          const y = plan.oy + Math.min(1.2, e.h * 0.5);
          const size = k => THREE.MathUtils.clamp(2.2 * plan.r * k * Math.sin(plan.half), 1.6, 4);
          G.screen.playAnimationOn(along(plan.r * 0.3, y), anim, { world: true, size: size(0.3), copies: [{ pos: along(plan.r * 0.62, y), size: size(0.62) }] });
        }
        break;
      case 'spin':
        if (anim) G.screen.playAnimationOn(new THREE.Vector3(ep.x, ep.y + e.h * 0.5, ep.z), anim, { world: true, size: this.enemySize(e) * 1.3 });
        break;
    }
    // a breath, a whirl, a rain of blows, a fan of shots: they go on a moment
    e.state = 'act';
    e.act = { kind: fam, t: 0, next: 0, left: plan.hits };
  }
  // a move going on
  updateBossAct(e, dt) {
    const a = e.act, plan = e.plan, s = e.skill;
    if (!a || !plan) { this.endMove(e, 0.5); return; }
    a.t += dt;
    if (this.updateNewAct(e, a, plan, s, dt)) return;             // (bossmoves.js)
    switch (a.kind) {
      case 'dash': {
        const k = Math.min(1, a.t / a.dur);
        const px = e.fx, py = e.fy;
        e.fx = a.x0 + a.ca * a.L * k; e.fy = a.y0 + a.sa * a.L * k;
        // whoever is in the way: the body swept from where it was to where it is (a dodge's invincibility works)
        for (const al of this.allies.struckable()) {
          if ((a.allyHit ||= new Set()).has(al)) continue;
          if (segDist(al.fx, al.fy, px, py, e.fx, e.fy) <= e.r + al.r / T) {
            a.allyHit.add(al);
            this.hitAlly(al, e, s, plan.hits, { dir: [a.ca, a.sa], push: CHARGE_KNOCK });
          }
        }
        const head = G.player.headWorld(new THREE.Vector3());
        // (a co-op guest's copy strikes this player and throws it, but runs on through, as the host's does through a
        // guest; where the host's stops on the host, the host says so - onChargeImpact)
        if (!a.hit && !this.outOfFight(e) && segDist(head.x / T - 0.5, head.z / T - 0.5, px, py, e.fx, e.fy) <= e.r + BODY_R) {
          a.hit = true;
          const parried = this.parryable(plan) && this.parryNow(e.worldPos(new THREE.Vector3()));
          this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
          if (s.animation_id > 0) {
            const wp = e.worldPos(new THREE.Vector3());
            G.screen.playAnimationOn(new THREE.Vector3((wp.x + head.x) / 2, head.y - 0.3, (wp.z + head.z) / 2), s.animation_id, { world: true, size: this.enemySize(e) });
          }
          // it ran into the player (not slipped past in a dodge): it stops up against them and bounces back
          if (!(G.player.invuln > 0) && e.puppet) G.player.knockback(a.ca, a.sa, parried ? PARRY_SLIDE : CHARGE_KNOCK, parried ? 0 : 1.6);
          else if (!(G.player.invuln > 0)) {
            const pc = G.map.playerChar, u = firstContact(px, py, e.fx, e.fy, pc.fx, pc.fy, e.r + BODY_R);
            e.fx = px + (e.fx - px) * u; e.fy = py + (e.fy - py) * u;
            this.chargeImpact(e, a, false);
            G.coop?.onChargeImpact?.(e);
            // and the player is thrown on along its way (a little off the ground) - off a perfect guard only a
            // short slide back, feet on the ground: its weight, not a throw
            G.player.knockback(a.ca, a.sa, parried ? PARRY_SLIDE : CHARGE_KNOCK, parried ? 0 : 1.6);
            break;
          }
        }
        if ((a.puff -= dt) <= 0) {
          a.puff = 0.07;
          const p = e.worldPos(new THREE.Vector3()); p.y += 0.15;
          this.spawnGlow(p, { color: 0xb8a890, size: 0.6, life: 0.35, grow: 1.7 });
        }
        if (k >= 1) {
          if (a.wall) { this.chargeImpact(e, a, true); break; }           // up against a wall
          G.audio?.playSe(G.seAt('Earth4', 80, 120), e.worldPos(new THREE.Vector3()));
          this.endMove(e, 1.1);
        }
        break;
      }
      // bouncing back off what it ran into: a short hop back the way it came, then it gathers itself
      case 'recoil': {
        const k = Math.min(1, a.t / a.dur), q = 1 - (1 - k) * (1 - k);
        e.fx = a.x0 + a.ca * a.L * q; e.fy = a.y0 + a.sa * a.L * q;
        e.lift = a.hop * 4 * k * (1 - k);
        if (k >= 1) { e.lift = 0; this.endMove(e, 0.9); }
        break;
      }
      case 'breath': {
        // it keeps pouring: stepping out of the cone cuts it short
        this.updateTelegraph(e);
        const ticks = THREE.MathUtils.clamp(plan.hits + 1, 2, 4), dur = 0.75;
        while (a.next < ticks && a.t >= a.next * dur / (ticks - 1)) {
          a.next++;
          if (a.left > 0 && this.playerInPlan(e, plan)) { a.left--; this.enemyStrikePlayer(e, s, { blockable: plan.blockable, parry: this.parryable(plan) }); }
          this.strikeAlliesInPlan(e, s, plan, 1, a.allyCap ||= new Map());
        }
        if (a.t >= dur) this.endMove(e, 0.6);
        break;
      }
      case 'spin': {
        // (after whom it goes for; a guest's copy goes where the host's is)
        const to = e.tgt?.stands && e.tgt.alive ? e.tgt : G.map.playerChar;
        if (!e.puppet) this.moveEnemyToward(e, to.fx, to.fy, 2.6 * dt / T);
        this.updateTelegraph(e);
        if (a.t >= a.next) {
          a.next += 0.45;
          G.audio?.playSe(G.seAt('Wind4', 70, 110 + Math.random() * 20), e.worldPos(new THREE.Vector3()));
          if (a.left > 0 && this.playerInPlan(e, plan)) { a.left--; this.enemyStrikePlayer(e, s, { blockable: plan.blockable, parry: this.parryable(plan) }); }
          this.strikeAlliesInPlan(e, s, plan, 1, a.allyCap ||= new Map());
        }
        // a slash trails round it at every half turn
        const turns = Math.floor(spinAngle(a.t) / Math.PI);
        if (a.halfTurns === undefined) a.halfTurns = turns;
        if (turns > a.halfTurns) { a.halfTurns = turns; this.spawnSlashArc(e); }
        if (a.t >= SPIN_TIME) this.endMove(e, 0.8);
        break;
      }
      case 'sweep': {
        // the blade goes over the arc from one side to the other; whoever it passes over is struck, once
        const k = THREE.MathUtils.smootherstep(Math.min(1, a.t / a.dur), 0, 1);
        const prev = a.ang ?? a.a0, ang = a.a0 + plan.way * 2 * plan.half * k;
        a.ang = ang;
        this.showBlade(e, plan, ang);
        const crossed = (x, z, body) => {
          const dx = x - plan.ox, dz = z - plan.oz, d = Math.hypot(dx, dz);
          if (d > plan.r + body) return false;
          if (d < 0.7) return true;
          const m = body / d, sw = ang - prev, b = Math.atan2(dz, dx);
          const rel = Math.atan2(Math.sin(b - prev), Math.cos(b - prev));
          return sw >= 0 ? rel >= -m && rel <= sw + m : rel <= m && rel >= sw - m;
        };
        const head = G.player.headWorld(new THREE.Vector3());
        if (!a.hitP && crossed(head.x, head.z, 0.38)) { a.hitP = true; this.strikeHits(e, s, plan.hits, plan.blockable, false, this.parryable(plan)); }
        for (const al of this.allies.struckable()) {
          if (a.allyHit.has(al)) continue;
          const ap = al.worldPos(new THREE.Vector3());
          if (crossed(ap.x, ap.z, al.r)) { a.allyHit.add(al); this.hitAlly(al, e, s, plan.hits); }
        }
        if (a.t >= a.dur) {
          this.hideBlade(e);
          if (s.animation_id > 0) G.screen.playAnimationOn(new THREE.Vector3(plan.ox + Math.cos(ang) * plan.r * 0.5, plan.oy + 1, plan.oz + Math.sin(ang) * plan.r * 0.5), s.animation_id, { world: true, size: 2.6 });
          this.endMove(e, 0.7);
        }
        break;
      }
      case 'grab': {
        const head = G.player.headWorld(new THREE.Vector3());
        if (!a.reached && a.t >= 0.14) {
          a.reached = true;
          // the reach: a streak out along the band
          const from = new THREE.Vector3(plan.ox, plan.oy + Math.min(1.3, e.h * 0.55), plan.oz);
          const to = new THREE.Vector3(plan.ox + Math.cos(plan.aim) * plan.len, from.y - 0.2, plan.oz + Math.sin(plan.aim) * plan.len);
          this.spawnTracer(from, to, 0xff9070);
          this.spawnGlow(to, { color: 0xff7050, size: 0.6, life: 0.2, grow: 1.6 });
          G.audio?.playSe(G.seAt('Wind1', 90, 120), from);
          if (this.playerInPlan(e, plan) && !this.playerDead) {
            if (G.player.invuln > 0) this.enemyStrikePlayer(e, s, { blockable: false });      // (slipped it in a dodge)
            else if (this.parryable(plan) && this.parryNow(new THREE.Vector3(plan.ox, plan.oy, plan.oz))) this.enemyStrikePlayer(e, s, { blockable: false, parry: true });   // (a perfect guard: not caught)
            else {
              // caught: pulled in, up to it
              a.caught = true;
              const d = Math.hypot(head.x - plan.ox, head.z - plan.oz), pull = Math.max(0, d - ((e.r || 0.4) * T + 0.75));
              G.player.knockback(-Math.cos(plan.aim), -Math.sin(plan.aim), pull, 0.4);
              G.audio?.playSe(G.seAt('Twine', 100, 90), head);
              G.input.haptic('left', 0.8, 200); G.input.haptic('right', 0.8, 200);
            }
          }
          this.strikeAlliesInPlan(e, s, plan, plan.hits);
          this.dropMarker(e);
        }
        if (a.caught && !a.hit && a.t >= 0.55) {
          a.hit = true;
          if (s.animation_id > 0) G.screen.playAnimationOn(head.clone().add(new THREE.Vector3(0, -0.4, 0)), s.animation_id, { world: true, visual: false });
          this.strikeHits(e, s, plan.hits, false);
        }
        if (a.t >= (a.caught ? 0.9 : 0.5)) this.endMove(e, 0.9);
        break;
      }
      case 'pursuit': {
        // a spot under the player every PURSUIT.gap s; each bursts PURSUIT.fuse s after it was laid (hazards)
        while (a.left > 0 && a.t >= a.next) {
          a.next += PURSUIT.gap; a.left--;
          const head = this.targetHead(e);
          this.addEruption(e, s, head.x, head.z, a.cap);
        }
        if (a.left <= 0 && a.t >= a.next) this.endMove(e, 0.6);
        break;
      }
      case 'orbs': {
        while (a.left > 0 && a.t >= a.next) {
          a.next += 0.16; a.left--;
          const i = plan.n - 1 - a.left, spread = plan.n > 1 ? (i / (plan.n - 1) - 0.5) * 1.2 : 0;
          const from = e.worldPos(new THREE.Vector3()); from.y += e.h * 0.6;
          this.spawnProjectile(from, new THREE.Vector3(Math.cos(e.aim + spread), 0.1, Math.sin(e.aim + spread)),
            { speed: 2.5, accel: 7, maxSpeed: 8, color: this.skillColor(s), enemy: e, skill: s, homing: 0, steer: 3, cap: plan.cap, life: 3.4, aimAt: e.tgt || null, pierce: !!plan.pierce, ghost: !!e.puppet });
          G.audio?.playSe(G.seAt('Magic3', 70, 130), from);
        }
        if (a.left <= 0) this.endMove(e, 0.6);
        break;
      }
      default:                                      // a rain of blows, a fan of shots
        e.moveT = (e.moveT || 0) + dt;
        this.updateMulti(e);
    }
  }
  // a charge that runs into the player or a wall: a heavy thud, dust bursting where it struck (and grit off a
  // wall), a squash, and the boss bounces back a little the way it came
  chargeImpact(e, a, wall) {
    const ep = e.worldPos(new THREE.Vector3());
    const R = (e.r || 0.4) * T, H = e.h || 1.8;
    const at = new THREE.Vector3(ep.x + a.ca * R * 0.8, ep.y + Math.min(1, H * 0.4), ep.z + a.sa * R * 0.8);
    G.audio?.playSe(G.seAt('Earth2', 100, 80), at);
    G.audio?.playSe(G.seAt('Earth3', 90, 70), at);
    for (let i = 0; i < 6; i++) {
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.4) * 0.5, (Math.random() - 0.5) * 0.6));
      this.spawnGlow(p, { color: 0xb8a890, size: 0.45 + Math.random() * 0.4, life: 0.5, grow: 1.8,
        vel: new THREE.Vector3(-a.ca * 1.2 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), -a.sa * 1.2 + (Math.random() - 0.5) * 1.5) });
    }
    if (wall) {
      this.spawnSparks(at, new THREE.Vector3(a.ca, 0, a.sa), 8, 0xc8b090);
      // the floor carries the blow a little way
      const head = G.player.headWorld(new THREE.Vector3());
      if (Math.hypot(head.x - ep.x, head.z - ep.z) < 6) { G.input.haptic('left', 0.35, 70); G.input.haptic('right', 0.35, 70); }
    }
    e.bodyT = { kind: 'land', t0: G.time };
    // back the way it came (clear: it has just run through there)
    const back = Math.atan2(-a.sa, -a.ca);
    const dist = Math.min(THREE.MathUtils.clamp(0.6 + R * 0.5, 0.8, 1.6), this.clearRun(ep.x, ep.z, back, ep.y + 0.8, 1.6));
    e.act = { kind: 'recoil', t: 0, x0: e.fx, y0: e.fy, ca: -a.ca, sa: -a.sa, L: dist / T, dur: 0.38, hop: 0.25 * THREE.MathUtils.clamp(H / 1.8, 0.7, 1.6) };
  }
  // a rain of blows / a fan of shots: each part fills toward its own moment, then comes down (or flies)
  updateMulti(e) {
    const plan = e.plan, set = e.marker, t = e.moveT || 0;
    this.turnParts(e, plan, set, t);
    plan.parts.forEach((p, i) => {
      if (p.done) return;
      const at = plan.t0 + (p.at ?? i * plan.gap);          // (a part of its own moment: the second way of a lattice, the next bands)
      const mk = set?.list?.[i];
      if (mk && !mk.released) {
        mk.setProgress(Math.min(1, t / at));
        if (this.unguardable(plan)) mk.edgeMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(G.time * 9));
      }
      if (e.state !== 'act' || t < at) return;
      p.done = true;
      set?.release?.(i, this.fadingMarkers);
      this.landPart(e, p);
    });
    if (e.state === 'act' && plan.parts.every(p => p.done)) this.endMove(e, 0.6);
  }
  landPart(e, p) {
    if (this.landNewPart(e, p)) return;                    // (a star's arm, a lattice's beam, a band - bossmoves.js)
    const plan = e.plan, s = e.skill;
    if (plan.move === 'rain' || plan.move === 'dice') {
      const at = new THREE.Vector3(p.x, p.y, p.z);
      if (s.animation_id > 0) G.screen.playAnimationOn(at.clone().setY(p.y + 0.8), s.animation_id, { world: true, size: Math.min(4, p.r * 2) });
      else G.audio?.playSe(G.seAt('Explosion1', 55, 120), at);
      this.spawnGlow(at.clone().setY(p.y + 0.2), { color: this.skillColor(s), size: p.r * 2.2, life: 0.3, grow: 1.2 });
      const head = G.player.headWorld(new THREE.Vector3());
      if (plan.cap.left > 0 && Math.hypot(head.x - p.x, head.z - p.z) <= p.r + 0.38) { plan.cap.left--; this.enemyStrikePlayer(e, s, { blockable: false, certain: !!plan.certain, parry: this.parryable(plan) }); }
      this.strikeAlliesNear(e, s, p.x, p.z, p.r, 1);
      return;
    }
    // a shot along its line
    const from = new THREE.Vector3(plan.ox, plan.oy + e.h * 0.6, plan.oz);
    this.spawnProjectile(from, new THREE.Vector3(Math.cos(p.aim), 0, Math.sin(p.aim)), { speed: 14, color: this.skillColor(s), enemy: e, skill: s, homing: 0, cap: plan.cap, life: 2.5, pierce: !!plan.pierce, ghost: !!e.puppet });
    G.audio?.playSe(G.seAt('Magic1', 60, 120 + Math.random() * 20), from);
  }
  // the leap: a short crouch, then up high and across to the marked spot, a moment hanging there, and down hard
  updateLeap(e) {
    const plan = e.plan;
    if (!plan) return;
    const el = e.timer0 - e.timer, crouch = plan.dive ? 0 : Math.min(0.35, e.timer0 * 0.22);
    if (el < crouch) return;
    if (!plan.jumped) {
      if (e.puppet) return;            // (a co-op guest's copy: the host says where it comes down - coop.js onLeap)
      plan.jumped = true; plan.sx = e.fx; plan.sy = e.fy; plan.jumpAt = el;
      plan.height = THREE.MathUtils.clamp(2.5 + e.h, 3.5, 7);
      // (from up in the sky: a dive, from as high as it is)
      if ((e.sky || e.diving || plan.dive) && (e.lift || 0) > plan.height) { plan.height = e.lift; plan.dive = true; }
      // up in the air: now the spot it comes down on is marked, where the player (or whoever it goes for) stands at
      // this moment, and the mark stays there - the boss lands on it, not on wherever the player has gone
      const head = this.targetHead(e);
      plan.cx = head.x; plan.cz = head.z;
      e.marker = new FloorMarker(this.root, { ...plan, color: MARK.heavy, label: plan.hits > 1 ? `×${plan.hits}` : '' });
      const ep = e.worldPos(new THREE.Vector3());
      G.audio?.playSe(G.seAt('Jump1', 90, 70), ep);
      G.audio?.playSe(G.seAt('Wind4', 70, 80), ep);
      G.coop?.onLeap?.(e);
    }
    const k = THREE.MathUtils.clamp((el - crouch) / Math.max(0.1, e.timer0 - crouch), 0, 1);
    const tx = plan.cx / T - 0.5, ty = plan.cz / T - 0.5;
    const h = THREE.MathUtils.smootherstep(Math.min(1, k / 0.75), 0, 1);          // across while going up
    e.fx = plan.sx + (tx - plan.sx) * h; e.fy = plan.sy + (ty - plan.sy) * h;
    const H = plan.height;
    if (plan.dive) { e.lift = H * (1 - k * k * k); return; }        // (hangs up there, then down all at once)
    e.lift = k < 0.45 ? H * (1 - (1 - k / 0.45) ** 2) : k < 0.78 ? H : H * (1 - ((k - 0.78) / 0.22) ** 2);
  }
  landLeap(e) {
    const plan = e.plan, s = e.skill;
    const tx = plan.cx / T - 0.5, ty = plan.cz / T - 0.5;
    e.fx = tx; e.fy = ty; e.lift = 0;
    e.diving = false; e.landing = false;                 // (down from the sky with it - bossmoves.js skyDive)
    e.bodyT = { kind: 'land', t0: G.time };
    const at = new THREE.Vector3(plan.cx, G.floorAt(tx, ty), plan.cz);
    G.audio?.playSe(G.seAt('Earth4', 100, 75), at);
    G.audio?.playSe(G.seAt('Explosion1', 60, 70), at);
    if (s.animation_id > 0) G.screen.playAnimationOn(at.clone().setY(at.y + 0.8), s.animation_id, { world: true, size: Math.min(5, plan.r * 2) });
    this.spawnGlow(at.clone().setY(at.y + 0.15), { color: 0xff6a3a, size: plan.r * 2.3, life: 0.4, grow: 1.25 });
    this.spawnSparks(at.clone().setY(at.y + 0.1), new THREE.Vector3(1, 0, 0), 14, 0xc8b090);
    const head = G.player.headWorld(new THREE.Vector3());
    this.strikeAlliesInPlan(e, s, plan, plan.hits);
    // (down from the sky - a dive: the ground shakes a little and both hands feel it, more the nearer it lands)
    if (plan.dive) {
      const d = Math.hypot(head.x - at.x, head.z - at.z);
      if (d < 18) {
        const k = 1 - d / 18;
        G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 0.2 + 0.3 * k);
        G.input.haptic('left', 0.45 + 0.4 * k, 170); G.input.haptic('right', 0.45 + 0.4 * k, 170);
      }
    }
    if (this.playerInPlan(e, plan)) {
      const parried = this.parryable(plan) && this.parryNow(e.worldPos(new THREE.Vector3()));
      this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
      // under it: thrown up into the air (not when it was slipped in a dodge); off a perfect guard it only jolts -
      // the ground and both hands shake hard
      if (parried) {
        G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 0.8);
        G.input.haptic('left', 1, 220); G.input.haptic('right', 1, 220);
      } else if (!(G.player.invuln > 0) && !this.playerDead) G.player.knockback(0, 0, 0, LEAP_LAUNCH);
    } else if (!plan.dive && Math.hypot(head.x - at.x, head.z - at.z) < plan.r + 3) {
      // the ground shakes around it
      G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 0.5);
      G.input.haptic('left', 0.45, 90); G.input.haptic('right', 0.45, 90);
    }
    this.endMove(e, 1.2);
  }
  // a shockwave running out across the floor from the boss (quake, roar): it hits where its front passes
  spawnWave(e, plan) {
    const ep = e.worldPos(new THREE.Vector3());
    const color = new THREE.Color(plan.move === 'roar' ? 0xffa060 : 0xff5a2a).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(ep.x, ep.y + 0.08, ep.z);
    mesh.scale.setScalar(0.3);
    mesh.renderOrder = 5;
    mesh.userData.transient = true;
    this.root.add(mesh);
    this.waves.push({ e, skill: e.skill, hits: plan.hits, x: ep.x, z: ep.z, fx: e.fx, fy: e.fy, r: 0.3, R: plan.r, speed: plan.wave, mesh, hit: false, parry: this.parryable(plan) });
    G.input.haptic('left', 0.35, 80); G.input.haptic('right', 0.35, 80);
  }
  updateWaves(dt, paused) {
    if (!this.waves.length || paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    const pc = G.map.playerChar;
    this.waves = this.waves.filter(w => {
      if (w.band) return this.updateBand(w, dt, head);
      w.r = Math.min(w.R, w.r + w.speed * dt);
      w.mesh.scale.setScalar(w.r);
      w.mesh.material.opacity = 0.75 * Math.min(1, (w.R - w.r) / (w.R * 0.3) + 0.15);
      const d = Math.hypot(head.x - w.x, head.z - w.z);
      // (struck past no wall; from a boss over a pillar - a flier, one chasing through a wall - it runs out of that
      // block over the floor round it)
      if (!w.hit && Math.abs(d - w.r) <= 0.55 + 0.38 && lineOfSight(w.fx, w.fy, pc.fx, pc.fy, true)) this.passOver(w, w.r >= d);
      // (the companions it passes)
      for (const al of this.allies.struckable()) {
        if ((w.allyHit ||= new Set()).has(al)) continue;
        const ap = al.worldPos(new THREE.Vector3());
        if (Math.abs(Math.hypot(ap.x - w.x, ap.z - w.z) - w.r) <= 0.55 + al.r && lineOfSight(w.fx, w.fy, al.fx, al.fy, true)) {
          w.allyHit.add(al);
          this.hitAlly(al, w.e, w.skill, w.hits, { from: { x: w.x, z: w.z }, push: 0.8 });
        }
      }
      if (w.r < w.R) return true;
      this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
      return false;
    });
  }
  // a wave (a ring going out, a wall rolling on) on the player: it strikes as it gets to where they stand (over: it has),
  // and a dodge any time while it is on them lets it by. (It struck a body's width before it got there, at the first
  // touch, so a dodge as it came over came too late - 그랑・기뇰's waves could be neither dodged nor guarded)
  passOver(w, over) {
    if (G.player.invuln > 0) w.dodged = true;
    if (!over) return;
    w.hit = true;
    const dodged = !!w.dodged;
    for (let i = 0; i < w.hits; i++) this.later(i * 140, () => this.enemyStrikePlayer(w.e, w.skill, { blockable: false, parry: !!w.parry, dodged }));
  }
  // a move's blow lands: as many hits as the skill has, a moment apart
  strikeHits(e, s, n, blockable, certain = false, parry = false) {
    for (let i = 0; i < (n || 1); i++) this.later(i * 140, () => this.enemyStrikePlayer(e, s, { blockable, certain, parry }));
  }
  // the blade of a sweep, at waist height, where it is now
  showBlade(e, plan, ang) {
    if (!e.blade) {
      const geo = new THREE.CircleGeometry(plan.r, 10, -0.09, 0.18);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0e0).multiplyScalar(fxk()), transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const inner = new THREE.Mesh(geo, mat);
      inner.rotation.x = -Math.PI / 2;
      e.blade = new THREE.Group();
      e.blade.add(inner);
      e.blade.renderOrder = 1400;
      e.blade.userData.transient = true;
      this.root.add(e.blade);
    }
    e.blade.position.set(plan.ox, plan.oy + Math.min(1.0, (e.h || 1.8) * 0.45), plan.oz);
    e.blade.rotation.y = -ang;
  }
  hideBlade(e) {
    if (!e.blade) return;
    this.root.remove(e.blade);
    e.blade.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    e.blade = null;
  }
  // a ring of light running out over the floor (a blast going off)
  spawnRing(at, r, color) {
    const geo = this._novaRing || (this._novaRing = new THREE.RingGeometry(0.9, 1, 64));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(fxk()), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, at.y + 0.1, at.z);
    mesh.renderOrder = 6;
    this.root.add(mesh);
    this.fx.push({ obj: mesh, t: 0, life: 0.45, size: r * 0.3, grow: 1 / 0.3 });
  }
  // a wall of water (wind) rolling out from a boss over the floor: struck where it passes (roll through it)
  spawnBand(e, plan) {
    const ux = Math.cos(plan.aim), uz = Math.sin(plan.aim);
    const color = new THREE.Color(this.skillColor(e.skill)).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plan.width, 1.7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.y = Math.atan2(ux, uz);
    mesh.position.set(plan.ox, plan.oy + 0.85, plan.oz);
    mesh.renderOrder = 5;
    mesh.userData.transient = true;
    this.root.add(mesh);
    this.waves.push({ band: true, e, skill: e.skill, hits: plan.hits, x: plan.ox, z: plan.oz, ux, uz, W: plan.width, L: plan.len, d: 0.3, speed: plan.wave || 8, mesh, hit: false, parry: this.parryable(plan) });
    G.input.haptic('left', 0.3, 80); G.input.haptic('right', 0.3, 80);
  }
  updateBand(w, dt, head) {
    w.d = Math.min(w.L, w.d + w.speed * dt);
    w.mesh.position.x = w.x + w.ux * w.d; w.mesh.position.z = w.z + w.uz * w.d;
    w.mesh.material.opacity = 0.55 * Math.min(1, (w.L - w.d) / 2 + 0.1);
    const inBand = (x, z, body) => {
      const rx = x - w.x, rz = z - w.z, along = rx * w.ux + rz * w.uz, side = Math.abs(rx * w.uz - rz * w.ux);
      return Math.abs(along - w.d) <= 0.6 + body && side <= w.W / 2 + body;
    };
    if (!w.hit && inBand(head.x, head.z, 0.38)) {
      const along = (head.x - w.x) * w.ux + (head.z - w.z) * w.uz;
      this.passOver(w, w.d >= along);
    }
    for (const al of this.allies.struckable()) {
      if ((w.allyHit ||= new Set()).has(al)) continue;
      const ap = al.worldPos(new THREE.Vector3());
      if (inBand(ap.x, ap.z, al.r)) { w.allyHit.add(al); this.hitAlly(al, w.e, w.skill, w.hits, { dir: [w.ux, w.uz], push: 0.8 }); }
    }
    if (w.d < w.L) return true;
    this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
    return false;
  }

  // ---- hazards: what a boss's move leaves on the floor for a while - eruptions under the player (pursuit) and
  // pools of poison (field) ----
  addEruption(e, s, x, z, cap) {
    const y = G.floorAt(x / T - 0.5, z / T - 0.5);
    // (no plain guard stops it, a perfect one does: pink - noPlainGuard)
    const mk = new FloorMarker(this.root, { shape: 'circle', r: PURSUIT.r, color: MARK.heavy });
    mk.setPose(x, y, z, 0);
    this.hazards.push({ kind: 'erupt', e, s, x, y, z, t: 0, mk, cap });
    G.audio?.playSe(G.seAt('Magic2', 55, 140), new THREE.Vector3(x, y + 0.5, z));
  }
  addPool(e, s, p, plan) {
    const color = new THREE.Color(this.poolColor(s)).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(this.poolGeometry(), new THREE.MeshBasicMaterial({ map: this.glowTexture(), color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, p.y + 0.06, p.z);
    mesh.scale.setScalar(p.r * 1.25);
    mesh.renderOrder = 4;
    mesh.userData.transient = true;
    this.root.add(mesh);
    const mk = new FloorMarker(this.root, { shape: 'circle', r: p.r, color: plan.certain ? MARK.certainHeavy : MARK.heavy });
    mk.setPose(p.x, p.y, p.z, 0);
    mk.setProgress(1);
    this.hazards.push({ kind: 'pool', e, s, x: p.x, y: p.y, z: p.z, r: p.r, t: 0, tick: 0.35, mesh, mk, color: this.poolColor(s), certain: plan.certain,
      cap: { left: Math.max(2, plan.hits) * 2 } });
  }
  // a pool's colour: poison green, fire orange, dark violet, else the spell's own
  poolColor(s) {
    if ((s.effects || []).some(ef => ef.code === 21 && [2, 3].includes(ef.data_id))) return 0x58ff5a;
    return { 3: 0xff7a30, 10: 0xa040ff }[s.damage?.element_id] || this.skillColor(s);
  }
  poolGeometry() { return this._poolGeo || (this._poolGeo = new THREE.CircleGeometry(1, 40)); }
  updateHazards(dt, paused) {
    if (!this.hazards.length || paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    this.hazards = this.hazards.filter(h => {
      h.t += dt;
      if (h.kind === 'erupt') {
        h.mk.setProgress(h.t / PURSUIT.fuse);
        if (h.t < PURSUIT.fuse) return true;
        // it bursts
        const at = new THREE.Vector3(h.x, h.y + 0.8, h.z);
        if (h.s.animation_id > 0) G.screen.playAnimationOn(at, h.s.animation_id, { world: true, size: PURSUIT.r * 2 });
        else G.audio?.playSe(G.seAt('Explosion1', 60, 120), at);
        this.spawnGlow(at.clone().setY(h.y + 0.25), { color: this.skillColor(h.s), size: PURSUIT.r * 2.2, life: 0.3, grow: 1.2 });
        if (h.cap.left > 0 && !this.playerDead && Math.hypot(head.x - h.x, head.z - h.z) <= PURSUIT.r + 0.38) { h.cap.left--; this.enemyStrikePlayer(h.e, h.s, { blockable: false, parry: true }); }
        this.strikeAlliesNear(h.e, h.s, h.x, h.z, PURSUIT.r, 1);
        this.fadingMarkers.push(h.mk);
        return false;
      }
      // a pool: it comes up, stays, fades; whoever stands in it is hurt every POOL.tick s (half the skill's blow)
      const k = h.t / POOL.time;
      h.mesh.material.opacity = Math.min(1, h.t / 0.35) * Math.min(1, (1 - k) / 0.2) * (0.6 + 0.15 * Math.sin(G.time * 5 + h.x));
      if (Math.random() < dt * 4) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * h.r * 0.9;
        this.spawnGlow(new THREE.Vector3(h.x + Math.cos(a) * r, h.y + 0.15, h.z + Math.sin(a) * r), { color: h.color, size: 0.25 + Math.random() * 0.3, life: 0.9, grow: 1.6, vel: new THREE.Vector3(0, 0.9, 0) });
      }
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = POOL.tick;
        if (h.cap.left > 0 && !this.playerDead && Math.hypot(head.x - h.x, head.z - h.z) <= h.r + 0.38) { h.cap.left--; this.enemyStrikePlayer(h.e, h.s, { blockable: false, certain: h.certain, mult: 0.5, parry: true }); }
        for (const al of this.allies.struckable()) {
          if (al.remote) continue;
          const ap = al.worldPos(new THREE.Vector3());
          if (Math.hypot(ap.x - h.x, ap.z - h.z) <= h.r + al.r) al.takeHit(h.e, h.s, { push: 0 });
        }
      }
      if (h.t < POOL.time) return true;
      this.root.remove(h.mesh); h.mesh.material.dispose();
      this.fadingMarkers.push(h.mk);
      return false;
    });
  }
  endMove(e, rest) {
    this.dropMarker(e);
    e.move = null; e.act = null;
    if (e.state === 'dying' || e.state === 'dead') return;        // (felled by its own move - a self-destruct)
    // (a co-op guest's copy: what comes next is the host's to say)
    if (e.puppet) { if (e.state === 'act' || e.state === 'windup') { e.state = 'recover'; e.timer = 0.5; } return; }
    const more = this.actionDone(e);
    if (e.state === 'dying' || e.state === 'dead') return;
    const pace = this.actionPace(e);
    e.state = 'recover';
    if (more) { e.timer = FOLLOW_REST; return; }
    e.timer = Math.max(0.25, (rest + Math.random() * 0.3) / pace);
    if (e.boss) e.nextMove = G.time + (BOSS_MOVE_REST[0] + Math.random() * (BOSS_MOVE_REST[1] - BOSS_MOVE_REST[0])) / pace;
  }
  // An enemy's action is over: the one its skill goes on with comes next, in the same turn (script 189
  // 使用後追加行動: <使用後追加行動:id,target,p> - skill id, p % of the time; 0 or less = one of its own actions) -
  // 귀신 무사's sword arts one after another, 지옥의 왕자's string of guns, 겔다's ice, a bear's roar and then its
  // fangs, 빙폭의 비스트 leaping up and melting away. Not when it can no longer act (fallen, asleep, broken) or
  // cannot use it. Else its turn is over (VX Ace's on_action_end: the turn count, states that end with an action).
  // True when it goes on.
  actionDone(e) {
    if (e.counterDone) { e.counterDone = false; e.acted = null; return false; }     // (a counter / an answer: no turn of its own)
    const s = e.acted; e.acted = null;
    const self = this.userEffectSkill(s);
    if (self && e.alive) this.applySkillToSelf(e, self);
    if (!e.alive) return false;                                  // (its own end - 인간 폭탄's 죽음의 씨앗)
    const next = this.followUp(e, s);
    if (next) {
      e.forcedSkill = next; e.pending = null;
      e.quick = true; e.cooldown = 0; e.alertTime = 0; e.nextMove = 0;
      return true;
    }
    e.turn++;
    this.expireActionStates(e);
    return false;
  }
  // Script 113 使用者効果: <使用者効果 n> - the one who used the skill takes skill n's effects as well, once it is
  // done (the next cut's mark of 삼단 베기, each stage of 씩성난 분노, 아기토's sure critical, a guard after
  // 카나키's cuts, 유니스's regeneration, 인간 폭탄 blowing itself up)
  userEffectSkill(s) {
    if (!s) return null;
    if (s._userFx === undefined) { const m = /<使用者効果\s*(\d+)\s*>/.exec(s.note || ''); s._userFx = m ? +m[1] : 0; }
    return s._userFx ? $data.skills[s._userFx] || null : null;
  }
  // Script 195 ステートでスキル変化: <ステート変化:id,state> - while the one using it has that state, the skill is
  // skill id instead (the last such line that holds): 삼단 베기 going on to its second and third cut, 씩성난 분노
  // growing stage by stage, 푸주한's rites after 도살, 십자 절단 with a bullet loaded
  skillByState(b, s) {
    if (!s || !b) return s;
    if (s._byState === undefined) s._byState = [...(s.note || '').matchAll(/<ステート変化:(\d+),(\d+)>/g)].map(m => ({ id: +m[1], state: +m[2] }));
    let id = s.id;
    for (const c of s._byState) if (b.isState(c.state)) id = c.id;
    return id === s.id ? s : $data.skills[id] || s;
  }
  // a skill's <使用後追加行動:id,target,p> notes: [{ id, p }] (companions go on with theirs too - allies.js)
  afterActions(s) {
    if (s._after === undefined) {
      s._after = [...(s.note || '').matchAll(/<使用後追加行動[：:]\s*(-?\d+)\s*,\s*-?\d+\s*(?:,\s*(\d+))?\s*>/g)]
        .map(m => ({ id: +m[1], p: m[2] === undefined ? 100 : +m[2] }));
    }
    return s._after;
  }
  followUp(e, s) {
    if (!s || !e.alive || e.hidden || e.state === 'stagger' || this.enemyRestricted(e) || this.playerDead || e.battle?.done) return null;
    for (const a of this.afterActions(s)) {
      if (a.p < Math.floor(Math.random() * 100)) continue;
      const next = a.id > 0 ? $data.skills[a.id] : this.chooseAction(e);
      if (next && this.enemyCanUse(e, next)) return next;
    }
    return null;
  }
  endFlurry(e) {
    e.comboStep = 0; e.move = null;
    if (e.boss) e.nextMove = G.time + (BOSS_MOVE_REST[0] + Math.random() * (BOSS_MOVE_REST[1] - BOSS_MOVE_REST[0])) / this.actionPace(e);
  }
  // the extra actions (feature 61) states give an enemy - 노・페이스's stances one after another, 가속 (haste): it
  // rests that much less between its actions (its own, from its data, are in its usual pace already)
  actionPace(e) {
    let n = 0;
    for (const id of e.b.states) for (const f of $data.states[id]?.features || []) if (f.code === 61) n += f.value;
    return (1 + n) * this.duelPace(e);
  }
  // (in her duel 흑기사 린다메아 does everything quicker - inDuel)
  duelPace(e) { return this.inDuel(e) ? DUEL_PACE : 1; }
  // ---- attack areas ------------------------------------------------------------------------
  // What an enemy action covers, decided as the wind-up starts:
  //  physical single -> a cone in front of the enemy; physical "all" -> a ring around it;
  //  magic "all" -> a circle where the player stands (move out of it); magic single -> a line (a shot).
  //  Several hits (repeats / random targets) hit that many times. Sure-hit (hit type 0) is purple (crimson when no
  //  plain guard stops it either): it stays locked on the player and the dodge's invincibility does not help.
  // where an enemy's attack goes: the player's head, or the companion it went for (its chest)
  targetHead(e) {
    const a = e?.tgt;
    if (a && a.stands && a.alive) return a.chest(new THREE.Vector3());
    return G.player.headWorld(new THREE.Vector3());
  }
  planAttack(e, skill, style) {
    const certain = skill.hit_type === 0;
    const hits = this.skillHits(skill);
    const ep = e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);
    const dist = Math.hypot(head.x - ep.x, head.z - ep.z);
    const magic = skill.hit_type === 2 || (certain && style !== 'melee');
    // thrown in an arc onto where the player stands as it winds up (step out of it); a death spell's dark circle
    // keeps to the player until a moment before it strikes (get out then)
    const look = this.skillLook(skill);
    if (look === 'lob' && ['melee', 'area', 'projectile', 'debuff'].includes(style)) {
      return { shape: 'circle', r: (e.boss ? 2.4 : 1.7) + (skill.scope === 2 ? 1 : 0), cx: head.x, cz: head.z, ground: true, lob: true, hits, certain, blockable: false };
    }
    if (look === 'death' && ['area', 'projectile', 'debuff'].includes(style)) {
      return { shape: 'circle', r: e.boss ? 2.2 : 1.6, cx: head.x, cz: head.z, ground: true, lockAt: 0.6, death: true, hits, certain, blockable: false };
    }
    // a gun fires along a line even when it cannot miss (a sure-hit shot homes in hard)
    if ((look === 'gun' || look === 'knife') && style === 'projectile' && skill.scope === 1) {
      return { shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + e.h * 0.6, 20), full: 20, width: e.boss ? 1.6 : 1.1, hits, certain, shot: true };
    }
    // (a boss's are bigger all round - BOSS_AREA)
    const B = !!e.boss, R = e.r * T;
    // a sure-hit counter or answer (리포스트's 판트): a quick, narrow lunge at the player
    if (e.countering && certain && ['melee', 'area', 'projectile', 'debuff'].includes(style)) return { shape: 'sector', r: R + (B ? 4.5 : 3.2), half: 0.45, hits, certain, blockable: true };
    // sure-hit attacks (the dodge's invincibility does not help) cover a wide circle around the enemy:
    // run out of it while it charges, or take it on the shield
    if (certain && ['melee', 'area', 'projectile', 'debuff'].includes(style)) return { shape: 'circle', r: (B ? BOSS_AREA.certain : 8.0) + R, around: true, hits, certain, blockable: true };
    const heavy = this.isHeavySkill(skill);
    // a plain blow reaches far in a long, narrow fan (about 57 degrees, as wide at its far edge as a 132-degree
    // fan 2.4 m long): backing away does not get out of it, stepping aside does; a heavy blow is the wide
    // sweep close in
    if (style === 'melee' && !heavy) return { shape: 'sector', r: R + (B ? BOSS_AREA.reach : 5.5), half: B ? 0.55 : 0.5, hits, certain, blockable: true };
    if (style === 'melee') return { shape: 'sector', r: R + (B ? 3.6 : 2.4), half: B ? 1.3 : 1.15, hits, certain, blockable: false, heavy };
    if (style === 'area' && !magic) return { shape: 'circle', r: (B ? 6.5 : 4.0) + R, around: true, hits, certain, blockable: !heavy, heavy };
    if (style === 'area' || ((style === 'projectile' || style === 'debuff') && skill.scope === 2)) {
      return { shape: 'circle', r: B ? 4.6 : 3.2, cx: head.x, cz: head.z, ground: true, follow: certain, hits, certain, blockable: false };
    }
    // a shot: its line shows the whole way it can fly, up to the first wall (shots do not go through walls)
    if (style === 'projectile' || style === 'debuff') return { shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + e.h * 0.6, 20), full: 20, width: B ? 2.0 : 1.4, hits, certain, shot: true };
    return null;
  }
  beginTelegraph(e) {
    this.dropMarker(e);
    const plan = e.move ? this.planBossMove(e) : this.planAttack(e, e.skill, e.style);
    e.plan = plan;
    e.moveT = 0;
    // a blow that goes through a guard (script 170 <防御状態無視率:n>, decided as it winds up): no plain guard stops it,
    // only a perfect one (or a perfect Gun Break), as with a heavy blow - pink, its border blinking, the same low warning
    if (plan && (plan.blockable || plan.shot) && this.ignoresGuard(e.b, e.skill)) { plan.blockable = false; plan.pierce = true; }
    // the beat: every attack fills its mark at a speed of its own - quick, even or slow (a late blow) - and the
    // fill ends as the blow lands, never pausing, so there is no fixed rhythm to swing to: watch the fill (in a
    // string of blows most come quick, now and then one is held back)
    const r = Math.random();
    const beat = !plan || plan.certain ? 0.88 + r * 0.24 : e.comboStep ? (r < 0.3 ? 1.75 : 1) : (r < 0.3 ? 0.7 : r < 0.72 ? 1 : 1.5) * (0.92 + Math.random() * 0.16);
    e.timer0 *= beat; e.timer = e.timer0;
    if (!plan) return;
    // (a move's own tempo: a lance comes quick, an execution slow)
    if (plan.tempo) { e.timer0 *= plan.tempo; e.timer = e.timer0; }
    if (plan.tmin) { e.timer0 = THREE.MathUtils.clamp(e.timer0, plan.tmin, plan.tmax); e.timer = e.timer0; }
    // area spells need a moment to get out of
    if (plan.certain && plan.around) { e.timer0 *= 1.3; e.timer = e.timer0; }      // time to get out of the big circle
    else if (plan.ground) { e.timer0 *= 1.25; e.timer = e.timer0; }
    else if (plan.shot) { e.timer0 *= 1.1; e.timer = e.timer0; }
    if (plan.heavy && !e.comboStep) { e.timer0 *= 1.2; e.timer = e.timer0; }
    // (a leap: over a second in the air to get out from under it, never hanging there long)
    if (plan.move === 'leap') { e.timer0 = plan.dive ? THREE.MathUtils.clamp(e.timer0, 1.2, 1.6) : THREE.MathUtils.clamp(e.timer0, 1.5, 2.6); e.timer = e.timer0; }
    // (in 흑기사 린다메아's duel: quicker, the waves of a move in parts a shorter while apart too - duelPace)
    const dp = this.duelPace(e);
    if (dp > 1) {
      e.timer0 /= dp; e.timer = e.timer0;
      if (plan.gap) plan.gap /= dp;
      for (const p of plan.parts || []) if (p.at) p.at /= dp;
    }
    // laid down where the enemy stands, facing where it aims, and it stays there (it follows no one)
    const ep = e.worldPos(new THREE.Vector3());
    // (on the floor under it, also when it is up in the air: a mark up there is out of sight)
    plan.ox = ep.x; plan.oy = ep.y - (e.lift || 0); plan.oz = ep.z; plan.aim = e.aim;
    plan.t0 = e.timer0;
    const look = this.markLook(plan);
    if (plan.shape === 'multi') {
      e.marker = new MarkerSet(this.root, plan.parts.map(p => ({ ...p, ...look })));
      plan.parts.forEach((p, i) => e.marker.list[i].setPose(p.x, p.y, p.z, p.aim || 0));
    } else if (plan.move !== 'leap' && plan.shape !== 'none') e.marker = new FloorMarker(this.root, { ...plan, ...look, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    // (a leap marks the spot it comes down on once it is in the air - updateLeap)
    if (plan.move === 'grab') {
      // (a grab: its own warning - an eerie sting and a creak, not the heavy blow's low note; motes drawn in along
      // its band all through the wind-up - grabMotes)
      G.audio?.playSe(G.seAt('Stare', 90, 100), ep);
      G.audio?.playSe(G.seAt('Twine', 70, 60), ep);
    } else if (this.unguardable(plan) && !e.comboStep) G.audio?.playSe(G.seAt('Darkness3', 70, 140), ep);
    this.updateTelegraph(e);
    G.coop?.onTelegraph?.(e);
  }
  // (a co-op guest) the mark of a move the host's enemy is winding up, as the host laid it down: drawn and filled here
  // as there (mine: aimed at this guest - a mark that follows follows me; other: at another guest, as seen here; else
  // at the host). The skill and a boss's move come with it: its body winds up as the host's does (bossBody)
  puppetTelegraph(e, plan, t0, mine, skill = null, other = null) {
    this.dropMarker(e);
    this.hideBlade(e);
    e.plan = plan; e.timer0 = e.timer = t0;
    plan.t0 = t0; plan.cap ||= { left: plan.hits || 1 };
    e.tgt = mine ? null : other || this.hostTarget;
    if (skill) { e.skill = skill; e.style = this.skillStyle(skill); }
    e.move = plan.move || null; e.act = null; e.moveT = 0; e.glinted = false; e.comboStep = 0;
    if (e.alive) e.state = 'windup';
    const look = this.markLook(plan);
    if (plan.shape === 'multi') {
      e.marker = new MarkerSet(this.root, plan.parts.map(p => ({ ...p, ...look })));
      plan.parts.forEach((p, i) => e.marker.list[i].setPose(p.x, p.y, p.z, p.aim || 0));
    } else if (plan.move !== 'leap' && plan.shape !== 'none') e.marker = new FloorMarker(this.root, { ...plan, ...look, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    if (plan.move === 'grab') {
      G.audio?.playSe(G.seAt('Stare', 90, 100), e.worldPos(new THREE.Vector3()));
      G.audio?.playSe(G.seAt('Twine', 70, 60), e.worldPos(new THREE.Vector3()));
    } else if (this.unguardable(plan)) G.audio?.playSe(G.seAt('Darkness3', 70, 140), e.worldPos(new THREE.Vector3()));
    this.updateTelegraph(e);
  }
  updateTelegraph(e) {
    const plan = e.plan, mk = e.marker;
    if (!plan || !mk) return;
    if (plan.shape === 'multi') { this.updateMulti(e); return; }
    if (plan.ground) {
      if (plan.follow || (plan.lockAt !== undefined && e.timer > plan.lockAt)) { const head = this.targetHead(e); plan.cx = head.x; plan.cz = head.z; }
      mk.setPose(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5), plan.cz, 0);
    } else if (plan.move === 'spin') {
      mk.setPose((e.fx + 0.5) * T, G.floorAt(e.fx, e.fy), (e.fy + 0.5) * T, 0);       // (a whirl goes with the boss)
    } else mk.setPose(plan.ox, plan.oy, plan.oz, plan.aim);
    // (a leap's mark fills from the moment it was laid down, in the air, to the landing)
    const from = plan.move === 'leap' ? plan.jumpAt || 0 : 0;
    mk.setProgress(e.state === 'act' ? 1 : e.timer0 ? (e.timer0 - e.timer - from) / Math.max(0.1, e.timer0 - from) : 1);
    if (this.unguardable(plan)) mk.edgeMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(G.time * 9));
    if (plan.move === 'grab' && e.state === 'windup') this.grabMotes(e, plan);
    // what it carries, rising from where it will land; the thing thrown leaves the hand to land as it strikes
    if (e.state === 'windup') {
      this.flavorMotes(e, plan);
      if (plan.lob && !plan.thrown && e.timer <= LOB_FLIGHT) this.throwLob(e, plan);
    }
  }
  flavorMotes(e, plan) {
    const c = this.skillFlavor(e.skill);
    if (!c || (plan.shape !== 'line' && !(plan.r > 0))) return;
    const area = plan.shape === 'circle' || plan.shape === 'ring' ? Math.PI * plan.r * plan.r : plan.shape === 'sector' ? plan.half * plan.r * plan.r : (plan.len || 4) * (plan.width || 1.4);
    if (Math.random() > Math.min(0.9, 0.12 + area * 0.012)) return;
    let x, z;
    if (plan.shape === 'line') {
      const t = Math.random() * (plan.len || 4), w = (Math.random() - 0.5) * (plan.width || 1.4), a = plan.aim ?? 0;
      x = plan.ox + Math.cos(a) * t - Math.sin(a) * w; z = plan.oz + Math.sin(a) * t + Math.cos(a) * w;
    } else {
      const ox = plan.ground ? plan.cx : plan.ox, oz = plan.ground ? plan.cz : plan.oz;
      const half = plan.shape === 'sector' ? plan.half : Math.PI;
      const r0 = plan.shape === 'ring' ? plan.r0 : 0;
      const a = (plan.shape === 'sector' ? plan.aim ?? 0 : 0) + (Math.random() * 2 - 1) * half;
      const r = Math.sqrt(r0 * r0 + Math.random() * (plan.r * plan.r - r0 * r0));
      x = ox + Math.cos(a) * r; z = oz + Math.sin(a) * r;
    }
    const y = G.floorAt(x / T - 0.5, z / T - 0.5) + 0.05;
    this.spawnGlow(new THREE.Vector3(x, y, z), { color: c, size: 0.07 + Math.random() * 0.07, life: 0.7 + Math.random() * 0.4, grow: 0.7,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.2), grav: plan.death ? 0.6 : -0.3 });
  }
  // the bottle / jar / mud leaves the thrower's hand to land on the marked spot as the wind-up ends
  throwLob(e, plan) {
    plan.thrown = true;
    const ep = e.worldPos(new THREE.Vector3());
    const from = new THREE.Vector3(ep.x, ep.y + e.h * 0.75, ep.z);
    const to = new THREE.Vector3(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5) + 0.15, plan.cz);
    const c = this.skillFlavor(e.skill) || 0xd8c8a0;
    const h = 1.2 + from.distanceTo(to) * 0.25;
    this.spawnGlow(from, { color: c, size: 0.22, life: Math.max(0.15, e.timer), grow: 1, arc: { from, to, h, trail: c } });
    G.audio?.playSe(G.seAt('Wind7', 60, 140), from);
  }
  dropMarker(e) {
    if (!e?.marker) return;
    G.coop?.onTelegraphEnd?.(e);
    this.fadingMarkers.push(e.marker);
    e.marker = null;
  }
  // is the player inside an attack area right now (world x/z) - never in one of a boss fight it did not join (co-op)
  playerInPlan(e, plan) {
    if (this.outOfFight(e)) return false;
    const head = G.player.headWorld(new THREE.Vector3());
    return this.pointInPlan(e, plan, head, 0.38);
  }
  // the companions standing in an attack area take it too (cap: how many times each may be hit by this move)
  strikeAlliesInPlan(e, s, plan, n = 1, cap = null) {
    for (const a of this.allies.struckable()) {
      if (!this.pointInPlan(e, plan, a.worldPos(new THREE.Vector3()), a.r)) continue;
      if (cap) { const k = cap.get(a) || 0; if (k >= (plan.hits || 1)) continue; cap.set(a, k + 1); }
      this.hitAlly(a, e, s, n, plan.ground ? { from: { x: plan.cx, z: plan.cz } } : {});
    }
  }
  // the companions near a point (a blow coming down on a spot)
  strikeAlliesNear(e, s, x, z, r, n = 1) {
    for (const a of this.allies.struckable()) {
      const p = a.worldPos(new THREE.Vector3());
      if (Math.hypot(p.x - x, p.z - z) > r + a.r) continue;
      this.hitAlly(a, e, s, n, { from: { x, z } });
    }
  }
  // a companion struck n times by one blow (thrown back by the first only - takeHit)
  hitAlly(al, e, s, n = 1, opts = {}) {
    if (al.remote) return;               // (a co-op guest judges the blows on itself, on its own side - coop.js)
    for (let i = 0; i < (n || 1); i++) this.later(i * 140, () => al.takeHit(e, s, i ? { push: 0 } : opts));
  }
  // is a point (world x/z, a body that wide) inside an attack area
  pointInPlan(e, plan, head, body) {
    // (where the area was laid down - it does not move with the enemy; a boss's whirl does)
    const ep = plan.ox !== undefined && plan.move !== 'spin' ? new THREE.Vector3(plan.ox, plan.oy, plan.oz) : e.worldPos(new THREE.Vector3());
    const aim = plan.aim ?? e.aim;
    if (plan.shape === 'ring') {
      const d = Math.hypot(head.x - ep.x, head.z - ep.z);
      return d >= plan.r0 - body && d <= plan.r + body;
    }
    if (plan.shape === 'multi') return (plan.parts || []).some(p => this.pointInPart(p, head, body));
    if (plan.shape === 'circle') {
      const c = plan.ground ? [plan.cx, plan.cz] : [ep.x, ep.z];
      return Math.hypot(head.x - c[0], head.z - c[1]) <= plan.r + body;
    }
    if (plan.shape === 'sector') {
      const d = Math.hypot(head.x - ep.x, head.z - ep.z);
      if (d > plan.r + body) return false;
      if (d < 0.7) return true;
      const a = Math.atan2(head.z - ep.z, head.x - ep.x);
      if (Math.abs(Math.atan2(Math.sin(a - aim), Math.cos(a - aim))) > plan.half + body / d) return false;
      // (a wall between them stops it)
      return this.clearRun(ep.x, ep.z, a, ep.y + 0.8, d) >= d - 0.4;
    }
    if (plan.shape === 'line') {
      // along the band, within its width
      const ux = Math.cos(aim), uz = Math.sin(aim), rx = head.x - ep.x, rz = head.z - ep.z;
      const along = rx * ux + rz * uz, side = Math.abs(rx * uz - rz * ux);
      return along >= -body && along <= plan.len + body && side <= plan.width / 2 + body;
    }
    return false;
  }
  // one part of a move laid down in several (a circle of a rain, an arm of a cross)
  pointInPart(p, head, body) {
    if (p.shape === 'circle') return Math.hypot(head.x - p.x, head.z - p.z) <= p.r + body;
    const ux = Math.cos(p.aim), uz = Math.sin(p.aim), rx = head.x - p.x, rz = head.z - p.z;
    const along = rx * ux + rz * uz, side = Math.abs(rx * uz - rz * ux);
    return along >= -body && along <= p.len + body && side <= p.width / 2 + body;
  }
  executeAttack(e, distM, dx, dy) {
    const skill = e.skill;
    G.coop?.onEnemyAct?.(e, skill);
    // (a co-op guest's copy of the host's enemy only shows its move: what it does is done on the host's side)
    if (!e.puppet && !(e.move === 'flurry' && e.comboStep > 0)) this.runSkillCommonEvents(skill);     // (a flurry is one use of it)
    const plan = e.plan || this.planAttack(e, skill, e.style);
    // (from where its area was laid down)
    const ep = plan?.ox !== undefined ? new THREE.Vector3(plan.ox, plan.oy, plan.oz) : e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);
    const hits = plan?.hits || 1;
    const certain = !!plan?.certain;
    if (skill.animation_id > 0) this.playEnemyActionAnim(e, skill, plan, ep, head);
    switch (e.style) {
      case 'melee': case 'area': case 'projectile': case 'debuff': {
        if (plan && !plan.shot) {
          if (plan.ground) this.spawnGlow(new THREE.Vector3(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5) + 0.3, plan.cz), { color: plan.death ? 0x6a20c0 : (plan.lob && this.skillFlavor(skill)) || (certain ? 0xb050ff : 0xff7030), size: plan.r * 2.2, life: 0.35, grow: 1.1 });
          if (this.playerInPlan(e, plan)) {
            for (let i = 0; i < hits; i++) this.later(i * 160, () => this.enemyStrikePlayer(e, skill, { blockable: plan.blockable, certain, parry: this.parryable(plan) }));
          } else G.audio?.playSe(G.seAt(plan.ground ? 'Explosion1' : 'Wind7', 60, 120), plan.ground ? new THREE.Vector3(plan.cx, head.y, plan.cz) : ep);
          this.strikeAlliesInPlan(e, skill, plan, hits);
          if (e.style === 'area' && !plan.ground) G.audio?.playSe(G.seAt('Earth4', 80, 100), ep);
          break;
        }
        // a shot: flies fast along the telegraphed line (sure-hit shots home in hard)
        const from = ep.clone(); from.y = ep.y + e.h * 0.6;
        const aim = plan?.aim ?? e.aim;
        const look = this.skillLook(skill), gun = look === 'gun', fast = gun || look === 'knife';
        for (let i = 0; i < hits; i++) {
          this.later(i * 180, () => {
            if (!e.alive) return;
            const dir = new THREE.Vector3(Math.cos(aim), 0, Math.sin(aim));
            const to = this.targetHead(e); to.y -= 0.25;
            dir.y = (to.y - from.y) / Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
            this.spawnProjectile(from, dir, { speed: fast ? GUN_SPEED : 13, color: certain ? 0xb050ff : fast ? 0xfff0c0 : this.skillColor(skill), enemy: e, skill, homing: certain ? 4 : fast ? 0.05 : 0.15, certain, aimAt: e.tgt || null, pierce: !!plan?.pierce, ghost: !!e.puppet });
            // (a gun: the flash at the muzzle; a gun or a thrown knife: the streak along its line)
            if (gun) this.spawnGlow(from.clone().addScaledVector(dir, 0.3), { color: 0xffd890, size: 0.45, life: 0.09, grow: 1.8 });
            if (fast) this.spawnTracer(from, from.clone().addScaledVector(dir.clone().normalize(), Math.min(plan?.len || 12, 12)), 0xfff0c0);
          });
        }
        if (!fast) G.audio?.playSe(G.seAt('Magic1', 70, 110), ep);
        break;
      }
      case 'buff':
        if (e.puppet) break;
        this.applySkillToSelf(e, skill);
        // a boss's quick step (회피, 절영, 롤링 회피...): gone, and there again beside or behind the player
        if (e.boss && /회피|절영|재빠르|순간 ?이동|사라졌|回避|絶影|素早|瞬間移動|消え|\b(?:evade|evasion|dodge|blink|vanish|teleport)/i.test(`${skill.name} ${skill.message1 || ''}`)) this.blink(e);
        break;
      case 'heal': {
        if (e.puppet) break;
        this.applySkillToSelf(e, skill);
        // (after the recovery rules on it: 허약 - a 반불사 버섯 thrown at it - stops it, 천수 영역 turns it)
        const v = e.b.healAmount(Math.max(1, Math.floor(evalFormula(skill.damage.formula, e.b, e.b))));
        e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar();
        this.popup(new THREE.Vector3(ep.x, ep.y + e.h, ep.z), v > 0 ? `+${v}` : String(v), v > 0 ? '#60ff80' : '#9a9a9a');
        if (v < 0) this.checkEnemyDeath(e);
        break;
      }
      default: break;
    }
  }

  // An enemy action's animation plays where it lands, as big as its area (the marker on the floor): a swing
  // over the cone in front of the enemy, a blast all over its circle (copies around a wide one; not in the
  // middle when the player stands there), a spell cast on itself on the enemy. A shot's plays where the shot
  // ends (updateProjectiles)
  playEnemyActionAnim(e, skill, plan, ep, head) {
    const id = skill.animation_id;
    if (plan?.shot) return;
    if (!plan || !['melee', 'area', 'projectile', 'debuff'].includes(e.style)) {
      G.screen.playAnimationOn(new THREE.Vector3(ep.x, ep.y + e.h * 0.5, ep.z), id, { world: true, size: this.enemySize(e) * 1.2 });
      return;
    }
    const floorY = (x, z) => G.floorAt(x / T - 0.5, z / T - 0.5);
    if (plan.shape === 'sector') {
      const d = plan.r * 0.5, a = plan.aim ?? e.aim;
      const c = new THREE.Vector3(ep.x + Math.cos(a) * d, ep.y + e.h * 0.5, ep.z + Math.sin(a) * d);
      G.screen.playAnimationOn(c, id, { world: true, size: THREE.MathUtils.clamp(2.4 * d * Math.sin(Math.min(plan.half, 1.2)), 1.6, 4) });
      return;
    }
    const cx = plan.ground ? plan.cx : ep.x, cz = plan.ground ? plan.cz : ep.z, r = plan.r;
    const n = THREE.MathUtils.clamp(Math.round(2 * Math.PI * r * 0.7 / 3.2), 3, 7);
    const copies = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (e.aim || 0);
      const x = cx + Math.cos(a) * r * 0.7, z = cz + Math.sin(a) * r * 0.7;
      copies.push({ pos: new THREE.Vector3(x, floorY(x, z) + 1.0, z), size: Math.min(3.2, r * 0.85) });
    }
    const inMiddle = Math.hypot(head.x - cx, head.z - cz) < 1.4;
    G.screen.playAnimationOn(new THREE.Vector3(cx, floorY(cx, cz) + 1.0, cz), id, { world: true, size: Math.min(2 * r, 6), copies, centerVisual: !inMiddle });
  }

  updateProjectiles(dt, paused) {
    if (paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    // (enemy shots come round toward the upper chest, as they are aimed, not the middle of the head: a sure-hit shot
    // homing in hard on the head went over a shield held in front of the chest)
    const chest = head.clone(); chest.y -= 0.25;
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.owner === 'enemy' && p.homing) {
        const to = p.aimAt?.stands && p.aimAt.alive ? p.aimAt.chest(new THREE.Vector3()) : chest;
        const want = to.clone().sub(p.mesh.position).normalize().multiplyScalar(p.speed);
        p.vel.lerp(want, Math.min(1, p.homing * dt));
      }
      // (an orb sets off slowly, gathering speed, and comes round after its target turning at most steer rad/s -
      // from 1.3 m off it goes straight on: a step aside at the last moment lets it by)
      if (p.owner === 'enemy' && p.steer && !p.committed) {
        const to = p.aimAt?.stands && p.aimAt.alive ? p.aimAt.chest(new THREE.Vector3()) : chest;
        const want = to.clone().sub(p.mesh.position);
        if (p.accel) p.speed = Math.min(p.maxSpeed, p.speed + p.accel * dt);
        if (want.length() < 1.3) { p.committed = true; p.vel.setLength(p.speed); }
        else {
          const v = p.vel.clone().normalize(), w = want.normalize(), ang = Math.acos(THREE.MathUtils.clamp(v.dot(w), -1, 1));
          if (ang > 1e-4) {
            const q = new THREE.Quaternion().setFromUnitVectors(v, w);
            v.applyQuaternion(new THREE.Quaternion().slerp(q, Math.min(1, p.steer * dt / ang)));
          }
          p.vel.copy(v.multiplyScalar(p.speed));
        }
      }
      if (p.target && p.target.alive) {
        // a spell aimed at someone bends a little toward them
        const aim = p.target.worldPos(new THREE.Vector3()); aim.y += p.target.h * 0.6;
        p.vel.lerp(aim.sub(p.mesh.position).normalize().multiplyScalar(p.speed), Math.min(1, 3 * dt));
      }
      if (p.gravity) {
        p.vel.y -= p.gravity * dt;
        const left = p.landAt - G.time;
        if (p.track?.alive && left > 0.05) {
          const at = p.track.worldPos(tmpB);
          p.vel.x = (at.x - p.mesh.position.x) / left;
          p.vel.z = (at.z - p.mesh.position.z) / left;
        }
      }
      if (p.dest && p.mesh.position.distanceTo(p.dest) < 0.45) p.life = 0;   // an area spell reached its spot
      if (p.mesh.userData.spin) p.mesh.material.rotation += dt * 12;
      const steps = p.fine ? Math.max(1, Math.ceil(p.vel.length() * dt / 0.15)) : 1;
      for (let k = 0; k < steps; k++) {
        p.mesh.position.addScaledVector(p.vel, dt / steps);
        this.projectileStep(p, head);
        if (p.life <= 0) break;
      }
      if (p.align && p.vel.lengthSq() > 1e-6) p.mesh.quaternion.setFromUnitVectors(FORWARD, tmpA.copy(p.vel).normalize());
      if (p.tumble) p.mesh.rotateOnAxis(TUMBLE_AXIS, dt * 9);
    }
    this.finishProjectiles();
  }
  // a projectile at its new spot: walls, the floor, and whoever it meets
  projectileStep(p, head) {
    {
      const pos = p.mesh.position;
      // walls
      const tx = pos.x / T - 0.5, ty = pos.z / T - 0.5;
      const g = G.map.grid;
      if (!g.valid(Math.round(tx), Math.round(ty)) || pos.y < G.floorAt(tx, ty) - 0.05) { p.life = 0; p.landed = true; }
      // walls: nothing flies through them (the cell it was fired from does not count)
      const cx = Math.round(tx), cy = Math.round(ty);
      if (p.startCell === undefined) p.startCell = cx + cy * g.w;
      if (cx + cy * g.w !== p.startCell && pos.y < (G.solidTopAt?.(cx, cy) ?? -Infinity) * T - 0.05) { p.life = 0; p.landed = true; }
      // (a co-op guest's copy of a shot of the host's enemy strikes this player as any shot does - below; at the other
      // player it went for - the host, another guest - it is gone: what it does there is that player's to judge)
      const away = p.ghost && p.aimAt?.away && p.aimAt.stands ? p.aimAt.chest(new THREE.Vector3()) : null;
      if (p.owner === 'enemy' && away && pos.distanceTo(away) < 0.5) {
        p.life = 0; p.struck = true;
        this.spawnGlow(pos, { color: p.certain ? 0xb050ff : this.skillColor(p.skill), size: 0.4, life: 0.15, grow: 1.6 });
      } else if (p.owner === 'enemy') {
        // a shot is stopped only where it actually meets the shield (one that goes through a guard passes it)
        let shielded = false;
        if (this.shield && this.hasShield && (G.vr || this.shield.visible) && (!p.pierce || (this.guardUp && !this.disarmed && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD))) {
          if (G.vr) this.shield.getWorldPosition(tmpA);
          else desktopShieldGuardPoint(tmpA, G.three.camera, this.deskShieldT || 0);
          if (pos.distanceTo(tmpA) < 0.32) shielded = true;
        }
        // (the shots of a fan hit no more times than their skill does)
        const spent = p.cap && p.cap.left <= 0;
        if (shielded) {
          p.life = 0; p.struck = true;
          if (!spent) { if (p.cap) p.cap.left--; this.enemyStrikePlayer(p.enemy, p.skill, { kind: 'projectile', certain: p.certain, shieldHit: true }); }
          if (p.skill?.animation_id > 0) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, visual: false });
        } else if (pos.distanceTo(head) < 0.5 || (Math.hypot(pos.x - head.x, pos.z - head.z) < 0.42 && pos.y < head.y && pos.y > G.floorAt(tx, ty) + 0.2)) {
          p.life = 0; p.struck = true;
          // PC: no hands to hold a shield up, so the old facing-based guard still works there
          if (!spent) { if (p.cap) p.cap.left--; this.enemyStrikePlayer(p.enemy, p.skill, { blockable: !G.vr && !p.pierce, parry: !G.vr && !!p.pierce, kind: 'projectile', certain: p.certain }); }
          // on the player: its sounds, and a burst where it struck rather than its drawing in the eyes
          if (p.skill?.animation_id > 0) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, visual: false });
          this.spawnGlow(pos, { color: p.certain ? 0xb050ff : this.skillColor(p.skill), size: 0.5, life: 0.18, grow: 1.8 });
        } else {
          // a companion it meets (a co-op guest: it flies on - the guest judges it on its own side)
          for (const al of this.allies.struckable()) {
            if (al.remote) continue;
            const ap = al.chest(new THREE.Vector3());
            if (Math.hypot(pos.x - ap.x, pos.z - ap.z) < al.r + 0.15 && pos.y > ap.y - al.h * 0.6 && pos.y < ap.y + al.h * 0.5) {
              p.life = 0; p.struck = true;
              if (!spent) { if (p.cap) p.cap.left--; al.takeHit(p.enemy, p.skill, { dir: [p.vel.x, p.vel.z] }); }
              if (p.skill?.animation_id > 0) G.screen.playAnimationOn(pos.clone(), p.skill.animation_id, { world: true, size: 1.4 });
              break;
            }
          }
        }
      } else if (p.owner === 'peer') {
        // (another player's shot, as shown here: it stops at one of this world's enemies - or, PvP, at this player - and
        // its animation plays there; what it does was judged on its own side)
        if ((p.by ? !!G.coop?.pvpWithId?.(p.by) : !!G.coop?.pvpAny) && pos.distanceTo(tmpB.copy(head).setY(head.y - 0.25)) < 0.35) { p.life = 0; p.hit = true; return; }
        for (const e of this.allTargets()) {
          const wp = e.worldPos(tmpA); wp.y += e.hover || 0;
          if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < e.hr * T + 0.1 && pos.y > wp.y && pos.y < wp.y + e.h) {
            p.life = 0; p.hit = true;
            if (p.anim > 0 && !p.aoe) G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + e.h * 0.5, wp.z), p.anim, { rate: 3, height: e.h });
            break;
          }
        }
      } else {
        // (PvP: another player in its way - a weapon's shot, a spell, a thrown thing (an area one bursts there); not a
        // Break)
        if (!p.breakSkill && G.coop?.pvpAny) {
          const t = G.coop.pvpTargets().find(c => Math.hypot(pos.x - c.x, pos.z - c.z) < c.r + 0.1 && pos.y > c.y && pos.y < c.y + c.h);
          if (t) {
            p.life = 0; p.hit = true;
            if (!p.usable) this.strikePlayer(t, { power: p.power });
            else if (!p.aoe) this.strikePlayerWith(t, p.usable, { one: p.one });
            return;
          }
        }
        for (const e0 of this.allTargets()) {
          const wp = e0.worldPos(tmpA); wp.y += e0.hover || 0;
          if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < e0.hr * T + 0.1 && pos.y > wp.y && pos.y < wp.y + e0.h) {
            const e = this.partAt(e0, pos);              // (a picture shared by a mount and its rider: the part it strikes)
            p.life = 0;
            p.hit = true;
            if (p.aoe) break;                         // area spells burst below
            if (p.usable) {
              // (a round of a skill's shot is one hit of it, and the skill's animation comes once for all its rounds)
              const n = p.one ? 1 : Math.max(1, Math.min(5, p.usable.repeats || 1));
              for (let r = 0; r < n; r++) this.later(r * 120, () => this.applyUsableToEnemy(e, p.usable, pos));
              if (p.usable.animation_id > 0 && !p.volley?.shown) G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + e.h * 0.5, wp.z), p.usable.animation_id, { rate: 3, height: e.h });
              if (p.volley) p.volley.shown = true;
            } else if (p.breakSkill && (this.breakCooldown || 0) <= G.time) this.breakOnHit(e, p.breakSkill, pos);
            else {
              this.playerHitEnemy(e, p.power, false, pos, { one: p.one });
              if (p.staff) p.burstAt = e.worldPos(new THREE.Vector3());       // (its blow and its reach landed there: staffBurst shows it)
            }
            break;
          }
        }
      }
    }
  }
  finishProjectiles() {
    this.projectiles = this.projectiles.filter(p => {
      if (p.life > 0) return true;
      if (p.staff && !p.burst) { p.burst = true; this.staffBurst(p); }
      if (p.aoe && p.usable && !p.burst) { p.burst = true; this.burstUsable(p.usable, p.mesh.position.clone(), p.aoe); }
      else if (p.gravity && p.usable && !p.hit && !p.aoe) this.landThrown(p);
      else if (p.owner === 'peer') this.peerShotEnds(p);
      // an enemy's shot that missed: its animation where it ended (a wall, the floor, out of range)
      if (p.owner === 'enemy' && !p.struck && p.skill?.animation_id > 0) G.screen.playAnimationOn(p.mesh.position.clone(), p.skill.animation_id, { world: true, size: 1.6 });
      this.root.remove(p.mesh);
      if (p.mesh.isSprite) { p.mesh.material.map?.dispose(); p.mesh.material.dispose(); }
      else if (p.mesh.userData.thrown) p.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      return false;
    });
  }
  allTargets() {
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean), [...this.puppets.values()])
      .filter(e => e.mesh && e.alive && !e.hidden && !e.untargetable && !this.outOfFight(e));
  }
  // (co-op) fallen and watching a boss fight: what this player holds, and its hands, as a shade
  setGhostly(on) {
    for (const root of [this.weapon, this.shield, G.hands?.models?.left?.root, G.hands?.models?.right?.root]) {
      root?.traverse?.(o => {
        if (!o.material) return;
        for (const m of [].concat(o.material)) {
          if (on) { if (m.userData.ghostOf === undefined) m.userData.ghostOf = [m.transparent, m.opacity]; m.transparent = true; m.opacity = 0.3; }
          else if (m.userData.ghostOf) { [m.transparent, m.opacity] = m.userData.ghostOf; delete m.userData.ghostOf; }
          m.needsUpdate = true;
        }
      });
    }
  }
  // (co-op) an enemy of a boss fight this player is out of - never joined, or watching it fallen: it and this player
  // never touch each other (a guest's copy is told so by the host; the host's own, by who is in the fight)
  outOfFight(e) {
    if (!e) return false;
    if (e.puppet) return !!e.outOfFight;
    return !!e.battle?.coopIn && !!G.coop?.hostOutOf?.(e.battle);
  }

  // ---- co-op (coop.js): the host's enemies for its guests, and what the guests' blows do to them ------------------
  // the enemies a host's guests see: the bodies standing or falling on this map
  netEnemies() {
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean)).filter(e => e.mesh && e.state !== 'dead' && !e.private);
  }
  // (guest) the host's enemies as just sent: a body for each (made, changed or put away to match), where the host's
  // is, as hurt and as broken as it is - except what a blow of this guest's changed a moment ago and the host has not
  // taken yet (it would flicker back)
  applyPuppets(list, src = null) {
    // (src: a player whose hallucinations these are - coop.js onHallEnemies - kept apart from the map runner's)
    const seen = new Set(), keyOf = id => (src ? `h:${src}:${id}` : id);
    for (const n of list) {
      if (n.keep) { seen.add(keyOf(n.keep)); continue; }          // (its entry was not taken this time: as it was)
      seen.add(keyOf(n.id));
      let e = this.puppets.get(keyOf(n.id)), lookAs = 0;
      if (e && e.b.enemyId !== n.enemyId) {
        // (into a form with no picture from one with a picture: up in the sky, as the form it was - transformEnemy)
        const was = e.lookAs || e.b.enemyId;
        if (!$data.enemies[n.enemyId]?.battler_name && $data.enemies[was]?.battler_name) lookAs = was;
        e.remove(); e = null;
      }
      // (a player of the host's stage play - 8 - is drawn as the play draws it, by its place in the troop: one that
      // came into the play, or into another place in it, is drawn anew)
      const inPlay = !!(n.flags & 8);
      if (e && (!!e.inPlay !== inPlay || (inPlay && e.memberIndex !== n.mi))) { e.remove(); e = null; }
      if (!e) {
        e = new ActionEnemy(this, null, n.enemyId, n.fx, n.fy, { dormant: true, inPlay, memberIndex: n.mi, lookAs });
        e.puppet = true; e.netId = n.id;
        if (src) { e.src = src; e.private = true; }
        this.puppets.set(keyOf(n.id), e);
      }
      if (src) e.hallKey = n.hallKey;
      e.netFlags = n.flags;
      e.netX = n.fx; e.netY = n.fy; e.hover = n.hover;
      if (!this.puppetMoves(e)) e.lift = n.lift;             // (a leap going on here lifts it itself)
      e.hidden = !!(n.flags & 1);
      e.battle = n.flags & 2 ? this.puppetBattle : null;
      // (a roaming boss whose fight has not begun: out of this guest's reach unless the rules let a guest begin it; one
      // of a boss fight this guest did not join: neither strikes the other - 128)
      e.outOfFight = !!(n.flags & 128);
      e.noTarget = !!(n.flags & 4) || (!!(n.flags & 64) && !G.coop?.rules?.guestStartsBoss) || e.outOfFight;
      e.boss = !!(n.flags & 32);
      e.statusBuffs = n.statusBuffs ?? null;
      // (a boss made stronger for its co-op fight - coop.js scaleBosses: its HP, MP and groggy gauge as big as there)
      if ((e.b.coopK || 1) !== n.k) { e.b.coopK = n.k; e.grogId = null; }
      const fresh = G.time - (e.netReported ?? -9) < 0.6;
      const dying = n.state === 'dying' || n.state === 'dead';
      if (dying) {
        if (e.state !== 'dying' && e.state !== 'dead') { this.puppetEnd(e); e.state = 'dying'; e.timer = 0; e.fadeOnly = !!(n.flags & 16); if (e.bar) e.bar.visible = false; }
      } else {
        if (e.state === 'dying' || e.state === 'dead') {
          e.group.visible = true;
          if (e.mat) { e.mat.opacity = 1; e.mat.color.setRGB(1, 1, 1); }
          if (e.mesh) e.mesh.position.y = 0;
        }
        // (a move of the host's going on here plays out - unless the host's was cut short: broken, fallen)
        const own = e.state === 'act' && !!e.act && G.time < (e.actUntil || 0) && n.state !== 'stagger';
        if ((!fresh && !own) || e.state === 'dying' || e.state === 'dead') {
          e.state = n.state;
          if (n.state !== 'windup' && n.state !== 'act' && (e.move || e.act || e.marker)) this.puppetEnd(e);
        }
        // (a plain shot winding up turns after its target there: its line here too)
        if (n.aim !== null && e.state === 'windup' && e.plan?.shot && !e.move && e.plan.ox !== undefined) this.aimShot(e, n.aim);
        e.b.hp = fresh ? Math.min(e.b.hp, n.hp) : n.hp;
        if (!fresh) e.b.states = n.states.slice();
        const gmax = this.groggyMax(e);
        if (gmax && !fresh) e.grog = gmax * n.grog / 100;
        if (e.bar) e.bar.visible = !!e.battle && !e.hidden;
      }
      e.drawBar();
      e.netBase = this.puppetSnap(e);
    }
    for (const [id, e] of this.puppets) if ((e.src || null) === src && !seen.has(id)) { e.remove(); this.puppets.delete(id); }
  }
  puppetSnap(e) { return { hp: e.b.hp, states: [...e.b.states], grog: e.grog || 0, state: e.state }; }
  // (guest) what this guest's own blows, shots and spells did to the host's enemies since the last look - every frame:
  // nothing else changes a puppet. [{ id, d: HP taken, add / rm: states, g: groggy taken, brk: a Break (7 / 8), big: the
  // big attack that ends one }]
  puppetReports() {
    const out = [];
    for (const e of this.puppets.values()) {
      const b = e.netBase;
      if (!b || e.state === 'dying' || e.state === 'dead') continue;
      const now = this.puppetSnap(e);
      const brk = now.state === 'stagger' && b.state !== 'stagger' ? (now.states.includes(7) ? 7 : 8) : 0;
      const big = b.state === 'stagger' && now.state !== 'stagger';
      const skip = id => id === 1 || ((brk || big) && (id === 7 || id === 8));
      const add = now.states.filter(id => !b.states.includes(id) && !skip(id));
      const rm = b.states.filter(id => !now.states.includes(id) && !skip(id));
      const d = Math.round(b.hp - now.hp), g = Math.round(Math.max(0, b.grog - now.grog));
      if (d || add.length || rm.length || g > 0 || brk || big) {
        out.push({ id: e.netId, src: e.src || null, d, add, rm, g, brk, big });
        e.netReported = G.time;
      }
      e.netBase = now;
    }
    return out;
  }
  // (host) a guest's blow on one of this world's enemies: taken as if it had struck here - its numbers in the friend's
  // colour, the fight started if it was roaming, a Break, the groggy gauge, states, the fall
  applyGuestHit(r, from = null) {
    const e = this.netEnemies().find(x => x.netId === r.id) || this.hallEnemyFor(r.id, from);
    if (!e || !e.alive || e.hidden) return false;
    // (a boss fight that guest did not join, or watches fallen)
    if (e.battle?.coopIn && (!e.battle.coopIn.has(from) || e.battle.coopDead?.has(from))) return false;
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      // (a roaming boss: a guest's blow begins its fight only by the server's rules - else the host goes in first)
      if (sym && !G.coop?.rules?.guestStartsBoss && this.symbolIsBoss(sym)) return false;
      if (sym && this.leadBoss(sym)) { this.engage(sym.ev, true); return false; }      // (the host is asked first)
      if (sym) this.engage(sym.ev, true);
    }
    const p = e.worldPos(new THREE.Vector3());
    if (r.d) {
      const d = Math.max(-e.b.mhp, Math.min(e.b.mhp, r.d));
      e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp - d));
      e.flash = 0.18; if (e.bar) e.bar.visible = true;
      if (d > 0) {
        this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(d), '#bfe4ff');
        G.audio?.playSe(G.seAt('Slash1', 70, 100), new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z));
        this.damageRemovesStates(e);
      }
    }
    for (const id of r.add) if ($data.states[id] && !e.b.stateResist(id)) this.addEnemyState(e, id, true);
    for (const id of r.rm) { e.b.removeState(id); if (e.stateTimers) delete e.stateTimers[id]; }
    if (r.g > 0 && this.groggyMax(e) && e.state !== 'stagger') {
      e.grog = Math.max(0, e.grog - Math.min(r.g, GROGGY.cap * e.grogMax));
      e.grogT = G.time;
      if (e.grog <= 0) e.grogDown = true;
    }
    if (r.brk && e.state !== 'stagger') this.breakEnemy(e, r.brk);
    if (r.big) this.endStagger(e);
    e.drawBar();
    this.checkEnemyDeath(e);
    return true;
  }
  // (the developer's world) a hallucination this player runs that the one who struck it sees too
  hallEnemyFor(id, from) {
    if (!G.coop?.world || !from) return null;
    return this.enemies.concat([...this.symbols.values()].map(s => s.enemy).filter(Boolean))
      .find(e => e.private && e.netId === id && e.mesh && e.state !== 'dead' && G.coop.peerSees(from, e.hallKey)) || null;
  }
  // (guest) a copy of the host's enemy moving here on its own, as the host's does there: through the air in a leap, in
  // a charge and the bounce back off what it ran into (anywhere else it is eased to where the host says it is)
  puppetMoves(e) {
    return (e.state === 'windup' && e.move === 'leap' && !!e.plan?.jumped) || (e.state === 'act' && (e.act?.kind === 'dash' || e.act?.kind === 'recoil'));
  }
  // (guest) the host's enemy's move is over (or was cut short): so is its copy's
  puppetEnd(e) {
    this.dropMarker(e);
    this.hideBlade(e);
    e.move = null; e.act = null; e.plan = null;
  }
  // (guest) a boss's move of the host's goes off: here as there, but only to be seen - whom it strikes the host says
  // (onHurt). A move made of parts needs them; a flurry is plain blows (puppetAct)
  puppetRelease(e) {
    const plan = e.plan, fam = e.move;
    if (!plan || !fam || fam === 'flurry' || !e.alive || e.state !== 'windup') return false;
    if (['rain', 'volley', 'dice', 'cross', 'field', 'chess', ...PART_MOVES].includes(fam) && !Array.isArray(plan.parts)) return false;
    if (['pursuit', 'orbs'].includes(fam) && !(plan.n > 0)) return false;
    e.timer = 0;
    e.actUntil = G.time + 3.5;
    this.releaseBossMove(e);
    return true;
  }
  // (guest) up in the air: where the host's boss comes down, marked from now on (as the host's own updateLeap does)
  puppetLeap(e, at) {
    const plan = e.plan;
    if (!plan || e.move !== 'leap' || plan.jumped || e.state !== 'windup') return false;
    Object.assign(plan, { jumped: true, sx: at.sx, sy: at.sy, jumpAt: at.j, height: at.h, cx: at.cx, cz: at.cz });
    this.dropMarker(e);
    e.marker = new FloorMarker(this.root, { ...plan, color: MARK.heavy, label: plan.hits > 1 ? `×${plan.hits}` : '' });
    const ep = e.worldPos(new THREE.Vector3());
    G.audio?.playSe(G.seAt('Jump1', 90, 70), ep);
    G.audio?.playSe(G.seAt('Wind4', 70, 80), ep);
    return true;
  }
  // (guest) the host's charging boss ran into the host there: it stops and bounces back here too
  puppetImpact(e, fx, fy) {
    if (!e.alive) return;
    const aim = e.plan?.aim ?? e.aim ?? 0;
    const a = e.act?.kind === 'dash' ? e.act : { ca: Math.cos(aim), sa: Math.sin(aim) };
    e.fx = fx; e.fy = fy;
    e.state = 'act'; e.move ||= 'charge'; e.actUntil = G.time + 2;
    this.chargeImpact(e, a, false);
  }
  // (guest) one of the host's enemies does its plain move (a blow, a blast, a shot): its animation, its sounds, its shots
  // flying - only to be seen (aim: where a shot's line turned to by the end)
  puppetAct(e, skill, aim = null) {
    if (!e.alive) return;
    e.skill = skill; e.style = this.skillStyle(skill);
    if (aim !== null && e.plan?.shot) { e.plan.aim = aim; e.aim = aim; }
    try { this.executeAttack(e, 0, 0, 0); } finally { this.dropMarker(e); }
  }

  // ---- player attacks -----------------------------------------------------------------------
  updatePlayerAttack(dt) {
    if (!this.weapon || this.gripAdjust || this.ready || this.held || this.disarmed || this.restrained || this.spectating) { this.charge = null; this.deskCharge = null; return; }
    const ranged = this.weapon.userData.ranged;
    if (G.vr) {
      // swing detection
      const base = tmpA, tip = tmpB;
      this.weaponSegment(base, tip);
      // recent tip positions: a hit needs a real swing (fast AND a long enough arc), not a flick. Speed
      // and arc count the arm's motion only (the tip seen from the body), so walking, running or turning
      // with the weapon held still never swings it; what it hits is still found along its real path
      const rel = bodyRelative(tip, new THREE.Vector3());
      // charging: the trigger held with a blade (not pointing at a menu) makes the next blow that lands heavier
      this.updateCharge(dt, !ranged && G.input.xrHeld('right', 0) && !G.ui.pointerTarget);
      const hist = this.tipHist || (this.tipHist = []);
      hist.push({ t: G.time, p: rel });
      while (hist.length > 2 && G.time - hist[0].t > 0.14) hist.shift();
      if (this.hasPrev) {
        const speed = rel.distanceTo(this.prevRel) / Math.max(dt, 1e-3);
        const travel = rel.distanceTo(hist[0].p);
        const level = SWING_LEVELS[G.settings.swingLevel ?? 2] || SWING_LEVELS[2];
        // a fist moves slower and shorter than a blade's tip
        const [needSpeed, needTravel] = this.weapon.userData.unarmed ? [level[0] * 0.65, level[1] * 0.6] : level;
        if (speed > needSpeed && travel > needTravel) {
          const power = THREE.MathUtils.clamp(0.6 + (speed - needSpeed) / 5, 0.6, 1.4) * (this.stamina > 0.1 ? 1 : 0.5);
          const charge = this.charge?.level || 0, strong = speed > needSpeed * 1.5;
          let landed = false;
          for (const e of this.allTargets()) {
            if (e.hitCooldown > 0) continue;
            if (this.segmentHitsEnemy(e, this.prevBase, this.prevTip, base, tip)) {
              e.hitCooldown = 0.45;
              landed = true;
              const brk = this.breakArmed();
              if (brk) this.breakOnHit(e, brk, this.prevTip);
              else {
                const crit = speed > needSpeed + 4.5 && Math.random() < 0.35 + (G.state.party.leader()?.cri || 0);
                this.playerHitEnemy(e, power, crit, this.prevTip, { melee: true, strong, charge });
              }
              G.input.haptic('right', 0.9, 70);
              this.stamina = Math.max(0, this.stamina - (charge >= 0.35 ? 0.25 : 0.1)); this.staminaDelay = 0.8;
            }
          }
          if (landed && this.charge && charge >= 0.35) { this.charge.spent = true; this.charge.level = 0; }
          const pb = this.prevBase.clone(), pt = this.prevTip.clone(), cb = base.clone(), ct = tip.clone();
          this.swingAtNpcs(c => this.segmentHitsCylinder(c, pb, pt, cb, ct));
          this.clashWithPlayers(pb, pt, cb, ct, { strong: strong || charge >= 0.35 });   // (PvP: another's weapon or shield first)
          this.swingAtPlayers(c => this.segmentHitsCylinder(c, pb, pt, cb, ct), { power, strong, charge, crit: speed > needSpeed + 4.5 });
        }
      }
      this.prevBase.copy(base); this.prevTip.copy(tip); this.prevRel.copy(rel); this.hasPrev = true;
      if (G.input.breakPressed() && !G.ui.consumedConfirm) this.pressBreak();
      this.showBreakReady(tip);
      if (ranged && G.input.xrPressed('right', 0) && this.rangedCooldown <= 0 && !G.ui.pointerTarget) this.fireRanged();
    } else {
      // desktop: click to swing - hold the click to charge, the swing comes on letting go (ranged weapons shoot)
      if (G.input.attackPressed() && !this.swing && this.stamina > 0.05) {
        if (ranged) { if (this.rangedCooldown <= 0) this.fireRanged(); }
        else this.deskCharge = G.time;
      }
      if (this.deskCharge != null && !G.input.mouseHeld(0)) {
        const charge = THREE.MathUtils.clamp((G.time - this.deskCharge - 0.15) / 1.0, 0, 1);
        this.deskCharge = null;
        if (!this.swing && this.stamina > 0.05) {
          this.swing = { t: 0, hit: new Set(), charge, duration: 0.32 / playerRecoveryRate(G.state.party.leader()) };
          this.stamina = Math.max(0, this.stamina - (charge >= 0.35 ? 0.25 : 0.12)); this.staminaDelay = 0.7;
          G.audio?.playSe(G.seAt('Wind7', 60, charge >= 0.35 ? 100 : 140));
        }
      }
      if (G.input.breakPressed()) this.pressBreak();
      if (this.swing) {
        const s = this.swing;
        const duration = s.duration || 0.32, before = Math.min(1, s.t / duration);
        s.t += dt;
        const k = Math.min(1, s.t / duration);
        desktopSwing(this.weapon, k, G.three.camera);
        // A short recovery can cross the whole hit window in one rendered frame.
        if (before < 0.7 && k > 0.25) {
          const head = G.player.headWorld(new THREE.Vector3());
          const f = G.player.forwardVec();
          const reach = this.weaponLength() + 0.9;
          for (const e of this.allTargets()) {
            if (s.hit.has(e)) continue;
            const wp = e.worldPos(new THREE.Vector3());
            const to = new THREE.Vector3(wp.x - head.x, 0, wp.z - head.z);
            const d = to.length() - e.hr * T;
            if (e.pair && this.partAt(e, head.clone().addScaledVector(f, to.length())) !== e) continue;
            if (d < reach && to.normalize().dot(f) > 0.45) {
              s.hit.add(e);
              const brk = this.breakArmed();
              if (brk) this.breakOnHit(e, brk, head);
              else this.playerHitEnemy(e, this.stamina > 0.1 ? 1 : 0.5, Math.random() < 0.08 + (G.state.party.leader()?.cri || 0), head, { melee: true, charge: s.charge || 0 });
            }
          }
        }
        if (before < 0.6 && k > 0.3 && !s.npcDone) {
          s.npcDone = true;
          const head = G.player.headWorld(new THREE.Vector3());
          const f = G.player.forwardVec();
          const reach = this.weaponLength() + 0.9;
          this.swingAtNpcs(c => {
            const to = new THREE.Vector3(c.x - head.x, 0, c.z - head.z);
            const d = to.length() - c.r;
            return d < reach && to.normalize().dot(f) > 0.5;
          });
          this.swingAtPlayers(c => {
            const to = new THREE.Vector3(c.x - head.x, 0, c.z - head.z);
            const d = to.length() - c.r;
            return d < reach && to.normalize().dot(f) > 0.5;
          }, { power: this.stamina > 0.1 ? 1 : 0.5, charge: s.charge || 0 });
        }
        if (k >= 1) { this.swing = null; desktopRest(this.weapon, 'right', ranged, G.three.camera); }
      }
    }
  }
  // charging a blow (VR: the trigger held): a rumble in the hand that grows, a tick and a rising sound when
  // full (~1 s); the next blow that lands takes it, then let go to charge again
  updateCharge(dt, held) {
    const c = this.charge || (this.charge = { t: 0, level: 0, spent: false, full: false, pulse: 0 });
    if (!held || this.stamina < 0.15) { c.t = 0; c.level = 0; c.spent = false; c.full = false; return; }
    if (c.spent) { c.level = 0; return; }
    c.t += dt;
    c.level = THREE.MathUtils.clamp((c.t - 0.15) / 1.0, 0, 1);
    if (c.level <= 0) return;
    c.pulse -= dt;
    if (c.pulse <= 0) { G.input.haptic('right', 0.12 + 0.45 * c.level, 30); c.pulse = 0.11 - 0.05 * c.level; }
    if (c.level >= 1 && !c.full) { c.full = true; G.input.haptic('right', 0.9, 70); G.audio?.playSe(G.seAt('Up4', 55, 130)); }
  }
  chargeLevel() {
    if (this.deskCharge != null) return THREE.MathUtils.clamp((G.time - this.deskCharge - 0.15) / 1.0, 0, 1);
    return this.charge?.level || 0;
  }
  // the weapon's own light: white-hot as a blow charges, a warm pulse while blows are strengthened (after a
  // perfect guard) - no words
  updateWeaponGlow() {
    if (!this.weapon) return;
    const ch = this.chargeLevel(), buff = (this.powerUntil || 0) > G.time;
    const k = 0.5 + 0.5 * Math.sin(G.time * 10);
    let r = Math.max(ch * 0.55, buff ? 0.4 + 0.2 * k : 0), g = Math.max(ch * 0.55, buff ? 0.15 + 0.08 * k : 0), b = Math.max(ch * 0.6, buff ? 0.03 : 0);
    if (this.skillArm) r = Math.max(r, 0.32 + 0.28 * (0.5 + 0.5 * Math.sin(G.time * 8)));     // a weapon art waits: red
    // (리포스트 of my own - blows slipped and answered: a pale flicker)
    if (this.slipStance(G.state.party.leader())) { const p = 0.18 + 0.16 * (0.5 + 0.5 * Math.sin(G.time * 13)); r = Math.max(r, p); g = Math.max(g, p); b = Math.max(b, p * 1.15); }
    const key = `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${this.weapon.uuid}`;
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.weapon.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(r, g, b); });
  }

  // ---- Break (original battle command): interrupt an enemy that is preparing an action or guarding
  breakImmune(e, stateId = 8) { return e.b.stateResist(stateId) || e.b.stateRate(stateId) === 0; }
  // Break's chance like the original: the skill's rate x the enemy's Break rate. Most enemies (rate 0.01 or
  // less) only open up while charging (x10000: 힘 모으기, 파고들기, 영창 ...) or guarding (x1000).
  // Setting 브레이크 판정 'easy': any attack wind-up works unless the enemy is immune.
  breakRoll(e, stateId = 8, value = 1) {
    if (e.state === 'stagger' || this.inDuel(e)) return 0;
    const chance = e.b.stateResist(stateId) ? 0 : THREE.MathUtils.clamp(value * this.breakRate(e, stateId), 0, 1);
    if ((G.settings.breakRule || 'original') !== 'easy' || chance <= 0) return chance;
    return e.state === 'windup' || e.state === 'guard' || chance >= 0.5 ? 1 : 0.001;
  }
  // a state that lets Break in (charging up, guarding, a counter stance: x10 ... x10000 on Break) does so only for
  // BREAK_WINDOW s from when it came; it stays on (its other effects - the stronger blow it charges for - stay)
  opensBreak(id) {
    const st = $data.states[id];
    if (!st) return false;
    if (st._opensBreak === undefined) st._opensBreak = (st.features || []).some(f => f.code === 13 && (f.data_id === 7 || f.data_id === 8) && f.value > 1);
    return st._opensBreak;
  }
  markBreakOpen(e, id) { if (this.opensBreak(id)) (e.breakOpen ||= {})[id] = G.time + (e.boss ? BREAK_WINDOW_BOSS : BREAK_WINDOW); }
  // the Break rate now: the states whose moment has passed count no more
  breakRate(e, id = 8) {
    let r = e.b.stateRate(id);
    const open = e.breakOpen;
    if (!open) return r;
    for (const s of e.b.states) {
      const until = open[s];
      if (until === undefined || G.time < until) continue;
      for (const f of $data.states[s]?.features || []) if (f.code === 13 && f.data_id === id && f.value > 0) r /= f.value;
    }
    return r;
  }
  // the enemy's own Break rate, without states
  baseBreakChance(e, stateId = 8) {
    const f = e.data?.features || [];
    if (f.some(x => x.code === 14 && x.data_id === stateId)) return 0;
    return Math.min(1, f.filter(x => x.code === 13 && x.data_id === stateId).reduce((r, x) => r * x.value, 1));
  }
  // 'open': a state (charging, guarding) dropped the Break immunity; 'locked': charging a big attack
  // that cannot be broken (브레이크 불가)
  breakCue(e) {
    if (!e.battle || !e.alive || e.hidden || e.state === 'stagger') return null;
    if (e.b.states.some(id => /브레이크 불가|ブレイク不可|无法破防|\bunbreakable|\bbreak ?immun/i.test($data.states[id]?.name || ''))) return 'locked';
    return !e.b.stateResist(8) && this.breakRate(e, 8) >= 0.5 && this.baseBreakChance(e) < 0.5 ? 'open' : null;
  }
  updateBreakCue(e) {
    if (!e.aura) return;
    const cue = e.group.visible ? this.breakCue(e) : null;
    if (cue !== e.cue) {
      const at = e.worldPos(new THREE.Vector3()); at.y += e.h * 0.5;
      if (cue === 'open') {
        G.audio?.playSe(G.seAt('Powerup', 85, 110), at);
        G.input.haptic('left', 0.25, 60); G.input.haptic('right', 0.25, 60);
      } else if (cue === 'locked') G.audio?.playSe(G.seAt('Darkness3', 70, 70), at);
      e.cue = cue;
    }
    const on = !!cue;
    e.aura.visible = on; e.cueRing.visible = on;
    for (const s of e.sparks) s.visible = on && cue === 'open';
    if (!on) return;
    const t = G.time, k = 0.7 + 0.3 * Math.sin(t * 9);
    const b = Math.max(0.6, fxk());            // a gameplay cue: never dimmed away
    const [r, g, bl] = cue === 'open' ? [1, 0.72, 0.18] : [0.85, 0.08, 0.06];
    e.aura.material.color.setRGB(r * b * k, g * b * k, bl * b * k);
    e.aura.scale.set(e.w * 1.9 * (0.94 + 0.12 * k), e.h * 1.45 * (0.94 + 0.12 * k), 1);
    e.cueRing.scale.setScalar((e.hr * T + 0.3) * (0.96 + 0.08 * k));
    e.cueRing.rotation.z = t * (cue === 'open' ? 1.6 : -0.8);
    e.cueRing.material.color.setRGB(r * b, g * b, bl * b);
    if (cue === 'open') {
      e.sparks.forEach((s, i) => {
        const f = (t * 0.7 + i / e.sparks.length) % 1, a = i * 2.4 + t * 1.3;
        s.position.set(Math.cos(a) * e.w * 0.42, f * e.h * 1.1, Math.sin(a) * e.w * 0.21);
        s.material.color.setRGB(b, 0.8 * b, 0.3 * b);
        s.material.opacity = Math.sin(f * Math.PI);
      });
    }
  }
  // an enemy's skill on itself (charging up, guarding, recovering) and the common event its skills call; a state
  // of its own that never wears off stays (귀신 무사's 할복, the marks its patterns count) - the 8 turns are for
  // what the player puts on it
  applySkillToSelf(e, skill) {
    // (one for all its allies - 의욕을 고취시켰다, a boss's war cry: every one of its side in this fight)
    const all = skill.scope === 8 && e.battle ? e.battle.enemies.filter(o => o.alive && !o.hidden) : [e];
    for (const t of all.includes(e) ? all : [e, ...all]) this.applySkillOn(t, skill);
  }
  applySkillOn(e, skill) {
    for (const ef of skill.effects || []) {
      if (ef.code === 21 && ef.data_id > 0) {
        if (!e.b.stateResist(ef.data_id) && Math.random() < ef.value1) this.addEnemyState(e, ef.data_id, true, true);
      } else if (ef.code === 22) {
        e.b.removeState(ef.data_id);
        if (e.stateTimers) delete e.stateTimers[ef.data_id];
        if (e.actionStates) delete e.actionStates[ef.data_id];
      } else if (ef.code === 11) {
        const v = e.b.healAmount(Math.floor(e.b.mhp * ef.value1 + ef.value2));
        if (v) { e.b.hp = Math.max(0, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar(); }
        if (v < 0) this.checkEnemyDeath(e);
      } else if (ef.code === 41) this.enemyEscape(e);
    }
    if (this.applyBuffEffects(e.b, skill, ENEMY_TURN)) {
      const p = e.worldPos(new THREE.Vector3());
      this.spawnGlow(new THREE.Vector3(p.x, p.y + e.h * 0.5, p.z), { color: 0xff7848, size: e.h * 0.9, life: 0.5, grow: 1.3 });
    }
  }
  // VX Ace's escape (a skill's escape effect: 도망친다 - the rabbits, 암흑 물질, 라스, 교활한 원숭이 low on HP, 하얀
  // 펭귄 -, 묘지기 이그조's 떠난다 while unhurt, the flea's 껑충껑충, and 메이벨's 당신의 승리 as her battle event forces it
  // once her three gods are down): it leaves the fight - it fades away, its states gone, with the game's escape
  // sound. Not beaten: nothing of it at the end (VX Ace's rewards are the fallen's); with none left standing the fight
  // is won (VX Ace: all_dead? counts the ones gone as well)
  enemyEscape(e) {
    if (!e.alive) return;
    this.dropMarker(e);
    e.escaped = true;
    e.b.clearStates(); this.pruneStateTimers(e);
    e.state = 'dying'; e.timer = 0; e.fadeOnly = true;
    if (e.bar) e.bar.visible = false;
    if (e.ring) e.ring.material.opacity = 0;
    G.audio?.playSystemSe(8);
  }
  runSkillCommonEvents(skill) {
    for (const ef of skill?.effects || []) {
      if (ef.code !== 44) continue;
      const list = commonEventList(ef.data_id);
      if (!list) continue;
      const it = new Interpreter(1);
      it.troop = true;
      it.setup(list, 0);
      this.sideInterps.push(it);
    }
  }
  // Script 170 防御状態無視: <防御状態無視率:n> on a skill, <パッシブ防御状態無視率:n> on its user's states, equipment, self
  // (and an actor's own skills) - added up, that % of the time its blow goes through a guard (VX Ace's guard? is
  // false for it): 찌르기, 갑옷 뚫기, 일섬, 짓밟기, 블레이드 워크 ...
  ignoresGuard(user, skill) {
    const rate = (o, key) => {
      if (!o) return 0;
      const k = key === 1 ? '_vgP' : '_vgA';
      if (o[k] === undefined) {
        const m = (key === 1 ? /<パッシブ防御状態無視率[：:]\s*(-?\d+(?:\.\d+)?)\s*>/ : /<防御状態無視率[：:]\s*(-?\d+(?:\.\d+)?)\s*>/).exec(o.note || '');
        o[k] = m ? +m[1] : 0;
      }
      return o[k];
    };
    let pec = rate(skill, 0);
    for (const o of user?.featureObjects?.() || []) pec += rate(o, 1);
    if (user?.allSkills) for (const s of user.allSkills()) pec += rate(s, 1);
    return pec > Math.floor(Math.random() * 100);
  }
  // Script 191 回避時発動スキル: <全回避時スキル:n[,p]> (or 物理- / 魔法- / 必中-, by the attack's hit type) on a battler's
  // states, equipment or self - an attack it slips, it answers with skill n (p % of the time): 흰 유니콘 유니스's
  // 리포스트 (a stance of evasion +100% for two of its actions, every slipped blow answered by a lunge, 판트), and the
  // player's own with 유니스의 자검. Passive armor/state evasion uses the same
  // roll even without an answer skill; a sure hit (hit type 0) is never slipped.
  evadeAnswers(b, hitType) {
    const out = [];
    for (const o of b?.featureObjects?.() || []) {
      if (!o) continue;
      if (o._evadeSk === undefined) {
        o._evadeSk = [];
        const W = { '必中': 0, '物理': 1, '魔法': 2, '全': 3 };
        for (const m of (o.note || '').matchAll(/<(必中|物理|魔法|全)回避時スキル[：:]\s*(\d+)\s*(?:,\s*(\d+))?\s*>/g)) o._evadeSk.push({ type: W[m[1]], id: +m[2], p: m[3] === undefined ? 100 : +m[3] });
      }
      for (const x of o._evadeSk) if (hitType === undefined || x.type === hitType || x.type === 3) out.push(x);
    }
    return out;
  }
  slipsWithAnswer(b, skill, user = null) {
    const ht = skill?.hit_type ?? 1;
    if (!b || ht === 0 || this.certainHit(user, skill)) return null;
    const answers = this.evadeAnswers(b, ht);
    return Math.random() < (ht === 1 ? b.eva : b.mev) ? answers : null;
  }
  // (the stance shows while it lasts)
  slipStance(b) { return this.evadeAnswers(b).length > 0 && (b.eva > 0 || b.mev > 0); }
  // an enemy slips a blow (of the player's, or of a companion - by): a quick step aside with its evasion sound and
  // a pale streak, nothing of it lands; then its answer - at once on a companion, a quick lunge at the player
  enemySlips(e, answers, skill, from, by) {
    const p = e.worldPos(new THREE.Vector3());
    const se = $data.system.sounds?.[skill?.hit_type === 2 ? 19 : 18];
    if (se) G.audio?.playSe(se, p);
    const pc = G.map.playerChar, a = Math.atan2(e.fy - pc.fy, e.fx - pc.fx) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    if (!e.stationary) { e.knock.x += Math.cos(a) * 0.55 / T / 3.3; e.knock.y += Math.sin(a) * 0.55 / T / 3.3; }
    this.spawnGlow(p.clone().setY(p.y + e.h * 0.5), { color: 0xe8f0ff, size: 0.9, life: 0.18, grow: 1.6 });
    const ans = answers.find(x => x.p > Math.floor(Math.random() * 100) && $data.skills[x.id] && this.enemyCanUse(e, $data.skills[x.id]));
    if (!ans || this.playerDead) return;
    const s = $data.skills[ans.id];
    const al = by && by !== G.state.party.leader() ? this.allies.list.find(x => x.members().includes(by)) : null;
    if (al) {
      if (G.time < (e.counterReady || 0)) return;
      e.counterReady = G.time + 0.9;
      this.commitSkill(e, s); e.acted = null;
      this.later(200, () => {
        if (!e.alive || !al.alive) return;
        const ap = al.chest(new THREE.Vector3());
        if (s.animation_id > 0) G.screen.playAnimationOn(ap, s.animation_id, { world: true, size: 1.4 });
        al.takeHit(e, s);
      });
      return;
    }
    if (this.startCounter(e, s)) this.commitSkill(e, s);
  }
  // the player slips an enemy's blow (리포스트 of their own): the evasion sound and a light shake in both hands,
  // nothing of it lands; a moment later the answer goes into the one who struck
  playerSlips(e, answers, skill) {
    const actor = G.state.party.leader();
    G.audio?.playSystemSe(skill?.hit_type === 2 ? 19 : 18);
    G.input.haptic('left', 0.25, 40); G.input.haptic('right', 0.25, 40);
    if (!e || G.time - (this.answeredAt ?? -1) < 0.15) return;
    const ans = answers.find(x => x.p > Math.floor(Math.random() * 100) && $data.skills[x.id] && actor.skillCostPayable($data.skills[x.id]) && !actor.skillSealed($data.skills[x.id].id));
    if (!ans) return;
    this.answeredAt = G.time;
    const s = $data.skills[ans.id];
    this.later(150, () => {
      if (this.playerDead || !e.alive || e.hidden) return;
      this.actorPays(actor, s);
      if (s.scope >= 1 && s.scope <= 6) {
        this.applyUsableToEnemy(e, s, this.castOrigin());
        const wp = e.worldPos(new THREE.Vector3()); wp.y += e.h * 0.5;
        if (s.animation_id > 0) G.screen.playAnimationOn(wp, s.animation_id, { rate: 3, height: e.h });
      } else this.applyUsableToActor(s, 'self');
      G.input.haptic('right', 0.7, 70);
    });
  }
  // the timers of states it no longer has go (a state that stays through Recover All or death keeps its own)
  pruneStateTimers(e) {
    for (const t of [e.stateTimers, e.actionStates]) if (t) for (const k of Object.keys(t)) if (!e.b.isState(+k)) delete t[k];
  }
  // after each enemy action: the states that end with its actions and have had their turns run out
  expireActionStates(e) {
    const a = e.actionStates;
    if (!a) return;
    for (const id of Object.keys(a)) {
      if (e.turn - a[id].at < a[id].n) continue;
      e.b.removeState(+id); delete a[id];
      if (e.stateTimers) delete e.stateTimers[id];
    }
    this.checkEnemyDeath(e);
  }
  // Gun Break: the guns in the shield slot seal Break and add their own Gun Break skill
  gunBreakSkill() {
    const a = G.state.party.leader();
    if (!a) return null;
    for (const id of a.featuresSet(43)) {
      const s = $data.skills[id];
      if (s && /건 ?브레이크|ガン ?ブレイク|枪械?破防|\bgun ?break/i.test(s.name) && this.isBreakSkill(s)) return s;
    }
    return null;
  }
  // Break. A shield-slot gun fires its Gun Break the moment the button goes down. Otherwise Break rides on
  // the weapon: a swing (or a shot) that lands while the button is held - or within 3 s of picking a Break
  // skill from the quick slots - tries to break what it hits instead of the plain blow
  pressBreak() {
    if (this.playerDead || this.held?.how === 'rub') return;        // (the left hand holds a resin, not the gun)
    const gun = this.gunBreakSkill();
    if (gun) { if ((this.breakCooldown || 0) <= G.time) this.fireGunBreak(gun); return; }
    G.input.haptic('right', 0.2, 30);
  }
  breakArmed() {
    if ((this.breakCooldown || 0) > G.time || this.playerDead) return null;
    if (this.breakArm) {
      if (this.breakArm.until > G.time) return this.breakArm.skill;
      this.breakArm = null;
    }
    return G.input.breakHeld() && !this.gunBreakSkill() ? $data.skills[13] : null;
  }
  // a Break landing on e: the original command has no damage of its own (only the break, by the skill's
  // rate x the enemy's); Break skills with a blow (weapon / armor / karma break) hit with it too
  breakOnHit(e, skill, src) {
    this.breakArm = null;
    this.breakCooldown = G.time + Math.max(0.9, this.coolSeconds(skill));
    this.stamina = Math.max(0, this.stamina - 0.2); this.staminaDelay = 0.8;
    if (this.heldBoss(e)) return;
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(x => x.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const at = this.hitPoint(e, src);
    const ef = (skill.effects || []).find(f => f.code === 21 && (f.data_id === 7 || f.data_id === 8));
    const stateId = ef?.data_id || (skill.id === 16 ? 7 : 8);
    const wasDown = e.state === 'stagger';
    const chance = this.breakRoll(e, stateId, ef?.value1 ?? 1);
    let broke = false;
    if (skill.damage?.type === 1 || skill.damage?.type === 5) {
      this.applyUsableToEnemy(e, skill, src, { knock: 0.12, mult: this.buffMult() });
      broke = !wasDown && e.state === 'stagger';
    } else if (chance > 0 && Math.random() < chance) {
      this.breakEnemy(e, stateId);
      broke = true;
    }
    if (broke) {
      // the original Break animation, a bit faster, where it struck - silent: the one sound of a Break that lands is
      // breakEnemy's (BREAK_SE; its own Wind7 -> Ice11 + Break made it two)
      if (skill.animation_id > 0) G.screen.playAnimationOn(at, skill.animation_id, { rate: 2, world: true, size: this.enemySize(e), mute: true });
      G.input.haptic('right', 1, 160);
    } else G.audio?.playSystemSe(17);
  }
  // while a swing would Break, a gold light sits on the weapon's tip
  showBreakReady(tip) {
    const on = !!this.weapon && !!this.breakArmed();
    if (!this.breakGlow) {
      if (!on) return;
      this.breakGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: 0xffc040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.breakGlow.renderOrder = 1401;
      this.root.add(this.breakGlow);
    }
    this.breakGlow.visible = on;
    if (!on) return;
    if (this.breakGlow.parent !== this.root) this.root.add(this.breakGlow);
    this.breakGlow.position.copy(tip);
    const k = 0.75 + 0.25 * Math.sin(G.time * 12), b = Math.max(0.7, fxk());
    this.breakGlow.scale.setScalar(0.16 * k);
    this.breakGlow.material.color.setRGB(b, 0.75 * b, 0.25 * b);
  }
  // fire the shield-slot gun: its own shot sounds (the skill's animation), muzzle flash, tracer;
  // damage by the skill's formula and Break / Hard Break on an enemy that is winding up or guarding.
  // The shot goes through enemies: everyone on its line is hit, up to a wall or the floor (GUN_BREAK_RANGE);
  // the cannon's shell bursts at each one it goes through and where it stops
  fireGunBreak(skill) {
    this.breakCooldown = G.time + Math.max(0.9, this.coolSeconds(skill));
    this.stamina = Math.max(0, this.stamina - 0.2); this.staminaDelay = 0.8;
    const gun = this.offGun;
    let from = null, dir;
    if (gun) {
      gun.updateWorldMatrix(true, true);
      from = new THREE.Vector3(0, 0, -(gun.userData.visualLength || gun.userData.length || 0.3)).applyMatrix4(gun.matrixWorld);
    }
    // the shot leaves along where the left controller points, however the gun model is turned in the hand
    const ray = this.aimRay('left');
    if (ray) {
      dir = ray.dir;
      if (!from || from.distanceTo(ray.origin) > 0.45) from = ray.origin.clone().addScaledVector(dir, 0.12);
    } else dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    if (!from) from = G.player.headWorld(new THREE.Vector3()).addScaledVector(dir, 0.4);
    // walk the shot: through every enemy on the line, until a wall / the floor
    const range = GUN_BREAK_RANGE, step = 0.15;
    const p = new THREE.Vector3();
    const sx = from.x / T - 0.5, sy = from.z / T - 0.5;
    const targets = this.allTargets();
    const hits = [];                       // { e, at }: in the order the shot reaches them
    let endT = range;
    for (let t = 0; t <= range; t += step) {
      p.copy(from).addScaledVector(dir, t);
      const tx = p.x / T - 0.5, ty = p.z / T - 0.5;
      if (!G.map.validW(Math.round(tx), Math.round(ty)) || p.y < G.floorAt(tx, ty) - 0.05 ||
          (t > 0.6 && !lineOfSight(sx, sy, tx, ty))) { endT = t; break; }
      for (const e of targets) {
        if (hits.some(h => h.e === e)) continue;
        const wp = e.worldPos(tmpA);
        if (Math.hypot(p.x - wp.x, p.z - wp.z) < e.hr * T + 0.22 && p.y > wp.y - 0.1 && p.y < wp.y + e.h + 0.25 && this.partAt(e, p) === e) hits.push({ e, at: p.clone() });
      }
    }
    const end = from.clone().addScaledVector(dir, endT);
    const cannon = skill.scope === 2;
    const first = hits[0]?.e;
    const animAt = first ? first.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, first.h * 0.5, 0)) : end.clone();
    const shot = { from, end, cannon, points: hits.map(h => h.at), anim: skill.animation_id | 0, animAt, height: first?.h || 0 };
    this.gunBreakFx(shot);
    G.coop?.shareGunBreak?.(shot);
    G.input.haptic('left', 1, cannon ? 220 : 120);
    const victims = new Set(hits.map(h => h.e));
    if (cannon) {
      const blasts = hits.map(h => h.at).concat([end]);
      for (const e of this.allTargets()) if (blasts.some(b => e.worldPos(tmpA).distanceTo(b) < 2.6 + e.hr * T)) victims.add(e);
    }
    // the parry (these guns' perfect guard): shot as its blow is about to land on the player
    const parried = [...victims].filter(e => this.gunParryable(e));
    for (const e of victims) this.gunBreakHit(e, skill, from);
    if (parried.length) this.gunParry(parried, hits);
  }
  // what a Gun Break shot looks like: the muzzle's flash, its line (the cannon: none), the skill's animation where it
  // first struck (else where it stopped) and a spark - the cannon's shell: a burst - at each one it went through and where
  // it stopped (the others are shown it too - coop.js shareGunBreak)
  gunBreakFx({ from, end, cannon, points, anim, animAt, height }) {
    this.spawnGlow(from, { color: 0xffd890, size: cannon ? 0.6 : 0.3, life: cannon ? 0.16 : 0.09, grow: 1.8 });
    if (!cannon) this.spawnTracer(from, end);
    if (anim > 0) G.screen.playAnimationOn(animAt, anim, { rate: 1.5, sePos: from, height: height || undefined });
    else G.audio?.playSe(G.seAt('Gun1', 90, 100), from);
    const burst = { color: 0xff9040, size: 1.8, life: 0.45, grow: 2.2 };
    points.forEach((at, i) => { if (cannon || i > 0) this.spawnGlow(at, cannon ? burst : { color: 0xfff0c0, size: 0.3, life: 0.1, grow: 1.6 }); });
    this.spawnGlow(end, cannon ? burst : { color: 0xfff0c0, size: 0.35, life: 0.12, grow: 1.6 });
  }
  // an enemy winding up a blow a guard could stop (not a shot), the player inside its reach, GUN_PARRY s or less
  // before it lands
  gunParryable(e) {
    const plan = e.plan;
    return e.alive && e.state === 'windup' && !!plan && (!!plan.blockable || this.parryable(plan)) && !plan.shot && e.timer <= GUN_PARRY && this.playerInPlan(e, plan);
  }
  // what a perfect guard gives, and the blow never lands: an enemy the shot did not break stops its attack; the
  // perfect guard's high ringing "ting" with golden sparks where the shot struck, both hands
  gunParry(enemies, hits) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead) return;
    this.perfectGuardReward(actor);
    this.breakCooldown = 0;                        // (the next Gun Break is ready at once)
    const head = G.player.headWorld(new THREE.Vector3());
    for (const e of enemies) {
      if (e.alive && e.state === 'windup') { e.state = 'recover'; e.timer = 0.6; e.act = null; e.move = null; e.comboStep = 0; this.dropMarker(e); }
      const at = hits.find(h => h.e === e)?.at || e.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, e.h * 0.6, 0));
      G.audio?.playSe(G.seAt('Parry', 100, 150), at);
      G.audio?.playSe(G.seAt('Reflection', 75, 130), at);
      this.spawnSparks(at, new THREE.Vector3(at.x - head.x, 0, at.z - head.z), 18, 0xffd860);
    }
    G.input.haptic('left', 1, 110); G.input.haptic('right', 0.6, 90);
  }
  gunBreakHit(e, skill, from) {
    if (!e.alive) return;
    if (this.heldBoss(e)) return;
    const actor = G.state.party.leader();
    if (!e.battle) {
      const sym = [...this.symbols.values()].find(s => s.enemy === e);
      if (sym) this.engage(sym.ev, true);
    }
    const bef = skill.effects.find(f => f.code === 21 && (f.data_id === 7 || f.data_id === 8));
    const stateId = bef?.data_id || 8;
    const chance = this.breakRoll(e, stateId, bef?.value1 ?? 1);
    const p = e.worldPos(new THREE.Vector3());
    const dmg = this.computeDamage(actor, e.b, skill, (e.state === 'stagger' ? 1.5 : 1) * this.buffMult());
    if (dmg > 0 || skill.damage?.type === 1) {
      e.b.hp = Math.max(0, e.b.hp - dmg);
      e.flash = 0.18; if (e.bar) e.bar.visible = true; e.drawBar();
      this.popup(new THREE.Vector3(p.x, p.y + e.h * 0.75, p.z), String(dmg), dmg > 0 ? '#ffe0a0' : '#9a9a9a');
      if (dmg > 0) this.damageRemovesStates(e);
    }
    const away = Math.atan2(p.z - from.z, p.x - from.x);
    e.knock.x += Math.cos(away) * 0.15; e.knock.y += Math.sin(away) * 0.15;
    this.checkEnemyDeath(e);
    if (!e.alive) return;
    if (chance > 0 && Math.random() < chance) {
      this.breakEnemy(e, stateId);
      G.input.haptic('right', 1, 160);
    }
  }
  aimFlat() {
    if (G.vr && this.weapon) {
      this.weapon.updateWorldMatrix(true, false);
      const f = new THREE.Vector3(0, 0, -1).transformDirection(this.weapon.matrixWorld);
      f.y = 0;
      if (f.lengthSq() > 0.05) return f.normalize();
    }
    return G.player.forwardVec();
  }
  weaponLength() { return this.weapon?.userData.length || 1; }

  // ---- NPCs that offer "살해한다" can be cut down directly (two hits within 3 s, to avoid accidents)
  hasKillChoice(ev) {
    const page = ev.page;
    if (!page) return false;
    if (page._killChoice === undefined) {
      page._killChoice = (page.list || []).some(c => c.code === 102 && c.parameters[0].some(o => /살해|殺害|殺す|殺し|杀害|杀死|\bkill/i.test(String(o))));
    }
    return page._killChoice;
  }
  // ---- PvP (co-op, the server's rule pvp - in the developer's world each player's own, two who both turned it on:
  // coop.js pvpWith): everyone may strike everyone. The one swinging finds the hit (its own
  // blade against the others' bodies as it sees them); the one struck judges the rest on its own side - its dodge,
  // guard and perfect guard, and the damage by the striker's own numbers against its own (pvpStruck)
  swingAtPlayers(hitTest, opts) {
    if (!G.coop?.pvpAny || !G.coop.active || this.spectating || this.playerDead) return;
    for (const t of G.coop.pvpTargets()) if (hitTest(t)) this.strikePlayer(t, opts);
  }
  // (PvP, VR) this blade's path meets another player's weapon or shield as this world shows them (coop avatars'
  // heldShapes) - bladeMeets says how: held off ('block', 'guard': this swing does not go through to that one - a
  // clang, sparks, this hand jolts, some stamina), turned aside by a shield's slant ('deflect': nor does it - a scrape),
  // its parry beaten aside ('beat': the blow goes on at half strength), or sliding along it ('slide': the blow goes on).
  // It is told how (its hand jolts as it would). strong: a hard swing (fast, or charged)
  clashWithPlayers(b0, t0, b1, t1, { strong = false } = {}) {
    if (!G.coop?.pvpAny || !G.coop.active || this.spectating || this.playerDead) return;
    const hits = (this.pvpHits ||= new Map()), slid = (this.pvpSlid ||= new Map()), beat = (this.pvpBeat ||= new Map());
    for (const p of G.coop.pvpPeers()) {
      if (G.time - (hits.get(p.id) || -9) < 0.45 || G.time - (beat.get(p.id) || -9) < 0.45) continue;
      for (const s of p.avatar.heldShapes()) {
        const c = bladeMeets(s, b0, t0, b1, t1, strong);
        if (!c) continue;
        this.lastClash = { id: p.id, how: c.how };
        if (c.how === 'slide') {
          if (G.time - (slid.get(p.id) || -9) > 0.3) {
            slid.set(p.id, G.time);
            G.audio?.playSe(G.seAt('Sword1', 80, 150), c.at);      // (the slipping cue's sound)
            this.spawnSparks(c.at, c.dir, 4, 0xfff0c0);
            G.input.haptic('right', 0.35, 40);
            G.coop.sendClash(p.id, s.side, 5);
          }
          continue;
        }
        if (c.how === 'deflect') {
          hits.set(p.id, G.time);
          G.audio?.playSe(G.seAt('Sword1', 80, 150), c.at);
          this.spawnSparks(c.at, c.dir, 4, 0xfff0c0);
          G.input.haptic('right', 0.45, 50);
          G.coop.sendClash(p.id, s.side, 4);
          break;
        }
        if (c.how === 'beat') {
          beat.set(p.id, G.time);
          G.audio?.playSe(G.seAt('Parry', 95, 100), c.at);
          this.spawnSparks(c.at, c.dir, 8, 0xffe8b0);
          G.input.haptic('right', 0.7, 70);
          G.coop.sendClash(p.id, s.side, 3);
          break;
        }
        hits.set(p.id, G.time);
        G.audio?.playSe(G.seAt('Parry', 95, s.kind === 'shield' ? 110 : 130), c.at);
        this.spawnSparks(c.at, c.dir, 12, 0xffe8b0);
        G.input.haptic('right', 1, 100);
        this.stamina = Math.max(0, this.stamina - 0.1); this.staminaDelay = 0.8;
        G.coop.sendClash(p.id, s.side, s.kind === 'shield' ? 1 : 2);
        break;
      }
    }
  }
  // (PvP) another player's blade met what this player holds (coop.js onClash) - k: 1 taken on the shield (some
  // stamina), 2 held off by its blade, 3 its blade beaten aside (the blow comes on), 4 turned aside by the shield's
  // slant (a little stamina), 5 a blade sliding along its own: that hand jolts as it would, with the sound of it
  clashed(side, k) {
    if (this.playerDead || this.spectating) return false;
    const obj = side === 'right' ? this.weapon : this.shield, at = new THREE.Vector3();
    if (obj?.parent) obj.getWorldPosition(at); else G.player.headWorld(at);
    if (k <= 3) {
      G.audio?.playSe(G.seAt('Parry', 90, k === 1 ? 110 : k === 3 ? 100 : 130), at);
      this.spawnSparks(at, new THREE.Vector3(0, 1, 0), 8, 0xffe8b0);
    } else G.audio?.playSe(G.seAt('Sword1', 70, 150), at);
    G.input.haptic(side, [0, 1, 1, 0.8, 0.45, 0.3][k], k <= 3 ? 90 : 50);
    const cost = k === 1 ? 0.1 : k === 4 ? 0.03 : 0;
    if (cost) { this.stamina = Math.max(0, this.stamina - cost); this.staminaDelay = 0.8; }
    return true;
  }
  // (PvP) a spell or a thrown thing of this player's - one aimed at foes - reached another player (t: its body as seen
  // here): what it is - the skill or item, this player's numbers - goes to it, once a hit for as many hits as it makes;
  // that one takes it as it would (pvpStruck: a dodge, a guard; its damage, its states)
  strikePlayerWith(t, obj, { one = false } = {}) {
    if (!obj || !(obj.scope >= 1 && obj.scope <= 6)) return false;
    const hits = (this.pvpUseHits ||= new Map());
    if (G.time - (hits.get(t.id) || -9) < 0.25) return false;
    hits.set(t.id, G.time);
    const actor = G.state.party.leader();
    if (!actor) return false;
    const n = one ? 1 : Math.max(1, Math.min(5, obj.repeats || 1)), mult = this.buffMult(), item = obj.__class === 'RPG::Item';
    for (let r = 0; r < n; r++) this.later(r * 120, () => G.coop?.sendPvp(t.id, obj.id, mult, false, actor, item));
    if (obj.animation_id > 0) G.screen.playAnimationOn(new THREE.Vector3(t.x, t.y + 0.9, t.z), obj.animation_id, { rate: 3, height: t.h });
    G.input.haptic('left', 0.5, 50);
    return true;
  }
  // a blow of this player's reached another one (t: its body as seen here): what it is - the attack skill, how hard,
  // this player's numbers - goes to it
  strikePlayer(t, { power = 1, charge = 0, crit = false } = {}) {
    const hits = (this.pvpHits ||= new Map());
    if (G.time - (hits.get(t.id) || -9) < 0.45) return;            // (one swing passing through counts once)
    hits.set(t.id, G.time);
    const actor = G.state.party.leader();
    if (!actor) return;
    const skill = this.skillByState(actor, this.playerAttackSkill(actor));
    let mult = power * this.buffMult();
    if (charge >= 0.35) mult *= 1 + charge;
    if (G.time - (this.pvpBeat?.get(t.id) || -9) < 0.45) mult *= 0.5;       // (its parry beaten aside: weaker)
    const critical = !!crit && skill.damage?.critical !== false && Math.random() < 0.35 + (actor.cri || 0);
    if (critical) mult *= 2;
    G.coop.sendPvp(t.id, skill.id, mult, critical, actor);
    const at = new THREE.Vector3(t.x, t.y + 1.2, t.z);
    G.audio?.playSe(G.seAt(critical ? 'Slash11' : 'Slash1', 90, 95), at);
    G.input.haptic('right', 0.9, 70);
  }
  // (PvP) another player's blow reached this one: judged here. by: a stand-in for the striker (its numbers as sent);
  // from: where it stands. What came of it: 'dodge' | 'perfect' | 'guard' | 'hit' | '' (nothing: fallen, watching)
  pvpStruck(by, skill, mult, from) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead || this.spectating || !skill) return '';
    const head = G.player.headWorld(new THREE.Vector3());
    if (G.player.invuln > 0) { G.audio?.playSystemSe(18); G.input.haptic('left', 0.2, 30); G.input.haptic('right', 0.2, 30); return 'dodge'; }
    let dmg = 0;
    try { dmg = this.withGuardBuff(actor, () => this.computeDamage(by, actor, skill, mult)); } catch (e) { console.warn('[coop] pvp damage', e); }
    dmg = Math.round(dmg * G.settings.difficulty);
    const ep = from || head;
    let how = 'hit';
    if (this.isBlocking(ep) && G.time - (this.guardRaisedAt ?? -99) <= PERFECT_GUARD) {
      this.perfectGuardReward(actor); this.guardFree = true; this.guardTing(ep, true);
      return 'perfect';
    } else if (this.isBlocking(ep)) {
      how = 'guard';
      dmg = Math.round(dmg * (this.hasShield ? 0.25 : 0.5) / Math.max(0.5, actor.grd));
      this.stamina = Math.max(0, this.stamina - 0.22); this.staminaDelay = 1;
      this.guardTing(ep);
    } else {
      G.screen.hurtFlash(1);
      G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 1);
      G.input.haptic('left', 1, 120); G.input.haptic('right', 1, 120);
      G.audio?.playSystemSe(14);
    }
    const t = skill.damage?.type || 0;
    if (t === 3 || t === 4) dmg = 0;                     // (a recovery aimed at a foe: nothing taken)
    if (dmg > 0 && (t === 2 || t === 6)) {               // (MP damage, an MP drain)
      actor.mp = Math.max(0, actor.mp - dmg);
      this.popupAtPlayer(`MP -${dmg}`, '#a0b8ff');
    } else if (dmg > 0) {
      actor.hp = Math.max(0, actor.hp - dmg);
      this.damageRemovesActorStates(actor);
      this.popupAtPlayer(`-${dmg}`, '#ff9a9a');
    }
    // (what else it does to a foe: the states it adds or takes away, its debuffs - by this player's rates)
    if (skill.scope >= 1 && skill.scope <= 6) {
      for (const ef of skill.effects || []) {
        if (ef.code === 21 && ef.data_id > 0 && !actor.stateResist(ef.data_id) && Math.random() < ef.value1 * actor.stateRate(ef.data_id)) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); }
        else if (ef.code === 22) actor.removeState(ef.data_id);
      }
      this.applyBuffEffects(actor, skill, TURN_SECONDS);
    }
    if (actor.hp <= 0) this.playerFalls(null);
    return how;
  }
  swingAtNpcs(hitTest) {
    if (G.map.interpreter.running() || G.coop?.phantom) return;
    for (const ev of G.map.eventList) {
      if (!ev.page || ev.erased || ev.trigger !== 0 || ev.transparent || this.controlsEvent(ev)) continue;
      if (!this.hasKillChoice(ev)) continue;
      const c = ev.viewPos
        ? { x: ev.viewPos.x, z: ev.viewPos.z, r: 0.38, h: 1.75, y: ev.viewPos.y }
        : { x: (G.map.nearX(ev.realX, G.map.playerChar.fx) + 0.5) * T, z: (G.map.nearY(ev.realY, G.map.playerChar.fy) + 0.5) * T, r: 0.38, h: 1.75, y: G.floorAt ? G.floorAt(ev.realX, ev.realY) : 0 };
      if (!hitTest(c)) continue;
      // one swing passing through counts once (VR checks the blade every frame)
      if (ev._npcHitAt && G.time - ev._npcHitAt < 0.5) return;
      ev._npcHitAt = G.time;
      const pos = new THREE.Vector3(c.x, c.y + 1.3, c.z);
      G.audio?.playSe(G.seAt('Slash1', 90, 100), pos);
      G.input.haptic('right', 0.8, 80);
      ev.hitFlash = 0.25;
      if (ev._killWarn && G.time - ev._killWarn < 3) {
        ev._killWarn = 0;
        this.startNpcKill(ev);
      } else ev._killWarn = G.time;
      return;
    }
  }
  segmentHitsCylinder(c, b0, t0, b1, t1) {
    for (let s = 0; s <= 3; s++) {
      const k = s / 3;
      const bx = b0.x + (b1.x - b0.x) * k, by = b0.y + (b1.y - b0.y) * k, bz = b0.z + (b1.z - b0.z) * k;
      const tx = t0.x + (t1.x - t0.x) * k, ty = t0.y + (t1.y - t0.y) * k, tz = t0.z + (t1.z - t0.z) * k;
      const ax = tx - bx, az = tz - bz;
      const l2 = ax * ax + az * az;
      const u = l2 > 1e-6 ? THREE.MathUtils.clamp(((c.x - bx) * ax + (c.z - bz) * az) / l2, 0, 1) : 0;
      const qx = bx + ax * u, qz = bz + az * u, qy = by + (ty - by) * u;
      if (Math.hypot(qx - c.x, qz - c.z) < c.r && qy > c.y + 0.1 && qy < c.y + c.h) return true;
    }
    return false;
  }
  startNpcKill(ev) {
    const m = G.map;
    if (m.interpreter.running()) return;
    ev.lock?.();
    m.interpreter.setup(ev.list, ev.id);
    m.interpreter.killMode = true;   // skip the small talk and pick "살해한다" at the choice
  }

  // the trigger (PC: a click) with a weapon that shoots (shotStyle): a bow's arrow, a gun's bullet, a staff's magic (the
  // whole blow where it lands). A gun whose normal attack hits several times (한스의 기관총: its attack count) fires as
  // many bullets in a burst, each of them one hit. A gun whose blow goes on with a shot of its own fires that shot
  // instead (gunShotSkill - 거룩한 총검)
  fireRanged() {
    const kind = this.shotKind, actor = G.state.party.leader();
    const pace = playerRecoveryRate(actor);
    const shot = kind === 'gun' && actor ? this.gunShotSkill(actor) : null;
    if (shot) { if (!G.vr) this.deskActUntil = G.time + (DESK_ACT + 0.6) / pace; this.fireSkillShot(actor, shot); return; }
    const n = kind !== 'gun' || !actor ? 1 : this.attackHits(this.skillByState(actor, this.playerAttackSkill(actor)), actor);
    if (!G.vr) this.deskActUntil = G.time + DESK_ACT / pace + (n - 1) * BURST_GAP; // keep the hands busy through the unchanged burst
    this.rangedCooldown = (kind === 'magic' ? 0.9 : 0.6) / pace + (n - 1) * BURST_GAP;
    const brk = this.breakArmed();                 // (fired with Break held: the first shot carries the Break)
    this.fireShot(kind, n > 1, brk);
    for (let i = 1; i < n; i++) this.later(i * BURST_GAP * 1000, () => this.fireShot(kind, true, null));
  }
  // the shot a gun's blow goes on with (script 189 使用後追加行動), by the state the one holding it is in (script 195):
  // 거룩한 총검's stab goes on with the shot of the bullet loaded (총탄 장전 - states 190 / 191 / 192) - Ⅰ 총검 건
  // 브레이크, Ⅱ 하드 건 브레이크, Ⅲ 풀 버스트. Its other hits (attack count) are the stab's, not more shots
  gunShotSkill(actor) {
    const stab = this.skillByState(actor, this.playerAttackSkill(actor));
    for (const a of stab ? this.afterActions(stab) : []) {
      const s = a.id > 0 ? this.skillByState(actor, $data.skills[a.id]) : null;
      if (s && this.skillLook(s) === 'gun') return s;
    }
    return null;
  }
  // that shot fired: as many rounds as it hits (풀 버스트: 7 in a burst, each one hit of it), each landing as the skill
  // does - its damage, its Break / Hard Break, its animation once; paid and cooling as the skill is (Ⅱ, Ⅲ: 3 turns). Cooling
  // (or unpaid), nothing fires: the original's stab goes on without its shot then
  fireSkillShot(actor, s) {
    if (this.skillCooling(s) > 0 || !actor.skillCostPayable(s) || actor.skillSealed(s.id)) {
      this.rangedCooldown = 0.25;
      G.audio?.playSystemSe(3);
      G.input.haptic('right', 0.25, 30);
      return;
    }
    this.actorPays(actor, s);
    this.skillCD[s.id] = G.time + this.coolSeconds(s);
    const n = THREE.MathUtils.clamp((s.repeats || 1) * ({ 4: 2, 5: 3, 6: 4 }[s.scope] || 1), 1, 8);
    const pace = playerRecoveryRate(actor), tail = (n - 1) * BURST_GAP;
    if (!G.vr) this.deskActUntil = Math.max(this.deskActUntil ?? -Infinity, G.time + DESK_ACT / pace + tail);
    this.rangedCooldown = 0.6 / pace + tail;
    const volley = { shown: false };
    this.fireShot('gun', true, null, { skill: s, volley });
    for (let i = 1; i < n; i++) this.later(i * BURST_GAP * 1000, () => this.fireShot('gun', true, null, { skill: s, volley }));
  }
  // one round of kind 'gun' | 'bow' | 'magic' (skill: a skill's shot, one hit of it - fireSkillShot)
  fireShot(kind, one, breakSkill, { skill = null, volley = null } = {}) {
    if (!this.weapon || this.disarmed) return;
    const bow = kind === 'bow', magic = kind === 'magic';
    const from = this.muzzle();
    const ray = this.aimRay('right');
    const dir = ray ? ray.dir : new THREE.Vector3(0, 0, -1).applyQuaternion(G.three.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.spawnProjectile(from, dir, { speed: bow ? 18 : 16, color: magic ? 0x6688ff : 0xffe0a0, owner: 'player', power: 0.9, homing: 0, breakSkill, one, usable: skill, volley,
      staff: magic && !skill ? STAFF_BURST : 0, ...(bow ? { mesh: this.arrowMesh(), align: true } : {}) });
    G.audio?.playSe(G.seAt(bow ? 'Bow1' : magic ? 'Magic1' : 'Gun1', 80, 100));
    G.input.haptic('right', 0.6, one ? 30 : 50);
  }
  // where what the right hand holds shoots from: its tip
  muzzle() {
    this.weapon.updateWorldMatrix(true, false);
    return new THREE.Vector3(0, 0, -(this.weapon.userData.visualLength || this.weapon.userData.length)).applyMatrix4(this.weapon.matrixWorld);
  }
  // a bow's arrow: a shaft, its head ahead (-Z: the way it flies - align) and its feathers behind (made once, shared)
  arrowMesh() {
    if (!this.arrowProto) {
      const g = new THREE.Group(), mat = color => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.6, 6), mat(0x9a7448));
      shaft.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), mat(0xd8dde2));
      head.rotation.x = -Math.PI / 2; head.position.z = -0.33;
      g.add(shaft, head);
      for (const a of [0, Math.PI / 2]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.1), mat(0xf0ece0));
        f.rotation.x = Math.PI / 2;
        const turn = new THREE.Group(); turn.rotation.z = a; turn.position.z = 0.25; turn.add(f);
        g.add(turn);
      }
      g.userData.look = 'arrow';                     // (co-op: shareShot)
      this.arrowProto = g;
    }
    return this.arrowProto.clone();
  }
  segmentHitsEnemy(e, b0, t0, b1, t1) {
    const wp = e.worldPos(new THREE.Vector3());
    wp.y += e.hover || 0;                            // (a body floating over the stage)
    const r = e.hr * T + 0.05;
    for (let s = 0; s <= 3; s++) {
      const k = s / 3;
      const bx = b0.x + (b1.x - b0.x) * k, by = b0.y + (b1.y - b0.y) * k, bz = b0.z + (b1.z - b0.z) * k;
      const tx = t0.x + (t1.x - t0.x) * k, ty = t0.y + (t1.y - t0.y) * k, tz = t0.z + (t1.z - t0.z) * k;
      // closest point on segment to the enemy axis (XZ)
      const ax = tx - bx, az = tz - bz;
      const l2 = ax * ax + az * az;
      const u = l2 > 1e-6 ? THREE.MathUtils.clamp(((wp.x - bx) * ax + (wp.z - bz) * az) / l2, 0, 1) : 0;
      const qx = bx + ax * u, qz = bz + az * u, qy = by + (ty - by) * u;
      if (Math.hypot(qx - wp.x, qz - wp.z) < r && qy > wp.y + 0.05 && qy < wp.y + e.h + 0.1 && (!e.pair || this.partAt(e, tmpC.set(qx, qy, qz)) === e)) return true;
    }
    return false;
  }

  // keep the player out of enemies
  // the enemies stand in the player's way like walls (and the player in theirs, updateEnemies); a dodge slips
  // through them, and the player walks out of one they ended up in
  pushPlayer(player) {
    const head = player.headWorld(new THREE.Vector3());
    let fx = head.x / T - 0.5, fy = head.z / T - 0.5;
    const targets = this.allTargets();
    for (const e of this.passing) if (!targets.includes(e) || Math.hypot(fx - e.fx, fy - e.fy) >= e.r + BODY_R) this.passing.delete(e);
    const [bx, by] = this.blockPlayer(fx, fy, player, targets);
    const moved = bx !== fx || by !== fy;
    fx = bx; fy = by;
    if (moved) {
      [fx, fy] = resolveCircle(fx, fy, 0.2);
      player.rig.position.x += (fx + 0.5) * T - head.x;
      player.rig.position.z += (fy + 0.5) * T - head.z;
    }
  }

  // a player position (tiles) against the enemies' bodies: out to their edge (not one the player is slipping
  // through in a dodge). Also each step of the player's own move (player.js), so a quick one does not go
  // through a body in one frame
  blockPlayer(fx, fy, player, targets = this.allTargets()) {
    const dodging = player.dodging;
    for (const e of targets) {
      if ((e.state === 'act' && e.act?.kind === 'dash') || (e.lift || 0) > 0.3) continue;    // (it runs / comes down through)
      const dx = fx - e.fx, dy = fy - e.fy;
      const d = Math.hypot(dx, dy), min = e.r + BODY_R;
      if (!(d < min)) continue;
      if (dodging) { this.passing.add(e); continue; }
      if (this.passing.has(e)) continue;
      if (d > 1e-4) { fx = e.fx + dx / d * min; fy = e.fy + dy / d * min; }
    }
    return [fx, fy];
  }

  updatePopups(dt) {
    for (const p of this.popups) {
      p.t += dt;
      p.sprite.position.y += dt * 0.5;
      p.sprite.material.opacity = Math.max(0, 1 - p.t / 1.1);
    }
    this.popups = this.popups.filter(p => {
      if (p.t < 1.1) return true;
      this.root.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose();
      return false;
    });
  }
  // a step on the map (player.js) - VX Ace's on_player_walk: a damage floor (a poison swamp) takes 10 HP (times the floor
  // damage rate; not the last one); every 20 steps HP / MP regenerate or slip away (in a fight it goes by time);
  // states that wear off by walking count down; the stealth counts down
  onPlayerStep() {
    const actor = G.state?.party?.leader();
    if (!actor || this.playerDead) return;
    const pc = G.map.playerChar;
    if (G.map.grid?.isDamage(pc.x, pc.y)) {
      const v = Math.min(Math.trunc(10 * actor.fdr), Math.max(0, actor.hp - 1));
      if (v > 0) { actor.hp -= v; this.slipHurt(v); }
    }
    if (!this.inCombat && G.state.party.steps % 20 === 0) this.regenerateNow(actor);
    const timers = G.state.system.stateTimers;
    for (const id of actor.walkStep()) if (timers) delete timers[id];
    if (G.state.system.stealthSteps > 0) G.state.system.stealthSteps--;
  }
  // script 141's cool-down shortened from an event ($game_temp.actor_loss_cool_time(n) - 토끼의 회중시계 5 turns,
  // 정신 통일 all of them, 리로드 one): n turns (COOL_TURN each) off the player's / the enemies'
  lossCoolTime(kind, n) {
    if (kind === 'actor') { for (const k of Object.keys(this.skillCD)) this.skillCD[k] -= n * COOL_TURN; }
    else for (const e of this.enemies) for (const k of Object.keys(e.cool || {})) e.cool[k] -= n * COOL_TURN;
  }
  // the stealth (안 보이는 후추, 보이지 않는 몸): the hands and what they hold are half see-through while it lasts
  updateGhost() {
    const on = (G.state?.system?.stealthSteps || 0) > 0;
    const objs = [this.weapon, this.shield, this.held?.fx, this.ready?.fx, ...(G.hands?.roots?.() || [])].filter(Boolean);
    const key = on ? objs.map(o => o.uuid).join(',') : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    for (const o of this.ghosted || []) if (!objs.includes(o) || !on) ghostify(o, false);
    this.ghosted = on ? objs : [];
    for (const o of this.ghosted) ghostify(o, true);
  }
  randomEncounterTroop() { return 0; }
  enemyParam(index, param, interp) {
    const b = this.battleOf(interp);
    const e = b?.enemies.find(x => x.memberIndex === index);
    if (!e) return 0;
    return param === 0 ? e.b.hp : param === 1 ? e.b.mp : e.b.param(param - 2);
  }
}

// the boss moves of src/bossmoves.js (a far orb, a blink chain, a turning star, a lattice, bands, a cloak's leap; the wind's lift)
Object.assign(CombatSystem.prototype, bossMoves);
