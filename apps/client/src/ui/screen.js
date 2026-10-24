// Screen effects as head-locked overlays (VR-safe): fade, tone, flash, damage vignette, animations.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { T } from '../world/mapmesh.js';
import { loadCanvas } from '../data/assets.js';
import { WorldWeather } from '../world/weather.js';

// brightness of flashes and animation sprites (setting 이펙트 밝기)
const fxk = () => THREE.MathUtils.clamp(G.settings.fxBrightness ?? 0.5, 0.1, 1);
// animations whose screen flash is left out: it blacks out the whole view, hard on the eyes in a headset - 흑기사 린다메아's
// 罰 (형벌: 80% black) and 黒の制裁 (검은 제재 / 검은 극형: full black three times over). The rest of each plays as drawn
const NO_SCREEN_FLASH = new Set([538, 542]);

// ---- RPG Maker animations as sprites -----------------------------------------------------------
// The 192 px cells of a Graphics/Animations sheet (patterns 0-99 from the first sheet, 100+ from the
// second) play as camera-facing quads at the target. Each frame sets every cell's pattern, offset, zoom,
// angle, mirror, opacity and blend like Sprite_Base#animation_set_sprites. Battlers are drawn at about
// 105 px per metre, and so are the animations.
const ANIM_PX = 1 / 105;
const CELL = 192;
const animSheets = new Map();
function animSheet(name, hue) {
  if (!name) return Promise.resolve(null);
  const key = `${name}#${hue | 0}`;
  if (!animSheets.has(key)) {
    animSheets.set(key, loadCanvas('Graphics/Animations', name, hue | 0).then(c => {
      if (!c) return null;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      return { tex, w: c.width, h: c.height };
    }));
  }
  return animSheets.get(key);
}

// how far an animation's drawing reaches from its origin, in metres at scale 1 (a cell's picture fills
// about two thirds of its 192 px square)
function animRadius(anim) {
  if (anim._radius !== undefined) return anim._radius;
  let r = 0;
  for (const fr of anim.frames || []) {
    const cd = fr?.cell_data;
    const xs = cd?.xsize || 0;
    const n = Math.min(fr?.cell_max || 0, xs);
    for (let i = 0; i < n; i++) {
      if (cd.data[i] < 0) continue;
      const half = CELL * 0.33 * Math.max(0.01, cd.data[i + 3 * xs] / 100);
      r = Math.max(r, Math.max(Math.abs(cd.data[i + xs]), Math.abs(cd.data[i + 2 * xs])) + half);
    }
  }
  anim._radius = (r || CELL * 0.33) * ANIM_PX;
  return anim._radius;
}

