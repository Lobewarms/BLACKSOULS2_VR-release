// Held-item models built from the equipped item's icon (IconSet.png): every opaque pixel of the
// 24x24 icon becomes a small voxel, like a Minecraft-style held item. Rotation / grip position /
// size / mirroring can be tuned per item in the menu and are remembered.
import * as THREE from 'three';
import { getIconSet } from './ui.js';

const ICON = 24;
const KEY = 'bsvr.itemAdjust';
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { store = {}; }

// default blade length (m) per weapon type (1 axe 2 claw 3 spear 4 sword 5 katana 6 bow 7 dagger 8 mace 9 staff 10 gun)
const TYPE_LENGTH = { 1: 0.9, 2: 0.35, 3: 1.9, 4: 1.0, 5: 1.05, 6: 0.9, 7: 0.45, 8: 0.8, 9: 1.5, 10: 0.6 };

// Icons in this game are drawn every which way (RTP axes/staffs: handle bottom-left; most of the
// custom swords: tip top-left; guns: barrel right), so the default pose is guessed from the pixels:
//  - long axis by PCA, snapped to 45 deg (level only for guns)
//  - the tip is the upper end (icons almost always point upward); a level gun points right
//  - an axe head / gun grip sticking out to one side should hang below the hand (mirror if needed)
function poseOf(P, gun) {
  let mx = 0, my = 0;
  for (const p of P) { mx += p.x; my += p.y; }
  mx /= P.length; my /= P.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of P) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  let phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  phi = Math.round(phi / (Math.PI / 4)) * (Math.PI / 4);
  // a level shape that is not a gun is an upright weapon with a wide head (double axe, pick)
  if (!gun && Math.abs(Math.sin(phi)) < 0.3) phi = Math.PI / 2;
  let d = [Math.cos(phi), Math.sin(phi)];
  if (d[1] < -0.3 || (Math.abs(d[1]) <= 0.3 && d[0] < 0)) d = [-d[0], -d[1]];
  // sideways mass, measured along the rotated +X (= the hand's up for the right hand)
  let pos = 0, neg = 0;
  for (const p of P) {
    const sd = (p.x - mx) * d[1] - (p.y - my) * d[0];
    if (sd > 2) pos++; else if (sd < -2) neg++;
  }
  return { d, pos, neg };
}
const autoCache = new Map();
export function autoPose(iconIndex, hand = 'right', gun = false) {
  const ck = `${iconIndex}|${hand}|${gun}`;
  if (autoCache.has(ck)) return autoCache.get(ck);
  const px = iconPixels(iconIndex);
  if (!px) return null;
  const pts = [];
  for (let v = 0; v < ICON; v++) for (let u = 0; u < ICON; u++) {
    if (px[(v * ICON + u) * 4 + 3] > 100) pts.push({ x: u + 0.5 - ICON / 2, y: ICON / 2 - v - 0.5 });
  }
  if (pts.length < 6) return null;
  let r = poseOf(pts, gun);
  // the side bulge should point down: rotated -X for the right hand, +X for the left hand
  const bulgeUp = hand === 'left' ? r.neg : r.pos, bulgeDown = hand === 'left' ? r.pos : r.neg;
  let flip = false;
  if (bulgeUp >= bulgeDown + 4 && bulgeUp > bulgeDown * 1.4) {
    flip = true;
    r = poseOf(pts.map(p => ({ ...p, x: -p.x })), gun);
  }
  const phi = Math.atan2(r.d[1], r.d[0]);
  const rot = ((Math.round((90 - phi * 180 / Math.PI) / 45) * 45) % 360 + 360) % 360;
  const out = { rot, flip };
  autoCache.set(ck, out);
  return out;
}

