// Balloon icons (RPG Maker "Show Balloon Icon": ! ? ♪ ♥ ...) from Graphics/System/Balloon.png, a row of
// 8 frames per balloon, shown over a character's head as Sprite_Character does: each frame 8 ticks, the
// last one held 12 more
import * as THREE from 'three';
import { loadCanvas } from './assets.js';

export const BALLOON_TIME = 8 * 8 + 12;      // ticks (1/60 s)
export const BALLOON_SIZE = 1.2;             // metres across over a character (a tile in 2D, a little smaller here)

let sheet = null, loading = null;
function balloonSheet() {
  if (!loading) {
    loading = loadCanvas('Graphics/System', 'Balloon').then(c => {
      if (!c) return;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      sheet = { tex, canvas: c, cols: Math.max(1, Math.floor(c.width / 32)), rows: Math.max(1, Math.floor(c.height / 32)) };
    });
  }
  return sheet;
}
// the sheet as it was loaded ({ canvas, cols, rows }), or null until it has come - the first ask starts it coming
// (the emote ring draws its balloons from it - src/emotes.js)
export function balloonSheetNow() { return balloonSheet(); }

// the frame shown with `time` ticks left (Sprite_Character#balloon_frame_index)
function balloonFrame(time) {
  return THREE.MathUtils.clamp(7 - Math.max(Math.floor((time - 1 - 12) / 8), 0), 0, 7);
}

export class BalloonIcon {
  // size: metres across; the icon's bottom middle goes on the point it is given
  constructor(parent, size) {
    this.parent = parent;
    this.size = size;
    this.sprite = null;
  }
  // id: the balloon (1 = !, 0 = none), time: ticks left, y: where its bottom goes
  update(id, time, y) {
    const s = balloonSheet();
    if (!id || !s || id > s.rows) { if (this.sprite) this.sprite.visible = false; return; }
    if (!this.sprite) {
      const tex = s.tex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1 / s.cols, 1 / s.rows);
      this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      this.sprite.center.set(0.5, 0);
      this.sprite.scale.set(this.size, this.size, 1);
      this.sprite.renderOrder = 1300;
      this.parent.add(this.sprite);
    }
    this.sprite.material.map.offset.set(balloonFrame(time) / s.cols, 1 - id / s.rows);
    this.sprite.position.y = y;
    this.sprite.visible = true;
  }
  dispose() {
    if (!this.sprite) return;
    this.parent.remove(this.sprite);
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
    this.sprite = null;
  }
}
