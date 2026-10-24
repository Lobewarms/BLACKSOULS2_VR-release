// The other co-op player as this world shows it: its body as the map's people are drawn (CharacterSprite - its party
// leader's character sheet, the look chosen in the prologue or the recollection room), turning and stepping as it
// moves, and its hands apart from it where its own hands are: a bare hand bending its fingers as the other's do, or
// what that hand holds (the weapon, shield or gun built from the item's icon, held as the other holds it; or what it
// holds ready or in hand instead: a spell's light, a thing to throw, a bottle, a syringe, a resin) - and its name over its
// head, its voice chat marks beside it.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';
import { TS } from '../world/tiles.js';
import { CharacterSprite } from '../entities/sprites.js';
import { buildIconModel } from '../combat/weapons.js';
import { makeHand } from '../vr/hands.js';
import { $data } from '../data/data.js';
import { BALLOON_TIME } from '../ui/balloons.js';
import { FONT } from '../ui/ui.js';
import { ChatBubble, tagScale } from './coopchat.js';
import { voiceMarksReady, voiceMarksSize, drawVoiceMarks } from './voicemarks.js';

const SNAP = 3;            // m: farther than this from where it was shown, it is put there at once
const NAME_FAR = 20;       // m: farther off than this its name is not shown
const MARK_PIC = 76;       // px on its name's canvas (its letters 54): each voice mark's picture
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();

// what CharacterSprite reads of a character
class Body {
  constructor() {
    this.isEvent = false; this.id = -2; this.tileId = 0;
    this.characterName = ''; this.characterIndex = 0;
    this.direction = 2; this.pattern = 1; this.opacity = 255; this.blendType = 0; this.transparent = false;
    this.realX = 0; this.realY = 0; this.x = 0; this.y = 0; this.balloonId = 0; this.balloonTime = 0; this.jumpY = 0;
  }
  jumping() { return this.jumpY > 0.01; }
  jumpHeight() { return this.jumpY / T * TS; }
}

// the four ways a sheet faces, from a facing angle (forward = -sin, -cos)
function dirOfYaw(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 6 : 4;
  return fz > 0 ? 2 : 8;
}

// a part's box in its own frame (what it holds: built once for each item)
function localBox(g) {
  g.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), box = new THREE.Box3(), m = new THREE.Matrix4();
  g.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  return box;
}

function disposeTree(o) {
  o.traverse(c => { if (c.isMesh) { c.geometry?.dispose(); c.material?.map?.dispose?.(); c.material?.dispose?.(); } });
}
// (what a hand holds ready: a spell's light shares the glow picture of combat.js - kept; an icon's picture goes)
function disposeUse(o) {
  const glow = G.combat?._glowTex;
  o.traverse(c => {
    if (c.isMesh) { c.geometry?.dispose(); c.material?.map?.dispose?.(); c.material?.dispose?.(); }
    else if (c.isSprite) { if (c.material?.map && c.material.map !== glow) c.material.map.dispose(); c.material?.dispose?.(); }
  });
}

export class CoopAvatar {
  constructor(scene) {
    this.scene = scene;
    this.body = new Body();
    this.sprite = null;
    this.mapInfo = null;
    this.root = new THREE.Group();
    this.root.name = 'coop-peer';
    scene.add(this.root);
    this.hands = {};
    for (const side of ['left', 'right']) {
      const h = { hand: new THREE.Group(), item: new THREE.Group(), model: null, loading: false, itemKey: '', shown: { hand: false, item: false } };
      h.hand.visible = h.item.visible = false;
      this.root.add(h.hand, h.item);
      this.hands[side] = h;
    }
    // what a hand holds ready or in hand instead of its weapon (look U), where the pose puts it (u)
    this.held = { use: new THREE.Group(), shown: { use: false } };
    this.held.use.visible = false;
    this.root.add(this.held.use);
    this.useKey = '';
    this.pose = null;          // the last pose received
    this.cur = null;           // where it is shown {x, y, z, yaw}
    this.walk = 0; this.speed = 0;
    this.gone = false;
    this.hurtT = 0;
  }
  // struck by this world's enemy (coop.js RemoteBody): a red flash over it, the actor-damage sound where it stands
  flashHurt() {
    this.hurtT = 0.3;
    const se = $data.system.sounds?.[14];
    if (se && this.cur) G.audio?.playSe(se, new THREE.Vector3(this.cur.x, this.cur.y - 0.4, this.cur.z));
  }

