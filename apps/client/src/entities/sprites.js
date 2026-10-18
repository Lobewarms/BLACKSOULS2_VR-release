// Character billboards for map events (4-direction RPG Maker sheets, view-dependent rows).
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { voxelGeometryOf, SLAB_THICKNESS } from '../combat/weapons.js';
import { T } from '../world/mapmesh.js';
import { loadCanvas } from '../data/assets.js';
import { TS } from '../world/tiles.js';
import { BalloonIcon, BALLOON_SIZE } from '../ui/balloons.js';
import { tileFurniture, furnitureGeometry, isUprightFurnitureTile } from './furniture.js';
import { isLyingTile } from './lying.js';
import { corpseDepth, corpseSides } from './remains.js';
import { characterPropProfile, characterPropFrame, characterTableGeometry } from './character-props.js';

const sheetCache = new Map();
async function loadSheet(name) {
  if (!sheetCache.has(name)) {
    sheetCache.set(name, loadCanvas('Graphics/Characters', name).then(c => {
      if (!c) return null;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      return { canvas: c, tex };
    }));
  }
  return sheetCache.get(name);
}

let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// empty rows under a character's picture in its frames: big frames often leave the bottom tile empty (in 2D
// that part lies over the floor in front of the wall the door or sign is drawn on), which in 3D would
// lift the picture off the floor
const marginCache = new Map();
function bottomMargin(name, canvas, info, charIndex) {
  const key = `${name}#${charIndex}`;
  if (marginCache.has(key)) return marginCache.get(key);
  let m = info.fh;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bx = info.single ? 0 : (charIndex % 4) * 3, by = info.single ? 0 : Math.floor(charIndex / 4) * 4;
    for (let r = 0; r < 4; r++) for (let pt = 0; pt < 3; pt++) {
      const d = ctx.getImageData((bx + pt) * info.fw, (by + r) * info.fh, info.fw, info.fh).data;
      let last = -1;
      for (let y = info.fh - 1; y >= 0 && last < 0; y--) {
        for (let x = 0; x < info.fw; x++) if (d[(y * info.fw + x) * 4 + 3] > 40) { last = y; break; }
      }
      if (last >= 0) m = Math.min(m, info.fh - 1 - last);
    }
  } catch { m = 0; }
  if (m >= info.fh) m = 0;
  marginCache.set(key, m);
  return m;
}

// empty rows over a character's head in its frames (how far below the frame's top the head is): where a hand
// on the head finds it (poke.js)
const topCache = new Map();
function topMargin(name, canvas, info, charIndex) {
  const key = `${name}#${charIndex}`;
  if (topCache.has(key)) return topCache.get(key);
  let m = info.fh;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bx = info.single ? 0 : (charIndex % 4) * 3, by = info.single ? 0 : Math.floor(charIndex / 4) * 4;
    for (let r = 0; r < 4; r++) for (let pt = 0; pt < 3; pt++) {
      const d = ctx.getImageData((bx + pt) * info.fw, (by + r) * info.fh, info.fw, info.fh).data;
      let first = -1;
      for (let y = 0; y < info.fh && first < 0; y++) {
        for (let x = 0; x < info.fw; x++) if (d[(y * info.fw + x) * 4 + 3] > 40) { first = y; break; }
      }
      if (first >= 0) m = Math.min(m, first);
    }
  } catch { m = 0; }
  if (m >= info.fh) m = 0;
  topCache.set(key, m);
  return m;
}

// whether a character's four rows are one thing seen from four sides (a person turning round) - or not, with
// a row left empty (the Cheshire cat drawn facing down only, a lamp's light drawn at a different height in
// each row and not at all in one): seen from the side of an empty row it would vanish, so it keeps the
// event's own row from every side, as 2D shows it
const viewsCache = new Map();
function rowsAreViews(name, canvas, info, charIndex) {
  const key = `${name}#${charIndex}`;
  if (viewsCache.has(key)) return viewsCache.get(key);
  let views = true;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bx = info.single ? 0 : (charIndex % 4) * 3, by = info.single ? 0 : Math.floor(charIndex / 4) * 4;
    // the lowest drawn line of each row's standing (middle) frame (-1: nothing drawn)
    const bottoms = [];
    for (let r = 0; r < 4; r++) {
      const d = ctx.getImageData((bx + 1) * info.fw, (by + r) * info.fh, info.fw, info.fh).data;
      let last = -1;
      for (let y = info.fh - 1; y >= 0 && last < 0; y--) {
        for (let x = 0; x < info.fw; x++) if (d[(y * info.fw + x) * 4 + 3] > 40) { last = y; break; }
      }
      bottoms.push(last);
    }
    const drawn = bottoms.filter(b => b >= 0);
    if (drawn.length && drawn.length < 4) views = false;
  } catch { /* unreadable: as a person */ }
  viewsCache.set(key, views);
  return views;
}

