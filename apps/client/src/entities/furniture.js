import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelGeometryOf } from '../combat/weapons.js';
import { TS, F, DIR_BIT } from '../world/tiles.js';

// Explicit, visually checked art pairs. Flags describe passage, not an object's
// shape or which way a chair faces. Unrecognised artwork keeps the map renderer.
const PROFILES = {};
const UPRIGHT = {
  Inside_B: new Set([
    ...Array.from({ length: 32 }, (_, i) => 48 + i), // cupboards, counters and bookcases
    102, 103, 110, 111, 117, 118, 119, 125, 126, 127, // pianos and organs
    224, 225, 226, 227, 232, 233, 234, 235, 240, 241, 243, 251, // crates
  ]),
  VXTileD: new Set([128, 129, 130, 131, 136, 137, 138, 139, 140, 141, 142, 148, 149, 156, 157]),
};
export function isUprightFurnitureTile(id, names) {
  return id > 0 && id < 1024 && !!UPRIGHT[names?.[5 + (id >> 8)]]?.has(id & 255);
}
function chairs(sheet, front, back, left, right, seat = 18, foot = 26) {
  const base = { kind: 'chair', front, back, seat, foot };
  const list = PROFILES[sheet] ||= {};
  list[front] = { ...base, direction: 2 };
  list[back] = { ...base, direction: 8 };
  if (left != null) list[left] = { ...base, direction: 6 };
  if (right != null) list[right] = { ...base, direction: 4 };
}
chairs('VXTileD', 65, 73, null, null, 18, 26);
chairs('VXTileD', 66, 67, 74, 75, 18, 27);
chairs('RoyalTileset-TileB', 227, 228, 235, 236, 19, 27);
chairs('RoyalTileset-TileB', 229, 230, 237, 238, 19, 27);
chairs('RoyalTileset-TileB', 243, 244, 251, 252, 19, 27);
chairs('RoyalTileset-TileB', 245, 246, 253, 254, 19, 27);
for (const [sheet, ids] of [['Inside_B', [104, 105, 106]], ['VXTileD', [72, 102, 165]]]) {
  const list = PROFILES[sheet] ||= {};
  for (const id of ids) list[id] = { kind: 'stool', front: id, seat: 5, foot: 23, direction: 2 };
}
// Loose covers, open pages and scattered papers, drawn from above. Bookcases
// and the game's animated floating-book character sheets are separate artwork.
for (const [sheet, ids] of [['Inside_C', Array.from({ length: 25 }, (_, i) => 56 + i)], ['VXTileD', [204, 205]]]) {
  const list = PROFILES[sheet] ||= {};
  for (const id of ids) list[id] = { kind: 'book', front: id, thickness: sheet === 'Inside_C' ? (id < 60 ? 1.5 : id < 72 ? 1 : 0.2) : (id === 204 ? 1.5 : 1) };
}
for (const [sheet, ids] of [['Dungeon_B', [240, 241, 242, 248, 249, 250]], ['Outside_C', [24, 25]], ['VXTileE', [28]]]) {
  const list = PROFILES[sheet] ||= {};
  for (const id of ids) list[id] = { kind: 'remains', front: id, thickness: 3.5 };
}

export function tileFurniture(id, names) {
  if (!(id > 0 && id < 1024)) return null;
  const profile = PROFILES[names?.[5 + (id >> 8)]]?.[id & 255];
  return profile ? { ...profile, front: (id & ~255) + profile.front, back: profile.back == null ? null : (id & ~255) + profile.back } : null;
}