  setLook(look) {
    this.setName(look.nm || '');
    this.vc = look.vc ?? -1;                 // (its voice setting - shown beside its name: drawTag)
    this.setPvp(!!look.pv);
    this.body.characterName = look.chr[0];
    this.body.characterIndex = look.chr[1];
    for (const side of ['right', 'left']) {
      const spec = look[side === 'right' ? 'R' : 'L'];
      const h = this.hands[side];
      const key = spec ? JSON.stringify(spec) : '';
      if (key === h.itemKey) continue;
      h.itemKey = key;
      h.kind = spec?.kind || null; h.box = null;
      for (const c of [...h.item.children]) { h.item.remove(c); disposeTree(c); }
      if (!spec) continue;
      const model = buildIconModel(spec.icon, { kind: spec.kind, wtype: spec.wtype, hand: spec.hand, large: spec.large, span: spec.sz || 0, adjust: { ...spec.adj } });
      if (model) h.item.add(model);
    }
    const ukey = look.U ? JSON.stringify(look.U) : '', g = this.held.use;
    if (ukey !== this.useKey) {
      this.useKey = ukey;
      for (const c of [...g.children]) { g.remove(c); disposeUse(c); }
      const m = look.U && G.combat?.peerUseModel?.(look.U);
      if (m) g.add(m);
      this.shaded = undefined;               // (a shade's look goes on it too)
    }
  }
  setPose(p) { this.pose = p; }
  // a line it said in the chat (coopchat.js): over its head for a while
  say(text) { (this.bubble ||= new ChatBubble(this.scene, FONT)).say(text); }
  // its name (it chose it - coop.js), and beside it its voice chat marks (voicemarks.js: its voice setting, the microphone
  // solid while it speaks - an older version telling none: no marks), drawn again only when one of them changes; shown
  // over its head unless the co-op menu hides names
  setName(name) {
    if (name === this.nameText) return;
    this.nameText = name;
    this.drawTag();
  }
  setVoice(code, speaking) {
    const key = code >= 0 && voiceMarksReady() ? `${code}/${speaking ? 1 : 0}` : '';
    if (key === (this.voiceKey || '')) return;
    this.voiceKey = key;
    this.voiceMarks = [code, !!speaking];
    this.drawTag();
  }
  drawTag() {
    const name = this.nameText || '';
    if (!this.nameTag) {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 96;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      this.nameTag.scale.set(0.8, 0.15, 1);
      this.nameTag.renderOrder = 1400;
      this.nameTag.visible = false;
      this.scene.add(this.nameTag);
    }
    const tex = this.nameTag.material.map, cv = tex.image, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    // (the name and the marks after it, centred together: a long name gives way)
    const [mw, mh] = this.voiceKey ? voiceMarksSize(MARK_PIC) : [0, 0], gap = mw ? 14 : 0;
    let size = 54;
    ctx.font = `bold ${size}px ${FONT}`;
    let w = ctx.measureText(name).width;
    const room = cv.width - 24 - mw - gap;
    if (w > room) { size = Math.floor(size * room / w); ctx.font = `bold ${size}px ${FONT}`; w = ctx.measureText(name).width; }
    const x = (cv.width - w - gap - mw) / 2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(name, x, cv.height / 2);
    ctx.fillStyle = '#e6ecf6';
    ctx.fillText(name, x, cv.height / 2);
    if (mw) drawVoiceMarks(ctx, x + w + gap, (cv.height - mh) / 2, MARK_PIC, this.voiceMarks[0], this.voiceMarks[1]);
    tex.needsUpdate = true;
  }