class AnimVisual {
  constructor(anim, pos, { scale = 1, dim = 1 } = {}) {
    this.anim = anim;
    this.dim = dim;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.scale.setScalar(scale);
    this.cells = [];
    this.sheets = null;
    this.frame = -1;
    this.disposed = false;
    G.three.scene.add(this.group);
    Promise.all([animSheet(anim.animation1_name, anim.animation1_hue), animSheet(anim.animation2_name, anim.animation2_hue)])
      .then(s => { this.sheets = s; if (this.frame >= 0) this.show(this.frame); });
  }
  cell(i) {
    if (!this.cells[i]) {
      const s = CELL * ANIM_PX;
      const geo = new THREE.PlaneGeometry(s, s);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1500 + i;
      m.frustumCulled = false;
      this.group.add(m);
      this.cells[i] = m;
    }
    return this.cells[i];
  }
  show(fi) {
    this.frame = fi;
    if (!this.sheets || this.disposed) return;
    const fr = this.anim.frames?.[fi];
    const cd = fr?.cell_data;
    const xs = cd?.xsize || 0;
    const n = fr ? Math.min(fr.cell_max || 0, xs) : 0;
    const k = fxk();
    for (let i = 0; i < Math.max(n, this.cells.length); i++) {
      const at = j => cd.data[i + j * xs];
      const pattern = i < n ? at(0) : -1;
      const sheet = pattern >= 0 ? this.sheets[pattern < 100 ? 0 : 1] : null;
      if (!sheet) { if (this.cells[i]) this.cells[i].visible = false; continue; }
      const m = this.cell(i);
      const mat = m.material;
      if (mat.map !== sheet.tex) { mat.map = sheet.tex; mat.needsUpdate = true; }
      // the pattern's 192 px square on the sheet (5 per row); mirrored cells swap u
      const p = pattern % 100;
      const u0 = (p % 5) * CELL / sheet.w, u1 = u0 + CELL / sheet.w;
      const v1 = 1 - Math.floor(p / 5) * CELL / sheet.h, v0 = v1 - CELL / sheet.h;
      const [ua, ub] = at(5) === 1 ? [u1, u0] : [u0, u1];
      const uv = m.geometry.attributes.uv;
      uv.setXY(0, ua, v1); uv.setXY(1, ub, v1); uv.setXY(2, ua, v0); uv.setXY(3, ub, v0);
      uv.needsUpdate = true;
      m.visible = true;
      m.position.set(at(1) * ANIM_PX, -at(2) * ANIM_PX, i * 0.003);
      m.scale.setScalar(Math.max(0.01, at(3) / 100));
      m.rotation.z = at(4) * Math.PI / 180;
      const op = at(6) / 255;
      const blend = at(7);
      mat.blending = blend === 1 ? THREE.AdditiveBlending : blend === 2 ? THREE.SubtractiveBlending : THREE.NormalBlending;
      // additive light is what glares: it follows the brightness setting fully, plain cells only partly
      const bright = this.dim * (blend === 1 ? k : 0.55 + 0.45 * k);
      mat.color.setScalar(blend === 2 ? bright * op : bright);
      mat.opacity = op;
    }
  }
  face(q) { this.group.quaternion.copy(q); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.parent?.remove(this.group);
    for (const m of this.cells) if (m) { m.geometry.dispose(); m.material.dispose(); }   // cells are made on demand: the array can have gaps
    this.cells = [];
  }
}

function overlaySphere(blending, renderOrder) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending, toneMapped: false }));
  m.renderOrder = renderOrder;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