// Remove recognised single-tile furniture from the *view's* grid, exposing its
// original floor. The caller's grid still owns collision and event interaction.
export function furnitureFloor(grid) {
  const cells = new Map();
  const lowerGrid = Object.assign(Object.create(grid), { tile: (x, y, z) => z === 2 ? 0 : grid.tile(x, y, z) });
  const lowerPassage = (x, y, bit, extra = []) => {
    for (const id of [...extra, grid.tile(x, y, 1), grid.tile(x, y, 0)]) {
      const flag = grid.flag(id);
      if (flag & F.STAR) continue;
      return (flag & bit) === 0;
    }
    return false;
  };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const tile = grid.tile(x, y, 2), profile = tileFurniture(tile, grid.tileset.tileset_names);
    // A book on an impassable desk keeps that desk underneath it. Other
    // impassable bases keep the existing wall/side-view rendering.
    const table = ['book', 'remains'].includes(profile?.kind) && lowerGrid.isTableTop(x, y);
    if (profile && (table || Object.values(DIR_BIT).some(bit => lowerPassage(x, y, bit))) &&
        (grid.tile(x, y, 0) || grid.tile(x, y, 1))) cells.set(x + y * grid.w, { x, y, tile, profile });
  }
  if (!cells.size) return { grid, cells: [] };
  const view = Object.assign(Object.create(grid), {
    tile: (x, y, z) => grid.valid(x, y) && z === 2 && cells.has(x + y * grid.w) ? 0 : grid.tile(x, y, z),
    passage: (x, y, bit, extra) => grid.valid(x, y) && (cells.has(x + y * grid.w) ? lowerPassage(x, y, bit, extra || []) : grid.passage(x, y, bit, extra)),
  });
  return { grid: view, cells: [...cells.values()] };
}

// Fold the original drawing into a seat, upright back and two sets of legs.
// Pixel edges have real thickness, so it remains visible from the side/behind.
// Coordinates are centred on the tile, with the feet on y=0; size is metres/tile.
export function furnitureGeometry(profile, pixelsFor, size = 1.5) {
  const source = pixelsFor(profile.front), parts = [], unit = size / TS;
  if (!source) return null;
  const pixels = Uint8ClampedArray.from(source);
  // The source's semitransparent black drop shadow belongs on the floor.
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] < 200 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 45) pixels[i + 3] = 0;
  const part = (from, to, thickness) => {
    const px = pixels.slice(from * TS * 4, to * TS * 4);
    return voxelGeometryOf(px, TS, to - from, thickness);
  };
  if (profile.kind === 'flat' || profile.kind === 'book' || profile.kind === 'remains') {
    const thickness = profile.kind === 'flat' ? TS * 0.45 : profile.thickness;
    const g = part(0, TS, thickness);
    if (!g) return null;
    return g.rotateX(-Math.PI / 2).translate(0, thickness / 2, 0).scale(unit, unit, unit);
  }
  const seatH = 10, depth = 16, thick = 1.5;
  const seat = part(profile.seat, profile.foot, thick);
  if (seat) {
    seat.rotateX(-Math.PI / 2).scale(1, 1, depth / (profile.foot - profile.seat)).translate(0, seatH, 0);
    parts.push(seat);
  }
  let bottom = TS;
  const rowDrawn = y => {
    for (let x = 0; x < TS; x++) if (pixels[(y * TS + x) * 4 + 3] > 100) return true;
    return false;
  };
  while (bottom > profile.foot && !rowDrawn(bottom - 1)) bottom--;
  const legs = bottom > profile.foot ? part(profile.foot, bottom, thick) : null;
  if (legs) {
    legs.scale(1, (seatH - thick / 2) / (bottom - profile.foot), 1).translate(0, (seatH - thick / 2) / 2, depth / 2 - thick);
    parts.push(legs, legs.clone().translate(0, 0, -depth + 2 * thick));
  }
  if (profile.kind === 'chair') {
    const back = part(0, profile.seat, thick);
    if (back) {
      // Use the actual rear-view artwork for the backrest's back face.
      const rear = pixelsFor(profile.back), p = back.getAttribute('position'), n = back.getAttribute('normal'), c = back.getAttribute('color');
      const color = new THREE.Color();
      if (rear) for (let i = 0; i < p.count; i++) if (n.getZ(i) < -0.5) {
        const x = Math.max(0, Math.min(TS - 1, Math.floor(TS / 2 - p.getX(i) - 0.01)));
        const y = Math.max(0, Math.min(profile.seat - 1, Math.floor(profile.seat / 2 - p.getY(i) - 0.01)));
        const at = (y * TS + x) * 4;
        if (rear[at + 3] > 100) {
          color.setRGB(rear[at] / 255, rear[at + 1] / 255, rear[at + 2] / 255, THREE.SRGBColorSpace).multiplyScalar(0.8);
          c.setXYZ(i, color.r, color.g, color.b);
        }
      }
      back.translate(0, seatH + profile.seat / 2, -depth / 2 + thick / 2);
      parts.push(back);
    }
  }
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geometry.rotateY(({ 2: 0, 4: -Math.PI / 2, 6: Math.PI / 2, 8: Math.PI })[profile.direction] || 0).scale(unit, unit, unit);
}
