// Companions: the party members besides the leader. In BLACKSOULS II these are mostly dream spirits (몽령)
// summoned from a book for one boss fight (they join at its first turn and leave when struck down or when it
// is over), the meat shield the player summons, and a few who walk along for a while (Prickett's date). The
// original fights them as auto-battle actors in its turn-based battles; here they stand in the world - the
// picture the summoning book shows, a battle picture of the same one, their character sheet, or (the meat
// shield) their face - follow the player, fight the enemies of the fight with their own skills and get hit.
// One without auto-battle (Prickett) only walks along.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { loadCanvas } from '../data/assets.js';
import { T } from '../world/mapmesh.js';
import { evalFormula } from '../game/rubyexpr.js';
import { resolveCircle, lineOfSight } from '../world/collision.js';
import { sheetInfo } from './sprites.js';
import { usableRepeats } from '../combat/usable-counts.js';

// how each looks. book: the picture(s) its summoning book shows (Graphics/Pictures) - [name, metres to the side,
// metres back], a group laid out as the book lays it out; battler: a battle picture of the same one; chip: a
// character sheet [name, index] (else its own); face: [name, index]; with: actors that are one body with it
// (Pinocchio and his doll: one picture, two HP); partOf: such an actor (its own look only without the other)
const LOOK = {
  50: { book: [['夢霊　アヒル']] },                                    // the ugly duckling
  51: { book: [['夢霊　ヘングレ (1)']] },                              // Hansel
  52: { book: [['夢霊　ヘングレ (2)']] },                              // Gretel
  53: { book: [['夢霊　シンドバッド']] },
  54: { book: [['夢霊ブレーメン４', 0, 0.9], ['夢霊ブレーメン３', -1, 0], ['夢霊ブレーメン２', 0, 0], ['夢霊ブレーメン', 1, 0]] },   // the Bremen musicians
  55: { book: [['夢霊ハンス']] },                                      // Iron Hans
  56: { book: [['夢霊パトラッシュ']] },
  57: { book: [['夢霊カタリナ']] },
  58: { book: [['夢霊　星の王子様']] },
  59: { book: [['鎧を履いた騎士']] },                                  // the knight in armour
  64: { book: [['夢霊　ロバ']] },                                      // the donkey king
  65: { book: [['あしながおじさん']] },                                // daddy-long-legs
  66: { book: [['イナバ']] },                                          // Vernai
  68: { book: [['夢霊　ロビン']] },
  100: { book: [['夢霊　ピノッキオ']], with: [101] },                  // Pinocchio, his doll in his picture
  101: { partOf: 100, chip: ['人形', 6] },
  60: { battler: 'パンプキン' },                                       // the pumpkin knight (Liddell's graveyard)
  67: { battler: 'boss15' },                                          // Red Riding Hood
  69: { battler: 'boss14' },                                          // Mary
  107: { battler: 'boss19' },                                         // Merryphilia (the ghouls' nest)
  108: { battler: 'ハイン' },                                          // Hein (the black conductor, Hanover station)
  13: { chip: ['$ポロ', 0] },                                          // Polo
  61: { chip: ['グリフィ', 0] }, 71: { chip: ['グリフィ', 0] },          // Griffy
  62: { chip: ['$ハンプティ', 0] },
  111: { face: ['niku', 0], wall: 2.6 },                              // the meat shield: a big wall of it
};
const BODY = 0.3;               // metres: how wide one is, for blows and shots
const TURN = 6;                 // s: a turn of the original's battles (combat.js TURN_SECONDS)
const MAX_ALLIES = 3;           // VX Ace fights with four: the leader and three
const WINDUP = 0.38;            // s before a blow lands

const tmpV = new THREE.Vector3();
const pick = list => list[Math.floor(Math.random() * list.length)];
const toEnemy = s => s.scope >= 1 && s.scope <= 6;
const toFriend = s => s.scope >= 7 && s.scope <= 11;
const inParty = id => !!G.state?.party.actors.includes(id);
// a spot one can stand on: the spot itself, else the middle of the nearest cell (within 3) that one can - where a
// companion keeps or fights from is never inside a wall, though it walks through walls to get there
function standable(fx, fy) {
  const m = G.map, ok = (x, y) => m.walkable(m.wrapX(x), m.wrapY(y));
  const x0 = Math.round(fx), y0 = Math.round(fy);
  if (!m?.grid || ok(x0, y0)) return [fx, fy];
  let best = null, bd = Infinity;
  for (let r = 1; r <= 3 && !best; r++) {
    for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== r || !m.grid.valid(m.wrapX(x), m.wrapY(y)) || !ok(x, y)) continue;
      const d = Math.hypot(x - fx, y - fy);
      if (d < bd) { bd = d; best = [x, y]; }
    }
  }
  return best || [fx, fy];
}

// one body standing in the world: a companion (or two that are one body)
class Ally {
  constructor(sys, id) {
    this.sys = sys; this.id = id;
    const a = $data.actors[id];
    const look = LOOK[id] || (a?.character_name ? { chip: [a.character_name, a.character_index] } : { face: [a?.face_name || '', a?.face_index || 0] });
    this.look = look;
    this.ids = [id, ...(look.with || [])];
    this.group = new THREE.Group();
    this.group.visible = false;
    sys.root.add(this.group);
    this.parts = [];                 // { mesh, mat }
    this.chip = null;
    this.h = 1.7;
    this.fx = 0; this.fy = 0; this.placed = false;
    this.dir = [0, 1];               // its facing on the map
    this.walk = 0; this.moving = false;
    this.cool = 0.8 + Math.random(); this.intent = null; this.act = null;
    this.target = null; this.retarget = 0;
    this.appear = 0; this.leaving = false; this.gone = false;
    this.hurt = 0; this.lunge = 0; this.fallen = 0;
    this.noticed = new WeakMap();    // enemy marks it has seen (and how soon after they came down)
    this.wall = look.wall || 0;
    this.r = this.wall ? this.wall * 0.4 : BODY;
    this.ready = this.build().catch(e => console.warn('companion look', id, e));
  }
  // its actors that are in the party (living first)
  members() { return this.ids.filter(inParty).map(id => G.state.actor(id)).filter(Boolean); }
  living() { return this.members().filter(a => a.hp > 0); }
  get actor() { return this.living()[0] || this.members()[0] || null; }
  get alive() { return this.living().length > 0; }
  // fights (auto-battle actors), or only walks along
  get fighter() { return this.members().some(a => a.featuresSet(62).includes(0)); }
  get stands() { return this.placed && !this.leaving && !this.gone; }
  worldPos(out = new THREE.Vector3()) {
    return out.set((this.fx + 0.5) * T, G.floorAt ? G.floorAt(this.fx, this.fy) : 0, (this.fy + 0.5) * T);
  }
  chest(out = new THREE.Vector3()) { this.worldPos(out); out.y += this.h * 0.6; return out; }