// Icons that guess gets wrong, held as they are meant to be instead (an item's +1..+9 share its icon - and so does any
// other copy of it): drawn point down-left with the handle up-right (the katanas, Ragnarok, the ladle, the chainsaw,
// the machine gun); bows (the arrow forward, the limbs up and down, the hand on the bow's middle); the flail (its
// handle in the hand, the ball past it); the anchor (its shank in the hand, not its flukes - and smaller); the knuckle
// dusters (worn across the fist: layout); the pistols of the shield slot (barrel forward, grip down). A pose set in the
// menu still goes over it
const ICON_POSE = {
  right: {
    427: { rot: 315, offset: 15, scale: 0.5 }, 428: { rot: 315, offset: 18, scale: 0.5 }, 779: { rot: 315, offset: 10, scale: 0.5 },
    668: { rot: 225 }, 669: { rot: 225 }, 813: { rot: 225, offset: 4 }, 719: { rot: 225, offset: 2 }, 761: { rot: 225, offset: 5 },
    153: { rot: 225 }, 426: { rot: 315, offset: 2 }, 687: { rot: 30, offset: 4, scale: 0.85 },
    408: { layout: 'fist' }, 407: { layout: 'fist' },
  },
  left: { 706: { rot: 135, flip: true }, 707: { rot: 135, flip: true }, 634: { rot: 135, flip: true } },
};
// hand: 'right' (weapon slot) or 'left' (shield slot: shields, and the guns that sit in that slot)
export function defaultAdjust(kind, wtype, hand = 'right', iconIndex = 0) {
  if (kind === 'shield') return { rot: 0, offset: 0, scale: 1, flip: false };
  const auto = iconIndex ? autoPose(iconIndex, hand, wtype === 10) : null;
  const { layout, ...own } = ICON_POSE[hand]?.[iconIndex] || {};
  return { rot: auto ? auto.rot : 45, offset: wtype === 9 || wtype === 3 ? 5 : 3, scale: 1, flip: auto ? auto.flip : false, ...own };
}
// how an icon's item is laid in the hand: 'fist' (a knuckle duster across the fist) or the usual way (null)
export function iconLayout(iconIndex, hand = 'right') { return ICON_POSE[hand]?.[iconIndex]?.layout || null; }
export function getAdjust(key, kind, wtype, hand, iconIndex = 0) {
  return { ...defaultAdjust(kind, wtype, hand, iconIndex), ...(store[key] || {}) };
}
let onChange = null;
export function onAdjustChange(fn) { onChange = fn; }
export function adjustStore() { return store; }
export function replaceAdjustStore(obj) {
  store = obj && typeof obj === 'object' ? obj : {};
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* */ }
}
export function setAdjust(key, adj) {
  store[key] = adj;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* */ }
  onChange?.();
}
export function resetAdjust(key) {
  delete store[key];
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* */ }
  onChange?.();
}

function iconPixels(index) {
  const set = getIconSet();
  if (!set || !(index > 0)) return null;
  const ctx = set.getContext('2d', { willReadFrequently: true });
  const sx = (index % 16) * ICON, sy = Math.floor(index / 16) * ICON;
  if (sy + ICON > set.height) return null;
  return ctx.getImageData(sx, sy, ICON, ICON).data;
}

// low wide pictures that stand still (map tiles and tile events, 2-4 tiles across): how thick, in tile pixels
// (a tile is 32 px = 1.5 m)
export const SLAB_THICKNESS = 1.6;
// voxel geometry in icon pixel units, centred on the icon, X right / Y up / Z thickness
function voxelGeometry(px, thickness, flip) { return voxelGeometryOf(px, ICON, ICON, thickness, flip); }
// the same for any picture (w x h RGBA pixels, e.g. a 32x32 map tile): every pixel with alpha over 100 becomes a
// voxel; front, back and the sides that face an empty pixel are drawn, the sides and back a little darker.
// faces = false leaves out the front and back (a picture that has them as two textured quads: far fewer triangles)
export function voxelGeometryOf(px, w, h, thickness, flip = false, faces = true) {
  const opaque = (u, v) => u >= 0 && v >= 0 && u < w && v < h && px[(v * w + u) * 4 + 3] > 100;
  const pos = [], col = [], nrm = [], idx = [];
  const c = new THREE.Color();
  let n = 0;
  const quad = (a, b, cc, d, normal, color, shade) => {
    for (const p of [a, b, cc, d]) {
      pos.push(p[0], p[1], p[2]);
      col.push(color.r * shade, color.g * shade, color.b * shade);
      nrm.push(normal[0], normal[1], normal[2]);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  const t = thickness / 2;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    if (!opaque(u, v)) continue;
    const o = (v * w + u) * 4;
    c.setRGB(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, THREE.SRGBColorSpace);
    let x0 = u - w / 2, x1 = x0 + 1;
    if (flip) { const a = -x1; x1 = -x0; x0 = a; }
    const y1 = h / 2 - v, y0 = y1 - 1;
    if (faces) {
      quad([x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t], [0, 0, 1], c, 1);
      quad([x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t], [0, 0, -1], c, 0.8);
    }
    const left = flip ? !opaque(u + 1, v) : !opaque(u - 1, v);
    const right = flip ? !opaque(u - 1, v) : !opaque(u + 1, v);
    if (left) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], [-1, 0, 0], c, 0.7);
    if (right) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], [1, 0, 0], c, 0.7);
    if (!opaque(u, v - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], [0, 1, 0], c, 0.9);
    if (!opaque(u, v + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], [0, -1, 0], c, 0.6);
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// a weapon's cross guard, from its pixels (pts: their centres with the blade up; the grip at gripX, gripY): the widest
// row in the blade's lower 40% that stands out from the blade above - half as wide again and 2.5 pixels more (icons are
// drawn slanting: a blade 2-3 pixels thick is 4-6 wide stood up) - how far from the grip it is and how far it reaches
// to either side, in metres (p a pixel); null for none (an axe, a spear, a club, a bayonet...)
function findGuard(pts, gripX, gripY, bladePx, p) {
  const rows = new Map();
  for (const [x, y] of pts) {
    const r = Math.round(y - gripY);
    if (r < 0 || r > bladePx) continue;
    const w = rows.get(r) || [Infinity, -Infinity];
    rows.set(r, [Math.min(w[0], x), Math.max(w[1], x)]);
  }
  const width = r => { const w = rows.get(r); return w ? w[1] - w[0] + 1 : 0; };
  const upper = [...rows.keys()].filter(r => r > bladePx * 0.5).map(width).sort((a, b) => a - b);
  const blade = upper.length ? upper[Math.floor(upper.length / 2)] : 1;
  let best = 0;
  for (let r = 1; r <= bladePx * 0.4; r++) if (width(r) >= Math.max(3, blade * 1.5, blade + 2.5) && width(r) > width(best)) best = r;
  if (!best) return null;
  const [lo, hi] = rows.get(best);
  return { at: best * p, half: Math.max(Math.abs(lo - gripX), Math.abs(hi - gripX)) * p };
}

