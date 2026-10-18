// RPG Maker VX Ace tile ids, flags and autotile drawing.
// Drawing logic follows the VX Ace / MV tile layout (same format).

export const TILE = {
  B: 0, C: 256, D: 512, E: 768, A5: 1536, A1: 2048, A2: 2816, A3: 4352, A4: 5888, MAX: 8192,
};
export const TS = 32; // tile size in pixels

export const isAutotile = id => id >= TILE.A1;
export const autotileKind = id => Math.floor((id - TILE.A1) / 48);
export const autotileShape = id => (id - TILE.A1) % 48;
export const isA1 = id => id >= TILE.A1 && id < TILE.A2;
export const isA2 = id => id >= TILE.A2 && id < TILE.A3;
export const isA3 = id => id >= TILE.A3 && id < TILE.A4;
export const isA4 = id => id >= TILE.A4 && id < TILE.MAX;
export const isA5 = id => id >= TILE.A5 && id < TILE.A1;
export const isBE = id => id > 0 && id < TILE.A5;
export const isVisible = id => id > 0 && id < TILE.MAX;
export const isWater = id => isA1(id) && !(id >= TILE.A1 + 96 && id < TILE.A1 + 192);
export const isWaterfall = id => id >= TILE.A1 + 192 && id < TILE.A2 && autotileKind(id) % 2 === 1;
export const isRoof = id => isA3(id) && autotileKind(id) % 16 < 8;
export const isWallTop = id => isA4(id) && autotileKind(id) % 16 < 8;
export const isWallSide = id => (isA3(id) || isA4(id)) && autotileKind(id) % 16 >= 8;
export const isWallType = id => isRoof(id) || isWallTop(id) || isWallSide(id);
export const isAnimated = id => isA1(id);

// flag bits
export const F = {
  DOWN: 0x1, LEFT: 0x2, RIGHT: 0x4, UP: 0x8, ALL: 0xf,
  STAR: 0x10, LADDER: 0x20, BUSH: 0x40, COUNTER: 0x80, DAMAGE: 0x100,
};
// RPG Maker direction (2,4,6,8) -> passage bit
export const DIR_BIT = { 2: 0x1, 4: 0x2, 6: 0x4, 8: 0x8 };

