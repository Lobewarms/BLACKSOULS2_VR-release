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
  show(p) {
    // (a stage play's curtain is hung on the stage instead - src/theater.js)
    if (G.theater?.takePicture(p)) { if (this.pics.delete(p[0])) this.dirty = true; return; }
    const [n, name, origin, designation, px, py, zx, zy, opacity, blend] = p;
    const previous = this.pics.get(n);
    const pic = {
      name, origin, blend,
      x: designation ? G.state.v(px) : px, y: designation ? G.state.v(py) : py,
      // Some original autoruns re-show the same image every logic tick. Retain
      // that loaded art for this frame; a cached promise resolves after render.
      zx, zy, opacity, angle: 0, img: previous?.name === name ? previous.img : null, d: 0, target: null,
    };
    this.pics.set(n, pic);
    if (name && !pic.img) loadImage('Graphics/Pictures', name).then(img => { if (this.pics.get(n) === pic) { pic.img = img; this.dirty = true; } });
    this.dirty = true;
  }
  move(p) {
    const [n, , origin, designation, px, py, zx, zy, opacity, blend, duration] = p;
    const pic = this.pics.get(n);
    if (!pic) return;
    pic.origin = origin; pic.blend = blend;
    pic.target = { x: designation ? G.state.v(px) : px, y: designation ? G.state.v(py) : py, zx, zy, opacity };
    pic.d = duration | 0;            // Game_Picture: a 0-frame move does nothing
  }
  erase(n) { G.theater?.erasePicture(n); if (this.pics.delete(n)) this.dirty = true; }
  clear() { this.pics.clear(); this.dirty = true; }

  // Port menu/map shortcuts differ from RPG Maker's B button. An active original
  // viewer may intentionally leave its picture to a separate autorun that checks
  // B and erases it. Ask that controller to close itself; never erase arbitrary
  // persistent pictures or change its switches here.
  requestViewerCancel() {
    if (!this.pics.size || !G.input?.requestRmCancel) return false;
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
          if (picture?.name && picture.opacity > 0) { G.input.requestRmCancel(); return true; }
        }
      }
    }
    return false;
  }

  // 60 Hz: moves (Game_Picture#update_move)
  update() {
    for (const pic of this.pics.values()) {
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
    const any = this.pics.size > 0;
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
    for (const n of [...this.pics.keys()].sort((a, b) => a - b)) {
      const pic = this.pics.get(n);
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