// Builds the held model.
//  weapon: grip at the origin, blade along -Z (WebXR grip space: out of the top of the fist), the
//          icon's front facing the player's eyes (-X for the right hand, +X for the left hand)
//  shield: centred, lying in the XY plane with its front toward +Z (the holder turns it outward); span: how big across
//          (m - its guard effect's size, combat.js shieldSpan), else by its kind (large: a great shield)
//  fist:   a knuckle duster (iconLayout) - across the front of the fist, its long side down the four fingers, its face
//          to the player
const FIST = { span: 0.095, x: 0.012, z: -0.085 };
export function buildIconModel(iconIndex, { kind = 'weapon', wtype = 4, hand = 'right', adjust, large = false, span = 0 } = {}) {
  const px = iconPixels(iconIndex);
  if (!px) return null;
  const adj = adjust || defaultAdjust(kind, wtype, hand, iconIndex);
  const geo = voxelGeometry(px, kind === 'shield' ? 1.4 : 0.9, adj.flip);
  if (!geo) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  const inner = new THREE.Mesh(geo, mat);
  const rot = THREE.MathUtils.degToRad(adj.rot);
  // opaque pixel centres after the mirror + in-plane rotation
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts = [];
  for (let v = 0; v < ICON; v++) for (let u = 0; u < ICON; u++) {
    if (px[(v * ICON + u) * 4 + 3] <= 100) continue;
    let x = u + 0.5 - ICON / 2;
    if (adj.flip) x = -x;
    const y = ICON / 2 - v - 0.5;
    const rx = x * cos - y * sin, ry = x * sin + y * cos;
    pts.push([rx, ry]);
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }
  inner.rotation.z = rot;
  const outer = new THREE.Group();
  if (kind === 'shield') {
    const size = Math.max(maxY - minY, maxX - minX, 1) + 1;
    const p = (span || (large ? 0.62 : 0.45)) * adj.scale / size;
    inner.scale.setScalar(p);
    inner.position.set(-(minX + maxX) / 2 * p, (-(minY + maxY) / 2 + adj.offset) * p, 0);
    outer.add(inner);
    outer.userData.length = 0.3;
    return outer;
  }
  if (kind === 'weapon' && iconLayout(iconIndex, hand) === 'fist') {
    // (the grip space: -Z out of the top of the fist, the four knuckles down it along Y, the player behind +Z)
    const p = FIST.span * adj.scale / (Math.max(maxY - minY, 1) + 1);
    inner.scale.setScalar(p);
    inner.position.set(-(minX + maxX) / 2 * p, (-(minY + maxY) / 2 + adj.offset - 3) * p, 0);
    outer.add(inner);
    outer.position.set(FIST.x, 0, FIST.z);
    outer.userData.length = 0.12;                   // (what strikes: the fist's front, as a bare fist's)
    outer.userData.ranged = false;
    return outer;
  }
  const gripY = minY + adj.offset;
  const near = pts.filter(([, y]) => y <= gripY + 1.5 && y >= gripY - 1.5);
  const gripX = near.length ? near.reduce((s, [x]) => s + x, 0) / near.length : 0;
  const bladePx = Math.max(2, maxY - gripY + 0.5);
  const p = (TYPE_LENGTH[wtype] || 1) * adj.scale / bladePx;
  inner.scale.setScalar(p);
  inner.position.set(-gripX * p, -gripY * p, 0);
  outer.add(inner);
  // rotated icon: +Y (blade) -> forward (-Z); +X -> up (right hand) / down (left hand); front -> the eyes
  const up = hand === 'left' ? -1 : 1;
  outer.setRotationFromMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, up, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-up, 0, 0)));
  outer.userData.length = bladePx * p;
  outer.userData.ranged = wtype === 10 || wtype === 6;            // (guns, bows - combat.js shotStyle has the last word)
  outer.userData.guard = findGuard(pts, gripX, gripY, bladePx, p);      // (PvP: where a blade sliding down it is caught)
  return outer;
}
