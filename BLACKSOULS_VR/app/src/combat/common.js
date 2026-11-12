// What the fights (combat.js and its parts in combat/) share: the tuning numbers of blows, guards, stamina and boss moves,
// helpers (a segment against a segment, a body against a blade), the enemy battler and its body on the map (ActionEnemy),
// a fight (Battle), the weapon and shield models the player holds.
import * as THREE from 'three';
import { loadCanvas } from '../assets.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { BattlerBase, LB_ENEMY } from '../state.js';
import { FloorMarker } from '../telegraph.js';
import { FONT } from '../ui.js';
import { getAdjust, resetAdjust, setAdjust } from '../weapons.js';
import { userHoldsPlace } from '../userrules.js';
import { builtinRules } from '../maphints.js';

G.weaponAdjust = { get: getAdjust, set: setAdjust, reset: resetAdjust };
// items used by hand in VR: the herb bottles go to the mouth, the syringes (수혈액) into the body
export const HERB_ICONS = [635, 636];
export const SYRINGE_ICON = 649;

// how hard a VR swing must be to count (setting 휘두르기 판정): blade-tip speed in m/s, and how far the
// tip must have travelled in the last ~0.14 s (a real arc, not a flick of the wrist)
export const SWING_LEVELS = [[2.6, 0.2], [3.4, 0.28], [4.4, 0.36], [5.4, 0.45]];
// a guard raised this soon before the blow lands is a perfect guard: no damage and a fifth of the HP back, then
// for a few seconds stronger blows and DEF / MDF two buff levels up (x1.5, the game's own buff rate)
export const PERFECT_GUARD = 0.25, POWER_BUFF = { mult: 1.5, time: 5 }, GUARD_BUFF = { level: 2, heal: 0.2 };
// once lowered, the guard comes up again only this much later (s; held down, it stays up - and after a perfect
// guard it may come up again at once). The guns with Gun Break cannot guard: a Gun Break that hits an enemy whose
// blow - one a guard could stop - is this close to landing on the player (s) is their perfect guard, and their
// next Gun Break is ready at once
export const GUARD_COOLDOWN = 0.5, GUN_PARRY = 0.35;
export const DESK_ACT = 0.3;          // (PC) a shot, a cast or a throw let go keeps the hands busy this long: the guard down (handsBusy)
export const DESK_SWING = 0.32;       // (PC) s a click's blow takes (its hits from a quarter of the way to over two thirds of it)
// stamina: a blow taken on the guard costs GUARD_STAMINA (a VR blade taken on the shield half of it, turned aside by its
// slant a fifth); a dodge DODGE_STAMINA; running in a fight RUN_STAMINA a second, none coming back meanwhile - run out,
// one walks until RUN_AGAIN has come back. Struck at by another player (PvP), one is in a fight for PVP_FIGHT s after
export const GUARD_STAMINA = 0.05, DODGE_STAMINA = 0.15, RUN_STAMINA = 0.15, RUN_AGAIN = 0.3, PVP_FIGHT = 8;
// a blow of one's own: a PC click's, a VR swing that lands, a charged one (each / the weapon's pace - weaponPace)
export const BLOW_STAMINA = 0.1, BLOW_STAMINA_VR = 0.08, CHARGED_STAMINA = 0.2;
// none comes back while the guard is up - a perfect guard gives PERFECT_STAMINA back at once. (PC) a click a moment
// early - a blow or a stagger still ending, a shot not ready - is kept INPUT_BUFFER s and taken as soon as it can be
export const PERFECT_STAMINA = 0.3, INPUT_BUFFER = 0.3;
// run out - EMPTY_STAMINA or less left: too little for a blow, a dodge or a guard (the level they ask for) - none
// comes back for EMPTY_WAIT s from that moment, a short pause (the user's wish, 2026-11-12)
export const EMPTY_STAMINA = 0.05, EMPTY_WAIT = 1.5;
// a weapon's weight (weaponPace): what it does to 민첩 - 1 + its AGI / 200, or the square root of an AGI rate it puts on -
// kept within PACE_MIN..PACE_MAX (1: a weapon that leaves AGI be, as before). A light one (above 1) swings quicker (PC:
// its blow takes DESK_SWING / pace) and costs less stamina a blow (/ pace); a heavy one the other way - and in VR its
// blade is the harder to swing and sags (weaponlag.js weaponSway)
export const PACE_MIN = 0.65, PACE_MAX = 1.35;
// (PC) how fast one's blows come (blowRate - a blow takes DESK_SWING / (pace * rate)): a weapon that does nothing to 민첩 or
// takes some (pace up to 1) at SLOWER_BLOWS of its pace, a light one (above 1: the daggers, claws, knuckles, saws...) at
// LIGHT_BLOWS of its; a 민첩 buff (요정의 날개, 퀵 무브, 절영... two levels at most) quickens every weapon's BLOW_QUICKEN a level,
// two bringing a plain or heavy one back to its old speed. VR: none of it - the arm sets the pace, a limit on it halves the fun
// (the user's experience); the same one is hit again no sooner than HIT_AGAIN there (one swing passing through it is one blow)
export const SLOWER_BLOWS = 0.8, LIGHT_BLOWS = 0.9, BLOW_QUICKEN = 1 / Math.sqrt(SLOWER_BLOWS), HIT_AGAIN = 0.45;
export function blowRate(pace, agiBuff) {
  return (pace > 1 ? LIGHT_BLOWS : SLOWER_BLOWS) * BLOW_QUICKEN ** THREE.MathUtils.clamp(agiBuff || 0, 0, 2);
}
// (PvP) super armor (강인도) holds only while attacking (attacking): POISE_ATTACK / pace^2.2 - a plain weapon's 0.35,
// broken by one light blow; the heaviest's 0.9, by about two plain ones; a light one's less - and not attacking only
// POISE_IDLE: any one blow breaks it, a light one's a heavy weapon's too. The blows of a player that land wear it by
// their weapon's POISE_HIT / pace (1.5 times charged); worn through, one is staggered (stagger: STAGGER_T s of no attack,
// guard, dodge, item or skill) and the wear is gone; through the stagger and STAGGER_GUARD s after nothing wears it
// (no stun-lock). Not struck for POISE_REGEN s, the wear is gone too
export const POISE_HIT = 0.5, POISE_ATTACK = 0.35, POISE_IDLE = 0.2, STAGGER_T = 0.6, STAGGER_GUARD = 0.4, POISE_REGEN = 3;
// (PvP) a light weapon's (pace above 1) swung blow taken square on a shield bounces off: its holder is staggered for
// BOUNCE_T s (shorter than a hit's), with no stronger super armor after - an opening for the one who took it
export const BOUNCE_T = 0.35;
// (PC) the shield up before the eyes while the guard is up; otherwise down on the relaxed left arm at the side, its face
// out (a little forward) - in the body's own space (deskBody): out of view ahead (the largest too), seen looking down,
// where the others see it
export const DESK_SHIELD_UP = { p: new THREE.Vector3(-0.32, -0.32, -0.5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + 0.3, 0)) };
export const DESK_SHIELD_DOWN = { p: new THREE.Vector3(-0.55, -0.8, 0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 - 0.26, 0)) };
export const PITCH_AXIS = new THREE.Vector3(1, 0, 0), _shP = new THREE.Vector3(), _shQ = new THREE.Quaternion();
// how long a boss rests between two of its own moves (s, random between)
export const BOSS_MOVE_REST = [2.5, 5];
export const FOLLOW_REST = 0.3;          // the breath between an action and the one it goes on with (使用後追加行動)
// how fast a boss's charge runs (m/s)
export const CHARGE_SPEED = 36;
// a boss's attacks cover more ground than anyone else's (m): its plain blow reaches this far beyond its body, its
// sure-hit circle (purple) is this wide around it, and it starts a blow from this far off
export const BOSS_AREA = { reach: 10, certain: 14, start: 4.5 };
// a boss's eruptions under the player (pursuit): one every gap s, each bursting fuse s after it is laid, this wide
export const PURSUIT = { gap: 0.5, fuse: 0.85, r: 1.8 };
// a boss's pools (field): this wide (m), lasting time s, hurting every tick s
export const POOL = { r: 2.6, time: 5.5, tick: 1 };
// how long a state that leaves an enemy open to Break (charging up, guarding, a counter stance) does so (s) - a
// boss's, shorter still
export const BREAK_WINDOW = 1.5, BREAK_WINDOW_BOSS = 0.8;
// a turn of a skill's cool-down (<クールタイム:n>, script 141) for enemies and companions - as for the player (s)
export const COOL_TURN = 1.5;
// a boss's healing (수혈액, 소울의 빛, 재생...): never again within BOSS_HEAL_REST s, and when its pattern would
// have it, only this often - far rarer than the original (the user's wish)
export const BOSS_HEAL_REST = 45, BOSS_HEAL_PASS = 0.3;
// a skill's cool-down in turns (script 141), 0 for none
export function coolTurns(s) {
  if (!s) return 0;
  if (s._coolTurns === undefined) { const m = /<クールタイム[：:]\s*(\d+)\s*>/.exec(s.note || ''); s._coolTurns = m ? +m[1] : 0; }
  return s._coolTurns;
}
// a boss's charge that runs into the player throws them this far along its way (m); one landing on them from a
// leap sends them up at this speed (m/s: a little higher than the player's own jump, 3.1)
export const CHARGE_KNOCK = 2.2, LEAP_LAUNCH = 3.5;
export const PARRY_SLIDE = 0.6;            // m: a charge met with a perfect guard still pushes the player back this far
// the player's body, as the enemies meet it (tiles; the same as against walls, player.js)
export const BODY_R = 0.22;
// a boss's whirl: how far it turns away as it winds up (rad), how many turns it makes and for how long (s)
export const SPIN_COIL = 1.1, SPIN_TURNS = 4, SPIN_TIME = 1.8;
// the whirl's turn at time t of it: from the coiled pose, faster and faster, slowing to face the player at the end
export function spinAngle(t) {
  return -SPIN_COIL + (SPIN_TURNS * Math.PI * 2 + SPIN_COIL) * THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(t / SPIN_TIME, 0, 1), 0, 1);
}
// a picture turned by angle a (seen from the front: cos a wide, mirrored while its back is round; never quite a line)
export function turnWidth(a) { const c = Math.cos(a); return Math.sign(c || 1) * Math.max(0.06, Math.abs(c)); }
// groggy (in place of the weapons' stun, which kept enemies helpless blow after blow): every enemy that can be stunned has a
// gauge from its stats - (ATK + DEF + MDF) / 3, a little more the bigger it is (max HP^0.25) and the less it can be stunned
// (/ sqrt of its stun rate); stun-proof ones have none. A blow carrying the attacker's weapon states (the "normal attack"
// effect) takes the attacker's ATK from it (MAT for a magic one) times how hard it hit, a little more for a weapon that
// stunned (+40% at 100%), never more than a tenth of the gauge in one attack. With no blow for 3 s it fills 5% a second.
// Emptied, the enemy is broken as by a Break, and it is full again when the enemy gets up
export const GROGGY = { k: 20, stun: 0.4, cap: 0.1, delay: 3, regen: 0.05 };
// the one sound of a Break (or a groggy gauge) that lands - the user's choice: the game's own 金属 (1) at half pitch, from
// where it starts (its first 0.07 s are silent, twice that slowed down)
export const BREAK_SE = { name: '金属 (1)', volume: 100, pitch: 50, from: 0.07 };
export const STUN = 13;
// an enemy's thrown bottle / jar / mud is in the air this long before it lands (s), and its shots from a gun fly this
// fast (m/s)
export const LOB_FLIGHT = 0.55, GUN_SPEED = 34;
// Gun Break: how far the shot carries (m) - it goes through every enemy on its line, up to a wall
export const GUN_BREAK_RANGE = 24;
// the player's own buffs (a resin, a skill) wear off like in a battle of the original: a turn is 6 s, as for
// troop pages (a resin: 10 turns = 60 s)
export const TURN_SECONDS = 6;
// an enemy's turn, for its states and buffs (원작 턴 수 × 2초)
export const ENEMY_TURN = 2;
// 흑기사 린다메아 in her duel (inDuel): everything she does this much quicker - wind-ups, rests, her moves' steps, her running
export const DUEL_PACE = 2;
// skills whose cool-down turns are the player's real turns (TURN_SECONDS each, as long as the states they give last) -
// not the quick COOL_TURN: else the state outlasts the cool-down and stays up for good. Up as often as in the original:
// 진혼가 138 (death resisted 3 turns = 18 s, cool-down 8 turns = 48 s), 절대 필중 603, 성기사의 깃발 847, 고기방패 소환 836;
// the weapons' 기사의 긍지 93, 광전사의 포효 82, 잔심 102, 마나 리제네 26, 광기가 부르는 소리 497, 도살 개시 600,
// 그랜드 챌린지 971, 퀵 드로우 159 (the companions' own and the skills that grow by stages stay as they were)
export const FULL_TURN_COOL = new Set([138, 603, 847, 836, 93, 82, 102, 26, 497, 600, 971, 159]);
// skills that grow a stage a use (script 195 <ステート変化>), one a turn in the original: one a TURN_SECONDS here - each
// use keeps the next away so long. 씩성난 분노 469 (its stages 470-478: the tenth, a blow on all of atk x 100)
export const STAGE_TURNS = [469];
// a resin (송진) held in the left hand goes onto the weapon after this much rubbing along it (m)
export const RESIN_RUB = 0.3;
export const ELEMENT_SE = { fire: 'Fire1', ice: 'Ice1', thunder: 'Thunder1', dark: 'Darkness1', light: 'Saint1' };
// thrown items: knives fly straight and fast (m/s); anything else goes in an arc (gravity m/s2); a pot landing on the
// floor right beside an enemy still gets it (m beyond its body); the held / flying models' size (blade, bottle)
export const KNIFE_SPEED = 32, THROW_GRAVITY = 9.8, THROWN_SPLASH = 0.6, KNIFE_SCALE = 0.75, THROWN_SCALE = 0.23;
export const FORWARD = new THREE.Vector3(0, 0, -1), TUMBLE_AXIS = new THREE.Vector3(1, 0, 0);
// brightness of flashes / glows (setting 이펙트 밝기)
export const fxk = () => THREE.MathUtils.clamp(G.settings.fxBrightness ?? 0.5, 0.1, 1);
export const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpColor = new THREE.Color();
export const tmpHead = new THREE.Vector3(), tmpRigQ = new THREE.Quaternion();
// distance from (px, py) to the segment (ax, ay)-(bx, by)
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 > 1e-9 ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}
// how far along a step from (ax, ay) to (bx, by) a body first comes within r of (cx, cy): 0..1 (1: never)
export function firstContact(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (a < 1e-9 || disc < 0) return 1;
  return THREE.MathUtils.clamp((-b - Math.sqrt(disc)) / (2 * a), 0, 1);
}
// several marks laid down for one move (a rain of blows, a fan of shots): each fills toward its own moment and
// goes when its part has landed
export class MarkerSet {
  constructor(parent, specs) { this.list = specs.map(s => new FloorMarker(parent, s)); }
  release(i, fading) { const m = this.list[i]; if (m && !m.released) { m.released = true; fading.push(m); } }
  fadeOut(dt) { let done = true; for (const m of this.list) if (!m.released && m.parent && !m.fadeOut(dt)) done = false; return done; }
  dispose() { for (const m of this.list) if (!m.released && m.parent) m.dispose(); }
}
// a point as seen from the head, in the rig's frame: moving with the stick, turning, or taking real
// steps carries the head and the hands together, so what changes here is only the arm's own motion
export function bodyRelative(p, out) {
  const rig = G.player.rig;
  rig.updateWorldMatrix(true, false);
  out.copy(p).sub(G.player.headWorld(tmpHead));
  return out.applyQuaternion(rig.getWorldQuaternion(tmpRigQ).invert());
}