// whether a character is drawn see-through (a lamp's glow at half alpha): drawn so, as 2D shows it, instead of
// the alpha cut-off making it solid
const translucentCache = new Map();
function translucentArt(name, canvas, info, charIndex) {
  const key = `${name}#${charIndex}`;
  if (translucentCache.has(key)) return translucentCache.get(key);
  let drawn = 0, part = 0;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bx = info.single ? 0 : (charIndex % 4) * 3, by = info.single ? 0 : Math.floor(charIndex / 4) * 4;
    const d = ctx.getImageData(bx * info.fw, by * info.fh, info.fw * 3, info.fh * 4).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) { drawn++; if (d[i] < 224) part++; }
  } catch { /* unreadable: solid */ }
  const see = drawn > 0 && part / drawn > 0.5;
  translucentCache.set(key, see);
  return see;
}

// how tall a door picture stands, in tiles (its frame without the empty rows under it): the doorway it is set
// into opens up to there, so the wall goes on right above it as in 2D (mapmesh doorways)
export async function doorPictureHeight(name, charIndex) {
  const sheet = await loadSheet(name);
  if (!sheet) return 0;
  const info = sheetInfo(name, sheet.canvas);
  const scale = info.object ? 1.0 : 1.25;
  return (info.fh - bottomMargin(name, sheet.canvas, info, charIndex)) / TS * scale;
}

export function sheetInfo(name, canvas) {
  const sign = /^[!$]+/.exec(name)?.[0] || '';
  const single = sign.includes('$');
  const object = sign.includes('!');
  const fw = canvas.width / (single ? 3 : 12);
  const fh = canvas.height / (single ? 4 : 8);
  return { single, object, fw, fh };
}

