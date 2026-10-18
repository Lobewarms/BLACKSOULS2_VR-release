import { TileDrawer, TS } from './tiles.js';

// B-E cells verified against the original tree sheets. Rocks, cliff faces,
// houses and A3/A4 architecture on the same sheets are deliberately excluded.
export function isFoliageTile(id, names) {
  if (!(id > 0 && id < 1024)) return false;
  const sheet = names?.[5 + (id >> 8)], cell = id & 255;
  if (sheet === 'do2') return cell >= 128 && cell <= 215;
  if (sheet === '雪国 (2)') return cell < 64;
  if (sheet === '雪国 (10)') return cell >= 8 && cell < 80 && cell % 8 < 6 || cell === 63 || cell === 71 || cell === 79;
  return false;
}

function usesForestVoid(id, names) {
  return id > 0 && id < 1024 && names?.[5 + (id >> 8)] === 'do2' && (id & 255) >= 128 && (id & 255) <= 167;
}

// This sheet's forest-border art bakes its 2D empty-space color into the image:
// cell137 is a solid (8,9,22) square. It becomes an opaque panel when stood up.
// Remove only that exact, edge-connected matte. Enclosed pixels of the same
// color and all dark bark/leaf colors survive, as do the original image bytes.
export function maskFoliageVoid(id, names, pixels, width = TS, height = TS) {
  const count = width * height;
  if (!usesForestVoid(id, names) || !Number.isInteger(count) || count <= 0 || pixels.length !== count * 4) return pixels;
  const seen = new Uint8Array(count), queue = [];
  const push = i => {
    if (seen[i]) return;
    const p = i * 4;
    if (pixels[p] !== 8 || pixels[p + 1] !== 9 || pixels[p + 2] !== 22) return;
    seen[i] = 1; queue.push(i);
  };
  for (let x = 0; x < width; x++) { push(x); push(x + (height - 1) * width); }
  for (let y = 1; y < height - 1; y++) { push(y * width); push(y * width + width - 1); }
  let result = pixels;
  for (let at = 0; at < queue.length; at++) {
    const i = queue[at], p = i * 4, x = i % width, y = (i / width) | 0;
    if (pixels[p + 3]) {
      if (result === pixels) result = new Uint8ClampedArray(pixels);
      result[p + 3] = 0;
    }
    if (x) push(i - 1); if (x + 1 < width) push(i + 1);
    if (y) push(i - width); if (y + 1 < height) push(i + width);
  }
  return result;
}

// One masked canvas per static tile, shared by classification, connectivity and
// geometry atlases. The ordinary 2D map uses TileDrawer and retains its image.
export class FoliageTileDrawer extends TileDrawer {
  constructor(images, flags, names, createCanvas = () => document.createElement('canvas')) {
    super(images, flags);
    this.names = names;
    this.createCanvas = createCanvas;
    this.foliageCanvases = new Map();
  }
  draw(ctx, id, x, y, frame = 0) {
    if (!usesForestVoid(id, this.names) || !this.images[5 + (id >> 8)]) return super.draw(ctx, id, x, y, frame);
    if (!this.foliageCanvases.has(id)) {
      let canvas = null;
      try {
        const tile = this.createCanvas(); tile.width = tile.height = TS;
        const tileCtx = tile.getContext('2d', { willReadFrequently: true });
        super.draw(tileCtx, id, 0, 0, frame);
        const image = tileCtx.getImageData(0, 0, TS, TS);
        const pixels = maskFoliageVoid(id, this.names, image.data);
        if (pixels !== image.data) { image.data.set(pixels); tileCtx.putImageData(image, 0, 0); canvas = tile; }
      } catch { /* unreadable pixel data: keep the original artwork */ }
      this.foliageCanvases.set(id, canvas);
    }
    const tile = this.foliageCanvases.get(id);
    if (tile) ctx.drawImage(tile, x, y);
    else super.draw(ctx, id, x, y, frame);
  }
}