// a thing made half see-through (the stealth) or back as it was: its opaque materials only (a glow keeps its own)
export function ghostify(root, on) {
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
export function difficultyRate(row) {
  const d = G.scripts?.difficulty;
  if (!d) return 1;
  return d.rows[row]?.[G.state?.v(d.variable) || 0] ?? 1;
}
export class EnemyBattler extends BattlerBase {
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
export const battlerCache = new Map();
export function battlerTexture(name, hue) {
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
export function drawnHalfWidth(c) {
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

export function textSprite(text, color = '#fff', size = 64) {
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
export const BLADE_R = 0.035;                     // m: a blade's half thickness
export const clashInv = new THREE.Matrix4();
// the closest points of segments p1-q1 and p2-q2: [their distance, the point between them]
export function segSeg(p1, q1, p2, q2) {
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
export function segBox(a, b, box, r) {
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
export function bladeMeets(s, b0, t0, b1, t1, strong) {
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
export const WTYPE = { AXE: 1, CLAW: 2, SPEAR: 3, SWORD: 4, KATANA: 5, BOW: 6, DAGGER: 7, MACE: 8, STAFF: 9, GUN: 10 };
// What a weapon shoots on the trigger (PC: a click), if anything - a gun's bullet or a bow's arrow - by its kind, and a
// few by their icon (the same for their +1..+9): 거룩한 총검 a gun (its blow is a stab and then a shot of the bullet
// loaded in the original - the trigger fires that shot, gunShotSkill; in VR a swing still strikes with it), 광기의 활
// 접접 a bow (filed with the swords), 거대 철구 nothing (filed with the guns, but swung - the original's club animation;
// its blow is on all enemies), 메리의 지팡이 its magic (its blow is a sure hit on all enemies, not a swing of the staff).
// The other staffs swing (마술사, 만상, 르뤼에 - their blow is the plain attack with the staff's own animation; 심해의
// 기사의 닻 is filed with them)
export const SHOT_BY_ICON = { 796: 'gun', 779: 'bow', 426: null, 422: 'magic' };
// 메리의 지팡이's orb (its blow, S967, is on all enemies): it bursts where it lands - an enemy, the floor, a wall - its
// blow on all within this reach (m), the reach shown (staffBurst)
export const STAFF_BURST = 2.6;
export const BURST_GAP = 0.08;          // s between the bullets of a burst
// a weapon's pace (PACE_MIN..PACE_MAX, 1: none) from what it does itself to AGI - not the wearer's own AGI
export function weaponPace(item) {
  if (!item) return 1;
  let p = 1 + (item.params?.[6] || 0) / 200;
  for (const f of item.features || []) if (f.code === 21 && f.data_id === 6 && f.value > 0) p *= Math.sqrt(f.value);
  return THREE.MathUtils.clamp(p, PACE_MIN, PACE_MAX);
}
export function shotStyle(item) {
  if (!item) return null;
  // (those four BLACK SOULS II's, by their icons: with the launcher's switch for that game's rules off, by their filing)
  if (builtinRules() && item.icon_index in SHOT_BY_ICON) return SHOT_BY_ICON[item.icon_index];
  return item.wtype_id === WTYPE.GUN ? 'gun' : item.wtype_id === WTYPE.BOW ? 'bow' : null;
}
// a shield's size (m across) by its guard effect - the original's 방어효과율【소】【중】【대】【특대】, its guard rate
// (GRD) 1.5 / 2 / 2.5 / 3: 【소】 the size a shield always had (weapons.js), the others bigger in step; 0: none (it
// is drawn by its kind, a great shield or not - weapons.js)
export function shieldSpan(armor) {
  const grd = (armor?.features || []).filter(f => f.code === 23 && f.data_id === 1).reduce((r, f) => r * f.value, 1);
  return grd >= 2.95 ? 0.88 : grd >= 2.45 ? 0.72 : grd >= 1.95 ? 0.585 : grd >= 1.45 ? 0.45 : 0;
}
export function makeWeaponMesh(wtype) {
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
export function makeShieldMesh(large) {
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
// those who hold their place in a fight, by their battle picture: they never walk, are never knocked back or pushed aside by the
// crowd, and do what they do from where they stand (enemies.js: stationary). 허무의 소녀 메이벨: her every skill is a gesture -
// staring, laughing, playing chess, spinning, yawning - or her parting line; she fights by the gods she calls up (troop 627) and
// stands in the middle of her room the while, as in the original (the user's call, 2026-11-11). By the picture: the same in every
// language, and another game's enemy of that number is not touched. The player's own rule for an enemy (the rule editor -
// userrules.js: holds its place, or does not) comes first
export const HOLDS_PLACE = ['メイベル'];
// (BLACK SOULS II's own - by its pictures' names: none with the launcher's switch for that game's rules off; the player's own
// rule either way)
export const holdsPlace = enemyId => userHoldsPlace(enemyId) ?? (builtinRules() && HOLDS_PLACE.includes($data.enemies[enemyId]?.battler_name));
export let netSeq = 0;                  // (co-op: the number the players share for one enemy body - coop.js)
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
    this.stationary = holdsPlace(enemyId);
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
    // HP bar
    const bar = document.createElement('canvas'); bar.width = 128; bar.height = 22;      // (HP, and the groggy gauge under it)
    this.barCanvas = bar;
    this.barTex = new THREE.CanvasTexture(bar);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
    this.bar.scale.set(0.7, 0.09 * 22 / 16, 1);
    this.bar.position.y = h + 0.18 - 0.09 * 3 / 16;
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
    const ctx = this.barCanvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = this.state === 'stagger' ? '#ffd040' : '#c02424';
    ctx.fillRect(2, 2, 124 * Math.max(0, this.b.hp / this.b.mhp), 12);
    // the groggy gauge (what is left of it), for an enemy that has one
    const gmax = this.sys?.groggyMax ? this.sys.groggyMax(this) : 0;
    if (gmax) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 16, 128, 6);
      ctx.fillStyle = '#ece0b4';
      ctx.fillRect(2, 17, 124 * Math.max(0, this.grog / gmax), 4);
    }
    this.barTex.needsUpdate = true;
  }
  // (lift: off the floor - a boss in the middle of a leap)
  worldPos(target = new THREE.Vector3()) { return target.set((this.fx + 0.5) * T, (G.floorAt ? G.floorAt(this.fx, this.fy) : 0) + (this.lift || 0), (this.fy + 0.5) * T); }
  remove() {
    this.sys.root.remove(this.group);
    this.mesh?.geometry.dispose(); this.mat?.dispose();
    this.cueRing?.geometry.dispose(); this.cueRing?.material.dispose();
    for (const gh of this.ghosts || []) gh.g.material.dispose();
    this.balloon?.dispose();
    this.aura?.material.dispose();
    for (const s of this.sparks || []) s.material.dispose();
  }
}

// ------------------------------------------------------------------ battle
export class Battle {
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
export function symbolPage(p) {
  return !!p && [1, 2].includes(p.trigger) && (p.list || []).some(c => c.code === 301) &&
    (p.move_route?.list || []).some(mc => mc.code === 45 && /enable_symbol_encount\(\d+\)/.test(mc.parameters?.[0] || ''));
}