const FLOOR_AUTOTILE_TABLE = [
  [[2,4],[1,4],[2,3],[1,3]],[[2,0],[1,4],[2,3],[1,3]],[[2,4],[3,0],[2,3],[1,3]],[[2,0],[3,0],[2,3],[1,3]],
  [[2,4],[1,4],[2,3],[3,1]],[[2,0],[1,4],[2,3],[3,1]],[[2,4],[3,0],[2,3],[3,1]],[[2,0],[3,0],[2,3],[3,1]],
  [[2,4],[1,4],[2,1],[1,3]],[[2,0],[1,4],[2,1],[1,3]],[[2,4],[3,0],[2,1],[1,3]],[[2,0],[3,0],[2,1],[1,3]],
  [[2,4],[1,4],[2,1],[3,1]],[[2,0],[1,4],[2,1],[3,1]],[[2,4],[3,0],[2,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],
  [[0,4],[1,4],[0,3],[1,3]],[[0,4],[3,0],[0,3],[1,3]],[[0,4],[1,4],[0,3],[3,1]],[[0,4],[3,0],[0,3],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[2,2],[1,2],[2,3],[3,1]],[[2,2],[1,2],[2,1],[1,3]],[[2,2],[1,2],[2,1],[3,1]],
  [[2,4],[3,4],[2,3],[3,3]],[[2,4],[3,4],[2,1],[3,3]],[[2,0],[3,4],[2,3],[3,3]],[[2,0],[3,4],[2,1],[3,3]],
  [[2,4],[1,4],[2,5],[1,5]],[[2,0],[1,4],[2,5],[1,5]],[[2,4],[3,0],[2,5],[1,5]],[[2,0],[3,0],[2,5],[1,5]],
  [[0,4],[3,4],[0,3],[3,3]],[[2,2],[1,2],[2,5],[1,5]],[[0,2],[1,2],[0,3],[1,3]],[[0,2],[1,2],[0,3],[3,1]],
  [[2,2],[3,2],[2,3],[3,3]],[[2,2],[3,2],[2,1],[3,3]],[[2,4],[3,4],[2,5],[3,5]],[[2,0],[3,4],[2,5],[3,5]],
  [[0,4],[1,4],[0,5],[1,5]],[[0,4],[3,0],[0,5],[1,5]],[[0,2],[3,2],[0,3],[3,3]],[[0,2],[1,2],[0,5],[1,5]],
  [[0,4],[3,4],[0,5],[3,5]],[[2,2],[3,2],[2,5],[3,5]],[[0,2],[3,2],[0,5],[3,5]],[[0,0],[1,0],[0,1],[1,1]],
];
const WALL_AUTOTILE_TABLE = [
  [[2,2],[1,2],[2,1],[1,1]],[[0,2],[1,2],[0,1],[1,1]],[[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],
  [[2,2],[3,2],[2,1],[3,1]],[[0,2],[3,2],[0,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[0,2],[1,2],[0,3],[1,3]],[[2,0],[1,0],[2,3],[1,3]],[[0,0],[1,0],[0,3],[1,3]],
  [[2,2],[3,2],[2,3],[3,3]],[[0,2],[3,2],[0,3],[3,3]],[[2,0],[3,0],[2,3],[3,3]],[[0,0],[3,0],[0,3],[3,3]],
];
const WATERFALL_AUTOTILE_TABLE = [
  [[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
];

// Tileset images: [A1, A2, A3, A4, A5, B, C, D, E] (HTMLImageElement or canvas, may be null)
export class TileDrawer {
  constructor(images, flags) {
    this.images = images;
    this.flags = flags; // Int16Array (8192)
  }

  flag(id) { return id >= 0 && id < 8192 ? (this.flags[id] & 0xffff) : 0; }
  isTable(id) { return isA2(id) && (this.flag(id) & F.COUNTER) !== 0; }

  // Draw tile `id` at (dx,dy) of ctx. frame: animation frame counter (0..)
  draw(ctx, id, dx, dy, frame = 0) {
    if (!isVisible(id)) return;
    if (isAutotile(id)) this.drawAutotile(ctx, id, dx, dy, frame);
    else this.drawNormal(ctx, id, dx, dy);
  }

  drawNormal(ctx, id, dx, dy) {
    const set = isA5(id) ? 4 : 5 + Math.floor(id / 256);
    const src = this.images[set];
    if (!src) return;
    const sx = (Math.floor(id / 128) % 2 * 8 + id % 8) * TS;
    const sy = (Math.floor((id % 256) / 8) % 16) * TS;
    ctx.drawImage(src, sx, sy, TS, TS, dx, dy, TS, TS);
  }

  drawAutotile(ctx, id, dx, dy, frame) {
    let table = FLOOR_AUTOTILE_TABLE;
    const kind = autotileKind(id);
    const shape = autotileShape(id);
    const tx = kind % 8;
    const ty = Math.floor(kind / 8);
    let bx = 0, by = 0, set = 0, isTable = false;
    if (isA1(id)) {
      const wsi = [0, 1, 2, 1][frame % 4];
      set = 0;
      if (kind === 0) { bx = wsi * 2; by = 0; }
      else if (kind === 1) { bx = wsi * 2; by = 3; }
      else if (kind === 2) { bx = 6; by = 0; }
      else if (kind === 3) { bx = 6; by = 3; }
      else {
        bx = Math.floor(tx / 4) * 8;
        by = ty * 6 + Math.floor(tx / 2) % 2 * 3;
        if (kind % 2 === 0) bx += wsi * 2;
        else { bx += 6; table = WATERFALL_AUTOTILE_TABLE; by += frame % 3; }
      }
    } else if (isA2(id)) {
      set = 1; bx = tx * 2; by = (ty - 2) * 3; isTable = this.isTable(id);
    } else if (isA3(id)) {
      set = 2; bx = tx * 2; by = (ty - 6) * 2; table = WALL_AUTOTILE_TABLE;
    } else if (isA4(id)) {
      set = 3; bx = tx * 2; by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
      if (ty % 2 === 1) table = WALL_AUTOTILE_TABLE;
    }
    const t = table[shape];
    const src = this.images[set];
    if (!t || !src) return;
    const h = TS / 2;
    for (let i = 0; i < 4; i++) {
      const qsx = t[i][0], qsy = t[i][1];
      const sx1 = (bx * 2 + qsx) * h, sy1 = (by * 2 + qsy) * h;
      const dx1 = dx + (i % 2) * h;
      let dy1 = dy + Math.floor(i / 2) * h;
      if (isTable && (qsy === 1 || qsy === 5)) {
        let qsx2 = qsx;
        if (qsy === 1) qsx2 = [0, 3, 2, 1][qsx];
        const sx2 = (bx * 2 + qsx2) * h, sy2 = (by * 2 + 3) * h;
        ctx.drawImage(src, sx2, sy2, h, h, dx1, dy1, h, h);
        dy1 += h / 2;
        ctx.drawImage(src, sx1, sy1, h, h / 2, dx1, dy1, h, h / 2);
      } else {
        ctx.drawImage(src, sx1, sy1, h, h, dx1, dy1, h, h);
      }
    }
  }

  drawShadow(ctx, bits, dx, dy) {
    if (!(bits & 0xf)) return;
    const h = TS / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 4; i++) {
      if (bits & (1 << i)) ctx.fillRect(dx + (i % 2) * h, dy + Math.floor(i / 2) * h, h, h);
    }
  }
}

// Generic "middle" wall tile id for a wall-type autotile kind (used for unseen faces)
export function wallMiddleTile(kind) {
  return TILE.A1 + kind * 48 + 0;
}
