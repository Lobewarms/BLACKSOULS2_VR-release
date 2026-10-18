import { voxelGeometryOf } from '../combat/weapons.js';

export function corpseDepth(name, index) {
  // This mixed sheet contains bodies in slot 0 and blood/sign decals elsewhere.
  if (/死体・血・サイン/.test(name) && index !== 0) return 0;
  return /骸骨|skeleton/i.test(name) ? 0.12 : 0.18;
}

export function corpseSides(canvas, info, index, row, pattern, width, height, depth) {
  const fw = Math.round(info.fw), fh = Math.round(info.fh);
  const bx = info.single ? 0 : (index % 4) * 3, by = info.single ? 0 : Math.floor(index / 4) * 4;
  let pixels;
  try {
    pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(
      Math.round((bx + pattern) * info.fw), Math.round((by + row) * info.fh), fw, fh).data;
  } catch { return null; }
  const scale = width / fw;
  const geometry = voxelGeometryOf(pixels, fw, fh, depth / scale, false, false);
  if (!geometry) return null;
  return geometry.rotateX(-Math.PI / 2).scale(scale, scale, height / fh).translate(0, depth / 2 + 0.015, 0);
}
