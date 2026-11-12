// Converts an RPG Maker VX Ace tile map into 3D geometry.
//  - A3/A4 wall-type tiles (impassable)  -> solid blocks; the south face reuses the 2D wall art
//  - other large impassable areas         -> solid "mass" blocks (buildings, cliffs, void) whose
//                                            faces show the 2D art bottom-up
//  - ground tiles + passable decorations -> textured floor
//  - small impassable / star B-E tiles   -> upright pictures: long ones fixed see-through boxes with the
//                                            picture on all four sides, low wide ones (2-4 across) standing
//                                            still with some thickness, the rest turning to the viewer
// Here: the map's grid (passability as VX Ace has it), buildMapMesh running the stages of the build (src/mapgen/), and
// the 2D render (debug view, minimap).
import { TileDrawer, TS, F, DIR_BIT, TILE } from './tiles.js';
import { loadTilesetImages } from './mapgen/common.js';
import { prepareBuild } from './mapgen/setup.js';
import { classifyCells } from './mapgen/solids.js';
import { raiseLevels } from './mapgen/heights.js';
import { applyFalls } from './mapgen/falls.js';
import { placeStandees } from './mapgen/standees.js';
import { analysisReport } from './mapgen/report.js';
import { buildGeometry } from './mapgen/geometry.js';
import { buildMeshes } from './mapgen/meshes.js';
// (where the rest of the game has them from)
export { T, billboardUniforms, makeBillboardMaterial, loadTilesetImages } from './mapgen/common.js';

// ---------------------------------------------------------------------------
// Map grid: tile data + passability (VX Ace rules)
// ---------------------------------------------------------------------------
// A2 table autotiles a tileset left without the counter flag - drawn as a table seen from above like the flagged
// ones, but the 3D view took them for a building: kinds per A2 sheet. 끝나지 않는 다과회's long tea table
// (VXTileA2 #23; the other table kinds of that sheet, 7 / 15 / 31, carry the flag); 옥스・워드 대학교 １'s long table
// of bottles and scrolls by the lecture hall's east wall (TileA2_interior #15: its one tileset flags none of that sheet's
// table kinds - it stood as a board taller than the player). Only the 3D view reads this
// (isTableTop): talking across a counter keeps to the flag, as in the original
const UNFLAGGED_TABLES = { VXTileA2: [23], TileA2_interior: [15] };

export class MapGrid {
  constructor(map, tileset) {
    this.map = map;
    this.tileset = tileset;
    this.w = map.width;
    this.h = map.height;
    this.data = map.data.data;
    this.flags = tileset.flags.data;
  }
  valid(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tile(x, y, z) {
    if (!this.valid(x, y)) return 0;
    return this.data[x + y * this.w + z * this.w * this.h] & 0xffff;
  }
  region(x, y) { return this.tile(x, y, 3) >> 8; }
  shadow(x, y) { return this.tile(x, y, 3) & 0x0f; }
  flag(id) { return id >= 0 && id < 8192 ? this.flags[id] & 0xffff : 0; }
  layered(x, y) { return [this.tile(x, y, 2), this.tile(x, y, 1), this.tile(x, y, 0)]; }

  // Game_Map#check_passage (extra: the tiles of events that count as map tiles there, checked first)
  passage(x, y, bit, extra = null) {
    if (!this.valid(x, y)) return false;
    for (const id of extra ? extra.concat(this.layered(x, y)) : this.layered(x, y)) {
      const f = this.flag(id);
      if (f & F.STAR) continue;
      if ((f & bit) === 0) return true;
      if ((f & bit) === bit) return false;
    }
    return false;
  }
  passable(x, y, d, extra = null) { return this.passage(x, y, DIR_BIT[d], extra); }
  anyPassable(x, y) { return this.passable(x, y, 2) || this.passable(x, y, 4) || this.passable(x, y, 6) || this.passable(x, y, 8); }
  checkFlag(x, y, bit) {
    for (const id of this.layered(x, y)) if (this.flag(id) & bit) return true;
    return false;
  }
  isLadder(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.LADDER); }
  isBush(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.BUSH); }
  isCounter(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.COUNTER); }
  // the counter flag only on ground one walks on (a floor the map lets one talk across - 공작 부인의 저택 ６ BOSS's kitchen, 무한음식 ３,
  // 퀸・랜드 ７'s garden): no table there - what blocks the cell is a thing standing on that floor
  counterOnFloorOnly(x, y) {
    if (!this.valid(x, y)) return false;
    const ids = this.layered(x, y).filter(id => id && (this.flag(id) & F.COUNTER));
    return ids.length > 0 && ids.every(id => id >= TILE.A1 && (this.flag(id) & 0xf) === 0);
  }
  // a table or counter for the 3D view: the counter flag, or a table autotile left unflagged (UNFLAGGED_TABLES)
  isTableTop(x, y) {
    if (this.isCounter(x, y)) return true;
    const kinds = UNFLAGGED_TABLES[this.tileset?.tileset_names?.[1]];
    if (!kinds || !this.valid(x, y)) return false;
    for (const z of [0, 1]) {
      const t = this.tile(x, y, z);
      if (t >= 2816 && t < 4352 && kinds.includes(((t - 2816) / 48) | 0)) return true;
    }
    return false;
  }
  isDamage(x, y) { return this.valid(x, y) && this.checkFlag(x, y, F.DAMAGE); }
  terrainTag(x, y) {
    if (!this.valid(x, y)) return 0;
    for (const id of this.layered(x, y)) { const t = this.flag(id) >> 12; if (t > 0) return t; }
    return 0;
  }
}

// The map built stage by stage (src/mapgen/*.js): each stage reads what it needs of the build's state M - the grid, the
// options (mapbuild.js: the map's hints, pits, falls, doors...) and what the stages before it worked out - and leaves in it
// what the stages after it need; the last gives what the game reads of the map
export async function buildMapMesh(grid, opts = {}) {
  const M = { grid, opts };
  await prepareBuild(M);              // the tileset's images, the tile painter, the helpers (setup.js)
  classifyCells(M);                   // what each cell is: walls, masses, the void, rails, low blocks (solids.js)
  raiseLevels(M);                     // how tall the solids stand, the floor's levels, slopes (heights.js)
  applyFalls(M);                      // what the falls and lifts tell; the solids' bases and tops; floorAt (falls.js)
  placeStandees(M);                   // doorways, upright pictures, things lying low (standees.js)
  if (opts.analysisOnly) return analysisReport(M);      // (the developer's checks: no geometry - report.js)
  buildGeometry(M);                   // every face of it into the accumulators (geometry.js)
  return buildMeshes(M);              // the meshes, and what the game reads of the map (meshes.js)
}

// 2D top-down render (debug / minimap)
export async function render2D(grid, scale = 1) {
  const images = await loadTilesetImages(grid.tileset);
  const drawer = new TileDrawer(images, grid.flags);
  const c = document.createElement('canvas');
  c.width = grid.w * TS * scale; c.height = grid.h * TS * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const px = x * TS, py = y * TS;
    drawer.draw(ctx, grid.tile(x, y, 0), px, py);
    drawer.draw(ctx, grid.tile(x, y, 1), px, py);
    drawer.drawShadow(ctx, grid.shadow(x, y), px, py);
    drawer.draw(ctx, grid.tile(x, y, 2), px, py);
  }
  return c;
}