export class CharacterSprite {
  constructor(ch, parent, mapInfo) {
    this.ch = ch;
    this.parent = parent;
    this.mapInfo = mapInfo;   // { isWall(x,y), drawer }
    this.key = '';
    this.mesh = null;
    this.shadow = null;
    this.info = null;
    this.loading = null;
    this.group = new THREE.Group();
    parent.add(this.group);
  }
  dispose() {
    this.balloon?.dispose();
    this.clearBodySides();
    this.parent.remove(this.group);
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.map?.dispose(); this.mesh.material.dispose(); }
    this.faces = null;
  }

  graphicKey() {
    const c = this.ch;
    let g = c.tileId > 0 ? `tile:${c.tileId}` : c.characterName ? `${c.characterName}#${c.characterIndex}` : '';
    if (characterPropProfile(c)?.kind === 'table') g += `/${c.direction}/${c.pattern}`;
    return g ? `${g}|${this.layMode()}` : '';
  }
  // How an event stands in 3D, so you can tell at a glance what blocks you:
  //  'stand' - blocks the way (same priority as the player): upright like a person
  //  'lie'   - can be walked over (below the player, or a pass-through object): flat on the floor, raised a little
  //  'over'  - above the player: upright, hanging above head height
  layMode() {
    const c = this.ch;
    if (!c.isEvent) return 'stand';
    // The death-retrieval flame is a beacon, even on a below-player event page.
    if (c.isSoulEvent?.()) return 'stand';
    // Corpse artwork is drawn from above. Blocking priority and scene movement
    // affect event logic, but must not turn a body into an upright billboard.
    if (this.isCorpseGraphic()) return 'lie';
    if (characterPropProfile(c)?.kind === 'table') return 'prop';
    // a door set into a wall stands on the wall whatever its priority (doors are usually "below characters"),
    // also one in a doorway with the drop behind it (the side-view tower)
    if (this.isDoorGraphic() && (this.mapInfo.isWall(c.x, c.y - 1) || this.mapInfo.isDoorway?.(c.x, c.y))) return 'stand';
    // drawn on a side-view tower's wall: hangs on it
    if (this.mapInfo.onSideWall?.(c.x, c.y)) return 'stand';
    if (this.furnitureProfile()) return 'furniture';
    // drawn with a tile that blocks the way (a pane of a church window, a crate): it stands up as that tile
    // does on the map, whatever its priority
    if (c.tileId > 0 && c.priorityType === 0 && this.mapInfo.tileFlag) {
      const f = this.mapInfo.tileFlag(c.tileId);
      if ((f & 0x0f) && !(f & 0x10)) return 'stand';
    }
    // one a scene gives a picture or moves about (the original's stand-ins for a scene are often "below
    // characters" so as not to block the way): a person, upright as the 2D draws it - things on the floor
    // (object sheets, corpses, footprints, magic circles) still lie
    if (c.priorityType === 0 && (c.acting || G.map?.sceneActors?.has(c.id)) && c.characterName && !/^[!$]*!/.test(c.characterName) &&
        !this.isCorpseGraphic() && !/足跡|footprint|魔法陣|hexagram|血/i.test(c.characterName)) return 'stand';
    if (c.priorityType === 0) return 'lie';
    if (c.priorityType === 2) return 'over';
    if (c.through && (c.tileId > 0 || /^[!$]*!/.test(c.characterName || ''))) return 'lie';
    return 'stand';
  }
  furnitureProfile() {
    const id = this.ch.tileId, names = this.mapInfo.tilesetNames;
    return tileFurniture(id, names) || (isLyingTile(id, names) ? { kind: 'flat', front: id } : null);
  }
  isDoorGraphic() { return /door|ドア|扉|門|gate/i.test(this.ch.characterName || ''); }
  // corpses (and the blood / sign pieces on the same sheet, fallen people, a dead dog, a skeleton lying still):
  // the four rows of these sheets are different drawings, not one body seen from four sides, so they keep the
  // row the event sets instead of changing with the side they are seen from
  isCorpseGraphic() {
    const n = this.ch.characterName || '';
    return /死体|Damage\d|骸骨擬態/i.test(n) ||
      /(?:^|[!$ _-])(?:corpses?|cadavers?|dead[ _-]?(?:body|dog|person|man|woman))(?=$|[ _-]|\d)/i.test(n) ||
      (/骸骨/.test(n) && this.ch.moveType === 0);
  }
  // doors / gates set into a wall stay flat against it; everything else stands in front of the wall
  isDoorLike() {
    const c = this.ch;
    if (/door|ドア|扉|門|gate/i.test(c.characterName || '')) return true;
    return !!c.list?.some?.(cmd => cmd.code === 201);
  }

  async rebuild(key) {
    this.key = key;
    this.tp = null;
    this.clearBodySides();
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.map?.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    if (this.slab) { this.group.remove(this.slab); this.slab.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.slab = undefined;
    this.tileCanvas = null;
    if (this.shadow) { this.group.remove(this.shadow); this.shadow = null; }
    for (const f of this.faces || []) this.group.remove(f);
    this.faces = [];
    if (!key) return;
    const c = this.ch;
    let tex, w, h, info, sheetCanvas = null;
    if (c.tileId > 0) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = TS;
      this.mapInfo.drawer.draw(cv.getContext('2d'), c.tileId, 0, 0);
      this.tileCanvas = cv;
      tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      info = { object: true, tile: true, fw: TS, fh: TS };
      w = T; h = T;
    } else {
      const sheet = await loadSheet(c.characterName);
      if (this.key !== key || !sheet) return;
      info = sheetInfo(c.characterName, sheet.canvas);
      tex = sheet.tex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(info.fw / sheet.canvas.width, info.fh / sheet.canvas.height);
      const scale = info.object ? 1.0 : 1.25;
      w = info.fw / TS * T * scale; h = info.fh / TS * T * scale;
      info.sheetW = sheet.canvas.width; info.sheetH = sheet.canvas.height;
      sheetCanvas = sheet.canvas;
    }
    this.info = info;
    this.mode = key.split('|').pop();
    // standing pictures touch the floor with their lowest drawn pixel, not the frame's edge
    this.footDrop = this.mode === 'stand' && sheetCanvas ? bottomMargin(c.characterName, sheetCanvas, info, c.characterIndex) / info.fh * h : 0;
    this.headDrop = this.mode === 'stand' && sheetCanvas ? topMargin(c.characterName, sheetCanvas, info, c.characterIndex) / info.fh * h : 0;
    this.rowsFixed = !!sheetCanvas && !rowsAreViews(c.characterName, sheetCanvas, info, c.characterIndex);
    this.translucent = !!sheetCanvas && translucentArt(c.characterName, sheetCanvas, info, c.characterIndex);
    const lying = this.mode === 'lie';
    this.bodyDepth = lying && this.isCorpseGraphic() ? corpseDepth(c.characterName, c.characterIndex) : 0;
    this.bodyCanvas = sheetCanvas;
    this.bodySize = [w, h];
    this.propProfile = characterPropProfile(c);
    this.propGeometry = false;
    const furniture = this.mode === 'furniture' ? this.furnitureProfile() : null;
    let geo = this.mode === 'prop' && sheetCanvas ? characterTableGeometry(characterPropFrame(c, sheetCanvas, info), this.propProfile.height, T / TS) : null;
    this.propGeometry = !!geo;
    geo ||= furniture ? furnitureGeometry(furniture, id => {
      const ctx = this.tileCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, TS, TS);
      this.mapInfo.drawer.draw(ctx, id, 0, 0);
      return ctx.getImageData(0, 0, TS, TS).data;
    }, T) : null;
    this.isFurniture = !!geo;
    geo ||= new THREE.PlaneGeometry(w, h);
    if (this.isFurniture) {
      tex.dispose();
    } else if (lying) {
      // flat on the floor, raised a little, with a soft shadow under it so it reads as an object
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, this.bodyDepth ? this.bodyDepth + 0.015 : 0.07, 0);
    } else geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ map: this.isFurniture ? null : tex, vertexColors: this.isFurniture, alphaTest: this.translucent ? 0.02 : 0.4, side: THREE.DoubleSide,
      transparent: this.translucent, depthWrite: !this.translucent });
    this.mesh = new THREE.Mesh(geo, mat);
    // facade objects (doors set into a wall) do not rotate; chests etc. stand in front of the wall
    this.facade = !lying && (info.object || this.isDoorGraphic()) && (this.mapInfo.isWall(c.x, c.y - 1) || !!this.mapInfo.isDoorway?.(c.x, c.y)) && this.isDoorLike();
    this.group.add(this.mesh);
    if (lying) {
      this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, h * 0.95), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.012;
      this.group.add(this.shadow);
    } else if (!info.object) {
      this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, w * 0.32), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.015;
      this.group.add(this.shadow);
    }
  }

  clearBodySides() {
    if (this.bodySides) {
      this.bodySides.parent?.remove(this.bodySides);
      this.bodySides.geometry.dispose(); this.bodySides.material.dispose();
    }
    this.bodySides = null; this.bodyFrame = '';
  }
  updateBodySides(row, pattern) {
    if (!this.bodyDepth || !this.bodyCanvas) return;
    const key = `${this.ch.characterIndex},${row},${pattern}`;
    if (key !== this.bodyFrame) {
      this.bodyFrame = key;
      const geometry = corpseSides(this.bodyCanvas, this.info, this.ch.characterIndex, row, pattern,
        this.bodySize[0], this.bodySize[1], this.bodyDepth);
      if (!geometry) { if (this.bodySides) this.bodySides.visible = false; return; }
      if (this.bodySides) { this.bodySides.geometry.dispose(); this.bodySides.geometry = geometry; }
      else {
        this.bodySides = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
        this.mesh.add(this.bodySides);
      }
      this.bodySides.visible = true;
    }
    if (this.bodySides) {
      const from = this.mesh.material, to = this.bodySides.material;
      to.opacity = from.opacity; to.transparent = from.transparent; to.blending = from.blending;
    }
  }

  // extra sides of a fixed tile picture's box (north, and east / west at its ends), sharing the tile
  setFaces(n) {
    this.faces = this.faces || [];
    while (this.faces.length > n) this.group.remove(this.faces.pop());
    while (this.faces.length < n) { const f = new THREE.Mesh(this.mesh.geometry, this.mesh.material); this.group.add(f); this.faces.push(f); }
    return this.faces;
  }
  setSide(side) {
    const mat = this.mesh.material;
    if (mat.side !== side) { mat.side = side; mat.needsUpdate = true; }
  }
  // the tile a little thick, like the held weapons: its drawing in front and (mirrored) behind, and between them
  // the edges of its pixels as small blocks; its foot at 0
  slabMesh() {
    if (this.slab !== undefined) return this.slab;
    this.slab = null;
    const cv = this.tileCanvas;
    if (!cv || !this.mesh) return null;
    const t = SLAB_THICKNESS / 2 * T / TS;
    const g = new THREE.Group();
    const face = new THREE.MeshLambertMaterial({ map: this.mesh.material.map, alphaTest: 0.4 });
    const plane = new THREE.PlaneGeometry(T, T).translate(0, T / 2, 0);
    const front = new THREE.Mesh(plane, face), back = new THREE.Mesh(plane, face);
    front.position.z = t;
    back.position.z = -t;
    back.rotation.y = Math.PI;
    g.add(front, back);
    const sides = voxelGeometryOf(cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, TS, TS).data, TS, TS, SLAB_THICKNESS, false, false);
    if (sides) {
      sides.translate(0, TS / 2, 0);
      sides.scale(T / TS, T / TS, T / TS);
      g.add(new THREE.Mesh(sides, new THREE.MeshLambertMaterial({ vertexColors: true })));
    }
    this.group.add(g);
    this.slab = g;
    return g;
  }
  // a piece of a picture put together from tile events (see layoutTilePictures)
  placeInPicture(viewer) {
    const c = this.ch, tp = this.tp;
    const floor = G.floorAt ? G.floorAt(tp.x0 + tp.c, tp.fy) : 0;
    const up = tp.k * T + tp.lift;
    const slab = tp.slab ? this.slabMesh() : null;
    this.mesh.visible = !slab;
    if (this.slab) this.slab.visible = !!slab;
    if (slab) {
      // low and wide (2-4 tiles across, wider than tall): it does not turn to the viewer - it stands across its
      // cells facing south as in 2D, as thick as a held weapon
      this.group.position.set((tp.x0 + tp.c + 0.5) * T, floor, (tp.fy + 0.5) * T);
      slab.position.set(0, up, 0);
      slab.rotation.y = 0;
      this.setFaces(0);
    } else if (tp.fixed) {
      // its own column on the south side; on the north side, as deep as the box goes, where the picture puts
      // it read from there (the first column at the east end); at an end of the box, across every row of it
      const hair = 0.01 * T;
      this.group.position.set((tp.x0 + tp.c + 0.5) * T, floor, (tp.fy + 1) * T - hair);
      this.mesh.position.set(0, up, 0);
      this.mesh.rotation.y = 0;
      const sides = [[(tp.n - 1 - 2 * tp.c) * T, -tp.d * T + 2 * hair, Math.PI]];
      for (let j = 0; j < tp.d; j++) {
        if (tp.c === tp.n - 1) sides.push([T / 2 - hair, -(j + 0.5) * T + hair, Math.PI / 2]);
        if (tp.c === 0) sides.push([-T / 2 + hair, -(j + 0.5) * T + hair, -Math.PI / 2]);
      }
      const faces = this.setFaces(sides.length);
      sides.forEach(([dx, dz, ry], k) => { faces[k].position.set(dx, up, dz); faces[k].rotation.y = ry; });
      this.setSide(THREE.FrontSide);
    } else {
      // turning to the viewer as one picture, about the middle of its foot
      const cx = (tp.x0 + tp.n / 2) * T, cz = (tp.fy + 0.5) * T;
      let vx = viewer.x - cx, vz = viewer.z - cz;
      const l = Math.hypot(vx, vz) || 1;
      vx /= l; vz /= l;
      const off = (tp.c - tp.n / 2 + 0.5) * T;
      this.group.position.set(cx + vz * off, floor, cz - vx * off);
      this.mesh.position.set(0, up, 0);
      this.mesh.rotation.y = Math.atan2(vx, vz);
      this.setFaces(0);
      this.setSide(THREE.DoubleSide);
    }
    c.viewPos = { x: this.group.position.x, y: floor + up, z: this.group.position.z };
    const op = c.opacity / 255;
    for (const m of slab ? slab.children.map(o => o.material) : [this.mesh.material]) {
      m.opacity = op;
      m.transparent = op < 0.99 || c.blendType === 1;
      m.blending = c.blendType === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }

  update(viewer, alpha = 1) {
    // a looping map: the event is drawn at its copy nearest to the viewer (placed as seen from there)
    const m = G.map, c = this.ch;
    // (last frame's shift comes off first: place() does not set the position on every frame - not while hidden)
    const last = this.loopShift;
    if (last) {
      this.group.position.x -= last.x; this.group.position.z -= last.z;
      if (c.viewPos === last.view) c.viewPos = last.base;
      this.loopShift = null;
    }
    const sx = m?.loopX ? (m.nearX(c.realX, viewer.x / T - 0.5) - c.realX) * T : 0;
    const sz = m?.loopY ? (m.nearY(c.realY, viewer.z / T - 0.5) - c.realY) * T : 0;
    if (!sx && !sz) { this.place(viewer, alpha); this.updateBalloon(); return; }
    this.place(new THREE.Vector3(viewer.x - sx, viewer.y, viewer.z - sz), alpha);
    this.group.position.x += sx; this.group.position.z += sz;
    const base = c.viewPos, view = base ? { x: base.x + sx, y: base.y, z: base.z + sz } : null;
    c.viewPos = view;
    this.loopShift = { x: sx, z: sz, base, view };
    this.updateBalloon();
  }
  // a balloon icon (! ? ♪ ...) over its head, its bottom on the top of the picture as 2D puts it (not while
  // the event is hidden: a symbol enemy's body shows its event's balloon instead, combat.js)
  updateBalloon() {
    const c = this.ch, m = this.mesh;
    if (!(c.balloonId > 0) || this.hiddenNow !== false || !m) { this.balloon?.update(0); return; }
    if (!this.balloon) this.balloon = new BalloonIcon(this.group, BALLOON_SIZE);
    const h = m.geometry.parameters?.height || T;
    const top = this.mode === 'lie' ? 1.0 : m.position.y + h * m.scale.y;
    this.balloon.update(c.balloonId, c.balloonTime, top + 0.05);
  }
  place(viewer, alpha = 1) {
    const c = this.ch;
    const key = this.graphicKey();
    if (key !== this.key && this.loading !== key) {
      this.loading = key;
      this.rebuild(key).finally(() => { if (this.loading === key) this.loading = null; });
    }
    // (a co-op phantom's copy of the host's world: shown as the host's is - coop.js)
    const net = c.net && G.coop?.phantom && !G.coop.leadsNow ? c.net : null;
    const hidden = !this.mesh || (net ? net.hidden : c.transparent || (c.isEvent && (!c.page || c.erased)) || G.combat?.hidesEvent?.(c));
    this.hiddenNow = hidden;
    this.group.visible = !hidden;
    if (hidden) return;
    if (this.tp) { this.placeInPicture(viewer); return; }
    if (this.slab) { this.slab.visible = false; this.mesh.visible = true; }
    this.setFaces(0);
    this.setSide(THREE.DoubleSide);
    const rx = c.prevRealX !== undefined ? c.prevRealX + (c.realX - c.prevRealX) * alpha : c.realX;
    const ry = c.prevRealY !== undefined ? c.prevRealY + (c.realY - c.prevRealY) * alpha : c.realY;
    const jump = c.jumping() ? c.jumpHeight() / TS * T : 0;
    // standing on a cell that is solid in 3D (set into a wall, sitting on a rock or a throne): the 2D
    // view draws it over the wall, so it goes onto the block's face (or on top) instead of inside it
    const cx = Math.round(rx), cy = Math.round(ry);
    if (cx !== this.spotX || cy !== this.spotY || this.spotMode !== this.mode) {
      this.spotX = cx; this.spotY = cy; this.spotMode = this.mode;
      const lying = this.mode === 'lie' || this.mode === 'prop' || (this.mode === 'furniture' && ['flat', 'book', 'remains'].includes(this.furnitureProfile()?.kind));
      this.spot = c.isEvent ? this.mapInfo.spotOnSolid?.(cx, cy, lying, c.priorityType === 2) || null : null;
      // A freestanding table rests on the floor or a real top surface. A wall's
      // projected face must not suspend it in the air like a hanging picture.
      if (this.mode === 'prop' && this.spot && this.spot.side !== 'top' && !this.spot.about) this.spot = null;
      this.inDoorway = !!this.mapInfo.isDoorway?.(cx, cy);
    }
    const spot = this.spot;
    // flat on a block's face; in front of an upright picture it still turns to the viewer
    const flatSpot = !!spot && spot.side !== 'top' && !spot.free && !spot.about;
    let wx, wz, wy;
    if (spot && !spot.about) {
      const out = spot.free ? 0.3 : 0.05;
      wx = spot.x * T + (spot.side === 'E' ? out : spot.side === 'W' ? -out : 0);
      wz = spot.z * T + (spot.side === 'S' ? out : spot.side === 'N' ? -out : 0);
      wy = spot.y * T;
      c.viewPos = { x: wx, y: wy, z: wz };
    } else {
      wx = (rx + 0.5) * T; wz = (ry + 0.5) * T;
      wy = G.floorAt ? G.floorAt(rx, ry) : 0;
      c.viewPos = null;
      if (spot) {
        // over a picture that turns about spot.about: on it, where its own column is across the picture (that
        // place turns with the picture, as the map's shader turns it), just on the viewer's side, at its row's
        // height - a lamp's light stays on the lamp's head from every side
        const ax = spot.about[0] * T, az = spot.about[1] * T;
        let vx = viewer.x - ax, vz = viewer.z - az;
        const l = Math.hypot(vx, vz) || 1;
        vx /= l; vz /= l;
        const off = (rx + 0.5 - spot.about[0]) * T;
        wx = ax + vz * off + vx * 0.12; wz = az - vx * off + vz * 0.12;
        wy = spot.y * T;
        c.viewPos = { x: wx, y: wy, z: wz };
      }
    }
    this.group.position.set(wx, wy, wz);
    // a frame drawn with empty rows under it stands on its visible bottom; on a wall face the 2D placement
    // (empty rows included) is what puts it at the right height
    let drop = !spot || spot.side === 'top' || spot.free || spot.about ? (this.footDrop || 0) : 0;
    if (characterPropProfile(c)?.kind === 'grounded' && !flatSpot && !this.facade && this.bodyCanvas) {
      const frame = characterPropFrame(c, this.bodyCanvas, this.info);
      if (frame) drop = (this.info.fh - frame.bottom) / this.info.fh * this.bodySize[1];
    }
    // (drawn above characters over a picture: its row's height is the height, the frame where 2D draws it -
    // 4 px up for a character sheet - not hung above head height on top of that)
    const onPicture = this.mode === 'over' && !!spot?.about;
    this.mesh.position.y = jump + (this.mode === 'over' && !spot ? 1.9 : 0) + (onPicture && !this.info?.object ? 4 / TS * T : 0) - drop;
    if (this.shadow) this.shadow.visible = !spot || spot.ground;
    if (this.mode === 'lie' || this.mode === 'furniture' || this.mode === 'prop') {
      this.mesh.rotation.y = 0;
      this.mesh.position.z = 0;
    } else if (flatSpot) {
      this.mesh.rotation.y = { S: 0, E: Math.PI / 2, W: -Math.PI / 2, N: Math.PI }[spot.side];
      this.mesh.position.z = 0;
    } else if (this.facade) {
      // against the wall behind; a door in a doorway (a walkable notch in the wall line) stands on the wall's
      // front face instead, over it like the 2D drawing (the notch is behind it, so the cell stays walkable)
      this.mesh.rotation.y = 0;
      this.mesh.position.z = (this.inDoorway ? 0.51 : -0.48) * T;
    } else if (isUprightFurnitureTile(c.tileId, this.mapInfo.tilesetNames)) {
      this.mesh.rotation.y = 0;
      this.mesh.position.z = 0;
    } else {
      this.mesh.rotation.y = Math.atan2(viewer.x - wx, viewer.z - wz);
      this.mesh.position.z = 0;
    }
    // frame selection
    const info = this.info;
    const mat = this.mesh.material;
    const op = c.opacity / 255;
    mat.opacity = op;
    mat.transparent = this.translucent || op < 0.99 || c.blendType === 1;
    mat.blending = c.blendType === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
    // on a picture, at the size 2D draws it over that picture (people elsewhere are drawn a quarter bigger)
    this.mesh.scale.setScalar(onPicture && !info.object && !info.tile ? 1 / 1.25 : 1);
    if (info.tile || this.propGeometry) return;
    let row;
    if (info.object || this.facade || this.mode === 'lie' || flatSpot || this.isCorpseGraphic() || this.rowsFixed || onPicture) row = (c.direction - 2) / 2;
    else {
      const fv = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] }[c.direction] || [0, 1];
      let vx = viewer.x - wx, vz = viewer.z - wz;
      const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
      const dot = fv[0] * vx + fv[1] * vz;
      if (dot > 0.707) row = 0;
      else if (dot < -0.707) row = 3;
      else {
        const right = [-fv[1], fv[0]];
        row = (vx * right[0] + vz * right[1]) > 0 ? 2 : 1; // seen from its right side it faces screen-right
      }
    }
    const pattern = c.pattern < 3 ? c.pattern : 1;
    this.updateBodySides(row, pattern);
    const bx = info.single ? 0 : (c.characterIndex % 4) * 3;
    const by = info.single ? 0 : Math.floor(c.characterIndex / 4) * 4;
    const tex = mat.map;
    tex.offset.set((bx + pattern) * info.fw / info.sheetW, 1 - ((by + row + 1) * info.fh) / info.sheetH);
  }
}