  async build() {
    const L = this.look;
    let ok = false;
    if (L.book) for (const [name, side = 0, back = 0] of L.book) ok = (await this.addPicture('Graphics/Pictures', name, side, back, L.book.length > 1)) || ok;
    else if (L.battler) ok = await this.addPicture('Graphics/Battlers', L.battler, 0, 0, false);
    else if (L.face) ok = await this.addFace(L.face[0], L.face[1], this.wall || 1.2);
    if (!ok) {
      const a = $data.actors[this.id];
      const [name, index] = L.chip || [a?.character_name, a?.character_index];
      if (name) ok = await this.addChip(name, index || 0);
      if (!ok && a?.face_name) await this.addFace(a.face_name, a.face_index, 1.2);
    }
    // the HP of each of its actors, over its head while there is a fight
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 4 + 14 * this.ids.length;
    this.barCanvas = cv;
    this.barTex = new THREE.CanvasTexture(cv);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
    this.bar.scale.set(0.7, 0.7 * cv.height / 128, 1);
    this.bar.center.set(0.5, 0);
    this.bar.renderOrder = 1400;
    this.bar.visible = false;
    this.group.add(this.bar);
    this.drawBar();
  }
  // a picture standing up as it is drawn (as an enemy's battle picture stands): a book's group keeps its sizes
  async addPicture(folder, name, side, back, group) {
    const c = await loadCanvas(folder, name, 0);
    if (!c || this.gone) return false;
    const h = group ? c.height / 105 : THREE.MathUtils.clamp(c.height / 105, 1.4, 4.2);
    const w = h * c.width / c.height;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, emissive: 0x000000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(side, 0, -back);
    this.body().add(mesh);
    this.parts.push({ mesh, mat });
    this.h = this.parts.length > 1 ? Math.max(this.h, h) : h;
    return true;
  }
  async addFace(name, index, size) {
    const c = name && await loadCanvas('Graphics/Faces', name, 0);
    if (!c || this.gone) return false;
    const cols = Math.max(1, Math.floor(c.width / 96)), rows = Math.max(1, Math.floor(c.height / 96));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(1 / cols, 1 / rows);
    tex.offset.set((index % cols) / cols, 1 - (Math.floor(index / cols) + 1) / rows);
    const geo = new THREE.PlaneGeometry(size, size);
    geo.translate(0, size / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, emissive: 0x000000 });
    const mesh = new THREE.Mesh(geo, mat);
    this.body().add(mesh);
    this.parts.push({ mesh, mat });
    this.h = size;
    return true;
  }
  // a character sheet, walking and turning as the map's people do
  async addChip(name, index) {
    const c = await loadCanvas('Graphics/Characters', name, 0);
    if (!c || this.gone) return false;
    const info = sheetInfo(name, c);
    const scale = info.object ? 1.0 : 1.25;
    const w = info.fw / 32 * T * scale, h = info.fh / 32 * T * scale;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.repeat.set(info.fw / c.width, info.fh / c.height);
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, emissive: 0x000000 });
    const mesh = new THREE.Mesh(geo, mat);
    this.body().add(mesh);
    this.chip = { info, tex, index, w: c.width, h: c.height };
    this.parts.push({ mesh, mat });
    this.h = h;
    return true;
  }
  body() {
    if (!this.bodyGroup) { this.bodyGroup = new THREE.Group(); this.group.add(this.bodyGroup); }
    return this.bodyGroup;
  }
  drawBar() {
    const cv = this.barCanvas;
    if (!cv) return;
    const list = this.ids.map(id => (inParty(id) ? G.state.actor(id) : null));
    const key = list.map(a => (a ? `${a.hp}/${a.mhp}` : '-')).join(',');
    if (key === this.barKey) return;
    this.barKey = key;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    list.forEach((a, i) => {
      if (!a) return;
      const y = 2 + i * 14;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, y, 128, 12);
      ctx.fillStyle = '#3fbf5f'; ctx.fillRect(2, y + 2, 124 * Math.max(0, a.hp / Math.max(1, a.mhp)), 8);
    });
    this.barTex.needsUpdate = true;
  }
  dispose() {
    this.gone = true;
    this.sys.root.remove(this.group);
    this.group.traverse(o => { if (o.isMesh || o.isSprite) { o.material.map?.dispose(); o.material.dispose(); if (o.isMesh) o.geometry.dispose(); } });
  }

  // first comes in: behind the player (the meat shield: right in front, where it was summoned, to stay)
  place(ctx) {
    const f = G.player.forward2D(), pc = ctx.pc;
    if (this.wall) {
      [this.fx, this.fy] = resolveCircle(pc.fx + f.x * 2.2 / T, pc.fy + f.z * 2.2 / T, 0.3);
      this.dir = [-f.x, -f.z];
    } else {
      const [sx, sy] = this.slot(ctx);
      [this.fx, this.fy] = resolveCircle(sx, sy, 0.25);
      this.dir = [f.x, f.z];
    }
    this.placed = true;
    this.appear = 0;
    G.combat?.spawnGlow?.(this.worldPos(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), { color: 0xd8e8ff, size: 1.2, life: 0.5, grow: 1.6 });
  }
  // where it keeps while walking along: a little behind the player, side by side with the others
  slot(ctx) {
    const f = G.player.forward2D(), pc = ctx.pc;
    const side = (ctx.slotOf(this) - (ctx.walking - 1) / 2) * 1.3;
    return standable(pc.fx + (-f.x * 1.7 - f.z * side) / T, pc.fy + (-f.z * 1.7 + f.x * side) / T);
  }

  update(dt, ctx) {
    if (!this.members().length && !this.leaving) return;
    const pc = ctx.pc;
    // a looping map: where it is nearest the player
    if (G.map.loopX) this.fx = G.map.nearX(this.fx, pc.fx);
    if (G.map.loopY) this.fy = G.map.nearY(this.fy, pc.fy);
    if (!this.placed) this.place(ctx);
    this.moving = false;
    if (!ctx.paused && !this.leaving) {
      if (this.push) this.pushed(dt);
      if (!this.alive) this.intent = this.act = null;
      else this.think(dt, ctx, !this.wall && !this.push);
    }
    this.show(dt, ctx);
  }
  // fight when there is a fight (and it is a fighter), else walk along
  think(dt, ctx, canMove) {
    const fighting = ctx.fighting && this.fighter;
    if (fighting) {
      this.retarget -= dt;
      if (!this.target?.alive || this.target.hidden || !this.target.battle || this.retarget <= 0) {
        this.target = this.nearestEnemy(ctx);
        this.retarget = 2 + Math.random();
      }
    } else { this.target = null; this.intent = null; }
    if (this.act) {
      this.act.t += dt;
      if (!this.act.done && this.act.t >= WINDUP) {
        this.act.done = true;
        // (a state of its own may turn the skill into another - script 195; one with <使用者効果 n> gives it skill n's
        // effects as well - script 113)
        const it = this.act;
        it.skill = G.combat.skillByState(it.by, it.skill);
        this.perform(it, ctx);
        const self = G.combat.userEffectSkill(it.skill);
        if (self && !toEnemy(self) && it.by?.hp > 0) this.perform({ by: it.by, skill: self, friend: { battler: it.by, ally: this } }, ctx);
      }
      if (this.act.t >= WINDUP + 0.35) {
        const next = this.act.done && this.followUp(this.act, ctx);
        this.act = null;
        if (next) { this.intent = next; this.cool = 0; } else this.cool = this.interval();
      }
      return;
    }
    if (fighting) {
      this.cool -= dt;
      // an enemy winding up with its mark on the floor where it stands: out of it first (as the player would)
      const danger = canMove && this.threatened(ctx);
      if (danger) {
        const [dx, dy] = this.escapeDir(danger);
        const [ex, ey] = standable(this.fx + dx * 2, this.fy + dy * 2);
        this.moveToward(ex, ey, 4.5 * dt, ctx);
        return;
      }
      if (!this.intent && this.cool <= 0) { this.intent = this.choose(ctx); if (!this.intent) this.cool = 0.6; }
      if (this.intent?.guard) { this.intent = null; this.cool = this.interval(); return; }      // (a turn spent guarding)
      const it = this.intent;
      if (it) {
        // to its spot beside the enemy, then the blow
        if (it.enemy) {
          const ex = it.enemy.fx - this.fx, ey = it.enemy.fy - this.fy, d = Math.hypot(ex, ey) * T;
          if (d > it.reach && canMove) {
            const [px, py] = this.post(ctx, it.enemy, Math.max(0.8, it.reach - 0.4));
            this.moveToward(px, py, this.speed() * dt, ctx);
            if (Math.hypot(px - this.fx, py - this.fy) * T > 0.3) return;
          }
          this.face(ex, ey);
          if (Math.hypot(it.enemy.fx - this.fx, it.enemy.fy - this.fy) * T > it.reach + 2.5) { this.intent = null; this.cool = 0.4; return; }   // (where it cannot go)
        }
        this.act = { ...it, t: 0, done: false };
        this.intent = null;
        return;
      }
      // waiting: at its spot beside its target
      if (this.target && canMove) {
        const keep = this.ranged() ? 5 : this.target.hr * T + 1.2;
        const [px, py] = this.post(ctx, this.target, keep);
        if (Math.hypot(px - this.fx, py - this.fy) * T > 0.5) this.moveToward(px, py, this.speed() * dt, ctx);
        this.face(this.target.fx - this.fx, this.target.fy - this.fy);
      }
      return;
    }
    if (!canMove) return;
    // walking along
    const [sx, sy] = this.slot(ctx);
    const d = Math.hypot(sx - this.fx, sy - this.fy) * T;
    if (d > 14) { [this.fx, this.fy] = resolveCircle(sx, sy, 0.25); return; }
    if (d > 0.5) this.moveToward(sx, sy, THREE.MathUtils.clamp(d * 1.8, 1.2, 5.5) * dt, ctx);
    else { const f = G.player.forward2D(); this.dir = [f.x, f.z]; }
  }
  // where it fights from: beside its target as the player sees it (out of the player's way and of the blows meant
  // for the player), this far from it; two companions take the two sides
  post(ctx, t, keep) {
    const pc = ctx.pc;
    let bx = pc.fx - t.fx, by = pc.fy - t.fy;
    const l = Math.hypot(bx, by) || 1; bx /= l; by /= l;
    const a = (ctx.slotOf(this) % 2 ? -1 : 1) * 1.15;
    const c = Math.cos(a), s = Math.sin(a);
    return standable(t.fx + (bx * c - by * s) * keep / T, t.fy + (bx * s + by * c) * keep / T);
  }
  // an enemy winding up whose mark (on the floor) it stands in - noticed about two times in three, a moment
  // after it came down
  threatened(ctx) {
    const at = this.worldPos(new THREE.Vector3());
    for (const e of ctx.enemies) {
      if (e.state !== 'windup' || !e.plan) continue;
      let seen = this.noticed.get(e.plan);
      if (seen === undefined) { seen = Math.random() < 0.65 ? 0.2 + Math.random() * 0.35 : Infinity; this.noticed.set(e.plan, seen); }
      if ((e.timer0 || 0) - (e.timer || 0) < seen) continue;
      if (G.combat.pointInPlan(e, e.plan, at, this.r + 0.4)) return e;
    }
    return null;
  }
  // the way out of a mark: away from a circle's middle, else off to the side of a fan or a line
  escapeDir(e) {
    const plan = e.plan, at = this.worldPos(new THREE.Vector3());
    if (plan.shape === 'circle') {
      const cx = plan.ground ? plan.cx : (plan.ox ?? (e.fx + 0.5) * T), cz = plan.ground ? plan.cz : (plan.oz ?? (e.fy + 0.5) * T);
      const dx = at.x - cx, dz = at.z - cz, l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    }
    const aim = plan.aim ?? e.aim ?? 0, ux = Math.cos(aim), uz = Math.sin(aim);
    const ox = plan.ox ?? (e.fx + 0.5) * T, oz = plan.oz ?? (e.fy + 0.5) * T;
    const side = (at.x - ox) * -uz + (at.z - oz) * ux >= 0 ? 1 : -1;
    return [-uz * side, ux * side];
  }
  speed() { return THREE.MathUtils.clamp(2.6 + (this.actor?.agi || 0) / 120, 2.6, 4.2); }
  interval() { return THREE.MathUtils.clamp(2.4 * 90 / ((this.actor?.agi || 0) + 50), 1.5, 3.4) + Math.random() * 0.7; }
  face(dx, dy) { const l = Math.hypot(dx, dy); if (l > 1e-4) this.dir = [dx / l, dy / l]; }
  // (it walks straight through walls, as the enemies chase through them - only walking: nothing knocks it through
  // one)
  moveToward(tx, ty, stepM, ctx) {
    const dx = tx - this.fx, dy = ty - this.fy, d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    const s = Math.min(stepM / T, d);
    let nx = this.fx + dx / d * s, ny = this.fy + dy / d * s;
    [nx, ny] = G.combat.clampToMap(nx, ny);
    // (it gives way to the enemies' bodies - they do not move for it)
    for (const e of ctx.enemies) {
      const ex = nx - e.fx, ey = ny - e.fy, ed = Math.hypot(ex, ey), min = (e.r || 0.2) + this.r / T;
      if (ed < min && ed > 1e-4) { nx = e.fx + ex / ed * min; ny = e.fy + ey / ed * min; }
    }
    this.face(nx - this.fx, ny - this.fy);
    this.fx = nx; this.fy = ny;
    this.moving = true;
  }
  nearestEnemy(ctx) {
    let best = null, bd = 16 / T;
    for (const e of ctx.enemies) {
      const d = Math.hypot(e.fx - this.fx, e.fy - this.fy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  ranged(a = this.actor) {
    const w = a?.weapons?.()[0];
    return !!w && [6, 10].includes(w.wtype_id);        // a bow or a gun
  }

  // ---- what it does: VX Ace's auto battle, as the original's patches have it (make_action_list +
  // make_auto_battle_actions): its attack, a guard and each skill it can use now are valued - the share of the
  // target's HP it would take (added up over everyone for an "all" skill, the best one for a single), the share
  // of a friend's HP it would give back - plus a random 0..1, and the highest is done (a guard is worth 0.01: a
  // turn spent guarding). Usable: the MP / TP to pay, not sealed, not cooling down (script 141, <クールタイム:n>:
  // Iron Hans's Mega Flare waits 8 turns, and his 350 MP pay for three), no common event / escape in it. Two
  // that are one body take turns (whoever of them is still up) ----
  usable(a) {
    const list = [G.combat.playerAttackSkill(a), ...a.allSkills()];
    return list.filter(s => s && s.name !== undefined && (s.occasion === 0 || s.occasion === 1) && s.scope !== 0 &&
      a.skillCostPayable(s) && a.skillTypeUsable(s) && !a.skillSealed?.(s.id) && !this.sys.cooling(a, s) &&
      !(s.effects || []).some(ef => ef.code === 44 || ef.code === 41));       // (common events, escape: not here)
  }
  choose(ctx) {
    const by = pick(this.living().filter(a => a.featuresSet(62).includes(0)));
    if (!by) return null;
    const target = this.target;
    const near = ctx.enemies.filter(e => Math.hypot(e.fx - this.fx, e.fy - this.fy) * T < 16);
    const friends = ctx.friends().filter(f => f.battler.hp > 0);
    const attack = G.combat.playerAttackSkill(by);
    let best = { v: 0.01 + Math.random(), guard: true };
    for (const s of this.usable(by)) {
      let v = 0, enemy = null, friend = null;
      if (toEnemy(s)) {
        if (!near.length || !target) continue;
        const share = e => G.combat.computeDamage(by, e.b, s, 1) / Math.max(1, e.b.hp);
        // (an "all" skill: all of them; a single: the one it is after)
        if (s.scope === 2) v = near.reduce((t, e) => t + share(e), 0);
        else v = share(near.includes(target) ? target : near[0]);
        enemy = near.includes(target) ? target : near[0];
      } else if (toFriend(s)) {
        if (s.scope === 9 || s.scope === 10) continue;                  // (no reviving here)
        const pool = s.scope === 11 ? friends.filter(f => f.battler === by) : friends;
        const back = f => {
          if (s.damage?.type !== 3) return 0;
          const b = f.battler, heal = Math.max(0, evalFormula(s.damage.formula, by, b) * (b.rec ?? 1));
          return Math.min(heal, b.mhp - b.hp) / Math.max(1, b.mhp);
        };
        if (s.scope === 8) { v = pool.reduce((t, f) => t + back(f), 0); friend = pool[0]; }
        else for (const f of pool) { const x = back(f); if (!friend || x > v) { v = x; friend = f; } }
        if (!friend) continue;
      } else continue;
      v += Math.random();
      if (v > best.v) best = { v, s, enemy, friend };
    }
    if (best.guard) { this.guardUntil = G.time + this.interval(); return { guard: true }; }
    const skill = best.s;
    if (toFriend(skill)) return { by, skill, friend: skill.scope === 11 ? { battler: by, ally: this } : best.friend, reach: 0 };
    const far = skill.hit_type === 2 || skill.hit_type === 0 || (skill === attack && this.ranged(by));
    return { by, skill, enemy: best.enemy, reach: far ? 7 : best.enemy.hr * T + 1.1, far };
  }
  // what a skill it used goes on with, at once (script 189 使用後追加行動: 겔다's cheer, then her light of snow) - at
  // the same enemy, or on itself
  followUp(it, ctx) {
    const a = it.by;
    if (!a || a.hp <= 0 || !it.skill || !ctx.fighting) return null;
    for (const f of G.combat.afterActions(it.skill)) {
      if (f.p < Math.floor(Math.random() * 100)) continue;
      const s = f.id > 0 ? $data.skills[f.id] : null;
      if (!s || !a.skillCostPayable(s) || !a.skillTypeUsable(s) || a.skillSealed?.(s.id) || this.sys.cooling(a, s)) continue;
      if (toEnemy(s)) {
        const enemy = it.enemy?.alive && !it.enemy.hidden ? it.enemy : this.target;
        if (!enemy?.alive || enemy.hidden) continue;
        const far = s.hit_type === 2 || s.hit_type === 0;
        return { by: a, skill: s, enemy, reach: far ? 7 : enemy.hr * T + 1.1, far };
      }
      if (toFriend(s) && s.scope !== 9 && s.scope !== 10) return { by: a, skill: s, friend: s.scope === 11 ? { battler: a, ally: this } : it.friend || { battler: a, ally: this }, reach: 0 };
    }
    return null;
  }
  perform(it, ctx) {
    const a = it.by, s = it.skill;
    if (!a || a.hp <= 0 || !a.skillCostPayable(s) || this.sys.cooling(a, s)) return;
    a.paySkillCost(s);
    this.sys.cool(a, s);
    const from = this.chest(new THREE.Vector3());
    if (toEnemy(s)) {
      G.combat.itemGlobalEffects(s, it.enemy?.battle);
      let targets;
      const near = () => ctx.enemies.filter(e => Math.hypot(e.fx - this.fx, e.fy - this.fy) * T < 14);
      if (s.scope === 2) targets = near();
      else if (s.scope >= 3 && s.scope <= 6) { const n = near(); targets = n.length ? Array.from({ length: s.scope - 2 }, () => pick(n)) : []; }
      else targets = it.enemy?.alive ? [it.enemy] : [];
      // Attack-count traits add hits only to a normal attack; ordinary skills
      // retain their own repeats for each separately selected target.
      const normal = s === G.combat.playerAttackSkill(a) && s.scope === 1;
      const reps = normal ? G.combat.attackHits(s, a) : usableRepeats(s), gap = reps > 5 ? 90 : 140;
      const anim = s.animation_id > 0 ? s.animation_id : s.animation_id === -1 ? (a.weapons()[0]?.animation_id || 1) : 0;
      const blow = {};                                   // (one attack for the groggy gauge, however many hits)
      targets.forEach((e, k) => {
        const at = e.worldPos(new THREE.Vector3());
        if (anim > 0) G.screen.playAnimationOn(new THREE.Vector3(at.x, at.y + e.h * 0.5, at.z), anim, { rate: 3, height: e.h });
        if (it.far) G.combat.spawnTracer(from, new THREE.Vector3(at.x, at.y + e.h * 0.55, at.z), G.combat.skillColor(s));
        for (let r = 0; r < reps; r++) G.combat.later((k + r) * gap, () => G.combat.applyUsableToEnemy(e, s, from, { knock: 0.06, by: a, blow }),
          { battle: e.battle, valid: () => e.alive && !e.hidden && a.hp > 0 && this.members().includes(a) });
      });
      if (!it.far) this.lunge = 1;
      return;
    }
    // on friends: the one it chose, all of them, or itself
    G.combat.itemGlobalEffects?.(s);
    const list = s.scope === 8 ? ctx.friends() : [it.friend || { battler: a, ally: this }];
    for (const f of list) {
      const b = f.battler;
      if (!b || b.hp <= 0) continue;
      G.combat.applyUsableToActor(s, 'ally', { target: b, user: a, global: false });
      // (on the player: its sounds, not its drawing in the eyes)
      if (s.animation_id > 0) {
        const at = f.ally ? f.ally.chest(new THREE.Vector3()) : G.player.headWorld(new THREE.Vector3()).add(new THREE.Vector3(0, -0.5, 0));
        G.screen.playAnimationOn(at, s.animation_id, { world: true, visual: !!f.ally });
      }
    }
  }

  // ---- struck: an enemy's blow, shot or move as it would land on the player, without a guard (on two that
  // are one body, it lands on one of them); it is thrown back by it - away from the one who struck (or from where
  // the blow came down: from, world x/z), or along dir; push in metres (0: not moved) ----
  takeHit(e, skill, { dir = null, from = null, push = null, target = null, invocationSelected = false } = {}) {
    const living = this.living(), a = target ? living.includes(target) && target : pick(living);
    if (!a || !this.stands) return;
    const combat = G.combat, user = e?.b || a, hitType = skill?.hit_type ?? 1;
    const miss = () => G.audio?.playSystemSe(hitType === 2 ? 19 : 18);
    if (!invocationSelected && !skill?._counterResponse && e && hitType === 2 && a.mrf > Math.random()) { combat.reflectOntoEnemy(e, skill); return; }
    if (skill?.__class === 'RPG::Skill' && a.skillCanceled(skill.id)) { G.audio?.playSystemSe(3); return; }
    if (!combat.hitLands(user, skill) || !combat.certainHit(user, skill) && a.certainty(1, hitType) || combat.slipsWithAnswer(a, skill, user)) { miss(); return; }
    const dist = push ?? ((skill && G.combat.isHeavySkill(skill)) || (e?.boss && e.move) ? 0.8 : 0.35);
    if (dist > 0 && !this.wall) {
      const at = this.worldPos(new THREE.Vector3());
      const [dx, dy] = dir || (from ? [at.x - from.x, at.z - from.z] : e ? [this.fx - e.fx, this.fy - e.fy] : [-this.dir[0], -this.dir[1]]);
      this.knockBack(dx, dy, dist);
    }
    const critical = combat.rollCritical(user, a, skill);
    let dmg = combat.computeDamage(user, a, skill, critical ? combat.criticalMultiplier() : 1);
    // (it chose to guard - unless the blow goes through a guard, script 170)
    if ((this.guardUntil || 0) > G.time && dmg > 0 && !combat.nativeGuarded(a) && !combat.ignoresGuard(user, skill)) dmg = dmg / (2 * Math.max(0.5, a.grd ?? 1));
    dmg = Math.round(dmg * (G.settings.difficulty ?? 1));
    const hpBefore = a.hp;
    const result = combat.applyResourceDamage(user, a, skill, dmg);
    const hpLoss = Math.max(0, hpBefore - a.hp);
    const damage = result.hpDamage || result.mpDamage;
    const p = this.worldPos(new THREE.Vector3());
    combat.popup(new THREE.Vector3(p.x, p.y + this.h * 0.8, p.z), `${result.mpDamage ? 'MP ' : ''}${damage}`, damage > 0 ? result.mpDamage ? '#80b0ff' : '#ff8080' : '#9a9a9a');
    this.hurt = 0.3;
    const se = $data.system.sounds?.[14];                  // the actor-damage sound, where it was struck
    if (se) G.audio?.playSe(se, p);
    const removeState = id => {
      a.removeState(id);
      const timers = this.sys.stateTimers?.get(a.id);
      if (timers) delete timers[id];
    };
    // Only losing HP wakes damage-removable states; an MP hit still applies
    // its other effects, including when the target has no MP left to lose.
    if (hpLoss > 0) for (const id of [...a.states]) {
      const st = $data.states[id];
      if (id !== 1 && st?.remove_by_damage && Math.random() * 100 < st.chance_by_damage) removeState(id);
    }
    for (const ef of skill?.effects || []) {
      if (ef.code === 21 && ef.data_id >= 0) {
        const normal = ef.data_id === 0, ids = normal ? user.atkStates() : [ef.data_id];
        for (const id of ids) {
          const base = ef.value1 * (normal ? user.atkStatesRate(id) : 1) * (id === 1 ? 1 : 0.6);
          if (id > 0 && Math.random() < combat.stateEffectChance(user, a, skill, id, base)) a.addState(id);
        }
      } else if (ef.code === 22 && Math.random() < ef.value1) removeState(ef.data_id);
      else if (ef.code === 11 || ef.code === 12) {
        const hp = ef.code === 11, key = hp ? 'hp' : 'mp', max = hp ? a.mhp : a.mmp;
        const value = Math.floor((max * ef.value1 + ef.value2) * a.rec);
        const change = a.healAmount(value, hp ? 0 : 1);
        a[key] = Math.max(0, Math.min(max, a[key] + Math.floor(change * (change < 0 ? G.settings.difficulty ?? 1 : 1))));
        if (hp && change < 0) for (const id of [...a.states]) {
          const st = $data.states[id];
          if (id !== 1 && st?.remove_by_damage && Math.random() * 100 < st.chance_by_damage) removeState(id);
        }
      } else if (ef.code === 13) a.tp = THREE.MathUtils.clamp(a.tp + Math.floor(ef.value1), 0, 100);
      else if (ef.code === 42) a.addParam?.(ef.data_id, ef.value1);
      else if (ef.code === 43) a.learnSkill?.(ef.data_id);
    }
    combat.applyBuffEffects(a, skill, TURN, 0.6, user);
    const gain = combat.userResourceEffects(user, skill || {}, hpLoss);
    if (e && (result.hpDrain > 0 || result.mpDrain > 0 || gain.hpGain > 0)) e.drawBar();
    if (a.hp <= 0 && !a.stateResist(1) && !this.reviveOnFall(a)) {
      a.addState(1);
      const c = $data.system.sounds?.[15];                 // the actor-collapse sound
      if (c) G.audio?.playSe(c, p);
    }
    this.drawBar();
  }

  // Script 171 applies to every battler, including a companion struck down by
  // a reversed heal. Its death clears ordinary states and buffs before revival.
  reviveOnFall(actor = this.actor) {
    if (!actor || actor.hp > 0 || actor.stateResist(1)) return false;
    const revive = actor.autoRevive();
    if (!revive) return false;
    actor.die(); actor.removeState(1);
    actor.hp = Math.min(actor.mhp, revive.hp);
    if (revive.breakRate > Math.random() * 100) G.combat.breakSaver(actor, revive.source);
    const timers = this.sys.stateTimers?.get(actor.id);
    if (timers) for (const id of Object.keys(timers)) if (!actor.isState(+id)) delete timers[id];
    if (revive.anim) G.screen?.playAnimationOn(this.chest(new THREE.Vector3()), revive.anim, { world: true, height: this.h });
    G.audio?.playSystemSe(16);
    this.drawBar();
    return true;
  }

  // thrown back (a blow it took): pushed dist metres along (dx, dy) in a moment, fast at first and slowing
  knockBack(dx, dy, dist) {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6 || dist <= 0) return;
    this.push = { dx: dx / l, dy: dy / l, dist: dist / T, t: 0, dur: 0.2 + 0.1 * Math.min(1, dist) };
  }
  // ... and a wall stops it as it stops the player and the enemies (never through one this way - only walking
  // goes through; one standing in a wall already, on its way through, is not moved at all)
  pushed(dt) {
    const p = this.push, m = G.map;
    const ease = t => 1 - (1 - t) * (1 - t);
    const s0 = p.dist * ease(p.t / p.dur);
    p.t = Math.min(p.dur, p.t + dt);
    const s1 = p.dist * ease(p.t / p.dur);
    if (p.t >= p.dur) this.push = null;
    if (!m.walkable(m.wrapX(Math.round(this.fx)), m.wrapY(Math.round(this.fy)))) { this.push = null; return; }
    const nx = this.fx + p.dx * (s1 - s0), ny = this.fy + p.dy * (s1 - s0);
    if (!lineOfSight(this.fx, this.fy, nx, ny)) { this.push = null; return; }
    [this.fx, this.fy] = resolveCircle(nx, ny, 0.25);
  }

  // ---- how it shows ----
  show(dt, ctx) {
    const viewer = ctx.head;
    this.group.visible = this.placed && !this.gone && this.parts.length > 0;
    const wp = this.worldPos(tmpV);
    this.group.position.copy(wp);
    // fades in as it comes, out as it goes; lies low and dim when struck down
    this.appear = this.leaving ? Math.max(0, this.appear - dt / 0.6) : Math.min(1, this.appear + dt / 0.6);
    if (this.leaving && this.appear <= 0) this.gone = true;
    this.fallen = this.alive ? Math.max(0, this.fallen - dt * 2) : Math.min(1, this.fallen + dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.lunge = Math.max(0, this.lunge - dt * 3);
    const op = this.appear * (1 - 0.7 * this.fallen);
    const body = this.bodyGroup;
    if (body) {
      body.rotation.y = Math.atan2(viewer.x - wp.x, viewer.z - wp.z);
      // a blow: a lunge toward what it hits; a hurt: a shake; down: sunk a little; a dream spirit hovers
      const l = Math.sin(Math.min(1, this.lunge) * Math.PI) * 0.35;
      const bob = this.look.book ? Math.sin(G.time * 2 + this.id) * 0.03 : 0;
      body.position.set(this.dir[0] * l, -0.25 * this.fallen + bob, this.dir[1] * l);
      if (this.hurt > 0) body.position.x += Math.sin(G.time * 70) * 0.04;
      const k = this.act && !this.act.done ? this.act.t / WINDUP : 0;
      for (const p of this.parts) {
        p.mat.opacity = op;
        const fl = this.hurt > 0 ? 0.7 * this.hurt / 0.3 : k * 0.35;
        p.mat.emissive.setRGB(fl, this.hurt > 0 ? 0.05 : fl * 0.8, this.hurt > 0 ? 0.05 : fl * 0.5);
      }
    }
    if (this.chip) this.chipFrame(viewer, wp, dt);
    if (this.bar) {
      this.bar.visible = ctx.fighting && this.fighter && this.stands && this.alive;
      this.bar.position.y = this.h + 0.15;
      this.drawBar();
    }
  }
  // the frame of its sheet: the side seen from the viewer (as the map's people turn), stepping while it walks
  chipFrame(viewer, wp, dt) {
    const { info, tex, index, w, h } = this.chip;
    let vx = viewer.x - wp.x, vz = viewer.z - wp.z;
    const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
    const fv = this.dir;
    const dot = fv[0] * vx + fv[1] * vz;
    let row;
    if (dot > 0.707) row = 0;
    else if (dot < -0.707) row = 3;
    else row = (vx * -fv[1] + vz * fv[0]) > 0 ? 2 : 1;
    if (this.moving) this.walk += dt * 6.5; else this.walk = 0;
    const pattern = this.moving ? [0, 1, 2, 1][Math.floor(this.walk) % 4] : 1;
    const bx = info.single ? 0 : (index % 4) * 3, by = info.single ? 0 : Math.floor(index / 4) * 4;
    tex.offset.set((bx + pattern) * info.fw / w, 1 - ((by + row + 1) * info.fh) / h);
  }
}

export class AllySystem {
  constructor(combat) {
    this.combat = combat;
    this.root = new THREE.Group();
    this.root.name = 'companions';
    combat.root.add(this.root);
    this.list = [];
    this.cools = new Map();          // actor id -> { skill id: G.time it can be used again }
  }
  // whether those who walk along show on the map (the database's "followers" option, events' Change Player
  // Followers); a fight brings them out anyway, as every battle member fights in the original
  followersShown() { const f = G.state?.system?.followers; return f ?? !!$data.system?.opt_followers; }
  reset() { for (const a of this.list) a.dispose(); this.list = []; this.cools.clear(); this.stateTimers?.clear(); }
  onMapLoaded() { for (const a of this.list) a.placed = false; }
  unitOf(id) { return this.list.find(x => x.ids.includes(id) && !x.leaving && !x.gone) || null; }
  // skill cool-downs (script 141, <クールタイム:n>): n turns of COOL_TURN s each, as the player's; cleared when the
  // fight ends, as the original clears them at battle end
  cooling(a, s) { this.combat.syncSkillClock?.(); return (this.cools.get(a.id)?.[s.id] || 0) > G.time; }
  cool(a, s) {
    this.combat.syncSkillClock?.();
    const t = G.combat.coolSeconds(s);
    if (!t) return;
    if (!this.cools.has(a.id)) this.cools.set(a.id, {});
    this.cools.get(a.id)[s.id] = G.time + t;
  }
  pauseSkillClocks(previous, elapsed) {
    for (const deadlines of this.cools.values()) for (const id of Object.keys(deadlines)) if (deadlines[id] > previous) deadlines[id] += elapsed;
  }

  update(dt, paused) {
    const st = G.state;
    if (!st?.party || !G.map?.grid) return;
    const fighting = this.combat.inCombat;
    if (!fighting && this.cools.size) this.cools.clear();
    const ids = st.party.actors.slice(1, 1 + MAX_ALLIES);
    const out = fighting || this.followersShown();
    // come and go with the party (one of two that are one body comes as that body when the other is there)
    for (const id of ids) {
      if (!$data.actors[id]) continue;
      const host = LOOK[id]?.partOf;
      const unitId = host && ids.includes(host) ? host : id;
      const u = this.unitOf(unitId);
      if (!u && (out || LOOK[unitId]?.wall)) this.list.push(new Ally(this, unitId));
    }
    for (const a of this.list) {
      if (a.leaving || a.gone) continue;
      if (!a.ids.some(id => ids.includes(id)) || (!out && !a.wall)) a.leaving = true;
      // (one that came alone joins its other half's body when that one comes)
      if (LOOK[a.id]?.partOf && ids.includes(LOOK[a.id].partOf)) a.leaving = true;
    }
    const pc = G.map.playerChar;
    const head = G.player.headWorld(new THREE.Vector3());
    // (co-op: a boss fight this player is out of - never joined, or watching it fallen - is none of its companions' either)
    const enemies = this.combat.enemies.filter(e => e.battle && e.alive && !e.hidden && !e.untargetable && e.mesh && !this.combat.outOfFight(e));
    const walkers = this.list.filter(a => a.stands && !a.wall);
    const ctx = {
      pc, head, fighting, paused, enemies,
      walking: Math.max(1, walkers.length),
      slotOf: a => Math.max(0, walkers.indexOf(a)),
      friends: () => {
        const leader = st.party.leader();
        const list = leader ? [{ battler: leader, ally: null }] : [];
        for (const a of this.list) if (a.stands) for (const b of a.living()) list.push({ battler: b, ally: a });
        return list;
      },
    };
    if (!paused) this.tickStates(dt);
    for (const a of this.list) a.update(dt, ctx);
    for (const a of this.list.filter(x => x.gone)) a.dispose();
    this.list = this.list.filter(a => !a.gone);
  }

  // a companion's states run out after their turns as in the original's battles, and may bring others as they do
  // (the meat shield's 20 turns end in its death)
  tickStates(dt) {
    const timers = (this.stateTimers ||= new Map());
    const buffed = new Set(), present = new Set();
    for (const u of this.list) {
      if (!u.stands) continue;
      for (const a of u.members()) {
        if (buffed.has(a)) continue;
        a.tickBuffs(dt); buffed.add(a); present.add(a.id);
        const t = (a.stateTimerRemaining ||= {});
        timers.set(a.id, t);
        for (const id of a.states) {
          const st = $data.states[id];
          if (t[id] === undefined && st?.auto_removal_timing && st.max_turns > 0) t[id] = (st.min_turns + Math.floor(Math.random() * (st.max_turns - st.min_turns + 1))) * TURN;
        }
        for (const k of Object.keys(t)) {
          if (!a.isState(+k) || !$data.states[k]?.auto_removal_timing) { delete t[k]; continue; }
          t[k] -= dt;
          if (t[k] > 0) continue;
          delete t[k];
          const was = a.hp;
          a.removeState(+k);
          for (const s of this.combat.stateExpired(a, +k)) a.addState(s);
          if (was > 0 && a.hp <= 0) {
            const c = $data.system.sounds?.[15];                  // the actor-collapse sound
            if (c) G.audio?.playSe(c, u.worldPos(new THREE.Vector3()));
          }
          u.drawBar();
        }
      }
    }
    for (const id of timers.keys()) if (!present.has(id)) timers.delete(id);
  }

  // ---- for the enemies ----
  // who an enemy goes for: the player or a companion that fights - as VX Ace picks a target by its target
  // rate, here weighed by how near too; it keeps to it a few seconds
  pickTarget(e) {
    // (a co-op boss fight: its enemies go only for those in it - a guest that did not join or watches it fallen is no
    // one to them, nor are this player's companions while this player is out of it - coop.js)
    const hostOut = G.combat.outOfFight(e);           // (then this player is not one to choose either)
    const live = this.struckable().filter(a => (a.remote ? (!e.private || !!G.coop?.peerSees?.(a.peer.id, e.hallKey)) && a.inFight(e) : !hostOut));     // (a hallucination: only those who see it)
    if (!live.length) { e.tgt = null; return null; }
    if (e.tgtUntil > G.time && ((e.tgt === null && !hostOut) || live.includes(e.tgt))) return e.tgt;
    const pc = G.map.playerChar, leader = G.state.party.leader();
    const opts = hostOut ? [] : [{ who: null, w: (leader?.tgr ?? 1) / (1 + Math.hypot(e.fx - pc.fx, e.fy - pc.fy) * T / 5) }];
    for (const a of live) opts.push({ who: a, w: (a.actor?.tgr ?? 1) / (1 + Math.hypot(e.fx - a.fx, e.fy - a.fy) * T / 5) });
    let r = Math.random() * opts.reduce((s, o) => s + o.w, 0), who = opts[0].who;
    for (const o of opts) { r -= o.w; if (r <= 0) { who = o.who; break; } }
    e.tgt = who;
    e.tgtUntil = G.time + 3 + Math.random() * 3;
    return who;
  }
  // those an enemy's blows can land on
  // (and a co-op host's guests, where they stand - coop.js RemoteBody)
  struckable() { return this.list.filter(a => a.stands && a.alive && a.fighter).concat(G.coop?.remoteBodies?.() || []); }
  // one who stands in for the others (身代わり): takes a blow meant for the player when the player is near death
  substitute() { return this.struckable().find(a => a.living().some(b => b.featuresSet(62).includes(2))) || null; }
  // the meat shield stands in the enemies' way
  walls() { return this.list.filter(a => a.wall && a.stands && a.alive); }

  // ---- talking: the original's A key (the date talk) is talking to one who walks along ----
  talkTo(aim) {
    const pc = G.map.playerChar;
    let best = null;
    for (const a of this.list) {
      if (!a.stands || a.wall) continue;
      const ex = a.fx - pc.fx, ey = a.fy - pc.fy, d = Math.hypot(ex, ey);
      if (d > 2.2) continue;
      const dot = d < 0.4 ? 1 : (ex * aim.x + ey * aim.z) / d;
      if (dot < 0.55) continue;
      if (!best || d - dot < best.score) best = { a, score: d - dot };
    }
    if (!best) return false;
    best.a.face(pc.fx - best.a.fx, pc.fy - best.a.fy);
    G.input.pressRmButton(14);
    return true;
  }
  // a heal on one of the party, after the recovery rules on it (script 172: 허약 - nothing; 천수 영역 - as much damage)
  heal(f, v) {
    const b = f.battler;
    const r = b.healAmount(v, 0);
    if (r > 0) { b.hp = Math.min(b.mhp, b.hp + r); this.showHeal(f, r); }
    else if (r < 0) {
      b.hp = Math.max(0, b.hp + r);
      if (!f.ally) { this.combat.slipHurt(-r); if (b.hp <= 0) this.combat.playerFalls(null); }
      else f.ally.drawBar();
    }
  }
  showHeal(f, v) {
    if (v <= 0) return;
    if (!f.ally) { this.combat.popupAtPlayer(`+${v}`, '#60ff80'); return; }
    const p = f.ally.worldPos(new THREE.Vector3());
    this.combat.popup(new THREE.Vector3(p.x, p.y + f.ally.h * 0.8, p.z), `+${v}`, '#60ff80');
    f.ally.drawBar();
  }
  // a companion's drain heals it (applyUsableToEnemy)
  healActor(actor, v) {
    const a = this.list.find(x => x.members().includes(actor));
    if (a) this.showHeal({ battler: actor, ally: a }, v);
  }
}
