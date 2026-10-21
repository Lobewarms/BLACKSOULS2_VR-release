// Show / Move / Erase Picture in VR. Pictures are composed at the game's screen size (640x480, set by the
// game's scripts) on a canvas shown as a big screen behind the message window, so the message box covers
// its bottom like the original's does. A picture that fills the screen (the Liddell house rooms, black
// fades, curtains) also dims the world around the screen, like a cinema.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { loadImage } from '../data/assets.js';

const SW = 640, SH = 480;
const WIDTH = 2.6;                 // metres; about 57 degrees wide at the viewing distance
const DIST = 2.4;                  // metres from the eyes

// how much of an image is opaque (a full-screen picture with a see-through middle must not black out the world)
const opaqueCache = new Map();
function opaqueRatio(img) {
  if (opaqueCache.has(img)) return opaqueCache.get(img);
  let r = 1;
  try {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 24);
    const d = ctx.getImageData(0, 0, 32, 24).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    r = s / (255 * 32 * 24);
  } catch { /* */ }
  opaqueCache.set(img, r);
  return r;
}

export class PictureLayer {
  constructor(ui, camera) {
    this.ui = ui;
    this.pics = new Map();           // picture number -> state
    this.battlePics = new Map();     // each original troop Game_Screen owns its picture numbers
    this.endedBattles = new WeakSet();
    this.canvas = document.createElement('canvas');
    this.canvas.width = SW; this.canvas.height = SH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, WIDTH * SH / SW), new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    }));
    // over the world and the screen's tone, under its flash and fade (src/screen.js) and the message window and menus:
    // the original tints only the map (viewport 1) - a picture shown on a screen toned black is seen
    this.mesh.renderOrder = 2991.5;
    this.mesh.visible = false;
    ui.root.add(this.mesh);
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({
      color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    }));
    this.backdrop.renderOrder = 2991.4;
    this.backdrop.frustumCulled = false;
    this.backdrop.visible = false;
    camera.add(this.backdrop);
    this.dirty = false;
    this.wasEmpty = true;
  }

  // ---- event commands ----
  picturesFor(battle = null, create = false) {
    if (!battle) return this.pics;
    if (battle.done || this.endedBattles.has(battle)) return null;
    let pictures = this.battlePics.get(battle);
    if (!pictures && create) { pictures = new Map(); this.battlePics.set(battle, pictures); this.dirty = true; }
    return pictures;
  }
  displayedPictures() {
    let pictures = this.pics;
    for (const [battle, owned] of this.battlePics) {
      if (battle.done) { owned.clear(); this.endedBattles.add(battle); this.battlePics.delete(battle); this.dirty = true; }
      else pictures = owned;
    }
    return pictures;
  }
  show(p, battle = null) {
    const pictures = this.picturesFor(battle, true);
    if (!pictures) return;
    // (a stage play's curtain is hung on the stage instead - src/theater.js)
    if ((!battle || G.theater?.battle === battle) && G.theater?.takePicture(p)) {
      if (pictures.delete(p[0])) this.dirty = true;
      return;
    }
    const [n, name, origin, designation, px, py, zx, zy, opacity, blend] = p;
    const previous = pictures.get(n);
    const pic = {
      name, origin, blend,
      x: designation ? G.state.v(px) : px, y: designation ? G.state.v(py) : py,
      // Some original autoruns re-show the same image every logic tick. Retain
      // that loaded art for this frame; a cached promise resolves after render.
      zx, zy, opacity, angle: 0, img: previous?.name === name ? previous.img : null, d: 0, target: null,
    };
    pictures.set(n, pic);
    if (name && !pic.img) loadImage('Graphics/Pictures', name).then(img => {
      if (this.picturesFor(battle) === pictures && pictures.get(n) === pic) { pic.img = img; this.dirty = true; }
    });
    this.dirty = true;
  }
  move(p, battle = null) {
    const [n, , origin, designation, px, py, zx, zy, opacity, blend, duration] = p;
    const pic = this.picturesFor(battle)?.get(n);
    if (!pic) return;
    pic.origin = origin; pic.blend = blend;
    pic.target = { x: designation ? G.state.v(px) : px, y: designation ? G.state.v(py) : py, zx, zy, opacity };
    pic.d = duration | 0;            // Game_Picture: a 0-frame move does nothing
  }
  erase(n, battle = null) {
    if (battle && (battle.done || this.endedBattles.has(battle))) return;
    if (!battle || G.theater?.battle === battle) G.theater?.erasePicture(n);
    if (this.picturesFor(battle)?.delete(n)) this.dirty = true;
  }
  endBattle(battle) {
    if (battle) this.endedBattles.add(battle);
    const pictures = this.battlePics.get(battle);
    if (!pictures && !this.dirty) return;
    pictures?.clear(); this.battlePics.delete(battle); this.dirty = true;
    this.render(); // do not leave the final meter/backdrop visible until another logic tick
  }
  clearBattlePictures() {
    if (!this.battlePics.size && !this.dirty) return;
    for (const [battle, pictures] of this.battlePics) { pictures.clear(); this.endedBattles.add(battle); }
    this.battlePics.clear(); this.dirty = true; this.render();
  }
  clear() {
    this.finishViewerCancel();
    this.pics.clear();
    for (const [battle, pictures] of this.battlePics) { pictures.clear(); this.endedBattles.add(battle); }
    this.battlePics.clear(); this.dirty = true;
  }

  // Port menu/map shortcuts differ from RPG Maker's B button. An active original
  // viewer may intentionally leave its picture to a separate autorun that checks
  // B and erases it. Ask that controller to close itself; never erase arbitrary
  // persistent pictures or change its switches here.
  requestViewerCancel() {
    if (this.displayedPictures() !== this.pics || !this.pics.size || !G.input?.requestRmCancel) return false;
    for (const event of G.map?.eventList || []) {
      if (event.erased || !event.page || ![3, 4].includes(event.trigger)) continue;
      const list = event.list || [];
      for (let i = 0; i < list.length; i++) {
        const command = list[i];
        if (command.code !== 111 || command.parameters?.[0] !== 11 || command.parameters[1] !== 12) continue;
        // Only the true B branch owns this cancellation, not its Else branch or
        // an unrelated later Erase Picture command on the same event page.
        for (let j = i + 1; j < list.length && list[j].indent > command.indent; j++) {
          const next = list[j], picture = next.code === 235 ? this.pics.get(next.parameters?.[0]) : null;
          if (picture?.name && picture.opacity > 0) {
            this.finishViewerCancel();
            G.input.requestRmCancel();
            this.menuCancel = { map: G.map, mapId: G.map.mapId, state: G.state, event, page: event.page, list,
              pictureId: next.parameters[0], pictureName: picture.name, cancelFrame: G.frame,
              accumulator: 0, ticks: 0, interpreter: null, executionId: null, restart: false };
            return true;
          }
        }
      }
    }
    return false;
  }

  // Menus keep the world frozen. Only this original picture controller may
  // consume its native B input and finish an authored wait/erase sequence.
  viewerCancelPending() {
    const pending = this.menuCancel;
    if (!pending) return false;
    const event = pending.event, picture = this.pics.get(pending.pictureId);
    const valid = pending.map === G.map && pending.mapId === G.map?.mapId && pending.state === G.state && !G.map?.transferring && !G.coop?.phantom
      && G.map.events[event.id] === event
      && !event.erased && event.page === pending.page && event.list === pending.list && [3, 4].includes(event.trigger)
      && (!event.findProperPage || event.findProperPage() === pending.page)
      && picture?.name === pending.pictureName && picture.opacity > 0 && pending.ticks < 600;
    if (!valid) this.finishViewerCancel();
    return !!valid;
  }
  finishViewerCancel() {
    const pending = this.menuCancel;
    if (pending && G.input?.rmCancelFrame === pending.cancelFrame) G.input.rmCancelFrame = null;
    this.menuCancel = null;
  }
  advanceViewerCancel(dt = 1 / 60) {
    if (!this.viewerCancelPending() || !(G.ui?.menuOpen || G.ui?.sceneOpen) || G.movies?.busy?.()) return false;
    const pending = this.menuCancel;
    pending.accumulator += Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    let steps = 0;
    while (pending.accumulator + 1e-9 >= 1 / 60 && steps++ < 4 && this.viewerCancelPending()) {
      pending.accumulator -= 1 / 60; pending.ticks++;
      const event = pending.event;
      const interpreter = event.trigger === 4 ? event.interpreter : pending.map.interpreter;
      if (!interpreter || pending.interpreter && (interpreter !== pending.interpreter || interpreter.executionId !== pending.executionId)
        || interpreter.running() && (interpreter.list !== pending.list || interpreter.eventId !== event.id)
        || pending.interpreter && !interpreter.running() && !pending.restart) {
        this.finishViewerCancel(); break;
      }
      if (!interpreter.running()) {
        // Match native autorun/parallel restarts without selecting any other
        // starting event, common event, route or scene in the frozen world.
        if (event.trigger === 3 && interpreter.eventId > 0 && interpreter.eventId !== event.id) {
          pending.map.events[interpreter.eventId]?.unlock?.();
          G.coop?.eventDone?.(interpreter.mapId, interpreter.eventId);
        }
        interpreter.setup(pending.list, event.id); event.starting = false;
      }
      pending.interpreter = interpreter; pending.executionId = interpreter.executionId; pending.restart = false;
      G.input.requestRmCancel(); pending.cancelFrame = G.frame;
      interpreter.update();
      if (!this.viewerCancelPending()) break;
      pending.restart = !interpreter.running();
    }
    return !!this.menuCancel;
  }

  // 60 Hz: moves (Game_Picture#update_move)
  update() {
    if (this.menuCancel && !(G.ui?.menuOpen || G.ui?.sceneOpen)) this.finishViewerCancel();
    else this.viewerCancelPending();
    this.displayedPictures(); // release finished scopes even if the end hook was bypassed
    for (const pictures of [this.pics, ...this.battlePics.values()]) for (const pic of pictures.values()) {
      if (pic.d <= 0 || !pic.target) continue;
      const d = pic.d, t = pic.target;
      pic.x = (pic.x * (d - 1) + t.x) / d;
      pic.y = (pic.y * (d - 1) + t.y) / d;
      pic.zx = (pic.zx * (d - 1) + t.zx) / d;
      pic.zy = (pic.zy * (d - 1) + t.zy) / d;
      pic.opacity = (pic.opacity * (d - 1) + t.opacity) / d;
      pic.d--;
      this.dirty = true;
    }
  }

  // per rendered frame: redraw when something changed, keep the screen in front of the player
  render() {
    const pictures = this.displayedPictures();
    const any = pictures.size > 0;
    if (any) {
      if (this.wasEmpty) this.ui.placeRoot(true);      // a new picture scene starts where the player looks
      else this.ui.placeRoot();
    }
    this.wasEmpty = !any;
    this.mesh.position.set(0, 0.25, -(DIST - (G.vr ? 1.35 : 1.15)));
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SW, SH);
    let drawn = 0, dim = 0;
    for (const n of [...pictures.keys()].sort((a, b) => a - b)) {
      const pic = pictures.get(n);
      const img = pic.img;
      if (!img || pic.opacity <= 0) continue;
      const sx = pic.zx / 100, sy = pic.zy / 100;
      const w = img.width * sx, h = img.height * sy;
      const x0 = pic.origin === 1 ? pic.x - w / 2 : pic.x, y0 = pic.origin === 1 ? pic.y - h / 2 : pic.y;
      ctx.save();
      ctx.globalAlpha = Math.min(1, pic.opacity / 255);
      ctx.globalCompositeOperation = pic.blend === 1 ? 'lighter' : pic.blend === 2 ? 'multiply' : 'source-over';
      ctx.drawImage(img, x0, y0, w, h);
      ctx.restore();
      drawn++;
      // covers (nearly) the whole screen: dim the world behind it by how solid it is
      const cover = Math.max(0, Math.min(SW, x0 + w) - Math.max(0, x0)) * Math.max(0, Math.min(SH, y0 + h) - Math.max(0, y0)) / (SW * SH);
      if (cover > 0.95 && pic.blend !== 1) dim = Math.max(dim, Math.min(1, pic.opacity / 255) * opaqueRatio(img));
    }
    this.tex.needsUpdate = true;
    this.mesh.visible = drawn > 0;
    this.backdrop.material.opacity = 0.9 * dim;
    this.backdrop.visible = dim > 0.01;
  }
}