  // (the developer's world) its own PvP on: a red PVP over its name - shown even with the names hidden (who may strike
  // this player is to be seen)
  setPvp(on) {
    if (on === this.pvpOn) return;
    this.pvpOn = on;
    if (!on || this.pvpTag) return;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('PVP', cv.width / 2, cv.height / 2);
    ctx.fillStyle = '#ff3b30';
    ctx.fillText('PVP', cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.pvpTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.pvpTag.scale.set(0.4, 0.15, 1);
    this.pvpTag.renderOrder = 1400;
    this.pvpTag.visible = false;
    this.scene.add(this.pvpTag);
  }

  hide() {
    this.root.visible = false;
    if (this.sprite) this.sprite.group.visible = false;
    if (this.nameTag) this.nameTag.visible = false;
    if (this.pvpTag) this.pvpTag.visible = false;
    if (this.bubble) this.bubble.sprite.visible = false;
    this.cur = null;
  }

  update(dt, viewer) {
    const p = this.pose, m = G.map;
    if (this.gone || !p || !m?.grid || p.m !== m.mapId || !G.view?.mapInfo || G.view.mapId !== m.mapId) { this.hide(); return; }
    // (the map's people are drawn with what the map's 3D view knows of it: a new map, a new picture)
    if (this.mapInfo !== G.view.mapInfo) {
      this.sprite?.dispose();
      this.mapInfo = G.view.mapInfo;
      this.sprite = new CharacterSprite(this.body, this.scene, this.mapInfo);
      this.cur = null;
    }
    // a looping map: the copy of it nearest to the viewer
    const hx = p.h[0], hz = p.h[2];
    const ox = (m.nearX(hx / T - 0.5, viewer.x / T - 0.5) - (hx / T - 0.5)) * T;
    const oz = (m.nearY(hz / T - 0.5, viewer.z / T - 0.5) - (hz / T - 0.5)) * T;
    const tx = hx + ox, ty = p.h[1], tz = hz + oz;
    const k = 1 - Math.exp(-dt * 14);
    const appear = !this.cur;
    if (!this.cur || Math.hypot(tx - this.cur.x, tz - this.cur.z) > SNAP) {
      this.cur = { x: tx, y: ty, z: tz, yaw: p.h[3] };
      this.speed = 0;
    } else {
      const c = this.cur, px = c.x, pz = c.z;
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.z += (tz - c.z) * k;
      let dy = p.h[3] - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yaw += dy * k;
      const v = Math.hypot(c.x - px, c.z - pz) / Math.max(dt, 1e-3);
      this.speed += (v - this.speed) * Math.min(1, dt * 8);
    }
    const c = this.cur, b = this.body;
    // the body: where its head is, on the floor there, facing the way it looks, stepping while it goes
    b.realX = b.prevRealX = c.x / T - 0.5;
    b.realY = b.prevRealY = c.z / T - 0.5;
    b.x = m.wrapX(Math.round(b.realX)); b.y = m.wrapY(Math.round(b.realY));
    b.direction = dirOfYaw(c.yaw);
    b.jumpY = Math.max(0, p.j || 0);
    if (this.speed > 0.5) { this.walk += dt * 6.5; b.pattern = [0, 1, 2, 1][Math.floor(this.walk) % 4]; } else { this.walk = 0; b.pattern = 1; }
    // fallen and watching a boss fight: a shade (its picture and what its hands hold, nearly see-through)
    b.opacity = p.sp ? 80 : 255;
    if (!!p.sp !== this.shaded) {
      this.shaded = !!p.sp;
      for (const g of [...Object.values(this.hands).flatMap(h => [h.hand, h.item]), this.held.use]) g.traverse(o => {
        for (const m of [].concat(o.material || [])) { if (m.userData.op === undefined) m.userData.op = [m.transparent, m.opacity];
          [m.transparent, m.opacity] = this.shaded ? [true, 0.3] : m.userData.op; m.needsUpdate = true; }
      });
    }
    // a balloon over it: one an event of its world put on it, or one it put up itself (an emote - emotes.js), its last
    // frame held for as long as it is up there
    const want = p.b;
    if (want !== this.balloonFor) { this.balloonFor = want; b.balloonId = want; b.balloonTime = want ? BALLOON_TIME : 0; }
    else if (want && b.balloonId) {
      b.balloonTime -= dt * 60;
      if (b.balloonTime <= 0) b.balloonTime = 1;
    }
    this.sprite.update(viewer, 1);
    // over it: its name, its PVP, what it said - drawn bigger the farther off it is (as big to the eye, up to a limit -
    // coopchat.js tagScale), stacked as big
    const far = Math.hypot(c.x - viewer.x, c.z - viewer.z), ks = tagScale(far);
    // (its voice chat marks by its name: its voice setting - its look -, and whether it speaks now - its poses)
    this.setVoice(this.vc ?? -1, !!p.v);
    // its name over the top of its picture (walls hide it as they hide it; a shade's is dim)
    if (this.nameTag) {
      const sm = this.sprite.mesh, g = this.sprite.group;
      const show = G.settings.coopNames !== false && !!this.nameText && !!sm && g.visible && far < NAME_FAR;
      this.nameTag.visible = show;
      if (show) {
        const top = sm.position.y + (sm.geometry.parameters?.height || T) * sm.scale.y - (this.sprite.headDrop || 0);
        this.nameTag.scale.set(0.8 * ks, 0.15 * ks, 1);
        this.nameTag.position.set(c.x, g.position.y + top + 0.22 * ks, c.z);
        this.nameTag.material.opacity = p.sp ? 0.35 : 1;
      }
    }
    // its PvP on: the red PVP just over its name (where the name would be, the names hidden)
    if (this.pvpTag) {
      const sm = this.sprite.mesh, g = this.sprite.group;
      const show = !!this.pvpOn && !!sm && g.visible && far < NAME_FAR;
      this.pvpTag.visible = show;
      if (show) {
        const top = sm.position.y + (sm.geometry.parameters?.height || T) * sm.scale.y - (this.sprite.headDrop || 0);
        this.pvpTag.scale.set(0.4 * ks, 0.15 * ks, 1);
        this.pvpTag.position.set(c.x, g.position.y + top + (this.nameTag?.visible ? 0.37 : 0.22) * ks, c.z);
        this.pvpTag.material.opacity = p.sp ? 0.35 : 1;
      }
    }
    // what it said (coopchat.js): a balloon over its name and its PVP, while it stays up
    if (this.bubble) {
      const sm = this.sprite.mesh, g = this.sprite.group;
      const top = sm ? sm.position.y + (sm.geometry.parameters?.height || T) * sm.scale.y - (this.sprite.headDrop || 0) : 1.6;
      const over = ((this.pvpTag?.visible ? 0.52 : this.nameTag?.visible ? 0.37 : 0.22) - 0.05) * ks;
      this.bubble.place(c.x, g.position.y + top + over, c.z, !!sm && g.visible, far);
    }
    this.hurtT = Math.max(0, this.hurtT - dt);
    const mat = this.sprite.mesh?.material;
    if (mat?.emissive) mat.emissive.setRGB(this.hurtT > 0 ? 0.8 * this.hurtT / 0.3 : 0, 0.02, 0.02);
    this.root.visible = true;
    // the hands, and what they hold
    for (const side of ['left', 'right']) {
      const h = this.hands[side], d = p[side === 'right' ? 'R' : 'L'] || {};
      h.lowered = !!d.lo;
      if (d.h && !h.model && !h.loading) {
        h.loading = true;
        makeHand(side).then(model => { if (this.gone) { model.dispose(); return; } h.model = model; h.hand.add(model.root); });
      }
      this.placePart(h, 'hand', d.h, ox, oz, k);
      this.placePart(h, 'item', d.i, ox, oz, k);
      if (h.model && h.hand.visible) h.model.pose(dt, d.c?.[0] || 0, d.c?.[1] || 0, (d.c?.[2] || 0) > 0.5);
    }
    this.placePart(this.held, 'use', this.held.use.children.length ? p.u : null, ox, oz, k);
    if (appear) {
      const at = new THREE.Vector3(c.x, (G.floorAt ? G.floorAt(b.realX, b.realY) : 0) + 0.9, c.z);
      G.combat?.spawnGlow?.(at, { color: 0xd8e8ff, size: 1.2, life: 0.5, grow: 1.6 });
    }
  }
  // (PvP) what its hands hold, as this world shows them now - for a blade to meet (combat.js clashWithPlayers), each
  // in its own frame (m: that frame in the world): a weapon its blade - from the grip along -Z, its length, and its
  // cross guard if it has one (as weapons.js builds it) - a shield its box
  heldShapes() {
    const out = [];
    if (!this.root.visible) return out;
    for (const side of ['right', 'left']) {
      const h = this.hands[side];
      if (!h.kind || !h.item.visible || !h.item.children.length) continue;
      h.item.updateWorldMatrix(true, false);
      if (h.kind === 'shield') {
        if (h.lowered) continue;                 // (a PC player's shield held down at its side: no guard)
        h.box ||= localBox(h.item);
        if (!h.box.isEmpty()) out.push({ side, kind: 'shield', box: h.box, m: h.item.matrixWorld });
      } else {
        const d = h.item.children[0]?.userData, len = d?.length || 0;
        if (len > 0.15) out.push({ side, kind: 'weapon', len, guard: d.guard || null, m: h.item.matrixWorld });
      }
    }
    return out;
  }
  // one part at the place sent for it (a world position and turn), eased there from where it was shown
  placePart(h, part, xf, ox, oz, k) {
    const o = h[part];
    if (!xf) { o.visible = false; h.shown[part] = false; return; }
    const x = xf[0] + ox, y = xf[1], z = xf[2] + oz;
    tmpQ.set(xf[3], xf[4], xf[5], xf[6]).normalize();
    if (!h.shown[part] || o.position.distanceTo(tmpV.set(x, y, z)) > SNAP) {
      o.position.set(x, y, z);
      o.quaternion.copy(tmpQ);
    } else {
      o.position.x += (x - o.position.x) * k; o.position.y += (y - o.position.y) * k; o.position.z += (z - o.position.z) * k;
      o.quaternion.slerp(tmpQ, k);
    }
    o.visible = true;
    h.shown[part] = true;
  }

  dispose() {
    this.gone = true;
    this.sprite?.dispose();
    this.sprite = null;
    this.scene.remove(this.root);
    if (this.nameTag) { this.scene.remove(this.nameTag); this.nameTag.material.map.dispose(); this.nameTag.material.dispose(); this.nameTag = null; }
    if (this.pvpTag) { this.scene.remove(this.pvpTag); this.pvpTag.material.map.dispose(); this.pvpTag.material.dispose(); this.pvpTag = null; }
    this.bubble?.dispose(); this.bubble = null;
    for (const h of Object.values(this.hands)) {
      for (const c of [...h.item.children]) disposeTree(c);
      h.model?.dispose();
    }
    for (const c of [...this.held.use.children]) disposeUse(c);
  }
}