// Pictures put together from events drawn with tiles, one event per tile as RPG Maker draws them (a
// gargoyle on its pedestal, a church window). An upright piece stands on the tile event below it when their
// drawings meet, and columns side by side whose drawings meet make one picture. Like the map's own
// pictures, a long one (5 tiles or more across or up) or a wide one against a wall stands fixed with its
// picture on all four sides; a low wide one (2-4 tiles across and wider than tall: 2x1, 3x1, 4x1, 3x2...) stands
// still facing south with some thickness (turning to the viewer, it looked like a board swinging round); the
// rest (square or taller than wide) turns to the viewer as one picture. A lone tile keeps its own way of
// standing. Worked out again only when such events appear, vanish, move or change tiles
export function layoutTilePictures(sprites, mapInfo) {
  const w = G.map.width;
  const ups = new Map();
  let key = '';
  for (const s of sprites) {
    const c = s.ch;
    if (!c.isEvent || !(c.tileId > 0) || !s.mesh || s.hiddenNow !== false || (s.mode !== 'stand' && s.mode !== 'over')) continue;
    ups.set(c.x + c.y * w, s);
    key += `${c.x},${c.y},${c.tileId},${s.mode},${c.priorityType},${!!c.through};`;
  }
  if (key === sprites.tileLayoutKey) return;
  sprites.tileLayoutKey = key;
  for (const s of sprites) s.tp = null;
  const meets = (upper, lower) => (mapInfo.joinsBelow ? mapInfo.joinsBelow(upper.ch.tileId, lower.ch.tileId) : true);
  // RPG Maker lets nobody into its cell: the same priority as characters, or below them with a tile that blocks
  const blocks = s => {
    const c = s.ch;
    if (c.through) return false;
    if (c.priorityType === 1) return true;
    const f = c.priorityType === 0 && mapInfo.tileFlag ? mapInfo.tileFlag(c.tileId) : 0;
    return !!(f & 0x0f) && !(f & 0x10);
  };
  const below = s => { const t = ups.get(s.ch.x + (s.ch.y + 1) * w); return t && meets(s, t) ? t : null; };
  const cols = new Map();                                    // foot -> its column, bottom up
  for (const s of ups.values()) {
    let f = s, k = 0;
    for (let t = below(f); t && k < 64; t = below(f)) { f = t; k++; }
    if (!cols.has(f)) cols.set(f, []);
    cols.get(f)[k] = s;
  }
  // (a picture whose foot is drawn over a wall stays on the wall's face, piece by piece; one standing in
  // front of a wall may reach up over it, as a statue's head does in 2D)
  for (const f of [...cols.keys()]) if (mapInfo.isWall(f.ch.x, f.ch.y)) cols.delete(f);
  const footAt = new Map([...cols.keys()].map(f => [f.ch.x + f.ch.y * w, f]));
  const done = new Set();
  for (const f of [...cols.keys()].sort((a, b) => a.ch.y - b.ch.y || a.ch.x - b.ch.x)) {
    if (done.has(f)) continue;
    const group = [f];
    done.add(f);
    for (;;) {
      const a = group[group.length - 1];
      if (a.ch.x + 1 >= w) break;
      const b = footAt.get(a.ch.x + 1 + a.ch.y * w);
      if (!b || done.has(b)) break;
      const ca = cols.get(a), cb = cols.get(b);
      if (!ca.some((t, k) => t && cb[k] && (mapInfo.joinsBeside ? mapInfo.joinsBeside(t.ch.tileId, cb[k].ch.tileId) : true))) break;
      group.push(b);
      done.add(b);
    }
    const n = group.length, tall = Math.max(...group.map(g => cols.get(g).length));
    const furniture = group.every(g => cols.get(g).every(s => !s || isUprightFurnitureTile(s.ch.tileId, mapInfo.tilesetNames)));
    if (n === 1 && tall === 1 && !furniture) continue;
    const against = n > 1 && group.some(g => { const col = cols.get(g), top = col[col.length - 1].ch; return mapInfo.isWall(top.x, top.y - 1); });
    const fixed = furniture || n >= 5 || tall >= 5 || against;
    const slab = !fixed && n >= 2 && n <= 4 && n > tall;
    // drawn above characters from its foot up (an arch over the road): it hangs over head height, as a
    // single such tile does
    const lift = group.every(g => g.mode === 'over') ? 1.9 : 0;
    // a fixed box covers the rows behind its foot that its pieces close to everyone (a mass of flesh across
    // a corridor, a house), so no empty floor there blocks the way unseen
    let d = 1;
    while (fixed && d < 16 && group.every(g => { const t = ups.get(g.ch.x + (g.ch.y - d) * w); return t && blocks(t) && !mapInfo.isWall(t.ch.x, t.ch.y); })) d++;
    group.forEach((g, c) => cols.get(g).forEach((t, k) => { if (t) t.tp = { x0: f.ch.x, fy: f.ch.y, n, c, k, fixed, slab, lift, d }; }));
  }
}