// the hurt edge: clear in the middle, red toward the edges of the view. It is white so the material's
// colour tints it; at 0.2 m before the eyes the ramp starts about 30 degrees out, inside a headset's view
function vignetteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.28, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(0.62, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// the layers as the original stacks its viewports: the world under the tone (2990-2991; viewport 1's), the pictures
// over that (src/pictures.js, 2991.5) and under the flash (2992) and the fade (3000; viewport 3's), the windows -
// messages, choices, menus (src/ui.js, 3100) - over all of them
export class ScreenFx {
  constructor(camera) {
    this.camera = camera;
    this.fadeSphere = overlaySphere(THREE.NormalBlending, 3000);
    this.toneMul = overlaySphere(THREE.MultiplyBlending, 2990);
    this.toneMul.material.transparent = true;
    this.toneAdd = overlaySphere(THREE.AdditiveBlending, 2991);
    // (a flash is laid over the view by its alpha, as RGSS blends it: a black one is a moment of darkness)
    this.flashSphere = overlaySphere(THREE.NormalBlending, 2992);
    this.hurt = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
      map: vignetteTexture(), color: 0xc80a0a, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.hurt.position.z = -0.2; this.hurt.renderOrder = 2995; this.hurt.visible = false;
    for (const m of [this.fadeSphere, this.toneMul, this.toneAdd, this.flashSphere, this.hurt]) camera.add(m);
    this.brightness = 255; this.fadeTarget = 255; this.fadeDur = 0;
    this.tone = { r: 0, g: 0, b: 0, gray: 0 }; this.toneTarget = null; this.toneDur = 0;
    this.battleTones = new Map();
    this.flash = null;
    this.hurtLevel = 0;
    this.pictures = {};
    this.anims = [];
    this.scene = null;
  }

  // ---- RPG Maker screen commands ----
  fadeOut(frames) { this.fadeTarget = 0; this.fadeDur = frames; }
  fadeIn(frames) { this.fadeTarget = 255; this.fadeDur = frames; }
  setBrightness(v) { this.brightness = v; this.fadeTarget = v; this.fadeDur = 0; }
  startTone(tone, frames, battle = null) {
    let channel = this;
    if (battle) {
      if (battle.done) return;
      channel = this.battleTones.get(battle);
      if (!channel) {
        channel = { tone: { r: 0, g: 0, b: 0, gray: 0 }, toneTarget: null, toneDur: 0 };
        this.battleTones.set(battle, channel);
      }
    }
    const t = { r: tone.red, g: tone.green, b: tone.blue, gray: tone.gray };
    if (frames <= 0) { channel.tone = t; channel.toneTarget = null; channel.toneDur = 0; }
    else { channel.toneTarget = t; channel.toneDur = frames; }
  }
  // VX Ace gives the map and troop separate Game_Screen instances. A troop's
  // sustained blind/tint must disappear with its fight, including an early win.
  endBattleTone(battle) { this.battleTones.delete(battle); }
  clearBattleTones() { this.battleTones.clear(); }
  displayTone() {
    let tone = this.tone;
    for (const [battle, channel] of this.battleTones) {
      if (battle.done) this.battleTones.delete(battle);
      else tone = channel.tone;
    }
    return tone;
  }
  // whole-view flashes hurt the eyes most in a headset: a bright one follows the brightness setting squared; a dark
  // one (a black flash - the moment of darkness as 그랑・기뇰's acts come on) is no glare and keeps its strength
  startFlash(color, frames) {
    const k = fxk();
    const glare = THREE.MathUtils.clamp(Math.max(color.red, color.green, color.blue) / 255, 0, 1);
    this.flash = { r: color.red / 255, g: color.green / 255, b: color.blue / 255, a: color.alpha / 255 * THREE.MathUtils.lerp(1, k * k, glare), dur: frames, t: frames };
  }
  startShake() { G.input?.haptic('left', 0.3, 120); G.input?.haptic('right', 0.3, 120); }
  showPicture(params, battle = null) { G.pictures?.show(params, battle); }
  movePicture(params, battle = null) { G.pictures?.move(params, battle); }
  erasePicture(n, battle = null) { G.pictures?.erase(n, battle); }
  endBattlePictures(battle) { G.pictures?.endBattle(battle); }
  clearBattlePictures() { G.pictures?.clearBattlePictures(); }
  setWeather(type, power = 0, frames = 0) {
    this.weather ||= new WorldWeather(G.three?.scene);
    this.weather.set(type, power, frames);
  }
  get weatherDimness() { return this.weather?.dimness || 0; }
  clearWeather() { this.weather?.dispose(); this.weather = null; }
  effectHook(name, args) { G.environment?.effectHook(name, args); }
  // being hit: the edges of the view flush red (setting 피격 붉은 테두리)
  hurtFlash(strength = 1) {
    if (G.settings.hitFlash === false) return;
    this.hurtLevel = Math.min(0.9, this.hurtLevel + 0.7 * strength);
  }
  // and (setting 피격 흔들림, on unless turned off: in a headset a moving view can make people sick) the view
  // is knocked away from the blow and shudders back, rolling and nodding a little with it - big enough to be
  // felt in a headset (up to 8 cm and 2.2 degrees, 0.3 s). dir: from the attacker to the player (x, z)
  hitShake(dir, strength = 1, dur = 0.3) {
    if (G.settings.hitShake === false) return;
    const l = Math.hypot(dir?.x || 0, dir?.z || 0) || 1;
    this.shake = { t: 0, dur, amp: 0.08 * strength, rot: THREE.MathUtils.degToRad(2.2) * strength,
      x: (dir?.x || 0) / l, z: (dir?.z || 0) / l, seed: Math.random() * 10 };
  }
  // around drawing a frame: the rig moves for the picture only, so nothing in the game sees it
  beginShake(rig, dt) {
    const k = this.shake;
    this.shakeSaved = null;
    if (!k || !rig) return;
    k.t += dt;
    if (k.t >= k.dur) { this.shake = null; return; }
    const f = 1 - k.t / k.dur, e = f * f;
    const w = Math.cos(k.t * 50), v = Math.sin(k.t * 67 + k.seed), u = Math.sin(k.t * 43 + k.seed * 2);
    // (the turn as its Euler angles: put back through the quaternion, a turn past 90 degrees would come back as
    // the same pose written with x and z flipped by 180, and every later turn of the rig would go the wrong way)
    this.shakeSaved = { p: rig.position.clone(), r: rig.rotation.clone() };
    // the turn, about the head: a roll about where the view looks and a nod about its side
    const head = G.player?.headWorld(new THREE.Vector3());
    if (head && Number.isFinite(head.x)) {
      const fwd = G.player.forwardVec(), side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const q = new THREE.Quaternion().setFromAxisAngle(fwd, k.rot * e * v)
        .multiply(new THREE.Quaternion().setFromAxisAngle(side, k.rot * 0.5 * e * u));
      rig.position.sub(head).applyQuaternion(q).add(head);
      rig.quaternion.premultiply(q);
    }
    // the knock: away from the blow first, then shuddering back
    const a = k.amp * e, push = a * (0.55 + 0.45 * w);
    rig.position.x += k.x * push + k.z * a * 0.4 * v;
    rig.position.y += a * 0.3 * u;
    rig.position.z += k.z * push - k.x * a * 0.4 * v;
  }
  endShake(rig) {
    if (this.shakeSaved && rig) { rig.position.copy(this.shakeSaved.p); rig.rotation.copy(this.shakeSaved.r); }
    this.shakeSaved = null;
  }

  // 60 Hz logic tick
  updateLogic() {
    this.weather?.updateLogic();
    if (this.fadeDur > 0) {
      const d = this.fadeDur;
      this.brightness = (this.brightness * (d - 1) + this.fadeTarget) / d;
      this.fadeDur--;
    }
    for (const channel of [this, ...this.battleTones.values()]) if (channel.toneTarget) {
      const d = channel.toneDur;
      for (const k of ['r', 'g', 'b', 'gray']) channel.tone[k] = (channel.tone[k] * (d - 1) + channel.toneTarget[k]) / d;
      if (--channel.toneDur <= 0) { channel.tone = { ...channel.toneTarget }; channel.toneTarget = null; }
    }
    if (this.flash && --this.flash.t <= 0) this.flash = null;
    this.hurtLevel = Math.max(0, this.hurtLevel - 0.025);
    for (const a of this.anims) a.update?.();
    this.anims = this.anims.filter(a => !a.done);
    G.pictures?.update();
  }

  // per rendered frame: push values into overlay materials
  apply() {
    if (this.weather) {
      this.weather.attach(G.three?.scene);
      const head = G.player?.headWorld?.(new THREE.Vector3());
      this.weather.update(head, G.floorAt);
    }
    const fadeA = 1 - this.brightness / 255;
    this.fadeSphere.visible = fadeA > 0.003;
    this.fadeSphere.material.opacity = fadeA;
    const t = this.displayTone();
    if (G.worldTone) {
      G.worldTone.apply(t);
      this.toneMul.visible = false;
      this.toneAdd.visible = false;
    } else {
      const mr = 1 + Math.min(0, t.r) / 255, mg = 1 + Math.min(0, t.g) / 255, mb = 1 + Math.min(0, t.b) / 255;
      const gray = t.gray / 255;
      const avg = (mr + mg + mb) / 3;
      const fr = mr + (avg - mr) * gray, fg = mg + (avg - mg) * gray, fb = mb + (avg - mb) * gray;
      this.toneMul.visible = fr < 0.995 || fg < 0.995 || fb < 0.995;
      this.toneMul.material.color.setRGB(fr, fg, fb);
      this.toneMul.material.opacity = 1;
      const ar = Math.max(0, t.r) / 255, ag = Math.max(0, t.g) / 255, ab = Math.max(0, t.b) / 255;
      this.toneAdd.visible = ar + ag + ab > 0.01;
      this.toneAdd.material.color.setRGB(ar * 0.6, ag * 0.6, ab * 0.6);
      this.toneAdd.material.opacity = 1;
    }
    if (this.flash) {
      const k = this.flash.t / this.flash.dur * this.flash.a;
      this.flashSphere.visible = k > 0.003;
      this.flashSphere.material.color.setRGB(this.flash.r, this.flash.g, this.flash.b);
      this.flashSphere.material.opacity = k;
    } else this.flashSphere.visible = false;
    // damage vignette, plus a pulse at low HP
    const leader = G.state?.party.leader();
    const low = leader ? 1 - leader.hp / Math.max(1, leader.mhp) : 0;
    const pulse = low > 0.7 ? (low - 0.7) * (0.6 + 0.4 * Math.sin(G.time * 5)) : 0;
    const h = Math.max(this.hurtLevel, pulse);
    this.hurt.visible = h > 0.01;
    this.hurt.material.opacity = h;
    G.pictures?.render();
    // animation sprites face the viewer
    if (this.anims.length) {
      const q = this.camera.getWorldQuaternion(new THREE.Quaternion());
      for (const a of this.anims) for (const v of a.visList || (a.vis ? [a.vis] : [])) v.face(q);
    }
  }

  // ---- battle/map animations (Show Animation, skills): sprites, SE timings and flashes ----
  // target: a position (a battler's centre; opts.height = its height), a map character, or the player.
  // opts.rate: game frames per animation frame (VX Ace: 4 = 15 fps; smaller plays faster);
  // opts.attack: a plain weapon attack (setting 스킬 애니메이션 = 스킬만 skips its sprites);
  // opts.sePos: where the sounds come from, if not the target (a gun's muzzle);
  // opts.world: a place in the world (an attack's area), not a battler's picture to stand in front of;
  // opts.size: how wide the drawing should be, in metres (an attack's reach); opts.copies: more places
  // ([{ pos, size }]) the drawing plays at too, silently (an area attack all over its circle);
  // opts.visual === false: only its sounds and flashes; opts.centerVisual === false: drawn at the copies only
  playAnimationOn(target, animId, opts = {}) {
    const anim = $data.animations?.[animId];
    if (!anim || !target) return;
    const { pos, onPlayer, near } = this.animAnchor(target, anim, opts);
    const sePos = opts.sePos || pos;
    let frame = 0;
    const timings = anim.timings || [];
    const rate = opts.rate || 4;
    const frames = Math.max(1, anim.frame_max || 1);
    const total = Math.max(1, Math.round(frames * rate));
    const mode = G.settings.skillAnims || 'all';
    const show = G.three && opts.visual !== false && (mode === 'all' || (mode === 'skills' && !opts.attack));
    const sizeScale = size => THREE.MathUtils.clamp(size / (2 * animRadius(anim)), 0.25, 5);
    const vis = [];
    if (show) {
      // close to the face a drawing is made smaller and dimmer, so it never fills the view
      const scale = onPlayer ? 0.45 : (opts.size ? sizeScale(opts.size) : 1) * near;
      if (opts.centerVisual !== false) vis.push(new AnimVisual(anim, pos, { scale, dim: onPlayer ? 0.6 : 1 }));
      const head = G.player?.headWorld(new THREE.Vector3());
      for (const c of opts.copies || []) {
        const at = c.pos.clone();
        const k = head ? this.keepAway(at, head) : 1;
        vis.push(new AnimVisual(anim, at, { scale: sizeScale(c.size || opts.size || 2) * k }));
      }
    }
    const fx = this;
    const a = {
      done: false, vis: vis[0] || null, visList: vis,
      update() {
        for (const tm of timings) {
          if (Math.round(tm.frame * rate) === frame) {
            if (tm.se?.name && !opts.mute) G.audio?.playSe(tm.se, sePos);          // (mute: its pictures only)
            if (tm.flash_scope === 1 && !onPlayer && show) G.combat?.flashAt?.(pos, tm.flash_color);
            if (tm.flash_scope === 2 && !NO_SCREEN_FLASH.has(anim.id)) fx.startFlash(tm.flash_color, tm.flash_duration * rate);
            if (tm.flash_scope === 3) opts.onHide?.(tm.flash_duration * rate);
          }
        }
        const fi = Math.min(frames - 1, Math.floor(frame / rate));
        for (const v of vis) if (fi !== v.frame) v.show(fi);
        if (++frame >= total) { this.done = true; for (const v of vis) v.dispose(); }
      },
    };
    this.anims.push(a);
  }
  // a place too close to the face is pushed out to arm's length; returns how much smaller to draw there
  keepAway(pos, head, min = 0.9) {
    const dx = pos.x - head.x, dz = pos.z - head.z;
    const d = Math.hypot(dx, dz);
    if (d < min) {
      const f = G.player?.forwardVec?.() || new THREE.Vector3(0, 0, -1);
      const ux = d > 0.05 ? dx / d : f.x, uz = d > 0.05 ? dz / d : f.z;
      pos.x = head.x + ux * min; pos.z = head.z + uz * min;
    }
    const dist = pos.distanceTo(head);
    return THREE.MathUtils.clamp(dist / 1.6, 0.45, 1);
  }
  // where an animation plays: head / centre / feet of the target (Sprite_Base#set_animation_origin);
  // on the player (or right at the head) it plays a little way in front, smaller, instead of in the eyes
  animAnchor(target, anim, opts) {
    const head = G.player?.headWorld(new THREE.Vector3()) || new THREE.Vector3();
    let pos, h = opts.height || 0;
    if (target.isVector3) pos = target.clone();
    else if (target.isPlayer) pos = head.clone();
    else {
      h = 1.6;
      const y = G.floorAt ? G.floorAt(target.realX, target.realY) : 0;
      pos = target.viewPos ? new THREE.Vector3(target.viewPos.x, target.viewPos.y + h / 2, target.viewPos.z)
        : new THREE.Vector3((target.realX + 0.5) * T, y + h / 2, (target.realY + 0.5) * T);
    }
    if (h && anim.position === 0) pos.y += h * 0.5;
    if (h && anim.position === 2) pos.y -= h * 0.5;
    // only what is cast on the player (a heal, a buff) plays before the eyes, small; anything placed in
    // the world stays there, kept out of the face
    const onPlayer = target.isPlayer || !!opts.onPlayer;
    let near = 1;
    if (onPlayer) {
      const f = G.player?.forwardVec?.() || new THREE.Vector3(0, 0, -1);
      pos.copy(head).addScaledVector(f, 1.3);
      pos.y -= 0.25;
    } else {
      // a little toward the viewer, in front of the target's own picture
      const to = head.clone().sub(pos), len = to.length();
      if (!opts.world && len > 1e-2) pos.addScaledVector(to.divideScalar(len), Math.min(0.35, Math.max(0, len - 1.2)));
      near = this.keepAway(pos, head);
    }
    return { pos, onPlayer, near };
  }
  clearAnims() {
    for (const a of this.anims) { for (const v of a.visList || (a.vis ? [a.vis] : [])) v.dispose(); a.done = true; }
    this.anims = [];
  }
  animationFrames(animId) { return ($data.animations?.[animId]?.frame_max || 10) * 4; }
}
